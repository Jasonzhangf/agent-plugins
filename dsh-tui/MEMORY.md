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
