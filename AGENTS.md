# agent-plugins project rules

## Project scope

The repository root is the AppSDK-governed `agent-plugins` project. Guidance is
shared across these first-party plugin projects:

| project | current source state | canonical owner |
| --- | --- | --- |
| `agent-tui/` | present; local AppSDK project is active | `agent-tui` |
| `agent-memory/` | required fourth project, absent from `origin/main` | `agent-memory` |
| `Teams/` | present; local AppSDK project is active | `teams-design` |
| `dsh-concurrency-limit/` | source present; local AppSDK binding is pending | `dsh-concurrency-limit` |

`agent-memory` must remain `pending` until its canonical source is on the root
baseline. A missing project path is never represented as active. `deepseek-harness`
is an external DSH reference and is read-only. The ignored `opencode/` reference,
if present, is also read-only.

Root Guidance coordinates project context; it does not replace a child project's
`.appsdk` contract, maps, lifecycle records, Active, Protected, or evidence. Do
not copy maps or records between projects.

The declared root Guidance sources are this file and the
`agent-plugins-governance` Skill contract. A child task also uses only the
sources declared by that child. RouteCodex is a read-only generic reference;
its V3 owners, maps, records, and lifecycle state are not project context here.

## Ownership and boundaries

- Root cross-project Guidance is owned by `agent-plugins-guidance`.
- Child source changes belong to the matching project owner and its declared
  function/mainline map edge.
- Root `.appsdk/maps/` is the cross-project map. A child project's
  `.appsdk/maps/` remains the canonical implementation map for that child.
- `.appsdk/`, `.appsdk-control/`, `generated/`, `protected/`, and `playground/`
  retain their AppSDK meanings. Historical evidence and lifecycle records are
  append-only and are never removed to make a gate pass.
- Routing, retry, provider selection, lifecycle, debug, environment, snapshot,
  and governance data must stay in typed control resources or records. It must
  not enter business payloads or be reconstructed from them.
- New behavior requires an ablation check and one owner; prefer declared
  operation/hook/gate configuration and shared functions over inline branches or
  duplicate implementations. Review blocks new violations while leaving
  unrelated historical debt visible for later ownership.

## Guidance mode

Enforcement is `advisory`. `guide plan`, `guide update`, and `guide next` keep a
durable recommendation/status loop; they do not force every low-risk task to
execute every feature node or create irrelevant evidence.

Feature work follows this flow; bracketed nodes are explicit bypass choices:

```text
requirements -> map_check -> [architecture] -> implementation -> candidate
-> validation -> [map_update] -> review -> [effectiveness] -> integration
-> [promotion] -> cleanup
```

`requirements`, `map_check`, `implementation`, `candidate`, `validation`,
`review`, `integration`, and `cleanup` are mandatory. `architecture` may be
skipped when the existing map/design and the change size justify it;
`map_update` is needed only when feature/owner/path/gate bindings change;
`effectiveness` is selected for runtime or higher-risk changes; `promotion` is
selected when an immutable Active/Protected delivery is required. Each bypass
is recorded as a one-line advisory decision; it is not a license to omit the
mandatory nodes.

Debug work follows:

```text
orient -> explore -> resolve -> candidate -> validation -> review -> integration -> cleanup
```

Every debug entry must:

1. Read this file, the relevant project `AGENTS.md`, `MEMORY.md`, `note.md`,
   current run notes, resource map, function map, mainline call map,
   verification map, records, and historical results.
2. Read the resource map first, then the function map, mainline call map, module
   registry, and verification map. Bind the issue to the real function-map
   owner, adjacent edge, and required gates. If the
   function map or binding is missing, record the gap and add it after the fix
   through the owning map change.
3. Search prior successful and failed records before repeating an experiment or
   unchanged command. Keep one active hypothesis with confirmation and
   falsification signals.
4. Append the worker's own exploration, experiment, first-divergence, root-cause,
   and verification facts to `.agent-collab/runs/<run_id>/notes.jsonl`.
5. Change only the unique owner, add paired positive/negative regression coverage
   when state or failure behavior changes, and update the gate/map declaration
   when the verified contract changes.

The debug stages are all mandatory: `orient` reads AGENTS, the actual resource,
function, mainline, and verification maps plus existing notes/records;
`explore` reproduces where feasible and appends notes; `resolve` fixes the
mapped owner and updates a map/gate when the verified contract changes. The
remaining candidate, validation, review, integration, and cleanup stages close
the delivery path.

Any project, goal, source, scope, owner, rule, gate, dependency, or environment
drift requires an AppSDK plan revision. Passing steps bind their own evidence;
an earlier test or generated artifact cannot stand in for install, restart,
review, integration, promotion, freeze, or cleanup evidence.

## Worktree and closeout

All code and governance edits start in one clean owner worktree below
`playground/`, based on the latest `origin/main`. Main and other workers'
worktrees remain untouched. A task is not closed until its required evidence and
remote receipt are present, its own worktree is clean and removed, and its own
claim is released.

Before removing that worktree, the owner must review this `AGENTS.md`, the
project-local Skills, and the project `MEMORY.md`; promote only verified,
reusable project facts to `MEMORY.md`. Do not remove another worker's worktree,
dirty files, claims, records, mailbox, journal, or historical evidence.

Use the locally installed AppSDK and its declared contracts. The AppSDK binary's
byte digest is not a Guidance admission gate. AppSDK verification is local;
remote CI is not an AppSDK execution requirement. Do not hand-write lifecycle
records, hashes, receipts, timestamps, or producer identity, and do not run a
remote CI AppSDK gate as a substitute for local verification.
