# Multi-Key Provider Test Design

Status: active

## Lifecycle

The plugin keeps the official provider and Models entries installed, inserts
the independent entry universally, and disables only the official Models
client entry by exact name in the installed Web profile,
`dsh-multikey-provider` entry, compiles `multikey-provider.providers` pool
profiles, registers only pool routes, selects attempt-local credentials,
delegates through the independent pi-ai-backed adapter path, and renders the
Models page with pool fields inside the selected pool provider editor.
Removal plus restart restores both official entries.

## White-Box Pairs

- Config positive: a valid catalog `sourceProvider` inherits the pi-ai
  endpoint/protocol/models; a valid custom endpoint compiles with explicit
  api/baseURL/models. Negative: invalid key ids, refs, weights, priorities,
  duplicate refs, no enabled key, empty source, or `multikey/*` route fail
  before route registration.
- Adapter positive: explicit auth/quota/rate-limit failure before business
  output selects the next eligible key. Negative: once text/tool output starts,
  no second credential is resolved.
- Pool policy positive: priority chooses only the lowest available priority
  tier and weights ties; weighted mode uses all eligible keys by weight.
  `AUTH`/`INVALID_CREDENTIAL` opens a one-hour probe-required cooldown and a
  successful exact-key probe restores eligibility. Negative: cooldown expiry
  alone never restores a key, and a failed probe never re-enters candidates.
- Error positive: final key-specific failure remains the original terminal
  outcome. Negative: abort, request/model/content, context, server, timeout,
  transport, and unknown failures never switch keys.
- Payload positive: caller-visible `GenerateOptions`, messages, metadata,
  chunks, replay state, and usage are unchanged. Negative: static gate and
  tests reject key id, attempt, health, selection, probe, or credential value
  in business payloads.
- Credential positive: a value lives only in one attempt scope. Negative: it is
  absent from settings, logs, errors, control responses, snapshots, and chunks.
- Models credential-save positive: alternate-key add writes `settings.mutate`
  before `credentials.set`, and a successful add completes both writes. Negative:
  settings failure makes no credential call; credential failure leaves a typed
  pending state and retry calls only `credentials.set`, without replaying the
  settings mutation or placing the value in settings.
- Composition positive: official provider stays active and unchanged; plugin
  owns only `multikey-provider`. Negative: registering official routes or
  `llm-pi-ai` namespace fails loudly.

## Official Parity

- The official Provider entry remains active and owns its original routes and
  `llm-pi-ai` namespace.
- Pool routes are plugin-owned and visible in the global LLM provider list.
- Catalog and custom pool routes use the same pi-ai catalog, reasoning,
  attachments, replay, timeout, abort, retry policy, dynamic settings, and
  stream output as the official path.
- Models page renders official rows unchanged; pool rows add alternate-key and
  policy fields only inside an opened configured pool editor.

## Exposure Tests

- Positive: a configured pool provider appears in the existing Models row list;
  its existing editor shows primary key plus alternate key/policy fields.
- Negative: an unconfigured pool route is not rendered as a configured row and
  exposes no pool controls; it appears only in the existing Add provider
  selector until selected and saved.
- Negative: no new page, nav item, standalone card, Plugins editor, duplicate
  Models section, `multikey/*` route, or `llm/stream` hook exists.

## Composition And Restore

- Install positive: dump-config shows official `llm-pi-ai` active, official
  Models client disabled, and `multikey-provider` active; official and pool
  route owner counts are each one; namespaces are distinct.
- Headless positive: dump-config shows official `llm-pi-ai` and
  `multikey-provider` active with no skipped-patch warning and no Models entry.
- Install negative: a wrong target `name` is rejected by the fixture/gate and
  duplicate ownership fails loudly.
- Restore positive: remove bundle, exact service/PID restart, official entries
  active, plugin absent, original provider call and Models write succeed.
- Restore negative: hot reload alone is never accepted as restoration evidence.

## Live Samples

- OpenCode Go uses only `opencode-go/deepseek-v4-flash`.
- One valid primary key proves normal single-key parity.
- A controlled invalid alternate plus valid key proves approved pre-output
  switching and the inverse no-switch classifications.
- Browser screenshots at desktop and mobile prove official layout, configured
  row/add selector behavior, editor placement, and no overlap.

Fixtures are contracts only. They do not substitute for install, restart,
browser, provider, or restore evidence.
