# Slash command expansion plan

## Goal

Expand `dsh-tui` slash-command-plugin to recognize the full DSH WebUI command set and surface authoritative Host responses errors to the user. See `docs/goals/slash-command-expansion-plan.md` for the canonical plan binding.

## Implementation order

1. types: TuiHostCommandKind + 'new' + 'host' intent ✅
2. slash-command-plugin.ts: parser extension ✅
3. startup.ts: dispatchControl routing for /new + host commands + reportAsyncFailure preserves Host error code/message ✅
4. tests: 6 new tests (14/14 PASS) ✅
5. typecheck: PASS ✅
6. build:slash-command-plugin: PASS ✅
7. test:app-shell: 10/10 PASS ✅

## Verification

- pnpm run test:slash-command-plugin: 14/14
- pnpm run typecheck: PASS
- pnpm run build:slash-command-plugin: PASS
- pnpm run test:app-shell: 10/10
