# Upstream Baseline

Source scaffold:

- repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- commit: `47f943859bef60e4160492346772ded9b24f765a`
- version: `0.1.0-rc.5`
- modules: `packages/llm/llm-pi-ai` and
  `packages/client/ui-settings-models`

Installed runtime authority:

- `@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.6`
  - npm integrity: `sha512-5RvzkpVCYLg9A3IGdm04px7XOaF/xikuMLe2toBY4A0qtJraXiZtUN1QBOL9i6u7DTOLG9oHP/USsbWRpyI+1Q==`
  - tarball SHA-256: `a29d1a1aaaa513524315ee39b6a940d76082759d55bdee6a5b691f16cc620902`
- `@deepseek-ai/dsh-client-ui-settings-models@0.1.0-rc.6`
  - npm integrity: `sha512-cgY7Em1QNwVK+ou2hI6i/vQj8MZK44US/u84wA6zuqvtDTP45jgNfYZBy1BCWnnUh6HslXVLj/1WzawEZn3YLw==`
  - tarball SHA-256: `43648b0891f71d9df32f05bee54c40d4c543f88d84a63e8cf4595519ad72d52a`

The rc.6 manifests expose no `gitHead` and ship compiled artifacts without
source. Therefore the project does not claim an rc.6 source fork. Official
source supplies the auditable structure and presentation baseline; pinned rc.6
artifacts supply runtime parity authority. The replacement build must not read
or import a Harness checkout. Official package licenses and notices must be
carried with the forked source inventory.
