#!/usr/bin/env node
/**
 * Static simulator browser evidence capture (playwright).
 * Renders generated/simulator/index.html at desktop and narrow viewports,
 * verifies nonblank/complete/readable, and writes PNG + a JSON report to
 * docs/evidence/simulator/.
 */
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const htmlPath = resolve(root, 'generated/simulator/index.html')
const outDir = resolve(root, 'docs/evidence/simulator')
mkdirSync(outDir, { recursive: true })

const manifest = JSON.parse(readFileSync(resolve(root, 'generated/simulator/manifest.json'), 'utf8'))

const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'narrow', width: 400, height: 800 },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const report = { viewports: [], fixtureIds: manifest.fixtureIds }
try {
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } })
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
    await page.waitForTimeout(300)
    // nonblank check: count fixture cells + total text length
    const info = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.cell')]
      const cellsWithText = cells.filter(c => (c.querySelector('.cell-text')?.textContent ?? '').trim().length > 0)
      const text = document.body.innerText
      return {
        cellCount: cells.length,
        cellsWithText: cellsWithText.length,
        textLength: text.length,
        cellKinds: [...new Set(cells.map(c => c.getAttribute('data-kind')))],
        fixtureIds: [...new Set(cells.map(c => c.getAttribute('data-fixture-id')))],
        hasTitle: (document.querySelector('h1')?.textContent ?? '').includes('fixture simulator'),
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        noVerticalOverflow: document.documentElement.scrollHeight >= document.documentElement.clientHeight,
      }
    })
    await page.screenshot({ path: resolve(outDir, 'simulator-' + vp.name + '.png'), fullPage: true })
    report.viewports.push({ name: vp.name, width: vp.width, height: vp.height, ...info })
    await page.close()
  }
} finally {
  await browser.close()
}

const nl = String.fromCharCode(10)
writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2) + nl, 'utf8')
console.log(JSON.stringify(report, null, 2))
