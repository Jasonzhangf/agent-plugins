# agent-tui canonical lifecycle projection

Status: draft/design projection of the `agent-tui-v3` lifecycle. The machine-readable TUI truth remains `contracts/tui/architecture/lifecycle.manifest.json`; this document is explanatory and is not a machine registry. AppSDK governance lock/active records remain local and are not part of this documentation delivery.

## Entry and return path

- Lifecycle: `agent-tui-v3`
- Entry: `TuiInputIn01TerminalIntent`
- Return: `TuiOutputOut07TerminalFrame -> TuiInputIn01TerminalIntent`
- Owner feature: `agent-tui`

## Mainline and ownership

The request chain and response chain are separate. The exact node IDs, node owners, return path, and error chain come from `lifecycle.manifest.json`. No direct input-to-host or raw-event-to-renderer shortcut is permitted. Edge-level runtime binding remains governed by the local project verification surface and is not restated here.

## Error chain

The registered terminal error chain ID and node projection are owned by `contracts/tui/architecture/lifecycle.manifest.json`. Ordered adjacent error edges and their runtime bindings are owned by the local project mainline call map. Terminal failure is restored and projected through the typed startup outcome before the process exit owner maps it to an exit status. A renderer or transport document must not introduce a parallel generic error transition.

## Required lifecycle gates

Gate identity, status, command, and `required_for` scope come from the local project verification map. The manifest `verification_gates` list is only the lifecycle-bound gate reference set, not the exhaustive verification registry. Command and status resolution remains local governance state; this document does not promote any pending gate to active.

## Boundary rules

- Session events remain business truth; terminal state is a projection/control concern.
- Control state never enters business payload or generic metadata.
- Renderers consume typed presentation components, never raw public events.
- The component registry cannot call the host or reconstruct business actions.
- A lifecycle or protocol extension requires one synchronized change to the lifecycle manifest, resource/function/mainline/verification maps, contracts, tests, and CI wiring before it can be documented as active.
