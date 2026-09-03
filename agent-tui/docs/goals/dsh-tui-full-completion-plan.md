# dsh-tui Full Completion Plan

Status: executable design and delivery contract. Proposed new modules and
edges below are `design` until Phase 0 registers and gates them.

This document is the detailed implementation source for the final dsh-tui
completion goal. It extends the approved
`docs/goals/dsh-tui-full-development-plan.md` and
`docs/goals/tui-app-container-plan.md`. It does not promote a design or
pending map entry to `active`; every promotion requires the corresponding
source, test, build, and runtime evidence.

## 1. Final Objective

Complete dsh-tui as an installable Cordis/Ink terminal client for the
official DSH Host:

```text
public DSH API
  -> transport
  -> current-cwd Session
  -> canonical presentation
  -> typed logic controls
  -> independent Cordis display/control plugins
  -> chrome slot registry
  -> app-container
  -> terminal-ui realization
  -> one terminal-lifecycle carrier
  -> real PTY and official WebUI dual-client evidence
```

The result must be behaviorally usable, architecturally bounded, cleanly
installable, and delivered from the exact source tree that passed all required
gates and read-only AGY Review through the `agy-review` MCP.

## 2. Current Baseline and Gaps

### Baseline

- The authoring base `origin/main` receipt for this plan revision is
  `b890d3cc9d96ac4e9d752d65e69a7f94f7a66387`.
- The project already has the public transport, Session, presentation,
  terminal, lifecycle, app-shell, app-container, governance, installer,
  simulator, and evidence-plan foundations described by the canonical plans.
- App-container is the active ordered-frame owner. Terminal-lifecycle is the
  carrier and must not assemble regions or interpret business state.
- The main tree still has the pre-split `chrome-controls` implementation.
  The latest Phase A candidate exists in its declared Playground worktree at
  `081f98f`, but it is not admitted to `main` until its runtime evidence, AGY
  Review, latest-main integration, main-tree gates, and push receipt complete.

### Execution state lock (2026-08-25)

This section is the current execution truth for a worker resuming the plan.
It is not a promotion of any map entry to `active`.

- `origin/main` = `b890d3cc9d96ac4e9d752d65e69a7f94f7a66387`.
- Phase A candidate branch:
  `codex/tui-display-plugin-split-20260824T162557Z-Macstudio-42355-display-split`
- Phase A candidate worktree:
  `playground/tui-display-plugin-split-20260824T162557Z-Macstudio-42355-display-split`
- Phase A candidate HEAD: `081f98f39e2de02fe6f2a0da71b6359cf439820a`.
- Phase A claim:
  `.agent-collab/claims/tui.display-plugin-split.phase-a/owner.json`.

Phase A candidate content:

- five independent display plugin modules and `chrome-slot-registry`;
- physical removal of the monolithic `chrome-controls` source/test/build;
- maps, package scripts, and CI updated in the same change set;
- CI replaced the old `chrome-controls` step with a full registry plus five
  display-plugin test/build/typecheck gate.

Already verified on the Phase A candidate HEAD:

- `chrome-slot-registry` 10/10 tests and build;
- each of `tui-logo`, `tui-connection`, `tui-session`, `tui-status`,
  `tui-execution` 3/3 tests and build;
- `app-container` 6/6 tests and build;
- `typecheck`, `check:design`, 73/73 design red tests,
  `check:runtime-boundaries`, and `git diff --check`;
- zero live references to `chrome-controls` across source, contracts, tests,
  scripts, maps, package, and CI.

Open before Phase A can be considered delivered:

- `check:clean-install` evidence from the integrated candidate, including
  tarball SHA, isolated install realpath, `npm ls --all`, installed package
  identity, and installed CLI help;
- real PTY smoke covering alternate screen, raw input, resize, EOF/signals,
  restoration, and exit code;
- official Host/WebUI same-Session dual-client evidence against the exact
  candidate artifact; if the official Host is unreachable, record the exact
  external open gate without fabricating success;
- AGY Review through `agy-review` MCP with base
  `b890d3cc9d96ac4e9d752d65e69a7f94f7a66387` and candidate HEAD `081f98f`;
- merge to latest main, rerun affected main-tree gates, push, and confirm
  `git ls-remote origin refs/heads/main == local HEAD`.

Current route after Phase A closure:

```text
close Phase A candidate (runtime + review + delivery)
  -> Phase B refresh-orchestrator
  -> Phase C slash-command + session-switcher
  -> Phase D overlay-manager + composer
  -> Phase E status-footer + complete app composition
  -> Phase F full runtime verification
  -> Phase G review, delivery, and remote main receipt
```

Every subsequent phase starts from the newest `origin/main`, not from any
older receipt in this document.

### Execution state lock (2026-08-25 Phase D resume)

This is the current execution truth for the active Phase D worker.

- `origin/main` = `67b49b0e2de539ea3d6681d352284d4b6808d687` (Phase C
  slash-command-plugin + session-switcher-plugin merged).
- Phase D active worktree:
  `playground/tui-overlay-composer-phase-d-20260825T141500Z`.
- Phase D branch:
  `codex/tui-overlay-composer-phase-d-20260825T141500Z`.
- Phase D claim:
  `.agent-collab/claims/tui.overlay-composer.phase-d/owner.json`.
- Phase D run:
  `.agent-collab/runs/20260825T141500Z-Macstudio-43145-phase-d/`.

Phase D source is uncommitted and currently contains:

- contracts for `overlay-manager-plugin` and `composer-plugin`;
- implementation for both plugin services;
- targeted tests for both plugins;
- build scripts for both plugins.

Verified on the Phase D worktree:

- `overlay-manager-plugin` tests `5/5`;
- `composer-plugin` tests `6/6`;
- `pnpm run typecheck` passes.

Remaining Phase D work before candidate review:

- register both modules and their edges in `project.json`,
  `module-registry.json`, `resource-map.json`, `function-map.json`,
  `mainline-call-map.json`, `test-design.json`, and `verification-map.json`;
- add package scripts and CI gates;
- run affected builds, design red tests, runtime boundaries, clean install,
  and PTY smoke;
- then run AGY Review and deliver the candidate to main.

### Remaining gaps

| Gap | Unique owner | Required outcome |
|---|---|---|
| Monolithic chrome producer and shared slot contract | `chrome-slot-registry` plus five display modules | Physically remove `chrome-controls`; one plugin owns one slot |
| Registry/container registration | `app-shell` and `app-container` | Load the declared plugin manifest before first composition; consume typed registry output |
| Refresh and invalidation ownership | `refresh-orchestrator` | One coalescing revision publisher; no render scheduling logic duplicated in startup, shell, or lifecycle |
| Inline slash handling | `slash-command-plugin` | Parse closed command input and emit typed command actions |
| Inline `/resume` handling | `session-switcher-plugin` | Own current-cwd listing, selection, validation, and transition intent |
| Inline overlay/focus handling | `overlay-manager-plugin` | Own overlay stack and top-view focus without replacing Session truth |
| Inline composer handling | `composer-plugin` | Own editing state and submit/cancel intent; terminal carrier only supplies keys |
| Inline footer/status rendering | `status-footer-plugin` | Own orthogonal footer projection; no duplicate status formatter in terminal-ui |
| Map and gate drift | `governance-build` | Every source file, edge, symbol, resource, and gate is machine-bound |
| Runtime delivery proof | `installer`, `terminal-lifecycle`, `session` | Clean install, PTY, official Host/WebUI same-Session evidence, review PASS |

### Machine-state lock

The current `origin/main` machine truth is not the target architecture:

- `chrome-controls` is still the active owner of the committed chrome slot
  service and its source surface.
- The Phase A candidate above is a reviewed-ready implementation candidate,
  not `main` machine truth.
- `refresh-orchestrator`, the five display module IDs, and the five functional
  plugin IDs do not yet exist in `module-registry.json`,
  `resource-map.json`, `function-map.json`, `mainline-call-map.json`, or
  `verification-map.json`.
- The commands for those proposed modules are not yet package scripts or CI
  gates.

The following is therefore a target registry, not an active registry. Phase 0
must create these entries with `status: design`, then Phase A-E may promote
each entry to `active` only after its source symbols, owned paths, declared
edges, tests, build command, and CI gate exist and pass:

| Target ID | Target owner | Target resource/function IDs | Initial status |
|---|---|---|---|
| `chrome-slot-registry` | `dsh-tui::chrome-slot-registry` | `tui_chrome_slot_registry`; `register_chrome_slot`, `project_chrome_slot_registry` | `design` |
| `tui-logo` | `dsh-tui::tui-logo` | `tui_chrome_display_plugin_lifecycle`; `project_tui_logo_slot` | `design` |
| `tui-connection` | `dsh-tui::tui-connection` | `tui_chrome_display_plugin_lifecycle`; `project_tui_connection_slot` | `design` |
| `tui-session` | `dsh-tui::tui-session` | `tui_chrome_display_plugin_lifecycle`; `project_tui_session_slot` | `design` |
| `tui-status` | `dsh-tui::tui-status` | `tui_chrome_display_plugin_lifecycle`; `project_tui_status_slot` | `design` |
| `tui-execution` | `dsh-tui::tui-execution` | `tui_chrome_display_plugin_lifecycle`; `project_tui_execution_slot` | `design` |
| `refresh-orchestrator` | `dsh-tui::refresh-orchestrator` | `tui_refresh_orchestrator`; `publish_tui_refresh` | `design` |
| `slash-command-plugin` | `dsh-tui::slash-command-plugin` | `terminal_command_control`; `parse_tui_command` | `design` |
| `session-switcher-plugin` | `dsh-tui::session-switcher-plugin` | `current_session_selection`; `select_current_cwd_session` | `design` |
| `overlay-manager-plugin` | `dsh-tui::overlay-manager-plugin` | `tui_focus_overlay_stack`; `manage_tui_overlay` | `design` |
| `composer-plugin` | `dsh-tui::composer-plugin` | `terminal_input_control`; `project_tui_composer` | `design` |
| `status-footer-plugin` | `dsh-tui::status-footer-plugin` | `terminal_status_projection`; `project_tui_status_footer` | `design` |

Shared resource IDs in this target table are migration targets. They must not
have two active owners: the old `chrome-controls` or existing inline owner is
demoted or physically removed in the same promotion change set.

## 3. Non-Negotiable Architecture

### 3.1 Ownership

```text
official Host / Session log
  business truth
        |
        v
transport -> session -> presentation
                         |
                         v
                    logic-controls
                         |
              +----------+-----------+
              |                      |
              v                      v
       display plugins        functional plugins
              |                      |
              +----------+-----------+
                         v
                chrome-slot-registry
                         |
                         v
                refresh-orchestrator (design)
                         |
                         v
                    app-container
                         |
                         v
                    terminal-ui
                         |
                         v
                terminal-lifecycle -> Ink
```

The arrows are typed module edges, not permission to bypass an intermediate
owner. In particular:

- display plugins do not call Session, transport, Host, Ink, React, or the
  terminal sink;
- functional plugins emit typed intents and projections; they do not call
  Host directly;
- chrome-slot-registry projects logic-control state into closed slot models;
- refresh-orchestrator owns publication ordering only, not business state;
- app-container owns region order and layout policy only;
- terminal-ui realizes descriptors only;
- terminal-lifecycle owns the single Ink instance, terminal streams,
  restoration, and process outcome.

### 3.2 Control and business separation

The following values remain typed side-channel resources and must never enter
Session request/response payloads, metadata, presentation values, fixtures, or
renderer props:

- refresh source, reason, generation, revision, coalescing state;
- connection health and reconnect state;
- focus, overlay selection, composer cursor and scroll offset;
- plugin owner, slot owner, disposal state;
- endpoint, provider selection, retry, debug, snapshot, error-routing and
  process-exit control.

The business payload remains lossless. View-level collapse or scroll is not
payload truncation.

### 3.3 Versioned mainline

The existing `dsh-tui-v4` frame lifecycle remains the active output tail. The
new layers add adjacent control and composition edges without reordering the
business pipeline:

```text
TuiInputIn01TerminalIntent
 -> TuiInputIn02AppEvent
 -> TuiInputIn03BusinessAction
 -> TuiInputIn04PublicApiRequest
 -> DshHostIn05SessionMutation

DshHostOut01PublicHistoryOrFrame
 -> TuiOutputIn02PublicContractDecoded
 -> TuiOutputIn03PresentationProjected
 -> TuiOutputIn04TypedComponentResolved
 -> TuiOutputIn05InkTreeComposed
 -> TuiOutputIn06AppContainerFrame
 -> TuiOutputOut07TerminalFrame
```

Refresh and plugin lifecycle are control edges around this chain. They must
not become an alternative business chain.

## 4. Target Module Contracts

### 4.1 `chrome-slot-registry`

Owner: `dsh-tui::chrome-slot-registry`.

Authoring surface:

```text
contracts/tui/chrome-slot-registry/
playground/experiments/chrome-slot-registry/
tests/chrome-slot-registry/
scripts/build-chrome-slot-registry.mjs
```

Required service face:

```ts
interface TuiChromeSlotRegistryFace {
  readonly registeredSlots: readonly TuiChromeSlotId[]
  register(owner: CordisContext, producer: TuiChromeSlotProducer): () => void
  project(input: TuiChromeSlotProjectionInput):
    readonly TuiChromeSlotModel[]
  projectState(input: { readonly publicationRevision: number }):
    TuiChromeProjectionState
  dispose(): void
}
```

Required behavior:

- accept exactly the five canonical slot IDs;
- reject unknown, duplicate, unrelated-root, disposed, or unowned
  registration;
- bind each registration to the registering Cordis effect;
- remove only that slot when its owner is disposed;
- require all five slots before projection;
- return canonical order independent of registration order;
- validate closed input and output contracts;
- preserve the requested publication revision;
- expose no Ink, React, Host, SessionEvent, metadata, debug, provider, or
  control fields.

The registry is a service and contract owner. It is not a source-directory
scanner and does not infer missing modules.

### 4.2 Five display plugins

Each plugin has one manifest, one source module, one build entrypoint, one
test suite, one slot, and one owner:

| Plugin | Slot | Projection source |
|---|---|---|
| `tui.logo` | `header.logo` | logic-control `logo` |
| `tui.connection` | `header.connection` | logic-control `connection` |
| `tui.session` | `header.session` | logic-control `session` |
| `tui.status` | `header.status` | logic-control `status` |
| `tui.execution` | `execution` | logic-control `execution` |

Each `apply(ctx)` must register exactly one producer under the current
Cordis context. Each `project()` must:

1. accept the closed registry input;
2. request its own logic-control projection;
3. reject a wrong control family;
4. construct one frozen closed slot model;
5. carry the input publication revision without rewriting it.

No display plugin may render text into an Ink tree. App-container performs the
single generic slot-model-to-terminal-node projection.

### 4.3 `refresh-orchestrator`

Owner: `dsh-tui::refresh-orchestrator`.

Authoring surface:

```text
contracts/tui/refresh-orchestrator/
playground/experiments/refresh-orchestrator/
tests/refresh-orchestrator/
scripts/build-refresh-orchestrator.mjs
```

Contract:

```ts
type TuiRefreshReason =
  | 'presentation'
  | 'logic-control'
  | 'chrome-slot'
  | 'composer'
  | 'overlay'
  | 'viewport'
  | 'error'

interface TuiRefreshIntent {
  readonly sourceModuleId: TuiRefreshSourceModuleId
  readonly reason: TuiRefreshReason
  readonly sourceRevision: number
}

interface TuiRefreshPublication {
  readonly publicationRevision: number
  readonly causes: readonly TuiRefreshIntent[]
}

interface TuiRefreshOrchestratorFace {
  request(intent: TuiRefreshIntent): TuiRefreshRequestResult
  subscribe(listener: (publication: TuiRefreshPublication) => void): () => void
  dispose(): void
}
```

Rules:

- `sourceRevision` is monotonic per source module;
- an older source revision is rejected as stale;
- the same source/revision/reason is idempotent and does not publish twice;
- different causes in one microtask coalesce into one publication;
- each publication increments exactly one frame revision;
- publication delivery is synchronous or explicitly awaited by the contract;
- disposed requests and subscriptions fail explicitly;
- no infinite or unconditional idle loop;
- no business payload or metadata mutation;
- app-container consumes the publication revision; terminal-lifecycle only
  consumes the realized frame and remains unaware of refresh causes.

The orchestrator must not call `session`, `transport`, or `presentation`
mutation APIs. Those modules publish their own invalidation intent after
their truth changes.

### 4.4 Functional control plugins

All five plugins use Cordis `apply(ctx)`, effect-owned disposal, a closed
service face, a manifest, and paired positive/negative lifecycle tests.

#### `slash-command-plugin`

Owner: `dsh-tui::slash-command-plugin`.

Input: literal composer text beginning with `/`.

Output: closed `TuiCommandIntent` containing command name, argument list,
accepted/rejected state, and source revision.

Rules:

- tokenize only the command control input;
- do not interpret ordinary prompt text;
- reject empty command, malformed arguments, and unknown command;
- emit `/quit`, `/help`, and `/resume` intents through the app-shell control
  face;
- command execution remains in the unique command owner;
- never call Session or Host directly.

#### `session-switcher-plugin`

Owner: `dsh-tui::session-switcher-plugin`.

Responsibilities:

- request current-cwd Session summaries through the existing public Session
  owner;
- reject missing, malformed, terminated, or different-cwd summaries;
- project a typed selector overlay;
- emit one typed `session.select` intent for the selected ID;
- let Session perform hydrate/validation/atomic switch;
- preserve the old selected Session when listing, validation, or hydration
  fails;
- clear only interaction-local state after a successful switch.

It must not create a replacement Session, read persistence directly, or own
Session truth.

#### `overlay-manager-plugin`

Owner: `dsh-tui::overlay-manager-plugin`.

Responsibilities:

- own the typed BottomPane/overlay stack;
- ensure only the top view receives keys;
- preserve composer state below an overlay;
- validate view kind, item list, selected index, and callback identity;
- restore the prior focus view on close;
- reject duplicate close, stale selection, disposed manager, and hidden-view
  input;
- never mutate selected Session or canonical transcript.

#### `composer-plugin`

Owner: `dsh-tui::composer-plugin`.

Responsibilities:

- own multiline text, cursor, edit mode, submit, and local pending echo
  projection;
- emit typed submit/cancel/command intents;
- keep local echo outside Session truth and canonical presentation;
- preserve text on overlay open/close and approval/question replacement;
- reject stale submit, disposed composer, invalid cursor, and invalid
  attachment input;
- expose a terminal-neutral composer projection only.

Terminal-lifecycle supplies bytes/key events. It does not edit composer state.

#### `status-footer-plugin`

Owner: `dsh-tui::status-footer-plugin`.

Responsibilities:

- project orthogonal connection, Session, turn, model, context, tools,
  queue, and interaction status;
- consume typed Session/presentation/control projections;
- define deterministic severity and ordering;
- preserve error state instead of overwriting it with an idle status;
- expose a footer region leaf and no business payload;
- reject mixed revisions and disposed subscriptions.

`terminal-ui` becomes a descriptor/layout consumer and must not retain a
second status formatter.

## 5. App Composition and Registration

Startup order is fixed:

```text
create Cordis context
  -> event bus
  -> logic controls
  -> component/focus/session/presentation services
  -> chrome-slot-registry
  -> five display plugins
  -> refresh-orchestrator
  -> functional control plugins
  -> app-container
  -> terminal-ui
  -> terminal-lifecycle
  -> app-shell bindings
  -> viewport bootstrap
  -> first compose
```

The manifest, not a hand-maintained startup array, is the canonical plugin
set. Startup resolves the validated manifest and activates each declared
plugin. Unknown or duplicate plugin IDs fail before terminal mount.

App-container receives:

```ts
{
  publicationRevision,
  viewport,
  regionLeaves,
  chrome: typedAppChromeTerminalNodes
}
```

It is responsible for:

- requesting the five required registry slots;
- mapping them once to generic terminal nodes;
- enforcing default and compact order;
- validating frozen keys, dimensions, revision identity, and region leaves;
- returning a typed failure preserving the original cause.

It is not responsible for:

- reading Session or transport;
- parsing control events;
- scheduling refresh;
- deciding overlay/focus behavior;
- calling Ink or process exit.

## 6. Phase Plan

### Phase 0: Admission and baseline

Owner: completion coordinator / `governance-build`.

Actions:

1. Read MemoryPalace, `dsh-tui/note.md`, current run notes, resource map,
   function map, mainline call map, verification map, and canonical
   architecture docs.
2. Confirm the exact `origin/main` receipt and the active AppSDK 0.1.3
   executable.
3. Claim one semantic ID and create one clean Playground worktree from the
   latest main receipt.
4. Audit the actual source graph before editing.
5. Record the phase baseline and declared change set.
6. Register every target module, feature, resource, function, mainline edge,
   owned/forbidden path, test design entry, verification gate, package script,
   and CI invocation as `design`/`pending`; do not mark any target `active`.

Exit evidence:

- actor/claim/worktree/base commit agree;
- no active kill switch;
- every target path has one owner or is explicitly added to the map before
  implementation;
- every proposed gate has a real command owner or is explicitly marked
  `pending`; a prose command is not evidence;
- plan and test design are readable by a new worker.

### Phase A: Display plugin split and chrome registry

Owner: governance admission first, then `chrome-slot-registry` plus five
display owners.

Actions:

1. Add the target module/resource/function/mainline/verification entries as
   `design`; add exact owned and forbidden paths and target gate IDs.
2. Add real package scripts and CI invocations for every target gate; add red
   tests proving removal of any required invocation fails.
3. Add closed slot contracts, per-plugin manifests, build scripts, and tests.
4. Move registry service to its unique owner.
5. Implement five independent Cordis plugins.
6. Replace startup's monolithic producer with manifest-driven activation.
7. Wire app-container to the registry face.
8. Remove `chrome-controls` source, contract, test, and build script after
   zero-reference and dependency checks.
9. Update project, module, function, resource, mainline, verification, test
   design, and CI maps in the same change set.
10. Promote only the completed module entries from `design` to `active`.

Required red/green tests:

- five plugins register once and project canonical order;
- each plugin disposal removes only its own slot;
- duplicate, unknown, unrelated-root, disposed, incomplete, stale, and
  malformed registrations fail;
- slot models cannot contain control, metadata, provider, debug, or event
  fields;
- app-container consumes all five slots exactly once;
- terminal-lifecycle contains no slot assembly or plugin import.

Exit gates:

```text
appsdk verify .
pnpm run check:design
pnpm run test:design
pnpm run check:runtime-boundaries
pnpm run typecheck
pnpm run test:chrome-slot-registry
pnpm run build:chrome-slot-registry
pnpm run test:tui-logo && pnpm run build:tui-logo
pnpm run test:tui-connection && pnpm run build:tui-connection
pnpm run test:tui-session && pnpm run build:tui-session
pnpm run test:tui-status && pnpm run build:tui-status
pnpm run test:tui-execution && pnpm run build:tui-execution
pnpm run test:app-container && pnpm run build:app-container
```

The commands above are exit gates only after Phase 0 has created the matching
package scripts and verification-map entries. Before that, the gate is
`pending` and the plan must report it as open.

### Phase B: Unified refresh/invalidation

Owner: `dsh-tui::refresh-orchestrator`.

Actions:

1. Add the typed refresh contract and manifest.
2. Replace duplicate `requestRender`, `scheduleRender`, and direct
   invalidation paths with one orchestrator subscription.
3. Bind presentation, logic controls, chrome slots, composer, overlay,
   viewport, and errors to named refresh sources.
4. Make app-container consume only the publication revision.
5. Make terminal-lifecycle consume only the realized frame.
6. Add cardinality tests for one source event -> one coalesced publication ->
   one compose -> one rerender.

Required red/green tests:

- fresh intent advances publication;
- same source/revision/reason is idempotent;
- stale source revision is rejected;
- multiple causes in one turn coalesce;
- out-of-order sources cannot regress frame revision;
- disposed orchestrator rejects request and subscription;
- an explicit lifecycle stop produces no later publication;
- a failed compose preserves the original cause and does not retry silently;
- no business payload contains refresh fields;
- no unconditional timer or duplicate render scheduler remains.

Exit gates:

```text
pnpm run test:refresh-orchestrator
pnpm run build:refresh-orchestrator
pnpm run test:app-container
pnpm run test:app-shell
pnpm run test:terminal-lifecycle
pnpm run check:design
pnpm run check:runtime-boundaries
pnpm run typecheck
```

The Phase B commands are not available on the baseline receipt. Phase B
cannot start until Phase 0 registers `refresh-orchestrator`, its resource and
function IDs, its adjacent call edges, and its executable CI gate.

### Phase C: Slash command and session switcher

Owners: `slash-command-plugin`, `session-switcher-plugin`.

Actions:

1. Extract command parsing from startup into slash-command-plugin.
2. Extract `/resume` listing, selector projection, and selection action from
   startup into session-switcher-plugin.
3. Keep command execution in app-shell/session owners through typed faces.
4. Keep current-cwd and atomic resume rules unchanged.
5. Remove the old inline handlers only after parity tests pass.

Required tests:

- valid `/help`, `/resume`, `/resume <id>`, `/quit`;
- unknown, empty, malformed, and stale commands fail explicitly;
- command text does not become a business prompt;
- current-cwd mismatch and malformed summaries are rejected;
- list failure leaves old Session selected;
- hydrate failure leaves old Session and streams untouched;
- successful selection changes exactly one Session identity;
- overlay selection is disposed after accepted selection.

### Phase D: Overlay manager and composer

Owners: `overlay-manager-plugin`, `composer-plugin`.

Actions:

1. Extract focus stack and overlay state from runtime controller.
2. Extract multiline composer editing, cursor, submit, local echo, and cancel
   from runtime controller.
3. Keep terminal-lifecycle as byte/key carrier only.
4. Bind all emitted intents through app-event-bus and app-shell.
5. Preserve the existing BottomPane priority:

```text
fatal > approval/question > selector > command > queue > composer
```

Required tests:

- only the top view receives keys;
- overlay open/close restores composer and prior focus;
- `q` does not exit while editor owns focus;
- Ctrl+C cancels only while running and exits only when idle;
- Ctrl+D exits only with empty composer and idle Session;
- multiline edits preserve cursor and text;
- local echo converges only on newer official user event;
- failed submit marks local projection failed without business success;
- stale selection and disposed manager/composer fail closed.

### Phase E: Status/footer and complete app composition

Owner: `status-footer-plugin` plus app-container.

Actions:

1. Extract footer/status projection from terminal-ui.
2. Make terminal-ui consume the status-footer region leaf.
3. Ensure the five chrome slots, transcript, execution, composer, overlay,
   and footer are all represented once in the frame.
4. Verify default and compact layouts use one immutable view model and the
   same publication revision.
5. Delete duplicate status/footer helpers after call-graph proof.

Required tests:

- status dimensions remain orthogonal;
- error is not overwritten by idle;
- mixed revisions fail;
- default and compact order are deterministic;
- overlay absent/present semantics are explicit;
- duplicate region keys, unknown slots, stale frames, invalid dimensions,
  disposed container, and control-field smuggling fail.

### Phase F: Full runtime verification

Owners: affected runtime modules and installer.

Actions:

1. Run exact AppSDK 0.1.3 verification with PATH pinned.
2. Run all affected module tests and builds.
3. Run aggregate design, boundary, typecheck, public-export, and clean-install
   gates.
4. Build and pack the artifact from the exact candidate source.
5. Install the artifact into an isolated clean registry root with no
   `file:`, `link:`, `portal:`, `workspace:`, checkout, or symlink dependency.
6. Run installed CLI help and package identity checks.
7. Run installed PTY smoke at default and compact dimensions, covering input,
   resize, overlay, `/resume`, `/quit`, EOF, Ctrl+C, restoration, and exit
   code.
8. Run official Host and official WebUI same-Session dual-client evidence in
   both directions. Preserve the locked provider/model; do not substitute on
   quota or error.
9. Record evidence under `docs/evidence/`; generated logs/images remain
   ignored and are not staged.

### Phase G: Review, delivery, and main receipt

Actions:

1. Confirm all Phase F runtime evidence is from the exact source/artifact
   under review.
2. Perform module-boundary self-audit again.
3. Create the phase checkpoint commit containing only the declared change set
   after build and tests. This is a review candidate, not a delivery claim.
4. Run AGY Review through the `agy-review` MCP. Review is read-only and
   uses YOLO permission skipping only to avoid interactive prompts; the
   reviewer must not modify the repository.
5. If review fails, repair the finding at its unique owner, rerun affected
   tests/build/install/online evidence, create a new checkpoint, and review
   again. Never weaken a test or bypass a FAIL.
6. After unambiguous semantic PASS, verify staged path scope, create the
   delivery commit, integrate onto latest main, rerun affected main-tree
   verification, and push precisely.
7. Confirm `git ls-remote origin refs/heads/main` equals local HEAD.
8. Only then release the claim and clean the completed worktree/branch after
   verifying no uncommitted or unmerged unique changes remain.

## 7. Per-Milestone Execution Contract

Every phase uses this exact loop:

```text
read maps and run notes
  -> claim semantic owner
  -> clean worktree from latest main
  -> write red tests and contracts
  -> implement minimum owner-scoped change
  -> boundary self-audit
  -> targeted tests
  -> typecheck and build
  -> checkpoint commit with exact staged paths
  -> AGY Review through `agy-review` MCP
  -> repair findings, if any
  -> repeat affected verification
  -> delivery commit after PASS
  -> merge latest main
  -> main-tree verification
  -> push and remote receipt
```

Commit guard:

```text
git diff --cached --stat
git diff --cached --name-status
```

Only the declared phase change set may be staged. Other workers' dirty files,
`.appsdk-control`, `lib`, generated artifacts, screenshots, caches, tarballs,
secrets, and unrelated maps are excluded unless explicitly owned by the
phase.

## 8. Verification Matrix

| Layer | Required evidence |
|---|---|
| Resource/function/mainline ownership | maps parse, symbols exist, every source has one owner, every import edge is declared |
| Governance | pinned AppSDK 0.1.3 verify, design checker, red design tests, CI wiring |
| Display plugins | five independent tests/builds, dispose isolation, closed slot contracts |
| Chrome registry | duplicate/unknown/unowned/disposed/stale/incomplete negatives |
| Refresh | coalescing, monotonic revision, stale rejection, dispose, one compose/rerender cardinality |
| Functional controls | slash, session switch, overlay, composer, status-footer positive/negative lifecycle tests |
| Composition | default/compact layout, five slots plus all regions exactly once, error chain |
| Runtime boundaries | typecheck, runtime boundary scan, public exports, no private imports |
| Clean install | pristine registry install, `npm ls --all`, installed package identity and CLI help |
| PTY | default/compact dimensions, input, resize, overlays, Session switch, restoration, exit code |
| Online | official Host and WebUI same Session, both directions, history/live convergence, no second Host |
| Review | AGY Review via `agy-review` MCP unambiguous semantic PASS after all previous evidence |
| Delivery | exact staged paths, main-tree rerun, local/remote HEAD equality |

For every target row, the evidence record must include the resolved
`feature_id`, module ID, owner, exact `owned_paths`, exact `forbidden_paths`,
resource IDs, function entry symbols, adjacent caller/callee bindings,
positive/negative tests, build command, CI invocation, and the final `status`.
Missing or invented bindings are a failed admission, not a warning.

Positive/negative coverage is mandatory for every stateful boundary:

```text
success / failure
fresh / stale
non-terminal / terminal
active / disposed
same-cwd / different-cwd
accepted / wrong-family
business payload / control side-channel
normal restoration / abnormal restoration
```

## 9. Risks and Explicit Non-Solutions

- Do not keep `chrome-controls` as a compatibility duplicate after the split.
- Do not make app-container discover source directories or infer missing
  plugins.
- Do not add a second refresh scheduler to make a test pass.
- Do not put refresh or lifecycle fields in `metadata`.
- Do not add a fallback renderer, replacement Session, second Host, private
  import, guessed public API, or silent error conversion.
- Do not move business logic into terminal-ui, app-container, or
  terminal-lifecycle.
- Do not claim successful streaming when the locked provider returns a quota
  error; record the external gate exactly.
- Do not run review before installed/runtime evidence.
- Do not promote `design` or `pending` map entries without executable source
  and gates.

## 10. Definition of Done

The dsh-tui completion goal is achieved only when:

1. Five display plugins, chrome-slot-registry, refresh-orchestrator, and all
   five functional control plugins are implemented and manifest-registered.
2. `chrome-controls` is physically deleted and has zero references.
3. App-container is the only ordered frame owner and terminal-lifecycle is
   the only terminal carrier.
4. Refresh/invalidation has one typed owner and one observable publication
   path.
5. Slash, current-cwd Session switch, overlays, composer, status/footer, and
   chrome all work through typed Cordis faces.
6. Maps, manifests, test design, verification map, and CI are synchronized
   with real code and imports.
7. The full verification matrix passes on the exact candidate artifact.
8. Installed PTY and official same-Session dual-client evidence are recorded.
9. AGY Review through the `agy-review` MCP returns an unambiguous semantic
   PASS after all runtime gates.
10. The final delivery commit contains only intentional source, contracts,
    tests, scripts, and docs; local HEAD equals remote main.

Until item 10 is evidenced, report the exact open gate and do not report the
TUI as complete.

## 11. Detailed Design Ledger

This section is the implementation ledger for Phases A-G. It is intentionally
more concrete than the architecture narrative above: a worker must be able to
derive its change set, test design, and delivery evidence from this section
without inventing paths, symbols, or ownership.

### 11.1 Baseline truth and admission states

The following states are distinct and must never be reported as equivalent:

| State | Meaning | Allowed claim |
|---|---|---|
| `design` | Map and contract intent exists; implementation may be absent | Design only |
| `pending` | A required executable source or gate is absent | Open gate only |
| `candidate` | Source exists in a clean owner worktree and local gates pass | Review candidate only |
| `reviewed` | AGY Review returned semantic PASS for the exact candidate | Eligible for integration |
| `active` | The source is integrated on latest main and its main-tree gates pass | Runtime module active |
| `delivered` | Pushed main receipt equals the verified local main HEAD | Delivered |

Current baseline at plan revision time:

- Plan authoring base and execution-state lock: Section 2. It supersedes
  older baseline examples in this ledger.
- `chrome-controls` remains active in the main tree.
- Phase A candidate `081f98f` is a review candidate and is not evidence that
  the main tree has been migrated.
- Phases B-E are design/pending and have no executable implementation gate
  until their Phase 0 registry entries and package commands are admitted.
- Runtime acceptance remains separate from local source/build acceptance:
  clean install, installed PTY, official Host/WebUI dual-client evidence,
  visual evidence, and review are delivery gates.

### 11.2 Module and file ownership matrix

Every source file added by a phase must appear in this matrix and in
`.appsdk/maps/module-registry.json`. The exact path may be narrowed by the
implementation, but a new path requires a same-change-set map update.

| Module | Feature | Authoring paths | Required entry symbols | Forbidden direct edges |
|---|---|---|---|---|
| `chrome-slot-registry` | `tui.chrome.slot-registry` | `contracts/tui/chrome-slot-registry/**`; `playground/experiments/chrome-slot-registry/**`; `tests/chrome-slot-registry/**`; `scripts/build-chrome-slot-registry.mjs` | `TuiChromeSlotRegistryFace`; `TuiChromeSlotRegistryService`; `apply`; `projectChromeSlotRegistry` | Session, transport, Host, Ink, React, terminal-lifecycle |
| `tui-logo` | `tui.chrome.logo` | `contracts/tui/tui-logo/**`; `playground/experiments/tui-logo/**`; `tests/tui-logo/**`; `scripts/build-tui-logo.mjs` | `TuiLogoDisplayPlugin`; `createTuiLogoProducer`; `apply` | Session, transport, Host, Ink, React, app-container |
| `tui-connection` | `tui.chrome.connection` | `contracts/tui/tui-connection/**`; `playground/experiments/tui-connection/**`; `tests/tui-connection/**`; `scripts/build-tui-connection.mjs` | `TuiConnectionDisplayPlugin`; `createTuiConnectionProducer`; `apply` | Session, transport, Host, Ink, React, app-container |
| `tui-session` | `tui.chrome.session` | `contracts/tui/tui-session/**`; `playground/experiments/tui-session/**`; `tests/tui-session/**`; `scripts/build-tui-session.mjs` | `TuiSessionDisplayPlugin`; `createTuiSessionProducer`; `apply` | Session, transport, Host, Ink, React, app-container |
| `tui-status` | `tui.chrome.status` | `contracts/tui/tui-status/**`; `playground/experiments/tui-status/**`; `tests/tui-status/**`; `scripts/build-tui-status.mjs` | `TuiStatusDisplayPlugin`; `createTuiStatusProducer`; `apply` | Session, transport, Host, Ink, React, app-container |
| `tui-execution` | `tui.chrome.execution` | `contracts/tui/tui-execution/**`; `playground/experiments/tui-execution/**`; `tests/tui-execution/**`; `scripts/build-tui-execution.mjs` | `TuiExecutionDisplayPlugin`; `createTuiExecutionProducer`; `apply` | Session, transport, Host, Ink, React, app-container |
| `refresh-orchestrator` | `tui.refresh.orchestration` | `contracts/tui/refresh-orchestrator/**`; `playground/experiments/refresh-orchestrator/**`; `tests/refresh-orchestrator/**`; `scripts/build-refresh-orchestrator.mjs` | `TuiRefreshOrchestratorFace`; `TuiRefreshOrchestratorService`; `apply`; `request` | Session mutation, transport, Host, metadata, timers owned by other modules |
| `slash-command-plugin` | `tui.control.slash-command` | `contracts/tui/slash-command-plugin/**`; `playground/experiments/slash-command-plugin/**`; `tests/slash-command-plugin/**`; `scripts/build-slash-command-plugin.mjs` | `TuiSlashCommandFace`; `parseTuiCommand`; `apply` | Host, Session mutation, persistence, terminal-lifecycle |
| `session-switcher-plugin` | `tui.control.session-switcher` | `contracts/tui/session-switcher-plugin/**`; `playground/experiments/session-switcher-plugin/**`; `tests/session-switcher-plugin/**`; `scripts/build-session-switcher-plugin.mjs` | `TuiSessionSwitcherFace`; `listCurrentCwdSelection`; `selectCurrentCwdSession`; `apply` | persistence direct access, replacement Session, Host direct access |
| `overlay-manager-plugin` | `tui.control.overlay` | `contracts/tui/overlay-manager-plugin/**`; `playground/experiments/overlay-manager-plugin/**`; `tests/overlay-manager-plugin/**`; `scripts/build-overlay-manager-plugin.mjs` | `TuiOverlayManagerFace`; `openOverlay`; `closeOverlay`; `apply` | Session truth, canonical transcript, terminal process exit |
| `composer-plugin` | `tui.control.composer` | `contracts/tui/composer-plugin/**`; `playground/experiments/composer-plugin/**`; `tests/composer-plugin/**`; `scripts/build-composer-plugin.mjs` | `TuiComposerFace`; `editTuiComposer`; `submitTuiComposer`; `apply` | Host direct access, Session truth, terminal streams |
| `status-footer-plugin` | `tui.display.status-footer` | `contracts/tui/status-footer-plugin/**`; `playground/experiments/status-footer-plugin/**`; `tests/status-footer-plugin/**`; `scripts/build-status-footer-plugin.mjs` | `TuiStatusFooterFace`; `projectTuiStatusFooter`; `apply` | Session mutation, terminal input, second status formatter |

Existing owner files touched by migration are limited to:

- `playground/experiments/startup/src/startup.ts`;
- `playground/experiments/app-shell/src/app-shell.ts`;
- `playground/experiments/app-container/src/app-container.ts`;
- `playground/experiments/terminal-ui/src/terminal-ui.ts`;
- `playground/experiments/terminal-lifecycle/src/terminal-lifecycle.ts`;
- `playground/experiments/session/src/session.ts`;
- `playground/experiments/presentation/src/presentation.ts`;
- `playground/experiments/logic-controls/src/logic-controls.ts`;
- corresponding contracts, tests, scripts, maps, project manifest, and CI.

No phase may use a broad rewrite of an existing owner file. Each touched file
must be read, the changed symbol identified, and edited with an explicit
`apply_patch` hunk.

### 11.3 Shared manifest contract

Every new module manifest must be closed and contain:

```json
{
  "module_id": "tui.example",
  "feature_id": "tui.example",
  "status": "design",
  "owner": "dsh-tui::example",
  "entry_symbol": "apply",
  "contract_paths": ["contracts/tui/example/manifest.json"],
  "owned_paths": ["contracts/tui/example/**", "playground/experiments/example/**"],
  "forbidden_edges": ["dsh-tui::transport", "dsh-tui::terminal-lifecycle"],
  "required_gates": ["example_contract", "example_positive_negative"],
  "build_command": "pnpm run build:example",
  "test_command": "pnpm run test:example"
}
```

The implementation may add module-specific fields, but it may not omit owner,
status, path ownership, entry symbol, forbidden edges, required gates, or
executable test/build commands. `design` and `pending` are not runtime
activation states.

Startup must consume the compiled/validated plugin manifest. It must not scan
`playground/experiments`, infer plugin IDs from filenames, or maintain a
second hand-written list that can diverge from the manifest.

### 11.4 Shared projection and revision contract

All display and control projections use the same control-side conventions:

```ts
interface TuiRevisionEnvelope {
  readonly publicationRevision: number
  readonly sourceRevision: number
}

interface TuiClosedProjectionFailure {
  readonly code: string
  readonly message: string
  readonly cause: Error
}
```

Rules:

1. revisions are finite, safe, and monotonic within their owner;
2. an older revision is rejected, not silently ignored;
3. a mixed-revision frame fails before realization;
4. control fields remain in typed side-channel contracts;
5. business payloads remain lossless and are never rebuilt from projections;
6. failure retains the original cause through the explicit error chain;
7. disposed services reject new work and dispose listeners exactly once.

### 11.5 Cordis lifecycle contract

Every plugin must:

1. expose one `apply(ctx)` entrypoint;
2. install exactly one named service on the supplied context;
3. register resources under the current Cordis effect;
4. register no resource through a global singleton;
5. return or expose effect-owned disposal;
6. reject duplicate registration and wrong-root registration;
7. leave no listener or timer after context disposal.

Tests must exercise both direct service disposal and parent-context disposal.
Object-literal plugin methods must not depend on `this` binding supplied by
Cordis; use a class instance or an explicit closure over immutable plugin
identity.

## 12. Phase Cards

Each phase card below is a required implementation packet. A phase is not
complete when its source compiles; it is complete only when its packet,
evidence, review, integration, and push receipt are complete.

### 12.1 Phase 0 packet: admission

Change set:

- `.appsdk/maps/module-registry.json`;
- `.appsdk/maps/resource-map.json`;
- `.appsdk/maps/function-map.json`;
- `.appsdk/maps/mainline-call-map.json`;
- `.appsdk/maps/verification-map.json`;
- `.appsdk/architecture/test-design.json`;
- `.appsdk/project.json`;
- `package.json`;
- `.github/workflows/dsh-tui.yml`;
- this plan and the goal prompt if the contract changes.

Admission tests:

- every target module has one owner and one path surface;
- every declared source path is covered exactly once;
- every declared edge is a real adjacent import/call edge;
- every required gate has a real package command and CI invocation;
- no `design`/`pending` entry is consumed as an active runtime module.

Admission output:

- a clean worktree record;
- an append-only baseline event;
- a declared change-set list;
- a map-only checkpoint commit;
- `check:design` and `test:design` evidence.

Phase 0 does not implement runtime behavior and does not promote target
modules to `active`.

### 12.2 Phase A packet: chrome display split

Implementation order:

1. land closed contracts and red tests for registry registration/disposal;
2. land five per-slot red tests and independent manifests;
3. implement registry and producers;
4. change startup to activate the validated manifest;
5. change app-container to consume the registry face;
6. prove zero references to `chrome-controls`;
7. update maps and promote only passing modules.

Required tests:

- `registry.accepts_only_canonical_slots`;
- `registry.rejects_unknown_duplicate_unowned_disposed_incomplete`;
- `registry.disposes_only_effect_owned_slot`;
- `registry.projects_canonical_order`;
- `display.apply_registers_one_slot`;
- `display.project_rejects_wrong_logic_control_family`;
- `display.projection_preserves_revision_and_closed_keys`;
- `app_container_consumes_each_slot_once`;
- `terminal_lifecycle_has_no_chrome_assembly`;
- `chrome_controls_has_zero_live_references`.

Required commands:

```text
pnpm run test:chrome-slot-registry
pnpm run build:chrome-slot-registry
pnpm run test:tui-logo && pnpm run build:tui-logo
pnpm run test:tui-connection && pnpm run build:tui-connection
pnpm run test:tui-session && pnpm run build:tui-session
pnpm run test:tui-status && pnpm run build:tui-status
pnpm run test:tui-execution && pnpm run build:tui-execution
pnpm run test:app-container && pnpm run build:app-container
pnpm run typecheck
pnpm run check:design
pnpm run test:design
pnpm run check:runtime-boundaries
```

Phase A output is one checkpoint candidate containing only the registry,
five display modules, startup/app-container integration, deleted
`chrome-controls`, synchronized maps/manifests/scripts/tests, and no
generated output.

### 12.3 Phase B packet: refresh and invalidation

Contract fields:

```ts
type TuiRefreshReason =
  | 'presentation' | 'logic-control' | 'chrome-slot' | 'composer'
  | 'overlay' | 'viewport' | 'error'

interface TuiRefreshIntent {
  readonly sourceModuleId: string
  readonly reason: TuiRefreshReason
  readonly sourceRevision: number
}

interface TuiRefreshPublication {
  readonly publicationRevision: number
  readonly causes: readonly TuiRefreshIntent[]
}
```

Implementation files:

- `contracts/tui/refresh-orchestrator/**`;
- `playground/experiments/refresh-orchestrator/**`;
- `tests/refresh-orchestrator/**`;
- `scripts/build-refresh-orchestrator.mjs`;
- startup/app-shell/app-container/presentation/logic-controls/
  terminal-lifecycle integration points listed in the ownership matrix;
- all affected maps, project manifest, package scripts, and CI.

Required tests:

- fresh request publishes once;
- duplicate source/revision/reason is idempotent;
- stale source revision fails;
- multiple causes in one microtask produce one publication;
- publication revision never regresses;
- disposed request/subscription fails;
- stop prevents later publication;
- compose failure preserves its cause and performs no retry;
- no `metadata`, payload, or renderer prop contains refresh fields;
- no second scheduler, unconditional timer, or direct lifecycle render
  invalidation remains.

The only legal output to app-container is the latest publication revision.
The only legal input to terminal-lifecycle is the realized terminal frame.

### 12.4 Phase C packet: slash command and Session switcher

`slash-command-plugin` contract:

```ts
interface TuiCommandIntent {
  readonly input: string
  readonly command: '/help' | '/resume' | '/quit'
  readonly args: readonly string[]
  readonly accepted: boolean
  readonly sourceRevision: number
}
```

`session-switcher-plugin` contract:

```ts
interface TuiSessionSelectionIntent {
  readonly sessionId: string
  readonly cwd: string
  readonly sourceRevision: number
}
```

Implementation constraints:

- parser owns tokenization and command validity only;
- app-shell owns command policy and `/quit` outcome;
- session owns listing, canonical cwd validation, hydrate, and atomic switch;
- selector owns only the interaction projection and accepted selection intent;
- no direct persistence read, replacement Session, or Host call from either
  plugin;
- failed listing/validation/hydration preserves the previously selected
  Session and its live streams.

Required tests:

- accepted `/help`, `/resume`, `/resume <id>`, `/quit`;
- empty, malformed, unknown, stale, and wrong-family commands fail;
- ordinary prompt text never becomes a command;
- malformed or different-cwd summaries are rejected;
- listing/hydration failure leaves old Session unchanged;
- success changes exactly one Session identity;
- selector disposal occurs exactly once after accepted selection.

### 12.5 Phase D packet: overlay and composer

Overlay contract fields:

```ts
interface TuiOverlayState {
  readonly view: string
  readonly title: string
  readonly items: readonly string[]
  readonly selectedIndex: number
  readonly sourceRevision: number
}
```

Composer contract fields:

```ts
interface TuiComposerProjection {
  readonly text: string
  readonly cursor: number
  readonly lines: readonly string[]
  readonly mode: 'idle' | 'streaming' | 'error'
  readonly sourceRevision: number
}
```

Implementation constraints:

- overlay manager owns the stack and top-view routing;
- composer owns text, cursor, multiline editing, local echo, submit, and
  cancel intent;
- focus restoration is effect-owned and idempotent;
- terminal-lifecycle only supplies decoded key events and carries frames;
- the priority remains `fatal > approval/question > selector > command >
  queue > composer`;
- local echo is ephemeral control state and never enters Session truth.

Required tests:

- only the top view receives keys;
- open/close restores prior focus and composer;
- `q`, Ctrl+C, and Ctrl+D obey active view, running state, and empty state;
- multiline cursor operations preserve text and coordinates;
- local echo converges only on a newer official user event;
- failed submit becomes failed local projection, never business success;
- stale selection, invalid cursor, duplicate close, and disposed services
  fail explicitly.

### 12.6 Phase E packet: status footer and final composition

`status-footer-plugin` owns the projection of:

- connection health;
- current Session identity and cwd;
- turn lifecycle;
- model/context/tool/queue state;
- interaction state;
- local fatal or submission error.

It must define one deterministic severity and ordering rule. An error state
cannot be replaced by an idle state merely because another source refreshed.

Implementation files:

- `contracts/tui/status-footer-plugin/**`;
- `playground/experiments/status-footer-plugin/**`;
- `tests/status-footer-plugin/**`;
- `scripts/build-status-footer-plugin.mjs`;
- terminal-ui and app-container integration points;
- affected maps, manifests, package scripts, CI, and test design.

Required tests:

- each status dimension stays orthogonal;
- error dominates idle;
- mixed revisions fail;
- default and compact layouts are deterministic;
- five chrome slots, transcript, execution, composer, overlay, and footer
  occur exactly once;
- duplicate keys, unknown slots, invalid dimensions, stale frames,
  disposed container, and control-field smuggling fail.

Phase E is the last source implementation phase. It must leave terminal-ui
as a generic descriptor consumer and app-container as the only ordered frame
owner.

### 12.7 Phase F packet: candidate runtime evidence

The candidate artifact identity is a tuple:

```text
(source commit, package version, tarball SHA-256, installed realpath,
 Host endpoint, Host PID, Session ID, WebUI evidence timestamp)
```

All evidence records must include that tuple or explicitly mark the external
field unavailable. A source build and a different installed artifact cannot
be combined into one acceptance claim.

Required run order:

1. pinned AppSDK 0.1.3 verification;
2. design and boundary gates;
3. all affected tests and builds;
4. `pnpm run pack:mvp`;
5. isolated clean-registry install with an isolated npm cache;
6. `npm ls --all`, package identity, public exports, and installed `--help`;
7. installed PTY at default and compact dimensions;
8. official Host/WebUI same-Session evidence in both directions;
9. terminal restoration, error-chain, and exit-code evidence;
10. write Markdown evidence records, leaving logs/screenshots ignored.

The locked provider/model and official Host are part of the evidence
boundary. Quota or provider failure is recorded as an external gate; it is
never hidden by switching provider, model, Host, or Session.

### 12.8 Phase G packet: AGY Review and delivery

Review prerequisites:

- exact candidate source is clean and locally reproducible;
- affected tests, builds, clean install, installed PTY, and online evidence
  pass or have an explicitly recorded external gate;
- module-boundary self-audit is rerun after the last code change;
- checkpoint commit contains only the declared change set.

Review procedure:

1. Start only `agy-review` MCP in read-only mode against the exact candidate
   commit and base.
2. Treat controller `PASS` as the only review success signal.
3. Treat any P0/P1 finding, malformed result, timeout, or environment failure
   as non-pass.
4. On FAIL, repair the finding at its unique owner, rerun all affected
   verification and runtime evidence, create a new checkpoint, and start a
   new review task. Never reuse a previous PASS after code changes.
5. On PASS, inspect staged scope, create the delivery commit, integrate onto
   latest `main`, rerun main-tree gates, push, and compare
   `git ls-remote origin refs/heads/main` with local HEAD.

The delivery receipt must record:

- review task ID and final PASS evidence;
- checkpoint and delivery commit IDs;
- main-tree verification commands and results;
- local HEAD, remote `main`, and their equality;
- exact staged path list;
- claim release and worktree cleanup evidence.

## 13. Milestone Evidence Record

Each phase appends one machine-readable event to its worker run notes and one
human-readable handoff record. The event must contain:

```json
{
  "phase": "A",
  "feature_ids": ["tui.chrome.slot-registry"],
  "modules": ["chrome-slot-registry", "tui-logo"],
  "owner": "dsh-tui::chrome-slot-registry",
  "base_commit": "b890d3c",
  "candidate_commit": "candidate",
  "owned_paths": ["contracts/tui/chrome-slot-registry/**"],
  "positive_tests": ["registry.projects_canonical_order"],
  "negative_tests": ["registry.rejects_duplicate"],
  "build_commands": ["pnpm run build:chrome-slot-registry"],
  "runtime_evidence": [],
  "review": {"backend": "agy", "status": "pending"},
  "next": "start review after all prerequisites"
}
```

The actual commit IDs, test counts, artifact hashes, host/session IDs, and
review task IDs are filled only after execution. Never prefill them with
claims or placeholders in a completion report.

## 14. Stop Conditions and Open-Gate Reporting

Stop the current phase and report the exact gate when:

- the clean worktree, claim, branch, base, or HEAD declaration disagrees;
- a source path or import edge is not owned by the maps;
- a required package script or CI invocation does not exist;
- a red test is weakened, skipped, or made green by fallback behavior;
- a runtime artifact cannot be proven identical to the reviewed source;
- the official Host, provider/model, registry, PTY, WebUI, or review service
  is unavailable;
- staged scope contains an unrelated or generated file.

Open-gate reports use this format:

```text
OPEN GATE: <gate_id>
OWNER: <unique owner>
EVIDENCE: <path or command>
IMPACT: <what cannot be claimed>
NEXT: <single executable action>
```

An open gate is not a failure of the implementation if it is external, but
it is also not completion evidence. Do not create a fallback path to make the
gate appear green.

## 15. Final Worker Prompt Contract

The companion file `dsh-tui-full-completion.goal.md` is intentionally short.
It is the execution trigger, not a second design document. When the prompt
and this plan disagree, this plan's latest committed revision is canonical.
The prompt must never ask the worker to generate another prompt for the same
goal.

## 16. Execution Refresh: Remaining Detailed Design

This section is the current execution delta after Phase A delivery. Earlier
sections remain design history and architecture background. If an earlier
status statement conflicts with this section, this section is authoritative;
architecture owners and invariants do not change by that precedence.

### 16.1 Current receipt and execution order

Current delivered main:

```text
origin/main = 953a95eb2c47283756eb19d83f42ff2e06111f83
```

Phase A is no longer a candidate state. The delivered main contains these
active modules:

```text
chrome-slot-registry
tui-logo
tui-connection
tui-session
tui-status
tui-execution
```

Delivery evidence is bound to commit `953a95e`. AGY Review task
`tui-display-plugin-split-phase-a-r2` returned PASS with zero findings. The
same source was clean-installed, exercised through PTY at default and resized
dimensions, submitted online, compared with official WebUI history, and then
replayed on main. The installed tarball SHA-256 was
`3ccdf2e277fd56228d8d446697301cde5db61690b9a49ac624548bbdece230aa`.

The remaining execution order is fixed:

```text
B refresh-orchestrator
C slash-command-plugin + session-switcher-plugin
D overlay-manager-plugin + composer-plugin
E status-footer-plugin + complete composition cleanup
F full runtime verification
G final review, merge, push, and receipt
```

A phase starts only on a new claim and clean worktree created from the latest
`origin/main`. A phase ends only when its red/green tests, builds, maps,
boundaries, typecheck, runtime evidence where required, AGY Review, precise
commit, integration, and remote receipt are complete. Review is never used as
a discovery tool before local verification is green.

### 16.2 Registration contract for every remaining module

Before a module has executable code, its admission packet must add all of the
following with `design/pending` status:

```text
.appsdk/project.json                         module build/regression entry
.appsdk/maps/module-registry.json            owner, paths, edges, gates
.appsdk/maps/resource-map.json               owned resource truth
.appsdk/maps/function-map.json               face and implementation bindings
.appsdk/maps/mainline-call-map.json          adjacent caller/callee edges
.appsdk/architecture/test-design.json        positive/negative matrix
.appsdk/maps/verification-map.json           required gate wiring
.github/workflows/dsh-tui.yml                executable CI invocation
package.json                                 test:<module> and build:<module>
contracts/tui/<module>/manifest.json         active/design status lock
```

The standard authoring surface for each plugin is:

```text
contracts/tui/<module>/<module>.types.ts
contracts/tui/<module>/manifest.json
playground/experiments/<module>/src/<module>.ts
playground/experiments/<module>/tsconfig.json
tests/<module>/<module>.spec.ts
scripts/build-<module>.mjs
<module>.js                                     generated root artifact only
generated/modules/<module>/**                  ignored generated output
```

Admission is not complete because a map entry exists. `check:design`,
`test:design`, ownership/import checks, the named test script, and the named
build script must all fail before implementation and pass after it.

### 16.3 Shared plugin rules

Every remaining control plugin is a Cordis plugin, not a React component and
not a terminal carrier. Its public shape is one service plus `apply(ctx)`:

```ts
export const tuiXxxName = 'tuiXxx' as const

export interface TuiXxxFace {
  readonly name: typeof tuiXxxName
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly tuiXxx?: TuiXxxFace
  }
}

export function apply(ctx: Context): void
```

Mandatory behavior:

- constructor or `apply` registers exactly one Cordis dispose effect;
- disposed request, subscribe, select, submit, close, and projection calls
  fail explicitly;
- inputs are validated, frozen, and closed; unknown fields are rejected;
- output models are immutable and carry safe-integer revisions where a caller
  needs ordering;
- private implementation imports are forbidden across module boundaries;
- business payloads contain no retry, debug, provider, health, routing,
  stopless, snapshot, or other control fields;
- plugins call adjacent typed faces only; they do not import Host, transport,
  session storage, Ink, React, Node streams, or another plugin's private code;
- a plugin may project UI state but may not compose the app frame.

Fixed ownership boundaries:

```text
app-event-bus              typed intent/control bus
logic-controls             control-state machines
functional plugin          one interaction/state/projection owner
app-container              sole ordered frame owner
terminal-ui                sole primitive realization owner
terminal-lifecycle         sole terminal mount/render/restore carrier
refresh-orchestrator       sole invalidation/publication revision owner
```

No functional plugin may own a second scheduler, frame composer, Ink root,
Session store, transport client, process exit path, or global mutable model.

### 16.4 Phase B detailed design: `refresh-orchestrator`

Owner: `dsh-tui::refresh-orchestrator`.
Service name: `tuiRefreshOrchestrator`.
Resource ID: `tui_refresh_orchestration`.

Install point:

```text
after logic-control services
before chrome registry, display plugins, app-container, lifecycle, app-shell
```

The exact contract is:

```ts
type TuiRefreshSourceModuleId =
  | 'app-shell'
  | 'app-container'
  | 'chrome-slot-registry'
  | 'tui-logo'
  | 'tui-connection'
  | 'tui-session'
  | 'tui-status'
  | 'tui-execution'
  | 'slash-command-plugin'
  | 'session-switcher-plugin'
  | 'overlay-manager-plugin'
  | 'composer-plugin'
  | 'status-footer-plugin'

type TuiRefreshReason =
  | 'presentation'
  | 'logic-control'
  | 'chrome-slot'
  | 'composer'
  | 'overlay'
  | 'viewport'
  | 'error'

interface TuiRefreshIntent {
  readonly sourceModuleId: TuiRefreshSourceModuleId
  readonly reason: TuiRefreshReason
  readonly sourceRevision: number
}

type TuiRefreshRequestResult =
  | { readonly status: 'queued' }
  | { readonly status: 'coalesced' }
  | { readonly status: 'rejected'; readonly reason: 'stale' | 'disposed'; readonly message: string }

interface TuiRefreshPublication {
  readonly publicationRevision: number
  readonly causes: readonly TuiRefreshIntent[]
}

interface TuiRefreshOrchestratorFace {
  request(intent: TuiRefreshIntent): TuiRefreshRequestResult
  subscribe(listener: (publication: TuiRefreshPublication) => void): () => void
  dispose(): void
}
```

Runtime rules:

1. revisions are nonnegative safe integers and monotonic per source module;
2. an older `sourceRevision` returns `rejected/stale` without publishing;
3. equal source, revision, and reason within one pending publication is
   idempotent and returns `coalesced`;
4. different causes arriving before the microtask boundary coalesce into one
   publication whose cause order is first-request order;
5. every publication allocates exactly one monotonically increasing
   `publicationRevision`;
6. listeners receive one publication per allocated revision, in subscription
   order, after the current task yields;
7. unsubscribe is idempotent; disposed subscribe/request/dispose fail or return
   the explicit rejected result declared above;
8. a listener failure does not silently become success and must be observable
   through the explicit error path chosen during implementation;
9. dispose clears pending work and rejects later requests; it does not emit an
   invented publication;
10. the service stores only intent control facts and revision counters, never
   presentation nodes, transcript text, composer text, Session payload, Host
   response, metadata, or provider state.

Integration contract:

- startup wires presentation, logic controls, chrome slots, viewport, error,
  and future plugin sources to `request(...)`;
- app-shell owns the single orchestrator subscription and invokes its existing
  compose-and-realize tail from that callback;
- inline `renderQueued` and `queueMicrotask` scheduling in the runtime
  controller are physically deleted after parity tests prove cardinality;
- immediate synchronous `render()` remains only for lifecycle-start and
  explicit command paths where the existing contract requires an immediate
  first frame; those callers are enumerated in tests;
- app-container consumes only the publication revision and continues to reject
  stale frames;
- terminal-lifecycle receives only a realized tree and never sees refresh
  reasons or causes.

Required map additions include resources
`tui_refresh_orchestration` and `refresh_publication_failure_chain`; functions
`request_tui_refresh`, `publish_tui_refresh`, and `subscribe_app_render`;
edges from each admitted source to request and from publication to the single
app-shell render subscriber. The direct edge from refresh to Session, transport,
Host, presentation mutation, app-container compose, or terminal-lifecycle render
is forbidden.

Minimum paired tests:

```text
positive:
fresh intent publishes once
N distinct intents in one microtask publish once with N causes
subscription receives publications in allocation order
unsubscribe stops delivery
dispose removes pending callback registration

negative:
negative/noninteger revisions fail validation
older revision is stale and cannot regress publication
equal triple is coalesced rather than duplicated
disposed request/subscriber fails explicitly
listener error is visible and does not create an idle loop
business input/output carries no refresh field
app-shell parity proves one resize -> one request -> one compose -> one render
stop/dispose produces no late render
```

Exit gates for the checkpoint:

```bash
pnpm run check
PATH="$HOME/.local/lib/appsdk/0.1.3:$PATH" appsdk verify .
pnpm run test:refresh-orchestrator
pnpm run build:refresh-orchestrator
pnpm run test:app-container && pnpm run build:app-container
pnpm run test:app-shell && pnpm run build:app-shell
pnpm run test:terminal-lifecycle && pnpm run build:terminal-lifecycle
pnpm run check:runtime-boundaries
pnpm run check:clean-install
scripts/pty-smoke.exp
```

The PTY gate must prove visible boot, resize reflow, submission, restoration,
and exit. Online evidence is required only if Phase B changes Session-facing
payload semantics; pure scheduling cutover still requires installed PTY proof.

### 16.5 Phase C detailed design: command and Session selection

Phase C creates two independent modules in one verified milestone only if both
admission packets and both test matrices pass together. If either half fails
integration, deliver only a complete half; never leave a deleted inline handler
without its replacement active.

#### `slash-command-plugin`

Owner: `dsh-tui::slash-command-plugin`.
Service name: `tuiSlashCommand`.
Resource ID: `tui_slash_command_control`.

Contract:

```ts
type TuiCommandName = 'help' | 'resume' | 'quit'

interface TuiCommandInput {
  readonly text: string
  readonly sourceRevision: number
}

type TuiCommandIntent =
  | { readonly kind: 'help'; readonly sourceRevision: number }
  | { readonly kind: 'quit'; readonly sourceRevision: number }
  | { readonly kind: 'resume'; readonly sessionId: string | null; readonly sourceRevision: number }
  | { readonly kind: 'rejected'; readonly code: 'empty' | 'not-command' | 'unknown' | 'malformed-argument'; readonly message: string; readonly sourceRevision: number }

type TuiAcceptedCommandIntent = Exclude<TuiCommandIntent, { kind: 'rejected' }>

interface TuiSlashCommandFace {
  parse(input: TuiCommandInput): TuiCommandIntent
  subscribe(listener: (intent: TuiCommandIntent) => void): () => void
  dispose(): void
}
```

The implementation may expose an additional accepted-intent dispatch face using
`TuiAcceptedCommandIntent`; the generic subscription face must not silently hide
rejected intents from tests. Accepted intents are dispatched to app-shell's
existing typed control dispatcher. Unknown commands produce one rejected
projection and one refresh request, never an implicit prompt submission.

Boundaries:

- tokenize literal composer text only when it begins with `/`;
- ordinary prompt text never enters the parser;
- `/resume <id>` validates a nonempty single argument but does not touch
  Session persistence;
- `/help` and `/quit` are intents; overlay creation and lifecycle exit stay in
  their current unique owners until their own extraction phases;
- no Host API call and no Session mutation.

Tests must pair accepted commands with rejected empty, non-command, unknown,
missing argument, extra argument, whitespace-only argument, disposed parser,
stale revision, and payload-isolation cases.

#### `session-switcher-plugin`

Owner: `dsh-tui::session-switcher-plugin`.
Service name: `tuiSessionSwitcher`.
Resource ID: `tui_session_selection_control`.

Responsibilities and faces:

```text
listForComposer(): typed selector request
select(summary): typed Session selection intent
projectSelectorState(): closed list/index/busy/error state
subscribe(listener): state changes only
dispose(): idempotent Cordis disposal
```

It consumes the existing Session owner's current-cwd listing and resume faces.
It owns only selector interaction state. It does not read files, logs, SQLite,
persistence, Host endpoints, or raw response bodies.

State machine:

```text
idle -> listing -> selecting -> succeeded
idle -> listing -> failed(old selection preserved)
listing -> selecting -> failed(old selection preserved)
succeeded -> idle after exactly one selection publication
any state -> disposed
```

Rules:

- every listed item must have a nonempty Session ID, cwd, and lifecycle;
- items outside current cwd or terminated are filtered with an explicit count;
- malformed summaries reject the whole listing rather than being silently
  dropped;
- concurrent requests are keyed by request revision; only the newest may
  resolve;
- selection is disabled while busy;
- successful switch emits one selection intent, clears only interaction-local
  busy/error state, and requests one refresh;
- failure preserves old selected Session, old stream subscriptions, composer
  text, transcript, and scroll position.

Tests must cover current-cwd parity, running marker rendering, malformed and
different-cwd summaries, empty list, list failure, hydrate failure, stale async
resolution, double selection, successful identity change, and unchanged old
selection after every failure path.

Integration removal targets are limited to inline `/help`, `/resume`, and
selector handling in startup/app-shell after parity is proven. `/quit` remains
wired to terminal-lifecycle's sole exit owner.

### 16.6 Phase D detailed design: overlays and composer

#### `overlay-manager-plugin`

Owner: `dsh-tui::overlay-manager-plugin`.
Service name: `tuiOverlayManager`.
Resource ID: `tui_overlay_stack_control`.

Closed view kinds start as:

```ts
type TuiOverlayViewKind =
  | 'approval-question'
  | 'selector.resume-current-cwd'
  | 'overlay.help'
```

The stack is a finite immutable linked list or array with:

```text
view kind, stable key, title, frozen items, selected index, opener revision
```

Callbacks are stored outside projected payload and are invoked only while the
view is topmost and the manager is active.

Priority is fixed:

```text
fatal > approval/question > selector > help > composer
```

Rules:

- open pushes one effect-owned view and returns one close function;
- only the top view can receive key routing or invoke its selection callback;
- Escape and `q` close only closable views; fatal views require their own
  explicit action;
- closing restores the prior focus view and requests one refresh;
- opening/closing an overlay preserves composer text, cursor, mode, transcript,
  scroll offset, and selected Session;
- duplicate close, stale index, malformed item, hidden-view input, and disposed
  manager fail explicitly;
- stack depth has an explicit safe-integer limit instead of relying on memory
  exhaustion.

Extraction target is overlay/focus state currently held by the runtime
controller. Terminal-lifecycle remains byte/key carrier; focus-manager remains
the sole focus-stack owner.

#### `composer-plugin`

Owner: `dsh-tui::composer-plugin`.
Service name: `tuiComposer`.
Resource ID: `tui_composer_control`.

It owns multiline text, cursor coordinates, edit mode, submit eligibility,
cancel projection, and local echo projection. It does not own business action
IDs, Session submission truth, canonical conversation events, or terminal bytes.

Faces:

```text
insertText / newline / backspace / delete / move / home / end
submit(): typed submit or command intent
cancel(): typed cancel intent
markSubmitted(localEchoId): local-only transition
markSubmissionFailed(localEchoId, message): local-only failure
attachOfficialEcho(event): converge local echo to canonical user node
project(): terminal-neutral composer region leaf input
subscribe(listener): state changes only
dispose()
```

Rules:

- all edit helpers remain pure functions moved from app-shell, not duplicated;
- cursor stays a safe integer inside UTF-16 code-unit bounds and is updated
  atomically with text;
- Shift+Enter inserts a newline; Enter submits only when eligible;
- Ctrl+C cancels only while running and exits only under the existing idle rule;
- Ctrl+D exits only when composer is empty and Session is idle;
- submit emits one intent and creates at most one local echo;
- local echo converges only on a newer official user event matching the
  established node identity rules;
- failed submit marks the local projection failed and never invents business
  success;
- overlay transitions preserve text, cursor, mode, and pending echoes.

Tests must move or supersede the existing app-shell composer suite and add
paired stale-submit, disposed-submit, malformed cursor, convergence, duplicate
convergence, failed submit, cancel-while-idle, and payload isolation cases.

### 16.7 Phase E detailed design: footer and final composition

Owner: `dsh-tui::status-footer-plugin`.
Service name: `tuiStatusFooter`.
Resources: `terminal_status_projection_control` and
`typed_status_footer_region_leaf`.

The plugin owns footer layout policy and projects one closed region leaf from
control state. It does not own Session truth, connection truth, execution
truth, transcript truncation, frame order, or primitive realization.

Input is a closed tuple:

```text
connection projection
execution projection
status projection
selected Session identity
viewport columns/rows class
publication revision
fatal/local error
```

Output is one frozen footer leaf with stable keys, no raw event payload, and no
frame-level ordering knowledge. App-container places the footer exactly once.
Terminal-ui realizes generic leaves only.

Phase E also completes composition cleanup:

1. delete dead helper functions left by Phases B-D after call-graph proof;
2. ensure every region appears exactly once in default and compact layouts;
3. ensure compact reorder does not drop header/footer or duplicate overlay;
4. ensure all regions use one publication revision and one view model;
5. keep app-container as the only place that knows whole-frame region order;
6. update component/function/mainline maps so every deleted symbol has zero
   references.

Paired tests cover error priority over idle/status, orthogonal dimensions,
mixed revision rejection, missing region rejection, duplicate placement
rejection, deterministic compact order, resize stability, disposed projection,
and zero-reference deletion audit.

### 16.8 Phase F runtime acceptance matrix

Phase F runs on the integrated candidate after all modules are active and maps
are active. It is not a substitute for per-milestone gates.

Local matrix:

```bash
rm -rf node_modules && pnpm install --frozen-lockfile
pnpm run check
PATH="$HOME/.local/lib/appsdk/0.1.3:$PATH" appsdk verify .
for module in \
  app-event-bus transport session presentation component-registry \
  fixture-contract terminal-lifecycle terminal-ui focus-manager \
  chrome-slot-registry tui-logo tui-connection tui-session tui-status \
  tui-execution logic-controls app-container refresh-orchestrator \
  slash-command-plugin session-switcher-plugin overlay-manager-plugin \
  composer-plugin status-footer-plugin installer simulator; do
  pnpm run "test:${module}"
  pnpm run "build:${module}"
done
pnpm run check:public-exports
pnpm run check:clean-install
pnpm run check:runtime-boundaries
git diff --check
```

Installed runtime matrix:

```text
pack artifact and record SHA-256
install into isolated clean registry and isolated npm cache
record npm ls, realpath, version, and installed --help
PTY 80x24 boot and five-region visibility
PTY 100x24 boot followed by 60x20 resize and anchor preservation
installed CLI help
Ctrl+C cancel and terminal restoration
online prompt submission and public history convergence
official WebUI same-Session render and direction checks
default and compact layout evidence
nonzero-error path evidence
```

Every online record must identify Host endpoint, Host PID when available,
Session ID, WebUI timestamp, installed realpath, artifact hash, and candidate
commit. Provider/model/Host/Session substitutions are forbidden. External
quota or service unavailability is reported as an open gate, not bypassed.

### 16.9 Per-milestone review and Git protocol

For each phase:

1. record latest `origin/main` and create a semantic claim;
2. create a clean worktree and branch from that exact commit;
3. land governance admission first with failing scripts/tests where possible;
4. implement contracts, source, tests, package script, CI, maps, and docs in
   the same reviewed change set;
5. run targeted tests, affected builds, typecheck, design/boundary checks, and
   required runtime gates;
6. perform pre-review module self-audit against owned paths, import edges,
   resources, and mainline edges;
7. stage only declared paths and inspect `git diff --cached --stat` and
   `--name-status`;
8. run AGY Review MCP on the exact candidate;
9. on FAIL, repair at the unique owner, rerun affected gates/runtime, make a
   new candidate, and start a new review;
10. on PASS, integrate latest `origin/main`, rerun main-tree affected gates,
   fast-forward push only when local HEAD equals the reviewed/integrated HEAD,
   compare `git ls-remote origin refs/heads/main`, release the claim, and clean
   the merged worktree and branch.

Review uses only AGY Review MCP with `REVIEW_BACKEND=agy`,
`--dangerously-skip-permissions`, JSON output, and JSON schema. Any P0/P1,
malformed JSON, timeout, environment failure, or missing conclusion is FAIL.
DSH Review and Codex Review are not fallback channels.

### 16.10 Completion gap ledger

At the current receipt:

| Gap | Owner | Status |
| --- | --- | --- |
| Unified refresh and invalidation | `dsh-tui::refresh-orchestrator` | not started |
| Slash command interaction owner | `dsh-tui::slash-command-plugin` | not started |
| Current-cwd selector owner | `dsh-tui::session-switcher-plugin` | not started |
| Overlay stack owner | `dsh-tui::overlay-manager-plugin` | not started |
| Composer/local-echo owner | `dsh-tui::composer-plugin` | not started |
| Footer projection owner | `dsh-tui::status-footer-plugin` | not started |
| Inline startup/app-shell handlers | current startup/app-shell | delete only after replacements pass |
| Full runtime receipt | delivery owner | must be regenerated after last product change |

There is no authorized shortcut that marks a module complete because its UI
appears. Completion requires an active module, active maps, paired tests, CI,
build, install/runtime evidence where applicable, and AGY PASS bound to the
final commit.

## 17. Revised execution contract

This section is the active worker contract for the remaining delivery. It
supersedes any stale worktree, pre-Phase-D receipt, or historical candidate
path described earlier in this document.

### 17.1 Baseline and worktree

1. Read the current `origin/main` receipt immediately before starting or
   resuming a phase. `origin/main` is the only implementation base.
2. Use one semantic claim and one clean Playground worktree per phase,
   created from that exact receipt. The main worktree is integration-only; it
   is not an authoring surface.
3. A stale, dirty, or detached worktree is not repaired by copying files from
   another worktree. Create a new clean worktree from the current main receipt
   and leave unrelated dirty state untouched.
4. Before product-file writes or long gates, update the worker-owned
   `.agent-collab` actor, heartbeat, and append-only run notes. If the collab
   daemon is unavailable, record that fact and keep the file protocol
   authoritative; do not claim daemon coordination.

### 17.2 Milestone loop

Every milestone follows this exact loop:

```text
latest origin/main
  -> claim + clean Playground worktree
  -> resource/function/mainline/verification admission
  -> contracts + red tests + source + maps + package/CI/docs
  -> targeted tests + builds + typecheck + design/boundary gates
  -> module-boundary self-audit
  -> exact checkpoint commit
  -> AGY Review MCP
       FAIL -> unique-owner fix -> rebuild/retest -> new checkpoint commit
                 -> new AGY Review MCP task
       PASS -> integrate onto latest main -> main-tree gates
                 -> delivery commit + push -> remote receipt equality
```

The checkpoint commit is the exact review candidate and must contain only the
declared milestone change set. A review PASS becomes invalid after any source,
test, build, map, or runtime-configuration change. A failed review is never
bypassed by DSH Review or Codex Review.

### 17.3 Required evidence and stop conditions

For each milestone, record the base receipt, claim, worktree, checkpoint and
delivery commits, test/build results, map/boundary results, review result, and
main/remote equality in the worker-owned evidence and handoff records.

Stop without claiming completion when any of these is missing or red:

- pinned AppSDK 0.1.3 verification;
- target resource/function/mainline/verification map lockstep;
- source ownership and declared import-edge checks;
- targeted positive/negative tests, affected builds, or typecheck;
- required installed/runtime/online evidence;
- AGY Review controller PASS for the exact candidate;
- latest-main integration, main-tree rerun, or remote `main` equality.

### 17.4 Scope for the remaining phases

- Phase E: finish status-footer ownership and complete composition cleanup,
  then deliver it through the milestone loop.
- Phase F: run the full installed-artifact, PTY, resize, restore, Session,
  overlay/composer, and official WebUI same-Session acceptance matrix against
  the delivered Phase E source.
- Phase G: run the final AGY Review against the exact runtime-verified
  candidate, integrate and push the final main receipt, and write the delivery
  record.

No phase is complete because source tests pass or the interface renders in a
worktree. Completion is the pushed main receipt plus matching runtime evidence
and review evidence.
