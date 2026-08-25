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

- The current `origin/main` receipt for this plan is
  `9c674b8b5bd6d0315689dd3df8324976c15fcc50`.
- The project already has the public transport, Session, presentation,
  terminal, lifecycle, app-shell, app-container, governance, installer,
  simulator, and evidence-plan foundations described by the canonical plans.
- App-container is the active ordered-frame owner. Terminal-lifecycle is the
  carrier and must not assemble regions or interpret business state.
- The main tree still has the pre-split `chrome-controls` implementation.
  A separate Phase A candidate exists at commit `10c4eee`, but it is not
  admitted to `main` until its own AGY Review, latest-main integration,
  main-tree gates, and push receipt complete.

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

- `origin/main=9c674b8b5bd6d0315689dd3df8324976c15fcc50`.
- `chrome-controls` remains active in the main tree.
- Phase A candidate `10c4eee` is a separate review candidate and is not
  evidence that the main tree has been migrated.
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
  "base_commit": "9c674b8",
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
