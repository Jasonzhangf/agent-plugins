# TUI 工具卡片、文本解析与交互窗口实现计划

状态：`pending`，等待 `/goal` 执行

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
