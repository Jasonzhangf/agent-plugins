# Multi-Key Pi-AI Replacement Review Surface

Status: design pending approval

Canonical design: [goal plan](../goals/dsh-multikey-provider-plan.md)

Detailed design: [detailed design](../../outputs/dsh-multikey-provider-detailed-design.md)

Machine lifecycle: [lifecycle](../architecture/lifecycle.json)

Composition: [composition manifest](../architecture/composition-manifest.json)

Boundaries: [resource registry](../architecture/resource-registry.json), [module registry](../architecture/module-registry.json)

Code bindings: [function map](../architecture/function-map.json), [mainline call map](../architecture/mainline-call-map.json)

Evidence: [test design](../architecture/test-design.md), [verification map](../architecture/verification-map.json)

```mermaid
flowchart LR
  Base[official base/web bundles] --> Disable[exact-name disable official provider + Models]
  Disable --> Insert[insert llm-pi-ai-multikey]
  Insert --> Apply[replacement host apply]
  Insert --> Models[replacement client: section id models]
  Apply --> Profiles[official-compatible profiles]
  Profiles --> Pool[key pool descriptors]
  Request[GenerateOptions] --> Snapshot[immutable provider snapshot]
  Pool --> Select[key selection + health]
  Snapshot --> Select
  Select --> Credential[credential resolve]
  Credential --> Wire[pi-ai outbound attempt]
  Wire --> Commit{business output started?}
  Commit -->|no + key-specific error| Select
  Commit -->|yes or final| Response[unchanged StreamChunk output]
  Models --> Control[loopback probe + pool mutations]
  Control --> Select
  Select --> Health[redacted health view]
```

## Approval Checklist

- Official provider and Models packages stay installed; their exact existing
  entries are disabled and the independent replacement entry is inserted.
- Patch `name` values equal target package names; no design treats them as
  replacement values.
- The replacement owns the same existing routes and registers no new route.
- `apiKeyEnv` remains the official Models page's primary key; `apiKeyPool`
  contains alternates only.
- Key advance is limited to credential/account errors before business output.
- Harness retry remains the only request-level retry owner.
- Control/secret resources do not enter request, response, metadata, session, or
  logs.
- The replacement client owns the original Models section and all alternate-key
  add/rotate/status/copy-ref/enable/probe controls; no Plugins-only duplicate
  editor exists.
- Removing the bundle plus restarting DSH restores official provider and Models
  owners; hot reload alone is not approval evidence.
- Install and restore gates prove dump-config, route owner, namespace owner,
  Models owner, client boot graph, real provider call, and settings operation.
- Registry status remains `design` until real symbols and gates are implemented.
