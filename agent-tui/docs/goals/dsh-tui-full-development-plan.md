# dsh-tui Full Development Plan

Status: implementation execution plan. Runtime work is performed only in the
declared AppSDK Playground worktree and is promoted through the existing Active
artifact and review gates.

## 1. Goal and acceptance

Build an installable `dsh-tui` TypeScript/Node Cordis plugin that provides a
Codex-style terminal client for the official DSH Host. The TUI and official
WebUI must remain independent clients of the same Host and selected Session;
the official WebUI must remain unchanged and usable while the TUI is active.

Minimum usable release (MVP):

- launch from a real plugin/CLI entrypoint;
- connect only through the installed public DSH API surface;
- create a Session for canonical `process.cwd()` by default;
- resume only an explicitly selected Session with the same canonical cwd;
- hydrate history before accepting live input;
- render user, assistant, streaming assistant, reasoning, tool, error and
  status nodes in a scrollable transcript;
- provide a locally rendered multiline composer with cursor movement, submit,
  cancel, `/resume` and `/quit`;
- keep terminal input, alternate screen, resize, suspend/resume and restoration
  under one lifecycle owner;
- preserve simultaneous official WebUI input/output against the same Host and
  Session;
- run the offline static Web simulator from the same canonical fixture bundle.

Final release acceptance additionally requires clean-registry installation,
official WebUI zero-diff verification, real PTY evidence, same-Session
bidirectional online evidence, package/profile verification, and DSH Review
PASS after those runtime facts are installed and exercised.

## 2. Scope and boundaries

In scope:

- the fourteen registered TUI modules: governance-build, app-event-bus,
  transport, session, presentation, logic-controls, component-registry, terminal-ui,
  focus-manager, terminal-lifecycle, fixture-contract, app-shell, simulator,
  and installer;
- typed contracts, project-owned canonical nodes, project-owned terminal
  renderers, public DSH transport adapters, and test fixtures;
- client-only profile installation and release packaging;
- static simulator and deterministic terminal/browser fixture comparison;
- operational verification with a running official DSH Web profile.

Out of scope:

- changes to `deepseek-harness`, its official WebUI, its Web profile, or its
  source/runtime packages;
- a second Host, Agent, Session persistence layer, model adapter, or provider;
- direct persistence reads, private DSH imports, copied WebUI presentation
  runtime, or an aggregate Remote mount;
- Rust, Ratatui, a Node/Rust bridge, custom IPC, or a second protocol;
- cross-workspace resume, general session management screens, or silent
  fallback/replacement-session behavior;
- committing build output, generated indexes, local package stores, or secret
  configuration.

## 3. Design invariants

1. The official DSH Host, public ApiProxy and Session event log are the only
   business truth. TUI process state is a projection or control resource.
2. Mainline stages are adjacent and typed:
   `terminal intent -> app event -> business action -> public API request ->
   Host mutation`, and `Host history/frame -> decoded contract -> projection ->
   resolved component -> Ink tree -> terminal frame`.
3. Control data such as endpoint, reconnect generation, health, cancellation,
   focus, invalidation and lifecycle never enters business payload, metadata,
   projection nodes, fixtures or component props.
4. No fallback, silent strip, guessed semantics, private import, fake success,
   empty projection, or renderer-side business reconstruction is permitted.
5. Cordis owns plugin discovery/lifecycle/registries; Ink owns the single
   terminal carrier; projectors own business-to-view projection; renderers own
   terminal presentation only; app-shell owns orchestration.
6. Every canonical node has one projector owner, one renderer owner and
   positive, negative and unknown-input coverage.
7. Runtime consumes validated Active artifacts only. Playground source is
   never a runtime discovery path.

## 4. Technical plan and file ownership

The machine truth remains in `.appsdk/project.json`, `.appsdk/maps/*`,
`.appsdk/architecture/*`, contracts under `contracts/tui/**`, and the package
verification scripts. The following source and tests belong to the existing
module owners and must not be moved across ownership boundaries.

### Runtime modules

- `playground/experiments/transport/**`: endpoint validation, public
  `NodeApiClient`, HTTP/WebSocket/RPC carriers, reconnect and error chain.
- `playground/experiments/session/**`: current-cwd create/resume, history
  hydration, public event subscription, cancellation and mutation dispatch.
- `playground/experiments/presentation/**`: canonical projection nodes,
  stable identities, streaming/settled convergence, tool topology, status,
  workflow, errors, and Markdown semantic tokens.
- `playground/experiments/fixture-contract/**`: fixture schemas, manifest
  loading, provenance, fixture validation and semantic corpus comparison.
- `playground/experiments/app-event-bus/**`: typed intent/event contracts,
  bounded dispatch and wrong-family rejection.
- `playground/experiments/app-shell/**`: startup composition, action routing,
  command handling and shutdown coordination.
- `playground/experiments/component-registry/**`: deterministic grouped
  registry, duplicate-owner rejection and typed renderer resolution.
- `playground/experiments/terminal-ui/**`: terminal-neutral descriptor
  composition and renderer installation; no direct DSH calls or raw events.
- `playground/experiments/focus-manager/**`: BottomPane stack, focus owner,
  cursor owner and overlay transitions.
- `playground/experiments/terminal-lifecycle/**`: sole Ink/React carrier,
  alternate screen, raw input, resize, suspend/resume and restoration.
- `playground/experiments/simulator/**`: offline browser carrier using the
  fixture contract; never connects to DSH.
- `playground/experiments/installer/**`: client-only profile, package release,
  install/uninstall and official Web zero-diff checks.

Generated files such as `generated/**`, module build artifacts, caches,
screenshots and local logs remain ignored and are never staged.

## 5. Implementation sequence

Each step must pass its module gate before the next dependent step starts.

1. Contract consolidation: move shared shell/descriptor types into public
   `contracts/tui/**`; remove duplicate DTO definitions; keep maps and source
   entry symbols synchronized.
2. Runtime boundary: replace pending design-only module scripts with real
   build/test entrypoints and ensure runtime imports resolve only to public
   contracts and Active artifacts.
3. Transport: implement endpoint precedence and validation, public
   `NodeApiClient`, request/response validation, mux/host subscriptions,
   reconnect, abort and explicit error propagation.
4. Session: implement canonical cwd creation, fail-closed resume, history
   baseline, live frame application, mutation queue and cancellation.
5. App path: connect terminal intents through app-event-bus and app-shell to
   session public mutations; prove no renderer bypass.
6. Fixture contract: materialize manifest, canonical-node, transcript,
   interaction, overlay, status and Markdown settled/streaming fixtures with
   pinned provenance and hashes.
7. Presentation MVP: implement user/assistant/reasoning/tool/error/status
   projectors, stable streaming nodes, history/live convergence, tool pairing,
   and Markdown semantic-token conformance.
8. Terminal MVP: implement committed/streaming transcript cells, width-aware
   reflow, scroll anchoring, local multiline composer/cursor, submit/cancel,
   `/resume`, `/quit`, BottomPane priority and orthogonal status rendering.
9. Extended presentation: add retry, interruption, cancellation, compaction,
   max-token, queue/steering, workflow/trajectory, plan/goal/jobs,
   approval/question, model/context/tools and command/attachment/feedback
   surfaces where public DSH inputs are available. Missing public inputs stay
   explicit and fail closed.
10. PTY lifecycle: verify raw input, alternate screen, resize,
    suspend/resume, EOF/signals, render exceptions, rejected promises and
    restoration with no child-owned process exit.
11. Static simulator: render the same canonical fixture IDs in a separate
    browser registry; build deterministic HTML/PNG outputs and verify widths,
    streaming states, tools, overlays and errors in a browser.
12. CLI/plugin entry: add executable plugin startup, argument parsing,
    endpoint resolution, resume selection and explicit diagnostics. No
    auto-start that bypasses the official Web profile.
13. Installer/release: build a registry package, update only the client-only
    TUI profile, verify package exports/lock integrity and preserve official
    Web profile, sessions, credentials and provider configuration.
14. Full verification: clean install from registry, run the installed CLI,
    restart the official Web profile, exercise `/resume`, send a real prompt,
    verify streaming/history/tool/error output, and exercise WebUI input/output
    concurrently against the same Session.
15. Delivery: record evidence, run DSH Review only after installed runtime and
    online evidence, resolve findings, promote/freeze Active artifacts, then
    precisely stage source/contracts/docs only and commit/push. Never stage
    generated output.

## 6. Risks and mitigations

- Public package drift: clean-registry export and declaration checks run before
  runtime and in CI; missing exports block only the dependent capability.
- WebUI/TUI semantic drift: pinned official commit, provenance hashes and
  normalized semantic-token differential corpus are mandatory.
- Streaming duplication or stale history: stable node IDs, rebaseline after
  reconnect, monotonic revisions and history/live convergence tests.
- Tool topology errors: pairing belongs to presentation projector and consumes
  public tool views; renderer receives only canonical tool nodes.
- WebUI disruption: client-only profile and official Web zero-diff install test;
  TUI never mounts or patches the official Web profile.
- Terminal corruption: one lifecycle owner and PTY tests for every exit/error
  path; no child component calls raw mode or process exit.
- Unbounded output: preserve semantic payload, use view-level collapse and
  scrolling, never truncate business truth.
- Dirty worktree/generated artifacts: AppSDK zone checks, explicit ignored
  output paths and precise staging before commit.

## 7. Verification matrix

| Area | Required evidence |
|---|---|
| Governance | `appsdk verify dsh-tui`, `pnpm run check:design`, `pnpm run test:design` |
| Boundaries | `pnpm run check:runtime-boundaries`, typecheck, import-edge and ownership gates |
| Modules | each implemented module build plus regression suite; no pending script for an admitted module |
| Transport | endpoint positive/negative tests, public export resolution, mux/host reconnect and error tests |
| Session | cwd equality, absent/invalid/different-cwd resume negatives, history baseline, live append and cancel |
| Projection | canonical node schema, stable IDs/revisions, official public-input fixtures, tool/error/workflow negatives |
| Markdown | settled/streaming corpus, provenance/hash lock, semantic-token positive/negative differential tests |
| Terminal | Ink tree snapshots, 40x12/80x24/120x36 layout, composer/focus/scroll/reflow and PTY restoration |
| Simulator | offline-only guard, fixture parity, deterministic HTML/PNG and browser-rendered visual evidence |
| Installer | registry-only package, profile isolation, official Web zero diff, uninstall preservation |
| Online | installed CLI + official WebUI same Host/Session, two-way prompt/event/update verification |
| Review | DSH Review semantic PASS after all installed/online evidence; commit tree matches reviewed tree |

Every stateful boundary has paired positive and negative tests: success vs
failure, still-running vs terminal, accepted vs wrong-family, same-cwd vs
different-cwd, complete vs malformed, and normal restoration vs abnormal exit.

## 8. Definition of done

The plan is complete only when:

1. `dsh-tui` installs from a registry package into the configured global plugin
   directory/profile without local checkout or symlink dependencies.
2. The CLI starts the TUI through the declared plugin entrypoint and renders a
   usable Codex-style session screen with local input, history, status and
   streaming progress.
3. A real prompt sent from TUI is visible and progresses in TUI and official
   WebUI; a prompt sent from WebUI is visible and progresses in TUI.
4. Resume is limited to canonical current cwd and rejects out-of-scope IDs
   without replacement sessions.
5. Terminal restoration succeeds across all registered lifecycle failures.
6. Static simulator and terminal tests consume identical canonical fixtures,
   while their renderer implementations remain separate.
7. Official WebUI/profile/config/provider behavior is unchanged by installation
   or uninstallation.
8. All required gates pass, runtime evidence is recorded, DSH Review passes,
   and only intentional source/contracts/docs are committed.

Until item 8 is evidenced, report the exact blocking gate and do not claim the
plugin is complete.

## 9. MVP execution checkpoint

The first implementation target is a minimal usable release, not a visual
prototype and not a second DSH runtime. Work must finish the following
vertical slice before extended capability work:

```text
installed public DSH packages
  -> NodeApiClient
  -> current-cwd Session create/resume
  -> history hydration + live public frames
  -> canonical user/assistant/reasoning/tool/error/status nodes
  -> component registry
  -> Ink transcript + BottomPane + multiline composer
  -> installed CLI/plugin entrypoint
```

MVP must support:

- a real installed entrypoint with strict endpoint precedence;
- a new Session in the canonical current working directory;
- fail-closed same-cwd `--resume` and `/resume`;
- hydrated history before input is accepted;
- local composer rendering, cursor movement, multiline editing and submit;
- visible user echo, assistant streaming, reasoning, running/completed tool,
  error and running/idle status states;
- cancel, `/quit`, `Ctrl+C`, `Ctrl+D`, scroll and terminal resize;
- alternate-screen/raw-mode restoration on normal and error exits;
- the official WebUI remaining unchanged and usable while TUI is connected;
- the offline static simulator rendering the same fixture IDs.

MVP does not include new business semantics for unsupported public DSH
capabilities. Those capabilities remain explicit and fail closed until their
official public input/projection surface is available. Do not implement empty
stubs, replacement sessions, private imports, copied WebUI code or a second
Host to make a gate green.

### MVP execution order

1. Replace every admitted pending build/test command with a real command and
   make the scoped runtime typecheck authoritative; exclude ignored output
   from root typecheck.
2. Complete the public transport and Session vertical slice, then rerun its
   positive/negative tests.
3. Complete presentation nodes and fixture cases for user, assistant
   streaming, reasoning streaming, running tool, error and status; keep
   semantic payload lossless.
4. Connect app-event-bus, app-shell, component-registry, terminal-ui and
   terminal-lifecycle into one Ink carrier with local composer and focus/scroll
   behavior.
5. Complete the static simulator using the shared canonical fixture bundle and
   verify desktop and narrow viewport rendering in a browser.
6. Complete client-only installer/profile behavior without changing the
   official Web profile, provider, credentials or session configuration.
7. Build and pack the plugin, then install from a clean registry source. The
   installed package must resolve only published exports and must not resolve
   through checkout, `file:`, `link:`, `portal:` or `workspace:` dependencies.
8. Run an installed PTY test and an online same-Host, same-cwd, same-Session
   dual-client test with the official WebUI. Verify both directions, streaming,
   history and cancellation.
9. Run DSH Review only after all installed and online evidence is complete;
   repair findings, then precisely stage source/contracts/docs and commit/push.

### MVP release gate

The MVP is complete only when all of these are evidenced in the same runtime
version:

- `pnpm run check` and all implemented module build/test commands pass;
- runtime boundary, public-export, import-edge and fixture gates pass;
- clean registry install and package/profile verification pass;
- PTY evidence proves local input, transcript progress and restoration;
- browser evidence proves the static simulator is nonblank, complete and
  readable at desktop and narrow widths;
- online evidence proves TUI and official WebUI can both read/write the same
  Session without replacing or short-circuiting the WebUI;
- DSH Review returns an unambiguous semantic PASS;
- the commit contains intentional source/contracts/docs only, with no `lib/`,
  `generated/`, `artifacts/`, tarball, cache, screenshot or secret.

Until the release gate passes, report the exact failing gate and continue from
the next smallest owner-scoped task; do not report the plugin as usable or
complete based on local unit tests alone.
