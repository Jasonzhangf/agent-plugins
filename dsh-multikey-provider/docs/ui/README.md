# Multikey Provider UI States

This directory captures the three UI states the design commits to before
implementation. The interactive HTML is the design source. The PNGs are the
frozen evidence the design gate and the DSH Reviewer can read.

## Files

- `multikey-ui-states.html` — interactive design source. Inline CSS, the
  three states stacked vertically. No real logic; the controls are placeholders
  for the layout contract.
- `multikey-ui-states.standalone.html` — Playwright-rendered wrapper. Useful
  for snapshot review without the inline source.
- `multikey-ui-states.desktop.png` — 1440x1800 fixed-viewport screenshot.
- `multikey-ui-states.mobile.png` — 390x1700 fixed-viewport screenshot.
- `multikey-ui-states.dark.png` — 1440x1800 dark scheme screenshot.

## States

1. Not configured: provider appears only in the official Add provider
   selector. The editing surface shows the official API key field and
   Customized settings. No multikey block.
2. Configured: the provider row shows the official layout alone. No multikey
   block until Edit.
3. Editing configured: the official `ProviderEditor` gains an `Additional API
   Keys` block under the API key and Customized settings. The block is the
   only new surface the design adds; the rest of the page keeps the official
   chrome.

## What the block contains

- Mode (priority / weighted) and max attempts.
- Health policy: failureThreshold, openCircuitMs.
- Per-key rows: key id, credential reference, priority, redacted status
  (Healthy / Open), Probe action.
- Inline Add Key form: key id, credential input, priority, Add action.

The block never appears for unconfigured providers, never on the configured
row itself, and never outside the official `ProviderEditor` for an opened
configured row.

## Verifier checks

The mockup was rendered with headless Chromium at 1440x1800 and 390x1700;
horizontal scrollWidth equaled clientWidth in both cases after the action
column was widened to an auto track. Dark scheme verification used the same
viewport with `color-scheme: dark`.

Regenerate the standalone file and all three screenshots with:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
PLAYWRIGHT_CHROMIUM_EXE=/absolute/path/to/chrome \
pnpm run ui:render
```

The render command fails explicitly when either dependency path is absent. The
design gate then verifies source-to-standalone binding, state identity, PNG
headers and viewport dimensions, module ownership, and render-script syntax.
