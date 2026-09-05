# Memory Index

Index stores short titles, tags, and detail paths. Open the linked Markdown detail for content.

## Raw sources

- [Plan](plan.jsonl)
- [Path](path.jsonl)
- [Knowledge](knowledge.jsonl)
- [Lesson](lesson.jsonl)

## Level 1 — reviewed critical

### Detailed Memory: query L2/L3 by category or tag
- tags: `l2`, `l3`, `memory`, `query`, `routing`, `tags`
- details: [L1/agent-plugins.knowledge.detailed-memory-routing.md](L1/agent-plugins.knowledge.detailed-memory-routing.md)

### Control truth stays outside business payloads
- tags: `boundary`, `control-plane`, `lesson`, `payload`
- details: [L1/agent-plugins.lesson.control-side-channel.md](L1/agent-plugins.lesson.control-side-channel.md)

### Governance verification is not runtime proof
- tags: `artifact`, `lesson`, `runtime`, `verification`
- details: [L1/agent-plugins.lesson.verify-not-runtime.md](L1/agent-plugins.lesson.verify-not-runtime.md)

### Architecture binding order
- tags: `architecture`, `maps`, `owner`, `verification`
- details: [L1/agent-plugins.path.architecture-binding.md](L1/agent-plugins.path.architecture-binding.md)

### Debug delivery spine
- tags: `debug`, `owner`, `run-notes`, `workflow`
- details: [L1/agent-plugins.path.debug-delivery.md](L1/agent-plugins.path.debug-delivery.md)

### Feature delivery spine
- tags: `delivery`, `feature`, `guidance`, `workflow`
- details: [L1/agent-plugins.path.feature-delivery.md](L1/agent-plugins.path.feature-delivery.md)

### TUI event-to-terminal path
- tags: `agent-tui`, `event-stream`, `render`, `runtime`
- details: [L1/agent-plugins.path.tui-event-render.md](L1/agent-plugins.path.tui-event-render.md)

### Agent-neutral TUI boundary
- tags: `acp`, `adaptor`, `agent-tui`, `architecture`, `target-state`
- details: [L1/agent-plugins.plan.agent-neutral-tui.md](L1/agent-plugins.plan.agent-neutral-tui.md)

### Root scope and ownership
- tags: `agent-memory`, `boundaries`, `ownership`, `scope`
- details: [L1/agent-plugins.plan.scope-and-boundaries.md](L1/agent-plugins.plan.scope-and-boundaries.md)

## Level 2 — reviewed reusable

### AgentHost and AgentRemote seam
- tags: `agent-host`, `agent-remote`, `agent-tui`, `boundary`
- details: [L2/agent-plugins.knowledge.agent-seam.md](L2/agent-plugins.knowledge.agent-seam.md)

### Unsupported operation policy
- tags: `agent-tui`, `errors`, `no-fallback`, `opencode`
- details: [L2/agent-plugins.knowledge.explicit-unsupported.md](L2/agent-plugins.knowledge.explicit-unsupported.md)

### TUI downstream rendering chain
- tags: `agent-tui`, `buffer`, `lifecycle`, `presentation`, `render`
- details: [L2/agent-plugins.knowledge.tui-downstream.md](L2/agent-plugins.knowledge.tui-downstream.md)

### Agent control path
- tags: `adaptor`, `agent-tui`, `control-plane`, `session`
- details: [L2/agent-plugins.path.adaptor-control.md](L2/agent-plugins.path.adaptor-control.md)

## Level 3 — new or unreviewed

### AppSDK Guidance state
- tags: `advisory`, `appsdk`, `guidance`, `memory`
- details: [L3/agent-plugins.knowledge.appsdk-guidance.md](L3/agent-plugins.knowledge.appsdk-guidance.md)

### Child project registry
- tags: `children`, `ownership`, `pending`, `registry`
- details: [L3/agent-plugins.knowledge.child-project-registry.md](L3/agent-plugins.knowledge.child-project-registry.md)

### TUI map binding gap
- tags: `agent-tui`, `binding`, `governance-gap`, `maps`
- details: [L3/agent-plugins.knowledge.map-binding-gap.md](L3/agent-plugins.knowledge.map-binding-gap.md)

### Current concrete adaptor
- tags: `adaptor`, `agent-tui`, `current-state`, `opencode`
- details: [L3/agent-plugins.knowledge.opencodeserve-current.md](L3/agent-plugins.knowledge.opencodeserve-current.md)

### Runtime map gaps are owned work
- tags: `governance`, `lesson`, `maps`, `owner`
- details: [L3/agent-plugins.lesson.map-gap-is-governance-work.md](L3/agent-plugins.lesson.map-gap-is-governance-work.md)

### Child truth is not root memory
- tags: `child-boundary`, `history`, `lesson`, `records`
- details: [L3/agent-plugins.lesson.maps-are-not-records.md](L3/agent-plugins.lesson.maps-are-not-records.md)

### Pending modules are not active paths
- tags: `lesson`, `pending`, `registry`, `truth`
- details: [L3/agent-plugins.lesson.pending-is-not-active.md](L3/agent-plugins.lesson.pending-is-not-active.md)

### A seam is not adaptor coverage
- tags: `acp`, `adaptor`, `architecture`, `lesson`
- details: [L3/agent-plugins.lesson.seam-not-coverage.md](L3/agent-plugins.lesson.seam-not-coverage.md)

### Closeout path
- tags: `cleanup`, `closeout`, `integration`, `review`
- details: [L3/agent-plugins.path.closeout.md](L3/agent-plugins.path.closeout.md)

### Memory rebuild policy
- tags: `classification`, `governance`, `memory`, `truth`
- details: [L3/agent-plugins.plan.memory-rebuild-policy.md](L3/agent-plugins.plan.memory-rebuild-policy.md)

## Skill description candidates

Base budget: 8 lines. Copy the compact lines into the project Skill `description` after manual architecture deduplication. Fill level 1 first; use level 2, then level 3, only for remaining slots.

- L1: Detailed Memory: query L2/L3 by category or tag (knowledge) [l2,l3,memory,query,routing,tags] -> L1/agent-plugins.knowledge.detailed-memory-routing.md
- L1: Control truth stays outside business payloads (lesson) [boundary,control-plane,lesson,payload] -> L1/agent-plugins.lesson.control-side-channel.md
- L1: Governance verification is not runtime proof (lesson) [artifact,lesson,runtime,verification] -> L1/agent-plugins.lesson.verify-not-runtime.md
- L1: Architecture binding order (path) [architecture,maps,owner,verification] -> L1/agent-plugins.path.architecture-binding.md
- L1: Debug delivery spine (path) [debug,owner,run-notes,workflow] -> L1/agent-plugins.path.debug-delivery.md
- L1: Feature delivery spine (path) [delivery,feature,guidance,workflow] -> L1/agent-plugins.path.feature-delivery.md
- L1: TUI event-to-terminal path (path) [agent-tui,event-stream,render,runtime] -> L1/agent-plugins.path.tui-event-render.md
- L1: Agent-neutral TUI boundary (plan) [acp,adaptor,agent-tui,architecture,target-state] -> L1/agent-plugins.plan.agent-neutral-tui.md
