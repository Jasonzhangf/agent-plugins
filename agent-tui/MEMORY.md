# DSH TUI project memory

## 2026-08-28 stale live PTY isolation

- When the screenshot shows no input, disconnected state, and no exit, verify the exact live PID/TTY and installed owner hashes before changing source. The current global artifact matches the built startup/lifecycle owners, while a fresh PTY reaches connected, consumes input, and exits `/quit` with wait status 0. A stale/hung PTY must be stopped by explicit PID only; never infer a source regression from its screen.

## 2026-08-28 SIGINT process-exit correction

- A real PTY can show the Ctrl+C confirmation and restore the terminal yet still return `CHILDKILLED SIGINT` if `lifecycle.exit()` removes the SIGINT listener from inside the active signal callback. Keep the listener installed through that dispatch and defer removal to the next turn; verify the child wait status is 0, not only terminal restoration.

## 2026-08-28 Ctrl+C contract

- Terminal lifecycle normalizes raw ETX (`\\u0003`) to canonical `ctrl-c`. App-shell owns exit policy: non-empty composer clears immediately; only empty composer starts/confirms the two-press exit window.

## 2026-08-28 parser/rendering correction

- Tool-card semantics now distinguish `Search` and `Called` and never dump raw generic arguments; Markdown parser coverage explicitly preserves fenced code and block boundaries, while terminal realization preserves those lines and styles.

## 2026-08-28 renderer boundary audit

- Extracted same-owner renderer registrations and descriptor builders into `playground/experiments/terminal-ui/src/terminal-ui-renderers.ts`; `terminal-ui.ts` is now 952 lines. Focused tests, typecheck, runtime build, clean-install, and design red tests pass. Fresh AGY Review `tui-tool-card-rendering-split-final-20260828` returned PASS with zero findings.

## Verified MVP engineering lessons

- `tui.app-container.v2` owns layout metadata while the shared terminal-shell
  contract carries the optional app descriptor extension; terminal-lifecycle
  must not depend on the app-container experiment module just to render it.

- Real Ink PTY input must wait until the rendered composer cursor proves text consumption before sending Return; otherwise text plus carriage return may arrive as one paste-shaped event. Set PTY dimensions before spawn, fail on timeout, and propagate the child wait status.
- WebSocket peer-close recovery belongs to the transport control side-channel, while Session history convergence belongs to the Session owner. On later mux generations, rehydrate public history before admitting frames; explicit abort must never reconnect, and failed rebaseline must preserve last-good history while exposing failure.
- Project and CI are pinned to AppSDK 0.1.3. Verify with the exact pinned binary and SHA; the global 0.1.4 schema is not evidence for this project.
- A dual-client test may prove event/error convergence even when the locked provider returns quota 429, but successful assistant streaming and DSH Review remain unclosed; never switch the locked `opencode-go/deepseek-v4-flash` model to manufacture completion.
- As of the 0.1.0-mvp.1 artifact, `regression_report` and all module/function statuses except the live/visual/review/merge gates are active; successful streaming is still the external quota gap.

## 2026-08-28 global artifact identity

- A source/runtime fix is not delivered until the installed plugin files are compared with the current build. The global package can retain an older plugin while `lib/cli.js` and lifecycle files look current. Rebuild, pack with an absolute tarball path, install, and compare the changed owner file hash before live verification.
- Final AGY Review `tui-installed-input-card-final-20260828` passed with zero findings after the artifact identity correction; source changes remain uncommitted in the dedicated worktree pending explicit delivery authorization.

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
\n+- Tool-card registry rendering consumes the independent `tuiTextParser` service through an explicit startup dependency; textual result/error output maps from parser semantic tokens to terminal-neutral segments, while terminal-ui only realizes descriptors. Missing parser is a fail-fast startup error, not a fallback path.
- Fresh parser-integration validation on 2026-08-28 passed affected tests, typecheck, runtime build, design gates, clean-install and PTY smoke; AGY Review `tui-tool-card-rendering-parser-final-20260828` passed with zero findings.

## 2026-08-28 Ctrl+C verification boundary

- The canonical Ctrl+C contract is implemented in app-shell: non-empty composer clears without exit; empty composer requires a second press within 3 seconds; running turns cancel. terminal-lifecycle normalizes raw ETX into the same typed key path and intercepts SIGINT while the input handler is installed.
- Module/resource map drift was the only AGY blocker for this change and is corrected: four implemented plugin modules/resources are now admitted and their required/forbidden resource edges are registered.
- Unit/design/build/clean-install/global-install evidence is green. A real expect PTY currently paints but echoes input, so live raw-mode/input-bridge evidence is still an explicit release gap.

## 2026-08-28 installed runtime recovery

- Rebuilt and globally installed the current artifact with an absolute tarball path. Clean-install SHA-256: `1de6f76028f01c30e2d3cedbfb22f52b42655d85cebf127f8fdd0c17e0e53bd9`.
- Current installed PTY evidence against Host `http://127.0.0.1:3080`: typed input is consumed, connection transitions `disconnected -> connected`, `/quit` restores the terminal and exits `0`, and Ctrl+C clears non-empty input before showing the two-press exit notice.
- Preventive rule: after runtime changes, compare installed owner hashes with `lib` before claiming live behavior; source-only tests do not prove the global `dsh-tui` entry is aligned.

## 2026-08-28 execution status overlap

- A slash command can still be in the Host request phase while a second input arrives. Startup was calling the strict execution-status owner twice, which surfaced `execution already running` and made the TUI appear stuck.
- The unique orchestration fix is `beginExecutionStatus()` in `playground/experiments/startup/src/startup.ts`: startup starts the status only when the owner is not already running; the execution-status plugin remains strict and still rejects duplicate direct calls.
- Rebuilt, reinstalled, and replayed the overlap path: no duplicate-start error; latest `/quit` PTY returned `PTY_WAIT_RESULT ... 0 0`.
# 2026-08-28 TUI input/runtime recovery

- Verified root cause of the live no-input failure: `startup.renderNow` called `composer.setMode` on every refresh, and composer-plugin emitted a subscription notification even for an identical state, creating an unbounded refresh loop. The unique fix is idempotent state transition notification in composer-plugin; the renderer/lifecycle layers were ruled out after CPU and source-flow tracing.
- Terminal lifecycle now splits every ETX byte in a received stdin chunk into canonical Ctrl+C key events, covering coalesced control bytes rather than only a one-byte chunk.
- Evidence: mapped tests, typecheck, runtime boundaries, design red tests (77/77), build, clean install and global install pass; fresh installed TTY accepted text, cleared non-empty input on Ctrl+C, showed the empty-input confirmation, exited on two combined ETX bytes, accepted `/quit`, restored the terminal, and observed Host disconnected -> connected with model/thinking/permission. AGY Review `tui-input-ctrlc-composer-loop-fixed-20260828` PASS with zero findings.

## 2026-08-28 live input/exit contract replay

- Fresh installed `/opt/homebrew/bin/dsh-tui` accepted text and reached Host `connected` in a real PTY. Non-empty Ctrl+C clears the composer; the documented `Ctrl+C×2` exit applies once the composer is empty, so typing text then exiting requires three physical presses total. The replay returned child wait status `0` and restored the terminal.
- Built and installed `terminal-lifecycle` hashes match: `65d53158c4c67431d3247ab08e62bef91929b08614d4b312d5e71d149ae14d4b91`.

## 2026-08-28 permission projection convergence

- A successful Host control command is not sufficient UI truth: `/permission` changed Host state while the TUI retained the pre-command `sessions.history` projection. `TuiSessionService.command()` now rehydrates the public history tail after control success and fails explicitly when projections are absent or the selected Session changes.
- Red test, typecheck, runtime-boundary, build, clean-install and real PTY evidence pass. `/permissions` now changes the footer to `permission read-only` without routing the command through the model prompt.
- Real Host tool replay produced the semantic `package.json` card and Esc returned execution status to idle; structured diff and approval remain externally unverified because the locked provider did not deliver those samples in the replay.

## 2026-08-28 nested tool-result projection

- Code-mode `run_code` results arrive as a public `tool/result` message whose text is nested under `tool-result.content`. Presentation must recursively project that public text before the independent tool-card parser can infer `before/after` diffs; terminal-ui must not inspect raw events.
- Rebuilt/global-installed artifact rendered the live edit diff with blue filename, red removal, green addition, and white one-line context; target content verified as `after-line\nsecond-line\n`. `pnpm run check`, typecheck, runtime-boundary, clean-install, and AGY Review passed; review verdict was `pass` with zero findings.

## 2026-08-28 search parser and history behavior

- Search tool results from code-mode may be public JSON arrays of `{path,lineNumber,line}`. Tool-card parses this shape into semantic path/match segments and never sends the raw JSON through Markdown rendering.
- `session.history` returns the complete public event range. Default CLI startup creates a new Session; `--continue`, `--resume <sessionId>`, or `/resume` is required to view an existing Session's history.

## 2026-08-29 source/install alignment

- Restart-visible behavior was stale because global `dsh-tui` was built at 07:40 while the worktree terminal-ui source changed at 07:43. Runtime changes require build, pack, global install, installed-marker/hash verification, and fresh PTY smoke before live conclusions.
- terminal-ui now requires typed `displayFrame`; its tests and app-container fixtures provide the projection explicitly. The old model/registry/tool-card fallback is not a valid test path.

## 2026-08-29 stable scrollback output

- Native inline scrollback requires complete stable row content, not only committed absolute row IDs. The chain is `terminal-render.scrollbackRows` -> `terminal-output.stableRows` -> one lifecycle-owned Ink `Static`; the dynamic tree excludes those stable rows.
- `DisplayBuffer` remains the sole absolute-row/stable-live owner. It does not emit ANSI, manage native scrollback, or own lifecycle. PageUp/PageDown application projection is a separate behavior from terminal-emulator scrollback and must be tested separately.

## 2026-08-30 Session revision epochs and persistent chrome

- App-container is the sole monotonic composition-revision owner. A Session identity switch is a control-side epoch boundary: app-shell may detect it and invoke `resetRevision()`, but must not duplicate revision guards or put Session identity into frame/presentation payloads.
- Persistent chrome follows one-fact-one-place: connection is one colored lamp with no state label, cwd replaces raw Session identity, runtime mode appears once, and the footer owns only model/thinking effort/permission plus errors and goal/keymap. Connection colors are closed to green connected, yellow connecting, and red disconnected/failed.
- Runtime status/chrome changes are not delivered until the absolute tarball is globally installed, changed owner hashes match `/opt/homebrew/lib/node_modules/dsh-tui`, and a fresh iTerm2 global replay proves the visible copy, color, input, resume, and cleanup behavior.
# 2026-08-30 UX/visual audit baseline

- The globally installed `/opt/homebrew/bin/dsh-tui` now realizes semantic TUI
  roles through a restrained truecolor palette at the terminal boundary; parser
  and tool-card contracts remain semantic and tests remain role-based.
- `tui-logo` owns a stable preamble projection. Startup prepends it to the
  display-element sequence; terminal lifecycle remains a carrier and does not
  know logo semantics. Dynamic header no longer visibly renders the logo.
- Execution status has a directional activity indicator refreshed every 180ms,
  plus elapsed time and Esc interrupt. Its animation is meaningful state
  feedback and remains understandable without color.
- The comparison harness treats idle as no execution region rather than an
  internal `[idle]` token and has fresh evidence for input/slash, overlays,
  resize, shell, six-round native scrollback, and running state.

## 2026-08-31 stable terminal flush ownership

- When several stable batches arrive before Ink finishes one render flush,
  replacing the queued React element loses earlier absolute rows: Ink `Static`
  advances to the sparse array length and never receives the skipped rows.
- `terminal-lifecycle` is the unique fix owner. Within one
  `sessionKey + width + paddingX` Static identity it accumulates pending stable
  rows by `absoluteRow`, while dynamic SSE frames still coalesce to the latest
  element. Session or layout identity changes start a separate batch.
- Stable-settlement delivery must be proven through the globally installed
  `/opt/homebrew/bin/dsh-tui`: observe user request -> tool card -> assistant
  result -> divider, repeat consecutive tool turns, restart with `--continue`,
  verify native terminal scrollback and fresh input, then compare installed and
  worktree owner hashes.
- The verified layout keeps cwd immediately below the composer. The final
  global artifact hash is
  `72b27b014f3336ff73a49354c9623df190ae2c0d65afe43275f36b10a58ee68c`;
  AGY Review `dsh-tui-stable-flush-global-final-20260831` passed with no
  findings.

Tags: #terminal-lifecycle #ink-static #stable-history #global-install #resume

## 2026-08-31 continue visibility closure

- `Workspace unavailable` is the explicit startup-shell placeholder in
  `tui-session`; it is not Session history and is not emitted by the raw ->
  presentation -> interpreter -> display-buffer pipeline.
- Host may persist an empty Session, but the Session owner preserves the real
  `blank` field and `latestCurrentCwdSession()` excludes blank and completed-
  work-free request-only Sessions. Startup's visible `/resume` projection
  excludes blank options, so users see only non-empty Sessions.
- Commit `4566c90` is pushed. The absolute artifact was rebuilt and installed
  at `/opt/homebrew/bin/dsh-tui`; a fresh global `--continue` PTY showed
  historical user/tool/assistant/divider rows with the latest output directly
  above the composer and no startup placeholder after connection. User PID
  `33991` and tmux session `dsh-codex` were untouched.

- 2026-08-31: Runtime verification must use a dedicated non-user cwd and
  dedicated test Session. Before delivery, remove every test Session created
  by the run and verify its exact persisted files and tmux/process resources
  are gone; never use `/Volumes/extension/code/dsh` as a test cwd.
## 2026-08-31 semantic theme contrast

- Tool/重点字段使用 One Dark 风格柔和青绿 `#56B6C2`，与正文 `#DCDFE4` 形成清晰层级；蓝色仅用于路径/链接，红色仅用于命令、错误和删除语义。
- 颜色仍由 `theme-plugin` 在语义解析后统一映射，parser/interpreter 不直接持有 hex。

## 2026-09-01 slash command admission

- `slash-command-plugin` is the sole owner of host command admission. Host
  names are a closed union (`plan`, `permission`, `model`, `compact`, `goal`,
  `doctor`, `rename`) with per-command argument-count schemas; unknown names
  and malformed shapes fail closed.
- Accepted host intents contain only typed command and args. They do not carry
  `rawLine`; startup reconstructs the session command only after admission.
- Global artifact was rebuilt, packed, installed, and the real PTY startup
  smoke reached the installed CLI. Focused tests, typecheck, runtime boundary,
  design check, and AGY review `dsh-tui-command-authorization-20260901` passed.

## 2026-09-03 sole agent-tui ownership

- agent-tui is owned end-to-end by this agent; do not hand off, claim, modify,
  or clean agent-memory, teams, main, or another worker worktree.
- Main-worktree cleanup requires first listing exact tracked and untracked
  targets, then using explicit paths; never infer ownership from a dirty
  summary or clean another worker's checkout.

## 2026-09-04 OpenCode continue selection

- OpenCode `/session` marks an empty session by omitting `summary` and reporting
  zero token usage. A session with completed work reports `summary` and/or
  positive token usage. The transport adaptor maps these facts to typed
  `SessionSummary.blank`; it does not synthesize DSH `sessionStats`.
- `TuiSessionService.latestCurrentCwdSession()` trusts the typed `blank`
  contract and excludes only blank/subagent/non-current-cwd candidates. This
  keeps the OpenCode adaptor independent of DSH-only projection keys.
- Final global package `agent-tui@0.1.0-mvp.1` tarball SHA-256 is
  `8824c60bc427a8987bc5c8d9143bdde1d93a40537cb9b0d7bf36264f2d2ae418`.
  With OpenCode 1.18.23 at `http://127.0.0.1:4096`, global `--continue`
  skipped an empty newer session and restored the older non-empty session with
  user/tool/assistant history; `/quit` exited 0.

Tags: #agent-tui #opencode #continue #session-selection #global-install
