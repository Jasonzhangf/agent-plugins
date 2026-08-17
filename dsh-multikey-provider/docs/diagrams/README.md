# Architecture Diagrams

These diagrams are the review-facing architecture views of the approved
design. The Mermaid files are the source of truth; the PNGs are frozen evidence
for design review.

- `composition-owner.mmd` / `.png`: exact-name disable plus independent insert,
  and the resulting exclusive owner contract.
- `module-ownership.mmd` / `.png`: replacement package modules and allowed
  ownership edges.
- `request-mainline.mmd` / `.png`: immutable snapshot, attempt-local key
  resolution, pre-output account-failure switching, and non-switching paths.
- `attempt-state-machine.mmd` / `.png`: adapter state transitions with the
  guarded advance and no-advance paths.
- `key-health-state.mmd` / `.png`: key pool health state machine.
- `restore-sequence.mmd` / `.png`: removal, exact restart, dump-config, and
  official-path replay sequence.

Regenerate the PNGs and `render-manifest.json` with:

```sh
PLAYWRIGHT_CHROMIUM_EXE=/absolute/path/to/chrome \
node scripts/diagrams/render-architecture-diagrams.mjs
```

`node scripts/diagrams/render-architecture-diagrams.mjs --verify-source`
verifies the committed PNGs against the committed Mermaid sources and the
manifest without launching a browser.
