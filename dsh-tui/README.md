# dsh-tui

Fresh AppSDK-governed design for an independent Node/Cordis terminal client of the official DSH Web host.

Canonical design: [`.appsdk/architecture/tui-v2-design.md`](.appsdk/architecture/tui-v2-design.md)

Review surfaces:

- [Component model](.appsdk/architecture/component-model.md)
- [Codex TUI selection audit](.appsdk/architecture/codex-tui-selection-audit.json)
- [Official WebUI capability audit](.appsdk/architecture/official-webui-capability-audit.json)
- [Capability bindings](.appsdk/architecture/capability-bindings.json)
- [Transport and session admission contract](.appsdk/architecture/transport-contract.md)
- [Markdown differential-conformance contract](.appsdk/architecture/markdown-conformance.md)
- [Static simulator specification](.appsdk/architecture/static-simulator-spec.md)

Current state: design only. No runtime implementation or installable package exists.

Verify AppSDK bootstrap validity only:

```sh
appsdk verify .
```

Verify the complete design contract and map lockstep before implementation:

```sh
pnpm run check:design
```

`appsdk verify` alone does not prove design admission. `check:design` runs it first, then validates capability bidirectional coverage, project/module lockstep, lifecycle/mainline lockstep, gate references, resource references, component ownership, endpoint precedence, minimum Remote mounting, fail-closed cwd resume and the pinned Markdown corpus contract. Its successful result still reports implementation admission blocked until clean-registry, fixture, Markdown differential and runtime gates pass.
