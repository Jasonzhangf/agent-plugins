# dsh-memory 详细设计

状态：已获 Jason 批准，设计阶段；禁止产品实现，直到基础能力红测设计评审通过。

## 1. Contract boundary

模型输出中的 `memory` 是可选业务字段；提示词强要求，但 admission 永不阻断 parent output。三个来源共用一个 envelope：

```ts
type MemoryEnvelopeV1 = {
  entries?: MemoryIndexEntryDraftV1[]
  organized_index?: MemoryOrganizationDeltaV1
}
```

接收规则：

1. 未出现 `memory`：parent output 原样完成，产生零条收集记录。
2. JSON 结构不可识别：parent output 原样完成，写 `memory.parse` diagnostic。
3. envelope 可识别：逐 entry 局部校验；合法 entry 收集，非法 entry 只写 diagnostic。
4. 任意 admission 错误不得 retry、不得修改 tool arguments、不得改变 tool/end-turn/summary 成功语义。
5. Host 产生 `entryId`、source refs、sequence、content hash、generation、watermark、epoch、transaction；模型不得产生这些字段。

业务 payload 与控制面分离：diagnostic、provider、retry、lock、watermark、版本迁移状态只进 typed side-channel。

## 2. Source-specific collection

### 2.1 Tool-call

采集点位于 tool-call 被记录之后、tool body 执行之前；source window 为严格早于当前 tool execution 的已完成 Journal events。当前调用计划、未来 result 和未证实猜测不能作为已完成事实。memory admission 不影响 tool body 是否执行。

### 2.2 End-turn

采集点位于 assistant end-turn 完成边界；source window 为该 end-turn 之前已完成的本轮 Journal。end-turn 可以没有 memory；缺失不构成错误。tool-call 与 end-turn 进入同一 open Pending generation。

### 2.3 Compaction summary

采集点位于 summary 返回后、compaction transaction commit 前。summary 的 `organized_index` 是建议投影，Host 必须验证覆盖、引用、tag union 和压缩约束；无效组织结果不阻断 parent compaction summary，但不得 promote 不完整 epoch。

## 3. Pending Index state machine

```text
observed -> locally-valid -> pending(Gn)
                    \-> diagnostic-only
pending(Gn) -> frozen(W) -> raw-committed + organized -> epoch-promoted
frozen(W) -> recoverable-frozen (on interruption)
```

`Gn` 是持久 generation。compaction 先冻结 `(generation, watermark)`，再打开 `G(n+1)`；并发新 emission 只能进入新 generation。没有成功 epoch promotion 时，旧 pending generation 不得标记 committed。

## 4. Unified organization transaction

手工 `/memory-organize incremental|full`、定时 incremental、index capacity compaction、DSH context compaction 均调用同一个 `memory_compaction_transaction` owner。

```text
admit optional memory
  -> freeze generation + watermark
  -> read organization input (all frozen pending)
  -> select compression input (oldest 10% of active projected index, only when capacity rule fires)
  -> request/compute organization
  -> validate coverage and references
  -> append raw Knowledge + Evidence
  -> append Organization Delta
  -> build immutable Organization Epoch
  -> atomically promote epoch and commit generation
  -> coordinate DSH Surface replace, if applicable
```

组织输入和压缩输入永远是两个集合。Raw Knowledge、Evidence、Organization Delta、Organization Epoch 均 append-only；不得覆盖或删除旧版本。

## 5. Storage, backup and migration

配置由 `memory-store` owner 读取：

```text
root: absolute user-selected path
backupRoot: optional absolute path
formatVersion: dsh.memory.store.v1
```

目录布局：`manifest.json`、`pending/`、`knowledge/`、`evidence/`、`index/`、`epochs/`、`diagnostics/`。manifest 包含 format version、active epoch、generation watermark 和每个不可变文件的 hash。

迁移 owner `memory-store-migrate` 只允许以下顺序：

```text
discover -> validate source -> create read-only backup -> migrate to new version
-> verify hashes/references -> atomically activate new manifest
```

备份失败、源 manifest 无效、hash/reference 校验失败时，active store 保持不变。旧格式只读保留，迁移不得原地覆盖；迁移状态属于 control side-channel。

定时整理默认关闭。启用后 scheduler 只发送 `organize.incremental` control command，不能另行实现组织算法；调度失败不改变 active epoch。

## 6. Detailed modules and ownership

| Module | Unique owner | Allowed paths | Forbidden |
|---|---|---|---|
| contracts | `memory-contracts` | `core/contracts/**` | storage, model calls |
| ingest | `memory-ingest` | `core/ingest/**` | parent-output rejection, long-term writes |
| pending/index | `memory-index` | `core/index/**` | raw Knowledge mutation |
| store/migration | `memory-store` | `core/store/**` | prompt assembly, compaction policy |
| organization | `memory-organizer` | `core/organization/**` | deleting raw/evidence, second transaction |
| compaction | `memory-compaction` | `core/compaction/**` | Journal rewrite, control in payload |
| integration | `dsh-integration` | `plugin/**` | duplicate semantic validation |

Rust owns semantic types, validators, transactions, persistence and recovery. Node/N-API only transports typed calls. DSH plugin only observes events, projects PromptContext, registers commands and schedules organization.

## 7. Verification gates

Positive/negative pairs are required:

- missing/invalid memory continues parent output; valid entries collect;
- tool-call future-result claim is not collected; prior confirmed fact is collected;
- end-turn and summary share schema and generation;
- interruption leaves recoverable frozen generation, never partial promotion;
- backup failure leaves active manifest unchanged;
- migration verifies old/new hashes and preserves old read-only format;
- scheduled/manual/in-context organization resolve to the same transaction owner;
- cache-stable prefix remains unchanged by ordinary memory writes.

