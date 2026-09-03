# agent-plugins

OpenCode 插件与客户端集合。

当前第一方组件：

- `agent-memory`：记忆收集、Pending Index、压缩整理与版本化持久化（实现分支正在接入主线）。
- `agent-tui`：基于 OpenCode 公共接口的终端客户端。
- `agent-concurrency-limit`：并发限制插件。

命名约束：本项目内部只使用 `agent-*` 与 OpenCode 术语。外部依赖的发布包名（例如 `@deepseek-ai/dsh-*`）属于兼容边界，保持原名以确保可安装性。
