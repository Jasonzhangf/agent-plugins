# DSH Web Slash Command 信息架构审计报告

## 结论
当前主要问题不是命令数量不足，而是不同意图、交互方式和风险等级的能力被压缩成一个平面候选池。执行边界基本正确，但发现层没有传达用户心智模型。

## 证据
- Host 注册、解析、执行和生命周期归 packages/interaction/commands。
- Web 菜单由 packages/client/ui-commands/src/client/service.ts 合并 Host catalog 与 client contributions。
- candidates() 目前只生成 name、description、hint，统一进入 fuzzy 候选池，没有 category、visibility、risk、source 或 progressive disclosure。
- CommandContribution 只有 name、description、available 和 popupSelect UI。
- 现有命令包括 model、goal、plan、compact、feedback、permission、export，分别属于会话设置、工作流、上下文、权限和输出协作。
- PopupSelectView 和 popup controller 提供统一弹层，但没有分组标题或交互类型提示。

## 问题分级
### P0：平面列表造成错误心智模型
用户无法区分切换设置、改变工作模式、会话管理、输出协作和高级操作。根因是候选投影只有命令名和文本描述。

### P1：不同执行语义没有视觉区分
model 是 client popupSelect；goal、plan、compact 等是 Host command；permission 同时有 Host command 与 client decoration。菜单没有统一显示选择、输入或立即执行的 affordance。

### P1：固定优先级不是信息架构
HUMAN_COMMAND_ORDER 只解决数组排序，不解决分组、默认折叠、搜索解释和增长后的认知负担。未来候选名称不应因进入排序表而被误认为已实现能力。

### P1：高级和部署命令缺少渐进披露
部署专属命令进入同一候选池。降低排序不能替代默认隐藏、明确搜索可达和高级分组。

### P2：参数与描述语言不一致
Host hint 是自由文本，popup 没有统一的选择语义提示；用户必须记忆命令名和参数格式。

### P2：缺少信息架构验收
当前测试覆盖 registry、directory、dispatch 和 popup 局部行为，但没有锁定默认菜单密度、分组、默认可见性、搜索高级命令和交互类型。

## 推荐信息架构
默认 popup 采用四组：
1. 当前会话：model、permission、goal、plan、compact。
2. 会话管理：仅接入已有 session/workspace owner 的 create、open、rename、fork。
3. 输出与协作：export、feedback，以及未来具有完整 owner 的 review。
4. 高级与部署：默认折叠或仅在明确 query 命中时展示；debug、内部维护和纯终端命令不进入普通 popup。

每个菜单项增加纯客户端 presentation kind：select、input、execute、advanced。真实 dispatch 仍由现有 Host input、decoration 和 client contribution 规则决定，展示元数据不能覆盖执行语义。

## 推荐解决方案
在现有单一 slash source 上扩展纯展示投影，不拆多个 popup source。

1. 在 CommandDescriptor 和 CommandContribution 的客户端展示面增加 category、visibility、order 和 kind。
2. candidates() 先做 availability，再做默认 visibility 过滤，按 category 分组，组内执行现有 fuzzy 排序。
3. 空 query 只展示高频和当前会话组；非空 query 允许精确发现 advanced 命令。
4. 复用 PopupSelectView 和现有菜单 renderer，增加组标题和 select/input/execute affordance。
5. 由各 client owner 声明分类；不在 ui-commands 重复实现 session、model、diff 或 review 业务。
6. status、diff、review 在 owner、结果和测试闭环前保持不展示。

## 实施顺序
1. 建立逐命令 registry：name、owner、真实 kind、availability、result、默认可见性、测试。
2. 先补纯展示 contract 和 projection 测试。
3. 实现分组、默认隐藏和明确搜索可达，保持旧 dispatch 语义。
4. 逐项给现有命令声明分类，避免未来目标态冒充现状。
5. 更新菜单 renderer、GUI 测试、Loader composition 和 assembled Web snapshot。
6. 运行 test:gui、Web replay、typecheck、build、doc-sync 和构建后在线验证。

## 验收矩阵
| 场景 | 预期 |
|---|---|
| 空 query | 只显示高频和当前会话命令，按组展示 |
| 精确搜索高级命令 | 可发现，但不增加默认菜单密度 |
| 无 session | 会话级命令隐藏或明确不可用 |
| popup | 显示选择语义，成功消费 token，失败可重试 |
| input | 显示参数提示，Space/Enter 规则稳定 |
| execute | 明确立即执行，Space 不误触发副作用 |
| 部署命令 | 不在默认列表，精确搜索可发现 |
| 重连或 command change | 分组与可见性正确刷新 |
| side/subagent | 按真实 capability 过滤，不激活不应激活的 Agent |

## 需要修复的核心问题
当前最小正确修复不是继续增加命令，而是把命令目录从无语义数组升级为有分类和可见性策略的客户端 projection，并让菜单按用户任务分组。这样能减少认知负担，同时保持 registry、领域 owner 和业务 payload 边界不变。
