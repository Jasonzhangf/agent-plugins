# agent-tui Renderer/Lifecycle Reconstruction Plan

## 1. Goal and acceptance

把已完成 OpenCode serve 基础适配的 `agent-tui` 收口为可持续刷新的终端运行时：stream、tool turn、启动加载、历史补载、动画和输入都必须通过非阻塞的 renderer/lifecycle 链路更新，不能因 buffer 或历史加载冻结用户界面。

Acceptance:

- OpenCode SSE 文本、reasoning、tool-call、tool-result 在事件到达后逐帧可见；不等到 turn 结束才一次性渲染。
- buffer 是状态/快照来源，render 是独立消费者；任何 buffer 更新、历史加载或工具等待都不阻塞刷新、动画和输入。
- 启动与历史加载显示可观察的阶段、计时和动画；长历史先投影最新可见内容，再异步补齐旧内容，补载期间仍可输入和刷新。
- 工具状态按语义显示 Read、Search、Write/Edit、Coding；无法解释时显示 Running；等待工具有持续动画与计时。
- 输入区拥有独立灰色背景和真实光标位置；Shift+Enter 换行；运行中 Tab 排队、Enter 加入下一轮；Esc 停止当前 turn；Ctrl+C 只退出 UI，不停止 agent。
- 真实全局 `agent-tui` 通过 OpenCode serve 完成启动、SSE、工具过程、输入、退出和重启验证。

## 2. Scope and boundaries

In scope:

- `agent-tui` 的 `terminal-lifecycle`、`display-buffer-plugin`、`terminal-render-plugin`、`terminal-output-plugin`、`interpreter-plugin`、`presentation`、`app-container`、`app-shell`、`composer-plugin`、`execution-status-plugin` 及其现有 contract/test/build 文件。
- OpenCode adaptor 输出到既有 typed event/presentation contract 的增量刷新绑定。
- 启动加载、历史补载、turn 生命周期和输入事件的刷新调度。

Out of scope:

- `agent-memory`、`teams` 及其 worktree、records 和 adapter。
- OpenCode Host 协议修改、第二协议链、DSH Host 兼容、dsh-multikey-provider。
- FreezeRecord、ReviewRecord、AppSDK maps/version/lock 和历史 evidence 改写。
- 为未来需求新增通用 Manager/Coordinator/Provider 抽象；只修改现有唯一 owner。

## 3. Design principles

1. `transport → semantic presentation → turn state → render snapshot → terminal carrier` 是唯一相邻主链；renderer 不读取 raw event 或 adaptor。
2. 控制面（刷新原因、loading、动画、取消、队列、错误）走 typed side-channel，不进入 OpenCode 业务 payload、metadata 或通用记录。
3. 每个 turn 有独立生命周期和 revision；旧 turn 的延迟结果不能覆盖新 turn，非 terminal 状态不能投影为完成。
4. Buffer 写入与渲染发布解耦：buffer 只提交不可变快照，刷新调度器按最新 revision 消费；历史补载不得占用同步渲染路径。
5. Live tail 可以替换，stable prefix 只能追加或在明确 session epoch 边界重建；不允许 committed row 在固定宽度下原地变更。
6. 所有失败显式进入 terminal error chain；不得 fallback、静默吞错或把失败映射成成功。

## 4. Technical plan and canonical files

### 4.1 Lifecycle and scheduling

Canonical owners:

- `src/experiments/terminal-lifecycle/src/terminal-lifecycle.ts`: 输入、取消、退出和 carrier 生命周期；明确 Esc 与 Ctrl+C 的边界。
- `src/experiments/refresh-orchestrator/src/refresh-orchestrator.ts`: 将 buffer/presentation/animation 变更合并为不可变 refresh publication；不得执行同步历史加载。
- `src/experiments/app-shell/src/app-shell.ts`: 只做相邻编排和 turn command 路由，不持有 renderer 或 composer 的重复状态。
- `src/experiments/app-container/src/app-container.ts`: 只负责稳定区域顺序和快照组合。

Required behavior:

- 每个异步 turn 使用独立 identity、revision 和 terminal state。
- 事件到达立即发布可渲染快照；不得等待完整历史、完整 tool result 或完整 turn。
- refresh publication 不能 await network、history page、tool execution 或 filesystem。
- 动画 timer 只更新 control snapshot，并由 owner effect 清理。

### 4.2 Buffer and rendering

Canonical owners:

- `display-buffer-plugin`: stable prefix、live tail、viewport、有限缓存和历史 prepend。
- `interpreter-plugin`: 将语义 presentation nodes 转为 display elements；不执行 I/O。
- `terminal-render-plugin`: 将 display snapshot 交给 terminal-neutral render seam。
- `terminal-output-plugin`: 唯一 terminal carrier 输出入口。

Required behavior:

- live assistant/tool rows 可在每个 SSE delta 后替换，不改写 stable prefix。
- tool call、tool waiting、tool result 分别有可见的中间状态。
- session history 先加载尾部满足当前显示需求的页面；旧页在独立异步任务中补载并按绝对行号 prepend。
- 页面/摘要大小按实际显示宽度和物理行数估算，不用固定“消息条数”冒充显示需求。
- render 消费最近快照；慢的旧快照丢弃，不阻塞新快照。

### 4.3 Semantic status and themes

Canonical owners:

- `src/experiments/text-parser-plugin/src/text-parser-plugin.ts`：语义识别。
- `src/experiments/theme-plugin/src/theme-plugin.ts`：语义到主题色映射。
- `src/experiments/execution-status-plugin/src/execution-status-plugin.ts`：运行中的语义标签、动画、计时。
- `src/experiments/tool-card-plugin/src/tool-card-plugin.ts`：工具名、参数摘要、Read/Search/Edit/Coding 分类。

Color mapping happens after semantic parsing. File/code、tool、success、warning、error、running 使用主题既有语义角色；不能由 renderer 根据原始字符串再次猜颜色。

### 4.4 Composer and key policy

Canonical owner: `src/experiments/composer-plugin/src/composer-plugin.ts`。

- composer state、cursor、history mode、queued prompts 只在 composer owner 保存。
- app-shell 只接收 typed composer events。
- Shift+Enter 生成换行；Enter 在 idle 提交，在 running 状态生成下一轮队列项；Tab 在 running 状态排队。
- Esc 只发送 stop-turn control event；Ctrl+C 由 terminal lifecycle 执行 UI exit，不能调用 agent cancel。
- 灰色背景和光标均由 composer projection/render contract 表达，不能在 carrier 层补画。

## 5. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| buffer 写入阻塞刷新 | refresh publication 只提交不可变快照；网络/历史加载禁止出现在 render path |
| 旧 SSE 事件覆盖新 turn | turn identity + monotonic revision + stale event rejection |
| 工具中间态被 settlement 覆盖 | call/wait/result 独立 semantic node 与 lifecycle assertions |
| 历史补载造成重复或行号跳变 | absolute row、stable prefix/live tail contract、session epoch reset |
| 动画 timer 泄漏 | Cordis owner effect 清理；dispose 后禁止 publication |
| Esc/Ctrl+C 语义混淆 | 正反测试分别锁 stop-turn 与 UI-exit/agent-continues |
| renderer 再次解析 raw 文本 | architecture boundary gate 拒绝 raw adaptor/transport import |
| 全局入口验证使用旧产物 | build → pack → install → version/hash marker → real PTY 顺序固定 |

## 6. Verification matrix

Before implementation: confirm resource map, function map, mainline call map, module registry and verification map entries for every changed owner.

Red/green tests:

- streaming delta produces visible successive snapshots;
- tool call exposes running/wait/result states;
- slow history load does not block refresh, animation or composer input;
- stale turn/revision is rejected and cannot overwrite current state;
- stable prefix/live tail invariants remain enforced;
- startup progress advances across distinct frames;
- semantic tool labels and theme roles map correctly;
- Shift+Enter, queue Tab/Enter, Esc stop, Ctrl+C UI exit are tested both positively and negatively;
- malformed/unknown OpenCode events fail closed without payload/control leakage.

Build and gates:

```text
appsdk verify .
pnpm run typecheck
pnpm run check
pnpm run check:runtime-boundaries
pnpm run build:runtime
pnpm run check:public-exports
pnpm run check:clean-install
node --import tsx --test tests/**/*.spec.ts
```

Live verification:

```text
pnpm pack
install the newly built agent-tui globally
start the real OpenCode serve endpoint
run /opt/homebrew/bin/agent-tui in a fresh PTY
capture startup, streaming, tool, history, input, Esc, Ctrl+C and /quit
confirm installed artifact identity matches the tested commit
```

## 7. Implementation order

1. Re-read handoff docs and maps; create a fresh run note and claim for the renderer/lifecycle feature.
2. Reproduce the first refresh stall with a deterministic OpenCode SSE fixture and a slow-history fixture.
3. Add minimal failing tests for snapshot publication, independent turn rendering, animation progression and key semantics.
4. Fix refresh scheduling and terminal lifecycle ownership.
5. Fix display-buffer live-tail/history behavior without changing payload semantics.
6. Fix semantic tool status and post-parse theme mapping.
7. Fix composer projection and key routing.
8. Run mapped tests, typecheck, governance and build gates.
9. Pack/install the exact artifact and run fresh real OpenCode PTY/SSE tests.
10. Review the final diff against all maps and only then hand off the verified change set for review/merge.

## 8. Definition of done

- No DSH runtime dependency or old dsh-tui public entrypoint is restored.
- Streaming, tool turns, startup loading, history loading, animations and input are independently observable in the real installed PTY.
- Buffer operations never block render or input.
- Esc, Ctrl+C, Shift+Enter, Tab and Enter obey the stated semantics.
- All required tests/gates/build/install/live checks pass on the same commit and artifact.
- No AppSDK governance truth, historical record, or unrelated project area is modified.

## 9. Long-run execution addendum

本章节用于后续长程执行，保留在同一实现文档中，避免另起一份 renderer/lifecycle 计划。

### 9.1 Current checkpoint

- Startup 已将 raw-history hydration 与 semantic presentation projection 移出 Session 同步通知栈。
- 初始 Session 选择已提供 `Loading sessions` / `Creating session` 运行状态。
- 该修复提交为 `e71c443390d8b604bcfc2b5bb9960ee44051b18e`，并已推送到
  `origin/codex/agent-tui-renderer-20260904`。
- 静态 gates、全量 367 项测试、构建、clean install 和 installed `/quit` PTY 已通过。
- 真实 provider 当前不可用，SSE/tool-turn 正向入口证据仍待补齐。

### 9.2 Remaining implementation and verification

1. 在不修改 agent-memory、teams、OpenCode Host 或治理冻结对象的前提下，继续验证并修复
   SSE delta、reasoning、tool call/wait/result 的逐帧 presentation 与 render。
2. 验证慢 history、启动选择和补载期间 render、动画、stdin 可独立推进；保留失败样本和
   首次偏离证据。
3. 验证 composer 的灰色背景、光标、Shift+Enter、运行中 Tab/Enter、Esc stop-turn、
   Ctrl+C UI exit 语义。
4. 按同一 commit 执行 typecheck、AppSDK verify、项目 check、runtime-boundaries、build、
   public exports、clean install、全量测试，并重新安装 `/opt/homebrew/bin/agent-tui`。
5. 使用真实 OpenCode serve 和新安装入口完成 startup、SSE、tool、history、input、Esc、
   Ctrl+C、`/quit`、restart 验证；provider 不可用时记录为真实阻塞，不伪造 PASS。
6. 所有前置证据完整后，才运行指定 review/admission；通过后再进行 effectiveness、
   integration、merge/mainline receipt 和精确 cleanup。

### 9.3 Long-run completion gate

只有同一测试 commit、同一构建 artifact 和同一全局安装版本在真实用户入口完成上述正向与
反向验证，并取得必要 review/admission、integration 和 remote mainline 证据，才可报告
renderer/lifecycle 重建完成。
