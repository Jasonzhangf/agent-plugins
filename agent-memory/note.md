# dsh-memory run note

## Current baseline

- Goal: produce governance baseline and high-level design; wait for Jason approval before detailed design.
- AppSDK: external binary `appsdk 0.1.6 (rust)`; base `appsdk verify` passed before project-specific edits.
- Workspace: dsh-memory is an AppSDK plugin subproject under the `dsh-plugins` workspace; no Git repository or source implementation exists yet.
- Design input: referenced “总结缓存优化” conversation. Treat DSH/Cairn versions and seams as hypotheses until exact source pin verification.
- Governance correction: AppSDK rejected a proposed module with non-canonical `stage: design`. The project module list remains empty while goal clarification is pending; proposed component boundaries stay human-readable until approval and exact source bindings exist.
- Verification: `appsdk verify .` passed with `project_id=dsh-memory`, `stage=draft`; goal remains `clarification_pending` and no source module is admitted.
- Requirement update: tool-call and compaction-summary outputs require an index-ready `memory` field. Valid entries append to Pending Index; only compaction commits raw knowledge plus organization delta. Capacity compaction selects oldest 10%; manual organization supports incremental/full.
- Design decision: Host owns entry IDs, source-event references, order, watermark, epoch, transaction, hash and errors. Model payload contains only memory semantics and organization references, preserving payload/control separation.
- Execution-order update: root main remains governance/integration only. Each foundation capability, foundation module, plugin, and wiring milestone uses a separate clean worktree and capability-specific verification before integration.
- Architecture direction: high-level design → zones → verified Rust foundation capabilities → foundation module → thin Node bridge/DSH plugin → exact profile wiring. Exact bridge packaging remains source-pin dependent.
- Location correction: Git root/main belongs to parent `dsh-plugins`; `dsh-memory` must not initialize a nested repository. Physical worktrees belong in parent `playground/`.
- Root baseline: `dsh-plugins/main` established at commit `7de9f99`; child AppSDK verify passed and root main was clean.
- Next goal document: `docs/goals/source-pin-plan.md`; MAIN01 performs exact DSH/Cairn source pin and seam investigation in an independent worktree, without product implementation.
- MAIN01 evidence: DSH remote HEAD/tag `4e84901e6471b79ec0338099867ebb4606d12bb5` / `dsh-v0.1.2-alpha.4`; local CLI remains `0.1.1-rc.2`. Cairn reference HEAD `016d2ca272c57ee5fbc0923da34a75965639abd0`, package `@chenhw7/dsh-memory@0.8.0`, MIT.
- Seam decision: retain DSH session/surface/projection/command seams; replace the sole `compaction-basic` provider; add Rust core, bridge, integration plugin, memory commands/tools. Pinned DSH `tool/result` and `compaction/summary` have no sibling `memory`; `meta` is tool-private and forbidden for this payload, so the mandatory field is a Core typed-contract gap, not a plugin fallback.
- Additional evidence: `packages/core/system-prompt/src/index.ts:53-84,467-536` owns PromptSection/PromptContext registration and deterministic assembly; installed headless/web config outputs expose profile-scoped rows `session`, `session-projection`, `compaction-basic`, `command-compact`, `session-checkpoint-policy`, `tool-result-pruner`, `system-prompt`.
- Requirement correction: `memory` is a strict instruction but soft admission. Missing/invalid schema never rejects tool-call, end-turn, or compaction output; valid recognizable entries are collected, invalid parts become side-channel diagnostics, and raw output remains unchanged. Add scheduled organization plus configurable root, backup, format version, and migration owner.
- Store/organization capability added in Rust: append-only raw Knowledge and Organization Delta, deterministic oldest 10% selection by admitted sequence, and prepare-before-mutate interruption safety. All 12 tests pass.
- Pending Index capability added in Rust: append/dedupe, generation freeze with watermark, concurrent generation isolation, and explicit commit boundary that keeps uncommitted entries out of Knowledge. 9 tests pass including prior soft-admission coverage.
- Jason approved detailed design. Detailed contract fixes three source observers (tool-call, end-turn, compaction summary), one soft-admission path, one organization transaction owner, and explicit storage backup/migration lifecycle. Product implementation remains out of scope for this worktree.
- Foundation contracts capability implemented in Rust: optional memory observer never rejects parent output; valid entries from tool-call/end-turn are collected and future-result claims are excluded. `cargo test --all-targets` (5 passed), fmt check and clippy `-D warnings` passed.
- Persistence foundation implemented in Rust: versioned manifest, independent root layout, atomic manifest writes, read-only backup, migration staging, hash/reference verification, explicit unsupported-version and backup errors. Worktree tests (18 passed), fmt, clippy and root `appsdk verify dsh-memory` passed; root main integrated at `47a9e09`.
- Unified state persistence implemented: `MemoryStateSnapshot` serializes Pending Index plus raw Knowledge, Organization Delta and Epoch state to `index/state.json`; manifest records its hash and tampering is rejected on load. Worktree and root gates pass; integrated at `a85e79f`.
# 2026-09-03 online loader verification

- Root cause: OpenCode file-plugin loader requires the V1 identity on the default export object; `{ server }` was rejected with `must export id`.
- Fix: export stable `id = agent-memory` and default-export `{ id, server }` in `plugin/src/opencode.ts`.
- Evidence: exact OpenCode artifact loaded the plugin without loader error on port 4460/4461; config endpoint preserved the configured plugin tuple. Command replay reached RCC `rccgo/deepseek-v4-flash`; its 500/timeout was model-command execution, not plugin loading.
- Verification: plugin blackbox 2/2 and `cargo test --all-targets` pass after fix.
- Follow-up root cause: OpenCode `message.updated` carries assistant memory under `properties.info`; the adapter now unwraps `info` before role/memory/ref projection.
- Live evidence: exact artifact on RCC `http://127.0.0.1:4444/v1` returned HTTP 200 with `info.memory` and `info.structured.memory`; malformed memory was retained as a Core diagnostic without blocking the host response.
- Compaction fix: `session.next.compaction.ended` is processed even when the model omits `memory`; Core `observe_summary` then performs the automatic oldest-10% promotion while still accepting an optional `organized_index` proposal.

# 2026-09-03 continuation verification

- Re-ran `cargo test --all-targets` in the agent-memory worktree: 33 tests passed, 0 failed.
- Re-ran OpenCode adapter blackbox tests with `npx --yes tsx --test plugin/test/opencode.test.ts plugin/test/opencode-bridge.test.ts`: 2 passed, 0 failed.
- Re-ran OpenCode loader and legacy compaction tests in the host fork: 81 passed, 1 intentionally skipped (V2 projector), 0 failed.
- OpenCode V2 `/api/session/{id}/compact` remains an explicit 503 `Session compact is not available yet`; this is a host runtime boundary, not an adapter error. Legacy `/session/{id}/summarize` remains the only available compaction entry for live verification.
- Live legacy summarize replay on the clean session endpoint (`POST /session/{id}/summarize`, RCC `rccgo/deepseek-v4-flash`) timed out after 20s without an HTTP response; no Knowledge promotion evidence was produced. Keep this as an unresolved runtime/model-output gap, not a success claim.
- TUI handoff retry also failed with the same collaboration transport decode error; no receiver accepted the handoff.

# 2026-09-03 Git main protection

- Added executable project hooks and idempotent setup under `agent-memory/.githooks/` and `agent-memory/scripts/setup/`.
- Added worktree-level dispatch hooks so Git's `.githooks` path reaches the project-owned hooks without duplicating enforcement logic.
- `appsdk verify-git-main-protection /Volumes/extension/code/dsh-plugins/playground/opencode-memory-foundation-20260903/agent-memory` passed with `{"ok":true,"git_main_protection":"enabled"}`.
- The clean TUI owner worktree received the same setup and dispatch structure; its protection verification also passed. TUI files were not otherwise modified.

# 2026-09-03 bridge blackbox compaction

- Ran the compiled `target/debug/agent-memory-bridge` with a fresh `AGENT_MEMORY_ROOT` and `AGENT_MEMORY_MAX_INDEX_ENTRIES=10`.
- Ten valid `dsh.memory.index-entry.v1` tool-call observations were accepted with empty diagnostics; the pre-compaction snapshot had no committed entries.
- A compaction summary without `organized_index` returned successfully and advanced generation from 0 to 1. The post-compaction snapshot retained ten projected entries, while `history_current` recorded one compressed segment containing exactly the oldest entry (10% cut). This is direct bridge blackbox evidence for automatic oldest-10% promotion without model organization.
- A follow-up organized-index bridge probe was discarded as harness-input malformed (the JSONL request itself failed to parse before Core observation); it is not product evidence. Proposal coverage remains proven by the typed transaction tests, while a clean blackbox proposal replay is still pending.
- Clean organized-index bridge replay completed with the same ten-entry fixture: all ten observations were accepted, a valid generation-0 proposal covering all ten IDs returned with empty diagnostics, generation advanced to 1, and history persisted the supplied full grouping. This closes bridge-level model proposal projection; live model output remains a separate host/RCC gap.

# 2026-09-03 scheduler owner consolidation

- Moved the duplicate host scheduler implementation into the shared `installMemoryScheduler` owner and wired both `applyMemoryPlugin` and the OpenCode configured plugin through it.
- Added a timer lifecycle test: a positive interval produces only `incremental` organize calls, and disposal cancels the timer. Adapter and Core tests pass after the change.

# 2026-09-03 RCC availability check

- The configured RCC endpoint `http://127.0.0.1:4444/v1/models` currently returns an empty model list (`{"data":[],"models":[],"object":"list"}`). This explains why a live OpenCode compaction request cannot yet produce a model `organized_index`; no adapter or Core failure is inferred from the empty provider catalog.

# 2026-09-03 bridge persistence reopen

- Fresh bridge process admitted one valid end-turn memory and ran `organize incremental`, returning `knowledge_count: 1` and `pending_count: 0`.
- A second bridge process reopened the same `AGENT_MEMORY_ROOT`, returned the same generation-1 snapshot, recalled the entry by `persisted`, and returned the persisted epoch. This is direct process-boundary persistence/reopen evidence.

# 2026-09-03 governance map audit

- `appsdk verify` passes the current contract, but `.appsdk/maps/module-registry.json` remains `status: design` and its `owned_paths` still reference the historical `playground/experiments/dsh-memory/**` layout rather than the implemented `src/`, `plugin/`, and `tests/` paths. This is a governance binding gap, not evidence of an implementation failure; final architecture admission must update and gate the real paths.
- Updated the module registry `owned_paths` to the actual project-root paths (`src/**`, `plugin/**`, `compaction/**`, `tests/**`, `docs/**`, and project manifests). `appsdk verify` and Git protection verification pass; module status remains `design` until the full function/mainline/verification binding is admitted.
- Added real product entries to the function map for Core observation, compaction, transaction, bridge, OpenCode adapter, and scheduler owners. An attempted TypeScript mainline-chain entry was rejected by the AppSDK symbol gate and removed; the canonical mainline map remains unchanged until a verifier-compatible cross-language binding is defined.

# 2026-09-03 unified Git main protection gate

- Memory and TUI clean owner worktrees each contain executable project hooks plus worktree dispatch hooks.
- `appsdk verify-git-main-protection` passed for both project roots with `{"ok":true,"git_main_protection":"enabled"}`.
- Both owner worktrees are clean after the gate; main and unrelated dirty files were untouched.

# 2026-09-03 RCC provider availability recheck

- `http://127.0.0.1:4444/v1/models` returns HTTP 200 with an empty catalog, but this is not a provider outage: authenticated `POST /v1/chat/completions` using configured key `RCC_API_KEY` and requested model `gpt-5.5` returned HTTP 200 and `finish_reason=stop`.
- Streaming completions also returned HTTP 200 SSE frames. A constrained organization prompt returned valid JSON `{\"segments\":[{\"child_entry_ids\":[\"entry-1\",\"entry-2\"]}]}`.
- RCC resolves the requested route to response model `glm-5.3`; this route/model normalization must remain explicit in replay evidence.
