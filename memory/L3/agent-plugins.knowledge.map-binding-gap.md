<!-- project-memory:v1 {"category":"knowledge","created_at":"2026-09-05T12:24:23.070425+00:00","id":"agent-plugins.knowledge.map-binding-gap","importance":0,"memory_level":3,"review_evidence":[],"review_status":"unreviewed","source_refs":["agent-tui/.appsdk/maps/function-map.json","agent-tui/.appsdk/maps/mainline-call-map.json","agent-tui/contracts/tui/**/*.json","appsdk verify agent-tui","pnpm --dir agent-tui run check:runtime-boundaries"],"tags":["agent-tui","binding","governance-gap","maps"],"updated_at":"2026-09-05T12:24:23.070425+00:00"} -->

# TUI map binding gap

agent-tui AppSDK function-map.json and mainline-call-map.json currently bind generic AppSDK lifecycle chains but do not fully bind the source-level TUI transport, session, presentation, render, lifecycle, or adaptor edges. The finer-grained ownership exists in agent-tui/contracts/tui; the AppSDK map binding is therefore incomplete and must not be reported as a complete runtime map.
<!-- project-memory:end -->
