# agent-plugins project memory

## Verified project facts

- 2026-09-04: The repository root is the AppSDK Guidance surface for four
  first-party projects: `agent-tui`, `agent-memory`, `Teams`, and
  `dsh-concurrency-limit`. `agent-memory` is the required fourth project, but
  it is absent from the current `origin/main` baseline and therefore remains a
  pending binding until its canonical source is present.
  Tags: scope, project-registry, agent-memory
- 2026-09-04: Root Guidance uses AppSDK 0.1.6 in advisory mode. Child project
  maps, contracts, lifecycle records, Active, Protected, evidence, claims,
  mailboxes, journals, and historical hashes remain each child's truth and are
  not copied into the root surface.
  Tags: appsdk, guidance, child-boundaries
- 2026-09-04: Feature work has a mandatory spine:
  `requirements -> map_check -> implementation -> candidate -> validation ->
  review -> integration -> cleanup`. `architecture`, `map_update`,
  `effectiveness`, and `promotion` are explicit risk/scope-selected bypass
  nodes; any bypass is recorded as a one-line decision.
  Tags: workflow, feature, map-check
- 2026-09-04: Debug work requires `orient -> explore -> resolve -> candidate ->
  validation -> review -> integration -> cleanup`. `orient` binds the real
  maps, notes, records, and unique owner; `explore` appends worker run notes;
  `resolve` updates the owning map/gate when the verified contract changes.
  Tags: workflow, debug, run-notes
- 2026-09-04: Task closeout includes rereading project `AGENTS.md`, local
  Skills, and `MEMORY.md`, retaining only verified reusable facts, and removing
  only the owner's clean worktree after required delivery/remote receipts.
  Tags: closeout, memory, worktree
- 2026-09-04: The root AppSDK surface was regenerated through the official
  local AppSDK 0.1.6 `init`/`pin-lock` flow after authorized cleanup of stale
  project migration/generated residue. The current lock, bundled `sdk.bin`,
  and local binary agree; `.appsdk/migrations/` is absent; the canonical
  `contracts/migrations/` compatibility assets remain because they are part of
  the 0.1.6 bundle. Root project maps were retained, `appsdk verify` and
  `appsdk compile` pass at `contract_bound`, and no child project truth or main
  worktree was changed.
  Tags: appsdk-0.1.6, cleanup, root-governance
