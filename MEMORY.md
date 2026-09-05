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
- 2026-09-05: The root `agent-plugins` Guidance surface was refreshed with the current local AppSDK 0.1.6 binary (`/Users/fanzhang/.local/bin/appsdk`, SHA-256 `26e909c1aeba4c6a27e748ae0785fa07e10d75c619391c11a3eccedf68aaa37c`) through official `init` and one repaired `pin-lock` route. The stale project migration witness was quarantined recoverably before pin-lock; the regenerated `.appsdk/migrations/0.1.5-to-0.1.6/record.json` is current AppSDK compatibility evidence, not an active old SDK. Root maps and child project truth were retained. `appsdk verify .` and `appsdk compile .` pass at `contract_bound`; current compile artifact is `sha256:713eed4c0db2e3e91692021f426d003faec67a2d52c5161d6032d7d9bc8517c`. The earlier note that root `.appsdk/migrations/` was absent is superseded by this verified state.
  Tags: appsdk-0.1.6, migration, root-guidance, verified
- 2026-09-05 correction: After the closeout memory/note entries were added, the official compile was rerun; the final root Guidance artifact hash is `sha256:729d1b2436536ef12feda4da8184a59a977dea502262c00c57e75abad05b64fa`. The prior `sha256:713eed4c0db2e3e91692021f426d003faec67a2d52c5161d6032d7d9bc8517c` is an intermediate pre-closeout artifact and is not the final candidate.
  Tags: appsdk-0.1.6, artifact, correction
- 2026-09-05 artifact binding note: compile artifact identity is derived after the source tree and staged candidate settle. Intermediate artifact hashes recorded in earlier closeout notes are historical observations only; the final artifact hash must be taken from the last official `appsdk compile` and its run evidence, not copied back into this source-owned MEMORY file.
  Tags: appsdk-0.1.6, artifact-binding, source-truth
