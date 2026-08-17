# Multi-Key Pi-AI Official-Derived Replacement Plan

Status: design pending automated approval

## Goal

Keep the official Pi-AI provider experience and configuration identity while
adding multiple credential references to each configured provider. Existing
provider routes, model ids, the `llm-pi-ai` namespace, discovery, replay,
reasoning, timeout, retry-policy registration, onboarding, and Models layout
remain unchanged.

## Decision Order

1. Prefer an additive extension inside the official provider and Models page.
2. The installed `0.1.0-rc.6` provider exposes no adapter/config injection
   seam: `apply()` constructs `PiAiAdapter` internally and owns exclusive
   routes plus the `llm-pi-ai` namespace.
3. The installed Models client exposes no provider-editor child slot and owns
   exclusive `settings.section:models`.
4. Therefore use the allowed final option: an official-derived whole-entry
   replacement with the smallest source delta.

This is not a second configuration path. The official packages stay installed.
The bundle only disables their entries by exact package name and inserts one
replacement entry:

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

`name` is the target-package guard, not a rename value. Installed state must
have exactly one owner for provider routes, `llm-pi-ai`, and the Models section.

## Official Baseline

- Source scaffold: official DeepSeek Harness commit
  `47f943859bef60e4160492346772ded9b24f765a` (`0.1.0-rc.5`). It provides the
  auditable provider and Models source structure and presentation baseline.
- Runtime authority: signed npm artifacts
  `@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.6` and
  `@deepseek-ai/dsh-client-ui-settings-models@0.1.0-rc.6`, pinned by lockfile,
  npm integrity, and SHA-256.
- rc.6 publishes compiled files and declarations but no source or `gitHead`.
  The implementation must not claim an rc.6 source fork. It must reconcile the
  official source scaffold to rc.6 through parity tests against the installed
  artifacts.
- The built plugin has no runtime dependency on a Harness checkout.

## Minimal Delta

Provider:

- retain official profile, catalog, context, replay, stream conversion,
  discovery, directory, settings, and route registration code;
- add only `apiKeyPool` schema/validation, typed key-pool control state, and a
  credential-attempt loop inside the provider adapter;
- preserve the original single-key path when `apiKeyPool` is absent;
- do not add `multikey/*` routes or an `llm/stream` hook.

Models client:

- retain official `ModelsSection`, configured-row list, dormant Add provider
  selector, `ProviderEditor`, onboarding, store, locales, CSS, spacing, and
  responsive behavior;
- add alternate Key rows and pool policy fields inside the existing
  `ProviderEditor` only;
- an unconfigured provider remains absent from configured rows and is shown
  only in the existing Add provider selector;
- pool controls appear only after that provider is selected/configured and its
  existing editor is opened;
- add no page, navigation item, standalone settings card, or duplicate editor.

## Configuration

`apiKeyEnv` remains the primary credential reference. `apiKeyPool` is an
optional sibling containing alternate references and policy:

```yaml
llm-pi-ai:
  providers:
    opencode-go:
      apiKeyEnv: OPENCODE_GO_API_KEY
      api: openai-completions
      baseURL: https://opencode.ai/zen/go/v1
      models:
        - id: deepseek-v4-flash
      apiKeyPool:
        mode: priority
        keys:
          - id: secondary
            credentialRef: OPENCODE_GO_API_KEY_2
            priority: 10
```

The primary reference participates as `primary`; it is never duplicated inside
`keys`. A profile without `apiKeyPool` is the official single-key behavior.

## Runtime Boundaries

- `GenerateOptions`, messages, metadata, stream chunks, sessions, and model ids
  carry no key id, attempt, health, selection, probe, or retry state.
- Credential values exist only during one outbound attempt.
- Key advance is allowed only for explicit credential/account failures before
  the first business content or tool chunk.
- Caller abort, invalid input/model/content, context overflow, server, timeout,
  transport, and unknown errors never switch keys.
- Harness retry remains the only request-level retry owner.
- Probe and health use typed loopback control resources, never business payload.

## Restore

Restoration requires removing the replacement bundle and patch, restarting DSH
by exact service or PID, proving official entries active and replacement absent
in `dump-config`, then replaying one original provider/model call and one Models
settings operation. Hot reload alone is not evidence.

## Approval And Delivery

Before implementation, every architecture registry is `design`, the design
gate passes, and DSH Review returns PASS. The canonical design documents are:

- [Architecture implementation design](../architecture/implementation-architecture.md)
- [Detailed design](../architecture/detailed-design.md)

After approval: copy the declared official source scaffold, write red parity
and pool tests, make the minimal delta, run architecture/type/lint/test/build
gates, pack, install, restart, verify unique owners and the exact UI exposure
rule, run live positive and negative provider calls, restore and replay
official paths, then run final DSH Review.
