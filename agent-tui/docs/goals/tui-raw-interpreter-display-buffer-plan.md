# dsh-tui Raw → Presentation → Interpreter → DisplayBuffer 实施计划

## 阶段 0：治理锁定

- resource map：锁定 `tui_terminal_raw_buffer`、`tui_display_elements`、
  `tui_display_buffer`、terminal frame/output 资源及禁止直连关系；
- function map：每个节点绑定唯一 owner、entry symbol、允许路径、验证；
- mainline call map：只登记相邻转换 edge；
- 版本化输出链：保留 v3/v4 已消费节点语义，以 `dsh-tui-v5` 原子替换旧的
  component-resolved transcript 前缀；v5 是唯一 active 编号输出主线；
- verification map/test design：正反测试、构建、PTY、在线样本逐项绑定；
- module registry：每个源码文件恰好归属一个插件。

## 阶段 1：合同与最小 vertical slice

已开始实现并需保持独立：

1. `terminal-raw-buffer-plugin`：hydrate/append/replace/read/dispose，官方
   `HistoryEntry.event.seq` 单调，禁止 presentation node 冒充 raw history；
2. `presentation`：raw history 配对并生成 canonical semantic node；
3. `interpreter-plugin`：普通文本、reasoning、read/shell 工具语义，只消费
   canonical node，禁止 raw dump；
4. `display-buffer-plugin`：按宽度换行、绝对行、committed/live、viewport、
   resize reflow；历史导航由 terminal-native scrollback 独占。

阶段出口：各插件定向 test/build/typecheck 全部通过，contract 负测为红后转绿。

## 阶段 2：Parser 与渲染接线

- 将 interpreter 的文本路径绑定现有 `text-parser-plugin`，支持 Markdown token；
- 将工具路径绑定 `tool-card-plugin`，不在 renderer 重复分类；
- 新增独立 `terminal-render-plugin`，输入只接受 DisplayBuffer snapshot/neutral
  frame，输出为带 styled spans 的可见行与 dirty ranges；
- 添加架构 gate：renderer import raw/parser 禁止，container 不得拥有 transcript
  截断逻辑。

## 阶段 3：Terminal output/lifecycle

- 引入独立 output state：已提交稳定行、当前 live viewport、cursor、dirty range；
- 稳定行按 Codex 策略插入 terminal-native scrollback；live tail 只重绘当前区；
- resize 从 source reflow 后重新投影；
- suspend/resume/exit 恢复终端状态；错误走 error chain，不把失败投影成成功。

## 阶段 4：真实对比与交付

- harness 固定窗口尺寸，采集初始、单轮、多轮、tool、streaming、settled、
  scroll、resize、cancel 的连续帧；
- 以布局为主比较：header/transcript/execution/composer/footer 的位置、间距、
  高度、滚动历史和 dirty 更新；文字内容仅作语义校验；
- 使用真实 dsh-tui 与 Codex pane/PTY 对照，完成安装、重启、在线样本，并以终端
  native scrollback/copy-mode 元数据验证 terminal history 向上滚动与回到 tail；不把
  鼠标滚轮、上下键或 PageUp/PageDown 的应用 viewport projection 当作 terminal history
  证据；
- 通过 architecture/map gate、定向测试、全量构建和 AGY Review 后才提交交付。

## 非目标

- 不重写 app-container/layout 的业务职责；
- 不把 raw event、metadata、debug 或 provider 信息塞进显示 payload；
- 不以全屏 frame 重绘替代 terminal scrollback；
- 不增加未被真实调用方证明必要的 Manager/Factory/Adapter 层。

## 完成标准

源码、contracts、maps、tests、harness、build/install/online evidence 同一变更集；
任何一项缺失只能报告“部分实现”，不能报告完成。
