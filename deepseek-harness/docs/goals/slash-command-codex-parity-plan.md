# Slash Command 人类可用对齐实现计划

## 目标与验收标准
将 DSH Web 的 slash command 入口对齐 Codex TUI 的人类操作原则：可发现、排序合理、按状态可用、参数输入清晰，只暴露 DSH 已有且可验证的真实能力。
验收：菜单不含空壳、debug 或纯终端命令；核心命令复用领域 owner；参数、popup、Enter/Space、运行中可用性和错误结果有测试；控制面不进入模型或业务 payload；构建后的 Web 入口通过 keyless replay 和在线 smoke。

## 范围与边界
纳入：ui-commands 的排序、候选过滤、参数触发和 dispatch；已有 compact、goal、plan、export、feedback、permission 的交互对齐；有真实 owner 的 model、review、new、resume、rename、fork、status、diff。
排除：Codex 全量枚举、raw/statusline/theme/pets/quit/exit、debug 与 memory 内部命令、无 DSH Web 能力的 apps/mcp/usage/IDE/Desktop 操作；不修改 agent loop，不新增重复 session/domain service。

## 设计原则
1. 注册和执行归 interaction/commands；目录、popup 和输入归 client/ui-commands；业务行为归对应领域插件。
2. 对齐 Codex 的 presentation order、fuzzy discovery、inline args、状态过滤和明确错误，不复制无对应语义的命令。
3. 每个命令必须有真实 handler 或真实 popup、availability、用户可见结果和测试映射。
4. 保持 session scope、commands/change、preset、reconnect、epoch guard 和草稿保留语义。
5. 复用现有 model selector、session/workspace、fork、diff、review 和 popup；不新增通用 rich-result 协议。

## 技术方案与文件清单
主要通用 owner：packages/client/ui-commands/src/client/service.ts、directory.ts、popup.ts、contract.ts。
主要注册 owner：packages/compaction/command-compact/src/index.ts、packages/feedback/command-feedback/src/index.ts、packages/goal/command-goal/src/index.ts、packages/plan/plan-mode/src/index.ts、packages/session-query/session-log-export/src/index.ts、packages/interaction/permission-presets/src/index.ts。
新增候选必须先定位真实模型、session、diff、review owner，再修改对应包；不在 ui-commands 放业务逻辑。
文档同步 package README、docs/subsystems/commands.md 和必要的 implemented Agent Note；新增 Agent Note 前执行 supersession 检查。

## 风险与规避
没有 Web 语义的命令不得注册；过期目录继续使用现有失效路径；运行中操作分别建 availability；失败不清除草稿；避免 rich-result 过度设计；源码通过不等于用户入口通过。

## 测试计划
registry：parser、排序、scope shadow、重复、disposal、observer failure、sync/async、abort。
ui：目录合并、fuzzy、availability、leading input、bare execute、popup、并发失效、失败保留草稿。
产品：Loader 真实组合、assembled Web slash-flow、成功/失败结果、无 session、active turn、side conversation、目录失败反向路径。
验证：受影响 focused tests、pnpm run test:gui、DSH_SNAPSHOT=replay pnpm run test:web、pnpm run typecheck、pnpm run build；文档变更运行 pnpm run doc-sync。

## 实施步骤
1. 读取并记录实际 owner、调用链和测试 inventory。
2. 建立命令名到 owner、handler/UI、availability、result、tests 的映射；缺项不实现。
3. 先补最小失败测试，再实现通用输入和领域注册。
4. 对齐排序、描述、hint、运行中策略、popup 和错误文案。
5. 更新 Loader、GUI、assembled snapshot、README 和 Agent Note。
6. 完成 focused、GUI、Web replay、typecheck、build、doc-sync 和构建后在线验证。
7. 做模块边界及 payload/control 隔离自检；验证通过后再进行只读 review。

## 完成定义
第一批有真实 owner 的核心命令具备 Codex 风格的人类操作体验；不适用于 Web 的命令不会出现在普通菜单；每个新增命令均有唯一 owner、availability、结果和验证证据；构建后的指定 Web 入口完成在线确认。