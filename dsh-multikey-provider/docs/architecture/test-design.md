# Multi-Key Provider Test Design

Status: design pending automated approval

## Lifecycle

The replacement disables the official provider and Models entries by exact
name, inserts one official-derived entry, resolves the unchanged `llm-pi-ai`
profile, optionally compiles `apiKeyPool`, selects an attempt-local credential,
delegates through the official-derived adapter path, and renders the official
Models page with pool fields inside the selected provider editor. Removal plus
restart restores both official entries.

## White-Box Pairs

- Config positive: an official profile with no `apiKeyPool` resolves exactly as
  rc.6. Negative: invalid key ids, refs, weights, priorities, duplicate refs, or
  no enabled key fail before route registration.
- Adapter positive: explicit auth/quota/rate-limit failure before business
  output selects the next eligible key. Negative: once text/tool output starts,
  no second credential is resolved.
- Error positive: final key-specific failure remains the original terminal
  outcome. Negative: abort, request/model/content, context, server, timeout,
  transport, and unknown failures never switch keys.
- Payload positive: official `GenerateOptions`, messages, metadata, chunks,
  replay state, and usage are byte/semantic equivalent. Negative: static gate
  and tests reject key id, attempt, health, selection, probe, or credential value
  in business payloads.
- Credential positive: a value lives only in one attempt scope. Negative: it is
  absent from settings, logs, errors, control responses, snapshots, and chunks.

## Official Parity

- Provider fixtures compare replacement with installed rc.6 for single-key
  catalog routes, custom routes, discovery, reasoning, attachments, replay,
  timeout, abort, retry policy, dynamic settings, and stream output.
- Models snapshots compare official and replacement configured rows, dormant
  Add provider choices, `ProviderEditor`, custom-provider flow, onboarding,
  locale copy, CSS classes/tokens, dimensions, and responsive layout.
- The only allowed snapshot difference is the alternate-key/policy block inside
  an opened configured Pi-AI `ProviderEditor`.

## Exposure Tests

- Positive: a configured provider appears in the existing Models row list; its
  existing editor shows primary key plus alternate key/policy fields.
- Negative: an unconfigured provider is not rendered as a configured row and
  exposes no pool controls; it appears only in the official Add provider
  selector until selected and saved.
- Negative: no new page, nav item, standalone card, Plugins editor, duplicate
  Models section, `multikey/*` route, or `llm/stream` hook exists.

## Composition And Restore

- Install positive: dump-config shows both official entries disabled and the
  replacement active; route, namespace, and Models owner counts are each one.
- Install negative: a wrong target `name` is rejected by the fixture/gate and
  duplicate ownership fails loudly.
- Restore positive: remove bundle, exact service/PID restart, official entries
  active, replacement absent, original provider call and Models write succeed.
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
