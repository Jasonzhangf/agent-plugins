# agent-memory Main

本文件是 agent-memory 功能 main 文档。Git root main 由上一级治理定义；详细设计只能细化，不能绕过阶段或并行制造第二条业务主线。

## 1. 根 main 责任

根 `main` 是只读检查与集成面：

- 保存 AppSDK 契约、根文档、设计、maps、verification、records。
- 接收已经在独立 worktree 完成能力验证、模块验证、运行验证和 review 的精确 change set。
- 在集成后重新执行受影响 gate。
- 不承载开发 dirty、不运行探索性修改、不共享 worktree。

实现 worktree 固定放在：

```text
<agent-plugins-root>/playground/agent-memory-<milestone>-<run-id>/
```

每个 worktree 只处理一个语义 milestone。依赖 milestone 必须从前置 milestone 已进入 main 的精确 commit 创建新 worktree。

## 2. 唯一主线

```mermaid
flowchart LR
  M00[MAIN00 Governance Root]
  M01[MAIN01 Source Pin]
  M02[MAIN02 High-level Design]
  M03[MAIN03 Zone Contracts]
  M04[MAIN04 Foundation Capabilities]
  M05[MAIN05 Foundation Module]
  M06[MAIN06 OpenCode Plugin]
  M07[MAIN07 Profile Wiring]
  M08[MAIN08 Deployed Verification]
  M09[MAIN09 Review and Promotion]

  M00 --> M01 --> M02 --> M03 --> M04 --> M05 --> M06 --> M07 --> M08 --> M09
```

禁止 shortcut：

- 未完成 source pin，不得伪造宿主 symbol、row ID 或 plugin owner。
- 未完成 zone contract，不得实现基础能力。
- 单项基础能力未通过正反验证，不得进入 foundation module。
- foundation module 未独立通过模块黑盒，不得构建 DSH plugin。
- plugin 未通过离线 contract test，不得接线 OpenCode profile。
- 未完成全局安装、受管重启、用户入口真实样本，不得 review。

## 3. 阶段 Gate

| Node | 输入 | 输出 | Exit gate |
|---|---|---|---|
| MAIN00 | 用户目标 | 根 main、AppSDK draft、计划 | `appsdk verify` |
| MAIN01 | OpenCode 仓库 | exact commit、license、真实 seams | `opencode_source_pinned` |
| MAIN02 | 已验证源码事实 | 批准后的高层设计 | `high_level_design_approved` |
| MAIN03 | 高层设计 | resource/function/mainline/module/verification maps | `architecture_boundaries` |
| MAIN04 | 基础能力 contracts | 每项实现与正反证据 | capability-specific gates |
| MAIN05 | 已验证能力 | `agent-memory-core` artifact | `foundation_module_blackbox` |
| MAIN06 | Core artifact + OpenCode seams | plugin artifact | `plugin_contract_blackbox` |
| MAIN07 | plugin artifact + exact profile | 可运行 OpenCode 配置 | `wiring_identity` |
| MAIN08 | 已接线运行态 | 安装、重启、cache、memory、recovery 真实证据 | `deployed_blackbox_effectiveness` |
| MAIN09 | exact verified commit | reviewer PASS、promotion records | `review_admission` + selected review PASS |

## 4. 当前状态

```text
MAIN00 Governance Root       complete
MAIN01 Source Pin            pending
MAIN02 High-level Design     clarification_pending
MAIN03+                      blocked by approval and source pin
```

“complete”只表示治理根已创建并通过 base verify；不表示产品能力完成。
