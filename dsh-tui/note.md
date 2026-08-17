# Working notes

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
- `.appsdk/project.json` and the module registry now declare the same 12 modules, each with build, artifact and regression metadata; lifecycle nodes exactly match the mainline.
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

## 2026-08-17 runtime foundation

- Clean registry probes selected DSH `next` packages at `0.1.0-rc.6`; both registry metadata and the isolated `/tmp/dsh-tui-clean` install expose the required public exports and declarations.
- The pinned Markdown source audit now includes all 46 official settled/streaming fixture outputs. Design verification hashes the repository-owned copies and does not depend on a DSH checkout at gate time.
- The first runtime module, `app-event-bus`, is isolated under `playground/experiments/app-event-bus`; its closed terminal-intent family rejects malformed inputs before dispatch and keeps control fields outside business events.
- `check:design`, all 15 design red tests, TypeScript typecheck, the 6 app-event-bus tests, its build, and runtime-boundary scanning pass. Markdown semantic normalization is still pending and continues to block presentation implementation, not transport or Session foundation work.

## 2026-08-17 runtime modules

- `transport` now uses the installed public `AbstractApiClient` contract with strict loopback endpoint selection and Node HTTP/WebSocket carriers; malformed downlink frames are rejected without corrupting the stream.
- `session` owns exactly one current-cwd Session, fail-closed resume, official history hydration, live seq dedupe, prompt and cancel. Missing/invalid/mismatched resume cwd never creates a replacement Session.
- `presentation` now has the first canonical immutable node model for user/context, streaming and settled assistant blocks, callId-paired tools, turn failures and explicit unknown events. Streaming block-end replaces accumulated deltas instead of duplicating text.
- Verified target suites: transport 7, session 8, presentation 6, app-event-bus 6; all target builds, global TypeScript typecheck, runtime boundary scan and 15 design red tests pass.
