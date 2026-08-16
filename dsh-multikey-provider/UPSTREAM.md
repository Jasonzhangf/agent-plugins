# Upstream Baseline

The replacement composes public package entrypoints only:

- `@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.6`
  - npm tarball SHA-256: `a29d1a1aaaa513524315ee39b6a940d76082759d55bdee6a5b691f16cc620902`
  - installed artifact SHA-256: `package.json` `81abcbc323881abff0f565be1aa749446c04731c748499cf98ede8d3cdc8f4dc`; `lib/index.js` `61e0164ccb648cea986a869aa42a81fab2ce6b56538d8e187597084fc23c9d3a`
- `@deepseek-ai/dsh-client-ui-settings-models@0.1.0-rc.6`
  - npm tarball SHA-256: `43648b0891f71d9df32f05bee54c40d4c543f88d84a63e8cf4595519ad72d52a`
  - installed artifact SHA-256: `package.json` `f954c2aa977f9f588ca7e9fc8e6753784293f21da65907cb4c361905480f9553`; `lib/client.js` `203a45293da9403be449e7452a155cba07d66a719c0b32d500f66cf0ba528f1d`

Both rc.6 npm manifests expose no `gitHead` and ship compiled `lib/` artifacts
without `src/*.ts`. Public GitHub master is rc.5 at
`47f943859bef60e4160492346772ded9b24f765a`; it is context only and is not the
release source used at runtime. No upstream `src/*` file is vendored, copied, or
imported. The two official packages are pinned in `dependencies`,
`peerDependencies`, and `devDependencies`. The provider is composed at runtime
from its public entrypoint; the Models package remains installed by the profile
for reversible composition and its compiled client artifact is not imported by
the replacement client. The design gate hashes the installed package.json and
compiled lib artifacts against the values above.
