# Multi-Key Provider Architecture Implementation Design

Status: design pending automated approval

## 1. Scope

This document is the implementation contract for `dsh-llm-pi-ai-multikey`.
It describes the replacement package only. It does not change DeepSeek
Harness source, the installed official packages, or the DSH host.

The package must preserve the official provider and Models experience. The
preferred composition is additive insertion into an official extension seam.
The installed `0.1.0-rc.6` packages do not expose the required seams, so the
package uses the smallest official-derived whole-entry replacement:

- disable the official Provider entry by its exact existing package name;
- disable the official Models entry by its exact existing package name;
- insert one replacement entry;
- keep the original Provider routes, `llm-pi-ai` settings namespace, and
  `models` settings section identifiers;
- add only `apiKeyPool` configuration, adapter-owned key selection, and
  controls inside the existing `ProviderEditor`.

This is entry replacement, not a second product surface and not an
independent configuration system.

## 2. Goals and Non-Goals

### Goals

- Match official provider route, model, discovery, replay, stream, timeout,
  retry-policy, onboarding, and Models behavior.
- Keep `llm-pi-ai.providers.<provider>.apiKeyEnv` as the primary credential
  reference.
- Add optional `apiKeyPool` beside `apiKeyEnv`.
- Select and resolve one credential per outbound attempt.
- Advance only for explicit account/credential failures before business output.
- Keep unconfigured providers out of configured rows and inside the official
  Add provider selector only.
- Render alternate keys and policy controls only inside an opened configured
  official `ProviderEditor`.
- Keep credentials and control state outside business payloads.
- Restore the official entries through removal plus exact DSH restart.

### Non-goals

- No `multikey/*` provider route.
- No second settings namespace.
- No second Models page or navigation item.
- No Plugins page editor.
- No `llm/stream` middleware.
- No request-level retry replacement.
- No provider transport, server, timeout, context, or unknown-error failover.
- No credential reveal/copy-value feature in the first implementation.
- No change to official package files.

## 3. Composition Contract

The bundle patch is exact and ordered:

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  disabled: true

- id: ui-settings-models
  name: '@deepseek-ai/dsh-client-ui-settings-models'
  disabled: true

- insert:
    - id: llm-pi-ai-multikey
      name: dsh-llm-pi-ai-multikey
```

`name` is a target-package guard. It is not a replacement name and must never
be changed to `dsh-llm-pi-ai-multikey`.

Inside the replacement package, the Cordis entry exports
`name = 'llm-pi-ai-multikey'`. It must not export `llm-pi-ai`; the provider
routes and `llm-pi-ai` settings namespace remain owned by the replacement entry
without using the official entry name.

The official packages remain installed. During the replacement profile:

| Exclusive resource | Active owner |
| --- | --- |
| Provider routes | `dsh-llm-pi-ai-multikey` |
| Settings namespace `llm-pi-ai` | `dsh-llm-pi-ai-multikey` |
| Models section `models` | `dsh-llm-pi-ai-multikey/client` |

After bundle removal and restart:

| Exclusive resource | Restored owner |
| --- | --- |
| Provider routes | `@deepseek-ai/dsh-llm-pi-ai` |
| Settings namespace `llm-pi-ai` | `@deepseek-ai/dsh-llm-pi-ai` |
| Models section `models` | `@deepseek-ai/dsh-client-ui-settings-models/client` |

At every runtime state, each exclusive resource must have exactly one active
owner.

## 4. Official Baseline and Source Policy

The auditable source scaffold is:

- repository:
  `https://github.com/deepseek-ai/deepseek-harness.git`
- commit:
  `47f943859bef60e4160492346772ded9b24f765a`
- version: `0.1.0-rc.5`
- Provider baseline:
  `packages/llm/llm-pi-ai/src`
- Models baseline:
  `packages/client/ui-settings-models/src/client`

The installed runtime authority is the pinned rc.6 npm artifact:

- `@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.6`
- `@deepseek-ai/dsh-client-ui-settings-models@0.1.0-rc.6`

rc.6 publishes compiled artifacts without source or `gitHead`. The
implementation must therefore:

1. copy the rc.5 source scaffold into the replacement authoring tree;
2. reconcile public behavior against the installed rc.6 artifacts;
3. apply only the declared deltas;
4. never read a Harness checkout at runtime;
5. fail activation when parity cannot be established;
6. never add an approximation or compatibility fallback for unknown behavior.

The replacement package may use the public DSH contracts and
`@earendil-works/pi-ai`. It must not import
`@deepseek-ai/dsh-llm-pi-ai` or
`@deepseek-ai/dsh-client-ui-settings-models` at runtime. Those packages are
installed profile authorities, not nested implementation dependencies.

## 5. Module Ownership

```text
composition
  -> entry
       -> provider
            -> config
            -> adapter
                 -> key-pool
                 -> credential
       -> control
  -> models-client
```

### `composition`

Owns `cordis.patch.yml`, package identity, upstream provenance, and exclusive
entry ownership. It does not own runtime provider logic or UI logic.

### `entry`

Owns the replacement plugin `name`, injection contract, and mounting of the
provider, Models client, and typed control resources. It does not resolve
credentials or select keys.

### `provider`

Owns the official provider registration shape:

- `llm-pi-ai` settings namespace;
- configurable-provider directory;
- discovery registration;
- original route registration;
- official catalog and custom-provider materialization;
- official context, replay, and stream conversion.

It constructs one immutable profile snapshot and delegates outbound attempts
to `adapter`.

### `config`

Owns the only configuration schema and validation boundary. It preserves every
official profile field and adds optional `apiKeyPool`. It stores references,
never credential values.

### `adapter`

Owns the outbound attempt boundary and the business stream. It freezes the
official provider/model snapshot before the first await, obtains an
attempt-local credential, invokes the official-derived stream path, classifies
the terminal result, and decides whether the key-pool control chain may
advance.

### `key-pool`

Owns process-local key descriptors, selection policy, health state, circuit
state, and redacted health projection. It never receives a credential value.

### `credential`

Owns one operation: resolve one selected credential reference into one
attempt-local value. It is the only module allowed to read credential values.

### `control`

Owns loopback, typed, redacted probe and health operations. It is not part of
the LLM request or response path. Credential reveal/copy-value is not included
in the first implementation, so no secret-control endpoint is owned by this
design.

### `models-client`

Owns the official Models client source tree and its exact page composition.
The only UI delta is an alternate-key/policy block rendered from the existing
configured `ProviderEditor` for `llm-pi-ai`.

### `operations`

Owns installation, dump-config, restart, removal, restore, and replay evidence.
It does not decide runtime behavior.

## 6. Configuration Model

The single configuration document remains:

```yaml
llm-pi-ai:
  providers:
    <provider>:
      apiKeyEnv: PRIMARY_REF
      apiKeyPool:
        mode: priority
        primary:
          enabled: true
          priority: 0
          weight: 1
        keys:
          - id: secondary
            credentialRef: SECONDARY_REF
            enabled: true
            priority: 10
            weight: 1
        maxAttempts: 2
        health:
          failureThreshold: 3
          openCircuitMs: 60000
```

`apiKeyEnv` remains the primary reference. The primary key is represented
internally as descriptor id `primary`; it is not duplicated in
`apiKeyPool.keys`.

When `apiKeyPool` is absent, the profile follows the official single-key
behavior exactly. When `apiKeyPool` is present:

- `apiKeyEnv` is required and becomes the primary descriptor reference;
- alternate ids are unique, lower-case, and cannot be `primary`;
- credential references are valid shell-style credential references and are
  unique across primary and alternates;
- enabled descriptors must contain at least one entry;
- priority is a non-negative integer;
- weight is a positive finite number;
- `maxAttempts` is between `1` and the number of enabled descriptors;
- health thresholds and open-circuit durations are positive;
- invalid input is rejected at settings mutation time;
- no invalid pool is stored and no route is silently disabled.

No pool data is copied into `GenerateOptions`, message metadata, replay state,
session events, `StreamChunk`, or settings payloads beyond the declared
configuration references and policy.

## 7. Request Mainline

```text
official settings snapshot
  -> resolve official profile/catalog/model
  -> capture immutable request snapshot
  -> select eligible descriptor
  -> resolve one credential value
  -> invoke one official-derived provider attempt
  -> translate official stream to StreamChunk
  -> classify terminal outcome
      -> success: record key healthy and return
      -> explicit account failure before output:
           record key failure -> select next descriptor
      -> all other failure:
           release key -> propagate original DSH outcome
```

The adapter must buffer non-business terminal chunks until the attempt is
known to be committed. A business commitment begins at the first text,
reasoning, or tool-call business output. Once committed:

- no second credential is resolved;
- no key switch is allowed;
- the current attempt's chunks are forwarded unchanged;
- the official terminal outcome remains authoritative.

For a pre-output credential/account failure, the only eligible switch codes
are:

- `AUTH`;
- `QUOTA`;
- `RATE_LIMIT`;
- `MISSING_CREDENTIAL`;
- `INVALID_CREDENTIAL`.

The following never switch keys:

- caller abort;
- invalid request or model;
- unsupported content or context overflow;
- server error;
- timeout;
- transport error;
- stream truncation;
- unknown provider error.

The outer DSH retry/recovery layer remains the sole request-level retry owner.
The key pool only handles credential identity within one adapter call.

## 8. Error Contract

The error chain is typed and separate from business output:

```text
provider-attempt
  -> adapter-attempt-error
  -> classify:
       account failure -> key-state transition -> next selection
       non-account failure -> original request outcome
```

The implementation must not:

- convert an error into a synthetic success;
- emit an error as a successful business response;
- silently strip control fields from a payload;
- retry a transport/server/timeout error using another key;
- replace the original final failure with a generic pool error when the final
  attempt produced a provider failure;
- log credential values or include them in an error cause/message.

If no eligible descriptor exists before an attempt can start, the adapter emits
an explicit `NO_ELIGIBLE_CREDENTIAL` error. If all attempts fail with
credential/account errors, the last original terminal failure is returned.

## 9. Health and Selection

Selection state is process-local and keyed by route plus descriptor id. A
configuration update creates a new runtime for changed descriptor definitions
and carries forward health only when both descriptor id and credential
reference are unchanged.

States:

- `healthy`: eligible for selection;
- `trial`: reserved by one in-flight attempt or probe;
- `open`: unavailable until the circuit interval expires.

Priority mode chooses the lowest priority among eligible descriptors. Weighted
mode chooses by configured positive weight among eligible descriptors.

A descriptor is excluded when disabled, open, already tried by the current
adapter call, or reserved by an incompatible trial. A successful terminal
stop, tool-call completion, or max-token completion resets the descriptor to
healthy. An account failure opens the descriptor immediately; other
key-attributable failures use the configured threshold. An ineligible error
releases the trial without changing health.

## 10. Models UI Contract

The replacement client copies the official Models source tree and keeps its
existing:

- `ModelsSection`;
- configured row rendering;
- dormant Add provider selector;
- custom provider workflow;
- `ProviderEditor`;
- DeepSeek editor;
- onboarding dialogs;
- locale namespaces and copy;
- CSS modules, spacing, tokens, and responsive rules.

The only functional addition is inside the existing `ProviderEditor` for a
configured `llm-pi-ai` provider:

```text
primary API key
  -> existing official field
  -> existing official customized settings
  -> additional API keys/policy block
       -> alternate key id
       -> credential reference
       -> enabled
       -> priority or weight
       -> maximum attempts
       -> health policy
       -> redacted status
       -> probe
```

The UI must follow the official page's existing layout and control grammar.
It must not create a new card, page, section, route, or navigation item.

Exposure rules:

```text
provider not configured
  -> absent from configured rows
  -> present in official Add provider selector
  -> no apiKeyPool controls

provider selected and saved
  -> appears as existing configured row
  -> opened through existing Edit action
  -> pool controls appear inside that ProviderEditor
```

The client reads and writes `apiKeyPool` through the existing
`settings.describe` / `settings.mutate` contract. Credential values are sent
only through `credentials.set` when a user explicitly enters a new key. The
first implementation shows credential references and redacted status only; it
does not add reveal or copy-value actions.

Probe and health calls use the typed loopback control channel. Their response
contains route, key id, state, status, latency, and error code only. It never
contains a credential value.

## 11. Resource Isolation

```text
business.llm-request
  -> control.provider-snapshot
  -> control.key-pool-runtime
  -> secret.credential-reference
  -> control.attempt-credential
  -> runtime.provider-attempt
  -> business.llm-response

runtime.provider-attempt
  -> error.adapter-attempt
  -> error.key-state-transition
  -> control.key-pool-runtime
  -> error.request-outcome
```

Forbidden edges include:

- control state into request payload;
- credential values into request or response payload;
- health projection into business response;
- error-control state into business response;
- credential values into settings, logs, snapshots, sessions, or replay.

The architecture gate must statically reject these edges and the tests must
exercise both permitted and forbidden paths.

## 12. Install and Restore

### Install

1. Build and pack the replacement package.
2. Install the bundle and patch into the managed DSH profile.
3. Restart DSH using the exact service or PID-scoped procedure.
4. Dump effective config.
5. Assert official entries are disabled, replacement is active, and exact-one
   ownership holds for routes, namespace, and Models section.
6. Open the Models page at desktop and mobile widths.
7. Prove configured-row and Add provider exposure.
8. Replay one original single-key provider request.
9. Replay one explicit pre-output alternate-key switch.
10. Prove non-account errors do not switch.

### Restore

1. Remove the replacement bundle and patch.
2. Restart DSH using the exact service or PID-scoped procedure.
3. Dump effective config.
4. Assert the official Provider and Models entries are active.
5. Assert the replacement entry is absent.
6. Assert exact-one ownership still holds.
7. Replay the original provider/model/settings paths.

Hot reload alone is not restore evidence because both exclusive owners can
coexist transiently during composition changes.

## 13. Verification Gates

### Design gate

Must pass before implementation:

- exact composition patch;
- pinned official scaffold and rc.6 runtime authority;
- official insertion seam audit;
- one owner per exclusive resource;
- one configuration namespace;
- official Models exposure contract;
- module/resource/function/mainline registry consistency;
- payload/control separation;
- canonical document links;
- no implementation files changed as design evidence.

### Implementation gate

After explicit design approval:

- architecture registry activation and import/call graph gate;
- provider parity tests;
- config tests;
- key-pool tests;
- credential boundary tests;
- paired adapter failover tests;
- payload isolation tests;
- Models DOM/layout/exposure tests;
- control redaction tests;
- typecheck, lint, coverage, build, pack inspection.

### Live gate

- installed bundle dump-config;
- exact owner counts;
- browser desktop/mobile screenshots;
- real provider positive and negative samples;
- remove bundle;
- exact restart;
- restored dump-config;
- original provider and Models replay.

### Review gate

Run standard automated DSH Review after the design gate and before source
implementation. DSH Review must return a semantic PASS. Any design change
after review invalidates that PASS and requires a new review.

## 14. Decision Record

The design follows Jason's required ordering:

1. Try additive insertion first.
2. Confirm the installed official packages are too coarse for adapter and
   ProviderEditor injection.
3. Fork the official source layout with the smallest declared delta.
4. Replace only the two exclusive entries in configuration.
5. Keep the official configuration identity and Models experience.

The current independent runtime and custom Models page are not design
artifacts. They must be replaced or deleted only after the approved official
baseline implementation is bound and dependency safety is proven.
