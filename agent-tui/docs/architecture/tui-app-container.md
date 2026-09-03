# TUI App Container

Current runtime: `dsh-tui-v5`, implemented and active.

Historical runtimes: `dsh-tui-mainline-v3` and `dsh-tui-v4` remain recorded
with their consumed node semantics unchanged; v4 is replaced, not rewritten.

## Owner and boundary

`tui.app.container` is the sole owner of whole-screen App UI composition. It
orders header, transcript, execution, overlay, composer, workspace and footer;
it also projects the transcript width and horizontal gutters. It does not read
Session, transport, agent, raw history, parser internals, terminal output state,
or logic-control services and does not dispatch business actions.

The composition chain is:

```text
official Session history
  -> raw buffer -> presentation -> interpreter -> display buffer -> terminal frame
terminal frame + typed interaction projections
  -> terminal-ui closed body region leaves
typed chrome projections
  -> app-container adjacent side input
closed body leaves + chrome
  -> app-container ordered frame-tree builder
  -> terminal-ui generic primitive realization
  -> terminal-lifecycle mount/rerender carrier
```

`terminal-ui` owns the shared closed primitive contract, region leaf
projection, validation, and generic realization. App-container owns exact
region cardinality, nested order, viewport row allocation, revision/stable-key
validation, and recursive freezing. Terminal-lifecycle owns typed input/resize,
the single Ink instance, mount/rerender/flush, restore, and failure propagation.
App-shell owns the one current validated viewport pair and the first-compose
precondition. No `app-container -> terminal-lifecycle` import is allowed.

## Slots and policies

The chrome registry declares these semantic slots:

`header.logo`, `header.connection`, `header.session`, `header.status`,
`transcript`, `execution`, `composer`, `overlay`, and `footer`.

The active frame contract retains the required projections and optional overlay.
Footer explicitly carries the current Session/status block and footer marker;
there is no undeclared standalone status region. Local echoes are transcript
children. Overlay absence means property and node omission, not `null`, an
empty placeholder, or renderer-side guessing.

The visible root order is `header -> transcript -> execution? -> overlay? ->
composer -> footer`. Header is currently empty; logo is the first stable
transcript preamble. The footer's first row is the connection lamp plus cwd, so
the workspace path is immediately below the composer. Model, thinking effort,
permission, goal and key hints follow it. Cwd and raw Session ID are forbidden
from the transcript/header.

The default and compact policies consume the same ViewModel and differ only in
ordered root children. A policy switch cannot rebuild or mutate Session, agent,
transport, presentation, or logic-control truth.

## Refresh and lifecycle

`refresh()` is a control-side operation. Frame revisions are monotonic at the
container service; stale revisions and disposed containers fail explicitly.
Focus and terminal restoration remain owned by the existing focus/lifecycle
services. Resize is published as typed control, validated as `{columns, rows}`,
and stored atomically before app-container consumes the full viewport. The
container owns row allocation; lifecycle cannot derive transcript capacity or
supply a default row count. Refresh remains a control-side operation and never
enters the business payload or render leaf.

Before the first mount, app-shell installs the app-event subscriber and input
handler; lifecycle enters without mounting, observes real stdout columns and
rows, and publishes `terminal.resize`; app-event-bus validates, freezes, and
synchronously dispatches the exact pair; app-shell stores that same reference;
only then may app-container compose. Later resize follows the identical path.
Raw observation, direct app-shell validation, width-only state, pair copying,
and `80 x 24` defaults are forbidden.

## Historical v3/v4 binding

The v3 05/06 nodes and v4 executable-tail nodes are consumed contracts, so
their semantics are not rewritten in place. v4 completed the app-container
composition-owner cutover and is retained as the source of the active viewport
bootstrap and executable-frame error side chains:

```text
TuiExecutableOutputIn05ClosedRegionLeaves
  -> TuiExecutableOutputIn06OrderedAppFrameTree
  -> TuiExecutableOutputIn07GenericPrimitiveRealized
  -> TuiExecutableOutputOut08TerminalFrame
```

The ordered frame has exactly `contract`, `publicationRevision`, and `root`.
It contains no slots, chrome placement, chromeNodes, or
metadata. Root order is the layout truth. Its `box | text` union and styles are
closed; every object and children array is recursively frozen; keys are stable
and globally unique; cycles, accessors, symbols, unknown fields, duplicate
keys, invalid viewport, and stale revision fail explicitly.

## Active v5 numbered output mainline

v5 replaces the obsolete v3/v4 live transcript prefix without changing either
historical contract:

```text
DshHostOut01PublicHistoryOrFrame
  -> TuiDisplayOutputIn02OfficialHistoryBuffered
  -> TuiDisplayOutputIn03PresentationProjected
  -> TuiDisplayOutputIn04SemanticElementsInterpreted
  -> TuiDisplayOutputIn05AbsoluteRowsReflowed
  -> TuiDisplayOutputIn06TerminalRowsProjected
  -> TuiDisplayOutputIn07ClosedRegionLeaves
  -> TuiDisplayOutputIn08OrderedAppFrameTree
  -> TuiDisplayOutputIn09GenericPrimitiveRealized
  -> TuiDisplayOutputOut10TerminalFrame
```

Terminal output state branches from the projected terminal rows and is consumed
only by terminal-lifecycle for stable scrollback emission. It is not a parser,
display buffer, terminal-ui input, or Session truth. Component registry is not
on the live transcript/region path. There is no adapter, fallback, feature flag,
duplicate DTO, or dual active runtime path.

The composition error node sequence and its downstream startup/process-exit
semantics remain stable. Its first edge does not: Phase 2 moves
`CompositionFailure -> TerminalFailure` from lifecycle `renderWithCompose` to
an app-shell router that creates a real `Error`, preserves the original
`cause`, invokes public `TuiTerminalLifecycle.fail`, and returns before
realization or mount. The subsequent `TerminalFailure -> StartupOutcome ->
ProcessExit` edges remain bound to the existing app-shell owners. The old and
new first-edge routes cannot coexist.

Generic primitive realization has a different source owner. A terminal-ui
realizer failure enters the independent
`terminal_primitive_realization_failure_chain`; app-shell preserves its cause
and routes it to the same public lifecycle `fail` face before mount. It cannot
be projected through `app_composition_failure_chain`, and it cannot bypass the
terminal-failure/startup/process-exit tail.

## Verification

- `check:design` requires exactly one active numbered output lifecycle and
  rejects revival of the component-resolved prefix.
- Every v5 edge binds one adjacent owner function and one real source call;
  shortcut edges are explicit red contracts.
- `app_container_unique_composition_owner`, `terminal_lifecycle_pure_carrier`,
  `terminal_viewport_bootstrap`, and `executable_frame_error_chain_e2e` remain
  active.
- Display-buffer/output tests pair append-only stable-history cases with live,
  no-pending, layout-change and retained-prefix negative controls.
- Delivery additionally requires the freshly installed global binary to prove
  cwd placement, multiple live-to-stable turns, resume/input, terminal-native
  scrollback and current-screen tail behavior.

Canonical review surfaces:

- `docs/goals/tui-app-container-plan.md`
- `docs/architecture/tui-app-container.html`
- `.appsdk/architecture/tui-v4-app-container-frame.manifest.json`
- `.appsdk/architecture/tui-v5-display-pipeline.manifest.json`
- `docs/design/tui-raw-interpreter-display-buffer-design.md`
- `contracts/tui/terminal-ui/terminal-frame-tree.contract.json`
- `contracts/tui/app-shell/terminal-viewport-bootstrap.contract.json`
- `contracts/tui/app-event-bus/validated-terminal-viewport.contract.json`
- `contracts/tui/app-container/ordered-app-frame.contract.json`
