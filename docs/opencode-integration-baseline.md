# OpenCode integration baseline

## Exact pins

- Host base: `b578b7261fc9ec4917fe272df5cc4bd8a056cd5`
- Host adapter pin: `1e3f780ca4387a3afa14f9fd58fd308020edc662`
- Host handled-command persistence patch: `e5278b6760a0fda7795945fb3c7f3a337b73d4b3`
- This integration line: `56869a7` plus naming cleanup `74a74bf`
- RCC: `http://127.0.0.1:4444/v1`

## Ownership

```text
OpenCode typed tool/end-turn/compaction events
  -> agent-memory OpenCode adapter
  -> JSONL bridge
  -> agent-memory-core (validation, Pending, organization, Knowledge, persistence)

OpenCode public SDK session/event/part routes
  -> agent-tui transport and presentation owners
```

`memory` is a typed sibling and never uses `metadata`. Adapters only parse,
forward, and project; Core owns all business semantics and transactions. TUI
does not import private OpenCode renderer modules.

## Verified gates

- agent-memory: `cargo test --all-targets`, clippy, fmt, bridge blackbox: pass.
- agent-tui: typecheck, runtime boundaries, OpenCode transport `17/17`, runtime `5/5`, session `4/4`, connection `4/4`, execution `3/3`, build: pass.
- Both projects: `appsdk verify` and `appsdk verify-git-main-protection`: pass.
- OpenCode host: typed-memory `51 pass / 3 skip / 0 fail`, typecheck, build, Darwin ARM64 version smoke: pass.
- OpenCode temporary server on `4602`: health HTTP 200; stopped after replay.
- OpenCode temporary server on `4603` with the final agent-memory file plugin and
  release bridge: plugin configuration was accepted, session creation returned
  HTTP 200, and RCC-backed prompt returned `LIVE_MEMORY_OK` with HTTP 200. The
  configured store wrote a valid versioned manifest and remained reopenable;
  this prompt emitted no memory field, so no Pending entry was expected.
- OpenCode temporary server on `4605`: `/session` returned HTTP 200 and
  `/session/{id}/command` with `memory-organize incremental` returned HTTP 200;
  the command did not enter the provider loop and its result was persisted as a
  readable Session message. This replay used the exact host patch above and the
  release agent-memory bridge.
- RCC chat: HTTP 200 with `RCC_OK`; `/v1/models` is HTTP 200 with an empty catalog.
- `3080`: HTTP 000 and no listener; never start or use it.

The organized-index fixture proves the Core transaction path. It does not claim
that RCC naturally generated `memory.organized_index` while its model catalog is
empty.
