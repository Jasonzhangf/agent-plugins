import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config, assertServiceable, resolveProfiles } from '../src/config.js'

test('Config keeps apiKeyPool absent for an official single-key profile', () => {
  const config = Config({
    providers: {
      openai: { apiKeyEnv: 'OPENAI_API_KEY' },
    },
  })
  assert.equal(config.providers?.openai?.apiKeyPool, undefined)
  assert.deepEqual(config.providers?.openai?.defaultInput, ['text'])
})

test('resolveProfiles compiles a valid custom route and immutable key pool', () => {
  const profiles = resolveProfiles({
    custom: {
      displayName: 'Custom',
      apiKeyEnv: 'CUSTOM_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://custom.example/v1',
      models: [{ id: 'custom-model', contextWindow: 8192, maxTokens: 2048 }],
      apiKeyPool: {
        mode: 'weighted',
        primary: { weight: 3 },
        keys: [{ id: 'backup', credentialRef: 'CUSTOM_BACKUP_KEY', weight: 1 }],
        maxAttempts: 2,
      },
    },
  })
  const profile = profiles.get('custom')
  assert.equal(profile?.displayName, 'Custom')
  assert.equal(profile?.piProvider.getModels()[0]?.id, 'custom-model')
  assert.equal(profile?.apiKeyPool?.keys[0]?.id, 'primary')
  assert.equal(profile?.apiKeyPool?.keys[1]?.credentialRef, 'CUSTOM_BACKUP_KEY')
  assert.equal(Object.isFrozen(profile?.apiKeyPool), true)
})

test('settings validation rejects invalid pool identities and policy', () => {
  const base = {
    apiKeyEnv: 'PRIMARY_KEY',
    api: 'openai-completions',
    baseURL: 'https://custom.example/v1',
    models: [{ id: 'model', contextWindow: 4096, maxTokens: 1024 }],
  }
  assert.throws(() => assertServiceable({
    providers: { bad: { ...base, apiKeyPool: { keys: [{ id: 'primary', credentialRef: 'BACKUP_KEY' }] } } },
  }), /invalid or reserved/u)
  assert.throws(() => assertServiceable({
    providers: { bad: { ...base, apiKeyPool: { keys: [
      { id: 'backup', credentialRef: 'BACKUP_KEY' },
      { id: 'backup', credentialRef: 'OTHER_KEY' },
    ] } } },
  }), /repeats alternate key id/u)
  assert.throws(() => assertServiceable({
    providers: { bad: { ...base, apiKeyPool: { keys: [
      { id: 'backup', credentialRef: 'BACKUP_KEY' },
      { id: 'other', credentialRef: 'BACKUP_KEY' },
    ] } } },
  }), /repeats credential reference/u)
  assert.throws(() => assertServiceable({
    providers: { bad: { ...base, apiKeyPool: {
      primary: { enabled: false },
      keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY', enabled: false }],
    } } },
  }), /no enabled credential/u)
  assert.throws(() => assertServiceable({
    providers: { bad: { ...base, apiKeyPool: {
      keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY' }],
      maxAttempts: 3,
    } } },
  }), /maxAttempts/u)
})

test('a pool requires the official primary apiKeyEnv reference', () => {
  assert.throws(() => resolveProfiles({
    custom: {
      api: 'openai-completions',
      baseURL: 'https://custom.example/v1',
      models: [{ id: 'model', contextWindow: 4096, maxTokens: 1024 }],
      apiKeyPool: { keys: [] },
    },
  }), /requires apiKeyEnv/u)
})
