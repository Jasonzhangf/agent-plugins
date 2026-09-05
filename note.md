# dsh-tui — 2026-08-27 status

## 当前主线
branch `main` @ `d199ef5 fix(tui): normalize turn-error message from any reason shape into non-empty label`
remote 已 push origin/main.

## turn-error fix 交付
- worktree: `playground/tui-turn-error-projection-20260827T000000Z` (cleaned)
- base: `d098185`
- commit: `9ba0956` (worktree) → `d199ef5` (main, cherry-picked)
- 红测 → 绿: presentation 2 cases + terminal-ui 1 case
- gates: 77/77 design PASS, typecheck PASS, runtime boundaries PASS,
  test:presentation 10/10, test:terminal-ui 13/13, test:app-shell 10/10,
  test:app-container 9/9, test:terminal-lifecycle 12/12, test:simulator 6/6,
  build:runtime PASS, git push OK
- fix:
  - presentation: `turnErrorMessage()` 处理 string / failure.message / nested failure.message → 'turn failed'
  - terminal-ui: `extractText` 非空守卫

## 当前状态盘点
| Phase | 描述 | 状态 |
|-------|------|------|
| A | 五个 display plugin + chrome-slot-registry | ✅ main (953a95e) |
| B | refresh-orchestrator | ✅ main (6a6246e) |
| C | slash-command + session-switcher | ✅ main (67b49b0) |
| D | overlay-manager + composer | ✅ main (d199ef5, 8/8 + 6/6 PASS) |
| E | status-footer + 完整 composition | ✅ main (5761cb4, 7/7 PASS) |
| F | runtime acceptance | 🚧 进行中 |
| G | AGY review + mainline merge identity | ⏸ 未开始 |

## Phase F/G 阻塞
来源: `dsh-tui/docs/evidence/04-regression-report.md` + `verification-map.json`:
- `dual_client_live_session`: provider quota 阻止 assistant-token streaming → 本机无法绕过
- `visual_approval`: pending_jason — 需要截图审批
- `architecture_review_pass`: pending — 需要 DSH review
- `mainline_merge_identity`: pending

## 待办（按 Jason 决定优先级）
- 启动 dsh-tui 实际跑，截图给 Jason 审 visual_approval
- 跑 AGY review（当前 task 系统未提供 MCP tool，备用本地 agy 直接跑）
- 解决 dual_client_live_session：换 provider 凭据或跳过 streaming 子需求

## worktrees 当前
- `playground/tui-app-container-executable-frame-phase1-20260823T075126Z-163b018b` @ `main` (活动)
- `playground/multikey-fix-20260825T191352Z-19857-multikey-fix` (其他项目)

## agent-plugins root Guidance — 2026-09-04

- 本 root 是四个一方项目的共享 Guidance 面：`agent-tui`、`agent-memory`、
  `Teams`、`dsh-concurrency-limit`；`agent-memory` 当前不在 `origin/main`，保持
  pending，不伪造 source/owner/path。
- AppSDK 0.1.6 已由官方 `prepare`/`init` 初始化；Guidance enforcement 为
  advisory；child project 的 maps、contracts、records、Active、Protected 和历史
  hash 仍由各自 owner 保持。
- Feature 必经 `requirements -> map_check -> implementation -> candidate ->
  validation -> review -> integration -> cleanup`；architecture、map_update、
  effectiveness、promotion 只能作为显式按需 bypass。Debug 必经
  `orient -> explore -> resolve -> candidate -> validation -> review -> integration
  -> cleanup`，explore 必须追加 worker run notes。
- 当前 root owner worktree：
  `playground/agent-plugins-guidance-20260904T110619Z-67350-3cda6928`；root map 中
  原先指向 `AGENTS.md`/Skill 的 synthetic mainline edges 已移除，因为 AppSDK
  0.1.6 verifier 只接受其已注册 Rust source；官方 Guidance edges 保留。
- 下一步：复核 JSON/map，执行一次官方 `appsdk pin-lock`，随后
  `appsdk guide compile`、`appsdk verify`、`appsdk compile`；完成后复核 AGENTS、
  local Skill、MEMORY，再按授权交付和 cleanup。

## Root AppSDK residue cleanup — 2026-09-04

- Jason authorized removing obsolete root AppSDK migration/generated residue;
  child project truth and historical child evidence remain outside this scope.
- In the root owner worktree, the old `.appsdk/contracts/`, `.appsdk/docs/`,
  `.appsdk/rules/`, `.appsdk/skills/`, `sdk-resources.json`, `sdk.lock`,
  `sdk.bin`, and project `.appsdk/migrations/` were quarantined, then the
  official local AppSDK 0.1.6 `init`/`pin-lock` regenerated the current
  surface. The temporary quarantine and probe were removed by exact path after
  validation.
- Current local AppSDK 0.1.6 `verify` passes at `contract_bound`; `compile`
  passes. The latest artifact hash is recorded in the append-only run notes,
  not embedded here, so the source summary cannot make the artifact input
  self-referential.
  `.appsdk/migrations/` is absent. `.appsdk/contracts/migrations/` remains
  because it is part of the current 0.1.6 canonical bundle, not an active
  project migration transaction.
- The root project maps remain distinct from the SDK canonical maps. The
  Guidance plan was revised through AppSDK as
  `plan-agent-plugins-guidance-20260904-2`; its next projected node is
  `requirements`. Root Guidance delivery is not yet reviewed, integrated, or
  pushed.
- 2026-09-05 root AppSDK refresh: official current 0.1.6 `init` refreshed the SDK resources. The stale project migration witness was isolated to `/tmp/appsdk-agent-plugins-legacy-0.1.5-to-0.1.6-20260905`, then current-binary `pin-lock` regenerated the lock and migration record. Root maps are byte-identical to `origin/main`; child project truth was not edited. Final `appsdk verify .` and `appsdk compile .` pass with artifact `sha256:713eed4c0db2e3e91692021f426d003faec67a2d52c5161d6032d7d9bc8517c`. The old root governance schema files `contracts/goal-clarification-state-machine.json` and `contracts/lifecycle-state-machines.json` were removed after the current verifier classified them as noncanonical; project-owned goal/review record contracts remain.
- 2026-09-05 final compile correction: adding the closeout memory/note facts changed the source hash, so the official compile was rerun. Final artifact is `sha256:729d1b2436536ef12feda4da8184a59a977dea502262c00c57e75abad05b64fa`; verify remains PASS.
- 2026-09-05 artifact binding note: the final compile hash is evidence, not a source input. Use the last official compile output and run evidence after the candidate tree settles; do not embed it in `MEMORY.md` or `note.md`.

## Root project-memory rebuild — 2026-09-05

- Owner worktree: `playground/agent-plugins-memory-rebuild-20260905`, based on
  `origin/main @ 50254523c1fb4568493fde848bb0ab2ff035eadf`.
- Jason approved the ASCII architecture classification and authorized durable
  memory write-back for the whole `agent-plugins` root, not only `agent-tui`.
- Official `project-memory review --run
  20260905T102122Z-Macstudio-14330` accepted 22 project entries: 3 `plan`, 6
  `path`, 7 `knowledge`, and 6 `lesson`. `project-memory index` and
  `project-memory verify .` report project scope ready with 22 nodes and a
  candidate-only semantic backend.
- The recorded architecture fact is precise: `agent-tui` has an implemented
  AgentHost/AgentRemote seam and OpenCodeServeClient is the only current
  concrete adaptor; ACP adaptor family/selection remains target work. The
  source-level TUI contracts are richer than the current child AppSDK
  function/mainline bindings, which is recorded as a governance gap.
- Validation: `appsdk verify .` and `appsdk guide compile .` pass. `appsdk
  compile .` is currently blocked before artifact generation by
  `SDK_BINARY_DIGEST_MISMATCH` (current local 0.1.6 binary SHA differs from the
  existing lock compiler digest); no lock, migration, or historical record was
  changed to conceal the drift.
