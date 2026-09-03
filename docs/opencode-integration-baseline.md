# OpenCode integration baseline

## Exact pins

- Host base: `b578b7261fc9ec4917fe272df5cc4bd8a056cd5`
- Host adapter pin: `1e3f780ca4387a3afa14f9fd58fd308020edc662`
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
- RCC chat: HTTP 200 with `RCC_OK`; `/v1/models` is HTTP 200 with an empty catalog.
- `3080`: HTTP 000 and no listener; never start or use it.

The organized-index fixture proves the Core transaction path. It does not claim
that RCC naturally generated `memory.organized_index` while its model catalog is
empty.
