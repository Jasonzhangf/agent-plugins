# dsh-tui 原始内容、解释器、显示 Buffer 与终端输出设计

状态：`implemented slice / delivery pending`

## 目标

建立 Codex 对齐的行级历史模型，同时保持 dsh-tui 的插件边界：

```text
Session public history/frame
  -> TerminalRawBufferPlugin
  -> PresentationPlugin
  -> InterpreterPlugin
  -> Container/Layout projection
  -> DisplayBufferPlugin
  -> TerminalRenderPlugin
  -> TerminalOutput/LifecyclePlugin
```

每一层只消费上一层的 typed contract；禁止跨层读取内部缓存、raw event 或
终端输出。控制字段（metadata/debug/provider/routing/retry/control/rpcId）不得
进入业务 payload。

## 编号主线

v3/v4 的已消费节点语义保持不变并作为历史版本保留；当前唯一 active 输出主线
是 `dsh-tui-v5`：

```text
DshHostOut01PublicHistoryOrFrame
  -> TuiDisplayOutputIn02OfficialHistoryBuffered
  -> TuiDisplayOutputIn03PresentationProjected
  -> TuiDisplayOutputIn04SemanticElementsInterpreted
  -> TuiDisplayOutputIn05AbsoluteRowsReflowed
  -> TuiDisplayOutputIn06TerminalRowsProjected
  -> TuiDisplayOutputIn07ClosedRegionLeaves
  -> TuiDisplayOutputIn08OrderedAppFrameTree
  -> TuiDisplayOutputIn09GenericPrimitiveRealized
  -> TuiDisplayOutputOut10TerminalFrame
```

`TerminalOutputState` 是 `TerminalRowsProjected -> TerminalLifecycle` 的 typed
side branch；它不成为 terminal-ui 的输入，也不允许绕过 DisplayBuffer、
TerminalRender 或 app-container。`component-registry` 仍可服务独立的 descriptor
API，但不在 live transcript/region projection 主线中。

## 三种 Buffer

| Buffer | 唯一真源 | 负责 | 不负责 |
| --- | --- | --- | --- |
| `TerminalRawBuffer` | Session public history/frame | 原样保存按 `event.seq` 排序的官方 `HistoryEntry` | 语义、canonical node、Markdown、颜色、换行、滚动 |
| `DisplayBuffer` | Interpreter/Container/Layout display elements | 当前宽度下的物理行、绝对行、stable/live、viewport | 请求、ANSI、光标、业务解释 |
| `TerminalOutputState` | Terminal output plugin | dirty rows、scrollback insertion、光标/恢复、输出状态 | 解析 raw、决定卡片语义、维护 Session 历史 |

`TerminalRawBuffer` 是可重放源；Presentation 是 raw event 到 canonical semantic node
的唯一 parser；`DisplayBuffer` 是按宽度生成的行级投影。resize 必须从
raw/presentation/interpreter source 重新解释和 reflow，不能从 ANSI 输出反解析。

## 显示模型

Interpreter 输出 `TuiDisplayElement`，至少包含：

```text
elementId / sourceId
semanticKind
lifecycle: stable | live
logical lines: styled spans (+ hyperlink metadata when applicable)
```

工具语义由 raw kind/title 和现有 WebUI/dsh 分类解析：

- `tool.read`：`Read` 白色，文件名蓝色，结果白色；
- `tool.terminal`/复杂 shell：`Ran` 白色，命令及 `--参数` 红色，其余白色；
- 成功/失败用前置颜色点表示，不追加 `completed` 等状态文字；
- 文件编辑由 diff span 表达，删除红色、增加绿色，上下各保留一行白色正文，
  行号由显示行层提供；
- 普通文本由独立 Markdown parser 产生语义 token，再映射到 styled spans；
- 每轮之间由显示元素插入 divider/垂直留白，tool card 上下留白由显示元素拥有。

## Codex 对齐的 Buffer 语义

Codex 的 Ratatui `Buffer` 只表示当前可见 frame；完整历史由稳定的
`HistoryCell`/terminal-native scrollback 保存。dsh-tui 采用显式绝对行模型：

```text
DisplayBufferSnapshot {
  committedRows: append-only stable rows retained in an absolute-row window
  liveRows: replaceable active tail
  viewport: { topRow, height, followTail }
}
```

`committedRows` 与 `liveRows` 拼接成连续绝对行。活动事件更新 live tail；事件
settle 后只允许相邻的稳定提交。DisplayBuffer 默认仅保留最新 1000 个物理行，
淘汰只能发生在最旧前缀，保留行的 `absoluteRow` 不得重编号；Session raw history
仍是完整可重放真源，已经写入终端的旧行仍由 terminal-native scrollback 管理。
滚动只改变 viewport，不修改 raw history。
TerminalRender 仅把可见绝对行投影到局部终端 frame；TerminalOutput 决定稳定行
何时写入 native scrollback、活动尾部何时重绘，并输出 `visibleRows` 与
`dirtyRows` 给 terminal carrier。dirty 集合只描述当前 frame 中需要重写的绝对
行，不携带业务事件或控制字段。

应用容器只接收这些中间产物和独立 chrome slot：logo 是 stable preamble，动态
header 不显示 cwd；transcript 使用 DisplayBuffer 的 viewport rows，并由 layout
提供左右各一格的基础留白；execution 只在 running 时作为 transcript 与 composer
之间的独立区域出现；composer 后第一行显示连接灯与 cwd，再显示 model / thinking
effort / permission / goal footer。容器不自行解释节点、计算历史行数或复制工具卡语义。

### Codex 源码对照基线

本设计的行模型来自 `/Users/fanzhang/code/codex/codex-rs/tui` 的三个明确边界：

- `history_cell/base.rs` 的 `HistoryCell::display_lines(width)`：历史单元保存
  语义内容，按当前宽度重新生成显示行；`CompositeHistoryCell` 在单元之间插入
  空行。对应 dsh-tui 的 `Interpreter -> DisplayBuffer`，因此换行不能由终端
  输出层猜测。
- `custom_terminal.rs` 的双 `ratatui::Buffer`：Buffer 只代表当前 frame，上一帧
  用于 diff；cursor、viewport、resize 和 dirty 输出由 terminal owner 管理。
  对应 dsh-tui 的 `TerminalRender -> TerminalOutput/Lifecycle`，renderer 不得
  直接写 stdout。
- `app/thread_event_buffer.rs`：事件 replay buffer 只做有界事件留存与 delta
  合并，不承担显示排版。对应 dsh-tui 的 `TerminalRawBuffer`，raw history 是
  可重放源，不能用已绘制的 ANSI 行反推历史。

因此，“绝对历史行 + 可变 live rect”只成立于 `DisplayBuffer` 的投影模型：
历史行是 append-only 的 `committedRows`，live rect 是可替换的 `liveRows`；
TerminalRender 每次只生成 viewport frame，TerminalOutput 再决定哪些 stable
行进入 terminal-native scrollback。两者不能合并成一个只保留屏幕高度的数组。

## Resize 与刷新

宽度是 display layout key。resize 流程固定为：

```text
raw revision unchanged
-> presentation canonical semantics unchanged
-> interpreter display semantics unchanged
-> container/layout with new width
-> display rows rebuilt
-> terminal output invalidates/replays affected rows
```

不允许 app-container 通过 `slice(-capacity)` 删除历史；不允许 renderer 直接读
raw event；不允许 output plugin 补业务间距或猜工具类型。

## 插件边界与生命周期

- `terminal-raw-buffer-plugin`：只保存/校验官方 `HistoryEntry`；禁止从 presentation node 反造 raw record，失败显式暴露。
- `presentation`：只将官方 raw history 配对、归并为 canonical semantic node；不负责行宽、颜色或 terminal 输出。
- `interpreter-plugin`：只将 canonical presentation node 解释为 display element；Markdown 消费
  `text-parser-plugin` typed contract，工具语义消费 `tool-card-plugin` contract。
- `display-buffer-plugin`：只负责绝对行、换行、stable/live、1000 行保留窗口、viewport、reflow；基础留白只消费 layout 输入，不自行决定。
- `terminal-render-plugin`：只把 display rows 转为 neutral terminal frame/dirty
  ranges，不读取 raw。
- `terminal-lifecycle/output`：只负责 ANSI、scrollback、cursor、resize、退出恢复，
  并消费 render frame；output 仅镜像 display frame 的有界 retained window，不拥有
  Session 历史和 parser。
- `app-container`/`layout`：只管理容器与区域几何，不管理历史。
- `terminal`：管理事件分发和输出消费，不解释业务语义。

## 红线与验收

必须有机器 gate 锁定：

1. raw payload 控制字段隔离；
2. interpreter/display-buffer contract 与稳定/活动正反状态；
3. renderer 不引用 raw module；
4. display buffer resize/reflow 不删除历史、viewport 有界；应用不接管历史滚动键；
5. resize 从源重排；
6. stable scrollback 与 live redraw 不重复、不丢行；
7. 多轮真实 PTY replay、terminal-native PageUp/PageDown/鼠标滚轮、连续截图与 Codex 布局对比；
8. build、安装、重启、在线真实样本后才可 review/交付。

当前实现使用 inline terminal carrier（不进入 alternate screen），使 PTY 输出可以把
stable transcript 留在 native scrollback；DisplayBuffer 仍负责绝对行和 viewport，
不能由 terminal scrollback 反解析。真实 ANSI dirty-cell 控制、完整 cursor/restore
和最终在线对照仍属于 delivery pending，具体状态以 `.appsdk/maps/*` 与 verification
evidence 为准，不把 admission blocker 误报为完成。
