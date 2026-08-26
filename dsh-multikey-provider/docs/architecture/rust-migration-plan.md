# Rust Migration Plan — dsh-multikey-provider

Status: staged migration. Stage 0 (this document) declares the bridge boundary and
the runtime target; stages 1..N land incrementally and each ships behind the same
package contract the TypeScript implementation already meets.

The plugin ships as TypeScript today. Every selection, error classification,
control surface, credential read, and health transition is implemented in TS and
exercised by `pnpm run check` and the live installation evidence in
`scripts/verify-installed-profile.mjs`. The Rust target is a co-located NIF/RPC
shim, not a re-authoring of the plugin's public surface.

## Owner and Allowed Surface

The `rust-migration` feature is owned by the `rust-target` module. The TS
sources remain the runtime of record until a given node is replaced; the gate
that rejects the move is `verify-architecture.mjs` reading both
`module-registry.json` and `function-map.json` and confirming each replacement
node lists exactly one current owner.

```text
feature_id = replacement.rust-migration
owner      = rust-target
owner_module = rust-target
status     = pending
```

The `rust-target` module's `owned_paths` covers the Rust workspace
(`rust/**`), its manifest (`rust/Cargo.toml`), and the bridge interface file
(`rust/bridge/abi.h`). The TS `src/**` tree is **not** in this module's owned
paths; both runtimes coexist, and ownership moves only when a node's
`current_owner` advances to `rust-target` in `function-map.json`.

## Staged Nodes

Each node below names its current TS owner and the Rust target that replaces it.
The boundary contract is the typed JSON message the bridge produces; the wire
shape is identical across runtimes and `payload-isolation` already rejects any
attempt to write control fields into business payloads.

| node_id | current_owner | rust_target | boundary | gates |
| --- | --- | --- | --- | --- |
| `selection` | `key-pool` | `rust/src/selection.rs` | `select_key(state, attempt) -> KeyDecision` | `tests/rust/selection.rs`, runtime equivalence test against `tests/provider/key-pool.test.ts` |
| `error-classify` | `adapter` | `rust/src/error_classify.rs` | `classify_failure(code, kind) -> FailureClass` | `tests/rust/error_classify.rs`, wire equivalence test |
| `health-policy` | `key-pool` | `rust/src/health.rs` | `update_health(state, event) -> Health` | `tests/rust/health.rs` |
| `control` | `control` | `rust/src/control.rs` | `MultiKeyControlState` JSON | `tests/rust/control.rs`, plus the existing `verify-installed-profile` smoke |
| `credential-resolve` | `credential` | `rust/src/credential.rs` | `resolve(ref) -> CredentialHandle` | `tests/rust/credential.rs` |

The bridge itself (`rust/bridge/abi.h`, `rust/src/lib.rs`) is owned by the
`rust-target` module. A future build-time compiler will validate the authoring
registries and emit one deterministic migration manifest plus typed entry
bindings. The runtime entry will consume only that compiled artifact to select
an implementation; it will never read `function-map.json` or any other
authoring registry at runtime.

## Removal Plan

A node is removed from `src/**` only after:

1. `function-map.json` lists the node with `current_owner = rust-target` and
   `status = active`.
2. `pnpm run check` runs the Rust tests alongside the TS tests and they match
   the wire fixture in `docs/architecture/fixtures/`.
3. The live installation evidence in `scripts/verify-installed-profile.mjs`
   calls the bridged node at least once and records the response in
   `.agent-collab/evidence.jsonl`.
4. `verify-architecture.mjs` reads the registries and confirms the node has
   exactly one owner; the gate fails if any TS file still claims the node
   outside of a `pending` entry.

The registry gate is the only authority that releases the TS owner; manual
removal without the gate is rejected by `prebuild` (which runs
`verify:architecture` before any other build step).

## Verification Gates

- `verify-architecture.mjs` runs on every `pnpm run check` and on the CI
  workflow `.github/workflows/dsh-multikey-provider.yml`.
- The CI workflow installs the Rust toolchain (`dtolnay/rust-toolchain@stable`)
  only after the `registry_gate:pass` step, so a registry drift cannot silently
  block the build.
- `tests/rust/*` are part of `pnpm run check` once stage 1 lands; until then the
  absence of `rust/` is itself a registry fact (`rust-target` module has no
  active owned paths under it).

## Out of Scope

The migration does not replace `src/client/**` (UI rendering), the Cordis
composition layer (`cordis.patch.yml`), or the settings/credential TS surface
that the runtime registry expects. Those remain TS.
