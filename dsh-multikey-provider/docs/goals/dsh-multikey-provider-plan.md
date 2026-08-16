# Multi-Key Pi-AI Replacement Plan

Status: design pending approval

## Goal

Ship an independent package, `dsh-llm-pi-ai-multikey`, that replaces the
runtime implementation of the existing profile entry `id: llm-pi-ai` through a
later configuration patch. The official `@deepseek-ai/dsh-llm-pi-ai` package
remains installed. Provider routes, model ids, the `llm-pi-ai` settings
namespace, catalog/custom-provider behavior, discovery, and existing single-key
configuration stay unchanged.

The repository keeps the existing `dsh-multikey-provider/` directory only as
the authoring location for this issue. Package identity comes from
`package.json`, which must become `dsh-llm-pi-ai-multikey` before any active
registry or package gate can pass. The old `multikey/<pool>` implementation is
not a second package or compatibility path; implementation physically replaces
its overlapping files and deletes its legacy-only modules.

## Composition

The package bundle contributes two exact-name disable patches and one inserted
replacement row:

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  disabled: true

- id: ui-settings-models
  name: '@deepseek-ai/dsh-client-ui-settings-models'
  disabled: true

- insert:
    - id: llm-pi-ai-multikey
      name: dsh-llm-pi-ai-multikey
```

Patch `name` is a target-name guard. It must equal the existing entry name; it
cannot rename that entry. The official provider and Models packages stay
installed but their entries are disabled. The inserted replacement package has
one host plugin and one `dsh.client` bundle. Its host plugin registers the
existing provider routes and `llm-pi-ai` settings namespace; its browser plugin
registers the existing `settings.section` id `models`.

The installed state has exactly one active provider route owner, one active
`llm-pi-ai` namespace owner, and one active Models section owner. It never
mounts the official and replacement owners concurrently.

## Configuration

Every official provider profile field remains supported. `apiKeyEnv` remains the
primary credential reference used by the official Models page. An optional
`apiKeyPool` adds alternate credential refs and policy:

```yaml
llm-pi-ai:
  providers:
    opencode-go:
      apiKeyEnv: OPENCODE_GO_API_KEY
      api: openai-completions
      baseURL: https://opencode.ai/zen/go/v1
      models:
        - id: deepseek-v4-flash
      apiKeyPool:
        mode: priority
        primary:
          priority: 0
        keys:
          - id: secondary
            credentialRef: OPENCODE_GO_API_KEY_2
            priority: 10
```

The primary `apiKeyEnv` participates as key id `primary`; optional
`apiKeyPool.primary` configures its enabled/priority/weight policy without
duplicating its credential ref. A profile with no `apiKeyPool` follows official
single-key behavior. A profile with `apiKeyPool` must name `apiKeyEnv`;
provider-native ambient auth is not poolable because it has no credential
identity.

## Invariants

- `GenerateOptions.provider` and `GenerateOptions.model` are unchanged.
- No `multikey/*` provider route is registered.
- Business request/response fields are unchanged and never carry key ids,
  attempts, health, selection, retry, or probe state.
- Credential values exist only between credential resolution and one pi-ai
  outbound attempt; they never enter settings, RPC responses, logs, sessions,
  metadata, chunks, screenshots, or committed artifacts.
- A key-specific failure may advance to another key only before the first
  business content/tool chunk. After business output starts, the original
  terminal result is forwarded and no second attempt starts.
- Caller abort, invalid request/model/content, context overflow, server, timeout,
  and transport failures do not switch keys. Existing Harness retry remains the
  sole owner of request-level retry.
- The replacement package owns the full adapter implementation. It does not
  wrap `llm/stream`, import private files from a Harness checkout, or register a
  duplicate route beside the official adapter.

## Scope

The first release replaces `llm-pi-ai` and the client entry that owns the Models
section. It does not replace `llm-deepseek`, modify Harness, add session events,
change provider/model selection, add a second Models page, or add a Plugins-only
pool editor.

The official Models package has no public child slot inside its provider cards,
and its public client entrypoint does not export the registered section value.
The replacement package therefore carries the audited rc.6 Models source
baseline in its own package and adds alternate-key controls under the same
section id. Runtime imports from installed official private files remain
forbidden.
It owns alternate-key add, rotate, status, copy-reference, enable/disable, and
exact-key probe actions. The official package remains installed and is restored
by composition, not modified or deleted.

Stored credential values remain outside settings, model, session, stream, and
business payloads. The editor displays masked state by default. An explicit
reveal/copy gesture may fetch one stored value through a typed, loopback-only
secret control RPC; the browser keeps it only in transient component state and
clears it on timeout, blur, route change, or unmount. The reference remains
separately copyable without revealing the value.

## Restore Contract

Restoration is not accepted from hot reload alone:

1. Remove the replacement bundle/patch from the profile.
2. Restart DSH using the exact service or PID-scoped procedure.
3. Dump effective config and prove official `llm-pi-ai` and
   `ui-settings-models` are active.
4. Prove `llm-pi-ai-multikey` is absent from host and client boot graphs.
5. Call an original provider/model and open the Models section successfully.

## Approval Gates

Before implementation:

- resource, module, function, mainline, lifecycle, and verification maps are
  marked `design` and reviewed against official source;
- `node docs/architecture/verify-design.mjs` passes while registries remain in
  intentional `design`/`binding-pending` state, and the repository-level
  `dsh-multikey-provider-design` workflow runs the same gate on every design
  change;
- the module registry inventories every old source path as replace or delete;
  activation fails while a deleted path, legacy route/namespace/RPC semantic,
  wrong package name, unowned source file, or undeclared import edge remains;
- the bundle replacement behavior, schema compatibility, failover boundary,
  and UI ownership are explicitly approved;
- source-baseline composition is locked: the audited rc.6 provider and Models
  source is carried in the independent package, runtime never imports installed
  official private files, and duplicate route/section or stream hooks are forbidden;
- composition tests prove exact target-name guards, official-disabled plus
  replacement-active install state, and unique route/namespace/Models owners;
- restore tests remove the bundle, restart DSH, prove official-active plus
  replacement-absent state, and replay original provider/model/settings paths;
- the design gate also proves that the on-disk `cordis.patch.yml` and
  `package.json` match the declared composition, and that the design CI
  workflow re-runs the gate when either file changes;
- no runtime source is changed before approval.

After approval, implementation proceeds red tests first, then focused checks,
pack, Loader/HMR replacement smoke, real catalog/custom calls, installed profile
restart, browser smoke, live provider replay, secret scan, DSH Review, precise
commit, push, and PR.
