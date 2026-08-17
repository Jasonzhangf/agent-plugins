import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveProfiles } from '../src/config.js'
import type { PiAiProviderProfile } from '../src/config.js'

test('catalog providers preserve their official route and model catalog', () => {
  const profile = resolveProfiles({ openai: { apiKeyEnv: 'OPENAI_API_KEY' } }).get('openai')
  assert.equal(profile?.provider, 'openai')
  assert.equal(profile?.displayName, 'openai')
  assert.equal((profile?.piProvider.getModels().length ?? 0) > 0, true)
})

test('custom endpoint profiles use the same provider compiler', () => {
  const profile = resolveProfiles({
    custom: {
      displayName: 'Custom Gateway',
      apiKeyEnv: 'CUSTOM_API_KEY',
      api: 'openai-responses',
      baseURL: 'https://gateway.example/v1',
      models: [{ id: 'custom-model', name: 'Custom Model', contextWindow: 16384, maxTokens: 4096 }],
    },
  }).get('custom')
  assert.equal(profile?.piProvider.baseUrl, 'https://gateway.example/v1')
  assert.deepEqual(profile?.piProvider.getModels().map(model => model.id), ['custom-model'])
})

test('removed route fields and duplicate model ids fail explicitly', () => {
  const removed = { apiKeyEnv: 'KEY', provider: 'legacy' } as unknown as PiAiProviderProfile
  assert.throws(() => resolveProfiles({ bad: removed }), /sets "provider"/u)
  assert.throws(() => resolveProfiles({
    bad: {
      apiKeyEnv: 'KEY',
      api: 'openai-completions',
      baseURL: 'https://gateway.example/v1',
      models: [{ id: 'same' }, { id: 'same' }],
    },
  }), /more than once/u)
})
