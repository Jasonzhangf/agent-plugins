import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadBundle } from '../../src/experiments/fixture-contract/src/fixture-contract.ts'
import { renderAll, renderFixture, renderSimulatorIndex } from '../../src/experiments/simulator/src/simulator.ts'

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
  assert.match(user.html, /请继续完成 agent-tui 的构建与验证。/)
  const assistant = renderFixture(bundle, 'assistant-streaming-80x24', { theme: 'terminal-light' })
  assert.match(assistant.html, /terminal-light/)
  assert.match(assistant.html, /正在解析 TUI 会话事件/)
  assert.match(assistant.html, /data-lifecycle="streaming"/)
})

test('renders reasoning, tool, error and status fixtures at narrow and wide viewports', () => {
  const bundle = loadBundle(fixtureRoot)
  const reasoning = renderFixture(bundle, 'reasoning-streaming-80x24')
  assert.match(reasoning.html, /conversation.reasoning/)
  assert.match(reasoning.html, /Session 历史与实时事件/)
  const tool = renderFixture(bundle, 'tool-terminal-running-120x36')
  assert.match(tool.html, /tool.terminal/)
  assert.match(tool.html, /120 x 36/)
  const error = renderFixture(bundle, 'turn-error-40x12')
  assert.match(error.html, /conversation.turn-error/)
  assert.match(error.html, /40 x 12/)
  const status = renderFixture(bundle, 'turn-status-running-120x36')
  assert.match(status.html, /conversation.turn-tail/)
  assert.match(status.html, /data-lifecycle="streaming"/)
})

test('rejects unknown fixture ids without fallback', () => {
  const bundle = loadBundle(fixtureRoot)
  assert.throws(() => renderFixture(bundle, 'missing-fixture'), /unknown fixture id/)
})

test('builds one static review page containing every fixture exactly once', () => {
  const bundle = loadBundle(fixtureRoot)
  const index = renderSimulatorIndex(bundle)
  assert.equal(index.fixtureIds.length, bundle.cases.size)
  assert.equal(new Set(index.fixtureIds).size, bundle.cases.size)
  for (const fixtureId of index.fixtureIds) {
    assert.match(index.html, new RegExp(`data-fixture-id="${fixtureId}"`))
  }
  assert.match(index.html, /agent-tui fixture simulator/)
  assert.match(index.deterministicHash, /^[0-9a-f]{8}$/)
})

test('simulator source has no DSH host dependency', () => {
  const source = loadSourceText()
  assert.doesNotMatch(source, /@deepseek-ai\/dsh-(host|session|api)/)
  assert.doesNotMatch(source, /fetch\(|WebSocket/)
})

function loadSourceText(): string {
  return readFileSync(resolve(import.meta.dirname, '../../src/experiments/simulator/src/simulator.ts'), 'utf8')
}
