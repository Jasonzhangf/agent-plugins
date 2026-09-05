<!-- project-memory:v1 {"category":"lesson","created_at":"2026-09-05T12:24:23.163520+00:00","id":"agent-plugins.lesson.control-side-channel","importance":0,"memory_level":1,"review_evidence":["user-review-2026-09-05"],"review_status":"reviewed","source_refs":["AGENTS.md","agent-tui/contracts/tui/architecture/semantic-boundary.md","skills/agent-plugins-governance/SKILL.md"],"tags":["boundary","control-plane","lesson","payload"],"updated_at":"2026-09-05T14:30:40.472697+00:00"} -->

# Control truth stays outside business payloads

Routing, retry, provider selection, lifecycle, diagnostics, environment, snapshots, and governance state belong in typed control resources, error chains, records, or declared configuration. They must not be mixed into business request/response payloads or reconstructed from business data.
<!-- project-memory:end -->
