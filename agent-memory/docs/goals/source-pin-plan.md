# dsh-memory Source Pin Plan

状态：ready for execution

阶段：MAIN01；只读源码调查与设计证据，不实现产品代码。

## 1. 目标与验收标准

固定 DSH 与 Cairn 的 exact source truth，证明 dsh-memory 所需 seams 的真实 owner、类型、调用顺序和替换边界，为高层设计批准与详细设计提供证据。

验收：

- DSH remote、exact commit、version/tag、license、build/package 信息可复核。
- Cairn remote、exact commit、version/tag、license、可复用与禁止复用边界可复核。
- tool-call `summary` 从 provider response 到 parser/type/projector/session/tool execution 的完整调用链已定位。
- Compaction provider、summary、Surface replace、events、lock/recovery 的完整调用链已定位。
- PromptSection、PromptContext、Session Journal、Surface、Subagent 的真实 contract 与 cache 行为已定位。
- 指定 DSH profile 的 preset、realm、plugin row IDs 通过真实配置入口获取；不写死旧调查值。
- 每个结论包含 exact commit、path、symbol、line/evidence；找不到的标 `binding pending`。
- 明确哪些 DSH 插件保留、替换、新增；若 tool `memory` sibling 字段无插件 seam，明确唯一 Core 修改点，不设计 fallback。

## 2. 范围与边界

In scope：

- DSH 官方仓库当前可用主线源码。
- Cairn `dsh-memory` 参考实现。
- 本机已安装 DSH 的版本、profile 与 `dump-config` 真源。
- 只读构建/测试用于验证公开 contracts；不改 DSH、Cairn 或运行配置。
- 更新 dsh-memory research/design/maps 的 `design/pending` 条目。

Out of scope：

- 实现 Memory Core、Node bridge 或 DSH plugin。
- 修改或安装 DSH profile。
- 运行 migration、promotion、freeze、review。
- 根据旧对话猜 symbol、row ID、provider、endpoint 或 license。
- 复制 Cairn 或 DSH 源码到 dsh-memory。

## 3. 设计原则

- Official source + exact commit 是唯一源码真源。
- 搜索只定位；必须打开 owning source 和 caller/callee 验证。
- 每条主线只记录相邻调用边。
- control/error/provider/epoch 状态与 Memory payload 物理隔离。
- 没有合法 seam 时显式报告 capability gap；不使用 metadata、summary stuffing 或双路径 fallback。
- 根 `main` 只接收完成验证的 research/design change set；调查在独立 worktree 执行。

## 4. 技术方案与文件

执行 worktree：

```text
dsh-plugins/playground/dsh-memory-main01-source-pin-<run-id>/
```

计划新增或更新：

- `dsh-memory/docs/research/dsh-source-pin.md`
- `dsh-memory/docs/research/dsh-symbol-inventory.md`
- `dsh-memory/docs/research/cairn-source-pin.md`
- `dsh-memory/docs/architecture/dsh-seam-decision.md`
- `agent-memory/docs/design/agent-memory-high-level-design.md`
- `dsh-memory/.appsdk/maps/{resource,function,mainline-call,verification}-map.json`：仅写已证实或明确 `pending` 的项目条目。
- `dsh-memory/note.md`：调查证据与下一步。

调查链：

```text
source identity
  -> tool response chain
  -> compaction chain
  -> prompt/session/surface contracts
  -> profile/realm/plugin rows
  -> Cairn reuse/license boundary
  -> seam decision
  -> requirements/design/maps consistency
```

## 5. 风险与规避

| 风险 | 规避 |
|---|---|
| 旧调查与当前源码漂移 | 所有结论绑定 exact commit，不复用旧 symbol 断言 |
| tool `memory` 字段破坏 provider wire format | 追 parser/projector owner；只在合法 typed seam 扩展 |
| compaction 继承点不能保证原子性 | 写事件与崩溃时序；不足则选择完整 provider replacement |
| Cairn license/实现不能复用 | 分离“设计参考”和“代码复用”；无授权不复制 |
| profile row ID 因 preset/profile 变化 | 通过当前真实 `dump-config` 获取并记录输入 profile |
| 研究文档冒充机器真源 | map 条目标 `design/pending`；无 gate 不称 active |

## 6. 验证矩阵

| Gate | 证明 |
|---|---|
| `source_identity` | remote/commit/tag/version/license 相互一致 |
| `tool_response_chain` | provider → parser → type → projector → journal/tool execution 相邻边完整 |
| `memory_field_seam` | sibling `memory` 可通过 typed plugin seam，或确认唯一 Core owner |
| `compaction_chain` | trigger → summarize → surface replace → end/recovery 顺序完整 |
| `prompt_cache_contract` | PromptSection/PromptContext 更新边界与 cache 影响有源码证据 |
| `profile_wiring_truth` | current profile/preset/realm/row IDs 来自真实配置输出 |
| `cairn_reuse_boundary` | license、版本、可复用代码与需重写部分明确 |
| `map_consistency` | docs node IDs、resource/function/mainline/verification maps 一致 |

## 7. 实施步骤

1. 从 root `main` exact commit 创建 MAIN01 独立 worktree。
2. 读取 workspace rules、dsh-memory note/MEMORY、AppSDK goal/maps。
3. 固定 DSH/Cairn remote 与 exact commit；记录 license/build/package identity。
4. 追踪 tool response、compaction、prompt/session/surface、profile 四条源码主线。
5. 使用本机真实 DSH 配置入口验证 profile/realm/row truth；只读，不修改。
6. 判定 tool `memory` 和 compaction 的最小合法 replacement/addition surface。
7. 产出 research、symbol inventory、seam decision 和 map updates。
8. 运行 link/JSON/AppSDK/map consistency checks。
9. 提交 exact research change set；根 main 精确集成后重跑验证。
10. MAIN01 gate PASS 后，提交高层设计批准；不自动进入实现。

## 8. 完成定义

- MAIN01 全部 gates PASS。
- 无未注明的推测、伪 symbol 或写死 row ID。
- 明确 tool protocol、compaction、context、store/index 和 wiring 的保留/替换/新增边界。
- 根 main clean，research commit 可定位。
- AppSDK 仍为 `draft`；Goal 只有 Jason 批准后才转 `confirmed`。
- 没有产品源码、运行配置或用户环境变更。
