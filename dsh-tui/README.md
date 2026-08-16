# dsh-tui

Independent out-of-tree DSH TUI bundle under `~/code/dsh-plugins/dsh-tui`. Its source, native workspace, tests, release scripts, and presentation adapter stay inside this plugin directory. Installed DSH packages are external peer dependencies; this plugin does not add source or packages to the DSH monorepo.

The intended product entry is a custom profile created by installing this package:

```sh
dsh plugin --profile tui add <package-spec>
dsh --profile tui
```

`tui` is not a shipped profile template in current DSH. The first command creates the profile with `@deepseek-ai/dsh-base` and adds this package as the next bundle layer.

Current status: approved dispositions and requested design corrections are recorded; implementation admission remains blocked. Runtime and codec authoring have not started. `cordis.patch.yml` is deliberately empty, so installing this checkout activates no runtime row. There is no `src/`, `native/`, executable, build, or install artifact yet.

Current design-gate result:

```text
DESIGN_MAPS: PASS (50 Host bound, 0 projection bound, 1 approved N/A, 7 blocked)
IMPLEMENTATION_ADMISSION: BLOCKED
RELEASE_ADMISSION: BLOCKED
```

There is no `ADMISSION_LOCK: PASS` signal. Codec/runtime unlock only when the implementation gate dynamically proves 50 Host bindings, 7 projection bindings, 1 approved N/A, zero blocked capabilities, and clean-registry release artifacts. Release/delivery remains a separate post-implementation gate.

Clean-registry evidence is accepted only when every required package resolves inside the declared clean install root, outside the DSH checkout, has the required installed version, and has the same registry integrity in the clean lockfile and release-artifact manifest. Release evidence records `git write-tree` and the SHA-256 of `git diff --cached --binary --full-index HEAD` before DSH Review, and the review prompt binds both values. After commit and upload, the checker requires a remote-tracking ref containing the commit, requires the uploaded commit tree and commit-versus-parent diff to match that reviewed state, and independently parses the DSH Review evidence directory for a final semantic PASS.

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
