# DSH Multi-Key Provider Plan

Status: design pending approval

## Goal

Ship `dsh-multikey-provider` as an independent plugin that is installed into a
released DSH profile and manages only that profile's composition and its own
`multikey-provider` settings namespace. It does not modify, replace, disable,
or import source from the installed official provider. The official
`@deepseek-ai/dsh-llm-pi-ai` entry remains active and keeps sole ownership of
its existing routes and `llm-pi-ai` namespace.

The plugin registers only user-configured pool routes. A pool route is a normal
model Provider visible in Models and can use either an installed pi-ai catalog
provider as its backend or a fully declared custom endpoint. OpenCode Go is
only a custom-endpoint live fixture and is always tested with
`deepseek-v4-flash`.

## Installed Composition

The bundle changes the installed profile only through `cordis.patch.yml`:

```yaml
- id: ui-settings-models
  name: '@deepseek-ai/dsh-client-ui-settings-models'
  disabled: true

- insert:
    - id: multikey-provider
      name: dsh-multikey-provider
```

The official Provider row is untouched. The official Models package remains
installed; only its client entry is disabled because rc.6 has no provider-card
extension slot. The plugin client registers the same `settings.section` id
`models`, renders all installed Provider rows from public wire contracts, and
adds pool management for rows whose `settingsNs` is `multikey-provider`.

Removing this bundle and restarting DSH restores the official Models client.
No official package is deleted or rewritten.

## Pool Configuration

The plugin owns one namespace and one profile shape:

```yaml
multikey-provider:
  providers:
    opencode-go-pool:
      sourceProvider: opencode-go
      displayName: OpenCode Go Pool
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

The `providers` key is the externally visible pool route. `sourceProvider`
selects the backend identity used by the public official pi-ai adapter. It may
name an installed catalog API-key provider, allowing endpoint/protocol/catalog
defaults, or a custom backend completed by `api`, `baseURL`, and `models`.
`apiKeyEnv` is the primary credential reference; `apiKeyPool` adds policy and
alternate references.

Pool route ids must be non-empty and unique, may not equal any route already
owned by another adapter, and may not use the reserved `multikey/` prefix.
Conflicts fail the settings write or registration explicitly; the plugin never
replaces an existing route.

## Runtime Boundary

For each configured pool, the plugin invokes the installed public
`@deepseek-ai/dsh-llm-pi-ai` entrypoint in an isolated capture context. That
context captures the official adapter for the backend route while suppressing
its registry, directory, discovery, and `llm-pi-ai` settings side effects. The
plugin then registers one external pool route through its own adapter.

This is runtime composition of an installed public package, not a Harness
checkout dependency. Official packages are peer and development contracts,
never plugin dependencies. No official `src/*` file is copied or imported.

## Request And Error Rules

- `GenerateOptions` enters with the external pool route and leaves the plugin
  boundary with only its provider field mapped to the backend route.
- Key selection, attempts, health, probe, and credential references stay in
  typed control resources; no such field enters request metadata, chunks,
  sessions, logs, or errors.
- Credential values exist only while resolving and executing one backend
  attempt.
- Only pre-business `AUTH`, `QUOTA`, `RATE_LIMIT`, `MISSING_CREDENTIAL`, and
  `INVALID_CREDENTIAL` failures may advance to another key.
- After the first business content/tool chunk, no key switch is permitted.
- Abort, request/model/content/context, server, timeout, transport, and unknown
  failures never switch keys.
- DSH request retry remains the only request-level retry owner.

## Client And Control Planes

The replacement Models section uses only public `llm.providers`,
`settings.describe/mutate`, and `credentials.describe/set` wire contracts. It
preserves normal Provider management and adds pool create/edit, priority or
weighted policy, alternate add/rotate/enable/remove, redacted health, exact-key
probe, copy-reference, and explicit reveal/copy.

Probe and health use a loopback-only typed control RPC. Secret reveal uses a
separate loopback-only secret RPC and requires an explicit user gesture. Secret
responses are transient component state and clear on timeout, blur, route
change, and unmount. Admin/configuration writes, control responses, secret
responses, and business traffic are separate resources.

## Restore Contract

1. Remove the plugin bundle from the target profile.
2. Restart DSH by exact service or PID-scoped operation.
3. Confirm `multikey-provider` entry, routes, namespace, RPCs, and client bundle
   are absent.
4. Confirm official `llm-pi-ai` and `ui-settings-models` entries are active.
5. Replay an official Provider call and open/edit the official Models page.

Hot reload alone is not restore evidence.

## Gates

Before implementation, resource/module/function/mainline/verification maps,
test design, lifecycle manifest, wiki, composition manifest, package identity,
and exact patch shape must pass the design gate and read-only DSH Review.

After approval: red tests first, implementation, architecture/import/payload
gates, unit and paired negative tests, coverage, build, pack, loader/HMR/wire,
installed profile restart, browser E2E, real catalog and custom Providers,
OpenCode Go live calls, secret canary scans, DSH Review, precise commit, push,
and Pull Request.
