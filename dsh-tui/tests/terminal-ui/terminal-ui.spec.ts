import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { renderToString } from 'ink'
import { apply as applyRegistry } from '../../playground/experiments/component-registry/src/component-registry.ts'
import {
  apply as applyTerminalUi,
  type TuiTerminalNode,
  type TuiTerminalNodeLifecycle,
  type TuiTerminalUi,
} from '../../playground/experiments/terminal-ui/src/terminal-ui.ts'
import { composeInkElement } from '../../playground/experiments/terminal-lifecycle/src/terminal-lifecycle.ts'

function install(): { ctx: Context; ui: TuiTerminalUi } {
  const ctx = new Context()
  applyRegistry(ctx)
  applyTerminalUi(ctx)
  return { ctx, ui: ctx.tuiTerminalUi }
}

test('registers exact terminal renderers and resolves a user cell', () => {
  const { ctx, ui } = install()
  const output = ui.renderModel({
    nodes: [{
      nodeId: 'session-1:1:conversation.user',
      kind: 'conversation.user',
      publicationRevision: 1,
      lifecycle: 'settled',
      value: { text: 'hello' },
    }],
    publicationRevision: 1,
  })
  assert.match(output, /hello/)
  assert.equal(ctx.tuiComponentRegistry.resolve('conversation.cells', 'conversation.user').owner, 'dsh-tui.terminal-ui.conversation-user')
})

test('renders assistant text and reasoning as visibly distinct blocks', () => {
  const { ui } = install()
  const output = ui.renderModel({
    nodes: [
      {
        nodeId: 'a1', kind: 'conversation.assistant', publicationRevision: 2, lifecycle: 'streaming',
        value: { blocks: [
          { kind: 'reasoning', text: 'thinking' },
          { kind: 'text', text: 'answer', markdown: ['answer'] },
        ] },
      },
    ],
    publicationRevision: 2,
  })
  assert.match(output, /answer/)
  assert.match(output, /· thinking/)
})

test('renders tool cards with lifecycle status and keeps node identity stable', () => {
  const { ui } = install()
  const model = {
    nodes: [{
      nodeId: 'tool-1', kind: 'tool.terminal', publicationRevision: 3, lifecycle: 'streaming',
      value: {
        name: 'shell', status: 'running', arguments: '{"command":"pwd"}',
        callRenderIntent: { card: 'terminal', title: 'pwd', cwd: '/workspace' },
      },
    }],
    publicationRevision: 3,
  } as const
  const first = ui.renderModel(model)
  const second = ui.renderModel({
    ...model,
    publicationRevision: 4,
    nodes: [{
      ...model.nodes[0], publicationRevision: 4,
      value: {
        ...model.nodes[0].value, status: 'completed', result: 'raw result',
        resultRenderIntent: { card: 'terminal', output: '/tmp', exitCode: 0 },
      },
    }],
  })
  assert.match(first, /running/)
  assert.match(first, /pwd \[running\]/)
  assert.match(second, /completed/)
  assert.match(second, /\/tmp/)
  assert.match(second, /tool-1/)
})

test('rejects raw event-shaped models before rendering', () => {
  const { ui } = install()
  assert.throws(() => ui.renderModel({
    nodes: [{
      nodeId: 'bad', kind: 'conversation.user', publicationRevision: 1, lifecycle: 'settled',
      value: { event: { type: 'user/message', seq: 1 } },
    }],
    publicationRevision: 1,
  } as never), /forbidden|event|control/i)
})

test('unknown canonical kinds fail closed without family fallback', () => {
  const { ui } = install()
  assert.throws(() => ui.renderModel({
    nodes: [{ nodeId: 'unknown', kind: 'conversation.not-real', publicationRevision: 1, lifecycle: 'settled', value: {} }],
    publicationRevision: 1,
  } as never), /unknown component kind|not registered/)
})

test('renders empty model with stable shell markers', () => {
  const { ui } = install()
  const output = ui.renderModel({ nodes: [], publicationRevision: 0 })
  assert.match(output, /Transcript/)
  assert.match(output, /composer.editor/)
  assert.match(output, /Session/)
})

test('composes one real Ink tree for transcript, composer, and status zones', () => {
  const { ui } = install()
  const tree = ui.composeInkTree({
    model: {
      publicationRevision: 4,
      nodes: [{
        nodeId: 'user-1',
        kind: 'conversation.user',
        publicationRevision: 4,
        lifecycle: 'settled',
        value: { text: 'hello Ink' },
      }],
    },
    composer: { text: 'draft', cursor: 5, lines: ['draft'], cursorLine: 0, cursorColumn: 5, mode: 'idle' },
    status: { sessionId: 'session-1', cwd: '/workspace', mode: 'idle', publicationRevision: 4 },
    width: 48,
    scrollOffset: 0,
  })
  assert.equal(tree.kind, 'tui.shell')
  assert.match(renderToString(composeInkElement(tree.descriptor)), /hello Ink/)
  assert.match(renderToString(composeInkElement(tree.descriptor)), /composer\.editor/)
  assert.match(renderToString(composeInkElement(tree.descriptor)), /session-1/)
})

test('composes a typed help or resume overlay without changing transcript nodes', () => {
  const { ui } = install()
  const model = {
    nodes: [{ nodeId: 'u1', kind: 'conversation.user', publicationRevision: 1, lifecycle: 'settled', value: { text: 'keep me' } }],
    publicationRevision: 1,
  } as const
  const tree = ui.composeInkTree({
    model,
    overlay: {
      view: 'selector.resume-current-cwd',
      title: 'Resume current cwd',
      items: ['session-a', 'session-b'],
      selectedIndex: 1,
    },
  })
  assert.equal(tree.descriptor.transcript[0]?.nodeId, 'u1')
  assert.deepEqual(tree.descriptor.overlay, {
    view: 'selector.resume-current-cwd',
    title: 'Resume current cwd',
    items: ['session-a', 'session-b'],
    selectedIndex: 1,
  })
  const rendered = renderToString(composeInkElement(tree.descriptor))
  assert.match(rendered, /Resume current cwd/)
  assert.match(rendered, /› session-b/)
  assert.throws(() => ui.composeInkTree({
    model,
    overlay: { view: 'overlay.help', title: 'Help', items: ['/quit'], selectedIndex: 1 },
  }), /selectedIndex/)
})

test('renders typed pending and failed local echoes outside canonical transcript', () => {
  const { ui } = install()
  const tree = ui.composeInkTree({
    model: { nodes: [], publicationRevision: 0 },
    localEchoes: [
      { echoId: 'echo-1', text: 'pending text', state: 'pending' },
      { echoId: 'echo-2', text: 'failed text', state: 'failed' },
    ],
  })
  assert.equal(tree.descriptor.transcript.length, 0)
  const rendered = renderToString(composeInkElement(tree.descriptor))
  assert.match(rendered, /pending text \[sending\]/)
  assert.match(rendered, /failed text \[failed\]/)
  assert.throws(() => ui.composeInkTree({
    model: { nodes: [], publicationRevision: 0 },
    localEchoes: [{ echoId: 'echo-3', text: '', state: 'pending' }],
  }), /localEcho/)
})

test('composed foundation frames are deterministic and deeply immutable', () => {
  const { ui } = install()
  const modelValue = { blocks: [{ kind: 'text', text: 'stable frame' }] }
  const input = {
    model: {
      publicationRevision: 7,
      nodes: [{
        nodeId: 'assistant-1',
        kind: 'conversation.assistant',
        publicationRevision: 7,
        lifecycle: 'streaming' as const,
        value: modelValue,
      }],
    },
    composer: { text: 'draft', cursor: 5, lines: ['draft'], cursorLine: 0, cursorColumn: 5, mode: 'idle' as const },
    status: { sessionId: 'session-1', cwd: '/workspace', mode: 'idle' as const, publicationRevision: 7 },
    width: 48,
    scrollOffset: 0,
  }
  const first = ui.composeInkTree(input)
  const second = ui.composeInkTree(input)
  assert.deepEqual(first, second)
  assert.equal(Object.isFrozen(modelValue), false)

  const seen = new Set<unknown>()
  function assertDeepFrozen(value: unknown): void {
    if (value === null || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    assert.equal(Object.isFrozen(value), true)
    for (const child of Object.values(value as Record<string, unknown>)) assertDeepFrozen(child)
  }
  assertDeepFrozen(first)
  assert.throws(() => {
    ;(first.descriptor as { width: number }).width = 99
  }, TypeError)
})

test('model-level frame diff reports added, changed, and removed node identities', () => {
  const { ui } = install()
  const userLifecycle: TuiTerminalNodeLifecycle = 'settled'
  const userNode: TuiTerminalNode = {
    nodeId: 'user-1', kind: 'conversation.user', publicationRevision: 1,
    lifecycle: userLifecycle, value: { text: 'first' },
  }
  const initial = {
    publicationRevision: 1,
    nodes: [userNode],
  }
  assert.deepEqual(ui.diff(null, initial), ['user-1'])

  const changed = {
    publicationRevision: 2,
    nodes: [{ ...userNode, publicationRevision: 2, lifecycle: 'streaming' as TuiTerminalNodeLifecycle }],
  }
  assert.deepEqual(ui.diff(initial, changed), ['user-1'])
  assert.deepEqual(ui.diff(changed, { nodes: [], publicationRevision: 3 }), ['user-1'])
})
