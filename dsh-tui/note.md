# Working notes

## 2026-08-16

- Confirmed registry `E404` for DSH `0.1.0-rc.5`; current 50 bindings are local built-checkout evidence, not installable-release evidence.
- Jason approved all eight dispositions: seven owner-export prerequisites and one browser theme/layout N/A.
- Implementation admission now requires 50 Host bound, 7 projection bound, 1 approved N/A, 0 blocked, and verified clean-registry artifacts. Release admission separately requires implementation verification, DSH Review, and matching reviewed/uploaded tree plus diff evidence.
- Renamed business projection publication records to `projection_window`, `projection_commit`, and `publicationRevision`; control terminology does not enter BusinessProjection.
- Rebuilt the MemPalace FTS5 index after a verified archive and removed the three stale `dsh-plugins` drawers for the deleted `docs/architecture/snapshot-budget.yaml`; unrelated ignored RouteCodex records were not globally deleted.
- Release evidence now uses reviewed/uploaded tree identity plus a binary full-index diff hash; clean-install evidence is verified from installed package realpaths, versions, and lockfile integrities instead of the manifest flag alone.
- Jason corrected the implementation premise: the TUI is a config-driven independent plugin, so unavailable Web client presentation exports are not an upstream release blocker. Runtime now targets the public Agent/Session APIs already present in the installed DSH and keeps all authored code inside `dsh-tui/`.
- Installed-tarball smoke found the first runtime divergence: tsdown emitted a shared `lib/protocol-*.js` chunk, but `package.json.files` listed only named entry files. The profile installed successfully while runtime import failed with `ERR_MODULE_NOT_FOUND`. The package manifest is the unique owner; include every generated top-level JS chunk and verify through the installed profile entry.
- A second installed-tarball divergence was mode loss: `pnpm pack` stored the native renderer as `0644` even though the staged file was `0755`, so the installed profile failed with `EACCES`. The install lifecycle is the unique fix point; add a `postinstall` script that restores the exact executable bit only for the packaged binary and then rerun the installed-profile PTY entry.
- Final source gates pass: `pnpm run check`, `git diff --check`.
- Fresh installed npm tarball passed a real PTY: `projection cells=... provider=opencode-go model=deepseek-v4-flash`, live reply `TUI_OK`, `Ctrl+C` no-op, `Ctrl+Q` restored alternate screen, and `--resume` showed the persisted assistant reply.
