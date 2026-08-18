# Multi-Key Provider Architecture Implementation Design

Status: active

## 1. Scope

This document is the implementation contract for `dsh-multikey-provider`. It
describes the additive plugin package only. It does not change DeepSeek
Harness source, the installed official packages, or the DSH host.

The package must keep the official Provider and Models experience while adding
pooled API-key routes. The selected composition is additive:

- keep `@deepseek-ai/dsh-llm-pi-ai` installed and active with its original
  routes and `llm-pi-ai` settings namespace;
- disable only the official Models client entry in the installed Web profile
  because rc.6 exposes no provider-card extension slot;
- insert `dsh-multikey-provider` as one independent entry;
- add only `apiKeyPool` configuration, adapter-owned key selection, and
  controls inside the existing `ProviderEditor`;
- keep `multikey-provider.providers.<pool-route>.sourceProvider` as the backend
  identity used to inherit catalog endpoint/protocol/models.

This is an independent configuration path under the plugin's own namespace, not
a replacement of the official Provider.

## 2. Goals and Non-Goals

### Goals

- Match official provider route, model, discovery, replay, stream, timeout,
  retry-policy, and Models behavior.
- Keep `llm-pi-ai.providers.<provider>.apiKeyEnv` owned by the official
  Provider.
- Add `multikey-provider.providers.<pool-route>` for pool routes.
- Select and resolve one credential per outbound attempt.
- Advance only for explicit account/credential failures before business output.
- Keep unconfigured pool routes out of configured rows and inside the existing
  Add provider selector only.
- Render alternate keys and policy controls only inside an opened configured
  pool `ProviderEditor`.
- Keep credentials and control state outside business payloads.
- Restore official entries through removal plus exact DSH restart.

### Non-goals

- No `multikey/*` provider route.
- No second official namespace (`llm-pi-ai` remains official-only).
- No second Models page or navigation item.
- No Plugins page editor.
- No `llm/stream` middleware.
- No request-level retry replacement.
- No provider transport, server, timeout, context, or unknown-error failover.
- No change to official package files.

## 3. Composition Contract

The universal bundle patch is profile-independent:

```yaml
- insert:
    - id: multikey-provider
      name: dsh-multikey-provider
```

The installed Web profile adds the Web-only overlay:

```yaml
- id: ui-settings-models
  name: '@deepseek-ai/dsh-client-ui-settings-models'
  disabled: true
```

Headless has no Models entry and receives no Models patch. This keeps its
composition warning-free. There is no patch for `id: llm-pi-ai`. `name` is a
target-package guard for the Models entry, not a replacement name.

Inside the plugin package, the Cordis entry exports `name = 'multikey-provider'`
and owns only the `multikey-provider` settings namespace. The official Provider
entry remains active and owns `llm-pi-ai`.

During the plugin profile:

| Exclusive resource | Active owner |
| --- | --- |
| Official provider routes | `@deepseek-ai/dsh-llm-pi-ai` |
| Pool provider routes | `dsh-multikey-provider` |
| Settings namespace `llm-pi-ai` | `@deepseek-ai/dsh-llm-pi-ai` |
| Settings namespace `multikey-provider` | `dsh-multikey-provider` |
| Models section `models` | `dsh-multikey-provider/client` |

After bundle removal and restart:

| Exclusive resource | Restored owner |
| --- | --- |
| Official provider routes | `@deepseek-ai/dsh-llm-pi-ai` |
| Settings namespace `llm-pi-ai` | `@deepseek-ai/dsh-llm-pi-ai` |
| Models section `models` | `@deepseek-ai/dsh-client-ui-settings-models/client` |

At every runtime state, each exclusive resource must have exactly one active
owner.

## 4. Official Baseline and Source Policy

The plugin does not import or call the official Provider entrypoint. It uses
the installed pi-ai catalog through `@earendil-works/pi-ai` and the public DSH
LLM/settings/credentials wire contracts.

Runtime authority is the pinned rc.6 npm artifact:

- `@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.6`
- `@deepseek-ai/dsh-client-ui-settings-models@0.1.0-rc.6`

The plugin must:

1. keep official packages as installed peers;
2. reuse public pi-ai catalog behavior without copying official source;
3. never read a Harness checkout at runtime;
4. never register official routes or `llm-pi-ai` namespace;
5. fail activation when a route or directory collision is detected;
6. never add an approximation or compatibility fallback for unknown behavior.

The plugin may use the public DSH contracts and `@earendil-works/pi-ai`. It
must not import `@deepseek-ai/dsh-llm-pi-ai` or
`@deepseek-ai/dsh-client-ui-settings-models` at runtime.

## 5. Module Ownership

The review-facing architecture views are rendered from
`docs/diagrams/*.mmd` and linked from `docs/wiki/index.md`:

- `composition-owner.mmd`: official Provider active and unchanged, plugin
  added under `multikey-provider`.
- `module-ownership.mmd`: entry is `multikey-provider`, provider owns pool
  routes only, official namespaces are outside this plugin.
- `request-mainline.mmd`: pool route -> independent adapter -> pi-ai backend.
- `attempt-state-machine.mmd`: pre-business account failover and
  post-business no-switch.
- `key-health-state.mmd`: healthy/open/trial transitions.
- `restore-sequence.mmd`: remove bundle, restart, verify official restore.

## 6. Runtime Design

### 6.1 Provider Entry

`src/index.ts`:

```ts
export const name = 'multikey-provider'
export const inject = ['llm']
export function apply(ctx: Context, config: Config = {}): void
```

It calls `applyMultiKeyProvider(ctx, config)` and mounts
`MultiKeyControl` for probe/health.

### 6.2 Settings Namespace

The plugin installs one settings namespace:

```ts
const NS = settingsNamespace('multikey-provider')
```

The official `llm-pi-ai` namespace is never read or written by this plugin.

### 6.3 Pool Profile

```ts
interface PiAiProviderProfile {
  sourceProvider?: string
  apiKeyEnv?: string
  apiKeyPool?: ApiKeyPool
  displayName?: string
  api?: string
  baseURL?: string
  models?: PiAiModelProfile[]
  modelOverrides?: Record<string, PiAiModelOverride>
  // ... official pi-ai fields preserved
}
```

The `providers` dict key is the externally registered pool route.
`sourceProvider` defaults to the route key, so a catalog route named exactly
like an installed pi-ai provider still works. For a custom endpoint, the
profile supplies `api`, `baseURL`, and `models`.

### 6.4 Adapter

`src/adapter.ts`:

- builds an immutable `Models` collection from resolved profiles;
- supports both single-key and pooled routes;
- resolves one credential per attempt through `ctx.credentials`;
- buffers pre-business chunks and allows switch only for
  `AUTH`, `QUOTA`, `RATE_LIMIT`, `MISSING_CREDENTIAL`, `INVALID_CREDENTIAL`;
- never switches after first business content/tool chunk;
- propagates non-account failures unchanged.

### 6.5 Control Plane

`src/control.ts` exposes:

- `view` -> redacted health projection;
- `probe` -> exact-key probe result.

Both are loopback-only typed RPCs under `/multikey-provider`. No control state
enters `GenerateOptions`, `StreamChunk`, metadata, or settings payload.

## 7. Configuration Validation

`src/config.ts` compiles the whole candidate before any registry mutation:

- route and `sourceProvider` are non-empty;
- no `multikey/*` route prefix;
- no duplicate key ids or credential references;
- `primary` is reserved;
- at least one enabled key and valid attempt/health limits;
- pi-ai provider construction succeeds for every route.

Invalid settings fail at `settings.mutate`; no silent strip or fallback exists.

## 8. Restore

1. Remove the plugin bundle and patch.
2. Restart DSH by exact service or PID.
3. `dump-config` proves `multikey-provider` absent and both official entries
   active.
4. Replay official provider/model and Models settings paths.

Hot reload alone is not restore evidence.
