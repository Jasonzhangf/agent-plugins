# TUI App Container

## Owner and boundary

`tui.app.container` is the sole owner of whole-screen App UI composition. It
consumes an immutable `TuiAppViewModel`, a typed chrome projection, and a
layout policy. It does not read Session, transport, agent, or logic-control
services and it does not dispatch business actions.

The composition chain is:

```text
TuiAppViewModel
  -> tui.app.container slots/layout policy
  -> TuiAppContainerFrame
  -> terminal-lifecycle's single Ink renderer
```

`terminal-ui` remains the foundation model-to-Ink-tree seam. The container
wraps that seam with App layout metadata; it does not create a second renderer.

## Slots and policies

The active `tui.app-container.v2` contract declares these slots:

`header.logo`, `header.connection`, `header.session`, `header.status`,
`transcript`, `execution`, `composer`, `overlay`, and `footer`.

The `default` and `compact` policies consume the same ViewModel and differ only
in slot order. A policy switch cannot rebuild or mutate Session, agent,
transport, or logic-control truth.

## Refresh and lifecycle

`refresh()` is a control-side operation. Frame revisions are monotonic at the
container service; stale revisions and disposed containers fail explicitly.
Resize, focus, overlay and terminal restoration remain owned by the existing
shell/focus/lifecycle services. The container only carries their typed display
projection into the selected layout. Contract v2 intentionally removes the
unused refresh `reason` field; refresh is selected by the typed input state and
the lifecycle owner remains responsible for the originating control event.
The typed refresh inputs are the immutable ViewModel revision, viewport width,
scroll offset, and optional layout policy; layout changes use `layout`, while
model changes advance `viewModel.publicationRevision`.

## Lifecycle v3 binding

The app-container stage is the `TuiOutputIn06AppContainerFrame` node in the
`dsh-tui-v3` output chain:

`TuiOutputIn05InkTreeComposed -> TuiOutputIn06AppContainerFrame -> TuiOutputOut07TerminalFrame`

The container plugin owns the middle node and depends only on the terminal-ui
composition face. Startup performs the runtime composition; terminal-lifecycle
consumes the shared shell descriptor extension and remains the sole Ink
instance owner.

## Verification

- `tests/app-container/app-container.spec.ts` covers layout policies, chrome
  separation, invalid input, revision mismatch, refresh, stale frames and
  disposal.
- `test:terminal-ui`, `test:terminal-lifecycle`, `test:app-shell`, runtime
  tests, typecheck, runtime-boundary, build and clean-install gates cover the
  adjacent runtime chain.
- `scripts/pty-smoke.exp` verifies the installed runtime renders the composed
  header/footer and restores the PTY after `/quit`.

The local `.appsdk/**` governance state is not a product artifact and is not
part of the app-container commit.
