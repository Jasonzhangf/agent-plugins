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
  // The official llm-pi-ai namespace must take the pi-ai layout so its catalog
  // rows are still editable on the replacement Models page.
  assert.match(provider, /ns === 'llm-pi-ai' \|\| ns === 'multikey-provider'/u)
  // The pool block is the plugin's sole addition to that shared layout; it
  // must mount only inside the plugin's own namespace, never for the
  // official llm-pi-ai namespace.
  assert.match(provider, /<AlternateKeyPoolEditor/u)
  assert.match(provider, /namespace\.ns === 'multikey-provider'/u)
  assert.equal(provider.includes("namespace.ns !== 'multikey-provider'") === false, true)
  assert.equal(pool.includes('settings.section'), false)
  assert.equal(pool.includes('multikey/'), false)
  assert.match(pool, /applyNamespace\(error\.updated\)/u)
  assert.match(pool, /const updated = await persistPool\(api, activeNamespace, settingsPath, next\)[\s\S]*?applyNamespace\(updated\)/u)
  assert.match(pool, /error instanceof AlternateKeyInputError/u)
  assert.match(pool, /t\('poolKeyIdInvalid'\)/u)
  assert.match(pool, /t\('poolCredentialRefInvalid'\)/u)
  assert.match(pool, /t\('poolKeyRequired'\)/u)
  assert.match(pool, /t\('poolKeyIdDuplicate'\)/u)
  assert.match(pool, /t\('poolCredentialRefDuplicate'\)/u)
})

test('layout mapping keeps official llm-pi-ai rows editable', async () => {
  const source = await readFile(resolve('src/client/ProviderEditor.tsx'), 'utf8')
  // The layout switch is total: both plugin and official namespaces take the
  // pi-ai branch, so no unknown-row hint can render on a configured row.
  const match = source.match(/function layoutOf\([^)]*\): EditorLayout \{([\s\S]*?)\n\}/u)
  assert.ok(match !== null, 'layoutOf is reachable from the file')
  const body = match?.[1] ?? ''
  assert.match(body, /llm-pi-ai/u)
  assert.match(body, /multikey-provider/u)
  // The submit guard must NOT block the pi-ai branch, only the unknown branch.
  const submitSection = source.split('submitDisabled=')[1] ?? ''
  assert.equal(/layout === 'unknown'/u.test(submitSection), true)
})
