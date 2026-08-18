import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import SettingsProvider, { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { resolveProfiles } from '../src/config.js'
import type { PiAiProviderProfile } from '../src/config.js'
import { applyMultiKeyProvider } from '../src/provider/index.js'

const NS = settingsNamespace('multikey-provider')

class MemorySettingsProvider extends SettingsProvider {
  readonly writable = true
  protected async load(): Promise<Record<string, unknown>> {
    return {}
  }
  protected async persist(): Promise<void> {}
}

class ForeignAdapter extends LlmAdapter {
  override async * stream(): AsyncIterable<never> {
    const empty: readonly never[] = []
    for (const value of empty) yield value
    throw new Error('foreign adapter must never stream')
  }
}

test('catalog providers preserve their official route and model catalog', () => {
  const profile = resolveProfiles({
    openaiPool: {
      sourceProvider: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
    },
  }).get('openaiPool')
  assert.equal(profile?.provider, 'openaiPool')
  assert.equal(profile?.sourceProvider, 'openai')
  assert.equal(profile?.displayName, 'openaiPool')
  assert.equal(profile?.declared, true)
  assert.equal((profile?.piProvider.getModels().length ?? 0) > 0, true)
})

test('plugin owns only multikey-provider namespace and never claims llm-pi-ai', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettingsProvider)
    await ctx.plugin({
      name: 'test-multikey-provider-namespace',
      inject: ['llm'],
      apply(pluginCtx: Context) {
        applyMultiKeyProvider(pluginCtx, { providers: { openaiPool: { sourceProvider: 'openai' } } })
      },
    })

    const nsNames = ctx.settings.describe({}).map(view => view.ns)
    assert.equal(nsNames.includes(NS), true)
    assert.equal(nsNames.includes(settingsNamespace('llm-pi-ai')), false)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('pool routes coexist with official routes instead of replacing them', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettingsProvider)
    // Official provider owns the catalog route.
    ctx.llm.registerAdapter(['openai'], new ForeignAdapter())
    await ctx.plugin({
      name: 'test-multikey-provider-coexist',
      inject: ['llm'],
      apply(pluginCtx: Context) {
        applyMultiKeyProvider(pluginCtx, { providers: { openaiPool: { sourceProvider: 'openai' } } })
      },
    })

    const routes = ctx.llm.listProviders().map(provider => provider.id).sort()
    assert.deepEqual(routes, ['openai', 'openaiPool'])
  } finally {
    await ctx.fiber.dispose()
  }
})

test('custom endpoint profiles use the same provider compiler', () => {
  const profile = resolveProfiles({
    customPool: {
      sourceProvider: 'custom-source',
      displayName: 'Custom Gateway',
      apiKeyEnv: 'CUSTOM_API_KEY',
      api: 'openai-responses',
      baseURL: 'https://gateway.example/v1',
      models: [{ id: 'custom-model', name: 'Custom Model', contextWindow: 16384, maxTokens: 4096 }],
    },
  }).get('customPool')
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

test('a conflicting route is rejected before settings publish or runtime ownership changes', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettingsProvider)
    ctx.llm.registerAdapter(['anthropic'], new ForeignAdapter())
    let handle: ReturnType<typeof applyMultiKeyProvider> | undefined
    await ctx.plugin({
      name: 'test-multikey-provider',
      inject: ['llm'],
      apply(pluginCtx: Context) {
        handle = applyMultiKeyProvider(pluginCtx, { providers: { openai: {} } })
      },
    })

    await assert.rejects(
      ctx.settings.update(NS, { providers: { openai: {}, anthropic: {} } }),
      /provider route "anthropic" is owned by another adapter/u,
    )
    assert.deepEqual(ctx.llm.listProviders().map(provider => provider.id).sort(), ['anthropic', 'openai'])
    assert.deepEqual(Object.keys(handle?.current().providers ?? {}), ['openai'])
    assert.deepEqual(Object.keys((ctx.settings.get(NS) as { providers?: object }).providers ?? {}), ['openai'])
  } finally {
    await ctx.fiber.dispose()
  }
})

test('a valid settings activation publishes route, directory, and snapshot together', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettingsProvider)
    let handle: ReturnType<typeof applyMultiKeyProvider> | undefined
    await ctx.plugin({
      name: 'test-multikey-provider-valid-activation',
      inject: ['llm'],
      apply(pluginCtx: Context) {
        handle = applyMultiKeyProvider(pluginCtx, { providers: { openai: {} } })
      },
    })

    await ctx.settings.update(NS, {
      providers: {
        openai: {
          displayName: 'OpenAI Pool',
          retryPolicy: { mode: 'normal', maxRetries: 0 },
        },
        gateway: {
          displayName: 'Gateway',
          apiKeyEnv: 'GATEWAY_KEY',
          api: 'openai-responses',
          baseURL: 'https://gateway.example/v1',
          models: [{ id: 'gateway-model' }],
        },
      },
    })

    assert.deepEqual(ctx.llm.listProviders().map(provider => provider.id).sort(), ['gateway', 'openai'])
    assert.equal(ctx.llm.listProviders().find(provider => provider.id === 'openai')?.name, 'OpenAI Pool')
    const retryPolicy = ctx.llm.providerRetryPolicy('openai')
    assert.equal(retryPolicy.mode, 'normal')
    assert.equal(retryPolicy.mode === 'normal' ? retryPolicy.maxRetries : undefined, 0)
    assert.equal(ctx.llm.listProviders().find(provider => provider.id === 'gateway')?.name, 'Gateway')
    const directory = ctx.llm.listConfigurableProviders()
      .filter(entry => entry.settingsNs === NS)
      .map(entry => entry.provider)
    assert.equal(directory.includes('gateway'), true)
    assert.equal(directory.includes('openai'), true)
    assert.deepEqual(Object.keys(handle?.current().providers ?? {}).sort(), ['gateway', 'openai'])
    assert.deepEqual(Object.keys((ctx.settings.get(NS) as { providers?: object }).providers ?? {}).sort(), ['gateway', 'openai'])
  } finally {
    await ctx.fiber.dispose()
  }
})

test('a conflicting configurable directory is rejected before route publication', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettingsProvider)
    ctx.llm.registerConfigurableProviders([{
      provider: 'collision',
      displayName: 'Foreign collision',
      settingsNs: 'foreign',
      settingsPath: ['providers', 'collision'],
      declared: true,
    }])
    let handle: ReturnType<typeof applyMultiKeyProvider> | undefined
    await ctx.plugin({
      name: 'test-multikey-provider-directory',
      inject: ['llm'],
      apply(pluginCtx: Context) {
        handle = applyMultiKeyProvider(pluginCtx, { providers: { openai: {} } })
      },
    })

    await assert.rejects(
      ctx.settings.update(NS, {
        providers: {
          openai: {},
          collision: {
            apiKeyEnv: 'COLLISION_KEY',
            api: 'openai-responses',
            baseURL: 'https://gateway.example/v1',
            models: [{ id: 'collision-model' }],
          },
        },
      }),
      /configurable provider "collision" is owned by another adapter/u,
    )
    assert.deepEqual(ctx.llm.listProviders().map(provider => provider.id).sort(), ['openai'])
    assert.deepEqual(Object.keys(handle?.current().providers ?? {}), ['openai'])
    assert.deepEqual(Object.keys((ctx.settings.get(NS) as { providers?: object }).providers ?? {}), ['openai'])
  } finally {
    await ctx.fiber.dispose()
  }
})
