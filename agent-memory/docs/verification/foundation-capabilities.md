# dsh-memory 基础能力验证设计

状态：test design；实现前必须绑定真实 symbols、commands 和 CI/build gates。

## 1. 统一验证层

每项能力必须同时具备：

1. Contract/schema red tests。
2. Pure/unit whitebox。
3. Capability blackbox；只走公开 API。
4. Positive + negative pairing。
5. Persistence/reopen 或 state-machine recovery；适用时强制。
6. Architecture gate：owner、allowed paths、imports、payload/control leakage。
7. Evidence：input hash、artifact hash、command、producer、result。

## 2. 能力清单

| ID | 基础能力 | 正向必须证明 | 反向必须证明 | Foundation admission |
|---|---|---|---|---|
| FC01 | Memory Contracts + Soft Admission | tool/end-turn/summary 共用 entry schema；存在时 round-trip 等价 | 缺 `memory` 或坏 schema 不得阻断 parent output；可识别有效条目收集，坏部分写诊断 | schema hash + positive/negative admission evidence |
| FC02 | Eligible Source Window | tool memory 只绑定当前调用前完成事件；summary 绑定 exact compact range | 当前未返回 tool result 不能声明成功；越界 ref 失败 | exact Journal fixtures |
| FC03 | Pending Index | atomic append、exact dedupe、reopen 后不丢 | 验证失败不能产生半条；重复 idempotency 不重复写 | reopen/concurrency blackbox |
| FC04 | Generation Freeze | G42 freeze 后新 emission 只进 G43 | 不跨 generation 混合；失败 G42 不伪装 committed | concurrent boundary evidence |
| FC05 | Revision/Evidence Ledger | add/revise/contradict/retract 保留历史和 evidence hash | 旧 revision/evidence 不可覆盖；坏 target 失败 | immutable-ledger blackbox |
| FC06 | Organization Delta | 全部增量恰好一个 primary placement；secondary refs 合法 | orphan、unknown category、重复 primary、raw mutation 失败 | coverage/property tests |
| FC07 | Oldest 10% Compression | `ceil(N*0.10)`、稳定排序、child refs/tag union 完整 | 选择非最旧、漏 child、tag 丢失、segment 不减小必须失败 | deterministic golden vectors |
| FC08 | Epoch Promotion | raw + delta + epoch 一致发布；incremental watermark 正确；full raw hash 不变 | partial epoch、重复 raw commit、旧 epoch 覆盖失败 | crash-point matrix + reopen |
| FC09 | Recall | pending/committed current 查询、history/evidence、exact/BM25 顺序正确 | retracted 默认不返回；越 scope、伪命中、无结果注入失败 | public API blackbox |
| FC10 | Cache Snapshot | pending append 不改变 stable system/tools/frozen epoch hash；compact 后只在边界切换 | 普通 write 改前缀、dynamic system injection、未成功 compact 切 epoch 失败 | cache replay metrics |
| FC11 | Typed Error/Control | parse/storage/compact errors 进入独立 error chain | metadata/debug/provider/retry/epoch 泄漏到 Memory payload 必须红 | static scan + serialization tests |
| FC12 | Transaction Recovery | success/failure/non-terminal/already-terminal 均可确定恢复 | retry 不能重复提交；错误不能包装成功；未知 state fail-closed | fault-injection matrix |

## 3. Foundation Module Gate

只有 FC01–FC12 全部满足下列条件，才能构建 `dsh-memory-core`：

- 目标 contract 已确认。
- 红测曾按预期失败，修复后转绿。
- capability blackbox 只使用公开 API。
- 所有持久状态在 reopen 后一致。
- 正反证据绑定 exact candidate commit 和 artifact。
- architecture gate 无重复 owner、非法 import、shortcut、payload/control 泄漏。
- required gates 已接入 build/CI；只手动执行的检查不能称 gate。

## 4. Foundation Module 黑盒

组装后重新验证：

```text
empty store
  -> tool memory emission
  -> Pending Index
  -> concurrent generation freeze
  -> raw + organization compaction
  -> 10% compression when threshold reached
  -> epoch promotion
  -> incremental recall
  -> process restart
  -> history/evidence/full organize
```

失败注入点至少覆盖：parse 后、pending append 前后、freeze 后、raw commit 前后、delta append 前后、epoch build 后、promotion 前后、restart 后。

任何 partial truth、重复 raw commit、跨 generation 污染、旧 epoch 覆盖或 control leakage 都阻止 Foundation admission。
