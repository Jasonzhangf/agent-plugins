# Gate evidence: full MVP regression

Date: 2026-08-19
Pinned AppSDK: 0.1.3 (`e3c36ae25c94d0c01c81cfe084fac7de8dc577f5ba3b8f91ae18b9d0587631a5`)

## Result

The replacement candidate passed the local architecture, test and build portion
of the registered MVP verification stack from the declared clean worktree. The
same source tree was then packed, installed into a pristine registry-only root,
and exercised against the official Host with the same artifact identity:

- `appsdk verify .`: PASS, project `dsh-tui`, stage `draft`;
- aggregate design gate: 33/33 red tests, TypeScript typecheck and runtime-boundary scan PASS;
- module suites: app-event-bus 7, transport 10, session 16, presentation 7,
  Markdown 7, component-registry 11, focus-manager 9, terminal-lifecycle 16,
  fixture-contract 6, terminal-ui 9, app-shell 17, installer 4, simulator 6,
  runtime 4; zero failures/skips;
- every corresponding module build and the final runtime build exited 0;
- `regression_report` command: PASS, including PTY restoration;
- clean-registry artifact SHA-256:
  `6e31a1ff3beae80461cf57f01bf797816d6c86beb82eb4b87d3669663cb19443`;
- installed PTY exit and restoration: PASS;
- official WebUI/TUI same-Session online replay: PASS for bidirectional event,
  history and error convergence; provider quota prevented assistant-token
  streaming.

The remaining delivery-state blockers are `dual_client_live_session`'s
successful assistant-token streaming subrequirement, `visual_approval`,
`architecture_review_pass`, and `mainline_merge_identity`. The online provider
returned the authoritative weekly quota error and was not replaced or bypassed.

## Positive and negative locks

Positive tests prove public Host connectivity, same-cwd Session selection,
history hydration/rebaseline, canonical projection, typed component resolution,
one Ink composition/lifecycle, client-only installation and fixture parity.

Negative tests prove malformed endpoints/frames, cross-cwd resume, sequence
gaps, failed reconnect history, raw-event/control leakage, unknown components,
wrong input families, invalid install specs and lifecycle shortcuts fail closed.

## Status

REGRESSION GATE PASS. Clean-registry install, installed PTY and same-Session
bidirectional online event/error replay are evidenced for the current artifact;
the locked provider quota is the remaining external runtime gap.


## Phase E status-footer (2026-08-26)
- main receipt: `5761cb4`
- AGY Review: PASS (empty findings)
- clean install SHA-256: `3ea95430cf45e28974485970ebaa1559ad4bff3aa66cc4861bf2d3eb7410f865`
