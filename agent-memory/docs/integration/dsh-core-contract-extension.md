# DSH Core typed memory contract extension

状态：binding pending；不能以 plugin-only fallback 替代。

## 事实

固定源码 `deepseek-harness@dsh-v0.1.2-alpha.4`（commit `4e84901e6471b79ec0338099867ebb4606d12bb5`）的 `SessionEventMap['tool/result']` 只有 `message`、可选 `error` 和 tool-private `meta`；`compaction/summary` 也没有 sibling `memory`。`meta` 明确属于工具私有 presentation payload，不得承载 dsh-memory 业务字段或控制状态。

## 必需扩展

在 DSH Core 的 typed event contract 中新增可选 sibling 字段：

```ts
type MemoryEnvelopeV1 = {
  entries?: MemoryIndexEntryDraftV1[]
  organized_index?: MemoryOrganizationDeltaV1
}

type ToolResultData = {
  message: ToolResultMessage
  error?: { name: string; code: string }
  meta?: JsonValue
  memory?: MemoryEnvelopeV1
}

type CompactionSummaryData = {
  summary: string
  memory?: MemoryEnvelopeV1
}
```

该字段必须沿以下链路保持 typed sibling 语义：

```text
event type
→ session append / persistence
→ compaction summary record
→ event parser / validator
→ optional memory observer
→ dsh-memory-core BridgeRequest
```

禁止把 `memory` 放入 `meta`、tool arguments、provider request、summary 文本拼接或控制 metadata。

## 影响面

需要同步 DSH Core：

- `packages/core/session/src/types.ts`：event declarations；
- `packages/core/session/src/invariant.ts`：event validation 保持 memory optional；
- `packages/core/session/src/surface.ts`：memory 不改变 surface message projection；
- `packages/session/session-persistence/**`：持久化和恢复保留字段；
- `packages/compaction/compaction-basic/**`：summary transaction 携带字段；
- `packages/extensions/tool-cordis/src/api-catalog.ts`：动态 API declaration；
- 对应 contract、persistence、compaction、surface 回归测试。

## dsh-memory 接线条件

只有当该 Core extension 在 exact DSH artifact 中可用后，dsh-memory 才允许：

1. 在 tool-call / end-turn / compaction-summary 观察点读取 sibling `memory`；
2. 调用 Rust `BridgeRequest`；
3. 替换 profile 中唯一 `compaction-basic` provider；
4. 执行真实 tool-call、summary、compaction 和 recovery 验证。

在 extension 未进入运行 artifact 前，dsh-memory 不得伪造“真实 DSH 接线完成”。
