# Working notes

## 2026-08-16

- Confirmed registry `E404` for DSH `0.1.0-rc.5`; current 50 bindings are local built-checkout evidence, not installable-release evidence.
- Jason approved all eight dispositions: seven owner-export prerequisites and one browser theme/layout N/A.
- Implementation admission now requires 50 Host bound, 7 projection bound, 1 approved N/A, 0 blocked, and verified clean-registry artifacts. Release admission separately requires implementation verification, DSH Review, and matching reviewed/uploaded tree plus diff evidence.
- Renamed business projection publication records to `projection_window`, `projection_commit`, and `publicationRevision`; control terminology does not enter BusinessProjection.
- Rebuilt the MemPalace FTS5 index after a verified archive and removed the three stale `dsh-plugins` drawers for the deleted `docs/architecture/snapshot-budget.yaml`; unrelated ignored RouteCodex records were not globally deleted.
- Release evidence now uses reviewed/uploaded tree identity plus a binary full-index diff hash; clean-install evidence is verified from installed package realpaths, versions, and lockfile integrities instead of the manifest flag alone.
- Jason corrected the implementation premise: the TUI is a config-driven independent plugin, so unavailable Web client presentation exports are not an upstream release blocker. Runtime now targets the public Agent/Session APIs already present in the installed DSH and keeps all authored code inside `dsh-tui/`.
