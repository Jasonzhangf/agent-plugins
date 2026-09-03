# agent-tui semantic map boundary

This document records how human-readable architecture material relates to the registered machine maps. It does not create a second registry or restate their records. It is explanatory documentation, not a machine-validated canonical document.

## Canonical sources

| Concern | Canonical source |
| --- | --- |
| TUI lifecycle nodes, node owners, return path, and terminal error chain ID/node projection | `contracts/tui/architecture/lifecycle.manifest.json` |
| Ordered adjacent TUI lifecycle and error edges, runtime bindings | local project mainline call map |
| TUI component and transport contracts | `contracts/tui/**` |
| AppSDK governance lock, active selector, resources, and verification | local `.appsdk/**` state; excluded from this delivery |

The `.appsdk` state is local governance truth and is intentionally not part of this documentation-only delivery. It must be validated separately with the pinned beta binary before review. This document does not copy or reinterpret that state.

## Current implementation chain

Lifecycle IDs, node IDs/owners, the declared return path, and the error-chain node projection come from `contracts/tui/architecture/lifecycle.manifest.json`. The request, response, return, and error adjacent edges plus runtime bindings come exclusively from the local project mainline call map. The boundary between the paths is owned by the official host/API contract and is not inferred by this document. Any future foundation control must first identify its existing owner and side channel. It must not be added as a prose-only state axis or embedded in a business payload.

## Documentation rule

Human-readable documents under `contracts/tui/architecture/` explain the registered contracts. They may summarize existing IDs and constraints, but may not introduce new owner names, lifecycle versions, resource IDs, error chains, or verification gates. New semantics land in the canonical contract and maps first, with paired positive/negative tests and CI wiring; documentation is updated in the same change set.
