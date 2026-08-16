# Test Design

Status: design pending approval

## Lifecycle

1. Base/Web bundles insert official provider and Models rows. The replacement
   bundle exact-name targets and disables both rows, then inserts one independent
   `llm-pi-ai-multikey` row whose package has host and client faces.
2. Official-compatible settings resolve into one immutable provider snapshot;
   optional `apiKeyPool` compiles into credential descriptors only.
3. One request captures provider, model, profile, pool descriptor, and runtime
   health before credential resolution.
4. One eligible key is selected and resolved only for one outbound attempt.
5. A key-specific terminal failure before business output may advance to one
   untried eligible key within `maxAttempts`.
6. First business content/tool output commits the attempt. Any later failure is
   forwarded unchanged and cannot switch keys.
7. Success/failure updates process-local health. Caller abort does not update
   health.
8. The replacement client owns the original Models section id and alternate-key
   add/rotate/status/copy-ref/enable/probe operations.
9. Probe addresses an exact route/key and returns only redacted control facts.
10. Removing the replacement bundle and restarting DSH remounts the official
    provider and Models entries while preserving the official settings document.

## Paired Tests

- Composition positive: exact existing names match, official provider and Models
  entries are disabled, replacement entry is active, and both official packages
  remain installed. The install dump-config fixture is
  `docs/architecture/fixtures/installed-profile.dump-config.json`. Negative: a
  wrong target `name` is rejected by the fixture, there is no attempt to rename
  an existing row, no `multikey/*` route appears, and official/replacement
  exclusive owners are never active together.
- Owner uniqueness positive: retained routes, `llm-pi-ai` namespace, and Models
  section id `models` each have exactly one replacement owner after install.
  The gate records counts for all three resources, not just presence. Negative:
  duplicate provider route, namespace, Models id, or both client bundles in the
  boot graph fails the gate.
- Config positive: every official profile fixture remains serviceable; primary
  `apiKeyEnv` plus its policy and alternates resolves detached descriptors.
  Negative: pool without primary, duplicate id/ref, alternate `primary`, no
  enabled key, invalid ref/weight/priority/attempt/health settings reject before
  runtime state changes.
- Single-key positive: no `apiKeyPool` matches official route/model/catalog,
  custom provider, discovery, attachments, reasoning, replay, timeout, dynamic
  key rotation, and retry-policy behavior. Negative: named missing key still
  fails loud and never uses unrelated ambient auth.
- Public-entrypoint positive: the host composes the official
  `@deepseek-ai/dsh-llm-pi-ai` public adapter/config entrypoint; the client
  reimplements Models on public wire contracts. Negative: any official
  `src/*` import, official client bundle import, copied official source
  module, duplicate route/Models registration, or `llm/stream` hook fails the
  architecture gate.
- Selection positive: deterministic priority and weighted sequences; cooldown
  trial and success recovery. Negative: disabled/open/already-tried keys are
  excluded, concurrent trial reservation is unique, no eligible key fails loud.
- Stream positive: key-specific pre-output failure switches once and forwards
  the successful attempt's chunks unchanged. Negative: no switch after text,
  reasoning, or tool output; no switch for abort, invalid request, context,
  unknown model, server, timeout, transport, empty response, or unknown failure;
  attempts never cycle.
- Payload isolation positive: request/options/messages retain official values
  and identity where official code does. Negative: architecture gate rejects
  key/health/attempt/probe assignments to request, metadata, session, and chunks.
- Health positive: auth opens immediately; quota/rate failures open at threshold;
  success resets; matching descriptors retain state across settings refresh.
  Negative: transport/request/abort do not mutate health; changed credential ref
  gets fresh health.
- Control/UI positive: the replacement client registers section id `models`;
  path-scoped alternate-key writes preserve official provider fields; add,
  rotate, masked status, explicit reveal/copy-value/copy-ref, enable/disable,
  and exact-key probe work. Negative: no Plugins-only duplicate editor;
  reveal rejects non-loopback, non-gesture, unknown, and disabled references;
  revealed values never enter shared stores, logs, settings, business payloads,
  health/probe responses, or errors and are cleared on every declared lifetime
  boundary; failed settings revision/validation is not
  reported as success, non-loopback request rejects, and responses/logs/build
  artifacts contain no key.
- Restore positive: remove bundle and patch, restart DSH, then use
  `docs/architecture/fixtures/restored-profile.dump-config.json`, registry,
  boot graph, provider call, and Models edit to prove official ownership.
  Negative: hot reload alone is not accepted, replacement entries must be
  absent, and official and replacement exclusive owners are never mounted
  concurrently.

## Project Black-Box

- Target active `pnpm run check`: architecture, typecheck, lint, tests,
  coverage, and build. These scripts are implementation gates; the current
  design phase runs only `verify-design.mjs` through its repository workflow.
- Installed artifact provenance: both CI workflows install
  `dsh-multikey-provider` with `pnpm install --frozen-lockfile` before the
  design gate; `verify-design.mjs` hashes the installed `package.json` and
  compiled lib artifacts for both rc.6 packages and rejects lockfile drift.
- `pnpm pack`: package identity is `dsh-llm-pi-ai-multikey`; tarball contents
  carry upstream provenance and contain no secrets or stale
  `multikey/<pool>`, `multikey-provider`, or `/multikey/api` artifacts.
- Loader/HMR: fixture proves `name` is an exact target guard; installed effective
  config disables official rows and activates the inserted replacement row.
- Web: one Models section renders; primary key and official provider controls
  remain, and alternate add/rotate/status/reveal/copy-value/copy-ref/disable/
  probe works at desktop and mobile sizes without overlap.
- Live catalog API-key provider: single key, invalid-to-valid failover, probe.
- Live custom endpoint provider: same route/model before and after replacement.
- OpenCode Go: only `deepseek-v4-flash`, using the configured endpoint and
  credential refs; single key, invalid-to-valid failover, probe.
- Real weighted/priority distribution requires two valid independent keys. If
  unavailable, the gate remains explicitly unmet; mocks do not substitute.
- Installed web profile: pack/install, restart, dump effective config, unique
  route/namespace/Models owners, replacement-only client boot graph, browser
  smoke, online model call, and runtime package version matching HEAD.
- Restored web profile: remove bundle, exact service/PID restart, dump official
  active/replacement absent config, official-only client graph, original provider
  call, and original Models settings edit.
- The exact install/restore dump-config entry assertions and owner-count
  assertions are machine-readable in `docs/architecture/composition-manifest.json`
  and `docs/architecture/verification-map.json`. The fixture files are design
  contracts, not runtime evidence; real dump-config output is required during
  installation and restoration.
- Official Models parity snapshot: before implementation closes, run identical
  public-wire fixtures through the installed official Models client and the
  replacement Models client and assert the same provider list, custom-provider
  create, route/model/baseURL/protocol edits, `apiKeyEnv` credential write,
  settings revision, and pushed invalidation outcomes. Any divergence must be
  explicit, not silent.
- Final DSH Review runs only after all applicable install/live gates pass.

## Design-Phase Evidence Boundary

No implementation symbol is currently bound to this design. Registry entries
are intentionally `design`/`binding-pending`; current old-route tests are not
evidence for the replacement design.

The design gate reports the complete old-source replace/delete inventory and is
wired into the repository CI workflow. The active gate intentionally remains
red until implementation changes the package identity, physically removes the
listed legacy files, binds every target symbol, and flips all registries to
`active`.

The install/restore dump-config JSON files under
`docs/architecture/fixtures/` are readable design fixtures and gate inputs only.
They do not substitute for real profile dump-config, restart, route/namespace/
Models owner inspection, provider smoke, or Models UI smoke during implementation
verification.
