<!-- project-memory:v1 {"category":"knowledge","created_at":"2026-09-05T12:24:23.028752+00:00","id":"agent-plugins.knowledge.tui-downstream","importance":0,"memory_level":2,"review_evidence":["user-review-2026-09-05"],"review_status":"reviewed","source_refs":["agent-tui/contracts/tui/display-buffer-plugin/display-buffer-plugin.types.ts","agent-tui/contracts/tui/presentation/presentation.contract.json","agent-tui/contracts/tui/terminal-lifecycle/terminal-lifecycle.contract.json","agent-tui/contracts/tui/terminal-render-plugin/terminal-render-plugin.types.ts","agent-tui/src/experiments/session/src/session.normalizer.ts"],"tags":["agent-tui","buffer","lifecycle","presentation","render"],"updated_at":"2026-09-05T14:34:36.041883+00:00"} -->

# TUI downstream rendering chain

After the adaptor seam, the current TUI normalizes session history/events, projects semantic presentation, interprets text and tool cards, resolves theme, maintains display-buffer state, renders terminal frames, and drives the terminal lifecycle. These layers are declared in agent-tui contracts and are not provider-specific protocol owners.
<!-- project-memory:end -->
