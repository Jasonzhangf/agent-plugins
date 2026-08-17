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

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
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
  const pool = record(profile?.apiKeyPool)
  const rawKeys = Array.isArray(pool?.keys) ? pool.keys : []
  const keys = rawKeys.flatMap((value, index) => {
    const key = record(value)
    if (key === undefined || typeof key.id !== 'string' || typeof key.credentialRef !== 'string') return []
    return [{
      id: key.id,
      credentialRef: key.credentialRef,
      enabled: key.enabled !== false,
      priority: nonNegativeInteger(key.priority, index + 1),
      weight: typeof key.weight === 'number' && Number.isFinite(key.weight) && key.weight > 0 ? key.weight : 1,
    }]
  })
  const health = record(pool?.health)
  const primary = record(pool?.primary)
  return {
    mode: pool?.mode === 'weighted' ? 'weighted' : 'priority',
    primaryEnabled: primary?.enabled !== false,
    primaryPriority: nonNegativeInteger(primary?.priority, 0),
    primaryWeight: typeof primary?.weight === 'number' && Number.isFinite(primary.weight) && primary.weight > 0
      ? primary.weight
      : 1,
    maxAttempts: positiveInteger(pool?.maxAttempts, Math.max(1, keys.length + 1)),
    failureThreshold: positiveInteger(health?.failureThreshold, 3),
    openCircuitMs: positiveInteger(health?.openCircuitMs, 60_000),
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
  const result = await rpc.call('/dsh-llm-pi-ai-multikey', 'view', {})
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
    }]
  }))
}

export async function probeAlternateKey(route: string, keyId: string): Promise<ProbeResultView> {
  if (rpc === undefined) throw new Error('multikey control is unavailable')
  const result = await rpc.call('/dsh-llm-pi-ai-multikey', 'probe', { route, keyId })
  if (!result.ok) throw new Error(result.error.message)
  return result.value as ProbeResultView
}
