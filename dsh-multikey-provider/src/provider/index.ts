/**
 * Generic pi-ai-backed LLM adapter plugin. One plugin instance owns a dict of
 * provider routes; a route naming an installed pi-ai provider inherits that
 * provider's endpoint, protocol, and model catalog as defaults, and a route
 * pi-ai does not ship is declared outright. Profile facts resolve per request
 * over the optional `llm-pi-ai` user-settings section and the optional
 * credential seam, so a changed key, endpoint, model, or knob reaches the next
 * request without a restart; a changed *route set* (or a route's
 * registration-captured retry policy) re-registers the same adapter instance
 * in place.
 *
 * ```yaml
 * - id: llm
 *   name: '@deepseek-ai/dsh-llm-pi-ai'
 *   config:
 *     providers:
 *       # Catalog route: everything but the credential comes from pi-ai.
 *       openai:
 *         apiKeyEnv: OPENAI_API_KEY
 *         retryPolicy:
 *           mode: normal
 *           maxRetries: 2
 *       # Catalog route with the catalog narrowed and one capacity corrected.
 *       anthropic:
 *         apiKeyEnv: ANTHROPIC_API_KEY
 *         models:
 *           - id: claude-sonnet-4-5
 *             contextWindow: 200000
 *       # Hand-declared route: pi-ai ships nothing under this key.
 *       acme-gateway:
 *         displayName: Acme Gateway
 *         apiKeyEnv: ACME_GATEWAY_API_KEY
 *         api: openai-completions
 *         baseURL: https://gateway.acme.example/v1
 *         # Reasoning dialect for a URL pi-ai cannot recognize.
 *         compat:
 *           thinkingFormat: deepseek
 *         models:
 *           - id: acme-large
 *             name: Acme Large
 *             contextWindow: 65536
 *             maxTokens: 4096
 *           - id: acme-think
 *             name: Acme Think
 *             contextWindow: 262144
 *             maxTokens: 32768
 *             # key = selectable level, value = wire spelling; only off may
 *             # leave the value empty (supported, send nothing).
 *             reasoningEfforts:
 *               off:
 *               high: high
 *               max: ultra
 * ```
 *
 * @module @deepseek-ai/dsh-llm-pi-ai
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { OfficialDerivedPiAiAdapter } from '../adapter.ts'
import { assertServiceable, Config, resolveProfiles } from '../config.ts'
import type { ResolvedPiAiProviderProfile } from '../config.ts'
import { resolveAttemptCredential } from '../credential.ts'
import { discoverModels } from './discovery.ts'
import { mapStopReason } from './stream.ts'

export { OfficialDerivedPiAiAdapter, OfficialDerivedPiAiAdapter as PiAiAdapter } from '../adapter.ts'
export type { PiAiAdapterOptions } from '../adapter.ts'
export { Config } from '../config.ts'
export type {
  PiAiCompatProfile,
  PiAiModality,
  PiAiModelOverride,
  PiAiModelProfile,
  PiAiProviderProfile,
  PiAiReasoningEfforts,
  PiAiThinkingFormat,
  ResolvedPiAiProviderProfile,
} from '../config.ts'
export { supportedProtocols } from './provider.ts'

const NS = settingsNamespace('multikey-provider')

/**
 * The registry captures these per route; a change here must re-register.
 * Sorted by provider so a settings document that merely reorders its keys is
 * not mistaken for a route change.
 */
function registrationFacts(profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>): unknown {
  return [...profiles.entries()]
    // `displayName` rides along because the registry hands it to every selector
    // through `providerInfo()`: a rename that did not re-register would leave
    // the old label showing until some unrelated fact happened to change.
    .map(([provider, profile]) => ({
      provider,
      displayName: profile.displayName,
      retryPolicy: profile.retryPolicy,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

/**
 * The configurable-provider directory contains only the pool routes this
 * plugin owns. Official catalog routes remain visible through the official
 * provider entry and are never duplicated here.
 *
 * The profile half is unconditional, which is what keeps a route already
 * stored against a withheld provider editable and deletable rather than
 * stranded in the settings document with nothing on the page to remove it.
 * @param profiles - the currently resolved provider profiles.
 * @returns the directory entries in catalog order, declared routes last.
 */
function directoryEntries(
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
): LlmConfigurableProvider[] {
  const entries = new Map<string, LlmConfigurableProvider>()
  const declare = (provider: string, profile: ResolvedPiAiProviderProfile): void => {
    entries.set(provider, {
      provider,
      displayName: profile.displayName,
      settingsNs: NS,
      settingsPath: ['providers', provider],
      declared: profile.declared,
    })
  }
  for (const [provider, profile] of profiles) declare(provider, profile)
  return [...entries.values()]
}

/** Register one generic pi-ai adapter for all configured provider routes. */
export interface MultiKeyProviderHandle {
  readonly adapter: OfficialDerivedPiAiAdapter
  readonly current: () => Config
  readonly profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>
}

export function applyMultiKeyProvider(ctx: Context, config: Config): MultiKeyProviderHandle {
  let source: () => Config = () => config
  let activeConfig = config
  let activeProfiles = resolveProfiles(config.providers)
  let activationProfiles: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => activationProfiles ?? activeProfiles

  const resolveApiKey = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    const ref = profile.apiKeyEnv
    // Only a profile that names no credential at all defers to pi-ai's
    // provider-native discovery. Once one is named, a miss must fail loud:
    // handing pi-ai `undefined` would let it pick up an unrelated ambient key
    // (OPENAI_API_KEY and friends), billing another tenant for a request the
    // deployment meant to authenticate differently.
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      // Without the seam the environment is the whole credential plane.
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'multikey-provider', ref)
    throw new LlmError(
      `multikey-provider: no credential for provider route "${provider}"; its profile resolves ${ref}, which is not`
      + ` set — store ${ref} through the credentials service (the web Models page writes it) or export it,`
      + ' and remove apiKeyEnv only if this provider should authenticate from pi-ai\'s own environment discovery',
      'MISSING_CREDENTIAL',
    )
  }

  const adapter = new OfficialDerivedPiAiAdapter({
    profiles,
    resolveApiKey,
    resolveAttemptCredential: (provider, ref) => resolveAttemptCredential(ctx, ref),
    probeCredential: async (_provider, profile, apiKey, signal) => {
      const model = profile.piProvider.getModels()[0]
      if (model === undefined) throw new LlmError('multikey-provider: provider has no model available for probe', 'UNKNOWN_MODEL')
      const events = profile.piProvider.streamSimple(model, {
        messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }],
      }, {
        apiKey,
        maxTokens: 8,
        maxRetries: 0,
        ...signal === undefined ? {} : { signal },
      })
      for await (const event of events) {
        if (event.type === 'error') {
          const reason = mapStopReason(event.error, model.contextWindow)
          if (reason.kind === 'error' || reason.kind === 'aborted') {
            throw new LlmError(reason.failure.message, reason.failure.code)
          }
        }
        if (event.type === 'done') return
      }
      throw new LlmError('multikey-provider: probe stream ended without a terminal event', 'STREAM_CLOSED')
    },
    resolveAttachments: () => ctx.get('attachments'),
  })
  // The full installed catalog is configurable from the moment the plugin
  // mounts — dormant or not — so configuration surfaces can offer every
  // pi-ai provider before any route exists. Hand-declared routes join it as
  // profiles appear, and leave with them.
  let directory: DirectoryRegistrationHandle | undefined
  let activeDirectoryEntries: readonly LlmConfigurableProvider[] = []
  const replaceDirectory = (entries: readonly LlmConfigurableProvider[]): boolean => {
    if (deepEqualJson(entries, activeDirectoryEntries)) return false
    // The candidate set is validated before this commit. The public handle's
    // replace operation validates again and throws before mutating on drift.
    if (directory === undefined) {
      directory = ctx.llm.registerConfigurableProviders(entries)
    } else {
      directory.replace(entries)
    }
    activeDirectoryEntries = [...entries]
    return true
  }
  replaceDirectory(directoryEntries(activeProfiles))
  /**
   * The credential a named route already resolves, for an interrogation whose
   * draft carries none. A route being declared for the first time names no
   * profile yet, and a profile that names no credential defers to pi-ai's own
   * discovery, so both answer `undefined` and the endpoint is asked
   * unauthenticated — the same posture a request to that route would take.
   */
  const storedApiKey = async (provider: string | undefined): Promise<string | undefined> => {
    if (provider === undefined) return undefined
    const profile = profiles().get(provider)
    if (profile === undefined) return undefined
    return resolveApiKey(provider, profile)
  }
  // Interrogating an endpoint is a configuration-time action over a draft, so
  // it is offered for the whole namespace rather than per route: the provider
  // a surface is adding does not exist yet. The draft is the whole request
  // except the credential: a configuration surface edits a redacted descriptor
  // and never holds a stored secret, so an already-configured route supplies
  // its own here rather than being interrogated unauthenticated.
  ctx.llm.registerModelDiscovery(NS, request => discoverModels(request, () => storedApiKey(request.provider)))
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below. A bare
  // mount (zero routes) is the dormant posture: nothing registers until a
  // settings section supplies profiles, and routes drop when it empties.
  let registration: AdapterRegistrationHandle | undefined
  let activeRegistrationFacts = registrationFacts(activeProfiles)
  let activeRoutes = [...activeProfiles.keys()]
  const replaceRegistration = (
    nextProfiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
  ): void => {
    const facts = registrationFacts(nextProfiles)
    if (deepEqualJson(facts, activeRegistrationFacts)) return
    // The registry captures the route set and each route's retry policy at
    // registration, so a change to either must re-register. The swap is
    // atomic (same adapter instance, validated before anything moves): a
    // conflicting route leaves the previous routes serving requests, and
    // `registeredFacts` only advances once the registry actually holds the
    // new set — so returning to a working configuration always re-applies.
    const routes = [...nextProfiles.keys()]
    if (registration === undefined) {
      // Dormant bare mount: nothing is registered until a section supplies
      // profiles, and an empty section keeps it that way.
      if (routes.length === 0) {
        activeRegistrationFacts = facts
        activeRoutes = routes
        return
      }
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    activeRegistrationFacts = facts
    activeRoutes = routes
  }
  if (activeRoutes.length > 0) {
    registration = ctx.llm.registerAdapter(activeRoutes, adapter)
  }

  const validateRegistryOwnership = (candidate: Config): void => {
    assertServiceable(candidate)
    const candidateProfiles = resolveProfiles(candidate.providers)
    const ownedRoutes = new Set(activeRoutes)
    const externalRoutes = new Set(
      ctx.llm.listProviders().map(provider => provider.id).filter(provider => !ownedRoutes.has(provider)),
    )
    for (const route of candidateProfiles.keys()) {
      if (externalRoutes.has(route)) {
        throw new LlmError(`multikey-provider: provider route "${route}" is owned by another adapter`, 'DUPLICATE_ADAPTER')
      }
    }

    const ownedDirectory = new Set(activeDirectoryEntries.map(entry => entry.provider))
    const externalDirectory = new Set(
      ctx.llm.listConfigurableProviders()
        .map(entry => entry.provider)
        .filter(provider => !ownedDirectory.has(provider)),
    )
    for (const entry of directoryEntries(candidateProfiles)) {
      if (externalDirectory.has(entry.provider)) {
        throw new LlmError(
          `multikey-provider: configurable provider "${entry.provider}" is owned by another adapter`,
          'DUPLICATE_DIRECTORY',
        )
      }
    }
  }

  const validateActivationCandidate = (candidate: Config): {
    profiles: Map<string, ResolvedPiAiProviderProfile>
    directoryEntries: LlmConfigurableProvider[]
  } => {
    validateRegistryOwnership(candidate)
    const profiles = resolveProfiles(candidate.providers)
    const entries = directoryEntries(profiles)
    // Both public registry handles validate their full candidate before they
    // mutate. Re-check the exact directory and route metadata here so the
    // activation boundary has no second discovery path between validation and
    // the two synchronous registry commits.
    for (const route of profiles.keys()) {
      const info = adapter.providerInfo(route)
      if (info.id !== route || info.name.length === 0) {
        throw new LlmError(`multikey-provider: invalid provider metadata for route "${route}"`, 'INVALID_ADAPTER')
      }
      adapter.providerRetryPolicy(route)
    }
    for (const entry of entries) {
      if (entry.provider.length === 0 || entry.displayName.length === 0 || entry.settingsNs.length === 0
        || entry.settingsPath.some(segment => segment.length === 0)) {
        throw new LlmError(`multikey-provider: invalid configurable provider metadata for "${entry.provider}"`, 'INVALID_DIRECTORY')
      }
    }
    return { profiles, directoryEntries: entries }
  }

  const activateSource = (): void => {
    const candidate = source()
    const prepared = validateActivationCandidate(candidate)
    // The public LLM handles validate candidates before mutation but capture
    // adapter metadata during their synchronous commit. Bind that metadata to
    // the accepted candidate before publishing either registry update;
    // otherwise a newly added route can be registered with the preceding
    // display name or retry policy.
    activationProfiles = prepared.profiles
    try {
      replaceRegistration(prepared.profiles)
      replaceDirectory(prepared.directoryEntries)
      activeConfig = candidate
      activeProfiles = prepared.profiles
    } finally {
      activationProfiles = undefined
    }
  }

  installSettingsSection(ctx, NS, Config, config, {
    // Refuse an unserviceable section where it is written: without this a
    // schema-valid profile the adapter cannot serve would be stored and then
    // silently disable every route in this namespace.
    validate: validateRegistryOwnership,
    setSource: (nextSource) => {
      source = nextSource
    },
    onChange: activateSource,
  })
  return { adapter, current: () => activeConfig, profiles }
}
