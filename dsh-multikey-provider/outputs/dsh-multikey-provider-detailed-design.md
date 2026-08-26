# DSH Multi-Key Provider Detailed Design

Status: active

Canonical detailed design:
`docs/architecture/detailed-design.md`. This output remains the stable review
summary and is reconciled with the canonical document.

## Decision

Build an additive Provider plugin over the installed DSH runtime. The plugin
owns only new pool routes and `settingsNamespace('multikey-provider')`.
`@deepseek-ai/dsh-llm-pi-ai` remains installed, active, and the sole owner of
its existing routes and `llm-pi-ai` namespace.

The plugin registers its own external pool routes and never calls or replaces
the official Provider entrypoint. It reuses the same pi-ai catalog and public
LLM wire contracts as the official Provider, then adds per-route key-pool
selection, failover, probe, and health.

## Composition

Installed state:

```text
@deepseek-ai/dsh-llm-pi-ai       active, unchanged
@deepseek-ai/dsh-client-ui-settings-models
                                    installed, client entry disabled by exact name
dsh-multikey-provider            inserted
    host: multikey-provider namespace + pool routes + control RPCs
    client: settings.section:models over public wire contracts
```

`cordis.patch.yml` has exactly one profile-independent insertion. The installed
Web profile carries the one guarded Models disable; headless carries none. There is
no patch for `id: llm-pi-ai`. `name` is a target-name guard, not a rename.

The Models client replacement is necessary because rc.6 exposes no child slot
inside a Provider card. It remains reversible: uninstalling the bundle and
restarting re-enables the untouched official client package.

## Configuration Contract

```ts
interface MultiKeyProviderProfile extends PiAiProviderProfile {
  sourceProvider?: string
  apiKeyEnv?: string
  apiKeyPool: {
    mode?: 'priority' | 'weighted'
    primary?: KeyPolicy
    keys: AlternateKey[]
    maxAttempts?: number
    health?: {
      failureThreshold?: number
      openCircuitMs?: number
    }
  }
}

interface Config {
  providers?: Record<PoolRoute, MultiKeyProviderProfile>
}
```

The dictionary key is the externally registered pool route. `sourceProvider`
is the catalog backend used for endpoint/protocol/model defaults. For a custom
endpoint, the profile explicitly names `api`, `baseURL`, and `models` under any
backend id.

The compiler validates the whole candidate before registry mutation:

- external route and source Provider are non-empty;
- external route is not `multikey/*` and does not collide with another adapter;
- primary and alternate references are valid credential identifiers;
- key ids and references are unique, and `primary` is reserved;
- enabled keys, priorities, weights, attempt limit, and health limits are valid;
- the backend profile can construct a serviceable provider.

Invalid settings fail at `settings.mutate`; no last-good reconstruction from
business payloads and no silent skip exists.

## Adapter Mainline

```text
GenerateOptions(provider=pool route)
  -> immutable compiled pool snapshot
  -> reserve KeyDescriptor in KeyPoolRuntime
  -> AsyncLocalStorage binds selected credential reference
  -> independent adapter (pi-ai-backed)
  -> buffer pre-business chunks
  -> commit on first content/tool chunk OR advance on allowed key failure
  -> original chunks to caller
```

The caller-visible request remains unchanged and no key id, attempt count,
health, or source Provider is attached to metadata, messages, chunks, sessions,
or errors.

Account-specific advancement is limited to `AUTH`, `QUOTA`, `RATE_LIMIT`,
`MISSING_CREDENTIAL`, and `INVALID_CREDENTIAL` before business output. Abort,
invalid request/model/content, context overflow, server, timeout, transport,
and unknown failures preserve the first attempt result. Once a content or tool
chunk is emitted, a later error is never replayed with another key.

## Health

`KeyPoolRuntime` is the only health owner. States are `healthy`, `open`, and
`trial`. Auth or missing/invalid credential opens immediately; quota/rate
failures open at the configured threshold. One selector reserves a cooldown
trial. Health survives config refresh only when external route, key id, and
credential reference are unchanged. Secret values are never health identity.

## Resource Planes

```text
business: request -> pool adapter -> pi-ai backend -> chunks
control:  compiled descriptors -> selection/health -> redacted view/probe
secret:   credential service -> one attempt OR explicit reveal RPC
admin:    Models wire mutations -> multikey-provider settings namespace
```

No plane is encoded into another. In particular, control and secret state do
not enter business metadata or stream chunks, and business payloads never
rebuild scheduling state.

## Models Section

The client reads all Providers from `llm.providers` and all editable profiles
from `settings.describe`. Normal official Provider rows preserve the official
public-wire editing workflow. Pool rows are those whose `settingsNs` is
`multikey-provider`; their card adds:

- catalog/custom backend fields and external route identity;
- primary credential write;
- alternate add/rotate/enable/remove;
- priority/weighted policy;
- redacted health and exact-key probe;
- credential-reference copy;
- explicit reveal/copy with transient secret state.

Credential values are written only through `credentials.set`. Settings
mutations contain references and policy only. A credential write followed by a
failed settings mutation is reported as an explicit orphaned reference; no
success or unreadable-secret rollback is fabricated.

## Install And Restore

Install acceptance:

1. Pack and install `dsh-multikey-provider` into a real Web profile.
2. Restart DSH using its exact service/PID operation.
3. `dump-config` proves official `llm-pi-ai` active, official Models client
   disabled, and `multikey-provider` active.
4. Runtime inspection proves official routes keep one official owner, every
   configured pool route has one plugin owner, and namespaces are distinct.
5. Browser smoke proves one Models section and pool management actions.
6. Real catalog and custom Provider calls prove single key, probe, and
   invalid-to-valid pre-output failover. OpenCode Go uses only
   `deepseek-v4-flash`.

Restore acceptance:

1. Remove the plugin bundle and restart DSH.
2. `dump-config` proves `multikey-provider` absent and both official entries
   active.
3. Runtime proves pool routes/RPCs/namespace/client absent and official routes
   unchanged.
4. Replay an official Provider/model call and official Models edit.

## Rejected Designs

- Disable or replace the official Provider: violates additive route ownership.
- Extend `apiKeyPool` inside `llm-pi-ai`: takes ownership of an official
  namespace and requires replacing the official adapter.
- Import a Harness checkout or official private source: installed deployments
  do not provide that source contract.
- `llm/stream` middleware: wrong owner for outbound credential selection.
- Duplicate an existing route: DSH registry is exclusive and must reject it.
- Put pool UI in Plugins: does not satisfy Provider management in Models.
- Fail over on transport/server/timeout: remote execution state is unknown and
  DSH retry already owns request-level retry.

## Verification

Architecture gates parse registries and TypeScript imports/calls, prove every
source file has one owner, enforce declared cross-module edges, verify exact
additive composition, and scan for business/control/secret leakage.

Tests pair positive and negative cases for config compilation, catalog/custom
backend, route collision, priority/weighted selection, two-level health,
pre-output account failover, post-output no-switch, non-account no-switch,
abort, loopback, redaction, client mutations, secret lifetime, install, and
restore. Live evidence is required after build/install/restart and before DSH
Review.
