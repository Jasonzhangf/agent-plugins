import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { type ApiKeyPoolDraft } from '../../src/client/pool-control.js'
import {
  AlternateKeyCredentialPendingError,
  AlternateKeyInputError,
  commitAlternateKey,
  DuplicateAlternateKeyError,
  planAddAlternateKey,
  retryAlternateKeyCredential,
} from '../../src/client/add-alternate-key.js'
import { storeAlternateCredential } from '../../src/client/pool-control.js'

function emptyNamespace(): SettingsNamespaceView {
  return {
    ns: 'llm-pi-ai', revision: 7, value: {}, user: {}, base: {}, schema: {}, writable: true,
  } as unknown as SettingsNamespaceView
}

function basePool(overrides: Partial<ApiKeyPoolDraft> = {}): ApiKeyPoolDraft {
  return {
    mode: 'priority',
    primaryEnabled: true,
    primaryPriority: 0,
    primaryWeight: 1,
    maxAttempts: 1,
    failureThreshold: 3,
    openCircuitMs: 60_000,
    keys: [],
    ...overrides,
  }
}

test('planAddAlternateKey rejects empty value before any I/O', () => {
  assert.throws(
    () => planAddAlternateKey(basePool(), {
      id: 'backup', credentialRef: 'BACKUP_KEY', credentialValue: '   ', priority: 1, weight: 1,
    }, undefined),
    (error: unknown) => error instanceof AlternateKeyInputError && error.field === 'value',
  )
})

test('planAddAlternateKey rejects duplicate id', () => {
  const pool = basePool({ keys: [{ id: 'backup', credentialRef: 'EXISTING_KEY', enabled: true, priority: 1, weight: 1 }] })
  assert.throws(
    () => planAddAlternateKey(pool, {
      id: 'backup', credentialRef: 'BACKUP_KEY', credentialValue: 'secret', priority: 2, weight: 1,
    }, undefined),
    (error: unknown) => error instanceof DuplicateAlternateKeyError && error.field === 'id',
  )
})

test('planAddAlternateKey rejects credential reference equal to primary', () => {
  assert.throws(
    () => planAddAlternateKey(basePool(), {
      id: 'backup', credentialRef: 'PRIMARY_KEY', credentialValue: 'secret', priority: 1, weight: 1,
    }, 'PRIMARY_KEY'),
    (error: unknown) => error instanceof DuplicateAlternateKeyError && error.field === 'credentialRef',
  )
})

test('commitAlternateKey writes settings before credentials and embeds no secret in ops', async () => {
  const calls: string[] = []
  const settingsRequest = { captured: undefined as unknown }
  const updated = emptyNamespace()
  Object.assign(updated, { revision: 8 })
  const api = {
    settings: { mutate: async (value: unknown) => {
      calls.push('settings')
      settingsRequest.captured = value
      return { result: { ok: true, value: updated } }
    } },
    credentials: { set: async () => { calls.push('credentials'); return { result: { ok: true, value: {} } } } },
  } as unknown as Pick<IApiClient, 'settings' | 'credentials'>
  const plan = planAddAlternateKey(basePool(), {
    id: 'backup', credentialRef: 'BACKUP_KEY', credentialValue: 'secret-value', priority: 1, weight: 1,
  }, 'PRIMARY_KEY')
  await commitAlternateKey(api, emptyNamespace(), ['providers', 'test'], plan)
  assert.deepEqual(calls, ['settings', 'credentials'])
  const serialized = JSON.stringify(settingsRequest.captured)
  assert.equal(serialized.includes('secret-value'), false)
  assert.equal(serialized.includes('BACKUP_KEY'), true)
})

test('commitAlternateKey throws AlternateKeyCredentialPendingError when credentials.set fails', async () => {
  const calls: string[] = []
  const api = {
    settings: { mutate: async () => { calls.push('settings'); return { result: { ok: true, value: emptyNamespace() } } } },
    credentials: { set: async () => {
      calls.push('credentials')
      return { result: { ok: false, error: { message: 'credential store offline' } } }
    } },
  } as unknown as Pick<IApiClient, 'settings' | 'credentials'>
  const plan = planAddAlternateKey(basePool(), {
    id: 'backup', credentialRef: 'BACKUP_KEY', credentialValue: 'secret-value', priority: 1, weight: 1,
  }, undefined)
  await assert.rejects(
    commitAlternateKey(api, emptyNamespace(), ['providers', 'test'], plan),
    (error: unknown) => {
      assert.ok(error instanceof AlternateKeyCredentialPendingError)
      assert.equal((error as AlternateKeyCredentialPendingError).keyId, 'backup')
      assert.equal((error as AlternateKeyCredentialPendingError).credentialRef, 'BACKUP_KEY')
      assert.equal((error as AlternateKeyCredentialPendingError).credentialValue, 'secret-value')
      assert.match((error as Error).message, /credential store offline/u)
      return true
    },
  )
  // settings.mutate already ran; credentials.set was attempted and failed;
  // no extra mutation must have been queued.
  assert.deepEqual(calls, ['settings', 'credentials'])
})

test('commitAlternateKey does not call credentials.set when settings.mutate fails', async () => {
  const calls: string[] = []
  const api = {
    settings: { mutate: async () => {
      calls.push('settings')
      return { result: { ok: false, error: { message: 'settings rejected' } } }
    } },
    credentials: { set: async () => { calls.push('credentials'); return { result: { ok: true, value: {} } } } },
  } as unknown as Pick<IApiClient, 'settings' | 'credentials'>
  const plan = planAddAlternateKey(basePool(), {
    id: 'backup', credentialRef: 'BACKUP_KEY', credentialValue: 'secret-value', priority: 1, weight: 1,
  }, undefined)
  await assert.rejects(commitAlternateKey(api, emptyNamespace(), ['providers', 'test'], plan), /settings rejected/u)
  assert.deepEqual(calls, ['settings'])
})

test('retryAlternateKeyCredential writes only the credential half', async () => {
  const calls: string[] = []
  let credentialRequest: unknown
  const api = { credentials: { set: async (value: unknown) => {
    calls.push('credentials')
    credentialRequest = value
    return { result: { ok: true, value: {} } }
  } } } as unknown as Pick<IApiClient, 'credentials'>
  await retryAlternateKeyCredential(api, { keyId: 'backup', credentialRef: 'BACKUP_KEY', credentialValue: 'secret-value' })
  assert.deepEqual(calls, ['credentials'])
  assert.deepEqual(credentialRequest, { ref: 'BACKUP_KEY', value: 'secret-value' })
  // Re-use the same primitive so a credential-only retry never silently
  // re-enters settings.mutate.
  await storeAlternateCredential(api, 'BACKUP_KEY', 'secret-value')
  assert.equal(calls.length, 2)
})
