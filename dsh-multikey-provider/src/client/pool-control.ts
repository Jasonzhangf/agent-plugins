import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { getPath } from '@deepseek-ai/dsh-client-schema-form'

export type PoolMode = 'priority' | 'weighted'

export interface AlternateKeyDraft {
  id: string
  credentialRef: string
  enabled: boolean
  priority: number
  weight: number
}

export interface ApiKeyPoolDraft {
  mode: PoolMode
  primaryEnabled: boolean
  primaryPriority: number
  primaryWeight: number
  maxAttempts: number
  failureThreshold: number
  openCircuitMs: number
  keys: AlternateKeyDraft[]
}

export interface KeyHealthView {
  state: 'healthy' | 'open' | 'trial' | 'unknown'
  consecutiveFailures: number
  lastCode?: string
  probeRequired?: boolean
}

export interface ProbeResultView {
  route: string
  keyId: string
  status: 'ok' | 'error'
  latencyMs: number
  errorCode?: string
}

let rpc: ClientConnectionRpc | undefined

export function bindPoolControlRpc(next: ClientConnectionRpc): void {
  rpc = next
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export class MalformedPoolError extends Error {
  readonly malformed = true
  constructor(readonly detail: string) {
    super(`malformed apiKeyPool: ${detail}`)
  }
}

const KEY_ID = /^[a-z][a-z0-9-]*$/u
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/u

export function validatePoolDraft(pool: ApiKeyPoolDraft, primaryCredentialRef?: string): void {
  const ids = new Set<string>()
  const references = new Set<string>()
  for (const key of pool.keys) {
    if (!KEY_ID.test(key.id) || key.id === 'primary') throw new Error(`invalid alternate key id "${key.id}"`)
    if (!CREDENTIAL_REF.test(key.credentialRef)) throw new Error(`invalid credential reference "${key.credentialRef}"`)
    if (key.credentialRef === primaryCredentialRef) throw new Error(`duplicate credential reference "${key.credentialRef}"`)
    if (ids.has(key.id)) throw new Error(`duplicate alternate key id "${key.id}"`)
    if (references.has(key.credentialRef)) throw new Error(`duplicate credential reference "${key.credentialRef}"`)
    if (!Number.isInteger(key.priority) || key.priority < 0) throw new Error(`invalid priority for key "${key.id}"`)
    if (!Number.isFinite(key.weight) || key.weight <= 0) throw new Error(`invalid weight for key "${key.id}"`)
    ids.add(key.id)
    references.add(key.credentialRef)
  }
  if (!Number.isInteger(pool.primaryPriority) || pool.primaryPriority < 0) throw new Error('invalid primary priority')
  if (!Number.isFinite(pool.primaryWeight) || pool.primaryWeight <= 0) throw new Error('invalid primary weight')
  if (!Number.isInteger(pool.failureThreshold) || pool.failureThreshold < 1) throw new Error('invalid failure threshold')
  if (!Number.isInteger(pool.openCircuitMs) || pool.openCircuitMs < 1) throw new Error('invalid open circuit interval')
  const enabledCount = (pool.primaryEnabled ? 1 : 0) + pool.keys.filter(key => key.enabled).length
  if (enabledCount === 0) throw new Error('apiKeyPool must contain at least one enabled key')
  if (!Number.isInteger(pool.maxAttempts) || pool.maxAttempts < 1 || pool.maxAttempts > enabledCount) {
    throw new Error(`apiKeyPool.maxAttempts must be between 1 and ${String(enabledCount)}`)
  }
}

export function poolDraftOf(namespace: SettingsNamespaceView, path: readonly string[]): ApiKeyPoolDraft {
  const profile = record(getPath(namespace.value, path))
  const rawPool = profile?.apiKeyPool
  if (rawPool === undefined) {
    return {
      mode: 'priority',
      primaryEnabled: true,
      primaryPriority: 0,
      primaryWeight: 1,
      maxAttempts: 1,
      failureThreshold: 3,
      openCircuitMs: 60_000,
      keys: [],
    }
  }
  const pool = record(rawPool)
  if (pool === undefined) throw new MalformedPoolError('apiKeyPool must be an object')
  if (!Array.isArray(pool.keys)) throw new MalformedPoolError('apiKeyPool.keys must be an array')
  if (pool.mode !== undefined && pool.mode !== 'priority' && pool.mode !== 'weighted') {
    throw new MalformedPoolError('apiKeyPool.mode must be priority or weighted')
  }
  const primary = record(pool.primary)
  if (primary === undefined) throw new MalformedPoolError('apiKeyPool.primary must be an object')
  const primaryEnabled: unknown = primary.enabled
  const primaryPriority: unknown = primary.priority
  const primaryWeight: unknown = primary.weight
  if (typeof primaryEnabled !== 'boolean'
    || typeof primaryPriority !== 'number' || !Number.isInteger(primaryPriority) || (primaryPriority as number) < 0
    || typeof primaryWeight !== 'number' || !Number.isFinite(primaryWeight as number) || (primaryWeight as number) <= 0) {
    throw new MalformedPoolError('apiKeyPool.primary contains an invalid policy')
  }
  const health = record(pool.health)
  const failureThreshold: unknown = health?.failureThreshold
  const openCircuitMs: unknown = health?.openCircuitMs
  if (health === undefined
    || typeof failureThreshold !== 'number' || !Number.isInteger(failureThreshold) || (failureThreshold as number) < 1
    || typeof openCircuitMs !== 'number' || !Number.isInteger(openCircuitMs) || (openCircuitMs as number) < 1) {
    throw new MalformedPoolError('apiKeyPool.health contains an invalid policy')
  }
  const maxAttempts: unknown = pool.maxAttempts
  if (typeof maxAttempts !== 'number' || !Number.isInteger(maxAttempts) || (maxAttempts as number) < 1) {
    throw new MalformedPoolError('apiKeyPool.maxAttempts must be a positive integer')
  }
  const keys = pool.keys.map((value, index) => {
    const key = record(value)
    if (key === undefined || typeof key.id !== 'string' || typeof key.credentialRef !== 'string') {
      throw new MalformedPoolError(`apiKeyPool.keys[${index}] must contain id and credentialRef`)
    }
    const keyEnabled: unknown = key.enabled
    const keyPriority: unknown = key.priority
    const keyWeight: unknown = key.weight
    if (typeof keyEnabled !== 'boolean'
      || typeof keyPriority !== 'number' || !Number.isInteger(keyPriority) || (keyPriority as number) < 0
      || typeof keyWeight !== 'number' || !Number.isFinite(keyWeight as number) || (keyWeight as number) <= 0) {
      throw new MalformedPoolError(`apiKeyPool.keys[${index}] contains an invalid policy`)
    }
    return {
      id: key.id,
      credentialRef: key.credentialRef,
      enabled: keyEnabled as boolean,
      priority: keyPriority as number,
      weight: keyWeight as number,
    }
  })
  return {
    mode: pool?.mode === 'weighted' ? 'weighted' : 'priority',
    primaryEnabled: primaryEnabled as boolean,
    primaryPriority: primaryPriority as number,
    primaryWeight: primaryWeight as number,
    maxAttempts: maxAttempts as number,
    failureThreshold: failureThreshold as number,
    openCircuitMs: openCircuitMs as number,
    keys,
  }
}

function settingsValue(pool: ApiKeyPoolDraft): Record<string, unknown> {
  return {
    mode: pool.mode,
    primary: {
      enabled: pool.primaryEnabled,
      priority: pool.primaryPriority,
      weight: pool.primaryWeight,
    },
    keys: pool.keys.map(key => ({ ...key })),
    maxAttempts: pool.maxAttempts,
    health: {
      failureThreshold: pool.failureThreshold,
      openCircuitMs: pool.openCircuitMs,
    },
  }
}

export async function persistPool(
  api: Pick<IApiClient, 'settings'>,
  namespace: SettingsNamespaceView,
  settingsPath: readonly string[],
  pool: ApiKeyPoolDraft,
): Promise<SettingsNamespaceView> {
  const primaryCredentialRef = getPath(namespace.value, [...settingsPath, 'apiKeyEnv'])
  if (pool.keys.length > 0) {
    validatePoolDraft(pool, typeof primaryCredentialRef === 'string' ? primaryCredentialRef : undefined)
  }
  const response = await api.settings.mutate({
    ns: namespace.ns,
    expectedRevision: namespace.revision,
    ops: pool.keys.length === 0
      ? [{ op: 'unset', path: [...settingsPath, 'apiKeyPool'] }]
      : [{ op: 'set', path: [...settingsPath, 'apiKeyPool'], value: settingsValue(pool) }],
  })
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value
}

export async function storeAlternateCredential(
  api: Pick<IApiClient, 'credentials'>,
  credentialRef: string,
  value: string,
): Promise<void> {
  const response = await api.credentials.set({ ref: credentialRef, value })
  if (!response.result.ok) throw new Error(response.result.error.message)
}

export async function viewPoolHealth(route: string): Promise<Record<string, KeyHealthView>> {
  if (rpc === undefined) throw new Error('multikey control is unavailable')
  const result = await rpc.call('/multikey-provider', 'view', {})
  if (!result.ok) throw new Error(result.error.message)
  const all = record(result.value)
  const routeView = record(all?.[route])
  if (routeView === undefined) return {}
  return Object.fromEntries(Object.entries(routeView).map(([keyId, value]) => {
    const state = record(value)
    const status = state?.state
    return [keyId, {
      state: status === 'healthy' || status === 'open' || status === 'trial' ? status : 'unknown',
      consecutiveFailures: typeof state?.consecutiveFailures === 'number' ? state.consecutiveFailures : 0,
      ...(typeof state?.lastCode === 'string' ? { lastCode: state.lastCode } : {}),
      ...(state?.probeRequired === true ? { probeRequired: true } : {}),
    }]
  }))
}

export async function probeAlternateKey(route: string, keyId: string): Promise<ProbeResultView> {
  if (rpc === undefined) throw new Error('multikey control is unavailable')
  const result = await rpc.call('/multikey-provider', 'probe', { route, keyId })
  if (!result.ok) throw new Error(result.error.message)
  return result.value as ProbeResultView
}
