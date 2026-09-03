# agent-tui OpenCode 适配实施计划

## 目标与验收标准

将当前 `dsh-tui` 运行时收口为独立的 `agent-tui`，保持 Cordis service、plugin、lifecycle、buffer、render、theme 和 semantic presentation 结构不变；通过唯一的 OpenCode serve adaptor 接入本机 OpenCode v1 HTTP/SSE 协议。

验收必须来自构建后的全局 `agent-tui` 用户入口：能连接 OpenCode、加载和创建 session、读取历史、发送 prompt、接收增量 SSE、显示文本/推理/工具/状态语义、执行 abort，并正常退出和恢复终端。

## 范围与边界

范围：

- `agent-tui` package、CLI、Cordis startup、session、transport adaptor、typed semantic presentation、buffer/render/input/theme/lifecycle 接线。
- OpenCode v1 `/doc` descriptor 对应的 health、agent、session、message、abort、event SSE 能力。
- 定向测试、typecheck、静态边界、build、隔离 OpenCode serve、PTY 和全局安装验证。

非范围：

- 不修改 OpenCode Host 协议或复制 OpenCode 源码。
- 不接入 `dsh-multikey-provider`，不恢复 DSH alpha4/alpha5 为默认 Host。
- 不把 dsh-memory 重构混入本任务；memory 作为后续独立 adaptor 任务。
- 不删除或改写历史 evidence、Active、Protected、records、hash、verdict 或协作记录。

## 设计原则

1. AppSDK `.appsdk/` 是治理真源，`appsdk reset-governance` 只执行一次；之后只用官方 verify/compile，禁止手工改版本、锁、record 和 hash。
2. adaptor 唯一负责 OpenCode 协议、认证、HTTP、SSE、资源清理和协议错误；session 唯一负责 session truth；presentation 只消费 typed OpenCode semantic model；renderer 不直接调用 adaptor。
3. SSE 事件增量进入 session/presentation，buffer 更新与渲染刷新异步解耦；不得等待完整 turn 才刷新。
4. 控制面（abort、状态、重连、错误、routing/debug）使用 typed side-channel，不进入 prompt/message 业务 payload。
5. 不做 fallback、静默丢弃、双协议自动猜测或错误映射成功；未知事件和 malformed 数据 fail-closed 并进入显式错误语义。
6. 语义解析完成后再从统一 theme token 映射颜色；renderer 不重复定义语义颜色。

## 技术方案与文件清单

- `src/experiments/transport/src/opencode-serve.ts`：绑定 OpenCode v1 descriptor，定义 typed response/event/parser，处理 HTTP/SSE、AbortSignal、错误和资源关闭。
- `src/experiments/session/`：消费 adaptor typed model，维护 session/history/status，不生成协议请求。
- `src/experiments/presentation/`：将 user、assistant streaming、reasoning、tool running/completed/error、permission/question、status、abort 和 unknown event 转为现有语义节点。
- `src/experiments/startup/` 与 `src/plugin-startup.ts`：只装配 Cordis services 和 OpenCode adaptor，移除旧 DSH 默认入口依赖。
- `src/experiments/buffer/`、`src/experiments/render/`、`src/experiments/theme/`、`src/experiments/input/`：保持现有 owner，接收 typed semantic projection，支持流式刷新、灰色 user stable 区、Tab 排队、Enter 下一轮、Shift+Enter 换行、Esc 中断 turn、Ctrl+C 退出 UI。
- `tests/transport/`、`tests/session/`、`tests/presentation/`、`tests/runtime/`：先补正反测试，再修唯一真源。
- `.appsdk/maps/*`、module registry、verification map、run notes：只登记真实 owner、调用边和 gate，不用 maps 替代实现。

## 风险与规避

- OpenCode v1 与 v2 envelope/路由混用：以 `/doc` descriptor 为唯一真源，v2-shaped 数据反向测试必须失败。
- SSE 断开、malformed JSON、unknown event：显式错误、保留失败状态，不投影为 connected/success。
- 长 session 阻塞首屏：按显示需求分段加载，先展示可用 tail，再异步追加历史；不得裁剪真实业务 payload。
- buffer/render 耦合导致卡死：事件接收、session truth、presentation publication、render tick 分离，并用非终态和持续更新反向测试锁住。
- 全局入口与源码不一致：build 后重新安装全局 `agent-tui`，用隔离 OpenCode serve 和真实 PTY 验证。

## 测试计划

正向：health、agent catalog、session list/create/get/messages、prompt、abort、SSE 增量、工具/推理/状态投影、分步历史、渲染持续更新、输入键语义、Cordis startup/退出、全局用户入口。

反向：401/403、错误 endpoint、directory/session 不匹配、旧 v2 envelope、malformed JSON/SSE、断流、unknown event、prompt/abort 失败、控制字段泄漏、renderer 直连 adaptor、旧 dsh-tui 默认入口加载、buffer 阻塞 render。

## 实施步骤

1. 在 clean owner worktree 读取项目治理和协作真源，确认 module/resource/function/mainline/verification owner。
2. 运行并记录 `appsdk verify`、`appsdk compile` 基线；确认 reset record 和版本状态，不重复 reset。
3. 补最小红测；实现 OpenCode v1 typed adaptor 和协议边界。
4. 接入 session、presentation、streaming buffer/render、theme、input 和 lifecycle，删除旧默认 Host 残留。
5. 运行定向正反测试、typecheck、runtime-boundaries、项目静态 gates、build 和 AppSDK verify/compile。
6. 启动隔离 OpenCode serve；使用构建产物完成 session、SSE、prompt、tool/status、abort、PTY 和退出验证。
7. 安装与提交一致的全局 `agent-tui`，重新启动并完成真实用户入口黑盒验证。
8. 所有前置证据通过后才允许 review/admission；review 后按治理流程做 effectiveness、merge、publish/freeze。

## 完成定义（DoD）

- `agent-tui` 是唯一新入口，旧 `dsh-tui` 不在默认启动路径。
- OpenCode v1 adaptor、session、SSE、typed semantic presentation、streaming render、输入和 lifecycle 真实工作。
- AppSDK verify/compile、项目 gates、定向正反测试、build、安装、重启和全局 PTY 通过。
- 所有 lifecycle records/evidence 由 canonical producer 生成并绑定同一 source/tree/artifact/environment/entrypoint/input。
- 无历史真相删除、hash 修改、fallback、静默降级或未验证的完成声明。
