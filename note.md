# Working notes

## 2026-08-16 dsh-multikey-provider

- Goal source requires a new standalone `dsh-multikey-provider/`; no plan or detailed-design file exists in the current repository or attachment directory beyond the pasted goal text.
- DSH runtime owner is `ctx.llm.registerAdapter()` and `LlmAdapter`; adapter routes are globally exclusive. A plugin can register only new route names and must use `registerConfigurableProviders()` for settings discovery.
- Existing `llm-pi-ai` owns catalog/custom provider construction and OpenAI-compatible wire adapters. A multi-key plugin must not alter Harness or reuse private source imports; published-package dependency versions determine whether the plugin can compile outside the checkout.
- `GenerateOptions` has no key-selection control field. Key selection belongs in the adapter-owned control plane, while the request body and normal metadata remain unchanged.
- Credentials are resolved through `ctx.credentials.resolve(CredentialRef)` and must not be placed in settings payloads, model payloads, session events, or metadata.
- Current repository checkout is DSH `0.1.0-rc.5`; the existing standalone plugin depends on published `0.1.0-rc.6`, so clean-registry verification is an external prerequisite for a release-grade plugin.

## 2026-08-16 replacement redesign

- Jason's design approval found a P0 composition error: Cordis patch `name` is a target-name guard, not a replacement value. `id: llm-pi-ai` with `name: dsh-llm-pi-ai-multikey` is skipped because the installed row is named `@deepseek-ai/dsh-llm-pi-ai`.
- The corrected composition has two explicit owners: target and disable the official provider row with its exact existing name, then insert an independent `llm-pi-ai-multikey` row. The same rule applies to the Models client: the official package remains installed, its `ui-settings-models` row is disabled, and the replacement package's `dsh.client` bundle owns the existing `settings.section` id `models`.
- Official Models exposes no nested provider-card slot. An independent package therefore cannot legally inject pool controls into its component tree. The replacement client must preserve the official Models behavior and add alternate-key controls in its own replacement of the same Models section; a second Models section or Plugins-only pool editor is not acceptable.
- The target package is `dsh-llm-pi-ai-multikey`. It keeps the official route keys, model ids, `llm-pi-ai` settings namespace, catalog/custom-provider behavior, discovery API, and single-key `apiKeyEnv` behavior.
- The replacement Models client keeps `apiKeyEnv` as the primary credential and adds `apiKeyPool` only for alternate credential refs and selection/health policy. It owns add, rotate, status, copy-ref, disable, and exact-key probe actions inside the Models section.
- The replacement adapter is the only outbound owner. It captures one immutable provider snapshot, selects and resolves one credential per attempt, and may advance only before the first content/tool chunk. Key choice, attempts, health, and probe state remain typed control resources and never enter `GenerateOptions`, metadata, session events, or `StreamChunk`.
- Existing provider retry remains outside the adapter. Internal key advance is restricted to explicit credential/account codes; request-shape, model, caller-abort, context, provider transport, and server failures return unchanged to the existing retry/error chain.
- Restore is an uninstall-plus-restart contract, not a hot-reload claim: remove the replacement bundle/patch, restart DSH by exact service/PID procedure, then prove the official provider and Models rows are active while both replacement entries are absent.
- The current `multikey/<pool>` implementation is not the approved target. Its runtime code remains untouched until the replacement design is approved; target registries must be marked `design`/`binding pending` until implementation binds real symbols.
- Future design submissions go through the standard automated approval gate before Jason receives them. For this project that means design consistency checks followed by read-only DSH Review using `opencode-go/deepseek-v4-flash`; findings are fixed before presentation.

## 2026-08-16 automated design approval round 1

- DSH Review task `multikey-design-approval-20260816-r1` returned `VERDICT: FAIL` on commit `0cb19db`.
- P1: `resolveCredential` was a phantom call-map symbol in `src/index.ts` and implied an undeclared adapter-to-entry edge. Correction: credential resolution gets one explicit `credential` module and function-map owner; adapter may call only that module.
- P1: composition mount edges were represented like source imports while composition also forbade `src/**`. Correction: call-map edges distinguish `composition-mount` from `source-call`, and module registry separately declares mount edges while retaining the source-import ban.
- P2: active architecture verification rejects intentional design-status registries. Correction: add a separately executable design gate; production `prebuild` remains the active-registry gate after implementation binding.
- P2: restore gates existed without restore lifecycle nodes. Correction: add remove, restart, official-owner verification, and original-path replay nodes with machine IDs shared by lifecycle, call map, composition manifest, and wiki.
- P2: composition manifest used a descriptive patch object rather than Cordis patch syntax. Correction: `patches` now uses the exact runtime row/insert structure; ownership metadata lives outside the executable patch array.

## 2026-08-16 automated design approval round 2

- DSH Review task `multikey-design-approval-20260816-r2` produced a final document with unambiguous `VERDICT: PASS`, no P0/P1, and four P2 process findings. Its MCP status parser marked the run failed despite the final PASS; the final document is the review truth under the semantic-PASS rule.
- That PASS became stale when the secret reveal/control and gate design changed afterward. It is not approval evidence for the current design; round 3 is required before runtime implementation.
- P2 closure: add a repository CI workflow for the design gate; rewrite the active gate contract around `src/control.ts` and `src/secret-control.ts`; inventory every old source path as physical replace/delete; define `dsh-multikey-provider/` as authoring path and `dsh-llm-pi-ai-multikey` as the only package identity after activation.

## 2026-08-16 automated design approval round 3

- DSH Review task `multikey-design-approval-20260816-r3` returned `VERDICT: PASS`, no P0/P1, with three P2 findings. The PASS became stale on the following corrections, so round 4 is required.
- P2 closure: test design now distinguishes the design-only CI gate from future active lint/coverage/build gates; lifecycle transitions and call-map internal edges are explicit separate graph layers with exact node-id bijection; active symbol binding uses the TypeScript AST plus exact Cordis patch markers instead of loose substring matches.
