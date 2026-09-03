# TUI Display Control Lifecycle

Status: executable design.
Owner: `dsh-tui::display-control`.

## 1. Responsibility split

The terminal UI is assembled from display controls. A display control is a
composition of independent layers, not one plugin that mixes responsibilities.

```text
semantic truth        presentation / session / transport
        |
        v
logic control         logic-controls (one reducer per control)
        |
        v
display lifecycle     display-control (persistent/live state, timeout)
        |
        v
display projection    tui-logo / tui-connection / tui-session /
                      tui-status / tui-execution / terminal-ui
        |
        v
terminal renderer     terminal-ui -> Ink
        |
        v
layout                app-container
```

Each display control owns:

- `controlId` and a closed `sourceKind`
- persistent presentation data
- optional live presentation data with timeout
- an immutable projection consumed by renderers

The display-control module owns no business parsing and no renderer. It owns
the display lifecycle state machine only.

## 2. Lifecycle states

```text
               activate persistent
          ----------------------------
          |                          |
          v                          v
      detached                  persistent
          ^                          |
          |               live event / timeout
          |                          v
          +--------- live <----------+
                        |
                        +-- timeout expired
                            |
                            v
                       persistent
```

`detached` means the display control is not mounted.

`persistent` means the current projection is the durable baseline. Live events
must not overwrite this baseline.

`live` means a temporary projection is visible. The display lifecycle records
the exact timeout; after expiry the control returns to its persistent
projection automatically.

## 3. Lifecycle contract

```ts
export type TuiDisplayControlMode = 'detached' | 'persistent' | 'live'

export interface TuiDisplayControlState {
  readonly mode: TuiDisplayControlMode
  readonly revision: number
  readonly lastTransitionAt: number
  readonly expiresAt?: number
  readonly sourceRevision?: number
}

export interface TuiDisplayControlLifecycle {
  attach(): TuiDisplayControlState
  setPersistent(sourceRevision: number): TuiDisplayControlState
  showLive(sourceRevision: number, timeoutMs: number): TuiDisplayControlState
  dismissLive(): TuiDisplayControlState
  touch(sourceRevision: number, timeoutMs: number): TuiDisplayControlState
  state(): TuiDisplayControlState
  subscribe(listener: (state: TuiDisplayControlState) => void): () => void
  dispose(): void
}
```

`showLive` starts the timeout. `touch` refreshes an existing live display
without changing its source. Timeout is owned by display-control; plugins must
not manage their own timers.

## 4. Ownership and forbidden paths

- `display-control` owns the lifecycle state machine, timeout scheduling, and
  the public lifecycle face.
- Display plugins consume the lifecycle face and produce display models.
- `app-container` consumes display models only; it never schedules timeouts.
- Renderers never consume raw lifecycle state.
- Control fields never enter business payloads.
