# agent-tui OpenCode 适配实施计划

## 目标与验收标准

将现有 `dsh-tui` 重建为 `agent-tui`：保留 Cordis Service、插件、生命周期、语义解析、主题和渲染分层；删除 DSH Host 作为默认运行依赖；通过唯一的 OpenCode serve adaptor 接入本机 OpenCode。

验收必须来自构建后的 `agent-tui` 用户入口和隔离的真实 OpenCode serve：能够完成认证/健康检查、session 列表、创建、恢复、继续、分页消息读取、prompt、SSE 增量、工具/推理状态显示、Esc 中断、Ctrl+C 退出 UI、输入队列与终端恢复。异常必须显式失败，禁止 fallback 或把失败映射为成功。

## 范围与边界

In scope：

- `agent-tui` 包名、CLI、公开入口和安装产物；
- OpenCode HTTP/SSE/WebSocket/control adaptor；
- transport、session、startup 到 Cordis service 的接线；
- OpenCode 事件到 typed semantic presentation 的映射；
- 现有输入、队列、状态、工具卡片、流式刷新、主题渲染能力的迁移与适配；
- AppSDK 新项目治理 truth、maps、测试和真实入口验证。

Out of scope：

- 修改 OpenCode 源码或协议；
- 将 OpenCode 源码复制进本项目；
- dsh-memory 适配（单独任务）；
- dsh-multikey-provider 和 DSH alpha4/alpha5 Host；
- 新增第二套渲染/transport/session 语义或协议 fallback。

## 设计原则

1. Cordis service/plugin/lifecycle 结构保持不变；底层协议差异只存在于 adaptor 层。
2. OpenCode Typert descriptor 是 remote 方法的唯一协议真源；所有请求使用正确 envelope，控制面认证字段不进入业务 prompt/message/SSE payload。
3. 事件先经过 typed semantic parser，再进入 presentation/theme/render；渲染只消费语义节点，不解析协议原始字段。
4. streaming producer、buffer、refresh 和 terminal lifecycle 解耦：SSE 事件到达即可追加语义帧并触发非阻塞刷新；历史 session 按显示需求分页加载，不能阻塞 live tail。
5. runtime 只加载校验后的 deterministic manifest/registry/artifact，不扫描 playground 临时目录。
6. 每条转换链只有一个 owner；错误进入显式 error chain，禁止静默吞错、降级和重复实现。

## 技术方案与文件清单

### 1. 治理与公开入口

- `agent-tui/.appsdk/project.json`、`goal.json`、`sdk.lock`：按正式流程绑定新项目 identity、目标和 module；不手工伪造 records/hash。
- `agent-tui/.appsdk/maps/*`：重建 resource/function/mainline/verification/module registry，绑定真实 owner、调用边和 gates。
- `agent-tui/src/index.ts`、`src/plugin-startup.ts`、`src/cli.ts`：公开导出和 CLI 只指向 `agent-tui` runtime；不保留 DSH 默认 Host 双路径。
- `agent-tui/package.json`、构建脚本和安装器：产物、binary 和安装入口统一命名为 `agent-tui`。

### 2. OpenCode adaptor 与 session 主线

- `agent-tui/src/experiments/transport/src/opencode-serve.ts`：唯一 OpenCode HTTP/SSE 客户端；实现 health、session/list、session/create、messages、prompt、abort、SSE；严格校验 URL、响应 envelope、状态码和 SSE 帧。
- `agent-tui/src/experiments/transport/src/transport.ts`：仅负责 transport contract 和连接生命周期；不承载 presentation 或业务控制语义。
- `agent-tui/src/experiments/session/src/session.ts` 及 normalizer：通过 adaptor 完成分页历史、tail/live 合并、resume/continue；保持 session identity、generation 和错误边界。
- `agent-tui/src/experiments/startup/src/startup.ts`：只编排 manifest loader 与 Cordis services，不硬编码 OpenCode 方法或插件数组。

### 3. 语义、流式与渲染

- `agent-tui/src/experiments/presentation/*`、`text-parser-plugin`：将 OpenCode message/event/tool/reasoning/status 映射为 typed semantic nodes。
- `agent-tui/src/experiments/refresh-orchestrator/*`、`display-buffer-plugin/*`：分离 producer、buffer 和刷新调度；支持初始 tail、历史分页热加载及 live SSE。
- `agent-tui/src/experiments/theme-plugin/*`、各 render/display plugin：按语义 token 映射主题色；不在传输层染色，不以红色作为所有重点默认色。
- `execution-status-plugin`、`tool-card-plugin`、`status-footer-plugin`、`terminal-lifecycle`：显示 Sending/Working、工具语义、计时、动画、后台数量和中断状态；Esc 只停止 turn，Ctrl+C 退出 UI。
- `composer-plugin`、`app-shell`、`app-event-bus`：支持 Shift+Enter 换行、Tab 排队、Enter 下一轮、输入背景和光标；控制命令先经过 parser/trigger，不进入 prompt payload。

## 风险与规避

- OpenCode descriptor 与旧 DSH contract 不一致：先建立 descriptor 对照测试，再接线；失败显式暴露。
- SSE 高速事件造成刷新阻塞：使用有界 refresh scheduling 和不可变帧快照，禁止让 buffer 锁住输入或 terminal。
- 历史加载过慢或破坏 live tail：按可见高度和 summary 估算分页，历史更新只能替换对应 projection，不覆盖最新 live 状态。
- 旧 DSH 残留依赖：加入 import/runtime-boundary gate，确认最终安装产物不加载 DSH 或 multikey provider。
- 真实入口与源码漂移：build 后重新安装，在隔离 OpenCode serve 和 PTY 中验证；未完成不得 review/发布。

## 测试计划

先写最小正反测试：

- adaptor：正确 envelope 成功；错误状态、错误 envelope、malformed SSE、认证失败明确失败；
- session：空列表、分页、resume/continue、历史与 live 合并；乱序/错误 session 绑定拒绝；
- stream/refresh：每个增量事件产生可观察刷新；buffer 慢时输入仍可编辑；失败/完成状态不可误投影；
- semantic/theme：同一语义稳定映射颜色；未知语义显式标为 Running/unknown，不静默丢失；
- input/lifecycle：Tab/Enter/Shift+Enter/Esc/Ctrl+C 分界；turn 停止不等于 UI 退出；
- runtime：manifest owner、边界、control/payload 隔离和无 DSH 默认依赖。

验证矩阵：定向单测 → typecheck → AppSDK verify/compile → static/runtime-boundary gates → build → 隔离 OpenCode serve API smoke → 构建产物 PTY → 全局安装 `agent-tui` → 重启后的真实用户入口黑盒。真实入口通过前不得声称完成，也不得启动 review 或发布流程。

## 实施步骤

1. 完成 reset 后的 goal/project identity 绑定，建立 maps 和唯一 owner；先运行基线 verify。
2. 将已验证的 OpenCode adaptor 迁移到当前 reset worktree，补齐红测和协议对照。
3. 接入 Cordis transport/session/startup，移除 DSH 默认 Host 路径。
4. 接入 typed semantic presentation、streaming refresh、theme/render 和 input/lifecycle 边界。
5. 运行定向测试、类型检查、静态 gate、AppSDK verify/compile 和构建。
6. 用隔离 OpenCode serve 做 API、SSE、session、prompt、abort smoke；再用构建产物做 PTY 黑盒。
7. 安装全局 `agent-tui`，重启并重复真实入口验证；所有证据绑定同一 source/tree/artifact/environment。
8. 全部前置验证通过后，才按 AppSDK 流程生成 evidence、admission、review、effectiveness、merge/publish/freeze。

## 完成定义（DoD）

- `dsh-tui` 不再是项目公开包、默认 CLI 或 runtime 依赖；`agent-tui` 公开入口可独立运行。
- OpenCode serve 的认证、session、prompt、SSE、abort、状态和渲染链路真实通过。
- Cordis service/plugin/lifecycle 边界保留，adaptor 是唯一协议接入层，manifest/registry 是唯一加载源。
- buffer、stream、refresh、输入和 terminal lifecycle 不互相阻塞；所有错误显式失败。
- 构建、安装、重启和真实用户入口证据与当前 commit/tree/artifact 一致。
- AppSDK verify/compile 和声明的 gates 通过；未通过的 review/admission/release 不得被包装为完成。
