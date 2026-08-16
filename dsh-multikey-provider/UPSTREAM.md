# Installed Runtime Baseline

`dsh-multikey-provider` targets released DSH `0.1.0-rc.6`. A Harness checkout
is read-only reference material and is never required to install or run the
plugin.

The host composes only the public installed entrypoint:

- `@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.6`
  - npm tarball SHA-256: `a29d1a1aaaa513524315ee39b6a940d76082759d55bdee6a5b691f16cc620902`
  - installed `package.json`: `81abcbc323881abff0f565be1aa749446c04731c748499cf98ede8d3cdc8f4dc`
  - installed `lib/index.js`: `61e0164ccb648cea986a869aa42a81fab2ce6b56538d8e187597084fc23c9d3a`

The client baseline remains installed but is not imported at runtime:

- `@deepseek-ai/dsh-client-ui-settings-models@0.1.0-rc.6`
  - npm tarball SHA-256: `43648b0891f71d9df32f05bee54c40d4c543f88d84a63e8cf4595519ad72d52a`
  - installed `package.json`: `f954c2aa977f9f588ca7e9fc8e6753784293f21da65907cb4c361905480f9553`
  - installed `lib/client.js`: `203a45293da9403be449e7452a155cba07d66a719c0b32d500f66cf0ba528f1d`

The official Provider is an exact peer/development contract and is not listed
in plugin `dependencies`. The official Models package is a development-only
parity baseline. No official `src/*` path, private implementation, or compiled
client bundle is imported or copied.
