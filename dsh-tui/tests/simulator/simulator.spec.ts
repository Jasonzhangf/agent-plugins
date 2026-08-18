import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadBundle } from '../../playground/experiments/fixture-contract/src/fixture-contract.ts'
import { renderAll, renderFixture } from '../../playground/experiments/simulator/src/simulator.ts'

const fixtureRoot = resolve(import.meta.dirname, '../../contracts/tui/fixtures')

test('renders the same shared fixture bundle deterministically', () => {
  const bundle = loadBundle(fixtureRoot)
  const first = renderAll(bundle)
  const second = renderAll(bundle)
  assert.deepEqual(first.map(item => item.html), second.map(item => item.html))
  assert.equal(first.length, bundle.cases.size)
})

test('renders user and streaming assistant fixtures with visible metadata', () => {
  const bundle = loadBundle(fixtureRoot)
  const user = renderFixture(bundle, 'user-message-40x12')
  assert.match(user.html, /fixture: user-message-40x12/)
  assert.match(user.html, /40 x 12/)
  assert.match(user.html, /请继续完成 dsh-tui 的构建与验证。/)
  const assistant = renderFixture(bundle, 'assistant-streaming-80x24', { theme: 'terminal-light' })
  assert.match(assistant.html, /terminal-light/)
  assert.match(assistant.html, /正在解析 TUI 会话事件/)
  assert.match(assistant.html, /data-lifecycle="streaming"/)
})

test('rejects unknown fixture ids without fallback', () => {
  const bundle = loadBundle(fixtureRoot)
  assert.throws(() => renderFixture(bundle, 'missing-fixture'), /unknown fixture id/)
})

test('simulator source has no DSH host dependency', () => {
  const source = loadSourceText()
  assert.doesNotMatch(source, /@deepseek-ai\/dsh-(host|session|api)/)
  assert.doesNotMatch(source, /fetch\(|WebSocket/)
})

function loadSourceText(): string {
  return readFileSync(resolve(import.meta.dirname, '../../playground/experiments/simulator/src/simulator.ts'), 'utf8')
}
