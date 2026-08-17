#!/usr/bin/env node
// Render the frozen UI states. Run from the package root.
//
//   node scripts/ui/render-ui-states.mjs
//
// Produces docs/ui/multikey-ui-states.standalone.html,
// docs/ui/multikey-ui-states.desktop.png,
// docs/ui/multikey-ui-states.mobile.png,
// docs/ui/multikey-ui-states.dark.png.
//
// Requires a Chromium binary at PLAYWRIGHT_CHROMIUM_EXE. Defaults to the
// Google Chrome for Testing app shipped under
// /Users/fanzhang/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(new URL(import.meta.url).pathname), '..', '..')
const docDir = join(root, 'docs', 'ui')
mkdirSync(docDir, { recursive: true })

const chromiumExe = process.env.PLAYWRIGHT_CHROMIUM_EXE
  || '/Users/fanzhang/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const playwrightCli = process.env.PLAYWRIGHT_CLI || '/opt/homebrew/bin/playwright'
const wrapper = join(docDir, 'multikey-ui-states.standalone.html')
const source = join(docDir, 'multikey-ui-states.html')
const args = ['--full-page', '--browser', 'chromium']

const renders = [
  { name: 'desktop', viewport: '1440,1800', scheme: 'light' },
  { name: 'mobile', viewport: '390,1700', scheme: 'light' },
  { name: 'dark', viewport: '1440,1800', scheme: 'dark' },
]

for (const r of renders) {
  const out = join(docDir, `multikey-ui-states.${r.name}.png`)
  execFileSync(playwrightCli, [
    'screenshot',
    ...args,
    '--viewport-size', r.viewport,
    '--color-scheme', r.scheme,
    '--wait-for-timeout', '500',
    `file://${wrapper}`,
    out,
  ], { stdio: 'inherit' })
  const size = statSync(out)
  console.log(`rendered ${r.name} -> ${out} (${size.size} bytes)`)
}

console.log('render-ui-states: ok')
