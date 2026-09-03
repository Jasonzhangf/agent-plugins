# dsh-memory Memory Index Protocol

状态：概要设计细化，等待 Jason 批准

Canonical lifecycle manifest：[`memory-index-lifecycle.manifest.json`](./memory-index-lifecycle.manifest.json)

## 1. 结论

`memory` 是模型可选的业务输出字段，但不携带 routing、epoch、watermark、retry、provider、lock、hash 或错误状态。提示词会严格要求模型提供它，但 Host 不因缺失或不符合 schema 而拒绝本次 tool-call、assistant end-turn 或 compaction；可识别且通过局部校验的 entries 才进入收集队列。Host 在 typed side-channel 中补充来源、顺序和 transaction identity。

统一规则：

```text
tool-call/end-turn/summary memory emission
  -> best-effort parse and local validation (never reject the parent output)
  -> Pending Index
  -> successful automatic/manual memory compaction
  -> immutable raw knowledge + append-only organization delta
  -> promoted categorized index epoch
```

Pending Index 是持久 staging truth，不是长期知识区。进程重启后不能丢；未 compact 时不能伪装成 committed knowledge。

## 2. 模型输出字段

### 2.1 统一 Entry Draft

```ts
type MemoryIndexEntryDraftV1 = {
  schema: 'dsh.memory.index-entry.v1'
  operation: 'add' | 'revise' | 'contradict' | 'retract'
  targetMemoryId?: string
  scope: 'task' | 'project' | 'user' | 'global'
  kind: 'fact' | 'preference' | 'decision' | 'procedure' | 'pitfall' | 'constraint'
  title: string
  summary: string
  tags: string[]
  entities: string[]
}
```

约束：

- 提示词要求 `memory` 字段；模型缺失时按普通模型输出继续，不拒绝、不重试、不改写原输出。
- `memory` 存在且结构可识别时，Host 收集其中通过局部校验的 entries；坏 entry、未知字段或坏 schema 只写 side-channel diagnostic，不阻断 parent output。原始模型输出仍保留在 DSH Journal。
- 无内容时推荐 `{ "entries": [] }`，但省略也不构成拒绝条件。
- `summary` 是可以直接搜索和显示的自包含记忆，不写“上面”“刚才”“它”。
- `tags` 去重、规范化后排序；不得塞控制状态。
- `revise/contradict/retract` 必须提供可见且存在的 `targetMemoryId`；否则该 entry 不收集，parent output 仍照常完成。
- 模型不得生成 entry ID、event refs、sequence、timestamp、epoch、transaction ID 或 hash。

Host 验证成功后补充：

```ts
type PendingIndexEntryV1 = MemoryIndexEntryDraftV1 & {
  entryId: string
  sourceEventRefs: string[]
  admittedSequence: number
  contentHash: string
}
```

这些字段由 Host owner 产生。模型不能伪造，也不回写业务 payload。

### 2.2 Tool-call 输出

逻辑 envelope：

```json
{
  "tool_call": {
    "name": "example",
    "arguments": {}
  },
  "summary": "Why this tool is being called",
  "memory": {
    "entries": []
  }
}
```

时间边界：

```text
eligible source window
  = completed Journal events strictly before current tool execution
```

因此：

- 可以记录上一轮已确认的结论、用户偏好、成功 procedure、已验证 pitfall。
- 不能把当前工具调用计划写成已完成事实。
- 不能引用当前工具尚未产生的 result。
- 当前工具完成后的新知识，由下一次模型发送或 compaction summary 写入。

如果 DSH 当前 tool-call wire protocol 不允许 sibling `memory`，详细设计记录 Core typed contract gap；在 contract 可用前不得把 JSON 偷塞进 `summary`、arguments 或 metadata。缺失字段不会阻断工具调用。

### 2.3 End-turn 输出

普通 assistant end-turn 也可以携带同一 `memory` envelope。它的 eligible source window 是本次 end-turn 之前已经完成的 Journal 事件；成功解析的 entries 与 tool-call entries 共用 Pending Index generation。end-turn 没有 memory、格式不完整或只包含不可接收条目时，仍按普通 end-turn 完成。

### 2.4 Compaction summary 输出

```json
{
  "summary": {
    "working_state": "Current task state needed to continue"
  },
  "memory": {
    "entries": [],
    "organized_index": {
      "categories": [],
      "placements": [],
      "compressed_segments": []
    }
  }
}
```

Summary 的 `entries` 使用相同 `MemoryIndexEntryDraftV1`。其来源窗口固定为当前安全 compaction range。

`organized_index` 只表达业务分类结果：

```ts
type MemoryOrganizationDeltaV1 = {
  schema: 'dsh.memory.organization-delta.v1'
  categories: Array<{
    categoryKey: string
    label: string
    summary: string
    canonicalTags: string[]
  }>
  placements: Array<{
    entryId: string
    primaryCategoryKey: string
    secondaryCategoryKeys: string[]
  }>
  compressedSegments: Array<{
    title: string
    summary: string
    canonicalTags: string[]
    childEntryIds: string[]
  }>
}
```

Host 在 side-channel 绑定输入 generation、watermark、mode、base epoch 和 transaction。模型不输出这些控制字段。

## 3. Ingest Gate

处理顺序固定（收集不阻断上游输出）：

```text
observe tool-call/end-turn/summary output
  -> detect optional memory envelope
  -> parse recognizable entries
  -> verify eligible source window and local semantics
  -> secret and prompt-injection scan
  -> normalize tags/entities
  -> deduplicate exact content hash
  -> append valid entries to Pending Index atomically
```

接收策略：永不拒绝 parent output。缺失或不可解析的 memory 视为本次没有可收集条目；局部无效条目不进入 Pending Index，原因写入 side-channel diagnostic，原始输出不被裁剪或改写。该策略不是把坏 entry 伪造成好 entry，也不把控制状态写入业务 payload。

工具执行与 memory 收集解耦：memory envelope 的解析或局部 admission 失败不得阻断工具执行，也不得伪造成 tool success。失败原因进入 Memory diagnostic side-channel；不得通过污染工具 arguments 实现绑定。

## 4. Pending Index generation

Pending Index 使用 generation 隔离并发：

```text
G42 open: accepts new emissions
compact starts
  -> freeze G42 at watermark W
  -> open G43 for later emissions
  -> compact only exact G42 cut
```

结果：compact 期间的新记忆不会丢，也不会进入正在整理的输入集。G42 失败则保持 frozen-pending，可用同一 idempotency identity 恢复；禁止把它合并回 G43 或重复添加。

Pending entry 可被搜索，并继续通过近期对话尾部对当前 Session 可见；它不触发稳定 PromptContext snapshot 重写。

## 5. 自动 Compaction

触发条件：

```text
DSH context compaction requested
OR
active index footprint >= configured maxIndexEntries
```

三个触发器进入同一个 `memory-compaction` owner，不能有两套提交实现：DSH context compaction、index capacity compaction、手工/定时 organization。

Transaction：

```text
1. Freeze pending generation and input watermark.
2. Determine exact active index view.
3. Set organization input to the entire frozen pending generation; if capacity is reached, separately select the oldest 10% of the projected active index as compression input.
4. Request working summary + memory entries + organization delta for the complete organization input, plus compressed segments for the optional compression input.
5. Validate organization coverage and compression coverage independently, then validate every reference, category and tag union.
6. Append raw entries to immutable Knowledge Revision/Evidence ledger.
7. Append Organization Delta; never overwrite prior delta/epoch.
8. Build next index epoch from retained entries + compressed segments + category directory.
9. Coordinate DSH Surface replacement when context compaction is part of the transaction.
10. Atomically promote exact epoch and mark input generation committed.
```

步骤 6–10 的精确 durable commit point 取决于 DSH Surface 回执能力；source pin 后必须写崩溃矩阵。任一步失败：不得发布部分 epoch，不得把 pending 标 committed。

## 6. 最古老 10% 二次压缩

选择算法由 Host 决定，不交给模型：

```text
candidateCount = projected active raw index entries after applying the frozen pending cut
compressionCount = ceil(candidateCount * 0.10)
order = admittedSequence ASC, entryId ASC
selected = first compressionCount entries
```

模型必须归类全部 organization input；10% `selected` 仅限定二次压缩输入，不能代替本轮完整增量整理。Gate：

- 每个 organization input entry 必须恰好有一个 primary placement。
- 每个 selected entry 必须恰好进入一个 primary category。
- secondary category 可为零或多个，但必须存在。
- 每个 compressed segment 的 `childEntryIds` 必须非空且仅来自 selected。
- selected entry 必须全部被 segment 覆盖；禁止 orphan。
- segment canonical tags 必须覆盖 children 的 canonical tag union；允许增加上层分类 tag，不允许丢失 child tags。
- segment 数必须少于 child 数，并使 promoted index footprint 不超过上限；否则 compaction fail-closed。
- 原始 entries 保留在长期 Knowledge/Evidence；active index 仅用 segment 替代其投影。

若上限未达到，仍可在普通 DSH context compaction 中提交 pending raw entries和组织增量，但不强制执行 10% segment 压缩。

## 7. 原始知识与整理增量

每次 successful compaction 追加两组不可变事实：

```text
Raw Knowledge Commit
  - exact validated PendingIndexEntry
  - source Journal evidence refs
  - revision relations

Organization Delta
  - category definitions
  - primary/secondary placements
  - compressed segment summaries
  - child references
```

当前分类结果是这些 delta 的物化投影。全量整理产生新 epoch；不会重写 raw commit 或旧 delta。发现错误分类时追加 correction delta。

## 8. 整理命令

命令面：

```text
/memory-organize incremental
/memory-organize full
```

工具面可对应：

```text
memory_organize({ mode: 'incremental' | 'full' })
```

`incremental`：

- 输入：上一个成功 organization watermark 之后的全部 pending entries；达到容量上限时另取 projected active index 最老 10% 作为 compression input。
- 行为：显式触发 memory-only compaction，提交 raw entries，追加 organization delta，生成新 epoch。
- 达到容量上限时同时压缩最古老 10%。

`full`：

- 输入：全部 active raw knowledge + 全部有效 revision relations。
- 行为：重新生成完整分类投影与新 Organization Epoch。
- 不重复写 Raw Knowledge，不删除旧 delta，不修改 evidence。
- 仍按当前容量规则生成必要 compressed segments。

两种模式都复用唯一 transaction、validator、epoch builder 和 recovery owner。命令是控制入口；mode 不写入业务 Memory 内容。

## 9. 定时整理、存储路径、备份与迁移

整理调度只触发 `incremental` organization transaction，不创建第二套组织实现。调度器通过 typed control side-channel 传递周期、上次 watermark 和失败状态；这些字段不进入 Memory payload。默认关闭，启用后由 profile 配置周期。

存储配置：

```text
memory.root = <user-selected absolute directory>
memory.backup = <optional backup directory>
memory.formatVersion = dsh.memory.store.v1
```

- root 下分离 `pending/`、`knowledge/`、`index/`、`epochs/`、`journal/` 与 `manifest.json`；manifest 记录格式版本和校验 hash。
- 每次不可逆格式迁移前先生成只读备份快照；备份失败则迁移不开始。
- 迁移由唯一 `memory-store-migrate` owner 执行：`discover -> validate -> backup -> migrate -> verify -> activate`；旧版本只读保留，禁止原地覆盖或删除。
- 启动时只加载已验证的 active manifest；版本不兼容显式报错，不静默降级。

## 10. 验证矩阵

正向：

- tool memory 只引用前序已完成事件，进入 Pending Index。
- tool-call、end-turn、summary memory 使用同一 entry schema；缺失/坏 schema 不阻断 parent output，合法 entries 仍可收集。
- threshold 触发选择精确最老 10%。
- compact 同时保存 raw commit 与 organization delta。
- incremental 只处理 watermark 后增量。
- full 生成新 epoch且 raw/evidence hash 不变。

反向：

- 缺 `memory`、unknown field、坏 target、未知 entry ref 不得阻断 parent output；有效 entries 仍按局部校验收集，诊断可回查。
- 当前工具未返回时声称成功的 entry 不得收集，但 parent tool output 仍完成。
- 未 compact entry 不得出现在长期 Knowledge Head。
- 10% selected 出现 orphan、重复 primary、tag 丢失必须失败。
- organization 输出不能降低 index footprint 到上限内时不得 promote。
- compact 中断不得出现 partial epoch、重复 raw commit 或跨 generation 混合。
- full organize 不得覆盖旧 epoch、删除 raw knowledge 或改变 evidence。
- 定时整理与手工整理必须落到同一 transaction owner。
- 迁移前备份失败不得改变 active store；迁移后旧版本可读、manifest/hash 可验证。

## 11. 需要修改的 DSH 插件面

| 插件面 | 动作 |
|---|---|
| tool-call response protocol/parser/projector owner | 扩展或替换：支持 mandatory `memory` sibling field；具体 owner 待 source pin |
| `dsh-compaction-basic` | 替换：summary schema、raw commit、organization、10% compression、epoch promotion |
| `command-compact` | 保留；转发到新 compaction provider |
| tool-result pruner | 保留；不得处理 Memory truth |
| Agent Loop / Session Journal / Surface | 默认保留；只有证明不存在合法插件 seam 才提交 Core fork 决策 |
| dsh-memory `memory-organize` command/tool | 新增 |
| dsh-memory ingest/index/store/organizer/observability | 新增 |
