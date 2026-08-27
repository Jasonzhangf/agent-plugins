import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyRegistry } from '../../playground/experiments/component-registry/src/component-registry.ts'
import {
  apply as applyTerminalUi,
  _internal,
  validateTerminalFrameTree,
  validateTerminalRegionLeaves,
  type TuiTerminalFooterLeaf,
  type TuiTerminalNode,
} from '../../playground/experiments/terminal-ui/src/terminal-ui.ts'

function install(): { ctx: Context; ui: any } {
  const ctx = new Context()
  applyRegistry(ctx)
  applyTerminalUi(ctx)
  return { ctx, ui: ctx.tuiTerminalUi }
}

function model(text = 'hello v4', revision = 4) {
  return {
    nodes: [{
      nodeId: 'user-1',
      kind: 'conversation.user',
      publicationRevision: revision,
      lifecycle: 'settled' as const,
      value: { text },
    }],
    publicationRevision: revision,
  }
}

function semanticModel(revision = 4) {
  return {
    nodes: [
      {
        nodeId: 'assistant-1',
        kind: 'conversation.assistant',
        publicationRevision: revision,
        lifecycle: 'settled' as const,
        value: {
          blocks: [
            { kind: 'text', text: 'parsed answer' },
            { kind: 'reasoning', text: 'hidden chain of thought' },
          ],
        },
      },
      {
        nodeId: 'tool-1',
        kind: 'tool.terminal',
        publicationRevision: revision,
        lifecycle: 'settled' as const,
        value: {
          name: 'shell',
          status: 'completed',
          arguments: '{"command":"ls"}',
          result: 'src',
        },
      },
    ],
    publicationRevision: revision,
  }
}

function projectionInput(overrides: Record<string, unknown> = {}) {
  return {
    model: model(),
    composer: { text: 'draft', cursor: 5, lines: ['draft'], cursorLine: 0, cursorColumn: 5, mode: 'idle' },
    status: { sessionId: 'session-1', cwd: '/workspace', mode: 'idle', publicationRevision: 4 },
    footer: Object.freeze({
      kind: 'box',
      key: 'leaf.footer',
      style: Object.freeze({ flexDirection: 'column' }),
      children: Object.freeze([
        Object.freeze({ kind: 'text', key: 'footer.status', text: 'Session session-1 @ /workspace [idle]', style: Object.freeze({ color: 'white' }) }),
        Object.freeze({ kind: 'text', key: 'footer.marker', text: '-- footer --', style: Object.freeze({ dimColor: true }) }),
      ]),
    }) as TuiTerminalFooterLeaf,
    localEchoes: [],
    ...overrides,
  } as Parameters<any>[0]
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

test('registers exact terminal renderers and resolves a user cell', () => {
  const { ctx, ui } = install()
  const output = ui.renderModel(model())
  assert.match(output, /hello v4/)
  assert.equal(ctx.tuiComponentRegistry.resolve('conversation.cells', 'conversation.user').owner, 'dsh-tui.terminal-ui.conversation-user')
})

test('projects closed body regions with transcript, composer, footer, and overlay', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput())
  assert.equal(leaves.contract, 'tui.terminal-region-leaves.v1')
  assert.equal(leaves.publicationRevision, 4)
  assert.equal(leaves.transcript.key, 'leaf.transcript')
  assert.equal(leaves.transcript.children[0]?.text, '› hello v4')
  assert.equal(leaves.composer.children[0]?.text, '> draft')
  assert.equal(leaves.composer.style.borderStyle, undefined)
  assert.equal(leaves.footer.children[0]?.text.includes('session-1'), true)

  const withOverlay = ui.project(projectionInput({
    overlay: { view: 'overlay.help', title: 'Help', items: ['/quit'], selectedIndex: 0 },
  }))
  assert.equal(withOverlay.overlay?.children[0]?.text, 'Help')
  assert.equal(withOverlay.overlay?.style.borderStyle, undefined)
  assert.equal(withOverlay.overlay?.children[1]?.style.color, 'red')
})

test('transcript renders semantic text and collapsed summaries, never raw node values', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput({ model: semanticModel() }))
  const assistant = leaves.transcript.children[0]
  const tool = leaves.transcript.children[1]
  assert.ok(assistant && assistant.kind === 'text')
  assert.equal(assistant.text, '  parsed answer')
  assert.equal(assistant.style.color, 'white')
  assert.ok(tool && tool.kind === 'text')
  assert.match(tool.text, /^\[tool\] /)
  assert.doesNotMatch(tool.text, /\{"command":"ls"\}/)
})

test('projects an explicit empty transcript state', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput({ model: { nodes: [], publicationRevision: 4 } }))
  assert.equal(leaves.transcript.children.length, 0)
})

test('projects footer notice as the middle child without breaking closed leaves', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput({
    footer: Object.freeze({
      kind: 'box',
      key: 'leaf.footer',
      style: Object.freeze({ flexDirection: 'column' }),
      children: Object.freeze([
        Object.freeze({ kind: 'text', key: 'footer.status', text: 'Session session-1 @ /workspace [idle]', style: Object.freeze({ color: 'white' }) }),
        Object.freeze({ kind: 'text', key: 'footer.notice', text: 'Press Ctrl+C again within 3s to exit dsh-tui', style: Object.freeze({ dimColor: true }) }),
        Object.freeze({ kind: 'text', key: 'footer.marker', text: '-- footer --', style: Object.freeze({ dimColor: true }) }),
      ]),
    }) as TuiTerminalFooterLeaf,
  }))
  assert.equal(leaves.footer.children.length, 3)
  assert.equal(leaves.footer.children[1]?.key, 'footer.notice')
  assert.equal(leaves.footer.children[2]?.key, 'footer.marker')
})

test('region projection is deterministic and deeply frozen', () => {
  const { ui } = install()
  const first = ui.project(projectionInput())
  const second = ui.project(projectionInput())
  assert.deepEqual(first, second)
  const seen = new Set<unknown>()
  function assertFrozen(value: unknown): void {
    if (value === null || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    assert.equal(Object.isFrozen(value), true)
    for (const child of Object.values(value as Record<string, unknown>)) assertFrozen(child)
  }
  assertFrozen(first)
})

test('projection failures stay typed and include their causes', () => {
  const { ui } = install()
  const result = ui.projectSafe(projectionInput({ model: { publicationRevision: 4 } }))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.stage, 'region-projection')
    assert.equal(result.error.code, 'invalid-terminal-region-leaves')
    assert.match(result.error.message, /model\.nodes must be an array/)
    assert.ok(result.error.cause instanceof TypeError)
  }
})

test('transcript projection rejects an unregistered descriptor element type', () => {
  const registry = {
    render: () => ({ contract: 'tui.element.v1', elementType: 'conversation.unregistered', props: {} }),
  }
  const node = {
    nodeId: 'status-unknown',
    kind: 'status.terminal',
    publicationRevision: 4,
    lifecycle: 'settled' as const,
    value: { message: 'unregistered renderer' },
  } satisfies TuiTerminalNode
  assert.throws(
    () => _internal.renderNodeToText(registry as any, node),
    /unknown descriptor elementType 'conversation\.unregistered'/,
  )
})

test('realizes a validated frame into a closed primitive tree without shell metadata', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput())
  const frame = deepFreeze({
    contract: 'tui.terminal-frame-tree.v1',
    publicationRevision: 4,
    root: {
      kind: 'box',
      key: 'frame.root',
      style: { flexDirection: 'column', width: 40 },
      children: [leaves.transcript, leaves.composer, leaves.footer],
    },
  })
  const realized = ui.realize(frame)
  assert.equal(realized.contract, 'tui.realized-terminal-primitive-tree.v1')
  assert.equal(realized.root, frame.root)
  assert.equal('metadata' in realized, false)
  assert.equal('slots' in realized, false)
})

test('frame validation rejects non-frozen, malformed, and cyclic trees', () => {
  const valid = deepFreeze({
    contract: 'tui.terminal-frame-tree.v1',
    publicationRevision: 1,
    root: {
      kind: 'box',
      key: 'root',
      style: { flexDirection: 'column' },
      children: [{ kind: 'text', key: 'text', text: 'ok', style: {} }],
    },
  })
  validateTerminalFrameTree(valid)
  validateTerminalFrameTree(deepFreeze({
    contract: 'tui.terminal-frame-tree.v1',
    publicationRevision: 1,
    root: {
      kind: 'box',
      key: 'styled-root',
      style: { flexDirection: 'column', backgroundColor: 'gray', borderColor: 'red' },
      children: [{ kind: 'text', key: 'styled-text', text: 'ok', style: { color: 'white', backgroundColor: 'black' } }],
    },
  }))
  assert.throws(() => validateTerminalFrameTree(deepFreeze({
    contract: 'tui.terminal-frame-tree.v1',
    publicationRevision: 1,
    root: {
      kind: 'box',
      key: 'bad-style',
      style: { flexDirection: 'column', backgroundColor: 'blue' },
      children: [],
    },
  })), /backgroundColor is not closed/)
  assert.throws(() => validateTerminalFrameTree({ ...valid }), /frozen plain/)
  assert.throws(() => validateTerminalRegionLeaves(deepFreeze({
    contract: 'wrong', publicationRevision: 1, transcript: valid.root, composer: valid.root, footer: valid.root,
  })), /contract is not/)

  const cyclic: any = { kind: 'box', key: 'cycle', style: { flexDirection: 'column' }, children: [] }
  cyclic.children.push(cyclic)
  Object.freeze(cyclic.children)
  Object.freeze(cyclic.style)
  Object.freeze(cyclic)
  assert.throws(() => validateTerminalFrameTree(Object.freeze({
    contract: 'tui.terminal-frame-tree.v1', publicationRevision: 1, root: cyclic,
  })), /cycle/)
})

test('safe realization returns one primitive realization failure family', () => {
  const { ui } = install()
  const result = ui.realizeSafe(deepFreeze({ contract: 'wrong', publicationRevision: 1, root: {} }))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.stage, 'primitive-realization')
    assert.equal(result.error.code, 'invalid-terminal-primitive-tree')
    assert.match(result.error.message, /contract/)
  }
})

test('model diff reports added, changed, and removed node identities', () => {
  const { ui } = install()
  const userNode: TuiTerminalNode = model().nodes[0]!
  const initial = { publicationRevision: 1, nodes: [userNode] }
  assert.deepEqual(ui.diff(null, initial), ['user-1'])
  assert.deepEqual(ui.diff(initial, {
    nodes: [{ ...userNode, lifecycle: 'streaming' as const, publicationRevision: 2 }],
    publicationRevision: 2,
  }), ['user-1'])
  assert.deepEqual(ui.diff(initial, { nodes: [], publicationRevision: 3 }), ['user-1'])
})

test('error terminal always renders a readable message even when input is malformed', () => {
  const { ctx } = install()
  const registry = ctx.tuiComponentRegistry
  for (const value of [{}, { message: '' }, { message: 'provider failed' }]) {
    const node = {
      nodeId: `error-${String(value['message'] ?? 'empty')}`,
      kind: 'conversation.turn-error' as const,
      publicationRevision: 1,
      lifecycle: 'failed' as const,
      value,
    }
    const text = _internal.renderNodeToText(registry, node)
    assert.ok(text.startsWith('! '), `expected error prefix for ${JSON.stringify(value)}`)
    assert.ok(text.length > 2, `expected readable message for ${JSON.stringify(value)}`)
  }
})
