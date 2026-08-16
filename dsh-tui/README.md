# dsh-tui

Independent out-of-tree DSH TUI bundle under `~/code/dsh-plugins/dsh-tui`. Its source, native workspace, tests, release scripts, and presentation adapter stay inside this plugin directory. Installed DSH packages are external peer dependencies; this plugin does not add source or packages to the DSH monorepo.

The intended product entry is a custom profile created by installing this package:

```sh
dsh plugin --profile tui add <package-spec>
dsh --profile tui
```

`tui` is not a shipped profile template in current DSH. The first command creates the profile with `@deepseek-ai/dsh-base` and adds this package as the next bundle layer.

Current status: config-driven runtime implemented. The Node host creates or resumes an Agent through public DSH services, derives the transcript with `Session.deriveMessages()`, parses Markdown with the host-side micromark/mdast stack, and sends terminal-neutral projection cells to a Rust Ratatui renderer over four inherited stdio pipes. The renderer owns only terminal layout and input; it does not reconstruct DSH business state.

Build and run locally:

```sh
pnpm install
pnpm run check
dsh plugin --profile tui add <package-or-checkout>
dsh --profile tui
dsh --profile tui --resume <session-id>
```

Composer controls:

- `Enter` or `Ctrl+J` submits the current line.
- `Ctrl+C` cancels the active turn.
- `Ctrl+Q` requests a graceful host shutdown after the session is flushed.

Generated artifacts (`lib/`, `native/target/`, `node_modules/`) are ignored and are not part of the source commit.

Current design-gate result:

```text
DESIGN_MAPS: PASS (58 capabilities, 9 owned runtime sources)
RUNTIME_CONFIGURATION: READY
```

Review entry points:

- [Design specification](docs/design-spec.md)
- [Resource map](docs/architecture/resource-map.yaml)
- [Module registry](docs/architecture/module-registry.yaml)
- [Function map](docs/architecture/function-map.yaml)
- [Mainline call map](docs/architecture/mainline-call-map.yaml)
- [Verification map](docs/architecture/verification-map.yaml)
- [Lifecycle manifest](docs/architecture/lifecycle.yaml)
- [Test design](docs/architecture/test-design.yaml)
- [Protocol](docs/architecture/protocol.yaml)
- [Projection window budget](docs/architecture/projection-window-budget.yaml)
- [Capability bindings](docs/architecture/capability-bindings.yaml)

Validate the design-only registry with:

```sh
pnpm install --ignore-scripts
pnpm run check:design
```

The approved implementation boundary is recorded in the detailed design. Missing published DSH presentation entrypoints block the affected capability; they do not permit checkout-relative imports or a copied business projection.
