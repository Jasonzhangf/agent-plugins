# Multi-Key Pi-AI Official-Derived Detailed Design

Status: design pending automated approval

## Decision

The preferred design was an additive insertion into the active official
provider and Models page. It is not implementable on installed rc.6:

- provider `apply()` constructs `PiAiAdapter` and its credential resolver
  internally; no adapter/config injection point is exported;
- provider routes and `llm-pi-ai` settings namespace reject duplicate owners;
- Models exports no provider-card/editor child slot and
  `settings.section:models` is exclusive.

The selected design is therefore the smallest correct whole-entry replacement.
Official packages remain installed. Cordis disables their exact entries and
inserts one official-derived package. No second config, route, namespace, page,
or stream middleware is introduced.

## Provenance

Official commit `47f943859bef60e4160492346772ded9b24f765a` is the auditable
source scaffold. Installed signed rc.6 npm artifacts are runtime behavior
authority. Because rc.6 publishes no source or `gitHead`, the project does not
claim an rc.6 source fork. It ports the official source structure, then proves
single-key and UI parity against pinned rc.6 artifacts before activation. The
built plugin never reads or imports a Harness checkout.

## Source Delta

Provider source keeps official config, catalog, provider materialization,
context conversion, replay, discovery, stream conversion, settings installation,
directory registration, and route registration. Changes are limited to:

1. optional `apiKeyPool` schema and validation beside `apiKeyEnv`;
2. typed key descriptor/health state;
3. attempt-local credential resolution;
4. pre-business-output credential failover in the adapter.

Models source keeps official store, `ModelsSection`, configured provider rows,
dormant Add provider selector, `ProviderEditor`, custom provider flow,
onboarding, locale copy, CSS modules, spacing, and responsive layout. Changes
are limited to alternate Key rows and policy fields inside `ProviderEditor`.

## Exposure Contract

```text
unconfigured provider
  -> absent from configured rows
  -> present only in official Add provider selector
  -> no apiKeyPool UI

selected and saved provider
  -> existing configured row
  -> existing ProviderEditor
  -> primary API Key + alternate Key/policy fields
```

No new page, navigation item, standalone card, or duplicate editor is allowed.

## Configuration

`apiKeyEnv` remains primary. `apiKeyPool.keys` contains alternate credential
references only. The primary descriptor has id `primary`; alternates cannot use
that id or repeat the primary reference. Invalid refs, duplicate ids/refs,
non-positive weights, invalid priorities/limits, or no enabled descriptor fail
at the settings boundary. No pool means exact official single-key behavior.

## Request Mainline

1. Capture the official-compatible provider/model/profile snapshot.
2. Validate request options using the official path.
3. If no pool exists, resolve `apiKeyEnv` once and execute the official path.
4. Otherwise select one eligible descriptor from typed control state.
5. Resolve one credential value into attempt-local scope.
6. Execute the official-derived stream path with unchanged business input.
7. Before the first text/tool business chunk, only explicit credential/account
   errors may advance to another descriptor.
8. On first business output, commit the attempt; all later results pass through
   and no other credential is resolved.
9. Exhaustion returns the original final failure, never a synthetic success.

Abort, invalid request/model/content, context overflow, server, timeout,
transport, and unknown errors never switch keys. Harness retry remains the sole
request-level retry owner.

## Resource Isolation

Key descriptors, selection, attempts, health, and probe are typed side-channel
resources. They never enter `GenerateOptions`, metadata, messages, chunks,
replay state, sessions, or settings payloads. Credential values travel only
from credentials resolution to one outbound attempt and are absent from logs,
errors, projections, snapshots, and committed artifacts.

## Composition

Installed state:

```text
official provider entry     disabled by exact package name
official Models entry       disabled by exact package name
replacement entry           active
provider route owners       exactly 1
llm-pi-ai namespace owners  exactly 1
Models section owners       exactly 1
```

Restore removes the replacement bundle and patch, restarts DSH, verifies the
two official entries active and replacement absent, then replays the original
provider and Models paths. Hot reload is not restore evidence.

## Verification

Design gate checks provenance, exact patch shape, design-state registries,
unique owner contracts, exposure/layout rules, resource separation, CI wiring,
and canonical docs. DSH Review must PASS before source implementation.

Implementation then requires paired config/failover/error tests, official rc.6
provider parity, official Models snapshots, desktop/mobile browser screenshots,
pack inspection, installation/restart, dump-config and unique-owner checks,
live positive/negative model calls, removal/restart/restoration replay, secret
scan, and final DSH Review.
