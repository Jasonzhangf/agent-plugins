# Multi-Key Pi-AI Replacement Detailed Design

Status: design pending approval

## Decision

Fork the official `@deepseek-ai/dsh-llm-pi-ai` implementation into the
independent package `dsh-llm-pi-ai-multikey`. Keep official behavior as the
baseline and extend only provider-profile credential resolution and the
adapter's outbound attempt loop.

An outer wrapper cannot safely implement this feature: the public adapter API
does not expose the official adapter's immutable provider snapshot or permit a
second owner for the same route. A `llm/stream` hook is also the wrong owner
because it would place provider credential control above the outbound adapter
and could not replace the credential used by pi-ai without rebuilding the
request path.

## Runtime Composition

```text
@deepseek-ai/dsh-base inserts id=llm-pi-ai, name=@deepseek-ai/dsh-llm-pi-ai
                                 |
replacement bundle patch, later layer
                                 v
id=llm-pi-ai, name=@deepseek-ai/dsh-llm-pi-ai, disabled=true
                                 |
replacement insert: id=llm-pi-ai-multikey, name=dsh-llm-pi-ai-multikey
```

`name` is the exact target-name guard in Harness patching; a different value is
a mismatch and the patch is skipped. The official package remains present in
`node_modules`, but its entry is disabled before the replacement row mounts.
Only the replacement adapter registers the existing routes and the
`llm-pi-ai` settings namespace.

The same bundle disables the exact existing Web client row:

```text
id=ui-settings-models, name=@deepseek-ai/dsh-client-ui-settings-models,
disabled=true
                                 |
replacement package dsh.client bundle
                                 v
settings.section id=models
```

The official provider and Models packages are never removed. Composition is a
reversible profile choice, but restoration requires bundle removal followed by
a DSH restart so the old and new exclusive owners are never accepted from a
transient hot-reload state.

## Configuration Model

Official `PiAiProviderProfile` fields are retained. The only new field is:

```ts
interface ApiKeyPoolConfig {
  mode?: 'priority' | 'weighted'
  primary?: {
    enabled?: boolean
    priority?: number
    weight?: number
  }
  keys: Array<{
    id: string
    credentialRef: string
    enabled?: boolean
    priority?: number
    weight?: number
  }>
  maxAttempts?: number
  health?: {
    failureThreshold?: number
    openCircuitMs?: number
  }
}
```

`apiKeyEnv` remains the primary key because the official Models page already
owns its write-only editor. The compiler materializes it as key id `primary`;
`apiKeyPool.primary` supplies its scheduling fields and defaults to:

```text
enabled=true, priority=0, weight=1
```

`apiKeyPool.keys` contains alternate refs only. Duplicate ids, duplicate refs,
an alternate id `primary`, no enabled key, invalid refs, invalid weights,
negative priorities, invalid limits, and a pool without `apiKeyEnv` fail at the
settings/config boundary. Equal priorities retain configuration order.
`maxAttempts` defaults to the number of enabled keys and may not exceed it.

A profile without `apiKeyPool` follows the official path exactly, including
provider-native authentication when `apiKeyEnv` is absent. No compatibility
branch accepts the old standalone plugin's `pools` format.

## Resource Planes

```text
business request -----> ReplacementPiAiAdapter -----> business chunks
                              ^                 |
                              |                 v
control pool snapshot -> KeyPoolRuntime -> redacted health projection
                              |
credential refs ------> credentials.resolve ------> pi-ai attempt option
```

`GenerateOptions` remains caller-owned. `KeyPoolRuntime` stores descriptors and
health only. Credential values are local variables in one outbound attempt and
are never retained in a runtime object.

The admin/probe API accepts provider route and key id as control input. Its
response contains only route, key id, state, timestamps, and stable failure
codes/messages. It never returns or logs a credential value.

## Request Mainline

1. Capture one immutable official-compatible profile/provider/model snapshot
   before the first await.
2. Validate model, reasoning, attachments, and request options once.
3. Capture the route's immutable key-pool descriptor and current health owner.
4. Select one eligible key not previously attempted.
5. Resolve its credential ref through `ctx.credentials`, or launch environment
   when that service is absent; a named miss is `MISSING_CREDENTIAL`.
6. Start one pi-ai stream with unchanged context/options and the selected key as
   the outbound `apiKey` option.
7. Buffer only non-business prelude chunks (`usage` and terminal failure).
8. If a terminal `error` before business output has code `AUTH`, `QUOTA`, or
   `RATE_LIMIT`, record key failure and repeat from step 4 while attempts remain.
9. On the first content/tool chunk, commit the attempt: flush any buffered
   chunks and forward the stream directly. No later failure can start another
   attempt.
10. On successful terminal completion, record key success. All original chunks,
    usage, replay state, and finish reason pass unchanged.

Thrown errors use the same rule as in-band finish errors. `MISSING_CREDENTIAL`
and `INVALID_CREDENTIAL` are key-specific before outbound business output.
`ABORTED`, `INVALID_REQUEST`, `UNKNOWN_MODEL`, `UNSUPPORTED_*`,
`CONTEXT_WINDOW_EXCEEDED`, `EMPTY_RESPONSE`, `SERVER`, `TIMEOUT`, `TRANSPORT`,
and unknown errors never advance to another key.

This is failover among credentials inside one adapter call, not request retry.
The official `retryPolicy` and `dsh-llm-retry` behavior remain unchanged and see
only the final adapter outcome.

## Health Ownership

Health is process-local control state keyed by provider route and key id.

- `healthy`: selectable; key-specific failures increment a counter.
- `open`: excluded after an auth failure or after `failureThreshold` quota/rate
  failures; eligible again only after `openCircuitMs`.
- `trial`: one selector may reserve the key after cooldown; success returns it
  to healthy, failure reopens it.

Configuration changes build a new descriptor. Health is preserved only for the
same route/key id/credential ref tuple. Secret values are not compared or used
as identity.

## Probe And Models Client

The official Models client reads and writes only `apiKeyEnv`; it has no nested
slot inside its provider cards. The slot system forbids injecting an independent
component into an undeclared child slot, and cross-package presentation imports
are forbidden. A Plugins-only page would leave the requested operations outside
Models. Therefore the replacement package owns a client extension that replaces
the disabled official `ui-settings-models` entry and registers the same
`settings.section` id `models`.

The replacement Models client is derived from the pinned official package and
keeps its provider list, custom-provider creation, route/model/base URL/protocol,
primary `apiKeyEnv`, discovery, onboarding, settings revisions, credential
write-only behavior, and pushed invalidations. It adds one alternate-key editor
inside each `llm-pi-ai` provider card. That editor owns:

- add or replace an alternate credential by writing its secret through
  `credentials.set` and its reference/policy through a path-scoped
  `settings.mutate` operation;
- display redacted configured/enabled/health/probe state;
- display a masked stored key by default, reveal/copy its value only after an
  explicit user gesture through the privileged secret-control RPC, and copy the
  credential reference without revealing the value;
- rotate by writing a new value to the same credential reference;
- enable/disable and reorder policy without touching provider/model fields;
- run an exact route/key probe through typed loopback control RPC.

Settings writes use the namespace revision the editor opened. Credential values
never enter settings mutations, ordinary control responses, logs, sessions,
business payloads, screenshots, or build artifacts. The one exception is the
typed `revealCredential` response on the loopback-only secret side-channel. It
returns one requested value after an explicit user gesture; the client stores it
only in local component state and clears it on timeout, blur, route change, or
unmount. It never enters a shared store, cache, health projection, probe result,
clipboard until the user chooses Copy, or error message. A rejected settings candidate
leaves the last good settings and runtime state unchanged. If the credential
write succeeds but the subsequent settings mutation fails, the UI reports the
orphaned reference explicitly and offers only a deliberate retry/removal action;
it does not report success or silently roll back a secret it cannot read.

Probe uses the selected provider's first configured model and a bounded request:

```text
prompt: Reply with exactly OK
maxTokens: 8
```

It runs through the same outbound owner and updates only the probed key's health.
OpenCode Go is a live custom-provider fixture and is locked to
`deepseek-v4-flash`; no product branch names OpenCode Go.

## Package Modules

```text
src/index.ts               plugin apply, official settings/directory/registration
src/config.ts              official-compatible schema + apiKeyPool compiler
src/adapter.ts             official adapter behavior + key-attempt owner
src/key-pool.ts            selection and health state
src/credential.ts          one-reference resolution and named-miss failure
src/catalog.ts             official catalog copy at pinned upstream baseline
src/provider.ts            official provider construction copy
src/context.ts             official request conversion copy
src/stream.ts              official stream conversion copy
src/replay.ts              official replay conversion copy
src/discovery.ts           official discovery copy
src/control.ts             typed loopback RPC and probe transaction
src/secret-control.ts      loopback-only explicit credential reveal
src/client/**              official-derived Models section + alternate-key UI
```

Official-derived files carry the upstream package version/commit in
`UPSTREAM.md`. A parity gate compares behavior fixtures for single-key config,
catalog/custom providers, discovery, attachments, reasoning, retry-policy
registration, replay, timeout, abort, HMR, and settings updates. It does not
text-compare source because the package intentionally changes config and stream
ownership.

## Authoring And Physical Replacement

`dsh-multikey-provider/` is the existing repository directory and remains the
authoring path; it is not the runtime package identity. Implementation changes
`package.json#name` to `dsh-llm-pi-ai-multikey`, replaces the old entry,
adapter, catalog, client entry, and invariant files, and physically deletes the
legacy admin/compiler/health/probe/RPC/scheduler and old
`MultiKeySettings.tsx` named in
`module-registry.json#legacy_replacement_plan`. Existing locale and slot paths
are replacement surfaces because the official-derived Models client still owns
those concerns.

There is no compatibility export for the old `multikey/<pool>` route, old
`multikey-provider` namespace, or `/multikey/api` endpoint. The active
architecture gate rejects those semantics, rejects every listed legacy path,
and requires every resulting TypeScript source file to have exactly one module
owner. It reads the typed loopback owners from `src/control.ts` and
`src/secret-control.ts`; it has no dependency on the deleted `src/rpc.ts`.

## Rejected Designs

- New `multikey/<pool>` routes: changes the provider identity and duplicates
  catalog/custom-provider behavior.
- Two simultaneously mounted adapters: route registration is exclusive.
- Additive client contribution inside official Models: no public provider-card
  child slot exists, so there is no legal composition point.
- Separate Plugins settings page: does not satisfy Models-page ownership and
  splits provider configuration across two navigation surfaces.
- Public-API wrapper around the official adapter: no key injection or immutable
  snapshot access exists at that boundary.
- `llm/stream` middleware: wrong owner for credentials and risks control data
  entering request orchestration.
- Modifying or uninstalling the official package: unnecessary; profile patching
  already provides reversible runtime replacement.
- Failover on transport/server/timeout: duplicates Harness retry and can replay
  a request whose remote execution state is unknown.

## Verification Contract

Positive tests lock official single-key parity, same route/model identity,
priority/weighted selection, key-specific pre-output failover, health recovery,
probe, dynamic settings, exact-name disable-plus-insert composition, Models
replacement UI writes, and real provider calls.

Negative tests lock route non-creation, duplicate adapter rejection, invalid pool
config, missing credentials, no post-output switching, no switching for
abort/request/context/server/transport failures, no control/payload leakage,
secret redaction, failed settings transaction preservation, route/namespace/
Models-section owner uniqueness, and bundle removal plus restart restoring the
official provider and Models packages.

## Install And Restore Evidence

Install acceptance:

1. Install the replacement bundle into the target profile and restart DSH.
2. `--dump-config` shows official `llm-pi-ai` and `ui-settings-models` entries
   disabled and replacement `llm-pi-ai-multikey` active.
3. Runtime registry inspection shows exactly one owner for every retained route,
   exactly one `llm-pi-ai` namespace owner, and one Models section id `models`.
4. The client boot graph contains the replacement client bundle and omits the
   disabled official Models bundle.
5. A real call fails over only for an approved key error and the Models page can
   add/rotate/display masked state/reveal/copy a stored value or reference/probe
   an alternate key.

Restore acceptance:

1. Remove the replacement bundle/patch from the target profile.
2. Restart DSH using the exact service or explicit PID procedure; hot reload is
   not evidence.
3. `--dump-config` shows official `llm-pi-ai` and `ui-settings-models` active and
   the replacement entry absent.
4. Registry and client boot inspection show only official owners.
5. Replay the original provider/model request and open/edit the original Models
   settings path.

## Design And Active Gates

`node docs/architecture/verify-design.mjs` is the pre-implementation gate. It
requires every registry to remain `design`, every future code symbol to remain
`binding-pending`, exact Cordis patch syntax, function/call/resource ownership,
declared source and mount edges, lifecycle lockstep, and the complete restore
path. It also locks the old-source replace/delete inventory, target package
identity, active-gate owners, and repository CI wiring. The
`.github/workflows/dsh-multikey-provider-design.yml` workflow executes this gate
without building the intentionally unapproved old implementation. It does not
claim source/build readiness.

Lifecycle and call-map are two explicit graph layers. Lifecycle edges declare
allowed adjacent stage transitions. Each lifecycle node id binds exactly one
call-map record whose caller/callee are that stage's internal implementation
edge. The gates require exact node-id bijection; they do not falsely equate a
stage transition with a source call.

After implementation binds real symbols, registries change to `active` and the
production `prebuild` gate `pnpm run verify:architecture` becomes authoritative.
The design gate and active gate are distinct; neither weakens the other.
