# Multi-Key Provider Detailed Design

Status: design pending automated approval

This document turns
`docs/architecture/implementation-architecture.md` into file-level,
symbol-level, schema-level, and test-level implementation instructions. It
does not authorize source edits until the design gate and standard automated
approval pass.

## 1. Authoring Tree

The replacement package is authored at `dsh-multikey-provider/` and built as
`dsh-llm-pi-ai-multikey`.

### Provider files

| File | Baseline | Allowed delta |
| --- | --- | --- |
| `src/provider/index.ts` | official Provider entry and registration | connect local config/adapter/key control while preserving official route behavior |
| `src/provider/catalog.ts` | official catalog | copy without semantic delta |
| `src/provider/context.ts` | official DSH-to-pi-ai conversion | no delta |
| `src/provider/discovery.ts` | official model discovery | no delta |
| `src/provider/provider.ts` | official pi-ai provider materialization | no delta |
| `src/provider/replay.ts` | official replay projection | no delta |
| `src/provider/stream.ts` | official stream translation | no delta |
| `src/config.ts` | official profile schema and resolver | add `apiKeyPool` only; preserve official fields, defaults, and validation |
| `src/adapter.ts` | official `PiAiAdapter` | add attempt-local key selection around the official stream call |
| `src/index.ts` | official plugin entry shape | mount provider, control, and client-compatible control registration |
| `src/key-pool.ts` | new | selection, reservation, health, and redacted status |
| `src/credential.ts` | new | one selected reference to one attempt-local credential value |
| `src/control.ts` | new | loopback redacted probe and health control |
| `src/invariant.ts` | official invariant companion shape | package identity only |

`src/wire.ts` and `src/secret-control.ts` are transitional and must not
survive activation. Stream, context, replay, and error conversion belong to
their official-derived source owners. Credential reveal/copy-value is not part
of the first implementation, so a second secret-control copy is dead code and
must be deleted after dependency safety is proven.

### Models files

Copy the complete official client tree:

```text
src/client/
  apiKey.ts
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
  ProviderEditor.tsx
  store.ts
  welcome-store.ts
  WelcomeNotice.module.css
  WelcomeNotice.tsx
```

Allowed changes:

- `store.ts`: parse, validate, and persist `apiKeyPool` in the existing
  `llm-pi-ai` provider profile.
- `ProviderEditor.tsx`: render and edit the pool block below the existing
  primary key field, only for a configured `llm-pi-ai` row.
- `locales.ts`: add labels for the pool block.
- `ModelsSection.module.css`: add only styles needed by the pool block and
  reuse official variables, spacing, control, and responsive rules.
- `index.ts`: wire the existing Models section to the replacement package's
  loopback control without changing the registered section id.

No custom Models replacement component may become the page owner. The official
`ModelsSection` remains the page owner.

## 2. Runtime Symbols

### Composition

```text
cordis.patch.yml
  exact target disable: llm-pi-ai
  exact target disable: ui-settings-models
  independent insert: llm-pi-ai-multikey
```

### Provider entry

```ts
export const name = 'llm-pi-ai-multikey'
export const inject = ['llm']
export function apply(ctx: Context, config: Config): void
```

The replacement entry must bind the inserted Cordis row: both the bundle entry
id and the exported `name` are `llm-pi-ai-multikey`. It must not export
`llm-pi-ai`, because that row is disabled and the replacement would never bind.
The settings namespace remains `llm-pi-ai`, and the provider route identities
remain unchanged.

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

interface ReplacementProviderProfile extends OfficialProviderProfile {
  apiKeyPool?: ApiKeyPool
}
```

The actual TypeScript types must reuse the copied official profile types or
extend them without duplicating official field definitions.

Required symbols:

```text
Config
resolveProfiles
assertServiceable
compileKeyPool
```

`compileKeyPool` returns an immutable descriptor without reading secrets.
`resolveProfiles` attaches the compiled pool descriptor to the immutable
profile snapshot. A profile without a pool preserves the official resolver
output and single-key behavior.

### Key pool

Required symbols:

```text
KeyPoolRuntime.select(excluded)
KeyPoolRuntime.reserveExact(keyId)
KeyPoolRuntime.recordSuccess(keyId)
KeyPoolRuntime.recordAttemptFailure(keyId, code)
KeyPoolRuntime.release(keyId)
KeyPoolRuntime.view()
```

`KeyPoolRuntime` owns no credential values. Its state is process-local, keyed by
route and descriptor id, and carries forward only across unchanged id/reference
pairs.

### Credential boundary

Required symbol:

```text
resolveAttemptCredential(ctx, credentialRef): Promise<string>
```

The function:

1. validates the reference;
2. resolves the value from the DSH credentials service or launch environment
   according to the official credential contract;
3. validates the value with the official API-key validator;
4. returns it only to the adapter attempt scope;
5. never logs, serializes, caches, or returns it to the client.

### Adapter

Required symbols:

```text
captureAttemptSnapshot
OfficialDerivedPiAiAdapter.stream
streamAttempt
classifyAttemptError
terminalResponse
propagateAttemptError
```

`captureAttemptSnapshot` must capture provider profiles, model, and model
collection before the first await. `streamAttempt` must preserve the official
`GenerateOptions` semantic content and pass only the selected credential through
the pi-ai authorization option.

The adapter's attempt state is:

```text
selected descriptor
attempt-local credential
started
committed
terminal
failure classification
```

Only the adapter may transition from a failed attempt to key-pool selection.

### Control

Required symbols:

```text
MultiKeyControl
mountMultiKeyControl
```

The loopback control supports only redacted health view and explicit key probe.
The endpoint must reject unknown operations and malformed payloads explicitly.
It must never accept a credential value from the browser.

## 3. Configuration Persistence

The Models editor must use the existing official mutation path:

```text
settings.describe
  -> redact/join provider profile
  -> render existing ProviderEditor
  -> settings.mutate path [...settingsPath, 'apiKeyPool']
  -> settings/document-updated
  -> existing store reload
```

Credential input uses the existing credential path:

```text
user enters new key
  -> credentials.set({ ref, value })
  -> settings.mutate apiKeyEnv/apiKeyPool references
```

The client must not rebuild or replace the whole `llm-pi-ai` section from a
redacted snapshot. It must issue path operations for fields it owns, preserving
unknown official fields and concurrent settings outside the editor.

## 3.1 UI Mockup States

Three UI states are committed to before implementation, frozen as interactive
HTML and fixed-viewport PNGs. They are the only UI surface the implementation may add
on top of the official `ModelsSection`:

| State | Where multikey UI appears | Mockup screenshot |
| --- | --- | --- |
| Not configured | Only in the official Add provider selector; the editing surface shows the official fields and no multikey block | `docs/ui/multikey-ui-states.html` section 1 (desktop, mobile, dark) |
| Configured | The provider row shows the official layout alone; no multikey block until Edit | `docs/ui/multikey-ui-states.html` section 2 (desktop, mobile, dark) |
| Editing configured | The official `ProviderEditor` gains one `Additional API Keys` block under the existing API key and Customized settings; the block follows the official card chrome | `docs/ui/multikey-ui-states.html` section 3 (desktop, mobile, dark) |

The block exposes only:

- Mode (`priority` / `weighted`) and `max attempts` inputs.
- Health policy inputs: `failureThreshold`, `openCircuitMs`.
- Per-key rows: key id, credential reference, priority, redacted status
  (`Healthy` / `Open`), and a `Probe` action that hits the loopback control.
- One inline `Add Key` form with key id, credential input, priority, and an
  `Add` action. Submitted alternates enter `apiKeyPool.keys` via
  `settings.mutate`; the credential itself lands through `credentials.set`,
  matching the official editor's split write path.

Mockup additions stay inside the official `ProviderEditor` for a configured
`llm-pi-ai` row. They do not introduce a second Models section, a Plugins
page editor, a new card type, a navigation item, or any route. They reuse
the official CSS variables, capsule controls, and spacing tokens; new CSS is
scoped to the block and matches the existing 14/22 body, 12/18 caption, and
+12px rounded corners used throughout the page.

Frozen mockup artifacts:

- `docs/ui/multikey-ui-states.html` (interactive fragment, design source)
- `docs/ui/multikey-ui-states.standalone.html` (Playwright-rendered wrapper)
- `docs/ui/multikey-ui-states.desktop.png` (1440x1800)
- `docs/ui/multikey-ui-states.mobile.png` (390x1700)
- `docs/ui/multikey-ui-states.dark.png` (1440x1800 dark scheme)

Viewport checks confirmed zero horizontal overflow at 1440px and 390px; the
`mk-key-row` grid uses four mixed tracks
(`minmax(110px,1.1fr) minmax(150px,1.7fr) 70px minmax(110px,auto)`);
the priority track is fixed at 70px and the action column is auto-sized,
which prevents the 4px overflow at the 1440 viewport that the original 90px
column produced.


Pool writes must be atomic at the settings layer. A partially written pool is
invalid. A credential write that succeeds while the following settings write
fails is reported as a visible write failure; it must not be silently reverted
or represented as a successful provider configuration.

## 4. UI State and Exposure

The store's row derivation remains:

```text
rows = directory providers joined with settings namespaces and credentials
configured = effective profile exists at entry.settingsPath
configuredRows = rows.filter(configured)
addableRows = rows.filter(!configured && settingsPath is writable)
```

`apiKeyPool` is read only from the configured profile at
`llm-pi-ai.providers.<provider>`. It is not derived from a separate namespace,
localStorage, URL, or process state.

Pool controls are mounted only under:

```text
ModelsSection
  -> configured provider row
  -> official Edit action
  -> ProviderEditor
  -> Pi-AI pool block
```

They are absent from:

- Add provider selector;
- unconfigured provider rows;
- custom-provider creation card before save;
- onboarding page outside the existing editor;
- Plugins page;
- any second settings section.

The pool block must use the official card's existing `field`, `input`,
`customized`, `linkButton`, `iconButton`, and responsive layout classes where
possible. New CSS is limited to row/grid details that cannot reuse an official
class. It must not change official typography, spacing scale, colors, or card
nesting.

## 5. Selection and Error State Machine

```text
Idle
  -> SnapshotCaptured
  -> KeySelected
  -> CredentialResolved
  -> AttemptStarted
  -> OutputCommitted
  -> TerminalSuccess

CredentialResolved
  -> AttemptCredentialFailure
  -> AccountFailureBeforeOutput
  -> KeyStateUpdated
  -> KeySelected

AttemptStarted
  -> NonAccountFailureBeforeOutput
  -> OriginalError

OutputCommitted
  -> Any terminal result
  -> Original result, no switch

NoEligibleKey
  -> Explicit NO_ELIGIBLE_CREDENTIAL
```

The test design must cover both directions for each guarded transition:

- account failure before output advances;
- the same account failure after output does not advance;
- server/transport/timeout failure before output does not advance;
- successful terminal output marks the key healthy;
- final account failure returns the original failure;
- no eligible key returns explicit exhaustion.

## 6. Official Parity Matrix

The implementation must record a parity result for every row:

| Area | Required parity |
| --- | --- |
| Catalog routes | same provider ids, display names, model ids |
| Custom routes | same declared route fields and validation |
| Model resolution | same modalities, context, reasoning, max tokens |
| Discovery | same catalog short-circuit and endpoint behavior |
| Context | same messages, tools, images, and attachment handling |
| Replay | same assistant replay state and foreign-message handling |
| Stream | same block, usage, finish, error, and abort semantics |
| Timeout | same idle and SDK timeout behavior |
| Retry | same registered provider policy; no new request-level retry |
| Settings | same namespace, paths, and validation boundary |
| Directory | same configured and dormant provider exposure |
| Models | same rows, Add selector, editor, onboarding, copy, CSS, responsive layout |

The only expected behavior difference is selection of another credential after
an eligible pre-output account failure when `apiKeyPool` is configured.

## 7. Test Cases Before Implementation

### Configuration

- official profile without `apiKeyPool` resolves unchanged;
- valid priority pool compiles;
- valid weighted pool compiles;
- duplicate ids fail;
- duplicate references fail;
- reserved `primary` alternate id fails;
- invalid reference/id/priority/weight fails;
- all-disabled pool fails;
- invalid max attempts fails;
- invalid health policy fails;

### Key pool

- priority chooses the lowest eligible priority;
- weighted uses only eligible descriptors;
- disabled/open/trial descriptors are excluded;
- circuit expiry reopens a descriptor;
- success resets health;
- threshold failure opens health;
- configuration update carries health only for unchanged id/reference;

### Credential

- selected reference resolves one value;
- missing reference returns `MISSING_CREDENTIAL`;
- invalid value returns the official credential error;
- value is not present in descriptors, views, errors, or logs.

### Adapter positive/negative pairs

- invalid primary then valid alternate before output switches;
- invalid alternate then valid primary before output switches;
- auth/quota/rate-limit account codes are eligible;
- request/model/content errors never switch;
- server/timeout/transport errors never switch;
- caller abort never switches;
- first text/reasoning/tool output commits and prevents switching;
- final account failure preserves original terminal output;
- no eligible descriptor returns explicit exhaustion.

### Models client

- official configured row snapshot remains unchanged without pool;
- unconfigured provider is absent from configured rows;
- same provider is present in Add selector;
- pool block is absent for unconfigured provider;
- pool block appears only in opened configured ProviderEditor;
- save writes `apiKeyPool` into `llm-pi-ai.providers.<provider>`;
- concurrent unrelated settings are preserved;
- probe returns redacted health only;
- no second Models section or plugin route is registered;
- desktop and mobile renders contain no overlap or overflow.

### Composition and restore

- wrong patch target name fails;
- official and replacement active together fails owner count;
- replacement install produces exactly one owner per exclusive resource;
- removal without restart is rejected as restore evidence;
- removal plus exact restart restores official entries;
- original provider and Models paths replay after restore.

## 8. Implementation Stop Conditions

Do not activate the package when any of the following is true:

- official parity is unknown;
- a copied official module has an unreviewed semantic delta;
- a second payload/control path exists;
- a second Models/page/namespace owner exists;
- a credential value appears in a snapshot, error, log, control response, or
  business payload;
- an account failure switch occurs after business output;
- a non-account failure switches keys;
- an invalid pool is stored;
- the official entry name is used as the replacement name in the patch;
- restore is tested only through hot reload;
- an architecture registry points to a non-existent symbol or path.
