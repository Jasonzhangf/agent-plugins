# dsh-tui

Independent out-of-tree DSH TUI bundle under `~/code/dsh-plugins/dsh-tui`. Its source, native workspace, tests, release scripts, and presentation adapter stay inside this plugin directory. Installed DSH packages are external peer dependencies; this plugin does not add source or packages to the DSH monorepo.

The product entry is DSH's shipped `web` profile with this bundle installed as
one persistent additional layer. Release and install it from this checkout:

```sh
pnpm install
pnpm run release:install
```

The command runs the full package check, writes an immutable tarball under
`~/.dsh-plugins/dsh-tui/releases/<version>-<commit>/`, and installs that exact
artifact into `~/.dsh/profiles/web`. `~/.dsh-plugins` is a symlink to
`/Volumes/extension/dsh-plugins`. The profile manifest is the persistent load
truth, so every later start needs only:

```sh
dsh --profile web
```

Current status: config-driven runtime implemented. The Node host creates or resumes an Agent through public DSH services, derives the transcript with `Session.deriveMessages()`, parses Markdown with the host-side micromark/mdast stack, and sends terminal-neutral projection cells to a Rust Ratatui renderer over four inherited stdio pipes. The renderer owns only terminal layout and input; it does not reconstruct DSH business state.

Build and run locally:

```sh
pnpm install
pnpm run check
pnpm run release:install
dsh --profile web
dsh --profile web --resume <session-id>
```

## Single-process TUI + Web

The same DSH process hosts both surfaces on the same live Session. DSH already
ships the Web bundle; `dsh-tui` contributes only the combined startup provider
and TUI runtime. No Web package is reinstalled and no per-start `--patch` is
required.

The terminal prints the shared session id (`dsh tui session: ...`) and the Web
bundle prints the browser URL. Open that URL and select the printed session in
the Web sidebar; both surfaces submit, cancel, and project the same Session.
Resume the same id with `--resume <id>` on later boots.

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

Validate the architecture registry with:

```sh
pnpm install --ignore-scripts
pnpm run check:design
```

The approved implementation boundary is recorded in the detailed design. Missing published DSH presentation entrypoints block the affected capability; they do not permit checkout-relative imports or a copied business projection.
