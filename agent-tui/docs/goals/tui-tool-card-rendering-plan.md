# TUI 工具卡片、文本解析与交互窗口实现计划

状态：`in_progress`，已进入 runtime 实现

关联设计：[`docs/design/tui-tool-card-rendering-design.md`](../design/tui-tool-card-rendering-design.md)

## 1. 目标与验收标准

实现四个独立能力：

1. `tool-card-plugin`：工具调用/结果语义映射和终端中性卡片描述；
2. `text-parser-plugin`：assistant、工具结果和交互文本的 Markdown 解析；
3. `interactive-window-plugin`：approval、ask、models、provider、permissions 窗口；
4. `execution-status-plugin`：输入框上方的运行状态、计时和 Esc 提示。

验收标准：

- 工具 call/result 以稳定 `callId/nodeId` 合并为一张卡片；
- read 直接显示文件名；shell 使用白色 `Ran`，命令及 `--参数` 红色；
- 成功/失败只用绿色/红色前置点表示，正文白色，reasoning 浅灰；
- edit/diff 显示左侧行号、红色删除、绿色增加、上下最多一行真实白色 context；
- 每轮 transcript 之间有 terminal-only 横线，卡片上下有留白；
- Markdown 支持标题、段落、粗体、斜体、行内代码、代码块、列表、引用、链接；
- `/models`、`/provider`、`/permissions` 可以打开交互窗口并回传 typed result；
- running 状态在 composer 上方显示耗时和 `Esc interrupt`；
- 内部字段、控制字段和 raw event 不进入用户可见输出或业务 payload。

## 2. 范围与边界

### In scope

- 工具语义分类：read、write、edit、search、shell、workflow、skill、generic、error；
- 工具卡片 renderer registry；
- Markdown terminal-neutral AST/block descriptor；
- 轮次分隔和卡片间距；
- approval/question/selector 交互窗口；
- slash command 到 interactive window 的 typed routing；
- execution ticker 与终端生命周期清理。

### Out of scope

- 修改 Host 工具执行逻辑；
- 在 TUI 内重新实现 Session、权限策略或 provider 业务真相；
- 复制 DSH WebUI React renderer；
- 将控制状态写入 Session、metadata 或工具业务 payload；
- fallback 到猜测型 renderer；
- 复杂动画、横向滚动或装饰性边框。

## 3. 设计原则

- `presentation` 唯一负责 call/result 配对和生命周期；
- `slash-command-plugin` 是长期扩展命令 owner，不直接管理窗口；
- `interactive-window-plugin` 是 approval/ask/selector 的唯一交互窗口 owner；
- `text-parser-plugin` 是 Markdown 唯一解析 owner，tool card 不重复解析；
- `tool-card-plugin` 只消费 typed presentation node 与公开 ToolEventView；
- `execution-status-plugin` 只显示 execution projection，不直接取消 Session；
- 所有 renderer 输出 terminal-neutral descriptor；
- 不裁剪真实结果语义，折叠仅属于显示层；
- 控制面、debug、metadata、provider、route、retry 等与业务 payload 物理隔离。

## 4. 技术方案与文件清单

### 新增 owner surfaces

- `playground/experiments/tool-card-plugin/src/tool-card-plugin.ts`
- `playground/experiments/text-parser-plugin/src/text-parser-plugin.ts`
- `playground/experiments/interactive-window-plugin/src/interactive-window-plugin.ts`
- `playground/experiments/execution-status-plugin/src/execution-status-plugin.ts`

### 相关合同与主线

- `contracts/tui/presentation/presentation.types.ts`
- `contracts/tui/component-registry/component-registry.types.ts`
- `contracts/tui/terminal-ui/terminal-frame-tree.types.ts`
- `contracts/tui/logic-controls/logic-controls.types.ts`
- `playground/experiments/presentation/src/presentation.ts`
- `playground/experiments/terminal-ui/src/terminal-ui.ts`
- `playground/experiments/app-shell/src/app-shell.ts`
- `playground/experiments/startup/src/startup.ts`

### Governance同步

- resource map / resource registry：新增四个插件资源及其允许边；
- function map：绑定 parser、semantic mapper、window reducer、ticker；
- mainline call map：绑定相邻调用边，禁止 app-shell 直连 renderer；
- verification map：增加插件测试、Markdown fixture、PTY 和 clean-install gates；
- module registry / build manifest：登记源码 owner、构建入口和 deterministic output。

## 5. 风险与规避

| 风险 | 规避 |
|---|---|
| 工具 renderer 重复配对 call/result | 只允许 presentation 维护稳定 tool node |
| Markdown 解析把 raw/control 字段带入 renderer | parser 只接收闭合公开文本合同，并增加泄露反测 |
| 交互窗口绕过 app-shell 直接调 Host | 所有确认/选择只产生 typed action |
| ticker 引入无限刷新 | execution 进入 running 时启动，终态/dispose 时停止 |
| 横线污染 Session 内容 | 在 terminal-ui transcript realization 阶段插入，不写入 node value |
| 蓝/红/绿颜色扩散到其他区域 | 颜色规则只登记在 tool-card plugin visual contract |
| 长命令或 diff 破坏窄终端 | terminal-neutral blocks 交给 terminal-ui 统一换行和折叠 |

## 6. 测试计划

- lifecycle：pending、running、completed、failed、interrupted、already-terminal；
- tool pairing：稳定 nodeId、重复 result、未知 callId、错误收口；
- semantic mapping：read filename、Ran shell、write/edit/search 分类；
- visual contract：状态点颜色、文本颜色、diff 行号、上下文行、卡片上下留白、轮次横线；
- Markdown：标题、inline、code block、列表、引用、链接、malformed input；
- interaction：approval、ask、models、provider、permissions、Enter、Esc、方向键、stale revision；
- execution：timer start/stop、cancel、Host EOF、failure、dispose、无重复 ticker；
- leakage：metadata、event、seq、provider、route、retry、raw frame 均 fail-fast 或不可见；
- 项目黑盒：真实 Host tool samples、PTY 宽窄终端、clean install。

## 7. 实施步骤

1. 查并锁定 resource/function/mainline/verification map，登记四个插件 owner 和边界。
2. 先写失败测试和 fixture contract，锁定颜色、留白、横线、文本解析和生命周期。
3. 实现 `text-parser-plugin`，让 assistant 与 tool card 共用 terminal-neutral Markdown blocks。
4. 实现 `tool-card-plugin`，先通用/read/shell/error，再 edit/diff/search/write 等专用卡片。
5. 在 terminal-ui 统一加入卡片上下留白和轮次横线 realization。
6. 实现 `interactive-window-plugin`，接入 approval/ask 和 models/provider/permissions selectors。
7. 扩展 `slash-command-plugin`，将交互命令路由到窗口插件，将 Host command 保持原完整输入。
8. 实现 `execution-status-plugin`，接入 execution projection、计时和 Esc typed cancel。
9. 完成模块边界自检、定向测试、typecheck、runtime boundaries、design gate、build、clean install。
10. 用真实 Host/PTY 样本验证，再启动 AGY Review；仅在 PASS 后交付。

## 8. 完成定义（DoD）

- 四个插件均有 active owner、typed contract、测试和构建入口；
- 工具卡片与 assistant Markdown 通过同一 text parser；
- 工具卡片视觉符合已审批颜色规则；
- 轮次横线、卡片留白和 execution status 在真实 PTY 可见且稳定；
- interactive window 能完成 approval/ask/models/provider/permissions 闭环；
- slash command 扩展不破坏 Host command 原始 payload；
- 所有架构与 payload leakage gate 通过；
- 定向测试、全局 gate、build、clean install、真实 PTY 和 AGY Review 全部通过；
- 不修改 root worktree 中未声明的 dirty changes。

## 追加：运行上下文与选择窗口（2026-08-28）

### 目标

- footer 稳定显示当前 model、thinking effort、cwd、permission，以及右下角 goal durable phase；
- `/models`、`/provider`、`/permissions` 使用真实 Host 数据和 session projection，不显示占位项；
- provider 选择先进入该 provider 的真实 model 列表，最终通过 Session owner 的 `selectModel` typed action 生效；
- 选择窗口标题提供 `↑↓ / Enter / Esc` 操作提示，当前项用 `›` 标记；
- 数据缺失时显式显示 unavailable 或报告能力缺失，不从 raw event、metadata 或 prompt 猜测。

### 真源与边界

| UI 信息 | 唯一真源 | 允许路径 |
|---|---|---|
| model / thinking effort | `session.models` 的 `current` | `TuiSessionService → app-shell → status-footer` |
| provider 列表 | `llm.providers` | `startup` 取公开 RPC，交给 interactive-window |
| permission | `SessionProjectionsBlock.values.permissions` | `TuiSessionService snapshot → status-footer/selector` |
| goal phase | `SessionProjectionsBlock.values.goal.goal.phase` | `TuiSessionService snapshot → status-footer` |
| model mutation | `session.selectModel` | interactive callback → `TuiSessionService.selectModel` |

禁止 status footer 读取 raw `event`、`metadata`、route/debug/control 字段；禁止 selector 自造模型、provider、权限选项。

### 实施文件

- `contracts/tui/status-footer-plugin/status-footer-plugin.types.ts`
- `playground/experiments/status-footer-plugin/src/status-footer-plugin.ts`
- `playground/experiments/session/src/session.ts`
- `playground/experiments/interactive-window-plugin/src/interactive-window-plugin.ts`
- `playground/experiments/startup/src/startup.ts`
- `playground/experiments/app-shell/src/app-shell.ts`
- `tests/status-footer-plugin/status-footer-plugin.spec.ts`

### 验证矩阵

- footer 正向：model/provider/effort/path/permission/goal 均投影；
- footer 反向：projection 缺失时显示明确 unavailable/none，不读取内部字段；
- selector 正向：真实 provider/model/permission 项可打开、移动、选择、关闭；
- selector 反向：空目录、未知 item key、过期 revision、缺 projection 显式失败；
- 回归：slash、interactive、app-shell、session、terminal-ui、typecheck、runtime boundary、runtime build。

## 追加：Codex TUI 静态差异闭环与第二阶段动态审计（2026-08-29）

### 目标与验收标准

第一阶段在已提交的 Codex TUI 对照 harness 之上，补齐静态差异判定和可复现的静态场景基线；第二阶段再按语义状态转换执行动态对照。宽度、高度、光标位置和终端重绘属于运行时排版变量，不作为静态内容失败条件，但必须被记录，供动态审计分析。

静态阶段交付必须满足：

- 新 Session、输入框、空闲状态、状态栏、工具卡片、assistant Markdown、历史分割线和交互窗口均有确定性 fixture/帧合同；
- harness 能分别报告内容差异、颜色/ANSI 差异、空行/换行差异、状态文字差异和几何观测值；
- 几何值只作为观测字段，不参与静态 pass/fail；
- 每个静态差异都有唯一 owner、对应测试和修复位置；
- 修改后必须经过定向测试、build、真实 tmux harness 对照；未通过 harness 不得交付。

### 范围与边界

In scope：

- 静态帧归一化和语义比较规则；
- Codex/dsh-tui 的新 Session、composer、footer/status、tool card、历史、overlay 基线；
- ANSI 颜色 token、空行、横线、文件名/命令颜色和隐藏内部字段的差异审计；
- harness 的 fixture 输入、manifest 判定和失败报告；
- 第二阶段动态状态序列的测试设计与审计入口。

Out of scope：

- 不把 Codex 内部 payload、raw event 或私有实现引入 dsh-tui；
- 不把 pane 宽高差异当作静态渲染错误；
- 不在静态阶段混入 Host 工具执行、权限策略或 Session 真相改造；
- 不以截图相似代替语义、颜色、状态和泄漏测试。

### 静态比较模型

第一阶段真实排版基线与目标见 `docs/design/codex-tui-static-layout-audit.md`。
其中 execution 只在 running 态占用可见行；空闲/终态不得额外挤压 composer。

每一帧拆为四类证据：

1. 内容语义：可见文本、节点顺序、工具标题、文件名、行号、diff 行；
2. 排版语义：空行、卡片上下留白、轮次横线、footer/composer 的相对区域；
3. 样式语义：成功/失败点、蓝色文件名、红色命令和 `--` 参数、红删绿加、灰色 reasoning；
4. 环境观测：pane 宽度、高度、cwd、命令、title、采集时间。

静态 pass/fail 只使用前 3 类；第 4 类写入 manifest，允许在动态审计中解释换行、footer 下移和终端重绘。

### 文件与 owner

- `scripts/codex-tui-compare.mjs`：采集、归一化和差异摘要；
- `docs/design/codex-tui-comparison-harness.md`：对照协议；
- `text-parser-plugin`：Markdown token 和 fenced code 语义；
- `tool-card-plugin`：工具分类、标题、文件名、命令和 diff 语义；
- `presentation`：公开事件到显示节点的投影；
- `terminal-ui`：留白、横线、颜色 token 和终端实现；
- `composer-plugin`：输入背景、上下留白、光标和多行布局；
- `status-footer-plugin`：model、thinking effort、路径、permission、goal；
- `interactive-window-plugin`：approval/ask/selector 静态窗口。

### 测试矩阵

- 静态正向：确定性 fixture 产生完整节点、正确颜色、空行、横线和状态字段；
- 静态反向：内部字段、raw event、metadata、provider、route、控制字段和原始 JSON 不可见；
- 归一化：不同 pane 宽高只改变环境观测，不改变静态语义判定；
- 真实对照：每个场景采集 Codex 与 dsh-tui 帧，并保存 manifest 与原始 buffer；
- 动态准备：idle → input → sending → running → tool-call → tool-result → idle，以及 slash/overlay/Ctrl+C 序列均定义关键帧；
- 回归：owner 定向测试、`check:design`、`test:design`、typecheck、runtime boundaries、build、安装后真实入口和 harness。

### 实施顺序

1. 保留当前已 push 的设计提交，待 main 工作树清洁后完成 merge；
2. 在独立变更中补齐静态比较规则和确定性场景 fixture；
3. 先为内容、空行、颜色、横线和隐藏字段建立红测，再修改唯一 owner；
4. 运行定向测试和构建，使用安装后的真实入口采集两个 tmux pane；
5. harness manifest 中静态判定通过后，才进入第二阶段动态比对和差异审计；
6. 动态阶段按语义状态边界采帧，区分状态机错误、内容错误、排版变量和 ANSI 重绘噪声；
7. 动态审计闭环后再启动提交前 AGY Review。

### 完成定义

- 静态差异已由测试和 harness 双重证明，不再依赖人工截图判断；
- 几何差异被记录但不污染静态结论；
- 修改后的真实安装入口通过 tmux 双 pane harness；
- 第二阶段动态审计拥有可复现的状态序列、关键帧和失败归因；
- 所有变更通过架构门禁、定向测试、构建、真实入口验证和 AGY Review。
