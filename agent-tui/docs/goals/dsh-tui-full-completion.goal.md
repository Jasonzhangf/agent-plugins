# dsh-tui Full Completion Goal

```text
/goal
目标：以最新 `origin/main` 为唯一基线，完成 dsh-tui 的 Phase E、Phase F、Phase G，并把经过构建、阶段 review、运行时验收的最终结果合入并推送到 `main`。

说明：本任务不需要再写新的提示词，直接按实现文档执行。

实现文档：
docs/goals/dsh-tui-full-completion-plan.md

执行规范：
- 先读最新 `origin/main`、`note.md`、当前 run notes、resource/function/mainline/verification maps；只在从该 receipt 创建的独立干净 Playground worktree 开发，main worktree 只做集成，顶层 dirty tree 不得作为来源。
- 每个 milestone 都必须按“落盘实现 → 定向测试/构建/typecheck/design/boundary gates → 模块边界自检 → 精确 checkpoint commit → AGY Review MCP”执行；FAIL 回唯一 owner 修复，重新构建、验证、提交并创建新的 review。
- AGY PASS 后才可合入最新 main；在 main 重跑受影响 gates，创建 delivery commit，推送并证明本地 HEAD 等于远端 `main`。任何后续代码/测试/构建/运行配置变更都会使旧 PASS 失效。
- 保持唯一 owner：status/footer 只归 status-footer-plugin，frame 只归 app-container，primitive realization 只归 terminal-ui，terminal mount/render/restore 只归 terminal-lifecycle，Session/Host mutation 只归现有 Session owner；Phase E 删除 terminal-ui 遗留 footer 投影死路径并做零引用审计。
- 禁止 fallback、silent strip、第二调度器、私有 import、metadata 控制语义混入业务 payload、替代 Host/Session/provider/model，以及未登记 owner 或调用边。
- 每个阶段更新 worker-owned collab actor/heartbeat/run notes/evidence；collab daemon 不可用时显式记录，不得伪称已受控协作。
- commit 前检查 staged stat/name-status，只提交本阶段声明的 contracts/source/tests/scripts/maps/docs/CI；禁止生成物、缓存、截图、tarball、secret 和他人改动。

验证：
- 每个 milestone：pinned AppSDK 0.1.3 verify、design/maps lockstep、source ownership/import edges、runtime boundaries、typecheck、targeted positive/negative tests、affected builds、AGY Review PASS。
- Phase E 完成后按 Section 16.8 跑 installed artifact 矩阵：clean install、npm ls、CLI help、PTY 默认/resize、终端恢复、在线提交、public history convergence、official WebUI 同 Session、默认/compact 布局和错误路径。
- 最终：AGY Review MCP 对 exact runtime-verified candidate 返回零 P0/P1 PASS；PASS 后在最新 main 重放受影响验证并确认远端 receipt。

完成标准：
- Phase E/F/G 的源码、构建、安装、运行时、review、commit 和远端 receipt 证据全部落盘，并绑定同一最终 main commit。
- status-footer-plugin 是唯一 footer 投影 owner，五个 region 在默认/compact 布局均恰好一次、revision 一致。
- 安装版 dsh-tui 能完成 current-cwd Session、slash command、session switch、overlay、multiline composer/local echo、status/footer、PTY 恢复和 official WebUI 同 Session 互操作。
- 最终源码、构建产物、安装 realpath、runtime evidence 和 AGY Review PASS 绑定同一 commit；本地 HEAD 等于远端 `origin/main`，claim/worktree 清理有记录。
```
