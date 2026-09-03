# Gate evidence: static simulator browser

Gates: `simulator_fixture_parity` + browser visual evidence (MVP release gate item 5; the human
`visual_approval` gate remains Jason's sign-off on the linked screenshots).

## What was verified

The offline static web simulator renders the shared canonical fixture bundle
(`contracts/tui/fixtures`) into `generated/simulator/index.html`, with the same 6
canonical fixture IDs the terminal tests consume (separate renderer registries:
browser simulator vs Ink terminal). Browser evidence proves it is nonblank, complete
and readable at desktop AND narrow viewport widths with no clipping.

## Procedure

```
pnpm run build:simulator
NODE_PATH=/opt/homebrew/lib/node_modules node scripts/capture-simulator-evidence.mjs
# script: launches system Chrome (channel chrome) via playwright, loads index.html,
# renders at 1280x900 and 400x800, counts fixture cells, checks text, overflow,
# writes docs/evidence/simulator/simulator-{desktop,narrow}.png + report.json
```

## Results (docs/evidence/simulator/report.json)

Both viewports (desktop 1280x900, narrow 400x800):

- `cellCount = 6`, `cellsWithText = 6` (every fixture cell non-empty)
- `textLength = 535`
- cell kinds: conversation.user, conversation.assistant, conversation.reasoning,
  tool.terminal, conversation.turn-error, conversation.turn-tail
- fixture ids: user-message-40x12, assistant-streaming-80x24, reasoning-streaming-80x24,
  tool-terminal-running-120x36, turn-error-40x12, turn-status-running-120x36
- `hasTitle = true`
- `noHorizontalOverflow = true`, `noVerticalOverflow = true` (nothing clipped/truncated)

Screenshots for human review:
- docs/evidence/simulator/simulator-desktop.png
- docs/evidence/simulator/simulator-narrow.png

These fixture IDs are the same canonical bundle consumed by the terminal/Ink tests
(`tests/terminal-ui`, fixture-contract). The simulator never connects to DSH
(covered by `tests/simulator`: offline-only guard).

## Status

CLOSED (machine-verified nonblank/complete/readable/no-overflow at desktop + narrow).
Human `visual_approval` = pending_jason on the linked screenshots.
