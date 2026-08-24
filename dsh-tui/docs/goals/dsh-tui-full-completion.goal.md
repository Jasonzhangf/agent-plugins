# dsh-tui Full Completion Goal

```text
/goal
目标：完成 dsh-tui 的全部剩余实现，使其成为可安装、可验证、可交付的 Cordis/Ink 终端客户端。

说明：本任务不再生成新的提示词，直接按实现文档执行。

实现文档：
docs/goals/dsh-tui-full-completion-plan.md

执行规范：
- 先读项目 MEMORY.md、note.md、当前 run notes、resource/function/mainline/verification maps 和架构文档；每个阶段使用最新 main receipt、独立 claim、干净 Playground worktree。
- 新模块、资源、函数、调用边、package script 和 CI gate 必须先由 governance-build 以 design/pending 状态登记；未登记或命令不存在时，只能报告 open gate，不能实现冒充可验证。
- 严格按文档 Phase A 到 Phase G 执行：每个阶段先写红测和契约，再实现；模块边界、owner、调用边和 control/payload 隔离必须同步落盘。
- 禁止 fallback、silent strip、重复 owner、第二 Host、替代 Session、私有 import、metadata 混入控制语义和未验证完成声明。
- 每个 milestone 完成后运行定向测试、typecheck、受影响 build、design/boundary gates；精确提交声明 change set，执行只读 `dsh-review` MCP Review，FAIL 必须回唯一 owner 修复并重跑受影响闭环。
- Review 前必须完成 clean install、安装版 CLI、PTY、官方 Host/WebUI 同 Session 在线证据；provider/model 不得替换。
- commit 前检查 staged stat/name-status；只提交本阶段声明的 source/contracts/tests/scripts/docs，禁止生成物、缓存、截图、tarball、secret 和他人改动。

验证：
- governance、maps lockstep、source ownership、import edges、runtime boundaries、typecheck、targeted tests、affected builds。
- chrome display plugins、chrome-slot-registry、refresh-orchestrator、slash/session-switch/overlay/composer/status-footer 和 app-container 的正反生命周期测试。
- clean-registry install、npm ls、installed CLI help、installed PTY、官方 Host/WebUI 双客户端、默认/compact 布局和终端恢复。
- `dsh-review` MCP 只读语义 PASS；通过后在最新 main 上重跑受影响验证并确认本地 HEAD 等于远端 main。

完成标准：
- chrome-controls 已物理删除且零引用；五个显示插件、registry、refresh 编排和五个功能控件均为 active、独立、effect-owned、可构建、可测试的模块。
- app-container 是唯一整体 frame owner，terminal-lifecycle 是唯一 terminal carrier，refresh/invalidation 只有一个 typed owner 和 publication path。
- 安装版 TUI 能完成 current-cwd Session、slash command、session switch、overlay、composer、status/footer、PTY 恢复和官方 WebUI 同 Session 互操作。
- 所有证据与 review 对应同一候选源码/构建版本，最终提交范围精确，远端 main receipt 与本地 HEAD 一致。
```
