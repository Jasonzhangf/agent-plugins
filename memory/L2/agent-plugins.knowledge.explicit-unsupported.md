<!-- project-memory:v1 {"category":"knowledge","created_at":"2026-09-05T12:24:23.055564+00:00","id":"agent-plugins.knowledge.explicit-unsupported","importance":0,"memory_level":2,"review_evidence":["user-review-2026-09-05"],"review_status":"reviewed","source_refs":["agent-tui/src/experiments/transport/src/opencode-serve.ts","agent-tui/src/experiments/transport/src/transport.ts"],"tags":["agent-tui","errors","no-fallback","opencode"],"updated_at":"2026-09-05T14:34:46.207540+00:00"} -->

# Unsupported operation policy

The OpenCode adaptor explicitly returns unsupported errors for operations it does not implement. The current path does not silently downgrade or fallback, and downstream code must not interpret an unsupported control operation as a successful agent action.
<!-- project-memory:end -->
