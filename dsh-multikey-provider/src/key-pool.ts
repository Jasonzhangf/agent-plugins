import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { ApiKeyPool } from './config.ts'

export type PoolMode = 'priority' | 'weighted'
export type AccountFailureCode =
  | 'AUTH'
  | 'QUOTA'
  | 'RATE_LIMIT'
  | 'MISSING_CREDENTIAL'
  | 'INVALID_CREDENTIAL'

/** Provider failures whose circuit state must not cross session boundaries. */
export const SESSION_SCOPED_FAILURES: ReadonlySet<AccountFailureCode> = new Set([
  'QUOTA',
  'RATE_LIMIT',
])
export type KeyState = 'healthy' | 'open' | 'trial'
export const AUTH_COOLDOWN_MS = 60 * 60 * 1000

export interface KeyDescriptor {
  readonly id: string
  readonly credentialRef: CredentialRef
  readonly enabled: boolean
  readonly priority: number
  readonly weight: number
}

export interface PoolDescriptor {
  readonly mode: PoolMode
  readonly keys: readonly KeyDescriptor[]
  readonly maxAttempts: number
  readonly health: {
    readonly failureThreshold: number
    readonly openCircuitMs: number
  }
}

interface KeyHealth {
  state: KeyState
  consecutiveFailures: number
  lastFailureAt?: number
  lastCode?: AccountFailureCode
  probeRequired?: boolean
}

interface PreservedKeyHealth {
  readonly credentialRef: CredentialRef
  readonly health: KeyHealth
}

export interface KeyHealthView {
  readonly state: KeyState
  readonly consecutiveFailures: number
  readonly lastFailureAt?: number
  readonly lastCode?: AccountFailureCode
  readonly probeRequired?: boolean
}

const KEY_ID = /^[a-z][a-z0-9-]*$/u

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`)
  return value
}

function positiveFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be a positive finite number`)
  return value
}

/** Compile references and policy without resolving any credential value. */
export function compileKeyPool(
  provider: string,
  primaryRef: CredentialRef | undefined,
  input: ApiKeyPool | undefined,
): PoolDescriptor | undefined {
  if (input === undefined) return undefined
  if (primaryRef === undefined) {
    throw new Error(`multikey-provider: provider "${provider}" apiKeyPool requires apiKeyEnv`)
  }

  const primary = input.primary ?? {}
  const keys: KeyDescriptor[] = [{
    id: 'primary',
    credentialRef: primaryRef,
    enabled: primary.enabled ?? true,
    priority: nonNegativeInteger(primary.priority ?? 0, `${provider}.apiKeyPool.primary.priority`),
    weight: positiveFinite(primary.weight ?? 1, `${provider}.apiKeyPool.primary.weight`),
  }]
  const ids = new Set(['primary'])
  const references = new Set<string>([String(primaryRef)])

  for (const [index, source] of input.keys.entries()) {
    if (!KEY_ID.test(source.id) || source.id === 'primary') {
      throw new Error(`multikey-provider: provider "${provider}" alternate key id "${source.id}" is invalid or reserved`)
    }
    if (ids.has(source.id)) {
      throw new Error(`multikey-provider: provider "${provider}" repeats alternate key id "${source.id}"`)
    }
    const ref = credentialRef(source.credentialRef)
    if (references.has(String(ref))) {
      throw new Error(`multikey-provider: provider "${provider}" repeats credential reference "${String(ref)}"`)
    }
    ids.add(source.id)
    references.add(String(ref))
    keys.push({
      id: source.id,
      credentialRef: ref,
      enabled: source.enabled ?? true,
      priority: nonNegativeInteger(source.priority ?? index + 1, `${provider}.apiKeyPool.keys.${source.id}.priority`),
      weight: positiveFinite(source.weight ?? 1, `${provider}.apiKeyPool.keys.${source.id}.weight`),
    })
  }

  const enabledCount = keys.filter(key => key.enabled).length
  if (enabledCount === 0) throw new Error(`multikey-provider: provider "${provider}" apiKeyPool has no enabled credential`)
  const maxAttempts = input.maxAttempts ?? enabledCount
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > enabledCount) {
    throw new Error(`multikey-provider: provider "${provider}" apiKeyPool.maxAttempts must be between 1 and ${String(enabledCount)}`)
  }
  const failureThreshold = input.health?.failureThreshold ?? 3
  const openCircuitMs = input.health?.openCircuitMs ?? 60_000
  if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
    throw new Error(`multikey-provider: provider "${provider}" apiKeyPool.health.failureThreshold must be a positive integer`)
  }
  positiveFinite(openCircuitMs, `${provider}.apiKeyPool.health.openCircuitMs`)

  return Object.freeze({
    mode: input.mode ?? 'priority',
    keys: Object.freeze(keys.map(key => Object.freeze(key))),
    maxAttempts,
    health: Object.freeze({ failureThreshold, openCircuitMs }),
  })
}

function freshHealth(): KeyHealth {
  return { state: 'healthy', consecutiveFailures: 0 }
}

/** Process-local selection and health owner. It never receives credential values. */
export class KeyPoolRuntime {
  private readonly health = new Map<string, KeyHealth>()
  private readonly sessionHealth = new Map<string, Map<string, KeyHealth>>()
  private readonly random: () => number
  private readonly now: () => number

  constructor(
    private readonly pool: PoolDescriptor,
    options: { random?: () => number; now?: () => number; previous?: KeyPoolRuntime } = {},
  ) {
    this.random = options.random ?? Math.random
    this.now = options.now ?? Date.now
    for (const key of pool.keys) {
      const previous = options.previous?.preservedStateFor(key)
      this.health.set(key.id, previous === undefined ? freshHealth() : { ...previous })
    }
  }

  get descriptor(): PoolDescriptor { return this.pool }
  get maxAttempts(): number { return this.pool.maxAttempts }

  private preservedStateFor(key: KeyDescriptor): KeyHealth | undefined {
    const previous = this.preservedState(key.id)
    if (previous?.credentialRef !== key.credentialRef) return undefined
    return previous.health
  }

  private preservedState(keyId: string): PreservedKeyHealth | undefined {
    const key = this.pool.keys.find(candidate => candidate.id === keyId)
    const health = this.health.get(keyId)
    if (key === undefined || health === undefined) return undefined
    return { credentialRef: key.credentialRef, health }
  }

  private selectable(key: KeyDescriptor, sessionId?: string): boolean {
    if (!key.enabled) return false
    const health = this.health.get(key.id)
    if (health === undefined) return false
    if (health.state === 'open' && health.lastFailureAt !== undefined
      && health.lastCode !== 'AUTH' && health.lastCode !== 'INVALID_CREDENTIAL'
      && this.now() - health.lastFailureAt >= this.pool.health.openCircuitMs) health.state = 'healthy'
    if (health.probeRequired === true) return false
    if (health.state !== 'healthy') return false
    if (sessionId === undefined) return true
    const session = this.sessionHealth.get(sessionId)?.get(key.id)
    if (session?.state === 'open' && session.lastFailureAt !== undefined
      && this.now() - session.lastFailureAt >= this.pool.health.openCircuitMs) {
      session.state = 'healthy'
    }
    return session?.state !== 'open'
  }

  select(excluded: ReadonlySet<string> = new Set(), sessionId?: string): KeyDescriptor | undefined {
    const eligible = this.pool.keys.filter(key => !excluded.has(key.id) && this.selectable(key, sessionId))
    if (eligible.length === 0) return undefined
    let selected: KeyDescriptor
    const priority = Math.min(...eligible.map(key => key.priority))
    const tier = this.pool.mode === 'priority'
      ? eligible.filter(key => key.priority === priority)
      : eligible
    const total = tier.reduce((sum, key) => sum + key.weight, 0)
    let cursor = this.random() * total
    selected = tier[tier.length - 1] as KeyDescriptor
    for (const key of tier) {
      cursor -= key.weight
      if (cursor < 0) { selected = key; break }
    }
    const health = this.health.get(selected.id)
    if (health !== undefined) health.state = 'trial'
    return selected
  }

  reserveExact(keyId: string): KeyDescriptor | undefined {
    const key = this.pool.keys.find(candidate => candidate.id === keyId && candidate.enabled)
    if (key === undefined) return undefined
    const health = this.health.get(key.id)
    if (health === undefined || health.state === 'trial' || health.probeRequired === true) return undefined
    health.state = 'trial'
    return key
  }

  recordSuccess(keyId: string, sessionId?: string): void {
    const health = this.health.get(keyId)
    if (health === undefined) return
    this.health.set(keyId, freshHealth())
    if (sessionId !== undefined) this.sessionHealth.get(sessionId)?.delete(keyId)
  }

  recordAttemptFailure(keyId: string, code: AccountFailureCode, sessionId?: string): void {
    const global = this.health.get(keyId)
    if (SESSION_SCOPED_FAILURES.has(code) && global?.state === 'trial') global.state = 'healthy'
    const health = SESSION_SCOPED_FAILURES.has(code)
      ? this.sessionHealthFor(sessionId, keyId)
      : global
    if (health === undefined) return
    health.consecutiveFailures += 1
    health.lastFailureAt = this.now()
    health.lastCode = code
    if (code === 'AUTH' || code === 'INVALID_CREDENTIAL') {
      health.state = 'open'
      health.probeRequired = true
      health.lastFailureAt = this.now()
      return
    }
    health.state = health.consecutiveFailures >= this.pool.health.failureThreshold ? 'open' : 'healthy'
  }

  /** Mark an auth-cooled key as probeable without making it request-eligible. */
  probeTrial(keyId: string): boolean {
    const health = this.health.get(keyId)
    if (health === undefined || health.probeRequired !== true || health.lastFailureAt === undefined) return false
    if (this.now() - health.lastFailureAt < AUTH_COOLDOWN_MS) return false
    if (health.state === 'trial') return false
    health.state = 'trial'
    return true
  }

  recordProbeSuccess(keyId: string): void {
    const health = this.health.get(keyId)
    if (health === undefined) return
    this.health.set(keyId, freshHealth())
  }

  recordProbeFailure(keyId: string, code: AccountFailureCode): void {
    const health = this.health.get(keyId)
    if (health === undefined) return
    health.state = 'open'
    health.probeRequired = code === 'AUTH' || code === 'INVALID_CREDENTIAL'
    health.consecutiveFailures += 1
    health.lastCode = code
    health.lastFailureAt = this.now()
  }

  private sessionHealthFor(sessionId: string | undefined, keyId: string): KeyHealth | undefined {
    if (sessionId === undefined) return undefined
    let session = this.sessionHealth.get(sessionId)
    if (session === undefined) {
      session = new Map<string, KeyHealth>()
      this.sessionHealth.set(sessionId, session)
    }
    let health = session.get(keyId)
    if (health === undefined) {
      health = freshHealth()
      session.set(keyId, health)
    }
    return health
  }

  release(keyId: string): void {
    const health = this.health.get(keyId)
    if (health?.state === 'trial') health.state = 'healthy'
  }

  view(): ReadonlyMap<string, KeyHealthView> {
    const result = new Map<string, KeyHealthView>()
    for (const key of this.pool.keys) {
      this.selectable(key)
      const health = this.health.get(key.id) ?? freshHealth()
      result.set(key.id, Object.freeze({
        state: health.state,
        consecutiveFailures: health.consecutiveFailures,
        ...(health.lastFailureAt === undefined ? {} : { lastFailureAt: health.lastFailureAt }),
        ...(health.lastCode === undefined ? {} : { lastCode: health.lastCode }),
        ...(health.probeRequired === true ? { probeRequired: true } : {}),
      }))
    }
    return result
  }
}
