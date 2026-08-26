# TUI executable app-container ownership plan

Status: Phase 1 in progress. Runtime cutover is not implemented.

## Objective

Make `dsh-tui::app-container` the only owner of whole-screen ordering and frame
tree construction. It must publish one complete, closed, recursively frozen
tree. `terminal-lifecycle` must become a terminal/Ink carrier that mounts and
rerenders a generic realized tree without reconstructing application regions.

The migration is split into two independently committed and reviewed phases:

1. Phase 1 lands contracts, current/target maps, test design, and executable
   red gates. Every v4 runtime binding stays `design/pending`.
2. Phase 2 atomically activates the v4 runtime path and physically deletes the
   v3 metadata-only reconstruction path. There may never be two composition
   owners or a compatibility fallback.

## Verified starting point

- Phase base: `e3f1c1e73e470c436f394c3f6bd4171c8baacadf`.
- `main`, `origin/main`, and the remote main receipt matched that commit when
  Phase 1 began.
- AppSDK is pinned to `0.1.3`; the supported bootstrap command is
  `appsdk verify dsh-tui`.
- The prior chrome seam review `dsh-tui-chrome-seam-20260823T060500Z` passed,
  but that verdict covers only the merged chrome seam.
- Live v3 still lets `terminal-lifecycle.TuiShellView` group chrome by
  placement, choose layout order, assemble fixed regions, and compute the row
  budget. That source is the first divergence.

## Owner boundary

```text
typed presentation/component projections
  -> terminal-ui closed body region leaves and primitive contract
typed chrome projections
  -> app-container adjacent side input
closed body leaves + chrome
  -> app-container unique frame builder and validator
  -> one immutable ordered frame tree
  -> terminal-ui generic primitive realization
  -> terminal-lifecycle mount/rerender carrier
  -> one terminal frame
```

- terminal-ui owns the shared closed `box | text` primitive contract, region
  leaf projection, validation, and generic realization.
- app-container owns the exact region set, default/compact tree policy,
  viewport row allocation, stable-key/revision validation, and recursive
  freezing.
- terminal-lifecycle owns typed input/resize publication, the single Ink
  instance, mount/rerender/flush, suspend/resume, restore, and terminal failure
  propagation.
- app-shell/startup install public faces, store the one current validated
  viewport pair, enforce the first-compose precondition, and orchestrate only
  adjacent calls.
- No `app-container -> terminal-lifecycle` import is allowed.
- Control, debug, provider, routing, retry, and invalidation state stays on
  typed control resources and never enters business payloads or render leaves.

## Closed frame contract

The target shared frame contains only:

- contract discriminator;
- publication revision;
- validated viewport `{ columns, rows }`;
- one frozen root generic primitive.

It does not carry layout, slots, chrome placement, debug metadata, or business
control state. Root order is the layout truth.

The primitive union is closed:

- `text`: stable key, text, closed text style;
- `box`: stable key, closed box style, ordered frozen children.

All objects must be plain, exact, recursively frozen data. Unknown fields,
symbols, accessors, explicit `undefined`, duplicate keys, cycles, invalid
viewport values, and stale revisions fail explicitly.

The required leaf slots remain:

```text
header.logo
header.connection
header.session
header.status
transcript
execution
composer
footer
```

`overlay` is optional. Absence means the property and tree node are omitted;
`null`, placeholder nodes, and renderer-side guessing are forbidden. Local
echoes are children of transcript. Footer explicitly contains the existing
Session/status block and footer marker, so no unregistered `status` region is
inserted by the carrier.

Default policy:

```text
header(logo, connection, session, status)
transcript
execution
composer
overlay when present
footer(status + marker)
```

Compact policy:

```text
transcript
execution
overlay when present
composer
header(logo, connection, session, status)
footer(status + marker)
```

Stable keys never include layout, revision, or array position.

## Viewport bootstrap control chain

The first frame cannot use a width-only option or an `80 x 24` default. The
pending v4 startup order is:

```text
app-shell installs app-event subscriber and terminal input handler
  -> terminal-lifecycle enters without mounting and observes real streams
  -> terminal-lifecycle publishes terminal.resize
  -> app-event-bus validates and freezes exact {columns, rows}
  -> app-shell stores the same pair atomically
  -> app-shell proves current_terminal_viewport exists
  -> app-container receives that pair as a required side input
  -> terminal-ui realizes primitives
  -> terminal-lifecycle performs the first mount
```

Later stdout resize uses the same publication, validation, storage, compose,
realize, and rerender path. Raw observation cannot reach app-shell state or
app-container directly. App-event-bus cannot reach app-container directly.
The validated pair is forwarded by reference; copying or reconstructing it is
forbidden.

## Pipeline version

The v3 node 05/06 semantics are consumed and cannot be silently changed. Phase
1 preserves `dsh-tui-mainline-v3` as current implemented truth and declares a
separate `dsh-tui-v4` target:

```text
TuiExecutableOutputIn05ClosedRegionLeaves
  -> TuiExecutableOutputIn06OrderedAppFrameTree
  -> TuiExecutableOutputIn07GenericPrimitiveRealized
  -> TuiExecutableOutputOut08TerminalFrame
```

All v4 edges are pending in Phase 1. Phase 2 activates the chain in one change
set and deletes the replaced v3 05/06 composition path after dependency proof.

The error-node semantics and downstream startup/process-exit projection stay
the same, but the first error edge must change atomically with the success
path:

```text
TuiErrorOut01CompositionFailure
  -> app-shell routeCompositionFailureToTerminalFailure
  -> TuiTerminalLifecycle.fail(Error with original cause)
  -> TuiErrorOut02TerminalFailure
  -> TuiErrorIn03StartupOutcome
  -> TuiErrorOut04ProcessExit
```

Phase 2 deletes lifecycle `renderWithCompose`; the old and new first-edge
routes may never be active together. The terminal failure state, restore, and
failed transition remain lifecycle-owned.

Generic primitive realization has its own typed source because terminal-ui,
not app-container, owns that operation:

```text
TuiRealizationErrorOut01PrimitiveFailure
  -> terminal_primitive_realization_failure_chain
  -> app-shell routeGenericRealizationFailureToTerminalFailure
  -> TuiTerminalLifecycle.fail(Error with original cause)
  -> TuiErrorOut02TerminalFailure
  -> inherited StartupOutcome and ProcessExit tail
```

Composition failure stops before realizer invocation. Realization failure stops
before mount. The two source resources cannot alias or project through one
another; both reuse only the downstream lifecycle failure tail.

## Phase 1 exit

- Contracts, v4 manifest, resource/function/mainline/module/verification maps,
  test design, Markdown/HTML review surfaces, verifier, and red tests agree.
- v3 remains active; v4 and the four target gates remain pending:
  `app_container_unique_composition_owner`,
  `terminal_lifecycle_pure_carrier`, `terminal_viewport_bootstrap`, and
  `executable_frame_error_chain_e2e`.
- Activating `terminal_lifecycle_pure_carrier` against current v3 must fail on
  layout, slot/placement reconstruction, fixed region assembly, and row budget.
- Activating `terminal_viewport_bootstrap` against current v3 must expose
  width/row defaults, rows loss, direct validator/store bypass, nested pair
  mutability, first-compose-before-viewport, and pending runtime bindings.
- A v4 shortcut or duplicate frame builder must fail.
- Missing, aliased, or incomplete generic-realization error bindings fail;
  activating their runtime gate against v3 reports pending source and routers.
- Pinned AppSDK bootstrap, `pnpm run check`, affected builds, runtime build,
  clean runtime evidence required by the phase, and `git diff --check` pass.
- Candidate commit is reviewed by DSH with provider/model omitted. Findings are
  fixed and re-reviewed, up to five rounds.
- Unchanged-source effectiveness replay and remote main receipt complete before
  Phase 2 begins from a new clean worktree.

## Phase 2 exit

- app-container produces and validates the only executable ordered frame tree.
- Full `{ columns, rows }` reaches app-container; rows drive transcript capacity.
- Safe and throwing composition faces share one builder/validator.
- lifecycle contains no layout/slot/placement branch, fixed application title,
  fixed region assembler, business status/footer logic, or `rows - ... - 6`.
- Metadata-only v2, old chrome placement reconstruction, old helpers, duplicate
  DTOs, and dead v3 05/06 bindings are physically removed.
- Positive/negative suites, typecheck, affected builds, runtime boundaries,
  clean install, default/compact installed PTY, resize, failure-chain sample,
  same-version online/dual-client sample, and structural visual confirmation
  bind to the exact candidate tree/artifact.
- DSH review, effectiveness replay, delivery push, and remote receipt pass.

## Out of scope

- Converting five chrome producers into effect-owned Cordis plugins.
- Moving logic source capability ownership.
- Implementing the unique invalidation owner.
- Splitting slash command, session switch, overlay/focus, composer, or
  status/footer functional plugins.
- Provider, transport, Session, WebUI, deepseek-harness, AppSDK-version, visual
  polish, Active promotion, or Protected freeze changes.

## Fixed phase loop

```text
refresh claim/worktree
  -> edit
  -> boundary audit
  -> paired tests
  -> typecheck/build
  -> clean install/restart/live sample
  -> candidate commit
  -> integrate current origin/main and reverify
  -> DSH review
  -> fix and repeat when needed
  -> unchanged-source effectiveness
  -> delivery commit/push
  -> remote main receipt
```

Before every commit, inspect both `git diff --cached --stat` and
`git diff --cached --name-status`. Before push, prove the pushed commit equals
local HEAD. A review PASS becomes stale after any source, test, build, or runtime
configuration change.
