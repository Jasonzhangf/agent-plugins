import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Model, Api, ModelThinkingLevel } from '@earendil-works/pi-ai'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { OfficialDerivedPiAiAdapter } from '../src/adapter.js'
import type { PiAiSnapshot } from '../src/adapter.js'
import { resolveProfiles } from '../src/config.js'
import type { ResolvedPiAiProviderProfile } from '../src/config.js'

type Attempt = readonly StreamChunk[] | Error

function finish(code?: string): StreamChunk {
  return code === undefined
    ? { type: 'finish', reason: { kind: 'stop' } }
    : { type: 'finish', reason: { kind: 'error', failure: { code, message: code } } }
}

function poolProfile(maxAttempts = 2): ReadonlyMap<string, ResolvedPiAiProviderProfile> {
  return resolveProfiles({
    test: {
      apiKeyEnv: 'PRIMARY_KEY',
      api: 'openai-completions',
      baseURL: 'https://test.example/v1',
      models: [{ id: 'model', contextWindow: 4096, maxTokens: 1024 }],
      apiKeyPool: {
        keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY', priority: 1 }],
        maxAttempts,
      },
    },
  })
}

class TestAdapter extends OfficialDerivedPiAiAdapter {
  readonly attempts: Attempt[]
  readonly selected: string[] = []
  readonly seenOptions: GenerateOptions[] = []

  constructor(attempts: Attempt[], profiles = poolProfile()) {
    super({
      profiles: () => profiles,
      resolveApiKey: async () => 'single-secret',
      resolveAttemptCredential: async (_provider, ref) => {
        this.selected.push(ref)
        if (ref === 'MISSING_KEY') throw new LlmError('missing', 'MISSING_CREDENTIAL')
        return `${ref}-secret`
      },
      probeCredential: async () => undefined,
    })
    this.attempts = [...attempts]
  }

  override async * streamAttempt(
    _snapshot: PiAiSnapshot,
    options: GenerateOptions,
    _profile: ResolvedPiAiProviderProfile,
    _model: Model<Api>,
    _reasoning: ModelThinkingLevel | undefined,
    _apiKey: string | undefined,
  ): AsyncIterable<StreamChunk> {
    this.seenOptions.push(options)
    const attempt = this.attempts.shift()
    if (attempt instanceof Error) throw attempt
    for (const chunk of attempt ?? []) yield chunk
  }
}

function request(): GenerateOptions {
  return { provider: 'test', model: 'model', messages: [] }
}

async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const result: StreamChunk[] = []
  for await (const chunk of iterable) result.push(chunk)
  return result
}

test('eligible pre-output account failure advances and hides failed chunks', async () => {
  const adapter = new TestAdapter([
    [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 0 } }, finish('AUTH')],
    [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }, finish()],
  ])
  const chunks = await collect(adapter.stream(request()))
  assert.deepEqual(adapter.selected, ['PRIMARY_KEY', 'BACKUP_KEY'])
  assert.deepEqual(chunks, [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }, finish()])
  assert.deepEqual(adapter.getPools().get('test')?.view().get('primary'), {
    state: 'open',
    consecutiveFailures: 1,
    lastFailureAt: adapter.getPools().get('test')?.view().get('primary')?.lastFailureAt,
    lastCode: 'AUTH',
    probeRequired: true,
  })
})

test('thrown credential failure advances before business output', async () => {
  const adapter = new TestAdapter([
    new LlmError('invalid', 'INVALID_CREDENTIAL'),
    [finish()],
  ])
  const chunks = await collect(adapter.stream(request()))
  assert.deepEqual(adapter.selected, ['PRIMARY_KEY', 'BACKUP_KEY'])
  assert.deepEqual(chunks, [finish()])
})

test('business output commits the attempt and forbids a second key', async () => {
  const output: StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'partial' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'partial' } },
    finish('AUTH'),
  ]
  const adapter = new TestAdapter([output, [finish()]])
  assert.deepEqual(await collect(adapter.stream(request())), output)
  assert.deepEqual(adapter.selected, ['PRIMARY_KEY'])
  assert.equal(adapter.getPools().get('test')?.view().get('primary')?.state, 'healthy')
})

test('server, timeout, transport, abort, and unknown failures never switch', async () => {
  for (const code of ['SERVER', 'TIMEOUT', 'TRANSPORT', 'ABORTED', 'UNKNOWN']) {
    const adapter = new TestAdapter([[finish(code)], [finish()]])
    const chunks = await collect(adapter.stream(request()))
    assert.deepEqual(adapter.selected, ['PRIMARY_KEY'])
    assert.deepEqual(chunks, [finish(code)])
  }
})

test('exhaustion preserves the final original terminal failure', async () => {
  const adapter = new TestAdapter([[finish('AUTH')], [finish('QUOTA')]])
  assert.deepEqual(await collect(adapter.stream(request())), [finish('QUOTA')])
})

test('exhaustion preserves the final thrown account error', async () => {
  const final = new LlmError('last credential failure', 'INVALID_CREDENTIAL')
  const adapter = new TestAdapter([new LlmError('first', 'AUTH'), final])
  await assert.rejects(collect(adapter.stream(request())), error => error === final)
})

test('pool control state never enters GenerateOptions or StreamChunk', async () => {
  const input = request()
  const adapter = new TestAdapter([[finish()]])
  const chunks = await collect(adapter.stream(input))
  assert.equal(adapter.seenOptions[0], input)
  const serialized = JSON.stringify({ input, chunks })
  for (const marker of ['keyId', 'credentialRef', 'health', 'attempt']) {
    assert.equal(serialized.includes(marker), false)
  }
})

test('profile without apiKeyPool follows the official single-key path', async () => {
  const profiles = resolveProfiles({
    test: {
      apiKeyEnv: 'PRIMARY_KEY',
      api: 'openai-completions',
      baseURL: 'https://test.example/v1',
      models: [{ id: 'model', contextWindow: 4096, maxTokens: 1024 }],
    },
  })
  const adapter = new TestAdapter([[finish()]], profiles)
  assert.deepEqual(await collect(adapter.stream(request())), [finish()])
  assert.deepEqual(adapter.selected, [])
  assert.equal(adapter.getPools().size, 0)
})

test('probe uses one exact key and returns a redacted projection', async () => {
  let probeKey = ''
  const adapter = new OfficialDerivedPiAiAdapter({
    profiles: () => poolProfile(),
    resolveApiKey: async () => 'unused',
    resolveAttemptCredential: async (_provider, ref) => `${ref}-secret`,
    probeCredential: async (_provider, _profile, apiKey) => { probeKey = apiKey },
  })
  const result = await adapter.probeKey('test', 'backup')
  assert.equal(probeKey, 'BACKUP_KEY-secret')
  assert.equal(result.status, 'ok')
  assert.equal(JSON.stringify(result).includes('secret'), false)
})

test('adapter cools an auth-failed key immediately and requires probe recovery', async () => {
  const profiles = resolveProfiles({
    test: {
      apiKeyEnv: 'PRIMARY_KEY',
      api: 'openai-completions',
      baseURL: 'https://test.example/v1',
      models: [{ id: 'model', contextWindow: 4096, maxTokens: 1024 }],
      apiKeyPool: {
        keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY', priority: 1 }],
        maxAttempts: 1,
        health: { failureThreshold: 3, openCircuitMs: 60000 },
      },
    },
  })
  const adapter = new TestAdapter([[finish('AUTH')]], profiles)
  await collect(adapter.stream(request()))
  assert.equal(adapter.getPools().get('test')?.view().get('primary')?.state, 'open')
  assert.equal(adapter.getPools().get('test')?.view().get('primary')?.probeRequired, true)
})

test('adapter advances through every eligible key before returning the final account failure', async () => {
  const profiles = resolveProfiles({
    test: {
      apiKeyEnv: 'PRIMARY_KEY',
      api: 'openai-completions',
      baseURL: 'https://test.example/v1',
      models: [{ id: 'model', contextWindow: 4096, maxTokens: 1024 }],
      apiKeyPool: {
        keys: [
          { id: 'k2', credentialRef: 'K2_KEY', priority: 1 },
          { id: 'k3', credentialRef: 'K3_KEY', priority: 2 },
          { id: 'k4', credentialRef: 'K4_KEY', priority: 3 },
          { id: 'k5', credentialRef: 'K5_KEY', priority: 4 },
          { id: 'k6', credentialRef: 'K6_KEY', priority: 5 },
          { id: 'k7', credentialRef: 'K7_KEY', priority: 6 },
        ],
        maxAttempts: 7,
      },
    },
  })
  const final = finish('AUTH')
  const adapter = new TestAdapter(
    [[final], [final], [final], [final], [final], [final], [final]],
    profiles,
  )
  assert.deepEqual(await collect(adapter.stream(request())), [final])
  assert.deepEqual(adapter.selected, ['PRIMARY_KEY', 'K2_KEY', 'K3_KEY', 'K4_KEY', 'K5_KEY', 'K6_KEY', 'K7_KEY'])
})
