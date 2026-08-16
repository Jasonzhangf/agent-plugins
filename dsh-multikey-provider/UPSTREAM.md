# Upstream Baseline

The replacement is based on audited rc.6 package artifacts:

- `@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.6`
  - npm tarball SHA-256: `a29d1a1aaaa513524315ee39b6a940d76082759d55bdee6a5b691f16cc620902`
- `@deepseek-ai/dsh-client-ui-settings-models@0.1.0-rc.6`
  - npm tarball SHA-256: `43648b0891f71d9df32f05bee54c40d4c543f88d84a63e8cf4595519ad72d52a`

The rc.6 npm manifests expose no `gitHead`. Public GitHub master is rc.5 at
`47f943859bef60e4160492346772ded9b24f765a`; it is context only and is not the
release source used at runtime. The implementation phase must carry an explicit
source inventory and license notice for the audited baseline. Runtime code must
not import private files from the installed official packages. The official
packages remain peer/dev provenance inputs and remain installed by the profile
for reversible composition.
