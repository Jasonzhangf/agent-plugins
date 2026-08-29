# DSH TUI project memory

## Verified MVP engineering lessons

- `tui.app-container.v2` owns layout metadata while the shared terminal-shell
  contract carries the optional app descriptor extension; terminal-lifecycle
  must not depend on the app-container experiment module just to render it.

- Real Ink PTY input must wait until the rendered composer cursor proves text consumption before sending Return; otherwise text plus carriage return may arrive as one paste-shaped event. Set PTY dimensions before spawn, fail on timeout, and propagate the child wait status.
- WebSocket peer-close recovery belongs to the transport control side-channel, while Session history convergence belongs to the Session owner. On later mux generations, rehydrate public history before admitting frames; explicit abort must never reconnect, and failed rebaseline must preserve last-good history while exposing failure.
- Project and CI are pinned to AppSDK 0.1.3. Verify with the exact pinned binary and SHA; the global 0.1.4 schema is not evidence for this project.
- A dual-client test may prove event/error convergence even when the locked provider returns quota 429, but successful assistant streaming and DSH Review remain unclosed; never switch the locked `opencode-go/deepseek-v4-flash` model to manufacture completion.
- As of the 0.1.0-mvp.1 artifact, `regression_report` and all module/function statuses except the live/visual/review/merge gates are active; successful streaming is still the external quota gap.

## 2026-08-28 status placement and tool-card design

- Internal `conversation.context` is a non-surface canonical node: the terminal
  renderer returns `null`, so internal context text cannot leak into the transcript.
- Composer presentation is separated from transcript output by a gray box and
  explicit blank rows above and below the typed input line.
- Connection/session/status display is owned by `status-footer-plugin`; app-container
  preserves header slot shape but emits empty status-slot text to avoid duplicate
  state. Tool-card rendering design is recorded in
  `docs/design/tui-tool-card-rendering-design.md`, status `design` pending Phase 1.
- Approved tool-card rules: white `Ran`, blue filename, red command and `--`
  arguments, white remaining text, green success dot, red failure dot, reasoning
  light gray, card whitespace, and one terminal-only horizontal divider between
  transcript rounds. Slash commands, interactive windows, and Markdown parsing
  remain separate plugin owners.
