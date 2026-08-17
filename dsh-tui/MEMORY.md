# dsh-tui project memory

## Confirmed product truth

- The official DSH WebUI remains unchanged. The TUI is an independent TypeScript/Node Cordis client of the same official DSH Host, ApiProxy, and Session event-log truth.
- The TUI profile is client-only and must not mount `dsh-base`, Agent, Session persistence, model adapters, or a second inference host.
- Startup defaults to a new Session in the canonical current cwd. `--resume` and `/resume` are restricted to Sessions in that same cwd; general multi-session and cross-workspace management are out of scope.
- TUI presentation behavior is independently extracted from audited official WebUI source and tests. WebUI and TUI do not share presentation runtime code, and the TUI does not replace official Web plugins.
- Every projector, terminal renderer, control, overlay, and status component is a typed Cordis plugin. Renderers consume canonical TUI nodes rather than raw Session events.
- Runtime integration uses only public DSH API, event, projection, tool-view, and generic RPC contracts. Private `src/*` imports, checkout dependencies, persistence reads, and silent fallback are forbidden.
- The project follows external AppSDK governance. Mutable source begins only in admitted Playground worktrees; runtime consumes verified Active artifacts; AppSDK implementation is never copied into this repository.
- The terminal carrier decision is exact `ink@7.1.1` on Node 22+ with React 19.2+. Ink owns terminal layout/reconciliation only; Cordis owns deterministic component registries and plugin lifecycles.
- The Codex TUI behavioral reference is pinned to commit `9a6668f674d74b35418fa534b3b6285a315d0765`. Adopt its typed app-event bus, committed/streaming cell split, BottomPane stack, focus, invalidation and terminal-restoration concepts without adopting Rust/Ratatui.
- The official WebUI behavior audit is pinned to DSH commit `47f943859bef60e4160492346772ded9b24f765a`. The selected v1 set has 32 source-verified capabilities, 3 approved N/A entries and no design-blocked capability; runtime admission still requires clean-registry public-export proof.
- The offline static simulator and terminal snapshots share canonical fixture IDs and data, but use separate browser and Ink renderer registries. The simulator never connects to DSH.

## Retired direction

- The Rust renderer, Node-to-Rust bridge, four-pipe protocol, delivery ledger, windowed projection protocol, shared Web presentation export prerequisite, Web plugin replacement, and full multi-session UI are retired and must not be revived from legacy branches or memory.
