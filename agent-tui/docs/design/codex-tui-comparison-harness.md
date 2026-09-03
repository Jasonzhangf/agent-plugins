# Codex TUI 对照测试 Harness

## 目标

Codex TUI 只作为交互和视觉基准；实现继续使用 dsh-tui 当前插件架构。Harness 负责自动采集和比较，不把 Codex 的内部实现或 payload 引入 dsh-tui。

固定对照入口：

```text
左侧：dsh-codex:0
右侧：dsh-tui:0
cwd：/Volumes/extension/code/dsh
```

## 1. 快速对比

一次静态基线：

```bash
pnpm run compare:codex-tui -- --label baseline
```

连续动态采集 10 秒、每 500ms 一帧：

```bash
pnpm run compare:codex-tui -- --watch --duration-ms 10000 --interval-ms 500 --label interaction-01
```

可重复驱动输入、slash 提示、Esc 和 Ctrl+C 清理流程：

```bash
pnpm run scenario:codex-tui -- --left dsh-codex:0 --target dsh-tui:0 --label input-slash-ctrlc
```

运行中取消并检查布局收口：

```bash
pnpm run scenario:codex-tui -- --scenario cancel-running --label cancel-running-smoke
```

该场景发送一个可观察的长执行请求，必须先采到 `execution` 位于 composer 上方，
再注入一次 Ctrl+C；取消后必须采到 execution 消失、composer 仍在 footer 之前且 footer
保持底部锚定。目标状态未出现或取消后布局未恢复即失败。

多轮历史与滚动布局（目标进程需以 `--continue` 或 `--resume` 启动）：

```bash
pnpm run scenario:codex-tui -- --scenario history-layout --target dsh-tui:0 --label history-layout-smoke
```

历史场景默认允许每轮最多等待 120 秒，以覆盖 Host/provider retry 后的正常收口；可用
`--history-idle-timeout-ms` 显式缩短或延长该等待。超时仍然失败，不会把 streaming 状态
当成 settled。

该场景提交多轮无副作用文本请求，要求 terminal scrollback 至少出现六条用户轮次和六条
横线分隔；随后进入 tmux native copy-mode 向上滚动，检查 terminal 的 `scrollPosition`
大于零且 scrollback 仍包含历史节点，再退出 copy-mode 回到 terminal tail。Harness 用
`scrollPosition` 推导 copy-mode 的绝对 `capture-pane -S/-E` 区间，因此帧文件保存用户当时
看到的 scrollback 区间；manifest 同时记录 `viewSource`、`visibleStart`、`visibleEnd`，防止
把 terminal tail 冒充滚动画面。这里不发送 PageUp、PageDown，也不调用应用的 transcript
scroll projection；它验证的是 PTY/终端历史，而不是应用 viewport 滚动。场景只读取终端
可见 buffer，不读取 Session/raw event。

shell 卡片语义与排版：

```bash
pnpm run scenario:codex-tui -- --scenario shell-layout --target dsh-tui:0 --label shell-layout-smoke
```

该场景使用独立的 shell 与 assistant marker，先观察 running，再等待 execution 消失；
settled capture 必须在 terminal scrollback 中按顺序保留用户请求、对应 `Ran` 卡片、独立
assistant 最终行和轮次分隔线，同时不出现 `tools.*`、`const result`、`exitCode` 等
code-mode 实现细节，并校验 composer/footer 锚点。`Ran`、命令 token 颜色由
tool-card-plugin 定向 fixture 锁定；窄 viewport 可能折叠卡片顶部，所以 live 断言读取
terminal scrollback，而不是要求卡片标题始终留在当前 viewport。

scenario runner 只通过 tmux 公开输入驱动，不读取 raw event；每个阶段调用同一
compare harness，并在 `scenario-manifest.json` 中保存 layout signature 和合同结果。

每次输出：

```text
docs/evidence/codex-compare/<label>/manifest.json
docs/evidence/codex-compare/<label>/frame-0000-left.txt
docs/evidence/codex-compare/<label>/frame-0000-right.txt
...
```

Harness 自动记录 pane 尺寸、cwd、运行命令、标题、采集时间、可见行数、首次差异行和几何一致性；同时提取 composer、model/effort、路径、横线、tool card 和内部字段泄漏等静态 surface landmarks。

## 2. 对照维度

### 静态基线

每个稳定状态至少采集一帧：

| 场景 | Codex 基准 | dsh-tui 检查面 |
| --- | --- | --- |
| 新 Session | 品牌区、空白区、输入区、底部模型路径 | Logo、空 transcript、composer、footer |
| 输入中 | 光标、换行、背景、上下留白 | composer 状态、光标、输入显示 |
| 执行中 | 状态位置、spinner、计时、取消提示 | execution-status-plugin |
| tool card | 调用标题、空行、成功/失败点、颜色 | tool-card-plugin + presentation |
| 搜索/读取/编辑 | 路径、行号、diff、结果密度 | tool-card-parser |
| 历史恢复 | 多轮顺序、分隔线、滚动位置 | session + presentation |
| approval/ask | overlay 尺寸、选中态、退出 | interactive-window-plugin |
| 状态栏 | model、thinking、路径、permission、goal | status-footer-plugin |

### 动态对照

不对每一个 terminal repaint 截图。按语义状态边界采集连续帧：

```text
idle → input → sending → running → tool-call → tool-result → idle
idle → slash-suggestions → overlay → selection → idle
idle → Ctrl+C clear → empty → Ctrl+C×2 exit
running → Ctrl+C cancel → idle
resume-history → multi-round settled → terminal native scrollback → terminal tail
```

默认每 500ms 采集一帧，关键状态转移另存一帧。这样能检查状态是否闪烁、重复、提前收口或布局跳变，同时避免把 ANSI repaint 噪声当成 UI 差异。

## 3. 单功能测试协议

每个功能只使用一个确定性场景：

1. 固定两个 pane 尺寸和 cwd。
2. 采集 idle 静态帧。
3. 发送一个无副作用输入或 fixture 操作。
4. 动态采集直到目标状态稳定。
5. 采集 settled 静态帧。
6. 比较结构指标和视觉指标。
7. 跑该功能 owner 的定向测试。
8. build、install 后用同一入口重放。

功能验收不以“看起来差不多”为准，而是同时检查：

- 结构：节点数量、顺序、状态转移、错误/成功收口；
- 文本：换行、空行、隐藏字段、路径和行号；
- 样式：颜色 token、状态点、diff 行颜色；
- 几何：宽度、高度、溢出、composer/footer 位置；
- 动态：稳定态数量、是否重复启动、是否提前结束、Esc/Ctrl+C 行为。

静态 manifest 的 `staticComparison` 明确区分两类结果：`raw*Equality` 是两端原始文本/ANSI 的差异证据，`rightSurfaceContract` 是 dsh-tui 静态交付合同，`rightLayoutContract` 是区域顺序/锚点合同，`internalContextLeak` 是硬失败信号；pane 宽高永远只写入 `geometry`，不参与静态 pass/fail。`diff.surfaces.*.layout` 记录 execution、composer、footer 的相对位置、底部距离和顺序，供 layout 对齐使用，不要求品牌文本逐字相同。新 Session 静态合同要求 dsh-tui 具备 composer、model/effort、path，execution（如存在）位于 composer 上方，composer 位于 footer 上方，且不得出现内部 context/control 字段；raw 文本和 ANSI 不同不自动判失败。

每帧的 `diff.surfaces.*` 另外记录 `toolCardCount` 与 `toolCardLabels`。它们只来自终端公开可见行，用于发现工具卡片重复或缺失；该观测不执行按文件名、标题或时间的猜测式去重。需要判断是否为同一公开节点时，必须结合 presentation projection 的稳定 `nodeId` 证据。

动态 manifest 额外写入 `dynamicComparison`：帧数、每帧 dsh-tui layout signature 和 `stableRightLayout`。signature 只包含区域相对顺序和锚点，不包含 pane 宽高；因此可识别状态期间的区域跳变，同时不把终端尺寸变化误报为布局错误。历史场景另外以 terminal snapshot 的 `historySize`、`scrollPosition`、`inCopyMode`、`viewSource` 和绝对可见区间验证原生 terminal scrollback；这些字段不等同于应用 viewport 状态。

布局审计同时写入 `diff.layoutComparison`：两端的 `header → transcript → execution → overlay → composer → footer` 区域顺序、composer/execution/overlay/footer 的可见比例差，以及 footer 到可见内容尾部的距离。Codex 的 `›` 与 dsh-tui 的 `>` 均按输入提示识别；由于 transcript 用户回显也可能以同一提示符开头，解析器取最靠近底部的 prompt 作为 composer，再将其之前的内容计入 transcript。该摘要只用于定位栏目和比例差异，不把品牌文案、业务文字或 pane 几何差异变成失败条件。内部字段门禁只检查右侧 dsh-tui surface，避免将 Codex 基准自身的文本误判为产品泄漏。

## 4. 自测入口

Harness 本身是只读采集器，不向 pane 注入业务 payload。交互场景使用现有 PTY/fixture 测试驱动，采集器负责收集结果：

```bash
pnpm run test:tool-card-plugin
pnpm run test:presentation
pnpm run test:terminal-ui
pnpm run test:terminal-lifecycle
pnpm run compare:codex-tui -- --watch --duration-ms 10000 --label smoke
pnpm run scenario:codex-tui -- --scenario overlay-layout --label overlay-layout-smoke
pnpm run scenario:codex-tui -- --scenario resize-layout --label resize-layout-smoke
```

失败判定：

- pane 不存在或尺寸无法读取：立即失败；
- cwd 不一致：标记为环境差异，不与 UI 差异混合；
- 目标状态未出现：失败，不自动降级为静态通过；
- 历史节点数量变化但没有对应 Session/history 证据：失败；
- 颜色、换行、空行或隐藏字段不符合 contract：失败。

## 5. Owner 约束

```text
Host/history truth → session
public event projection → presentation
semantic tool parsing → tool-card-plugin
Markdown tokens → text-parser-plugin
terminal realization → terminal-ui
input/editing → composer-plugin
execution lifecycle → execution-status-plugin
approval/ask → interactive-window-plugin
visible status → status-footer-plugin
```

Codex 对照只能产生 evidence 和差异报告，不得让 renderer 读取 raw event、metadata、provider 或控制 payload，也不得在 terminal-ui 增加业务解析。
