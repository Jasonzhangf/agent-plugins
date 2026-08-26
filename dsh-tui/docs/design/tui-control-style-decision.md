# DSH TUI Control Style Decision

Status: approved by Jason on 2026-08-26.

## Selected direction

Scheme A: Dense Operator.

- Near-black terminal background with gray and dark-gray region blocks.
- White base text.
- Cyan/green for ready state, yellow for active state.
- Red only for error, attention, or irreversible action.
- Stable, compact, left-aligned terminal-cell geometry.
- Region hierarchy comes from background tone and spacing, not decorative
  rounded borders.

## Fixed regions

1. Header: logo, connection, session, and status.
2. Transcript: conversation, reasoning, tools, errors, and local echoes.
3. Execution: current turn and operation state.
4. Composer: prompt, text, cursor, and mode.
5. Footer: focus, keymap, viewport, and notice/error.

## Input rule

The composer has no border, including no red focus border. Focus is expressed
by the visible cursor, composer background tone, active mode, and footer
keymap. This preserves text selection and copying.

## Architecture rule

The visual tokens are projected by terminal-neutral Cordis/plugin layers.
`terminal-lifecycle` only owns the Ink carrier, streams, restoration, and
process outcome. It does not assemble regions or interpret business state.
