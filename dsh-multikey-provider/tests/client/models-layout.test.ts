import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'

test('Models replacement uses the official row/editor/add structure without inline styles', async () => {
  const section = await readFile(resolve('src/client/ModelsSection.tsx'), 'utf8')
  const provider = await readFile(resolve('src/client/ProviderEditor.tsx'), 'utf8')
  assert.match(section, /styles\['rowCard'\]/u)
  assert.match(section, /styles\['addActions'\]/u)
  assert.match(section, /styles\['addCard'\]/u)
  assert.match(section, /state\.rows\.filter\(row => !row\.configured && row\.entry\.settingsNs !== ''\)/u)
  assert.match(provider, /styles\['editor'\]/u)
  assert.match(provider, /<EditorFooter/u)
  assert.match(provider, /<ModelListEditor/u)
  assert.match(provider, /<AlternateKeyPoolEditor/u)
  assert.equal(section.includes('style={{'), false)
  assert.equal(provider.includes('style={{'), false)
})

test('Models stylesheet keeps official dimensions and responsive single-column controls', async () => {
  const css = await readFile(resolve('src/client/ModelsSection.module.css'), 'utf8')
  assert.match(css, /max-width:\s*720px/u)
  assert.match(css, /\.rowCard\s*\{/u)
  assert.match(css, /\.editor\s*\{/u)
  assert.match(css, /\.addCard \.editor/u)
  assert.match(css, /\.editorActions\s*\{/u)
  assert.match(css, /\.addButton\s*\{/u)
  assert.match(css, /@media \(max-width: 640px\)/u)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u)
  assert.equal(css.includes('letter-spacing'), false)
})

test('multikey controls exist only inside the configured pi-ai ProviderEditor', async () => {
  const provider = await readFile(resolve('src/client/ProviderEditor.tsx'), 'utf8')
  const pool = await readFile(resolve('src/client/AlternateKeyPoolEditor.tsx'), 'utf8')
  assert.match(provider, /layout === 'pi-ai' && fallback !== undefined/u)
  assert.match(provider, /<AlternateKeyPoolEditor/u)
  assert.equal(pool.includes('settings.section'), false)
  assert.equal(pool.includes('multikey/'), false)
})
