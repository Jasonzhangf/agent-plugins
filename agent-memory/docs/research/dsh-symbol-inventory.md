# DSH 符号清单（MAIN01）

固定源码：`deepseek-harness@4e84901e6471b79ec0338099867ebb4606d12bb5` (`dsh-v0.1.2-alpha.4`)

| Node | Owner path | Symbols / evidence | Status |
|---|---|---|---|
| session event contract | `packages/core/session/src/types.ts` | `SessionEventMap['assistant/message']`, `['tool/call']`, `['tool/result']` lines 300-336 | active |
| surface projection | `packages/core/session/src/surface.ts` | `deriveEventMessage` lines 80-123; `surfaceOp` validation lines 200-330 | active |
| compaction contract | `packages/compaction/compaction/src/index.ts` | `CompactionEngine`, `compactIfNeeded`, `compactNow`, `compactRegion` lines 83-164 | active |
| default compaction | `packages/compaction/compaction-basic/src/index.ts` | `BasicCompactionEngine`, overrides lines 104-369 | active |
| compaction transaction | `packages/compaction/compaction-basic/src/region.ts` | `compactSurfaceRegion`, `commitCompactionBody` lines 403-490 | active |
| manual command | `packages/compaction/command-compact/src/index.ts` | command handler invokes `ctx.compaction.compactNow` lines 47-97 | active |
| projection registry | `packages/session/session-projection/src/index.ts` | `SessionProjectionRegistry`, `register`, `snapshot` lines 1-130 | active |
| response parser / tool summary | pinned repository search | no `summary`-to-tool-result seam found in DSH Core; tool result is produced by tool execution path | binding pending |
| PromptContext / PromptSection | `packages/core/system-prompt/src/index.ts` | `PromptSection` 53-74, `PromptContext` 77-84, `SystemPrompt.context()` 467-474, `assemble()` 536+ | active |
| profile wiring | installed CLI `dsh --dump-default-config --profile headless|web` | rows `session`, `session-projection`, `compaction-basic`, `command-compact`, `session-checkpoint-policy`, `tool-result-pruner`, `system-prompt` | active (profile-scoped) |
