<!-- project-memory:v1 {"category":"knowledge","created_at":"2026-09-05T12:24:23.015887+00:00","id":"agent-plugins.knowledge.agent-seam","importance":0,"memory_level":2,"review_evidence":["user-review-2026-09-05"],"review_status":"reviewed","source_refs":["agent-tui/contracts/tui/app-container/manifest.json","agent-tui/contracts/tui/transport/transport.contract.json","agent-tui/src/experiments/session/src/session.ts","agent-tui/src/experiments/transport/src/transport.ts"],"tags":["agent-host","agent-remote","agent-tui","boundary"],"updated_at":"2026-09-05T14:34:14.024834+00:00"} -->

# AgentHost and AgentRemote seam

AgentHost and AgentRemote are the downstream TUI protocol boundary. TuiSessionService consumes their session, command, workspace, event, and interaction surfaces; app-container is explicitly forbidden from directly depending on transport or agent adapters.
<!-- project-memory:end -->
