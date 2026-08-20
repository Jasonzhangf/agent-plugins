# Working notes

## 2026-08-18 full-development goal

- Added `docs/goals/dsh-tui-full-development-plan.md` as the executable implementation plan for the approved Ink/Cordis runtime.
- The plan freezes the official DSH Host/WebUI boundary, current-cwd Session scope, public-API-only integration, single Ink carrier, fixture/simulator parity, PTY verification, registry installation, dual-client online verification, DSH Review ordering, and generated-output exclusion.
- The plan is a delivery contract, not evidence that implementation, install, online verification, or review is complete.

## 2026-08-17 Markdown tokenizer implementation

- `presentation` owns assistant Markdown semantic parsing; renderer remains downstream and cannot consume raw Session events.
- WebUI reference uses `mdast-util-from-markdown` with GFM for streaming and GFM plus math for settled content.
- TUI will use the same public parser libraries, an independently authored compatibility extension, and repository-owned semantic fixtures.
- `semantic-tokens.json` is the expected contract, never runtime-generated during tests.
- User, context, and steering nodes remain literal and bypass the Markdown parser.
- The 23-fixture semantic-token contract is admitted. Settled uses GFM plus math; streaming uses GFM only.
- Assistant text blocks now carry immutable terminal-neutral Markdown tokens; reasoning and user-originated nodes remain literal.
- `test:markdown`, presentation build, design gate, runtime boundaries, and CI wiring are active. Next owner is `component-registry`.

## Design reset

- Legacy TUI source and TUI-only worktrees were removed from the workspace under Jason's explicit authorization.
- The fresh project was initialized with external AppSDK 0.1.3 and its SDK lock was pinned.
- Current work is design-only. No runtime, package manifest, renderer, installer, or Playground experiment has been created.
- Next design gates are the pinned Codex TUI selection audit and the capability-by-capability official WebUI semantic public-input audit.

## 2026-08-17 component and capability audit

- Audited Codex TUI commit `9a6668f674d74b35418fa534b3b6285a315d0765`: retained event-bus, history/streaming cell, BottomPane stack, focus, invalidation and terminal-lifecycle contracts; rejected copying the Rust/Ratatui implementation.
- Audited official DSH WebUI roster and presentation behavior at commit `47f943859bef60e4160492346772ded9b24f765a` across 33 capability domains.
- Selected exact `ink@7.1.1` on Node 22+ and React 19.2+ as the terminal carrier. Cordis remains the registry/lifecycle composition owner.
- OpenTUI is excluded from v1 because its native renderer currently requires Bun or Node 26.4 with experimental FFI, outside the one-command Node profile target.
- Capability result corrected after review: 30 official-source-verified, 2 TUI-owned, 3 approved N/A, 0 design-blocked. Installed package public exports remain unverified until a clean-registry gate exists.
- Added complete registry groups, canonical node rules, BottomPane/focus model, terminal lifecycle, static simulator fixture matrix and positive/negative test design. Runtime remains absent.

## 2026-08-17 design-admission correction

- Jason found that the 33-row WebUI audit and 35-row capability binding used different IDs, the AppSDK project declared only 7 of 12 registered modules, the lifecycle names lagged the mainline, and `appsdk verify` was being described too broadly.
- Capability audit and bindings now share one exact 35-ID namespace with bidirectional coverage and derived `30 source_verified / 2 tui_owned / 3 approved_n_a / 0 blocked` counts.
- `.appsdk/project.json` and the module registry declare the same runtime modules plus one governance/build owner, each with build, artifact and regression metadata; lifecycle nodes exactly match the mainline.
- `appsdk verify .` is explicitly only the AppSDK bootstrap check. `pnpm run check:design` is the project design-contract checker and has red tests for capability, module, lifecycle, gate, transport and Markdown drift.
- Transport is fixed to `--endpoint`, then `DSH_WEB_URL`, then `http://127.0.0.1:3080`, with loopback-only validation and no probing. Resume rejects missing, invalid or different `SessionSummary.cwd`.
- The TUI mounts selected owner Remote contributions directly and never mounts the aggregate `@deepseek-ai/dsh-api-remotes/client`.
- Markdown alignment is scoped to a pinned official settled/streaming corpus and normalized semantic-token differential tests; the runtime corpus and gate remain implementation blockers.

## 2026-08-17 DSH Review correction

- DSH Review correctly found that active design gates were not connected to the existing CI entrypoint, the pinned DSH audit commit was not asserted by the checker, and two project-owned capabilities were incorrectly counted as official source evidence.
- CI now installs the pinned AppSDK 0.1.3 release binary with SHA-256 verification, uses a frozen lockfile, and runs `pnpm run check`, which invokes both the design checker and its red tests.
- The checker now rejects audit status or DSH commit drift and requires the bindings to carry the same commit pin.
- `terminal.layout-components` and `simulator.static-web` are now `tui_owned`, not `source_verified`.
- The PASS review's remaining P2 findings were also closed: the Codex audit pin now runs inside the CI-wired checker, dispositions are a closed mapping, module owned paths are bidirectionally equal, and MEMORY describes derived-count verification accurately.

## 2026-08-18 runtime continuation

- The declared runtime worktree is `playground/dsh-tui-runtime-20260817T101736Z-Macstudio-60685-cfeef2` on `feature/dsh-tui-runtime`; existing source, map, and test changes are preserved.
- Transport, Session, presentation MVP, app-event-bus, app-shell, component registry, focus manager, terminal UI, and terminal lifecycle have source experiments and focused tests; fixture-contract, simulator, and installer were still pending entrypoints.
- The first implementation slice is fixture-contract. Its unique owner validates a versioned manifest, referenced canonical-node fixtures, control/payload separation, path containment, deterministic bundle identity, and the existing pinned Markdown corpus. Terminal and browser consumers must load through this contract rather than reconstructing fixture semantics.

## 2026-08-17 runtime foundation

- Clean registry probes selected DSH `next` packages at `0.1.0-rc.6`; both registry metadata and the isolated `/tmp/dsh-tui-clean` install expose the required public exports and declarations.
- The pinned Markdown source audit now includes all 46 official settled/streaming fixture outputs. Design verification hashes the repository-owned copies and does not depend on a DSH checkout at gate time.
- The first runtime module, `app-event-bus`, is isolated under `playground/experiments/app-event-bus`; its closed terminal-intent family rejects malformed inputs before dispatch and keeps control fields outside business events.
- Runtime foundation admission completed with the first app-event-bus module. The later Markdown section records the current presentation state.

## 2026-08-17 runtime modules

- `transport` now uses the installed public `AbstractApiClient` contract with strict loopback endpoint selection and Node HTTP/WebSocket carriers; malformed downlink frames are rejected without corrupting the stream.
- `session` owns exactly one current-cwd Session, fail-closed resume, official history hydration, live seq dedupe, prompt and cancel. Missing/invalid/mismatched resume cwd never creates a replacement Session.
- `presentation` now has the first canonical immutable node model for user/context, streaming and settled assistant blocks, callId-paired tools, turn failures and explicit unknown events. Streaming block-end replaces accumulated deltas instead of duplicating text.
- Verified target suites: transport 7, session 8, presentation 6, app-event-bus 6; all target builds, global TypeScript typecheck, runtime boundary scan and 15 design red tests pass.

## 2026-08-17 component registry implementation

- Component registry owns exact group/kind resolution, effect-owned registration disposal, duplicate owner/kind rejection, deterministic manifest compilation, and renderer boundary rejection for raw Session events, transport frames, API clients and control metadata.
- The runtime contract manifest is checked against the architecture registry with exact group/member equality; runtime does not scan source directories.
- The root build artifact is a fixed wrapper over the generated module so its installed import path does not inherit the Playground-relative contract JSON path.
- Renderer input is now a closed typed presentation/interaction envelope and renderer output is a terminal-neutral element descriptor or typed intent. All registered control families fail at any nested prop depth.
- Root package, AppSDK maps/checkers, support gates and TUI CI wiring now belong to the unique `governance-build` module; the design checker rejects zero-owner and overlapping-owner paths.

## 2026-08-18 component registry MVP boundary

- The component-registry runtime remains an isolated MVP experiment. Its mainline bindings to presentation and terminal-ui are still pending, so architecture/function/module status remains `design`/`pending`; no admitted terminal renderer is claimed.
- The MVP gate now has one executable CI command: component-registry tests, build, and root artifact import.
- Positive coverage includes both closed presentation-node and interaction-state renderer input contracts.

## 2026-08-18 runtime finalize pass 1 — root cause + admission gate confusion

- Took lease over from stale `20260818T170000Z-Macstudio-30626-fixtures` (worktree HEAD 964cf90 already past fixtures phase). New run `20260818T190000Z-Macstudio-dsh-tui-mvp-finalize`.
- Audited runtime tree:
  - `lib/` is stale (last write 10:08, after last source edit 10:03) — partial build artifact.
  - `tsconfig.json` (root) has no `include`/`exclude`, so it sweeps whole project and trips on stale `lib/**/*.d.ts`.
  - `runtime.tsconfig.json` properly scopes `src/** + playground/experiments/*/src/** + contracts/tui/**/*.ts`, uses TS 6.0.2 (supports `rewriteRelativeImportExtensions`), and `tsc --noEmit -p runtime.tsconfig.json` returns exit 0 / no output. **It is already green.**
  - `scripts/pending-module.mjs` is a stub that exits 2 with "module implementation not admitted; runtime source absent by design" for every `pnpm run build:* / test:* / typecheck`. The earlier "typecheck red" reports were conflating real source errors with stub refusal.
- Real blockers remaining (not stale-lib, not missing ts flag):
  1. Root `tsconfig.json` needs `exclude` so it does not scan `lib/`.
  2. `scripts/pending-module.mjs` must be replaced with the real implementations for the 13 module scripts so `pnpm run check` actually executes them, not the stub.
  3. `startTui` does not yet honour `DSH_WEB_URL` env (only `--endpoint` cli); `/quit` is not registered; eventDispose leaks on resume/create error branches.
  4. `contracts/tui/fixtures/cases/` only has 2 cases; MVP needs reasoning/tool/error/status/multi-viewport.
  5. `simulator.js` is a stub at repo root; need a real static HTML review page that renders the same fixture IDs.
  6. installer has only manifest-write tests; must verify `~/.rcc/config.v3.toml` profile isolation against the official Web profile.
  7. No PTY / dual-client live verification recorded.
  8. clean-registry install + exports gate not yet executed.

## 2026-08-18 runtime continuation — session and control path

- The first red runtime gap was `resume()` rejecting an already-selected Session with `already-selected`. The unique owner is `session`: selection now prepares and hydrates the target first, then atomically aborts old mux/host streams and activates the new snapshot. Failed validation/hydration leaves the old Session and streams untouched; paired tests cover both paths.
- `app-shell` previously accepted an ad-hoc duplicate `AppEvent` union and mixed slash commands into the BusinessAction family. It now consumes the canonical `TuiInputIn02AppEvent` envelope, emits closed `TuiInputIn03BusinessAction` variants only for business mutations, and routes slash commands through a separate control action callback. Unexpected envelope/intent fields are rejected.
- Pending approval/question frames are now retained as session-local interaction state with the server-request rpcId kept in a private control map. Responses use the installed public `respond()` API and remove the interaction only after an accepted receipt; unknown IDs fail closed.
- Async prompt/cancel/resume/interaction failures are routed to the runtime controller error/status surface. The current static and focused runtime suites pass; browser, registry-install, PTY and dual-client live evidence remain open.

## 2026-08-18 MVP goal checkpoint

- Added the executable MVP continuation section to `docs/goals/dsh-tui-full-development-plan.md`.
- MVP is the smallest usable vertical slice: installed public-API client, current-cwd Session, hydrated history/live frames, canonical transcript nodes, Ink composer/transcript/status, static simulator, client-only installer, clean registry install, PTY evidence and same-Session WebUI dual-client evidence.
- Extended unsupported capabilities remain fail-closed; no private import, second Host, replacement Session, fake stub or generated artifact may be used to pass admission.
- The next execution prompt must reference this plan and must not regenerate another prompt.

## 2026-08-18 continuation audit

- The active runtime worktree is cleanly declared on `feature/dsh-tui-runtime`; source changes are uncommitted and generated `lib/` output remains ignored.
- Current evidence: `pnpm run check`, `pnpm run typecheck`, `pnpm run check:runtime-boundaries`, runtime build and installed-artifact `--help`/root-import checks pass.
- Current non-closed gates remain clean-registry package identity/install, PTY behavior, browser simulator evidence, official WebUI dual-client live evidence, map status promotion, and DSH Review.
- The runtime build emits the public package entrypoints from `src/cli.ts`; the historical `src/cli.js` is not part of the scoped TypeScript build and must not be used as an installed entrypoint.
- No DSH Web Host is currently listening on ports 3080, 5555, or 6666; online evidence is therefore not yet available and must use an explicitly recorded host PID and endpoint.

## 2026-08-18 continuation — resume audit + evidence plan

- Continuing the MVP goal from an idle state (no active goal). Created goal-03f59ed5.
- Baseline re-established green: pnpm run check (23 design red tests), typecheck, check:runtime-boundaries, check:public-exports, and all 14 module builds + 14 module test suites pass.
- Online host verified REACHABLE: host at http://127.0.0.1:3080 answers the installed public client (AbstractApiClient subclass). session.list returns real sessions (incl. subagent sessions); host.describe => version 0.0.1, provider opencode-go-pool, model deepseek-v4-flash, 30 attachedSessions. Online dual-client evidence is feasible against this host.
- Wire protocol confirmed: unary POST /api/<method> with {type:client-request,rpcId,method,payload}; SSE GET /api/events.mux and /api/events.host. readSse uses plain fetch, \n\n framing.
- Module statuses: presentation=in_progress, terminal-ui=design, installer=design; all others implemented. Function map: install_client_only_profile=pending, project_conversation_semantics=in_progress.
- No PTY or simulator visual evidence infrastructure exists yet. No headless browser package confirmed installed.
- Remaining MVP gates to close: (1) status promotion + pending-gate wiring, (2) clean-registry package install evidence, (3) PTY evidence, (4) static simulator browser evidence, (5) online dual-client evidence, (6) DSH Review, (7) commit/push.
- Next action: record per-gate evidence under docs/evidence/, starting with the self-contained clean-registry install gate, then PTY, then simulator visual, then online dual-client.

## 2026-08-18 terminal input first-divergence

- Direct `NodeApiClient.sessions.prompt()` succeeds against the live Host, while the installed TUI-created Session remains blank; the first divergence is before the Host API.
- `terminal-lifecycle` previously mounted Ink with `null` during `enter()` and rerendered the real tree later. A red/green test moved the unique first mount to `render()` with the complete tree.
- Real PTY replay then exposed Ink's duplicate-instance warning for the same stdout. The active single hypothesis is synchronous first-mount invalidation: the shell resize effect calls the controller before the factory return assigns `this.instance`, causing a second Ink factory call.
- Confirmation signal: a factory-triggered synchronous nested `render()` calls the factory twice. Disproof signal: one factory call with the newest frame rerendered after the instance is assigned.

## 2026-08-19 transport downlink first-divergence

- Terminal-lifecycle reentrancy red test is green: synchronous invalidation mounts one Ink instance and rerenders the latest pending tree.
- The next first divergence is `pnpm run typecheck`: `transport.ts:116` invokes a constructor-only `TuiWebSocketCtor` without `new` (`TS2348`).
- Installed `dsh-client-connection` docs and the pinned official `WebApiClient` source confirm network downlinks are exactly WebSocket for `/api/events.mux` and `/api/events.host`; ordinary GET returns 426 and SSE is only an in-process Fetch carrier. Current SSE-shaped project tests contradict that public network contract.
- Transport owner fix plan: restore positive/negative WebSocket module tests, prove the constructor misuse red, then change only the transport owner and rerun typecheck, transport build/test, runtime boundaries and real-host downlink replay.

## 2026-08-19 architecture gate first-divergence

- `pnpm run check:design` prints `IMPLEMENTATION_ADMISSION: BLOCKED` but exits 0; aggregate `pnpm run check` omits typecheck and runtime-boundary gates.
- Module ownership verifies only handpicked paths, not the declared source surface; multiple build scripts/contracts and root entry files have no machine-enforced owner. Runtime boundary scanning reads imports but does not bind the complete project graph to module dependencies.
- First architecture red tests target: an unowned source file, an undeclared parsed cross-module import, and an aggregate check that omits required architecture gates.

## 2026-08-19 AppSDK governance first-divergence

- `appsdk verify .` first ran the globally installed AppSDK 0.1.4, not the project-pinned 0.1.3. AppSDK 0.1.4 expects sixteen record contracts, while this project and CI are locked to 0.1.3.
- The exact 0.1.3 release binary was downloaded using the CI URL and verified against the locked SHA-256. Its embedded canonical project template confirms the existing twelve-contract set; no 0.1.4 migration belongs in this goal.
- The governance red-test fixture copied the root `node_modules` symlink because its filter rejected only descendants, then attempted to create the same symlink and failed with `EEXIST`.
- Unique owner is `governance-build`: normalize only the AppSDK declaration and fixture-copy boundary, then rerun `appsdk verify`, design red tests, aggregate check, typecheck and runtime-boundary gates.

## 2026-08-19 clean-install dependency first-divergence

- Current tarball installs, exports and CLI help pass, but `npm ls --all` fails: exact direct rc.6 packages coexist with transitive rc.7 packages selected by `^0.1.0-rc.6`, leaving the root rc.6 Session invalid against rc.7 peers.
- Registry truth now reports `next = 0.1.0-rc.7` for every selected public package; the manifest still recorded rc.6.
- Unique owner is `governance-build`: bind the selected registry version to every required public package dependency, verify the tag resolves to that exact version, regenerate the lock, then repeat pristine install and `npm ls --all`.

## 2026-08-19 PTY smoke first-divergence

- Real PTY created Session `session-9b79b8e6-5337-4b63-a8a2-818dbca4d4bc`, rendered the Ink shell, and accepted `/quit` text, but the harness sent text and carriage return as one burst and timed out before command dispatch.
- The harness then referenced nonexistent Expect variable `wait_result`, so it could not report child status and always claimed success via its final `exit 0` path.
- Unique owner is `terminal-lifecycle` test harness: set deterministic PTY dimensions, send text and Return as separate input events, fail on timeout, and propagate the exact child exit status.

## 2026-08-19 PTY, reconnect, and live dual-client checkpoint

- PTY root cause confirmed: Expect did not wait for Ink to consume `/quit`, so text plus carriage return arrived as one paste-shaped input; the previous `stty` also targeted the wrong phase. The portable harness now sets `stty_init` before spawn, waits for `cursor=5 mode=idle`, sends Return separately, fails on timeout, and propagates the child exit code. Real replay exits 0 with full terminal restoration.
- The remaining transport/session plan gap was real: WebSocket peer close ended the stream and Session never rehydrated missed history. Transport now reconnects the same public endpoint after unexpected close; Session treats each later mux open as a control generation, rehydrates from public history before admitting frames, clears stale interaction channels, and preserves last-good history on explicit rebaseline failure. Positive and negative tests pass.
- Current built TUI survived an exact official Host stop/restart, re-rendered the same Session history, accepted `/quit`, restored the terminal, and exited 0. Official Web profile hashes were identical before/after restart.
- TUI submitted `仅回复 DSH_TUI_DUAL_CLIENT_A` to `session-b49440dc-5600-4fe4-8141-5371010eb5c9`; official WebUI opened the same Session and displayed the same user event and Host error. The locked OpenCode Go / DeepSeek V4 Flash request hit the provider weekly quota (429, reset in four days); no provider/model substitution was attempted.
- WebUI-to-TUI submission is waiting for Jason's action-time confirmation for the browser Send action. Successful assistant streaming and DSH Review remain externally blocked by the same OpenCode Go quota unless DSH reports the review runtime itself unavailable.

## 2026-08-19 replacement-candidate local verification

- Closed the remaining local interaction gaps: typed `/help` and current-cwd `/resume` overlays; multiline cursor editing; resize and transcript scrolling; running/idle Ctrl+C split; typed pending/failed local echo outside canonical transcript; canonical public `ToolEventView` rendering; visibly distinct reasoning blocks.
- Resource/function maps now separate terminal control state, ephemeral pending-input projection and canonical Session truth. Positive/negative tests prove convergence without mutating the canonical transcript or leaking control semantics into business payloads.
- The sandbox rejects the `tsx` CLI control socket (`EPERM`). Every test script now uses the documented Node loader form, `node --import tsx --test`, so tests execute without creating that IPC socket.
- Exact AppSDK 0.1.3 verify, design contracts, 29 red tests, typecheck, runtime-boundary scan, all 13 module suites (125 tests total), every module build and runtime build pass for the replacement source tree.
- Replacement tarball packs successfully with SHA-256 `333e887aec752b76dba6acb3dbfbc35c1c004408066007abf1b823e71ec62bca`.
- Fresh install is not yet evidence: the sandbox cannot write the default npm cache and cannot resolve `registry.npmjs.org`; an empty writable cache cannot supply the published dependency graph. The previous clean-install/PTy report is therefore explicitly superseded and the related gates are pending.
- Official Host remains unavailable because starting `dsh web` needs a write to `/Users/fanzhang/.dsh/profiles/web/cordis.yml`, outside the current writable roots. No second/fake Host was used. Fresh installed PTY, same-Session dual-client replay, visual approval, DSH Review, commit and push remain open.

## 2026-08-19 terminal failure-chain completion audit

- The lifecycle contract named stdin EOF and unhandled rejection as restoration paths, but the implementation attached neither boundary. It also exposed only a `Promise<void>` to CLI/plugin startup, so a lifecycle `failed` state was projected as exit code 0.
- Added paired red tests, then made `terminal-lifecycle` the unique owner of stdin EOF and unhandled-rejection restoration. Exact listener identities live in a plain nested box because Cordis wraps function-typed own properties; teardown now removes the registered listeners exactly once.
- Added the typed `TuiErrorOut01TerminalFailure -> TuiErrorIn02StartupOutcome -> TuiErrorOut03ProcessExit` error chain. Lifecycle failure now carries the original Error through `TuiStartupOutcome`; CLI and Cordis plugin startup report it and exit 1. Normal EOF remains exit 0.
- Resource map now separates `terminal_failure_chain` and `process_exit_control` from business truth. Function/mainline/lifecycle maps bind the owners, and new architecture red tests reject missing error-chain bindings or unknown resource-relation endpoints.
- Exact AppSDK 0.1.3 verify, 31/31 architecture red tests, typecheck, runtime-boundary scan, terminal-lifecycle 16/16, runtime 4/4 and affected builds pass. Replacement tarball SHA-256 is `3e1af65df0beadb53f89c854120acaca3f41d5ddb342fbfbb139a70f01cefd7d`.

## 2026-08-19 viewport control completion audit

- Real lifecycle resize events entered the runtime controller outside `TuiAppEventBus.publish`, so malformed zero/negative dimensions could mutate the terminal width even though the canonical terminal-intent validator rejected the same values.
- `app-event-bus` now owns one exported `validateViewportSize` parser; both the typed intent validator and app-shell runtime resize path call it. App-shell has one `handleResize` mutation point shared by Ink callbacks and direct controller input.
- The red/green test proves invalid resize fails before viewport mutation. App-event-bus 7/7, app-shell 17/17, affected builds, exact AppSDK 0.1.3 verify, 31/31 design red tests, typecheck and runtime-boundary scan pass.
- Current replacement tarball SHA-256 is `eb6131529aad8fa3f2b37f981460826e90dd15d7b4883ac3f7b3a4820ae1ec51`.

## 2026-08-19 generated-evidence commit boundary

- Completion audit found PTY logs, simulator PNGs and the generated simulator report visible to `git status`; the release contract explicitly forbids logs, screenshots and generated artifacts in the final commit.
- Added exact ignore rules for those three generated evidence surfaces while keeping the Markdown evidence records trackable. The governance verifier now fails if any required ignore clause disappears; its red test proves the commit boundary is executable rather than advisory.
- Exact AppSDK 0.1.3 verify, 32/32 architecture red tests, typecheck, runtime-boundary scan and `git diff --check` pass. `git status --untracked-files=all docs/evidence` now exposes only the four intentional Markdown evidence records.

## 2026-08-19 executable clean-install gate

- The `clean_registry_install` registry entry pointed only to `check:public-exports`, which could pass against the worktree and did not build, install or execute a pristine artifact. CI likewise lacked a real clean-install step, so the documented release gate was not machine-enforced.
- Added installer-owned `scripts/verify-clean-install.mjs` and `pnpm run check:clean-install`. It builds and packs the current tree, creates an isolated install root and npm cache, installs the tarball from registry dependencies, runs `npm ls --all`, verifies non-symlink realpath and package identity, executes installed CLI help, checks public exports against the clean root, and emits the tarball SHA and installed realpath.
- The verification map now names that executable command, CI runs it, and a red test rejects removal of the CI step. Exact AppSDK 0.1.3 verify, 33/33 design red tests, typecheck, runtime boundaries, installer 4/4, installer build and script syntax pass.
- A real gate run reached the isolated `npm install` and failed closed. Its npm debug truth records `ENOTFOUND registry.npmjs.org` for the registry and all required dependencies; it did not use worktree, link, portal, workspace or cached fallback. Current packed candidate SHA-256 is `fafdc7f84adef31063def4c68a56e72867aa9063204620b079115fb7de44eede`.

## 2026-08-19 external blocker audit — blocked threshold reached

- Four consecutive goal turns observe the same external state after local owner-scoped work was exhausted: `127.0.0.1:3080` refuses connections, npm registry DNS returns `ENOTFOUND`, and the official Web profile is not writable from the task sandbox.
- Remaining acceptance requires the original official Host/profile, a registry-resolved pristine install, installed PTY replay, Jason-approved WebUI Send, same-Session dual-client evidence, then DSH Review. A copied profile, second Host, offline dependency substitution, provider/model switch, fake Session or review-before-runtime would violate the goal and hard guards.
- The goal is therefore genuinely blocked on external-state/user-authority changes. The feature claim remains held and no code, evidence, review PASS, commit or push is fabricated.

## 2026-08-19 resumed online artifact check

- Official Host is reachable at `http://127.0.0.1:3080` with PID `31205`; raw `host.describe` reports version `0.0.1`, cwd `/Volumes/extension/code/dsh`, provider `opencode-go-pool`, model `deepseek-v4-flash`, and `canOpenPath: true`, but omits the `home` field required by the rc.8 public response schema. The rc.8 `NodeApiClient.host.describe()` therefore fails schema parsing; this is an external Host/client version mismatch, not a TUI success.
- The clean-installed artifact at `/private/var/folders/jm/blkk8bbd6v78rv2pwxgxh3kr0000gn/T/dsh-tui-clean-install-P8ZkhV/install/node_modules/dsh-tui` ran under a real 80x24 PTY against the official Host, created Session `session-95244dea-5b76-46f5-a9d1-a9c8340227fc`, consumed `/quit`, restored alternate screen/cursor, and exited `0`; tarball SHA-256 `8101fe5931a1b892116a506c6e7bdff5a575e1a4836075151292142a80d620dc`.
- The same installed artifact resumed Session `session-b49440dc-5600-4fe4-8141-5371010eb5c9` and rendered its public history, including the authoritative OpenCode Go weekly-quota `429` turn error. The first harness replay falsely timed out because it matched a split/wrapped transcript token; the process was gone and terminal output showed the complete history and idle state. No provider/model substitution was attempted.

## 2026-08-19 host/client contract root cause and correction

- The official Host process is `dsh 0.1.0-rc.6`; its public `host.describe` value intentionally has no `home` field. The TUI dependency graph was pinned to rc.8, whose public schema makes `home` required, so the first divergence was the rc.8 client response parser before any TUI business projection.
- The official rc.6 `AbstractApiClient` resolves the same live Host response successfully. The unique correction owner is governance-build dependency/registry selection: align every direct public DSH dependency and the clean-install manifest to the Host's exact rc.6 contract. TUI-side defaulting, stripping, or host modification remains forbidden.

## 2026-08-19 same-Session dual-client live replay

- Official WebUI created `session-8a1aa31c-773b-4307-87ff-14f6973a19de` at `/Volumes/extension/code/dsh`; Host PID `31205`, endpoint `http://127.0.0.1:3080`, provider/model `opencode-go-pool/deepseek-v4-flash`.
- WebUI submitted `DSH_TUI_WEBUI_A`, then `DSH_TUI_WEBUI_B` while clean-installed TUI was connected. TUI hydrated A, observed B live, entered streaming, then projected the authoritative 429 error.
- TUI submitted `DSH_TUI_TUI_C` to the same Session. Official WebUI displayed it; public history recorded all three prompts and turn-error seqs 18, 27 and 36. No provider/model substitution.
- Error-state PTY replay sent Ctrl+C after C's 429, restored alternate screen/cursor and returned child exit 0. Evidence: `docs/evidence/webui-dual-client/2026-08-19-live.md`.
- Acceptance remains open for successful assistant-token streaming because the locked provider weekly quota resets in four days; visual approval, DSH Review and final identity delivery remain pending.

## 2026-08-19 current artifact re-verification

- Re-ran pinned AppSDK 0.1.3 aggregate design gate, typecheck, runtime-boundary
  scan, full `regression_report` command and clean-registry install. All passed;
  tarball SHA-256 is still `6e31a1ff3beae80461cf57f01bf797816d6c86beb82eb4b87d3669663cb19443`.
- `regression_report` was promoted to active in the verification map;
  presentation module and `project_conversation_semantics` function were
  promoted to implemented because their required gates and full module suites
  are active/passing.
- A fresh public-API probe on Session
  `session-8a1aa31c-773b-4307-87ff-14f6973a19de` confirmed the locked provider
  still returns the weekly `GoUsageLimitError` after accepting the prompt. The
  last turn seq reached 45 and projected the same 429; no provider/model
  substitution was attempted.
