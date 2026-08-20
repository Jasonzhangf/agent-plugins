# Gate evidence: clean registry install

Gate: `clean_registry_install` + package/profile verification (MVP release gate item 1).
Date: 2026-08-19 (current verified tree).
Host: 127.0.0.1:3080 DSH Web Host (online client verified separately).

## What was verified

The `dsh-tui` package packs to a real tarball containing only intentional files
(`lib/**` JS+d.ts, `package.json`, `README.md`, `cordis.patch.yml`,
`lib/contracts/tui/component-registry/manifest.json`) with **no** `node_modules`,
`generated/`, stale root `*.js`, cache, screenshot or secret. Installing that packed
artifact into a pristine directory pulls every runtime dependency from the npm registry
(no `file:`/checkout, `link:`, `portal:`, `workspace:`, git or ssh specifiers).

## Procedure

```
pnpm run build:runtime
pnpm pack --pack-destination /tmp/dsh-tui-final-clean.vCMh22
cd /tmp/dsh-tui-final-clean.vCMh22
npm init -y
npm install --cache /tmp/dsh-tui-final-cache.bwj0vO ./dsh-tui-0.1.0-mvp.1.tgz
npm ls --all
DSH_TUI_CLEAN_INSTALL_ROOT=/tmp/dsh-tui-final-clean.vCMh22 node <worktree>/scripts/verify-public-exports.mjs
node node_modules/dsh-tui/lib/cli.js --help
node -e "import('dsh-tui').then(m=>console.log(Object.keys(m).sort().join(', ')))"
```

## Results (current source tree)

- `pnpm run check:clean-install` exits 0.
- Current tarball SHA-256: `6e31a1ff3beae80461cf57f01bf797816d6c86beb82eb4b87d3669663cb19443`.
- Isolated install root: `/var/folders/jm/blkk8bbd6v78rv2pwxgxh3kr0000gn/T/dsh-tui-clean-install-uJpTw6`.
- Installed package realpath:
  `/private/var/folders/jm/blkk8bbd6v78rv2pwxgxh3kr0000gn/T/dsh-tui-clean-install-uJpTw6/install/node_modules/dsh-tui`.
- `npm install` and `npm ls --all` both exit 0; the package is a real directory and
  every runtime dependency is registry-resolved. No invalid peer dependency remains.
- Installed CLI `--help` and clean-root public export verification exit 0.
- The installed manifest pins every `@deepseek-ai/*` runtime dependency to
  `0.1.0-rc.6`, matching the official Host.
- No `link:` / `portal:` / `workspace:` / git / ssh specifiers in the install lock.
- No symlinks from the installed `node_modules/dsh-tui` into the project.
- `verify-public-exports.mjs` with `DSH_TUI_CLEAN_INSTALL_ROOT=/tmp/dsh-tui-final-clean.vCMh22`
  => `PUBLIC_EXPORTS: PASS (install_root=/tmp/dsh-tui-final-clean.vCMh22)`.
- Installed CLI `node node_modules/dsh-tui/lib/cli.js --help` => exit 0, prints usage
  (does not require tsx at runtime; build rewrites the entry wrapper to `import('./src/cli.js')`).
- Installed package root import resolves 16 public exports:
  `DEFAULT_ENDPOINT, NodeApiClient, TuiPresentationService, TuiSessionError,
  TuiSessionService, assertProfileUnchanged, canonicalCurrentCwd, installClientOnlyProfile,
  installer, isLoopbackHostname, projectSession, resolveEndpoint, snapshotProfile, startTui,
  uninstallClientOnlyProfile, validateEndpoint`.
- `node_modules/.bin/dsh-tui` bin entrypoint present.
- Installed package is a real directory, not a checkout/symlink.
- Current tarball SHA-256: `d33d1a94d93124400d239daa9c7041085305141f30bfd0683f36a567a0081429`.

## Status

CLOSED for the current source tree. The artifact was installed into a pristine
isolated root, checked with `npm ls --all`, and exercised through the installed
CLI and public exports. No checkout, link, workspace, portal, or dependency
fallback was used.
