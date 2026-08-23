# TUI App Container

Current runtime: `dsh-tui-mainline-v3`, implemented.

Target runtime: `dsh-tui-v4`, design/pending. Phase 1 does not claim that the
runtime owner migration is complete.

## Owner and boundary

`tui.app.container` is the declared owner of whole-screen App UI composition.
The current v3 source has not reached that target: it attaches layout, slot,
and chrome-node metadata while terminal-lifecycle still groups chrome,
constructs fixed application regions, chooses layout order, and computes the
transcript row budget. The v4 target makes the declaration true in source. The
container does not read Session, transport, agent, or logic-control services
and does not dispatch business actions.

The composition chain is:

```text
typed presentation/component projections
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

The live metadata-only `tui.app-container.v2` contract declares these slots:

`header.logo`, `header.connection`, `header.session`, `header.status`,
`transcript`, `execution`, `composer`, `overlay`, and `footer`.

The v4 contract retains the eight required projections and optional overlay.
Footer explicitly carries the current Session/status block and footer marker;
there is no undeclared standalone status region. Local echoes are transcript
children. Overlay absence means property and node omission, not `null`, an
empty placeholder, or renderer-side guessing.

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

## Current v3 binding

The app-container stage is the `TuiOutputIn06AppContainerFrame` node in the
`dsh-tui-mainline-v3` output chain:

`TuiOutputIn05InkTreeComposed -> TuiOutputIn06AppContainerFrame -> TuiOutputOut07TerminalFrame`

The map declares the middle node for app-container, but live v3 still relies on
terminal-lifecycle to reconstruct the frame from the shell descriptor. These
sentences describe current truth and the known divergence, not target
admission.

## Pending v4 binding

The v3 05/06 nodes are consumed contracts, so their semantics are not rewritten
in place. The pending v4 tail is:

```text
TuiExecutableOutputIn05ClosedRegionLeaves
  -> TuiExecutableOutputIn06OrderedAppFrameTree
  -> TuiExecutableOutputIn07GenericPrimitiveRealized
  -> TuiExecutableOutputOut08TerminalFrame
```

The target frame has exactly `contract`, `publicationRevision`, `viewport`,
and `root`. It contains no layout, slots, chrome placement, chromeNodes, or
metadata. Root order is the layout truth. Its `box | text` union and styles are
closed; every object and children array is recursively frozen; keys are stable
and globally unique; cycles, accessors, symbols, unknown fields, duplicate
keys, invalid viewport, and stale revision fail explicitly.

Phase 2 activates all v4 edges together and physically removes the v3
metadata reconstruction, placement filter/find, fixed region arrays/titles,
`OverlayView`, `ComposerView`, `transcriptCells`, `statusLine`, and lifecycle
row-budget logic. There is no adapter, fallback, feature flag, duplicate DTO,
or dual runtime path.

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

- Phase 1 keeps `app_container_unique_composition_owner` and
  `terminal_lifecycle_pure_carrier`, `terminal_viewport_bootstrap`, and
  `executable_frame_error_chain_e2e` pending while validating their target
  declarations.
- Prematurely activating the carrier gate against v3 must report layout,
  slot/placement reconstruction, fixed region assembly, and fixed row budget.
- A v4 shortcut and a duplicate ordered-tree builder must fail design red
  tests.
- Prematurely activating the viewport gate must report defaults, lost rows,
  direct resize/event-bus bypass, mutable nested viewport, first-compose order,
  and pending bindings.
- Prematurely activating the executable-frame error gate must report its
  pending terminal-ui failure resource and both unbound app-shell routers.
- Design red tests reject a missing, aliased, or truncated generic-realization
  failure binding.
- Phase 2 adds full tree positive/negative tests before activating either
  runtime gate.

Canonical review surfaces:

- `docs/goals/tui-app-container-plan.md`
- `docs/architecture/tui-app-container.html`
- `.appsdk/architecture/tui-v4-app-container-frame.manifest.json`
- `contracts/tui/terminal-ui/terminal-frame-tree.contract.json`
- `contracts/tui/app-shell/terminal-viewport-bootstrap.contract.json`
- `contracts/tui/app-event-bus/validated-terminal-viewport.contract.json`
- `contracts/tui/app-container/ordered-app-frame.contract.json`
