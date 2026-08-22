# DSH TUI v3 architecture

Status: confirmed v3 runtime implementation; delivery admission remains gated by verification-map.

## v3 app-container composition

The v3 output pipeline adds `TuiOutputIn06AppContainerFrame` between the
foundation `TuiOutputIn05InkTreeComposed` node and the terminal lifecycle's
`TuiOutputOut07TerminalFrame`. The `chrome-controls` Cordis plugin is the sole
owner of typed slot projection: it consumes five required logic-control
projections and publishes exactly five closed immutable slot models. The
`app-container` Cordis plugin owns view-model assembly, layout policy, slot
ordering and refresh validation; it does not project chrome truth or own
Session, transport, agent or logic-control truth. Its `tui.app-container.v2`
contract narrows app-owned metadata to layout and slots while the shared
terminal-shell contract carries the app descriptor extension consumed by the
single lifecycle renderer.

The module boundaries are `chrome-controls -> logic-controls`,
`app-container -> terminal-ui`, `app-container -> chrome-controls`, and
`app-container -> logic-controls`; startup composes these plugins into the app
shell at runtime. The resource `tui_chrome_slot_registry` consumes only the
typed logic-control side-channel and produces closed presentation slots. The
resource `tui_app_container_composition` consumes those slots plus the typed
presentation model, then produces a typed terminal frame; both resources are
forbidden from reaching the official Session log or API contract directly.

## Product boundary

The official DSH WebUI remains unchanged and continues to own its browser presentation. The TUI is a separate TypeScript/Node Cordis client that connects to the same official DSH Web host over public loopback APIs. WebUI and TUI may observe and mutate the same ACP Session concurrently because the official ApiProxy and Session event log remain the only business truth.

The TUI does not mount `dsh-base`, create an Agent, open Session persistence, load model adapters, or become a second inference host. It does not replace official WebUI plugins and does not share presentation runtime code with WebUI.

```text
official dsh --profile web
├─ official DSH Host / ApiProxy / Session truth
└─ official Browser WebUI
             ▲
             │ public loopback HTTP + WebSocket + generic RPC
             ▼
client-only dsh --profile tui
└─ Node/Cordis TUI
   ├─ transport plugins
   ├─ current-session plugins
   ├─ independent presentation plugins
   ├─ terminal component plugins
   └─ terminal application shell
```

## Decisions

1. WebUI is official and receives no TUI bundle, replacement row, patch, or dependency.
2. TUI runs in a separate Node process and connects to the official Web host.
3. TUI is a client-only AppSDK project; `dsh-base` is forbidden from its profile.
4. There is no Rust process, native renderer, four-pipe bridge, custom snapshot protocol, delivery ledger, or Node-to-Rust codec.
5. TUI presentation behavior is independently implemented from audited official WebUI source and tests. Official code is reference evidence, not a runtime dependency.
6. Every presentation projector and terminal control is a Cordis plugin registered into a typed grouped registry.
7. Terminal renderers consume typed TUI presentation nodes. They never consume raw Session events, pair tool calls, parse transport frames, or reconstruct control state.
8. Default startup creates a new Session for the canonical current cwd. `--resume` and `/resume` are restricted to Sessions whose canonical cwd equals the current cwd.
9. General Session browsing, cross-workspace resume, archive, rename, fork, and multi-session management are outside the first product boundary.
10. A static Web simulator renders TUI canonical fixtures for visual approval; it is not a WebUI replacement and is never a runtime input.

## AppSDK zones

```text
dsh-tui/
├─ .appsdk/                 committed governance, maps, goal, records, SDK lock
├─ .appsdk-control/         ignored local run state
├─ playground/experiments/ mutable candidate source in isolated worktrees
├─ active/lib/              immutable consumable module artifacts
├─ protected/               frozen source, contracts, history
├─ generated/               compiler output only
├─ contracts/tui/           project-owned runtime contracts
└─ tests/                   module regression surfaces
```

Runtime may consume only verified Active artifacts. It may not scan Playground, Protected, generated files, `.appsdk-control`, official WebUI source, or arbitrary project documents to discover capabilities.

## Cordis module groups

### `app-shell`

Owns process startup, terminal lifecycle coordination, typed input intent, dispatch sequencing, shutdown, and composition of the other groups. It contains no Session business implementation and no presentation parsing.

### `transport`

Owns the configured loopback endpoint and public DSH carriers:

- unary HTTP requests;
- `events.mux` WebSocket;
- `events.host` WebSocket;
- generic Connection RPC;
- owner-schema validation;
- reconnect, abort, and connection health.

Endpoint, reconnect generation, backoff, sequence, diagnostics, and health are control resources. They never enter DSH business payloads or TUI presentation nodes.

Endpoint resolution is locked by `transport-contract.md`: `--endpoint`, then `DSH_WEB_URL`, then the official `http://127.0.0.1:3080` composed default. Only an absolute loopback HTTP origin is accepted. There is no port scan or retry against another origin. The carrier is a TUI-owned `NodeApiClient extends AbstractApiClient`; it overrides `resolveBase()`, `doFetch()`, `openMux()`, and `openHost()` using public installed contracts.

Generic Remote support mounts the required owner contributions individually. The TUI does not mount the aggregate `@deepseek-ai/dsh-api-remotes/client`, because that would also introduce the dynamic Cordis namespace outside the selected capability set.

### `session`

Owns exactly one selected Session in the TUI process. It calls public DSH owners, hydrates history, subscribes to live frames, and supplies decoded business facts to presentation.

Startup without resume:

```text
realpath(process.cwd())
→ session.create({ cwd })
→ history tail
→ live streams
```

Startup with `--resume <id>` or local `/resume`:

```text
realpath(process.cwd())
→ session.list({})
→ require SessionSummary.cwd
→ realpath(summary.cwd) and compare canonical cwd equality
→ reject absent, invalid, or different-cwd id
→ session.create({ sessionId: id, cwd })
→ history tail
→ live streams
```

`SessionSummary.cwd` is an official `header.cwd` passthrough and may be absent when unrecorded. Missing or invalid cwd therefore fails closed. The session module does not infer cwd, read persistence files, inspect logs, chdir to another workspace, or create a replacement Session when resume fails.

### `presentation`

Owns the TUI canonical business projection. Each capability is a Cordis projector plugin, for example:

- user and context messages;
- assistant turns and streaming assistant content;
- reasoning;
- tool lifecycle using public `ToolEventView` when supplied by DSH;
- retry, error, interruption, cancellation, and max-token state;
- compaction;
- workflow and trajectory;
- queue and steering;
- approval and question;
- plan, goal, jobs, stats, model, and context state;
- Markdown blocks governed by `markdown-conformance.md`;
- explicit unknown records.

For each capability the design record must bind:

1. official WebUI reference package, source path, tests, and audited commit;
2. public DSH input fields used by the behavior;
3. TUI projector owner;
4. typed output node;
5. positive and negative fixtures;
6. missing-public-input disposition.

If required business data is not available through public DSH contracts, only that capability becomes blocked. Private imports, checkout paths, copied Web runtime dependencies, raw-event rendering, and silent fallback are forbidden.

Markdown alignment is separately proven against the pinned official settled and streaming fixture corpus. It covers tables, task lists, strikethrough, math, partial code fences, CJK strong text, links, footnotes and settled self-healing; user/context/steering content remains literal.

### `terminal-ui`

Owns terminal layout, focus, scrolling, reflow, composer editing, overlays, component lifecycle, terminal restoration, and typed component registries. The selected carrier is exactly `ink@7.1.1` on Node 22+ with React 19.2+. Ink owns terminal layout and reconciliation; Cordis owns registry discovery, plugin lifecycle and composition. The pinned Codex TUI audit and decision record are in `codex-tui-selection-audit.json`; the complete contract is in `component-model.md`.

Component groups include:

```text
conversation/
  user, context, assistant, reasoning, retry, error, compaction, unknown
tools/
  generic, terminal, read, search, diff, error
bottom-pane/
  composer, queue, command, approval, question
status/
  connection, session, turn, model, context, tools
overlays/
  current-cwd-resume, settings-selectors, attachment-preview
```

Each canonical node kind has one projector owner and exactly one active terminal renderer owner in the selected capability set. A component receives typed props, returns an Ink element tree, and emits typed TUI intents only. It cannot receive raw Session events, transport frames, control metadata, or a DSH API client.

### `installer`

Owns one-command installation of a prebuilt registry artifact and a client-only `tui` profile. The built-in unknown-profile default cannot be used because it adds `dsh-base`.

Installation must prove:

- official `web` profile byte identity before and after;
- `tui` profile contains only approved client bundles;
- no `dsh-base`, Agent, Session persistence, model adapter, or WebUI package is mounted in `tui`;
- lockfiles contain no `file:`, `link:`, `portal:`, `workspace:`, or checkout paths;
- uninstall removes only TUI-owned profile and package state;
- Sessions, settings, credentials, provider configuration, and official Web profile remain intact.

### `simulator`

Owns a static Web artifact that renders the same typed TUI fixtures through a terminal-style browser carrier. It is used for visual review of layout, node composition, narrow/wide widths, streaming states, tools, overlays, and error states. It does not connect to DSH and is not shipped as a WebUI plugin.

## Mainline boundaries

Input chain:

```text
TuiInputIn01TerminalIntent
→ TuiInputIn02AppEvent
→ TuiInputIn03BusinessAction
→ TuiInputIn04PublicApiRequest
→ DshHostIn05SessionMutation
```

Output chain:

```text
DshHostOut01PublicHistoryOrFrame
→ TuiOutputIn02PublicContractDecoded
→ TuiOutputIn03PresentationProjected
→ TuiOutputIn04TypedComponentResolved
→ TuiOutputIn05InkTreeComposed
→ TuiOutputIn06AppContainerFrame
→ TuiOutputOut07TerminalFrame
```

Only adjacent conversions are allowed. Input intents cannot mint wire envelopes directly. Decoded public events cannot skip presentation and reach terminal components. Presentation records cannot reconstruct DSH mutations.

## Capability admission

The earlier shared-export blockers are retired. The new binding modes are:

- `public_host_api`: runtime calls an actual public DSH owner;
- `independent_behavioral_alignment`: TUI projector independently matches audited official WebUI behavior using public DSH inputs;
- `tui_owned`: terminal or simulator capability owned by this project and not claimed as official WebUI source evidence;
- `approved_n_a`: browser-only behavior with no TUI business meaning;
- `blocked`: required business input is not publicly observable.

No capability is admitted merely because source code contains a similar symbol. Admission requires clean-registry public exports for runtime dependencies and source-to-public-input evidence for independent presentation.

## Admission order

1. AppSDK goal, resource map, function map, mainline map, module registry, and verification map pass.
2. Audit the pinned Codex TUI selection and terminal lifecycle.
3. Audit official WebUI semantics capability by capability and bind public inputs.
4. Approve the static simulator contract and first fixture matrix.
5. Admit AppSDK Playground worktrees per module.
6. Implement transport before Session, Session before presentation delivery, presentation before terminal components, and installer last.
7. Run clean-registry install, official-Web zero-diff, real PTY, and same-Session dual-client verification.
8. Run DSH Review only after installed runtime evidence matches the candidate.
9. Promote verified artifacts to Active and freeze source/contracts through AppSDK records.

## Audited capability result

The official WebUI roster and presentation definitions were audited at DSH commit `47f943859bef60e4160492346772ded9b24f765a`. The audit covers conversation nodes, tools, workflow, trajectory, deliverables, queue, approval/question, plan, goal, jobs, model, permissions, agent presets, attachments, commands, skills/subagents, settings, plugin inventory and feedback. Its exact public-input and TUI disposition records are in `official-webui-capability-audit.json` and `capability-bindings.json`.

There are no design-time semantic export blockers: TUI presentation is independently implemented from public Session events, Host `ToolEventView`, projection snapshots, mux frames and generic Remote inputs. This does not admit runtime dependencies. Every referenced package face remains `pending_clean_registry` until its installed artifact exports and declarations are verified.

## Current gate state

- Architecture direction: confirmed.
- External AppSDK: pinned.
- Runtime source: absent by design.
- Codex TUI audit: source verified at commit `9a6668f674d74b35418fa534b3b6285a315d0765`.
- Terminal selection: Ink 7.1.1 accepted by the design; clean-registry and PTY proof pending.
- Official semantic public-input audit: source verified at DSH commit `47f943859bef60e4160492346772ded9b24f765a`.
- Selected capability set: 30 official-source-verified, 2 TUI-owned, 3 approved N/A, 0 design-blocked.
- Static simulator contract: designed; rendered artifact and Jason visual approval pending implementation.
- Implementation admission: blocked on machine gates and clean-registry public-export verification, not on WebUI presentation exports.
- Release admission: blocked until implementation, installation, live verification, review, promotion, and freeze complete.
