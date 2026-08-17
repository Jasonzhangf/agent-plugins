#!/usr/bin/env node
// Regenerate the standalone mockup and fixed viewport screenshots from the
// interactive HTML source. Run from the package root.
//
//   PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
//   PLAYWRIGHT_CHROMIUM_EXE=/absolute/path/to/chrome \
//     node scripts/ui/render-ui-states.mjs

import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const docDir = join(root, 'docs', 'ui')
mkdirSync(docDir, { recursive: true })

const playwrightModule = process.env.PLAYWRIGHT_MODULE
const chromiumExe = process.env.PLAYWRIGHT_CHROMIUM_EXE
if (!playwrightModule || !chromiumExe) {
  console.error('render-ui-states: PLAYWRIGHT_MODULE and PLAYWRIGHT_CHROMIUM_EXE are required')
  process.exit(2)
}

const { chromium } = createRequire(import.meta.url)(playwrightModule)
const source = join(docDir, 'multikey-ui-states.html')
const wrapper = join(docDir, 'multikey-ui-states.standalone.html')
const designHtml = readFileSync(source, 'utf8')
const csp = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'unsafe-inline' blob: data:; img-src blob: data:; font-src blob: data:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
const escaped = designHtml
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\n/g, '&#10;')
const wrapperStyle = ':root{color-scheme:light dark;background:light-dark(rgb(255 255 255),rgb(24 24 24))}html,body{margin:0}body{box-sizing:border-box;padding:1rem;background:inherit}iframe{display:block;width:100%;height:calc(100vh - 2rem);margin:0 auto;border:0}'
const wrapperHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Multikey UI States</title><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${wrapperStyle}</style></head><body><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="Multikey UI States" srcdoc="${escaped}"></iframe></body></html>`
writeFileSync(wrapper, wrapperHtml)

const renders = [
  { name: 'desktop', width: 1440, height: 1800, scheme: 'light' },
  { name: 'mobile', width: 390, height: 1700, scheme: 'light' },
  { name: 'dark', width: 1440, height: 1800, scheme: 'dark' },
]

const browser = await chromium.launch({ executablePath: chromiumExe, headless: true })
try {
  for (const render of renders) {
    const page = await browser.newPage({
      viewport: { width: render.width, height: render.height },
      colorScheme: render.scheme,
      deviceScaleFactor: 1,
    })
    try {
      await page.goto(pathToFileURL(wrapper).toString(), { waitUntil: 'load' })
      await page.waitForSelector('iframe')
      const frame = page.frames()[1]
      if (!frame) throw new Error('render-ui-states: standalone iframe did not load')
      const overflow = await frame.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      if (overflow.scrollWidth > overflow.clientWidth) {
        throw new Error(`render-ui-states: ${render.name} has horizontal overflow ${overflow.scrollWidth} > ${overflow.clientWidth}`)
      }
      const output = join(docDir, `multikey-ui-states.${render.name}.png`)
      await page.screenshot({ path: output, fullPage: false })
      const size = statSync(output)
      console.log(`rendered ${render.name} -> ${output} (${size.size} bytes)`)
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}

console.log('render-ui-states: ok')
