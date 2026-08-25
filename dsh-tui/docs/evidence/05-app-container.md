# Gate evidence: app-container composition

Date: 2026-08-21
Baseline product commit: `286fe9d`

## Result

The app-container change and its P2 remediation passed the required local
verification stack from the clean worktree:

- `pnpm run typecheck`: PASS;
- `pnpm run check:runtime-boundaries`: PASS;
- `pnpm run test:app-container`: 4/4 PASS;
- `pnpm run test:terminal-ui`: 12/12 PASS;
- `pnpm run test:terminal-lifecycle`: 19/19 PASS;
- `pnpm run test:app-shell`: 20/20 PASS;
- `pnpm run test:runtime`: 4/4 PASS;
- `pnpm run build:app-container`: PASS;
- `pnpm run build:terminal-lifecycle`: PASS;
- `pnpm run build:runtime`: PASS;
- `pnpm run check:clean-install`: PASS;
- `expect scripts/pty-smoke.exp`: PASS; the captured output is stored in
  `docs/evidence/pty/05-app-container-pty.log`;
- PTY output showed DSH, connection state, Session, Status, execution,
  Composer and Footer, then `/quit` reached `PTY_EXIT_REACHED`.

The AppSDK beta maps under `.appsdk/` are local governance state and are not
part of the product commit.


## Phase E status-footer (2026-08-26)
- main receipt: `5761cb4`
- AGY Review: PASS (empty findings)
- clean install SHA-256: `3ea95430cf45e28974485970ebaa1559ad4bff3aa66cc4861bf2d3eb7410f865`
