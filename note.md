# Working notes

## 2026-08-17 implementation audit after approval

- Baseline source tests were 31/32; the sole failure was a stale source-shape
  assertion after the copied official Models client moved actions into
  `EditorFooter`. The parity assertion now follows the real component boundary.
- Three implementation defects were confirmed before architecture activation:
  `failureThreshold` was parsed but every account failure opened the circuit;
  pool mutations reused the original namespace revision; deleting the final
  alternate persisted a one-key pool instead of removing optional `apiKeyPool`.
- Unique owners remain `KeyPoolRuntime` for health transitions and
  `pool-control.ts` plus `ProviderEditor` for same-editor settings revision
  coordination. Credential values remain on the credential channel only.

## 2026-08-16 official-derived minimal replacement redesign

- Jason locked three priorities: official experience, additive insertion first,
  and official-derived whole replacement only when the official seam is too
  coarse.
- Installed rc.6 provider has no adapter or credential-resolver injection seam;
  routes and `llm-pi-ai` namespace are exclusive. Installed Models client has
  no provider-editor child slot and owns exclusive `settings.section:models`.
- Selected design: keep official packages installed, exact-name disable their
  entries, insert one official-derived replacement, retain the single
  `llm-pi-ai` configuration and all public route/model identities.
- UI delta is restricted to alternate Key and policy fields inside the existing
  official `ProviderEditor`. Unconfigured providers remain absent from rows and
  appear only in the official Add provider selector.
- Official source scaffold is pinned to commit
  `47f943859bef60e4160492346772ded9b24f765a`; signed rc.6 npm artifacts are
  runtime parity authority. The project does not claim unavailable rc.6 source.
- New design gate result: `DESIGN_GATE: PASS`. DSH Review is required before
  implementation.

## 2026-08-16 r27 Jason source-independence direction

## 2026-08-17 architecture & detailed design approval round 29/30

- Jason 锁定的最终方向：体验与官方一致；插入优先；官方 seam 太粗时整块最小替换。
  本轮严格只做架构 + 详细设计，不写代码，等标准审批通过。
- 完成 `dsh-multikey-provider/docs/architecture/implementation-architecture.md`、
  `dsh-multikey-provider/docs/architecture/detailed-design.md`，并把两份文档纳入
  composition / lifecycle / wiki / outputs / goal 的 canonical docs。
- `verify-design.mjs` 增加「设计文档必须存在且 canonical doc 可解析」门禁；
  module registry 将 `secret-control` / `transition-delete` 标注
  `delete-after-design-approval`，`active-gate` 标注
  `pending-revision-after-design-approval`，并在 transition.activation_rule
  中要求移除 allowed edges / call-map 端点 / resource 关系 / verification gate 目标。
- DSH r29 (`multikey-design-approval-20260817-r29`, commit `51a4dd6`) 返回
  `VERDICT: FAIL`：P1 入口名 `llm-pi-ai` 与 cordis row `llm-pi-ai-multikey`
  冲突；P2 模型客户端 mount 边缺失、`KeyPoolRuntime.recordFailure` 与
  registry 的 `recordAttemptFailure` drift、`PiAiAdapter.stream` vs
  `OfficialDerivedPiAiAdapter.stream` drift、verification-map gate 仍指向
  `tests/wire.test.ts` / `tests/secret-control.test.ts`（transition-delete 路径）。
- 修复 commit `f834adb` 重新提交设计：
  1. `detailed-design.md` 入口名锁定 `llm-pi-ai-multikey`，明确禁用
     `llm-pi-ai`；`KeyPoolRuntime.recordAttemptFailure`、
     `OfficialDerivedPiAiAdapter.stream` 对齐 registry。
  2. `function-map` / `mainline-call-map` / `lifecycle` 增加
     `ComposeIn03MountModelsClient`，把客户端 mount 路径绑定为 composition 边
     `composition->models-client`。
  3. `verification-map` 把 `tests/wire.test.ts` / `tests/secret-control.test.ts`
     从 implementation.adapter / implementation.control gate 中移除，加入
     `active_gate_contract` 显式声明 `pending-revision-after-design-approval`
     与 required revision 文本。
  4. `lifecycle.verification_gates` 改为 registry 内的 gate_id 列表，
     并补 `graph_semantics.call_map_binding` / `layering` 与 graph 层语义。
  5. `verify-design.mjs` 新增 detailed design ↔ registry drift、transition
     registry cleanup、composition mount 边、lifecycle↔gate 解析、active
     gate contract 状态门禁。
- DSH r30 (`multikey-design-approval-20260817-r30`, commit `f834adb`) 返回
  `VERDICT: PASS`。Final 留下 4 条 P2（entry feature 未绑定、文档歧义措辞、
  `src/key-pool.ts:114` 现存 stub 仍是旧名 `recordFailure`、design doc 用
  substring 匹配），全部允许进入实现阶段，后续随 AST active gate rewrite
  一起修。
- 当前 commit HEAD：`f834adb`。下一步：实现阶段需重写
  `scripts/verify-architecture.mjs` 到 official-derived 模块图；删除
  `src/wire.ts` / `src/secret-control.ts` / `tests/wire.test.ts` /
  `tests/secret-control.test.ts`；同步把 `recordFailure` 重命名为
  `recordAttemptFailure`；按 gate/active gate 触发实现 gate；最后再起一次
  DSH delivery review。

- Jason 再纠正：插件不依赖 DSH 源码，也不 import 官方
  `@deepseek-ai/dsh-llm-pi-ai` / Models client；只管理已安装版本的 profile
  配置。
- 官方包仍 installed，但 entry 被 cordis.patch 按精确 name 禁用；替代 entry
  自己注册原 routes/namespace/Models section。
- 独立 provider 用 `@earendil-works/pi-ai` + 公开 DSH contract
  (`dsh-llm`, `dsh-credentials`, `dsh-settings`, client wire) 实现。
- `official-provider` 模块语义改为 `provider`，`wire.ts` 负责 pi-ai event ->
  DSH StreamChunk 翻译。
- 下一步：设计文档 + gate 对齐 -> DESIGN_GATE PASS -> DSH Review PASS 后才做
  完整实现与安装/恢复验证。

## 2026-08-16 Jason source-independence correction r26

- Jason 再次纠正：插件不能依赖官方 `@deepseek-ai/dsh-llm-pi-ai` 源码或
  entrypoint，只能管理已安装 DSH 版本的配置。
- rc.6 官方 `PiAiAdapter` 每请求只解析一个 `apiKeyEnv`；纯配置无法实现
  key-pool/failover。因此设计改为：不 import 官方 Provider，使用公开
  `dsh-llm`/`dsh-credentials`/`dsh-settings` 接口和
  `@earendil-works/pi-ai` 构建插件自己的 pool adapter。
- 官方 Provider 保持 installed/active，不改其 routes/namespace；插件只加
  `multikey-provider` namespace 与 pool routes。
- 现有 r21-r25 设计/实现以官方 entrypoint 组成为主，全部设计文档需按此
  边界修订后再跑 design gate + DSH Review。

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

## 2026-08-17 r35 design diagram review fixes

- DSH Review r35 FAIL on f57cb17: module-ownership diagram asserted undeclared Config->Credential and Composition->Entry edges; attempt-state-machine omitted AttemptCredentialFailure and post-output no-switch; renderer versions unpinned; architecture->diagrams control edge was inert.
- Fixed: diagram only draws registry-declared import/control/composition edges; state diagram now includes AttemptCredentialFailure, successful-before-output terminal, and OutputCommitted->OriginalResultNoSwitch; manifest pins mmdc 11.12.0 + Chromium 151.0.7922.34; module registry records verification_edges for architecture->ui-states and architecture->diagrams with paths/operation; design gate parses diagram edges, validates verification edges, checks diagram manifest renderer metadata, and validates UI color schemes.
- Clean tree design gate passed before review submission.

## 2026-08-17 design handoff to Jason

- Jason requested the complete design be written to disk with diagrams and
  reviewed before deciding whether to continue implementation.
- Clean commit `a3ed3799f638c66e6416689bb6a3dfd7b8b07dca` is the design
  baseline. `node docs/architecture/verify-design.mjs` on a pristine temp
  worktree outputs `DESIGN_GATE: PASS`.
- DSH Review r36 at the same commit is `VERDICT: PASS`, no P0/P1, three P2
  advisories: machine-enforced undeclared `--verify-source` spawn bijection,
  single-source renderer version constants, and exact renderer acquisition
  paths. These are planned hardening items before the final implementation
  review, not design blockers.
- Handoff is review-only. Implementation worktree still contains pre-approval
  legacy source; it is not part of the approved design evidence.

## 2026-08-17 architecture activation + implementation audit round 2

- Source tests after fixing the stale Models `editorActions` assertion: 33/33
  pass, with all paired positive/negative coverage for key pool, credential
  boundary, control/probe, payload isolation, and editor revision drift.
- Three implementation defects were caught before activation and fixed:
  `failureThreshold` now gates circuit opening instead of being parsed and
  ignored; pool mutations use the latest `namespace.revision` returned from
  each write; removing the last alternate unsets `apiKeyPool` to restore the
  official single-key posture.
- Architecture registries activated: composition, resources, modules,
  function map, mainline call map, verification map, lifecycle, and
  upstream delta all flipped to `status: "active"` with `binding-pending`
  replaced by `active` on every bound symbol. Forbidden legacy paths
  (`secret-control`, `transition-delete`, `src/official-provider`) deleted from
  module registry; restore-script internals collapsed into one operations
  entry (`verifyRestoredProfile`) so the call-map/lifecycle bijection is
  clean.
- `pnpm run check` now runs `verify:architecture` first and emits
  `REGISTRY_GATE: PASS` (no design gate run, since registries are active).
- Design CI workflow already short-circuits to the active gate when no
  `"status": "design"` registries exist, so the pipeline contract is
  unchanged.
