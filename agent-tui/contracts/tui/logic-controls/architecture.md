# Logic Controls Plugin Family

`logic-controls` is a standalone agent-tui plugin family. It is not part of
`component-registry`, and it does not own a renderer. The family owns the
Cordis lifecycle registry and seven independently installable plugins:

```text
tui.logic.input
tui.logic.status
tui.logic.connection
tui.logic.execution
tui.logic.session
tui.logic.slash-command
tui.logic.logo
```

Each plugin accepts typed control events and emits a renderer-neutral typed
projection. The renderer consumes the projection later through the foundation
renderer seam. No plugin imports Ink, an agent implementation, transport
frames, or business request/response payloads.

Slash command syntax and command admission are owned by the standalone
`agent-tui::slash-command-plugin`. The app-event-bus only validates and carries
the terminal command intent; the plugin rejects names outside its explicit
registry and arguments outside each command schema. The plugin emits a closed
typed command intent without a raw line; startup reconstructs only that
admitted command for the Host session action. It never executes an agent
action or accepts deployment-defined strings implicitly.

## Ownership

The machine-readable ownership, resource, function, adjacent-edge, and gate
contract is [logic-controls.architecture.json](./logic-controls.architecture.json).
The family owns only `playground/experiments/logic-controls/**`, its contract,
tests, and build entrypoint. Renderer registration remains owned by
`component-registry`; app-shell is the composition owner for manifest-bound
source capabilities and does not move plugin state into business payloads.

The source modules emit typed side-channel facts into the logic-control
registry through a manifest-bound `LogicControlSourceCapability`; the raw
registry dispatch path is private to that capability. A capability can emit
only the control whose `source_resource` matches its manifest binding, and its
Cordis owner disposal invalidates it. They do not reconstruct control state
from business payloads. The
registry's error result is a typed error projection and never enters a business
request or response payload. Every public registry failure, including duplicate
registration and projection of an unavailable control, is recorded through the
registry error sequence before it is rethrown.

## Verification

The minimum implementation gate is:

```text
pnpm run test:logic-controls
pnpm run build:logic-controls
pnpm run typecheck
pnpm run check:runtime-boundaries
```

The seven plugins must be independently installable and independently removed
when their Cordis owner unloads. A renderer or app composition test belongs to
the next stage and must not be added to this foundation logic-control gate.
