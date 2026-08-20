# Gate evidence: PTY, live Host, reconnect, and dual client

Date: 2026-08-19
Endpoint: `http://127.0.0.1:3080`
Session: `session-b49440dc-5600-4fe4-8141-5371010eb5c9`
CWD: `/Volumes/extension/code/dsh-plugins/playground/dsh-tui-runtime-20260817T101736Z-Macstudio-60685-cfeef2/dsh-tui`

## Real PTY

The current clean-installed artifact (`dsh-tui@0.1.0-mvp.1`, tarball SHA-256
`6e31a1ff3beae80461cf57f01bf797816d6c86beb82eb4b87d3669663cb19443`) ran under
Expect's real pseudo-terminal at 80x24 against the official Host. The harness
waited until Ink rendered `cursor=5 mode=idle` after `/quit`, sent Return as a
separate key event, observed alternate-screen/cursor restoration, reached EOF,
and propagated the child status:

```text
CURSOR_IDLE_MATCHED
PTY_EOF
PTY_WAIT_RESULT=63014 exp6 0 0
PTY_CHILD_EXIT=0
```

Evidence log: `/tmp/dsh-tui-online-clean-pty-20260819-1800.log`.

The same clean artifact's public client also completed an online probe:

```text
endpoint=http://127.0.0.1:3080
host_pid=31205
host_version=0.0.1
host_provider=opencode-go-pool
host_model=deepseek-v4-flash
session_list_count=781
current_cwd_session_count=65
```

The first failing replay proved the old harness could merge text and Return
into one paste-shaped read and could report success after timeout. The repaired
harness sets PTY dimensions before spawn, waits for the exact rendered cursor
state, fails on either input or exit timeout, and returns the actual child exit
code.

## Reconnect and history rebaseline

Transport now reconnects the same public mux/host WebSocket after an
unexpected peer close. Session owns history convergence: every mux generation
after the first calls public `sessions.history`, atomically replaces the last
good history/projections, clears stale pending interactions, then admits new
frames. Rebaseline failure is an explicit session error and preserves the last
good history.

Paired evidence:

- positive: peer close creates generation 2; the mux open callback fires
  twice; history `[0,1]` is replaced by `[0,1,2,3]` before new frames;
- negative: explicit abort creates no replacement socket; failed history
  rebaseline reports `session.history failed`, stays non-live, and retains
  `[0,1]`.

The current built TUI was also kept alive while the exact official `dsh web`
process was stopped and restarted. It resumed the same Session, re-rendered the
existing history, accepted `/quit`, restored the terminal, and exited 0.

## Official Web profile zero diff

Before and after the exact Host restart:

```text
63df5d5c7e6b39e9d270620f3b0de67562a4b12f56e33a24eefd34a7a0d2e49d  ~/.dsh/profiles/web/package.json
ffac521292283875734820f3c89544a79380b304d66ecdd0021e0057f2932e07  ~/.dsh/profiles/web/cordis.patch.yml
```

The TUI connected only as a client; it did not mount, install into, or rewrite
the Web profile.

## Same-Session dual-client evidence

The current full replay is recorded in
`docs/evidence/webui-dual-client/2026-08-19-live.md`.

The official WebUI submitted `DSH_TUI_WEBUI_A` and `DSH_TUI_WEBUI_B`; the clean
installed TUI resumed the same Session and rendered the first message, then
observed the second while connected. The TUI submitted `DSH_TUI_TUI_C`; the
official WebUI displayed it, and public `session.history` recorded all three
user events. Both clients observed the same authoritative provider error.

The locked `opencode-go/deepseek-v4-flash` request returned
`GoUsageLimitError` (weekly limit, reset in four days) on all three turns. No
model or provider substitution was attempted. Streaming state and error
convergence are verified; successful assistant-token streaming remains an
external quota gap and is not claimed as closed.
