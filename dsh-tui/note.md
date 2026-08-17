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
- Capability result: 32 selected capabilities source-verified, 3 approved N/A, 0 design-blocked. Installed package public exports remain unverified until a clean-registry gate exists.
- Added complete registry groups, canonical node rules, BottomPane/focus model, terminal lifecycle, static simulator fixture matrix and positive/negative test design. Runtime remains absent.

## 2026-08-17 design-admission correction

- Jason found that the 33-row WebUI audit and 35-row capability binding used different IDs, the AppSDK project declared only 7 of 12 registered modules, the lifecycle names lagged the mainline, and `appsdk verify` was being described too broadly.
- Capability audit and bindings now share one exact 35-ID namespace with bidirectional coverage and derived `32 source_verified / 3 approved_n_a / 0 blocked` counts.
- `.appsdk/project.json` and the module registry now declare the same 12 modules, each with build, artifact and regression metadata; lifecycle nodes exactly match the mainline.
- `appsdk verify .` is explicitly only the AppSDK bootstrap check. `pnpm run check:design` is the project design-contract checker and has red tests for capability, module, lifecycle, gate, transport and Markdown drift.
- Transport is fixed to `--endpoint`, then `DSH_WEB_URL`, then `http://127.0.0.1:3080`, with loopback-only validation and no probing. Resume rejects missing, invalid or different `SessionSummary.cwd`.
- The TUI mounts selected owner Remote contributions directly and never mounts the aggregate `@deepseek-ai/dsh-api-remotes/client`.
- Markdown alignment is scoped to a pinned official settled/streaming corpus and normalized semantic-token differential tests; the runtime corpus and gate remain implementation blockers.
