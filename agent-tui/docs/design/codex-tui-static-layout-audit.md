# Codex TUI 静态排版审计基线

状态：`phase-1-audit`

本文只定义区域位置、顺序、比例和留白。品牌文案、模型名、Session id、cwd
及其他业务文字不参与静态布局等价判断。

## 当前真实基线

采样入口：`dsh-codex:0` 与 `dsh-tui:0`，同一 cwd；pane 宽高只记录为环境观测。

| 区域 | Codex 新 Session | dsh-tui 新 Session | 静态判断 |
| --- | ---: | ---: | --- |
| 顶部品牌/欢迎区结束 | 约第 5 行 | 第 5 行 | 对齐 |
| transcript 有效起点 | 第 8 行附近 | 由可伸缩区域吸收剩余空间 | 空闲态不产生 execution 行 |
| execution | 空闲态不显示 | 空闲态不显示 | 仅 running 时允许占用一行 |
| composer | 第 13--15 行 | 第 18 行（24 行 pane） | 保持在 footer 前并靠近底部 |
| footer/status | 第 17 行 | 第 23 行（24 行 pane） | 必须保持 composer 之后并锚定底部 |

这张表是布局证据，不是逐字内容比较。当前 harness 已确认：dsh-tui 的
composer/footer 顺序、footer 底部锚点、短 transcript 的伸缩、overlay 插槽位置、内部字段隔离和动态 idle signature 稳定。

## 第一阶段静态目标

根布局保持单一纵向流，顺序固定为：

```text
header → transcript → [execution: running only] → composer → footer
```

- header 固定高度，不因 transcript 内容挤压；
- transcript 是唯一可伸缩区域，吸收剩余高度；
- execution 是运行态临时区域，空闲/终态不产生可见行；
- composer 固定在 footer 之前，保留输入上下留白和背景；
- footer 固定在可见内容尾部，承载 model、thinking effort、path、permission、goal；
- overlay 出现时只在 transcript 与 composer 之间重排，不覆盖 footer；
- tool card 的上下留白和轮次横线只属于 transcript 排版，不改变 footer 锚点；
- terminal 宽高变化只触发换行和 transcript 可见容量变化，不改变区域相对顺序。
- `default` 与 `compact` 只改变可伸缩内容的容量，不改变 header、transcript、overlay、composer、footer 的纵向顺序。

## Harness 判定

`codex-tui-compare.mjs` 对每一帧记录：

- 区域行号与相对比例；
- execution/composer/footer 的顺序；
- footer 到可见内容尾部的距离；
- blank-line 数量、样式摘要和内部字段泄漏；
- 连续帧 layout signature 是否稳定。

静态失败条件：区域顺序错误、composer 缺失、footer 未锚定、execution 在
composer 之后、内部控制字段泄漏。宽度、高度、cwd 差异只进入 `geometry`，
不触发 UI 静态失败。

## 后续修改边界

排版修改唯一落点是 `dsh-tui::app-container` 的 frame composition；
`terminal-ui` 只负责 typed leaf realization，`execution-status-plugin` 只负责
运行状态 projection，`status-footer-plugin` 只负责 footer 内容 projection。
任何为对齐文字而修改 parser、Session 或业务 payload 都越界。
