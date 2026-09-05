---
name: agent-plugins-governance
description: Govern feature and debug delivery across agent-tui, agent-memory, Teams, and dsh-concurrency-limit. Use for child ownership, mapped architecture, validation, review, integration, or cleanup.
---

# agent-plugins governance

Use this Skill for repository-level work across the four first-party plugin
projects. AppSDK remains the quality owner; this Skill supplies project context
and does not create another lifecycle or evidence store.

## Core architecture

```text
root Guidance and cross-project maps
  -> selected child maps and contracts
  -> one child implementation owner
  -> declared verification and delivery gates
```

The root coordinates context. Each child owns its source, contracts, maps,
lifecycle records, Active, Protected, evidence, and history.

`agent-tui` keeps concrete agent protocols behind `AgentHost`/`AgentRemote`:

```text
terminal and session control
  -> AgentHost/AgentRemote adaptor
  -> normalized semantic model
  -> presentation, buffer, and render
  -> terminal lifecycle
```

Adaptors translate agent protocol and control operations. Presentation and
rendering consume normalized semantics, never agent-specific raw protocol.

## Context and memory

Read root and selected-child `AGENTS.md`, maps, contracts, current notes, and
relevant records. Root maps bind cross-project ownership; child maps bind
implementation edges and gates.

Read `memory/index.md` as the resident memory router:

- L1: reviewed critical summaries.
- L2: reviewed reusable detail.
- L3: new or unreviewed detail.
- Every entry exposes tags and a relative detail path.

Open the listed relative path for full content. Expand by category with
`project-memory query <plan|path|knowledge|lesson> .`; narrow with
`project-memory query --tag <tag> <text> .`. Current implementation status and
temporary gaps belong in L2/L3, not the Skill description.

## Delivery paths

```text
requirements -> map_check -> [architecture] -> implementation -> candidate
-> validation -> [map_update] -> review -> [effectiveness] -> integration
-> [promotion] -> cleanup

orient -> explore -> resolve -> candidate -> validation -> review -> integration -> cleanup
```

Before edits, bind goal, scope, child, unique owner, allowed paths, adjacent
edges, and relevant gates. Read maps in resource, function, mainline, module,
verification order. Record exploration and first divergence in this run's
notes. Update maps or gates only when the verified contract changes.

Use a clean owner worktree. Prefer removal or reuse before adding behavior.
Keep control state out of business payloads. No fallback, silent downgrade,
fabricated evidence, cross-child record copying, or another worker's state.

Validate the affected surface, then review the unchanged candidate. Runtime
claims require matching build, install, restart, and public-entrypoint evidence
when applicable. Integrate only after review; remove only this task's clean
worktree and release only this task's claim.
