# dsh-tui Scheme A Implementation Plan

Status: approved decision and executable Phase 0 plan.
Decision owner: Jason.
Decision date: 2026-08-26.
Base receipt: `origin/main` at `c7a259b5a8c30115fda6756c77dc434d9cd06e78`.

## 1. Objective

Make the installed dsh-tui present a usable five-region operator interface
with independent Cordis control/display ownership, stable terminal geometry,
and the approved Scheme A visual language.

The final visible frame is:

```text
Header      logo | connection | session | status
Transcript  conversation, reasoning, tools, errors, local echoes
Execution   current turn / operation state
Composer    prompt, text, cursor, mode; no red focus border
Footer      focus, keymap, viewport, notice/error
```

## 2. Approved visual decision: Scheme A, Dense Operator

- Near-black terminal background.
- Gray and dark-gray background blocks establish region hierarchy.
- White is the base text color.
- White is the base and active text color.
- Red is the only semantic accent, reserved for error, attention, focus, and
  irreversible action.
- Gray and dark-gray backgrounds plus bold/dim establish state hierarchy.
- Regions use background tone and spacing; no decorative rounded frames.
- Composer has no border and no red focus outline. Focus is shown by the
  cursor, composer tone, active mode, and footer keymap.
- Geometry is compact, left-aligned, stable across state changes, and based on
  terminal cells rather than browser breakpoints.

The decision board is the visual reference for this plan:

- `docs/design/tui-control-style-board.html`
- `docs/design/tui-control-style-decision.md`

The board is a design artifact. It is not a runtime dependency and is not
allowed to enter the package artifact.

## 3. Ownership and boundaries

```text
Session/presentation truth
          |
          v
    logic-controls
          |
   +------+------+
   |             |
   v             v
five display   functional controls
plugins        (composer/overlay/footer)
   |             |
   +------+------+
          v
   chrome-slot-registry
          v
     app-container
          v
      terminal-ui
          v
  terminal-lifecycle -> Ink
```

Required rules:

- `tui.logo`, `tui.connection`, `tui.session`, `tui.status`, and
  `tui.execution` each own one slot and one Cordis effect.
- `chrome-slot-registry` owns registration, canonical order, projection, and
  disposal. It does not scan source directories.
- `app-container` owns whole-frame region order and layout policy only.
- `terminal-ui` realizes terminal-neutral descriptors only.
- `terminal-lifecycle` owns the Ink instance, streams, restoration, and
  process outcome. It does not assemble regions or interpret business state.
- Refresh causes, focus, overlay state, cursor state, endpoint, provider,
  debug, and process-exit controls remain typed side-channel state and never
  enter business payloads or Session truth.

## 4. Execution milestones

Each milestone uses a new clean worktree from the newest `origin/main`, a
single semantic claim, a scoped change set, focused tests, build, design and
boundary checks, then a checkpoint commit. A milestone does not continue in a
dirty worktree after its checkpoint.

### Phase 0: decision and admission

Deliver this plan and the approved design decision. Bind the target owner,
paths, resources, mainline edges, and verification gates before product code.

### Phase 1: terminal style contract and lifecycle input

- Extend the closed terminal-neutral style contract only with approved
  background and text/border color tokens.
- Add positive and negative validation tests for every token.
- Route process SIGINT through the canonical app-shell input path so one Ctrl+C
  enters the existing three-second confirmation state and a second Ctrl+C
  exits. No direct lifecycle exit on the first Ctrl+C.
- Preserve explicit SIGTERM, SIGHUP, EOF, render failure, and rejection
  restoration paths.

### Phase 2: five-region Scheme A composition

- Apply Scheme A tokens to header, transcript, execution, composer, and footer.
- Remove all composer borders, including red focus borders at the outer
  app-container region and inner composer leaf.
- Keep transcript and execution content readable in empty, running,
  completed, failed, overlay, and narrow viewport states.
- Assert exactly one instance of each region and one shared publication
  revision per composed frame.

### Phase 3: control/display integration audit

- Verify the five display plugins and functional plugins are loaded by the
  canonical app-shell startup set before first composition.
- Verify slot registration is effect-owned and disposed with the plugin.
- Delete dead inline chrome/style helpers only after zero-reference proof.
- Keep all changes in the unique owner modules; no style logic in lifecycle or
  business/session modules.

### Phase 4: runtime acceptance

- Build the artifact and perform an isolated install.
- Run PTY checks at 80x24 and a resized viewport.
- Verify boot visibly contains all five regions, text input, cursor, status,
  footer keymap, and terminal restoration.
- Verify one-Ctrl+C notice, second-Ctrl+C exit, running cancel behavior, and
  nonzero failure projection.
- Verify official Host and WebUI same-Session convergence with the exact
  installed artifact when the external service is available.

### Phase 5: review and delivery

- Run the complete affected verification matrix on the unchanged candidate.
- Run AGY Review through the `agy-review` MCP only after build/install/restart
  and online evidence requirements are complete.
- Repair P0/P1 findings at the unique owner, create a new candidate, and rerun
  affected gates and review.
- On PASS, integrate to latest main, rerun main-tree gates, commit only the
  declared change set, push, and verify remote `main` equals local HEAD.

## 5. Verification matrix

Phase 0:

```bash
pnpm run check:design
pnpm run test:design
git diff --check
```

Phases 1-3 minimum:

```bash
pnpm run check
pnpm run test:terminal-ui
pnpm run build:terminal-ui
pnpm run test:terminal-lifecycle
pnpm run build:terminal-lifecycle
pnpm run test:chrome-slot-registry
pnpm run build:chrome-slot-registry
pnpm run test:tui-logo && pnpm run build:tui-logo
pnpm run test:tui-connection && pnpm run build:tui-connection
pnpm run test:tui-session && pnpm run build:tui-session
pnpm run test:tui-status && pnpm run build:tui-status
pnpm run test:tui-execution && pnpm run build:tui-execution
pnpm run check:runtime-boundaries
```

Phase 4 additionally requires `check:clean-install`, PTY evidence, and
official same-Session evidence. Unavailable external services remain explicit
open gates; no replacement Host, provider, Session, or dependency source is
permitted.

## 6. Commit contract

Before every checkpoint:

```bash
git diff --cached --stat
git diff --cached --name-status
```

Only the declared milestone paths may be staged. A review PASS is invalidated
by any later source, test, map, build, or runtime-configuration change.

Completion requires the pushed main receipt, exact candidate/runtime identity,
passing required gates, and review evidence. A visual board or passing unit
test alone is not completion evidence.
