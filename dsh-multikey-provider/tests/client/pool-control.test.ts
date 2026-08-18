import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import {
  bindPoolControlRpc,
  MalformedPoolError,
  persistPool,
  poolDraftOf,
  probeAlternateKey,
  storeAlternateCredential,
  viewPoolHealth,
} from '../../src/client/pool-control.js'

function namespace(value: unknown = {}): SettingsNamespaceView {
  return {
    ns: 'llm-pi-ai', revision: 7, value, user: value, base: {}, schema: {}, writable: true,
  } as unknown as SettingsNamespaceView
}

test('poolDraftOf reads only the configured provider profile', () => {
  const draft = poolDraftOf(namespace({ providers: { test: { apiKeyPool: {
    mode: 'weighted',
    primary: { enabled: false, priority: 0, weight: 3 },
    maxAttempts: 1,
    health: { failureThreshold: 2, openCircuitMs: 5000 },
    keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY', enabled: true, priority: 4, weight: 2 }],
  } } } }), ['providers', 'test'])
  assert.equal(draft.mode, 'weighted')
  assert.equal(draft.primaryEnabled, false)
  assert.equal(draft.primaryWeight, 3)
  assert.equal(draft.primaryPriority, 0)
  assert.equal(draft.keys[0]?.credentialRef, 'BACKUP_KEY')
})

test('poolDraftOf rejects malformed stored pool without reconstructing it', () => {
  const value = { providers: { test: { apiKeyPool: {
    mode: 'weighted', primary: { enabled: true, priority: 0, weight: 1 },
    maxAttempts: 2, health: { failureThreshold: 3, openCircuitMs: 60000 },
    keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY', enabled: true, priority: 'bad', weight: 1 }],
  } } } }
  assert.throws(() => poolDraftOf(namespace(value), ['providers', 'test']), MalformedPoolError)
  assert.equal(JSON.stringify(value).includes('"priority":"bad"'), true)
})

test('poolDraftOf fills missing pool fields with server defaults', () => {
  // A stored pool that omits `mode`, the `primary` policy, `health`, and
  // `maxAttempts` must surface a draft mirroring compileKeyPool defaults,
  // not blank the Models section with MalformedPoolError.
  const draft = poolDraftOf(namespace({ providers: { test: { apiKeyPool: {
    keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY' }],
  } } } }), ['providers', 'test'])
  assert.equal(draft.mode, 'priority')
  assert.equal(draft.primaryEnabled, true)
  assert.equal(draft.primaryPriority, 0)
  assert.equal(draft.primaryWeight, 1)
  assert.equal(draft.failureThreshold, 3)
  assert.equal(draft.openCircuitMs, 60_000)
  // enabledCount is 2 (primary + one key), so maxAttempts falls back to 2.
  assert.equal(draft.maxAttempts, 2)
  assert.equal(draft.keys[0]?.enabled, true)
  assert.equal(draft.keys[0]?.priority, 1)
  assert.equal(draft.keys[0]?.weight, 1)
})

test('persistPool mutates only apiKeyPool and keeps credential values out', async () => {
  let request: unknown
  const api = { settings: { mutate: async (value: unknown) => {
    request = value
    return { result: { ok: true, value: namespace() } }
  } } } as unknown as Pick<IApiClient, 'settings'>
  await persistPool(api, namespace(), ['providers', 'test'], {
    mode: 'priority', primaryEnabled: true, primaryPriority: 0, primaryWeight: 1,
    maxAttempts: 2, failureThreshold: 3, openCircuitMs: 60000,
    keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY', enabled: true, priority: 1, weight: 1 }],
  })
  assert.deepEqual((request as { ops: { path: string[] }[] }).ops[0]?.path, ['providers', 'test', 'apiKeyPool'])
  assert.equal(JSON.stringify(request).includes('secret'), false)
})

test('persistPool rejects invalid enabled count before mutation', async () => {
  let calls = 0
  const api = { settings: { mutate: async () => { calls += 1; return { result: { ok: true, value: namespace() } } } } } as unknown as Pick<IApiClient, 'settings'>
  await assert.rejects(persistPool(api, namespace(), ['providers', 'test'], {
    mode: 'priority', primaryEnabled: false, primaryPriority: 0, primaryWeight: 1,
    maxAttempts: 1, failureThreshold: 3, openCircuitMs: 60000,
    keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY', enabled: false, priority: 1, weight: 1 }],
  }), /enabled key/u)
  assert.equal(calls, 0)
})

test('removing the final alternate unsets apiKeyPool and advances the revision', async () => {
  let request: unknown
  const updated = namespace({ providers: { test: {} } })
  Object.assign(updated, { revision: 8 })
  const api = { settings: { mutate: async (value: unknown) => {
    request = value
    return { result: { ok: true, value: updated } }
  } } } as unknown as Pick<IApiClient, 'settings'>
  const result = await persistPool(api, namespace(), ['providers', 'test'], {
    mode: 'priority', primaryEnabled: true, primaryPriority: 0, primaryWeight: 1,
    maxAttempts: 1, failureThreshold: 3, openCircuitMs: 60000, keys: [],
  })
  assert.deepEqual((request as { expectedRevision: number; ops: unknown[] }), {
    ns: 'llm-pi-ai',
    expectedRevision: 7,
    ops: [{ op: 'unset', path: ['providers', 'test', 'apiKeyPool'] }],
  })
  assert.equal(result.revision, 8)
})

test('sequential pool writes consume the revision returned by the prior write', async () => {
  const revisions: number[] = []
  let nextRevision = 8
  const api = { settings: { mutate: async (value: unknown) => {
    revisions.push((value as { expectedRevision: number }).expectedRevision)
    const updated = namespace({ providers: { test: { apiKeyEnv: 'PRIMARY_KEY' } } })
    Object.assign(updated, { revision: nextRevision++ })
    return { result: { ok: true, value: updated } }
  } } } as unknown as Pick<IApiClient, 'settings'>
  const draft = {
    mode: 'priority' as const, primaryEnabled: true, primaryPriority: 0, primaryWeight: 1,
    maxAttempts: 1, failureThreshold: 3, openCircuitMs: 60000, keys: [],
  }
  const first = await persistPool(api, namespace(), ['providers', 'test'], draft)
  await persistPool(api, first, ['providers', 'test'], draft)
  assert.deepEqual(revisions, [7, 8])
})

test('persistPool rejects an alternate reference equal to the primary reference', async () => {
  let calls = 0
  const api = { settings: { mutate: async () => {
    calls += 1
    return { result: { ok: true, value: namespace() } }
  } } } as unknown as Pick<IApiClient, 'settings'>
  await assert.rejects(persistPool(api, namespace({ providers: { test: { apiKeyEnv: 'PRIMARY_KEY' } } }), ['providers', 'test'], {
    mode: 'priority', primaryEnabled: true, primaryPriority: 0, primaryWeight: 1,
    maxAttempts: 2, failureThreshold: 3, openCircuitMs: 60000,
    keys: [{ id: 'backup', credentialRef: 'PRIMARY_KEY', enabled: true, priority: 1, weight: 1 }],
  }), /duplicate credential reference/u)
  assert.equal(calls, 0)
})

test('credential write and loopback probe use physically separate channels', async () => {
  let credentialRequest: unknown
  const api = { credentials: { set: async (value: unknown) => {
    credentialRequest = value
    return { result: { ok: true, value: {} } }
  } } } as unknown as Pick<IApiClient, 'credentials'>
  await storeAlternateCredential(api, 'BACKUP_KEY', 'secret-value')
  assert.deepEqual(credentialRequest, { ref: 'BACKUP_KEY', value: 'secret-value' })

  const rpc = { call: async (path: string, endpoint: string, payload: unknown) => {
    assert.equal(path, '/multikey-provider')
    if (endpoint === 'view') return { ok: true, value: { test: { backup: { state: 'healthy', consecutiveFailures: 0 } } } }
    assert.deepEqual(payload, { route: 'test', keyId: 'backup' })
    return { ok: true, value: { route: 'test', keyId: 'backup', status: 'ok', latencyMs: 1 } }
  } } as unknown as ClientConnectionRpc
  bindPoolControlRpc(rpc)
  assert.equal((await viewPoolHealth('test')).backup?.state, 'healthy')
  assert.equal((await probeAlternateKey('test', 'backup')).status, 'ok')
})
