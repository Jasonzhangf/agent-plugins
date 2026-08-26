# TUI Chrome Render Seam Plan

Status: superseded by the chrome-slot-registry and five independent display plugin modules.

## Goal And Acceptance

Finish the chrome extraction seam so `terminal-lifecycle` consumes closed,
generic `TuiChromeRenderNode` values instead of assembling logo, connection,
session, status or execution controls. Preserve the five independent Cordis
slot plugins and keep refresh/invalidation ownership in app-container.

Acceptance:

- terminal-lifecycle contains no concrete chrome key, field name, text, or state
  branch for the five extracted controls.
- app-container projects exactly five ordered render nodes on compose and
  monotonic refresh.
- malformed or incomplete render nodes fail through the existing typed
  composition boundary; there is no fallback or silent strip.
- default and compact layouts consume the same nodes with different placement.
- all affected design, module, typecheck, boundary, build, and PTY gates pass.
- DSH Review returns an unambiguous semantic PASS after runtime evidence.
- the reviewed commit merges cleanly into `origin/main`.

## Current Evidence

- Branch: `feature/tui-chrome-plugins-20260821T222701Z-Macstudio-82661-chrome-plugins`.
- Pushed baseline: `98ff4c0`; branch is ahead of `origin/main` by 17 and behind
  by 2 (`286fe9d`, `11ab30e`).
- Current work has partial render-node changes and is not green.
- `test:app-container` fails because its deep-equal expects four header keys but
  the projection correctly also supplies `chrome.execution`.
- `check:design` fails on undeclared `app-container -> terminal-lifecycle`.
- `terminal-lifecycle.ts` still hard-codes header controls and execution.

## Boundary Decision

Do not register `app-container -> terminal-lifecycle` merely to silence the
gate. The shared terminal-shell contract already lives in terminal-ui and is
consumed through the existing bidirectional type-contract edge between
terminal-ui and terminal-lifecycle. Therefore:

- move `chrome-render-node.types.ts` to `contracts/tui/terminal-ui/`;
- add the optional closed `chromeNodes` field to the shell metadata contract;
- import it from app-container through the existing app-container ->
  terminal-ui edge;
- consume it in terminal-lifecycle through the existing terminal-lifecycle ->
  terminal-ui type-contract edge;
- keep app-container as the only producer and terminal-lifecycle as the only
  Ink renderer.

## Implementation Steps

1. Move and extend the render-node contract under terminal-ui. Keep placement
   limited to `header` and `execution`, keep node fields closed, and retain the
   strict validator.
2. Replace the terminal-lifecycle cast-based accessor with the typed shell
   contract field.
3. Correct the app-container test to assert all five keys and values. Add
   negative coverage for malformed/unknown-field nodes and renderer placement
   filtering before changing rendering behavior.
4. Generalize terminal-lifecycle rendering: filter header nodes in projected
   order, select the single execution node, and construct Ink `Text` elements
   from generic fields only.
5. Fix refresh-path formatting and ensure both initial composition and refresh
   project identical frozen nodes for unchanged state.
6. Sync machine truth without adding a reverse module edge:
   - function map binds `chromeRenderNodes` to app-container;
   - mainline call map records app-container render-node production and
     lifecycle consumption as adjacent edges;
   - resource relations record `typed_chrome_render_nodes`;
   - test design adds positive, negative, whitebox, and PTY expectations.
7. Extend the design verifier to reject hardcoded chrome assembly, require the
   validator call, require placement-driven rendering, and reject the
   app-container -> terminal-lifecycle edge.

## Verification Matrix

Run from `dsh-tui` with AppSDK 0.1.3 first on PATH:

```sh
export PATH="/Users/fanzhang/.local/lib/appsdk/0.1.3:$PATH"
pnpm run test:app-container
pnpm run test:terminal-lifecycle
pnpm run test:chrome-slot-registry
pnpm run test:tui-logo
pnpm run test:tui-connection
pnpm run test:tui-session
pnpm run test:tui-status
pnpm run test:tui-execution
pnpm run test:app-shell
pnpm run test:design
pnpm run check:design
pnpm run check:runtime-boundaries
pnpm run typecheck
pnpm run build:app-container
pnpm run build:terminal-ui
pnpm run build:terminal-lifecycle
pnpm run build:app-shell
pnpm run build:runtime
expect scripts/pty-smoke.exp
git diff --check
```

PTY evidence must show all five rendered values, both layout behavior where
covered, `/quit`, terminal restoration, and child exit zero.

After the local change set is committed, merge `origin/main`, rerun the full
affected matrix plus PTY on the merged tree, then start read-only DSH Review
with no provider/model override. Only a semantic PASS authorizes merging into
main.

## Risks

- A reverse dependency would pass today's compile but weaken module ownership.
- Renderer-side conditional styling can reintroduce chrome semantics if fields
  are interpreted by control name rather than generic style fields.
- Refresh must not append duplicate nodes or reset publication revision.
- The feature branch already diverges from main by two commits, so the merged
  tree, not the pre-merge tree, is the review subject.

## Deferred Queue

Only after this seam merges:

1. extract slash-command interaction into its Cordis-facing control plugin;
2. extract session switch/resume selector control;
3. extract overlay registration and focus handoff;
4. unify remaining refresh invalidation behind app-container revision policy.
