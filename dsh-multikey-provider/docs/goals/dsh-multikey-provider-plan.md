# Multi-Key Provider Additive Plan

Status: active

## Goal

Ship `dsh-multikey-provider` as an independent plugin that adds pooled API-key
routes to a released DSH profile without changing the official Provider. The
official `@deepseek-ai/dsh-llm-pi-ai` entry stays installed and active with its
original routes, model ids, and `llm-pi-ai` settings namespace. The plugin owns
only its own pool routes and the `multikey-provider` settings namespace.

## Composition

The bundle changes the installed profile through `cordis.patch.yml`:

```yaml
- id: ui-settings-models
  name: '@deepseek-ai/dsh-client-ui-settings-models'
  disabled: true

- insert:
    - id: multikey-provider
      name: dsh-multikey-provider
```

There is no patch for `id: llm-pi-ai`. `name` is a target-name guard, not a
rename. The official Provider row remains active. The official Models client is
installed but disabled because rc.6 exposes no provider-card extension slot;
the plugin client registers the same `settings.section` id `models`, renders
all installed Provider rows from public wire contracts, and adds pool
management for rows whose `settingsNs` is `multikey-provider`.

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
selects the backend identity used by the independent adapter. It may name an
installed catalog API-key provider, allowing endpoint/protocol/catalog
defaults, or a custom backend completed by `api`, `baseURL`, and `models`.
`apiKeyEnv` is the primary credential reference; `apiKeyPool` adds policy and
alternate references.

Pool route ids must be non-empty and unique, may not equal any route already
owned by another adapter, and may not use the reserved `multikey/` prefix.
Conflicts fail the settings write or registration explicitly; the plugin never
replaces an existing route.

## Runtime Boundary

For each configured pool, the plugin compiles an independent backend profile
and registers one external pool route through its own adapter. The plugin does
not call or replace the official `apply()` entrypoint, and it does not mutate
the official LLM registry, directory, discovery, or `llm-pi-ai` settings
namespace.

The plugin uses the same pi-ai catalog and public LLM wire contracts as the
official Provider, so catalog and custom endpoints behave identically. Official
packages remain installed peers; no official source file is copied or imported.

## Request And Error Rules

- `GenerateOptions` enters with the external pool route and stays on that route.
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

The Models section uses only public `llm.providers`, `settings.describe/mutate`,
and `credentials.describe/set` wire contracts. It preserves normal Provider
management and adds pool create/edit, priority or weighted policy, alternate
add/rotate/enable/remove, redacted health, exact-key probe, copy-reference, and
explicit reveal/copy.

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

Architecture registries, test design, lifecycle manifest, wiki, composition
manifest, package identity, and exact patch shape must pass the active
architecture gate. After implementation: paired config/failover/error tests,
official-route ownership tests, build, pack, installed profile restart,
live catalog/custom Providers, OpenCode Go live calls, secret canary scans,
DSH Review, precise commit, push, and Pull Request.
