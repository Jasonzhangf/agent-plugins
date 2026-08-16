# Multi-Key Provider Test Design

Status: design pending approval

## Lifecycle

1. Install package into a released DSH profile.
2. Keep official `llm-pi-ai` active; mount plugin host and replacement Models client.
3. Validate `multikey-provider` settings and compile immutable pool profiles.
4. Capture one official public backend adapter per pool without registry or namespace side effects.
5. Register only external pool routes.
6. Select and resolve one key per attempt; advance only on allowed pre-business failures.
7. Manage pool config, health, probe, and secrets through separate admin/control/secret planes.
8. Remove bundle, restart, and prove official Provider and Models restoration.

## White-Box Tests

- Config positive: catalog source, custom source, primary plus alternates, defaults.
- Config negative: empty/colliding/reserved route, invalid source, duplicate id/ref,
  disabled-all, invalid priority/weight/attempt/health, unserviceable custom profile.
- Capture positive: one expected backend route and adapter from public official apply.
- Capture negative: zero/multiple/unexpected registration, real registry/directory/
  discovery/settings effects attempted by facade.
- Selection: deterministic priority and weighted distribution with injected random.
- Health: success, auth immediate open, quota threshold, cooldown trial, concurrent
  trial exclusion, changed ref drops old health.
- Stream positive: first key success; pre-output invalid-to-valid failover; usage
  and business chunks preserved.
- Stream negative: no switch after text/tool output; no switch for abort,
  invalid request/model/content, context, server, timeout, transport, unknown;
  no attempt beyond max; no eligible key fails explicitly.
- Credential: exact ref resolution, named miss, no ambient fallback for a named ref,
  value scoped to one async attempt.
- Control: loopback exact-key probe and redacted health; remote caller rejected.
- Secret: explicit gesture and exact configured ref only; timeout/blur/route/unmount
  clearing; no secret in settings, ordinary RPC, health, logs, errors, snapshots.
- Client: official-wire rows, pool row discrimination by namespace, create/edit,
  alternate add/rotate/enable/remove, priority/weighted, probe, reveal/copy,
  credential-write then settings-conflict orphan report.

## Module Black-Box Tests

- Public entrypoint capture works against installed rc.6 compiled artifacts.
- Catalog backend inherits official endpoint/protocol/models.
- Custom endpoint accepts explicit protocol/base URL/models.
- External route metadata and model provider ids are remapped to pool route.
- Plugin route registration collision is atomic and leaves existing owners intact.
- Settings HMR atomically replaces only plugin routes and preserves in-flight snapshot.
- Models section has one owner and normal official Provider rows remain manageable.

## Project Black-Box Tests

- Architecture gate: JSON parse, resource/function/mainline/lifecycle bijection,
  source ownership, real import graph, declared call symbols, CI/prebuild wiring.
- Composition: official provider absent from patch; exact official Models name guard;
  plugin insert tuple; package identity.
- Loader/HMR/wire/browser E2E on installed Web profile.
- Secret canary scan across logs, screenshots, build output, tarball, Git diff.
- Real catalog API-key Provider: single key, probe, invalid-to-valid failover.
- Real custom endpoint Provider: single key, probe, invalid-to-valid failover.
- OpenCode Go fixture: endpoint `https://opencode.ai/zen/go/v1`, only
  `deepseek-v4-flash`, real call, probe, failover.
- With two valid independent keys: real priority and weighted assignment. If
  credentials are unavailable, report this gate incomplete; mocks do not satisfy it.
- Restore: remove bundle, exact restart, dump-config, plugin resources absent,
  official Provider/model call and official Models edit pass.

## Positive/Negative Risk Locks

Positive tests prove valid catalog/custom configuration reaches the correct
backend and health/key policy advances only when permitted. Negative tests
prove the plugin cannot take official routes, leak control/secret state, replay
after business output, treat non-account failures as key failures, or claim
restoration without restart.

## Known External Gates

Live distribution requires two independent valid credentials. Browser E2E
requires a runnable Web profile. DSH Review requires DSH MCP availability and
`opencode-go/deepseek-v4-flash`. Any missing external gate remains explicitly
incomplete.
