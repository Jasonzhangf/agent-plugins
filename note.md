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
