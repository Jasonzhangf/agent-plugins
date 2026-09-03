# dsh-memory 完成实现计划

## 目标与验收标准

在 `dsh-plugins/dsh-memory` 中完成可部署的 DSH memory 插件：模型可选输出 `memory`，Host 软接收并收集有效条目；Pending Index 仅在 organization/compaction 成功后进入长期 Knowledge；支持 oldest 10% 压缩、增量/全量整理、备份、版本迁移、恢复和稳定缓存前缀。

最终必须通过真实 DSH profile 的 tool-call、end-turn、summary、compaction、manual organize、scheduled organize、重启恢复和 cache 验证。

## 范围与边界

In scope：Rust Core、持久化、事务、recall、organization、compaction provider、Node/N-API bridge、DSH plugin、命令、scheduler、profile wiring、部署验证。

Out of scope：fork DSH Agent Loop、修改 Session Journal 真源、删除原始事件、把控制字段写入 metadata/tool payload、第二套 compaction/organization 实现。

## 设计原则

- Host 软 admission：缺失或非法 memory 永不拒绝 parent output，不 retry、不改写原始输出。
- Rust 是语义、事务、持久化和恢复唯一 owner；TypeScript 只做 transport/orchestration。
- business payload 与 control/error/diagnostic side-channel 物理隔离。
- Pending、Knowledge、Evidence、Delta、Epoch append-only；所有入口共用一个 transaction owner。
- 每个 capability 独立 clean worktree、红测先行、独立证据后集成。

## 技术方案与文件面

- `dsh-memory/src/**`：contracts、ingest、index、store、organization、compaction core。
- `dsh-memory/plugin/**`：Node/N-API bridge 与 DSH adapter。
- `dsh-memory/docs/design/**`：高层/详细设计及 manifest。
- `.appsdk/maps/**`：resource/function/mainline/verification/module registry。
- `dsh-memory/tests/**`：能力、事务、部署入口黑盒测试。

## 实施步骤

1. 完成 resource/function/mainline/verification maps、test design 和 module owner 锁定。
2. 完成并验证 Rust contracts、soft admission、Pending Index、Knowledge、organization、selector、epoch、storage、snapshot、recall、error ledger。
3. 组装唯一 foundation module，验证 clean/reopen/concurrent/crash 场景。
4. 实现 compaction transaction、summary `organized_index` 校验和 session surface 协调。
5. 实现 thin bridge 与 DSH integration plugin，加入 tools、`/memory-organize incremental|full`、scheduler。
6. 读取真实 profile/bundle，替换唯一 `compaction-basic` provider，编译 deterministic manifest。
7. 安装精确 artifact，重启 DSH，执行真实样本与恢复验证。
8. 完成 review admission、指定 reviewer、effectiveness replay、promotion/freeze。

## 风险与规避

- DSH typed contract 没有 sibling `memory`：必须在真实 seam 扩展 typed contract，禁止 metadata stuffing。
- 迁移/崩溃可能产生 partial state：采用 prepare → verify → atomic publish，并保留只读备份。
- 模型不遵守 schema：只收集局部有效 entry，诊断走 side-channel，parent output 保持成功。
- 多入口重复组织：所有入口只能调用 `memory_compaction_transaction`。
- hash 跨进程稳定性：正式实现替换 foundation 临时 hash，并加入跨进程 fixture。

## 验证矩阵

- 定向 Rust 正反测试：admission、generation、oldest 10%、事务、中断、迁移、tamper、recall。
- 构建与架构：fmt、clippy、cargo test、AppsSDK verify、maps/import/owner/leak/fallback gates。
- Foundation 黑盒：clean store、reopen、并发 emission/compaction、crash recovery、artifact hash。
- DSH 黑盒：plugin load、single provider、tool-call/end-turn/summary、manual/scheduled/context organization、cache、重启恢复。
- Review：仅在安装、重启和真实样本验证完成后执行；改动后全部相关证据失效并重跑。

## 完成定义（DoD）

- Core、bridge、plugin、wiring 均有唯一 owner 和对应 manifest/map/gate。
- `memory` 缺失/非法不阻断 parent；有效条目按 generation 收集。
- compact/organize 后 raw + evidence + delta + epoch 原子落盘并可恢复。
- oldest 10%、incremental/full、backup/version migration、scheduler、cache invariants 均有真实入口证据。
- 精确部署版本通过 review admission 和结构化 reviewer PASS；main clean，commit 与部署 artifact 一致。

