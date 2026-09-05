<!-- project-memory:v1 {"category":"path","created_at":"2026-09-05T12:24:22.974601+00:00","id":"agent-plugins.path.adaptor-control","importance":0,"memory_level":2,"review_evidence":["user-review-2026-09-05"],"review_status":"reviewed","source_refs":["agent-tui/contracts/tui/session/session.contract.json","agent-tui/contracts/tui/transport/transport.contract.json","agent-tui/src/experiments/session/src/session.ts","agent-tui/src/experiments/transport/src/transport.ts"],"tags":["adaptor","agent-tui","control-plane","session"],"updated_at":"2026-09-05T14:34:25.195922+00:00"} -->

# Agent control path

The current adaptor control path is terminal/input logic -> TuiSessionService -> AgentHost/AgentRemote -> concrete agent client -> session/event contract. The adaptor owns protocol translation and control operations; the TUI presentation and render chain consumes the normalized contract rather than reconstructing provider state.
<!-- project-memory:end -->
