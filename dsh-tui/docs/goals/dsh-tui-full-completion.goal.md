# dsh-tui Full Completion Goal

```text
/goal
目标：按已落盘的剩余设计完成 dsh-tui 全部插件化实现、运行时验收和 main 交付。

说明：本任务不需要再写新的提示词，直接按实现文档执行。

实现文档：
docs/goals/dsh-tui-full-completion-plan.md

执行规范：
- 当前 main receipt 是 `953a95e`，Phase A 已交付。执行顺序固定为 Section 16.1 的 B refresh、C slash/session、D overlay/composer、E status/footer/composition、F runtime、G review/delivery。
- 每个阶段使用最新 `origin/main` receipt、独立 claim 和干净 Playground worktree；先 governance admission，再契约、红测、实现、maps、package script、CI 和文档同步落盘。
- 保持唯一 owner：refresh 只归 refresh-orchestrator，frame 只归 app-container，primitive realization 只归 terminal-ui，terminal mount/render/restore 只归 terminal-lifecycle，Session/Host mutation 只归现有 Session owner。
- 禁止 fallback、silent strip、第二调度器、私有 import、metadata 控制语义混入业务 payload、替代 Host/Session/provider/model，以及未登记 owner 或调用边。
- 每个 milestone 先本地定向测试、build、typecheck、maps/boundaries/runtime gates 全绿，再做模块边界自检；之后只用 AGY Review MCP 只读 review。FAIL 必须回唯一 owner 修复并重建候选与证据。
- commit 前检查 staged stat/name-status，只提交本阶段声明的 contracts/source/tests/scripts/maps/docs/CI；禁止生成物、缓存、截图、tarball、secret 和他人改动。

验证：
- pinned AppSDK 0.1.3 verify、design/maps lockstep、source ownership/import edges、runtime boundaries、typecheck、targeted positive/negative tests、affected builds。
- installed artifact 的 clean install、npm ls、CLI help、PTY 默认/resize、终端恢复、在线提交、public history convergence、official WebUI 同 Session、默认/compact 布局和错误路径。
- AGY Review MCP 对最终候选的零 P0/P1 PASS；PASS 后在最新 main 重放受影响验证。

完成标准：
- 五个显示插件、registry、refresh orchestrator 和五个功能控件均为独立 Cordis 模块，maps active，CI/build/test 可复现，死路径物理删除且零引用。
- 安装版 dsh-tui 能完成 current-cwd Session、slash command、session switch、overlay、multiline composer/local echo、status/footer、PTY 恢复和 official WebUI 同 Session 互操作。
- 最终源码、构建产物、安装 realpath、runtime evidence 和 AGY Review PASS 绑定同一 commit；本地 HEAD 等于远端 `origin/main`，claim/worktree 清理有记录。
```
