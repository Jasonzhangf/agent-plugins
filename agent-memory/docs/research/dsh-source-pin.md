# DSH 源码固定

状态：MAIN01 已验证（源码调查）；运行时安装版本另行记录。

## Source identity

- Remote: `https://github.com/deepseek-ai/deepseek-harness.git`
- Exact HEAD/tag: `4e84901e6471b79ec0338099867ebb4606d12bb5` / `dsh-v0.1.2-alpha.4`
- License: MIT（仓库根 LICENSE；发布包 `@deepseek-ai/dsh` 亦声明 MIT）
- 本机用户入口：`/opt/homebrew/bin/dsh` = `0.1.1-rc.2`，不是上述源码版本；因此不能用本机旧包证明 alpha.4 行为。

## Verified seams

1. `packages/core/session/src/types.ts:300-336` defines `assistant/message`, `tool/call`, and `tool/result`. `tool/result` has `message`, optional `error`, and tool-private JSON `meta`; there is no sibling `memory` field in the pinned source.
2. `packages/core/session/src/surface.ts:80-123` projects only `user/message`, `assistant/message`, and `tool/result` into model history. Log-only events do not enter the model surface.
3. `packages/compaction/compaction/src/index.ts:83-164` defines one `ctx.compaction` service with abstract `compactIfNeeded`, `compactNow`, and `compactRegion` operations.
4. `packages/compaction/compaction-basic/src/index.ts:104-369` implements the default provider and keeps compaction entry points overridable. `packages/compaction/compaction-basic/src/region.ts:403-490` records `compaction/start`, summary, replacement body, and one closing `compaction/end` attempt with stability checks.
5. `packages/compaction/command-compact/src/index.ts:4-97` is backend-independent and calls `ctx.compaction.compactNow`; replacing the provider preserves the command seam.
6. `packages/session/session-projection/src/index.ts:1-130` exposes a registry that drives projections from committed session events; it is suitable for a memory projection but is not the Knowledge truth store.
7. `packages/core/system-prompt/src/index.ts:41-119,226-228,389-536` is the PromptContext/PromptSection owner. `SystemPrompt.context()` registers dynamic model context and `assemble()` deterministically orders sections, contexts, tools and variables. `PromptContext` is a model-facing projection, not a durable store. `packages/core/agent/README.md:158` states prompt registrations are prefix-stable while unchanged and changes may invalidate reuse from the first affected request token.

## Profile wiring truth

Read-only `dsh --dump-default-config` using the installed CLI produced YAML for the `headless` and `web` profiles. Both expose these exact row IDs: `session`, `session-projection`, `compaction-basic`, `command-compact`, `session-checkpoint-policy`, `tool-result-pruner`, and `system-prompt`; headless also includes `agent-loop`, `subagent`, and tool-subagent rows. The `headless` output is `/tmp/dsh-headless-config.json` from the command invocation (the output is YAML despite the filename). These IDs are profile output, not universal constants; dsh-memory must discover and validate them at load time.

## Consequence for memory field

The pinned DSH source has no legal plugin-only sibling field on `tool/result` or `compaction/summary`. Adding a mandatory index-ready `memory` field therefore requires a DSH Core contract extension (or an upstream typed event extension if accepted by DSH maintainers). It must not be smuggled through `meta`, control metadata, or provider request payloads. Until that contract is available, dsh-memory remains design-only at this seam.
