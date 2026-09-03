# agent-memory

OpenCode memory plugin：模型输出 index-ready memory；Pending Index 在 compaction 边界提交为不可变原始知识和整理增量；分类索引按 epoch 发布，旧知识、证据和整理历史均可回查。

仓库位置：`agent-plugins/agent-memory/`。本目录不是独立 Git 仓库；Git root 与 root `main` 位于上一级。

当前状态：`design / clarification_pending`。禁止业务实现、插件接线、编译、review、发布。

## 根入口

- [MAIN.md](./MAIN.md)：唯一主线、阶段顺序、worktree 和交付门禁。
- [整体执行计划](./docs/plans/overall-execution-plan.md)：从高层设计到 OpenCode 接线的完整阶段。
- [架构分区](./docs/architecture/system-zones.md)：Core、Bridge、Plugin、Wiring 边界。
- [基础能力验证设计](./docs/verification/foundation-capabilities.md)：每项能力的正反验证和完成证据。
- [概要设计](./docs/design/agent-memory-high-level-design.md)：系统目标、资源和主线。
- [Memory Index Protocol](./docs/design/memory-index-protocol.md)：`memory` 字段、Pending Index、整理和 10% 压缩协议。
- [AppSDK 目标契约](./.appsdk/goal.json)：当前目标、验收标准、未决项。

## 项目铁律

1. 根 `main` 只做治理、设计审查、精确集成和主树验证；禁止直接开发。
2. 每个基础能力、基础模块、插件和接线阶段使用 `playground/` 下的独立 clean worktree。
3. 每项基础能力先锁 contract 和正反验证，再实现，再验证；没有独立证据不得进入基础模块。
4. 顺序固定：高层设计 → 架构分区 → 基础能力 → 基础模块 → 插件 → OpenCode 接线。
5. Pending Index 未经成功 compaction 不得进入长期 Knowledge。
6. Control/debug/error/provider/epoch/retry 状态不得进入业务 Memory payload。
7. Runtime 只消费编译、校验、发布后的 Active artifact；不扫描 Playground、Protected 或 generated authoring surface。

## 目标产物

```text
agent-memory-core     Rust 基础能力模块；唯一业务语义 owner
agent-memory-bridge   薄 JSONL bridge；只传输 typed data/error
@agent-plugins/agent-memory  OpenCode plugin；编排、协议接入、命令、工具
OpenCode wiring       接入 compaction、tool/end-turn memory protocol
```

具体 OpenCode seam 以宿主 exact source pin 为真源。
