# dsh-memory 整体设计执行计划

状态：design

仓库根：`dsh-plugins/`；插件根：`dsh-plugins/dsh-memory/`。

执行原则：一个 milestone、一个 semantic claim、一个仓库级 clean worktree、一个可独立验证 change set。

## 1. 完成合同

最终完成必须同时证明：

- DSH exact source/profile/provider/plugin seams 已固定。
- 高层设计、分区、resource/function/mainline/module/verification maps 一致。
- 每项基础能力有独立正反验证和错误证据。
- Foundation module 只包含已经通过能力 gate 的实现。
- DSH plugin 只编排 Core API，不复制业务语义。
- Profile wiring 替换唯一 compaction provider，不产生双 provider。
- tool-call 和 summary 的 `memory` 字段通过真实 DSH 请求链。
- Pending → compact → raw knowledge + organization delta → epoch promotion 通过真实样本。
- Cache prefix、增量/全量整理、最旧 10%、中断恢复通过部署入口验证。
- exact candidate 通过 review admission 和指定 reviewer。

## 2. 阶段 0：根 main 与治理

目标：建立不可绕过的项目入口和执行顺序。

产物：

- `README.md`
- `MAIN.md`
- `.appsdk/goal.json`
- `docs/design/**`
- `docs/plans/**`
- `docs/architecture/**`
- `docs/verification/**`

Gate：

- Git root 是上一级 `dsh-plugins/`，branch 为 `main`；`dsh-memory/` 不创建嵌套 `.git`。
- 根 main clean。
- `playground/` 被忽略。
- `appsdk verify` PASS。
- Goal 保持 `clarification_pending`，直到 Jason 批准高层设计。

## 3. 阶段 1：Source Pin 与事实调查

只读调查；不写产品代码。

需要固定：

1. DSH exact commit、版本、构建方式和许可证。
2. tool-call `summary` 的 owning parser、type、projector、journal event 和 provider serialization path。
3. CompactionEngine provider contract、`BasicCompactionEngine` 可替换点、事件顺序、Surface replace 回执和恢复行为。
4. PromptSection、PromptContext、Session Event、Surface、Subagent、Profile/Bundle row ID 的真实接口。
5. Cairn exact commit、许可证和可复用边界；不根据旧调查复制源码。

产物：source-pin record、live symbol inventory、真实调用图、seam decision。

Gate：所有引用带 exact commit + path + symbol；未找到的绑定标 `pending`，不得猜测。

## 4. 阶段 2：高层设计批准

目标：锁定系统边界，不写实现细节。

批准面：

- Journal / Surface / Pending / Knowledge / Index / Control 资源边界。
- Core / Bridge / Plugin / Wiring 分区。
- `memory` 输出协议和 eligible source window。
- compact 前不写长期 Knowledge。
- compact 保存 raw + organization delta。
- 最旧 10% 压缩和 incremental/full organize。
- Rust Core + thin TypeScript DSH adapter 方向。

Gate：Jason 明确批准；`.appsdk/goal.json` 从 `clarification_pending` 转 `confirmed`。批准仅授权详细设计，不授权产品实现。

## 5. 阶段 3：架构分区与详细设计

顺序：

```text
resource map
  -> function map
  -> mainline call map
  -> module registry
  -> verification map
  -> test design
  -> requirements-to-gates consistency
```

必须定义：

- 每个资源唯一 owner、truth store、projection、allowed/forbidden relation。
- 每条主线只允许相邻转换。
- Rust Core API、N-API bridge 和 DSH TypeScript adapter 的 typed boundary。
- business payload 与 control/error side-channel 的物理隔离。
- storage transaction、generation freeze、idempotency、epoch promotion、crash matrix。
- schema versioning 和旧版本物理删除/迁移策略。

Gate：maps 与设计互相引用；所有 pending 项明确；架构扫描和红测设计存在。

## 6. 阶段 4：基础能力逐项实现与验证

每项能力使用新 worktree。标准循环：

```text
contract + red tests
  -> minimal implementation
  -> positive tests
  -> negative tests
  -> whitebox evidence
  -> module-local blackbox
  -> architecture boundary self-check
  -> exact commit + handoff
  -> main integration verification
```

实现顺序：

1. Typed contracts and strict parsers。
2. Memory emission validator and eligible-source gate。
3. Pending Index append/dedupe/generation freeze。
4. Raw Knowledge revision/evidence ledger。
5. Organization Delta validator。
6. Deterministic oldest-10% selector and segment validator。
7. Index Epoch builder/promotion/recovery。
8. Recall exact/BM25/history/evidence API。
9. Frozen snapshot renderer and cache invariants。
10. Typed error/control ledger and leakage gate。

依赖项不得在一个 worktree 中顺带实现。前置能力进入 main 并取得精确集成证据后，下一个能力从新 base 开始。

## 7. 阶段 5：Foundation Module

目标：把已验证能力组装为唯一业务语义模块 `dsh-memory-core`。

规则：

- 不重新实现基础语义，只组合已验证 API。
- Core 不依赖 DSH、Cordis、provider 或 PromptContext。
- Core 输入输出全部 typed；错误走显式 error chain。
- Rust 为业务与持久化 owner；TypeScript 不复制 validator、selector、epoch 或 revision 逻辑。

验证：

- clean-database blackbox。
- reopen/recovery blackbox。
- concurrent emission/compaction blackbox。
- raw + organization atomicity。
- deterministic artifact hash和 public API hash。

通过后生成 Foundation Module artifact；未通过不得开始 Plugin。

## 8. 阶段 6：DSH Plugin

目标：构建 `@jason/dsh-memory`，只做 DSH 接入与编排。

工作面：

- Node/N-API thin bridge。
- tool-call `memory` protocol parser/projector integration。
- compaction provider replacement。
- PromptContext frozen snapshot projection。
- `memory_search/get/history/evidence/organize` tools。
- `/memory-organize incremental|full` command。
- events、ledger 和 observability adapter。

验证：

- plugin load/unload。
- single compaction provider。
- malformed or missing `memory` never rejects the parent output; locally valid entries are collected and invalid portions become diagnostics.
- Core error 保持 typed error；不得包装成 tool success。
- plugin 不读取 Playground/Protected/generated source。

## 9. 阶段 7：DSH 接线

目标：把已验证 plugin 接入指定 DSH profile。

步骤：

1. `dump-config` 获取真实 preset、realm 和 row IDs。
2. 替换默认 `compaction-basic` row。
3. 保留 `command-compact` 和 tool-result pruner。
4. 插入 dsh-memory runtime/plugin entry。
5. 编译确定性 manifest；runtime 只加载 manifest + Active artifact。

禁止：在 Root Context 注册第二个 `ctx.compaction`、写死 row ID、修改 provider payload、用 metadata 携带 memory/control。

## 10. 阶段 8：部署验证、Review、Promotion

顺序不可变：

```text
source boundary self-check
  -> targeted tests
  -> full build
  -> exact artifact install
  -> managed DSH restart
  -> live health
  -> real tool-call memory sample
  -> real summary/compaction sample
  -> cache benchmark
  -> incremental/full organize
  -> crash/restart recovery
  -> appsdk review admission
  -> selected structured review
  -> unchanged-source effectiveness replay
  -> promotion/freeze
```

Review 后改源码、测试、build 或 runtime config，旧验证和 PASS 全部失效。

## 11. Worktree 模板

命名：

```text
dsh-plugins/playground/dsh-memory-<phase>-<capability>-<run-id>/
```

每个 worktree 记录：base commit、branch、semantic claim、allowed paths、forbidden paths、required gates、candidate commit、evidence IDs、cleanup status。

根 main 只有在 exact change set 已完成该 milestone 全部 gates 后才接收。清理必须等待 mainline receipt；未配置 remote 前，不宣称远端闭环或执行 release lifecycle。
