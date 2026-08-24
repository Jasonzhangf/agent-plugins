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
gates and read-only DSH Review.

## 2. Current Baseline and Gaps

### Baseline

- `origin/main` receipt for this plan is `88810d2368801f4a6f35df1e8b2fb0d45e9aaa40`.
- The project already has the public transport, Session, presentation,
  terminal, lifecycle, app-shell, app-container, governance, installer,
  simulator, and evidence-plan foundations described by the canonical plans.
- App-container is the active ordered-frame owner. Terminal-lifecycle is the
  carrier and must not assemble regions or interpret business state.
- The committed Phase A direction identifies five chrome display slots and
  a dedicated registry. The candidate implementation must still pass its
  own tests and map lockstep before it is admitted.

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
4. Run DSH Review through the DSH MCP with `action=review`, omitting
   provider/model overrides. Review is read-only.
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
  -> DSH Review
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
| Review | DSH Review unambiguous semantic PASS after all previous evidence |
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
9. DSH Review returns an unambiguous semantic PASS after all runtime gates.
10. The final delivery commit contains only intentional source, contracts,
    tests, scripts, and docs; local HEAD equals remote main.

Until item 10 is evidenced, report the exact open gate and do not report the
TUI as complete.
