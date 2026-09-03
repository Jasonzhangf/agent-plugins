# DSH seam 决策

## 保留

- DSH Agent Loop、Session Journal、tool-call/result 配对、Surface 校验与持久化。
- `session-projection` registry 作为只读投影驱动。
- `command-compact` 的命令注册/错误呈现；其后端调用 `ctx.compaction`。
- `tool-result-pruner` 仅作为 DSH 的上下文体积优化；不得承担长期记忆语义。

## 替换

- `compaction-basic`：由 dsh-memory 提供唯一的 CompactionEngine provider，复用其公开 contract，但接管 Pending Index freeze、organization、oldest-10% compression、epoch commit 与 recovery。
- `system-prompt` / PromptContext 的记忆投影部分：新增 dsh-memory projection，保持静态前缀不变，记忆 snapshot 放在稳定前缀之后。

## 新增

- Rust `dsh-memory-core`：contracts、ingest、pending index、revision/evidence store、organization、search/index、recall、epoch/recovery。
- Thin Node/N-API bridge：仅 transport。
- DSH integration plugin：事件监听、合法 memory seam 接入、PromptContext 投影、`/memory-organize incremental|full` 命令、profile manifest 行。
- `tool-memory` 与组织/诊断 side-channel；控制字段不进入业务 payload。

## 阻塞决策

Pinned DSH alpha.4 的 `tool/result` 与 `compaction/summary` 类型没有 sibling `memory` 字段；`tool/result.meta` 明确是 tool-private presentation payload，不能承载该字段。故 mandatory `memory` 需要 DSH Core typed contract 扩展或被上游接受的事件扩展；在此 seam 未确定前禁止实现插件 fallback。

