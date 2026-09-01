# dsh-tui

Independent Node/Cordis + Ink terminal client for the official DSH Web host.

The package creates or resumes the current working directory's DSH Session and
renders its public history and live events in a terminal UI. It is a client-only
surface: it does not mount `dsh-base`, replace the official WebUI, create a
second Host, or read private DSH source.

Canonical design: [`.appsdk/architecture/tui-v2-design.md`](.appsdk/architecture/tui-v2-design.md)

Review surfaces:

- [Component model](.appsdk/architecture/component-model.md)
- [Codex TUI selection audit](.appsdk/architecture/codex-tui-selection-audit.json)
- [Official WebUI capability audit](.appsdk/architecture/official-webui-capability-audit.json)
- [Capability bindings](.appsdk/architecture/capability-bindings.json)
- [Transport and session admission contract](.appsdk/architecture/transport-contract.md)
- [Markdown differential-conformance contract](.appsdk/architecture/markdown-conformance.md)
- [Static simulator specification](.appsdk/architecture/static-simulator-spec.md)

Current state: MVP runtime implemented in the declared Playground worktree.
Registry release, PTY evidence and online dual-client verification remain
release gates; local tests alone are not a usability claim.

Runtime build and focused verification:

```sh
pnpm run build:runtime
pnpm run check
pnpm run typecheck
pnpm run check:runtime-boundaries
pnpm run test:runtime
```

The built CLI is `lib/cli.js`. It accepts `--endpoint`, `--resume` and
`--cwd`; endpoint precedence is CLI, then `DSH_WEB_URL`, then
`http://127.0.0.1:3080`.

Verify AppSDK bootstrap validity only:

```sh
appsdk verify .
```

The project governance maps and lifecycle contracts are validated by the
AppSDK command above. Runtime source boundaries are checked separately:

```sh
pnpm run check:runtime-boundaries
```
