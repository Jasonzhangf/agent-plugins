# DSH TUI Control Style Decision

Status: approved by Jason on 2026-08-26.

## Selected direction

Scheme A: Dense Operator.

- Near-black terminal background with gray and dark-gray region blocks.
- White base text.
- White is the base and active text color.
- Red remains the attention/error accent. The connection lamp is the sole
  control-surface exception: green means connected, red means connecting,
  and red means disconnected or failed. The lamp carries no duplicate text.
- Gray and dark-gray backgrounds establish region hierarchy; bold and dim
  establish state hierarchy.
- Stable, compact, left-aligned terminal-cell geometry.
- Region hierarchy comes from background tone and spacing, not decorative
  rounded borders.

## Fixed regions

1. Header: logo, one connection lamp, workspace path, and runtime status.
2. Transcript: conversation, reasoning, tools, errors, and local echoes.
3. Execution: current turn and operation state.
4. Composer: prompt, text, cursor, and mode.
5. Footer: focus, keymap, viewport, and notice/error.

## Status density rule

- Never render a raw Session ID in persistent chrome.
- Connection appears once as the header lamp, without `connected` text.
- Workspace path appears once in the header.
- Model, thinking effort, and permission appear once in the footer.
- Runtime errors remain visible; persistent chrome does not repeat equivalent
  connection, Session, workspace, or idle labels across header and footer.

## Input rule

The composer has no border, including no red focus border. Focus is expressed
by the visible cursor, composer background tone, active mode, and footer
keymap. This preserves text selection and copying.

## Architecture rule

The visual tokens are projected by terminal-neutral Cordis/plugin layers.
`terminal-lifecycle` only owns the Ink carrier, streams, restoration, and
process outcome. It does not assemble regions or interpret business state.

## Content typography and palette

Semantic names remain part of the parser and display contracts. The terminal
realization maps them to this restrained palette so the same roles remain
readable in ANSI and truecolor terminals:

| Role | Realized color | Treatment |
| --- | --- | --- |
| Body / user / assistant | `#DCDFE4` | normal weight |
| Thinking / secondary text | `#DCDFE4` | dim; never bold |
| Successful tool marker | `#98C379` | one leading dot only |
| Failed tool marker | `#E06C75` | one leading dot only |
| File path | `#61AFEF` | normal weight |
| Command and `--` arguments | `#E06C75` | normal weight; `Ran` stays body color |
| Divider | `#DCDFE4` | dim |
| Warning / connecting state | `#E0C086` | normal weight |

Region surfaces use `#1E2127` (base), `#313439` (composer), and `#282C34`
(footer). The terminal font itself is user-owned; TUI typography is therefore
limited to normal text, bold headings, and dim secondary content. Tool cards
keep one blank row above and below, and round dividers remain dim so spacing
carries structure without saturated decoration.
