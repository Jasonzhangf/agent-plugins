import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import {
  loadBundle,
  sha256,
  validateCanonicalNode,
  validateFixtureCase,
  validateManifest,
} from '../../src/experiments/fixture-contract/src/fixture-contract.ts'

const root = resolve(import.meta.dirname, '../../contracts/tui/fixtures')

test('validates and loads the manifest and referenced cases as one bundle', () => {
  const bundle = loadBundle(root)
  assert.equal(bundle.manifest.bundleId, 'agent-tui-fixtures-1')
  assert.equal(bundle.cases.size, 6)
  const user = bundle.cases.get('user-message-40x12')
  assert.ok(user)
  assert.equal(user.componentKind, 'conversation.user')
  assert.equal(user.viewport.columns, 40)
  assert.equal(user.node.value['text'], '请继续完成 agent-tui 的构建与验证。')
  const assistant = bundle.cases.get('assistant-streaming-80x24')
  assert.ok(assistant)
  assert.equal(assistant.componentKind, 'conversation.assistant')
  assert.equal(assistant.node.lifecycle, 'streaming')
  assert.equal(bundle.cases.get('reasoning-streaming-80x24')?.componentKind, 'conversation.reasoning')
  assert.equal(bundle.cases.get('tool-terminal-running-120x36')?.componentKind, 'tool.terminal')
  assert.equal(bundle.cases.get('turn-error-40x12')?.node.lifecycle, 'failed')
  assert.equal(bundle.cases.get('turn-status-running-120x36')?.viewport.columns, 120)
})

test('bundle identity is deterministic for the same file bytes', () => {
  const first = loadBundle(root)
  const second = loadBundle(root)
  assert.equal(first.bundleHash, second.bundleHash)
  assert.match(first.bundleHash, /^[0-9a-f]{64}$/)
})

test('rejects control fields inside canonical fixture payloads', () => {
  assert.throws(() => validateCanonicalNode({
    nodeId: 'node-1',
    kind: 'conversation.user',
    publicationRevision: 1,
    lifecycle: 'settled',
    value: { text: 'hello', endpoint: 'http://127.0.0.1:3080' },
  }), /forbidden control field/)
})

test('rejects non-closed lifecycle and malformed viewport', () => {
  assert.throws(() => validateFixtureCase({
    fixtureId: 'bad',
    componentKind: 'conversation.user',
    viewport: { columns: 0, rows: 12 },
    node: {
      nodeId: 'node-1',
      kind: 'conversation.user',
      publicationRevision: 1,
      lifecycle: 'settled',
      value: { text: 'hello' },
    },
  }), /viewport/)
  assert.throws(() => validateCanonicalNode({
    nodeId: 'node-1',
    kind: 'conversation.user',
    publicationRevision: 1,
    lifecycle: 'unknown',
    value: { text: 'hello' },
  }), /lifecycle/)
})

test('manifest rejects duplicate fixture IDs', () => {
  assert.throws(() => validateManifest({
    schema_version: 1,
    bundleId: 'bad-bundle',
    fixtures: [
      { fixtureId: 'dup', componentKind: 'conversation.user', viewport: { columns: 40, rows: 12 }, file: 'a.json' },
      { fixtureId: 'dup', componentKind: 'conversation.assistant', viewport: { columns: 80, rows: 24 }, file: 'b.json' },
    ],
  }), /duplicate fixtureId/)
})

test('sha256 helper uses the stable hex digest', () => {
  assert.equal(sha256('fixture'), 'f16d05ec6b29248d2c61adb1e9263f78e4f7bace1b955014a2d17872cfe4064d')
})
