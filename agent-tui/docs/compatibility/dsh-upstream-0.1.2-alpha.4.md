# dsh Upstream Alignment

Date: 2026-09-01

## Baseline

- Upstream `dsh` master: `4e84901e64` (`dsh-v0.1.2-alpha.4`).
- TUI dependency baseline: all `@deepseek-ai/*` packages at `0.1.0-rc.6`.
- TUI AppSDK baseline: standard AppSDK `0.1.6`.

## Gap Review

| Surface | Upstream result | TUI result | Decision |
| --- | --- | --- | --- |
| Host events | `events.mux` / `events.host`, `session/event`, and `host/session-*` remain the public event boundary. | TUI consumes the same typed boundary and now forwards child-session events to the status plugin. | No semantic adapter gap. |
| Subagent identity | Direct-child identity and explicit running/inactive lifecycle remain authoritative. | Status bars key by child session id and remove on inactive/removed events. | Aligned. |
| Tool presentation | Tool call/result render intent remains host-derived and non-persisted. | Latest child tool call is projected through `tuiToolCard.project()`. | Aligned; no duplicate parser. |
| Persistence | SQLite persistence was removed/renamed and session sequence contracts changed upstream. | TUI does not import persistence implementations. | No TUI change required. |
| Plugin loading | Upstream fixtures moved from `cordis.yml` to patch fixtures. | TUI uses its own AppSDK 0.1.6 governance and patch boundary. | No runtime adapter required. |
| Published versions | Upstream workspace is `0.1.2-alpha.4`; npm does not publish matching `@deepseek-ai/*@0.1.2-alpha.4`. | TUI lockfile remains `0.1.0-rc.6`. | Migration blocked on artifact publication, not source compatibility. |

## Verification

- Upstream public declarations for events/subagents/sessions were compared with installed TUI declarations for all consumed shapes; no field-level mismatch was found.
- `pnpm run check`, full named TUI tests, and `build:runtime` pass on the current TUI dependency baseline.
- `npm view @deepseek-ai/dsh-host-apiproxy@0.1.2-alpha.4 version` returns `E404`; a version bump cannot be installed or verified yet.

## Verified Migration Gap

The isolated alpha4 source worktree successfully produced installable local tarballs for `dsh-api-gateway`, `dsh-api-session-controller`, `dsh-api-remotes`, `dsh-client-connection`, `dsh-session`, `dsh-subagent`, and `dsh-tools`. Installing the first five relevant alpha4 artifacts into the isolated TUI worktree makes TypeScript resolve, but the TUI still has an un migrated transport owner: `transport.ts` and `session.ts` use the removed `AbstractApiClient` / `IApiClient` model, while alpha4 requires the Connection + generated Remote + Session Controller composition.

The first compile-driven adapter change also exposed the packed-history boundary: alpha4 `SessionHistoryRecord` is a discriminated `event`/`chunks` union and has no `view` field. TUI now owns a normalized `TuiHistoryEntry` contract for the presentation layer, but the transport/session adapter still needs to convert alpha4 journal records and preserve packed chunk runs without loss.

## Migration Rule

When matching alpha.4 artifacts are published, update `package.json` and `pnpm-lock.yaml` together in a fresh worktree, then rerun AppSDK verify, typecheck, all affected tests, full tests, runtime build, clean install, and live Host/PTY smoke. Do not mass-replace `0.1.0-rc.6` before that gate.
