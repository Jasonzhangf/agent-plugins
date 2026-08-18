# Multi-Key Provider Detailed Design

Status: active

This document is the file-level, symbol-level, schema-level, and test-level
implementation instruction for `dsh-multikey-provider`. It describes the
additive plugin only and does not modify the official Provider.

## 1. Authoring Tree

The package is authored at `dsh-multikey-provider/` and built as
`dsh-multikey-provider`.

### Provider files

| File | Responsibility |
| --- | --- |
| `src/provider/index.ts` | plugin entry, `multikey-provider` settings namespace, pool route/directory registration, collision rejection |
| `src/provider/catalog.ts` | pi-ai catalog materialization with `sourceProvider` inheritance |
| `src/provider/context.ts` | DSH-to-pi-ai request conversion |
| `src/provider/discovery.ts` | model discovery over public LLM wire contract |
| `src/provider/provider.ts` | pi-ai provider construction |
| `src/provider/replay.ts` | replay projection |
| `src/provider/stream.ts` | stream translation |
| `src/config.ts` | pool profile schema and resolver |
| `src/adapter.ts` | single-key and pooled-route stream adapter |
| `src/key-pool.ts` | selection, reservation, health, and redacted status |
| `src/credential.ts` | one selected reference to one attempt-local credential |
| `src/control.ts` | loopback redacted probe and health control |
| `src/index.ts` | plugin entry shape |
| `src/invariant.ts` | package identity |

The plugin does not copy official Provider source and does not import the
official Provider package. It uses the same pi-ai catalog and DSH public
contracts as the official Provider.

### Models files

The client tree mirrors the official Models wire surface:

```text
src/client/
  apiKey.ts
  AlternateKeyPoolEditor.tsx
  CustomProviderCard.tsx
  DeepSeekModelsEditor.tsx
  DeepSeekOnboardingDialog.module.css
  DeepSeekOnboardingDialog.tsx
  EditorFooter.tsx
  index.ts
  locales.ts
  ModelListEditor.tsx
  ModelsSection.module.css
  ModelsSection.tsx
  OnboardingModal.module.css
  OnboardingModal.tsx
  pool-control.ts
  ProviderEditor.tsx
  store.ts
  welcome-store.ts
  WelcomeNotice.module.css
  WelcomeNotice.tsx
```

Allowed changes:

- `store.ts`: read all `llm.providers` and `settings.describe`, keep official
  rows unchanged, discriminate pool rows by `settingsNs === 'multikey-provider'`.
- `CustomProviderCard.tsx`: write custom pool routes into `multikey-provider`
  and include `sourceProvider` when a catalog backend is chosen.
- `ProviderEditor.tsx`: render alternate key and pool policy fields only for a
  configured pool row.
- `ModelsSection.tsx`: protocol choices and custom add revision come from the
  `multikey-provider` namespace.
- `locales.ts`: add pool labels without changing official copy.
- `ModelsSection.module.css`: add only pool block styles and reuse official
  variables, spacing, control, and responsive rules.
- `index.ts`: register `settings.section:models` and wire pool control RPC.

## 2. Runtime Symbols

### Composition

```text
cordis.patch.yml
  plugin additive insert: multikey-provider

installed Web profile overlay
  official Models exact-name disable: ui-settings-models
```

There is no `llm-pi-ai` patch. The headless profile has no Models target and
therefore receives only the bundle insertion without a skipped-patch warning.

### Provider entry

```ts
export const name = 'multikey-provider'
export const inject = ['llm']
export function apply(ctx: Context, config: Config = {}): void
```

The settings namespace is:

```ts
const NS = settingsNamespace('multikey-provider')
```

The official `llm-pi-ai` namespace is outside this plugin's ownership.

### Configuration

```ts
interface ApiKeyPolicy {
  enabled?: boolean
  priority?: number
  weight?: number
}

interface AlternateKey extends ApiKeyPolicy {
  id: string
  credentialRef: string
}

interface ApiKeyPool {
  mode?: 'priority' | 'weighted'
  primary?: ApiKeyPolicy
  keys: AlternateKey[]
  maxAttempts?: number
  health?: {
    failureThreshold?: number
    openCircuitMs?: number
  }
}

interface PiAiProviderProfile {
  sourceProvider?: string
  apiKeyEnv?: string
  apiKeyPool?: ApiKeyPool
  displayName?: string
  api?: string
  baseURL?: string
  models?: PiAiModelProfile[]
  modelOverrides?: Record<string, PiAiModelOverride>
  // ... official pi-ai fields
}

interface Config {
  providers?: Record<PoolRoute, PiAiProviderProfile>
}
```

`sourceProvider` defaults to the route key. When it names an installed catalog
route, the profile inherits that route's endpoint, protocol, and models. A
custom endpoint supplies `api`, `baseURL`, and `models`.

### Key pool

`src/key-pool.ts` owns:
- `KeyPoolRuntime.recordAttemptFailure` for failure reporting;
- `KeyPoolRuntime.recordSuccess` for success reporting;

- priority and weighted selection;
- key reservation and cooldown trials;
- healthy/open/trial health state;
- redacted health projection.

### Credential boundary

`src/credential.ts` resolves exactly one selected reference per attempt. A
named reference that misses fails loud; no ambient fallback exists.

### Adapter

`src/adapter.ts`:

- captures an immutable profile/model snapshot before the first await;
- follows the single-key path when `apiKeyPool` is absent;
- selects one key, resolves one credential, and buffers pre-business chunks;
- switches only on `AUTH`, `QUOTA`, `RATE_LIMIT`, `MISSING_CREDENTIAL`,
  `INVALID_CREDENTIAL` before business output;
- never switches after the first content/tool chunk;
- propagates abort, server, timeout, transport, context, and unknown errors.

### Control

`src/control.ts` exposes loopback-only:

- `view`: redacted health projection;
- `probe`: exact-key probe.

The RPC path is `/multikey-provider`.

## 3. Configuration Persistence

Pool profiles persist under:

```yaml
multikey-provider:
  providers:
    <pool-route>:
      sourceProvider: <backend>
      apiKeyEnv: <PRIMARY_REF>
      apiKeyPool:
        mode: priority
        primary:
          priority: 0
        keys:
          - id: backup
            credentialRef: BACKUP_REF
            priority: 10
```

Credential values are written only through `credentials.set`. Settings payloads
contain references and policy, never secret values.

## 4. UI State and Exposure

- Official provider rows keep the official public-wire editor behavior.
- Pool rows are discriminated by `settingsNs === 'multikey-provider'`.
- An unconfigured pool route appears only in the existing Add provider
  selector, matching the official dormant posture.
- Alternate keys and pool policy fields appear only inside an opened
  configured pool `ProviderEditor`.
- No second Models page, navigation item, standalone editor, or Plugins page.

## 5. Selection and Error State Machine

Allowed pre-business switch codes:

```text
AUTH, QUOTA, RATE_LIMIT, MISSING_CREDENTIAL, INVALID_CREDENTIAL
```

Never switch:

```text
abort, invalid request/model/content, context overflow, server, timeout,
transport, unknown
```

After the first business content/tool chunk, the selected key is committed and
no other key is resolved.

## 6. Parity Matrix

- Official Provider remains active and unchanged.
- Official routes keep the official owner.
- Pool routes are the plugin owner's only routes.
- `llm-pi-ai` namespace remains official.
- `multikey-provider` namespace is plugin-owned.
- Models section `models` is registered once by the plugin client.
- Catalog and custom endpoint behavior matches the official pi-ai path.

## 7. Test Cases

### Configuration

- valid catalog `sourceProvider`;
- valid custom endpoint;
- duplicate ids/references rejected;
- invalid priority/weight/attempt/health rejected;
- `multikey/*` route rejected;
- route collision with another adapter rejected.

### Key pool

- priority and weighted selection;
- failure threshold opens a key;
- circuit expiry permits a trial;
- session-local failures and global auth failures.

### Credential

- exact ref resolution;
- named miss fails loud;
- no ambient fallback for a named ref.

### Adapter positive/negative pairs

- first key success;
- pre-output invalid-to-valid failover;
- no switch after text/tool output;
- no switch for abort, server, timeout, transport, unknown;
- no attempt beyond max;
- exhaustion preserves the original failure.

### Models client

- official row behavior unchanged;
- pool row discrimination by namespace;
- pool controls only inside configured pool editor.

### Composition and restore

- official Provider active in installed fixture;
- official Models client disabled in installed fixture;
- plugin active in installed fixture;
- plugin absent after restore.

## 8. Implementation Stop Conditions

No code is committed as complete without:

1. active architecture gate passes;
2. typecheck, lint, tests, coverage, build, and pack pass;
3. installed profile restart and `dump-config` prove additive ownership;
4. live catalog and custom provider calls pass;
5. restore after bundle removal plus restart passes;
6. DSH Review returns PASS.
