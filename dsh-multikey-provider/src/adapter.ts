/**
 * Generic pi-ai-backed implementation of the Harness LLM seam.
 *
 * Each resolution produces one **immutable** snapshot — the profiles plus a
 * `Models` collection holding the `Provider` each route built — and an
 * operation captures a whole snapshot before its first `await`. A
 * configuration change builds a *new* collection rather than mutating the one
 * in use, because `Models.streamSimple()` is lazy: it resolves the provider
 * when the stream is first consumed, which is after the credential await, so a
 * mutated collection would let a request that started under one configuration
 * finish under another — or fail with a provider that no longer exists. This is
 * what makes the seam's per-step call freeze (`llm.prepareCall()`) hold all the
 * way down: switching models mid-reply takes effect on the next step, never
 * inside the one in flight.
 *
 * Credentials stay outside that collection. The harness resolves a route's key
 * through its own seam and passes it as the request's `apiKey` option, which
 * pi-ai treats as the highest-priority auth override — so `Models` never holds
 * a credential store and the harness keeps its fail-loud reference semantics.
 *
 * @module dsh-llm-pi-ai/adapter
 */

import { createModels, getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import type {
  Api,
  Model,
  Models,
  ModelThinkingLevel,
  MutableModels,
  SimpleStreamOptions,
  ThinkingLevel,
} from '@earendil-works/pi-ai'
import {
  attributionHeaders,
  contentHasImage,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmFailure,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ReasoningEffortId as ReasoningEffortIdType,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { KeyPoolRuntime } from './key-pool.ts'
import type { AccountFailureCode } from './key-pool.ts'
import { toPiContext } from './provider/context.ts'
import { toStreamChunks } from './provider/stream.ts'

/** One resolution's frozen view: the profiles and the collection built from them. */
export interface PiAiSnapshot {
  /** The resolved profiles this collection was built from, used as its identity. */
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>
  /** Providers for exactly those profiles; never mutated once published. */
  models: Models
}

/** Constructor options for {@link PiAiAdapter}: the two resolution hooks the plugin owns. */
export interface PiAiAdapterOptions {
  /** Current validated profiles by provider route; called once per operation. */
  profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>
  /**
   * Resolve the credential for one already-resolved profile; called once per
   * stream call and frozen for that call. `undefined` defers to the route's own
   * pi-ai auth, which for an installed catalog route is its provider-native
   * ambient discovery; the plugin allows that only for a profile naming no
   * credential at all, because a named reference that misses throws `LlmError`
   * `MISSING_CREDENTIAL` rather than falling back.
   */
  resolveApiKey: (provider: string, profile: ResolvedPiAiProviderProfile) => Promise<string | undefined>
  /** Resolve one selected reference for one pool attempt. */
  resolveAttemptCredential: (provider: string, credentialRef: string) => Promise<string>
  /** Optional provider interrogation used by explicit loopback probes. */
  probeCredential: (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
    apiKey: string,
    signal?: AbortSignal,
  ) => Promise<void>
  /** Resolve the optional durable attachment service at request time. */
  resolveAttachments?: () => AttachmentStore | undefined
}

export interface ProbeResult {
  readonly route: string
  readonly keyId: string
  readonly status: 'ok' | 'error'
  readonly latencyMs: number
  readonly errorCode?: string
}

const SWITCHABLE_CODES: ReadonlySet<string> = new Set([
  'AUTH',
  'QUOTA',
  'RATE_LIMIT',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
])

/** Copy profile stream knobs into pi-ai's common option vocabulary. */
function profileOptions(
  profile: ResolvedPiAiProviderProfile,
  reasoning: ModelThinkingLevel | undefined,
  apiKey: string | undefined,
): SimpleStreamOptions {
  const enabledReasoning: ThinkingLevel | undefined = reasoning === 'off' ? undefined : reasoning
  return {
    ...apiKey === undefined ? {} : { apiKey },
    ...enabledReasoning === undefined ? {} : { reasoning: enabledReasoning },
    ...profile.thinkingBudgets === undefined ? {} : { thinkingBudgets: profile.thinkingBudgets },
    ...profile.cacheRetention === undefined ? {} : { cacheRetention: profile.cacheRetention },
    ...profile.transport === undefined ? {} : { transport: profile.transport },
    ...profile.timeoutMs === undefined ? {} : { timeoutMs: profile.timeoutMs },
    ...profile.websocketConnectTimeoutMs === undefined ? {} : { websocketConnectTimeoutMs: profile.websocketConnectTimeoutMs },
    // The agent recovery layer owns visible attempts; one adapter call is one SDK attempt.
    maxRetries: 0,
  }
}

/**
 * The profile default this exact model can actually take, for DESCRIBING it.
 * A configured level the model does not support yields none rather than
 * throwing: `resolveModel` builds the model catalog, and a catalog that fails
 * takes its whole provider out of every picker — so one mis-set profile field
 * would hide every model on the route, including the ones that support the
 * level. The request path still refuses, which is where a bad configuration
 * belongs: describing what a model can do must not fail because a deployment
 * asked it for something it cannot.
 * @param model - the resolved model descriptor.
 * @param effort - the profile's configured level, if any.
 * @returns the level when this model supports it, otherwise undefined.
 */
function describableReasoningLevel(
  model: Model<Api>,
  effort: ReasoningEffortIdType | ModelThinkingLevel | undefined,
): ModelThinkingLevel | undefined {
  if (effort === undefined) return undefined
  return getSupportedThinkingLevels(model).some(level => level === effort)
    ? effort as ModelThinkingLevel
    : undefined
}

/** Validate an explicit Harness/profile effort without invoking pi-ai's clamp. */
function resolveReasoningLevel(
  model: Model<Api>,
  effort: ReasoningEffortIdType | ModelThinkingLevel | undefined,
): ModelThinkingLevel | undefined {
  if (effort === undefined) return undefined
  const supported = getSupportedThinkingLevels(model)
  if (supported.some(level => level === effort)) return effort as ModelThinkingLevel
  throw new LlmError(
    `pi-ai provider "${model.provider}" model "${model.id}" does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/**
 * Selectable reasoning efforts for one model, or nothing at all.
 *
 * A model that carries no reasoning metadata — every hand-declared one, and
 * every catalog model pi-ai marks as non-reasoning — is reported by pi-ai as
 * supporting the single level `off`. Passing that through would offer a control
 * that cannot do what it says: `off` is translated to *omitting* the reasoning
 * option, which for such a model is byte-for-byte the same request as naming no
 * effort — so a provider whose own default is to think would keep thinking with
 * `off` selected. Omitting `reasoning` entirely is the seam's way of saying the
 * capability is unavailable, which leaves the surface offering only the
 * provider's default.
 * @param model - the resolved model descriptor.
 * @param defaultLevel - the profile's configured effort, already validated.
 * @returns the `reasoning` field, or an empty object when none can be offered.
 */
function reasoningInfo(
  model: Model<Api>,
  defaultLevel: ModelThinkingLevel | undefined,
): Pick<LlmResolvedModelInfo, 'reasoning'> | Record<string, never> {
  if (!model.reasoning) return {}
  const levels = getSupportedThinkingLevels(model)
  return {
    reasoning: {
      efforts: levels.map(level => ({
        id: ReasoningEffortId(level),
        name: `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
      })),
      ...defaultLevel === undefined ? {} : { defaultEffort: ReasoningEffortId(defaultLevel) },
    },
  }
}

/** Merge deployment headers while removing case-insensitive attribution collisions. */
function requestHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const attribution = attributionHeaders()
  const reserved = new Set(Object.keys(attribution).map(name => name.toLowerCase()))
  return {
    ...Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))),
    ...attribution,
  }
}

/**
 * pi-ai-backed multi-provider adapter. Each operation reads the current
 * profiles, so a configuration change reaches the next request without a
 * restart; model descriptors come from the collection those profiles built.
 */
export class OfficialDerivedPiAiAdapter extends LlmAdapter {
  private snapshot: PiAiSnapshot | undefined
  private readonly pools = new Map<string, KeyPoolRuntime>()

  constructor(private readonly config: PiAiAdapterOptions) {
    super()
  }

  /**
   * The snapshot for the current profiles. Resolution memoizes its result, so
   * an unchanged configuration is recognized by identity; a changed one gets a
   * brand-new collection, leaving any snapshot an operation already captured
   * untouched for as long as that operation holds it.
   */
  currentSnapshot(): PiAiSnapshot {
    const profiles = this.config.profiles()
    if (this.snapshot?.profiles === profiles) return this.snapshot
    this.syncPools(profiles)
    const models: MutableModels = createModels()
    for (const profile of profiles.values()) models.setProvider(profile.piProvider)
    this.snapshot = { profiles, models }
    return this.snapshot
  }

  /** Rebuild process-local pool runtimes whenever the provider profiles change. */
  private syncPools(profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>): void {
    const previous = this.pools
    const next = new Map<string, KeyPoolRuntime>()
    for (const [provider, profile] of profiles) {
      if (profile.apiKeyPool === undefined) continue
      next.set(provider, new KeyPoolRuntime(profile.apiKeyPool, { previous: previous.get(provider) }))
    }
    this.pools.clear()
    for (const [provider, runtime] of next) this.pools.set(provider, runtime)
  }

  /** The profile for one route within one snapshot, or the not-owned failure. */
  profileOf(snapshot: PiAiSnapshot, provider: string): ResolvedPiAiProviderProfile {
    const profile = snapshot.profiles.get(provider)
    if (profile === undefined) {
      throw new LlmError(`pi-ai adapter does not own provider "${provider}"`, 'NO_ADAPTER')
    }
    return profile
  }

  /** The configured descriptor for one exact route/model pair within one snapshot. */
  modelOf(snapshot: PiAiSnapshot, provider: string, model: string): Model<Api> {
    this.profileOf(snapshot, provider)
    const resolved = snapshot.models.getModel(provider, model)
    if (resolved === undefined) {
      throw new LlmError(`pi-ai provider "${provider}" has no configured model "${model}"`, 'UNKNOWN_MODEL')
    }
    return resolved
  }

  poolFor(provider: string): KeyPoolRuntime | undefined {
    return this.pools.get(provider)
  }

  getPools(): ReadonlyMap<string, KeyPoolRuntime> {
    return this.pools
  }

  override providerInfo(provider: string): LlmProviderInfo {
    // The configured name, not the route key: `displayName` exists so a
    // deployment can label a route, and a label only the configuration surface
    // reads would leave every selector showing the raw key.
    return { id: provider, name: this.currentSnapshot().profiles.get(provider)?.displayName ?? provider }
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.currentSnapshot().profiles.get(provider)?.retryPolicy
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve().then(() => {
      const snapshot = this.currentSnapshot()
      this.profileOf(snapshot, provider)
      return snapshot.models.getModels(provider).map(model => ({
        provider,
        id: model.id,
        name: model.name,
        inputModalities: [...model.input],
      }))
    })
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve().then(() => {
      const snapshot = this.currentSnapshot()
      const profile = this.profileOf(snapshot, provider)
      const resolvedModel = this.modelOf(snapshot, provider, model)
      const defaultLevel = describableReasoningLevel(resolvedModel, profile.reasoning)
      // Only a cap the deployment configured is a request default; the
      // catalog's `maxTokens` sizes the model and stops there.
      const configuredMaxTokens = profile.configuredMaxTokens.get(model)
      return {
        provider,
        id: model,
        name: resolvedModel.name,
        inputModalities: [...resolvedModel.input],
        context: { contextWindow: resolvedModel.contextWindow },
        ...configuredMaxTokens === undefined ? {} : { defaultMaxTokens: configuredMaxTokens },
        ...reasoningInfo(resolvedModel, defaultLevel),
      }
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const attempt = captureAttemptSnapshot(this, options)
    const pool = this.poolFor(attempt.profile.provider)
    if (pool === undefined) {
      const apiKey = await this.config.resolveApiKey(attempt.profile.provider, attempt.profile)
      yield* this.streamAttempt(attempt.snapshot, options, attempt.profile, attempt.model, attempt.reasoning, apiKey)
      return
    }

    const excluded = new Set<string>()
    const sessionId = options.sessionId === undefined ? undefined : String(options.sessionId)
    let lastAccountError: unknown
    let lastAccountChunks: readonly StreamChunk[] | undefined
    for (let index = 0; index < pool.maxAttempts; index++) {
      const key = pool.select(excluded, sessionId)
      if (key === undefined) break
      excluded.add(key.id)
      let apiKey: string
      try {
        apiKey = await this.config.resolveAttemptCredential(attempt.profile.provider, String(key.credentialRef))
      } catch (error) {
        const code = classifyAttemptError(error).code
        if (SWITCHABLE_CODES.has(code)) {
          pool.recordAttemptFailure(key.id, accountFailureCode(code), sessionId)
          lastAccountError = error
          lastAccountChunks = undefined
          if (index + 1 < pool.maxAttempts) continue
        } else {
          pool.release(key.id)
        }
        propagateAttemptError(error)
      }

      let buffer: StreamChunk[] = []
      let committed = false
      let terminalFailure: { code: string; failure: LlmFailure } | undefined
      try {
        for await (const chunk of this.streamAttempt(
          attempt.snapshot,
          options,
          attempt.profile,
          attempt.model,
          attempt.reasoning,
          apiKey,
        )) {
          buffer.push(chunk)
          if (chunk.type === 'block-start' && !committed) {
            committed = true
            for (const buffered of buffer) yield buffered
            buffer = []
          } else if (committed) {
            yield chunk
            buffer.pop()
          }
          const terminal = terminalResponse(chunk)
          if (terminal === undefined) continue
          if (terminal.kind === 'error') {
            terminalFailure = { code: terminal.code, failure: terminal.failure }
            break
          }
          break
        }
        if (terminalFailure === undefined) {
          pool.recordSuccess(key.id, sessionId)
          for (const buffered of buffer) yield buffered
          return
        }
        const { code } = terminalFailure
        if (!committed && SWITCHABLE_CODES.has(code)) {
          pool.recordAttemptFailure(key.id, accountFailureCode(code), sessionId)
          lastAccountChunks = buffer
          lastAccountError = undefined
          if (index + 1 < pool.maxAttempts) continue
        } else {
          pool.release(key.id)
        }
        for (const buffered of buffer) yield buffered
        return
      } catch (error) {
        if (options.signal?.aborted) {
          pool.release(key.id)
          propagateAttemptError(new LlmError('pi-ai request aborted by caller', 'ABORTED', { cause: error }))
        }
        const code = classifyAttemptError(error).code
        if (!committed && SWITCHABLE_CODES.has(code)) {
          pool.recordAttemptFailure(key.id, accountFailureCode(code), sessionId)
          lastAccountError = error
          lastAccountChunks = undefined
          if (index + 1 < pool.maxAttempts) continue
        } else {
          pool.release(key.id)
        }
        propagateAttemptError(error)
      }
    }
    if (lastAccountChunks !== undefined) {
      for (const chunk of lastAccountChunks) yield chunk
      return
    }
    if (lastAccountError !== undefined) propagateAttemptError(lastAccountError)
    throw new LlmError(
      `llm-pi-ai: no eligible API key for provider "${attempt.profile.provider}"`,
      'NO_ELIGIBLE_CREDENTIAL',
    )
  }

  /** One official-derived SDK attempt with one attempt-local credential. */
  async * streamAttempt(
    snapshot: PiAiSnapshot,
    options: GenerateOptions,
    profile: ResolvedPiAiProviderProfile,
    model: Model<Api>,
    reasoning: ModelThinkingLevel | undefined,
    apiKey: string | undefined,
  ): AsyncIterable<StreamChunk> {
    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    const streamIdleTimeoutMs = profile.streamIdleTimeoutMs
    using watchdog = idleWatchdog(upstream, streamIdleTimeoutMs, 'LLM_STREAM_IDLE_TIMEOUT')

    try {
      const containsImage = options.messages.some(message => contentHasImage(message.content))
      if (containsImage && !model.input.includes('image')) {
        throw new LlmError(`pi-ai model "${model.id}" does not support image input`, 'UNSUPPORTED_CONTENT')
      }
      const attachments = containsImage ? this.config.resolveAttachments?.() : undefined
      if (containsImage && attachments === undefined) {
        throw new LlmError('pi-ai image input requires the durable attachment service', 'UNSUPPORTED_CONTENT')
      }
      const context = attachments === undefined
        ? toPiContext(options)
        : await toPiContext(options, attachments)
      const events = snapshot.models.streamSimple(model, context, {
        ...profileOptions(profile, reasoning, apiKey),
        ...options.temperature === undefined ? {} : { temperature: options.temperature },
        ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
        ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
        signal: watchdog.signal,
        // Profile headers are deployment-owned; attribution names are
        // Harness-owned and therefore win collisions.
        headers: requestHeaders(profile.headers),
      })
      const iterator = toStreamChunks(events, model.contextWindow)[Symbol.asyncIterator]()
      let exhausted = false
      try {
        while (true) {
          const result = await watchdog.next(iterator)
          const timeout = timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT')
          if (timeout !== undefined) throw timeout
          if (result.done) {
            exhausted = true
            return
          }
          yield result.value
        }
      } finally {
        if (!exhausted) {
          consumer.abort('pi-ai stream consumer stopped')
          try {
            await iterator.return(undefined)
          } catch {
            // The stable signal already owns SDK termination; return-time abort cannot add an outcome.
          }
        }
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT') !== undefined) {
        throw new LlmError(`pi-ai stream idle timeout after ${streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted) {
        throw new LlmError('pi-ai request aborted by caller', 'ABORTED', { cause: error })
      }
      throw error
    } finally {
      consumer.abort('pi-ai stream consumer stopped')
    }
  }

  async probeKey(route: string, keyId: string): Promise<ProbeResult> {
    const profile = this.currentSnapshot().profiles.get(route)
    if (profile === undefined) throw new LlmError(`pi-ai adapter does not own provider "${route}"`, 'NO_ADAPTER')
    const pool = this.poolFor(route)
    if (pool === undefined) throw new LlmError(`provider "${route}" has no apiKeyPool`, 'NO_ELIGIBLE_CREDENTIAL')
    const key = pool.reserveExact(keyId) ?? (pool.probeTrial(keyId)
      ? pool.descriptor.keys.find(candidate => candidate.id === keyId)
      : undefined)
    if (key === undefined) throw new LlmError(`provider "${route}" key "${keyId}" is not probeable`, 'UNKNOWN_KEY')
    const started = Date.now()
    try {
      const apiKey = await this.config.resolveAttemptCredential(route, String(key.credentialRef))
      await this.config.probeCredential(route, profile, apiKey)
      pool.recordProbeSuccess(keyId)
      return { route, keyId, status: 'ok', latencyMs: Date.now() - started }
    } catch (error) {
      const code = classifyAttemptError(error).code
      if (SWITCHABLE_CODES.has(code)) pool.recordProbeFailure(keyId, accountFailureCode(code))
      else pool.release(keyId)
      return { route, keyId, status: 'error', latencyMs: Date.now() - started, errorCode: code }
    }
  }
}

/** One immutable request-local capture taken before the first await. */
export interface AttemptSnapshot {
  readonly snapshot: PiAiSnapshot
  readonly profile: ResolvedPiAiProviderProfile
  readonly model: Model<Api>
  readonly reasoning: ModelThinkingLevel | undefined
}

export function captureAttemptSnapshot(adapter: OfficialDerivedPiAiAdapter, options: GenerateOptions): AttemptSnapshot {
  if (options.stop !== undefined) {
    throw new LlmError('llm-pi-ai does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
  }
  const snapshot = adapter.currentSnapshot()
  const profile = adapter.profileOf(snapshot, options.provider)
  const model = adapter.modelOf(snapshot, options.provider, options.model)
  return {
    snapshot,
    profile,
    model,
    reasoning: resolveReasoningLevel(model, options.reasoningEffort ?? profile.reasoning),
  }
}

export function classifyAttemptError(error: unknown): { code: string } {
  if (error instanceof LlmError) return { code: error.code }
  if (error instanceof Error && typeof (error as Error & { code?: unknown }).code === 'string') {
    return { code: (error as Error & { code: string }).code }
  }
  return { code: 'UNKNOWN' }
}

export type TerminalResponse =
  | { readonly kind: 'success' }
  | { readonly kind: 'error'; readonly code: string; readonly failure: LlmFailure }

export function terminalResponse(chunk: StreamChunk): TerminalResponse | undefined {
  if (chunk.type !== 'finish') return undefined
  if (chunk.reason.kind === 'error') {
    return { kind: 'error', code: chunk.reason.failure.code, failure: chunk.reason.failure }
  }
  return { kind: 'success' }
}

export function propagateAttemptError(error: unknown): never {
  throw error
}

function accountFailureCode(code: string): AccountFailureCode {
  if (!SWITCHABLE_CODES.has(code)) throw new Error(`non-account failure code "${code}" cannot update key health`)
  return code as AccountFailureCode
}
