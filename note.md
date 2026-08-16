# Working notes

## 2026-08-16 additive installed-profile correction

- Jason clarified the final boundary: the plugin manages released DSH profile
  configuration and must not replace the official Provider implementation.
- The previous disable-official-provider design was therefore misaligned even
  though it preserved the package on disk. The correct owner model keeps
  `@deepseek-ai/dsh-llm-pi-ai` active and unchanged and registers only new pool
  routes under the plugin-owned `multikey-provider` namespace.
- rc.6 has no Provider-card extension slot, so only the official Models client
  entry is disabled by exact name; the package stays installed and is restored
  by uninstall plus restart.
- The plugin reuses catalog/custom semantics through the installed official
  public entrypoint in an isolated capture context. Harness source remains
  read-only reference and is neither imported nor required at runtime.
- Current runtime source predates this correction and is not approved evidence.
  Registries returned to `design`; implementation may resume only after the new
  design gate and standard DSH Review PASS.

## 2026-08-16 r21 client composition amendment

- Jason 方向再次确认：不依赖 DSH 仓库源码，只管理已安装 rc.6 版本配置。
- 实现前证据发现：official client 是 `window.__ModuleLoader__.load` 浏览器
  bundle，不是可 import 的 public ESM；且官方 `ui-settings-models` row 被
  disabled 后不会进入 client module graph。因此 r20 的
  "official public client apply + wrap Models component" 不可实现。
- r21 修订：host 仍 compose `@deepseek-ai/dsh-llm-pi-ai` 的 public
  `Config`/`PiAiAdapter`；client 改为基于 public wire contracts
  (`llm.providers`, `settings.describe/mutate`, `credentials.describe/set`)
  重实现 Models section 并加 alternate-key controls。
- 已更新 design gate、composition manifest、verification map、active gate、
  goals/detailed-design/wiki/test-design。下一步跑 design gate + DSH Review，
  PASS 后才写实现代码。

## 2026-08-16 Jason source-independence correction

- Jason 明确方向：不依赖 DSH 仓库源码，只管理已安装版本配置。
- r20 已对齐：官方 rc.6 包保持安装，cordis.patch 只禁用官方 entry 并插入
  `dsh-llm-pi-ai-multikey`；替代包只调用已安装 rc.6 的公开 entrypoint。
- 纯配置不足以多 key：官方 rc.6 `Config` 无 `apiKeyPool`，`PiAiAdapter`
  每请求只解析一个 `apiKeyEnv`。必须保留独立 adapter 的 key-pool/credential
  选择逻辑；不能宣称只改配置就能多 key。

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

## 2026-08-16 redesign approval preparation

- The rejected design conditions are now represented in readable files under `dsh-multikey-provider/docs/architecture/`: exact-name disable plus independent insert, explicit Models section client owner, install/restore dump-config fixtures, and exact-one route/namespace/Models owner counts.
- Fixtures are gate inputs only; they explicitly do not count as live install, restart, browser, provider, or restore evidence.
- Standard order for this redesign: run `node dsh-multikey-provider/docs/architecture/verify-design.mjs`, then DSH Review with `opencode-go/deepseek-v4-flash`; only a new PASS permits implementation.
- r16 DSH Review passed, then its two P2 gate findings were closed in commit `92d1fc0`: owner-count resource IDs are now bound in `resource-registry` and `function-map`, and the design gate rejects missing/orphan owner-count resources. A fresh review is required because the review-covered commit changed.

## 2026-08-16 installed-runtime boundary correction

- Jason reconfirmed the implementation boundary: the deliverable is an independent
  plugin that manages the installed DSH profile/configuration; it must not depend on
  a Harness checkout or ship a second copy of the official runtime package.
- Published DSH packages used by host code are shared peer contracts plus dev-only
  test dependencies. The official Provider package remains installed by the DSH
  profile and is loaded through its public entrypoint. The Models package is only a
  patch target and is not imported by the replacement client.
- A package `dependencies` entry for an installed official DSH package would allow a
  second nested copy and violates the installed-runtime ownership boundary. The
  manifest and design gate must enforce peer/dev-only declarations for those packages.

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

## 2026-08-16 automated design approval round 4 and implementation discovery

- DSH Review task `multikey-design-approval-20260816-r4` returned `VERDICT: PASS`, no P0/P1. Evidence: `~/.dsh/reviews/multikey-design-approval-20260816-r4/review.final.md`.
- Published rc.6 provenance is npm-only: GitHub master remains rc.5 at `47f943859bef60e4160492346772ded9b24f765a`; npm rc.6 has no `gitHead`. The provider and Models rc.6 tarballs contain public compiled `apply` entrypoints and declarations but no source.
- Implementation discovery found a smaller official-based replacement: invoke the two public rc.6 `apply` entrypoints through package-owned typed composition facades. The host facade intercepts only adapter registration and credential resolution; the client facade intercepts only registration of `settings.section:models` and wraps the component supplied by official `apply`. It does not import private source or presentation components, and it preserves the official package as the behavioral owner while the replacement package owns key selection, credential substitution, and alternate-key UI/control.
- This changes the approved implementation binding from source vendoring to public-entrypoint composition. It needs a design amendment and fresh automated approval before runtime source edits.

## 2026-08-16 automated design approval round 19

- DSH Review `multikey-design-approval-20260816-r19` returned `VERDICT: FAIL`.
- P0: rc.6 npm artifacts are compiled-only and expose no source or `gitHead`, so "audited rc.6 source fork" cannot be produced from the declared provenance.
- P1: `resolveCredential` was declared in both `src/official-provider.ts` and `src/credential.ts`; only `credential` may own it.
- P2: registry paths referenced `src/official-provider.ts` while the committed stub is `src/official-provider/index.ts`; `UPSTREAM.md` said peer/dev provenance while `package.json` also lists dependencies; CI masked active gates with `|| true` and ran a root `pnpm install --frozen-lockfile` with no root lockfile.
- Revision for r20: revert the runtime strategy to public-entrypoint composition of the compiled rc.6 packages, align paths to `src/official-provider/index.ts`, remove `resolveCredential` from the official-provider owner, keep dependencies consistent with public-entrypoint composition, and make CI run only the design gate during the design phase.
