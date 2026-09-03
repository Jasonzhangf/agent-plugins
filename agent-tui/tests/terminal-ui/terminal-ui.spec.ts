import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyRegistry } from '../../src/experiments/component-registry/src/component-registry.ts'
import { apply as applyToolCard } from '../../src/experiments/tool-card-plugin/src/tool-card-plugin.ts'
import { apply as applyTheme } from '../../src/experiments/theme-plugin/src/theme-plugin.ts'
import {
  apply as applyTerminalUi,
  _internal,
  validateTerminalFrameTree,
  validateTerminalRegionLeaves,
  type TuiTerminalFooterLeaf,
  type TuiTerminalNode,
} from '../../src/experiments/terminal-ui/src/terminal-ui.ts'
import type { TuiTerminalPrimitiveNode, TuiTerminalTextStyle } from '../../contracts/tui/terminal-ui/terminal-frame-tree.types.ts'

function install(): { ctx: Context; ui: any } {
  const ctx = new Context()
  ctx.tuiTextParser = { parse: ({ text }: { text: string }) => ['paragraph:start', `text\t${text}`, 'paragraph:end'] } as any
  applyRegistry(ctx)
  applyToolCard(ctx)
  applyTheme(ctx)
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
    displayFrame: Object.freeze({
      revision: 4,
      width: 80,
      paddingX: 1,
      topRow: 0,
      height: 1,
      committedRows: Object.freeze([]),
      scrollbackRows: Object.freeze([]),
      rows: Object.freeze([
        Object.freeze({
          absoluteRow: 0,
          line: Object.freeze({
            spans: Object.freeze([{ text: '› hello v4', style: 'white' as const }]),
          }),
        }),
      ]),
    }),
    ...overrides,
  } as Parameters<any>[0]
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

function flattenText(node: TuiTerminalPrimitiveNode): Array<{ text: string; style: TuiTerminalTextStyle }> {
  if (node.kind === 'text') return [{ text: node.text, style: node.style }]
  return node.children.flatMap(flattenText)
}

test('registers exact terminal renderers and resolves a user cell', () => {
  const { ctx, ui } = install()
  const output = ui.renderModel(model())
  assert.match(output, /hello v4/)
  assert.equal(ctx.tuiComponentRegistry.resolve('conversation.cells', 'conversation.user').owner, 'agent-tui.terminal-ui.conversation-user')
})

test('projects closed body regions with transcript, composer, footer, and overlay', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput())
  assert.equal(leaves.contract, 'tui.terminal-region-leaves.v1')
  assert.equal(leaves.publicationRevision, 4)
  assert.equal(leaves.transcript.key, 'leaf.transcript')
  assert.equal((leaves.transcript.children[0] as TuiTerminalPrimitiveNode)?.kind, 'box')
  const firstTranscriptRow = leaves.transcript.children[0]
  assert.ok(firstTranscriptRow?.kind === 'box')
  assert.equal(firstTranscriptRow.children[0]?.text, '› hello v4')
  assert.equal(leaves.composer.children[0]?.text, '\n> draft▌\n')
  assert.equal(leaves.composer.style.borderStyle, undefined)
  assert.equal(leaves.footer.children[0]?.text.includes('session-1'), true)

  const withOverlay = ui.project(projectionInput({
    overlay: { view: 'overlay.help', title: 'Help', items: ['/quit'], selectedIndex: 0 },
  }))
  assert.equal(withOverlay.overlay?.children[0]?.text, 'Help')
  assert.equal(withOverlay.overlay?.style.borderStyle, undefined)
  assert.equal(withOverlay.overlay?.style.flexShrink, 1)
  assert.equal(withOverlay.overlay?.style.overflow, 'hidden')
  assert.equal(withOverlay.overlay?.children[1]?.kind, 'box')
  assert.equal(withOverlay.overlay?.children[1]?.style.flexGrow, 1)
  assert.equal(withOverlay.overlay?.children[1]?.style.backgroundColor, 'gray')
  assert.equal(withOverlay.overlay?.children[1]?.children[0]?.style.color, 'red')
  assert.equal(withOverlay.overlay?.children[1]?.children[0]?.text, '› /quit')
})

test('projects execution status as an independent leaf above an unchanged composer', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput({
    executionStatus: { line: 'Ran command · 0:04 · Esc interrupt' },
  }))
  assert.equal(leaves.execution?.key, 'leaf.execution')
  assert.equal(leaves.execution?.children[0]?.key, 'execution-status.line')
  assert.equal(leaves.execution?.children[0]?.text, 'Ran command · 0:04 · Esc interrupt')
  assert.equal(leaves.composer.children[0]?.key, 'composer.display')
  assert.equal(leaves.composer.children[0]?.text, '\n> draft▌\n')
})

test('renders display-buffer viewport rows instead of rebuilding transcript history', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput({
    displayFrame: Object.freeze({
      revision: 9,
      width: 40,
      paddingX: 1,
      topRow: 4,
      height: 2,
      committedRows: Object.freeze([0, 1, 2, 3, 4]),
      scrollbackRows: Object.freeze([]),
      rows: Object.freeze([
        Object.freeze({ absoluteRow: 4, line: Object.freeze({ spans: Object.freeze([{ text: 'Read ', style: 'white' as const }, { text: 'package.json', style: 'blue' as const }]) }) }),
      ]),
    }),
  }))
  const row = leaves.transcript.children[0]
  assert.ok(row && row.kind === 'box')
  assert.equal(row.children[0]?.text, 'Read ')
  assert.equal(row.children[0]?.style.color, 'white')
  assert.equal(row.children[1]?.text, 'package.json')
  assert.equal(row.children[1]?.style.color, 'blue')
  assert.equal(leaves.transcript.style.paddingX, 1)
})

test('realizes body, tool, and thinking rows with distinct styles during live projection', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput({
    displayFrame: Object.freeze({
      revision: 10,
      width: 40,
      paddingX: 1,
      topRow: 0,
      height: 3,
      committedRows: Object.freeze([0, 1]),
      scrollbackRows: Object.freeze([]),
      rows: Object.freeze([
        Object.freeze({ absoluteRow: 0, line: Object.freeze({ spans: Object.freeze([{ text: 'answer', style: 'white' as const }]) }) }),
        Object.freeze({ absoluteRow: 1, line: Object.freeze({ spans: Object.freeze([{ text: 'Ran ', style: 'tool' as const }]) }) }),
        Object.freeze({ absoluteRow: 2, line: Object.freeze({ spans: Object.freeze([{ text: 'working', style: 'thinking' as const }]) }) }),
      ]),
    }),
  }))
  const text = leaves.transcript.children.flatMap(flattenText)
  assert.deepEqual(text, [
    { text: 'answer', style: { color: 'white' } },
    { text: 'Ran ', style: { color: 'tool' } },
    { text: 'working', style: { color: 'thinking', italic: true } },
  ])
})

test('keeps runtime error status out of the composer projection', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput({
    composer: { text: 'draft', cursor: 5, lines: ['draft'], cursorLine: 0, cursorColumn: 5, mode: 'error' },
    status: {
      sessionId: 'session-1',
      cwd: '/workspace',
      mode: 'error',
      message: '/new failed: host rejected the request',
      publicationRevision: 4,
    },
    footer: Object.freeze({
      kind: 'box',
      key: 'leaf.footer',
      style: Object.freeze({ flexDirection: 'column' }),
      children: Object.freeze([
        Object.freeze({
          kind: 'text',
          key: 'footer.status',
          text: 'Session session-1 @ /workspace [error] /new failed: host rejected the request',
          style: Object.freeze({ color: 'red' }),
        }),
        Object.freeze({
          kind: 'text',
          key: 'footer.marker',
          text: '-- footer --',
          style: Object.freeze({ dimColor: true }),
        }),
      ]),
    }) as TuiTerminalFooterLeaf,
  }))

  assert.equal(leaves.composer.children[0]?.text, '\n> draft▌\n')
  assert.equal(leaves.composer.children[0]?.style.backgroundColor, 'gray')
  assert.equal(leaves.composer.children[0]?.style.color, 'white')
  assert.match(leaves.footer.children[0]?.text ?? '', /\[error\] \/new failed/)
})

test('transcript renders semantic text and collapsed summaries, never raw node values', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput({
    model: semanticModel(),
    displayFrame: Object.freeze({
      revision: 4,
      width: 80,
      paddingX: 1,
      topRow: 0,
      height: 3,
      committedRows: Object.freeze([]),
      scrollbackRows: Object.freeze([]),
      rows: Object.freeze([
        Object.freeze({ absoluteRow: 0, line: Object.freeze({ spans: Object.freeze([{ text: '  parsed answer', style: 'white' as const }]) }) }),
        Object.freeze({ absoluteRow: 1, line: Object.freeze({ spans: Object.freeze([{ text: '● Ran ls', style: 'white' as const }]) }) }),
        Object.freeze({ absoluteRow: 2, line: Object.freeze({ spans: Object.freeze([{ text: 'src', style: 'white' as const }]) }) }),
      ]),
    }),
  }))
  const assistant = leaves.transcript.children[0]
  const tool = leaves.transcript.children[1]
  assert.ok(assistant && assistant.kind === 'box')
  assert.equal(assistant.children[0]?.text, '  parsed answer')
  assert.ok(tool && tool.kind === 'box')
  assert.equal(tool.children[0]?.text, '● Ran ls')
  assert.doesNotMatch(tool.children[0]?.text ?? '', /\{"command":"ls"\}/)
})

test('realizes Markdown block boundaries and fenced code without flattening lines', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput({
    model: {
      nodes: [{
        nodeId: 'assistant-markdown',
        kind: 'conversation.assistant',
        publicationRevision: 4,
        lifecycle: 'settled',
        value: {
          blocks: [{
            kind: 'text',
            text: 'ignored raw source',
            markdown: Object.freeze([
              'paragraph:start',
              'text\tfirst paragraph',
              'paragraph:end',
              'code\tbash\tconst r = await tools.bash()\nreturn r',
            ]),
          }],
        },
      }],
      publicationRevision: 4,
    },
    displayFrame: Object.freeze({
      revision: 4,
      width: 80,
      paddingX: 1,
      topRow: 0,
      height: 3,
      committedRows: Object.freeze([]),
      scrollbackRows: Object.freeze([]),
      rows: Object.freeze([
        Object.freeze({ absoluteRow: 0, line: Object.freeze({ spans: Object.freeze([{ text: 'first paragraph', style: 'white' as const }]) }) }),
        Object.freeze({ absoluteRow: 1, line: Object.freeze({ spans: Object.freeze([{ text: '  const r = await tools.bash()', style: 'red' as const }]) }) }),
        Object.freeze({ absoluteRow: 2, line: Object.freeze({ spans: Object.freeze([{ text: 'return r', style: 'red' as const }]) }) }),
      ]),
    }),
  }))
  const assistant = leaves.transcript.children[0]
  assert.ok(assistant && assistant.kind === 'box')
  const text = leaves.transcript.children.flatMap(flattenText)
  assert.equal(text[0]?.text, 'first paragraph')
  assert.equal(text[1]?.text, '  const r = await tools.bash()')
  assert.equal(text[1]?.style.color, 'red')
})

test('suppresses internal context messages at the terminal boundary', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput({
    model: {
      nodes: [{
        nodeId: 'context-1',
        kind: 'conversation.context',
        publicationRevision: 4,
        lifecycle: 'settled',
        value: { text: 'pong — alive and ready' },
      }],
      publicationRevision: 4,
    },
    displayFrame: Object.freeze({ revision: 4, width: 80, paddingX: 1, topRow: 0, height: 0, committedRows: Object.freeze([]), scrollbackRows: Object.freeze([]), rows: Object.freeze([]) }),
  }))
  assert.equal(leaves.transcript.children.length, 0)
})

test('projects an explicit empty transcript state', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput({ model: { nodes: [], publicationRevision: 4 }, displayFrame: Object.freeze({ revision: 4, width: 80, paddingX: 1, topRow: 0, height: 0, committedRows: Object.freeze([]), scrollbackRows: Object.freeze([]), rows: Object.freeze([]) }) }))
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
        Object.freeze({ kind: 'text', key: 'footer.notice', text: 'Press Ctrl+C again within 3s to exit agent-tui', style: Object.freeze({ dimColor: true }) }),
        Object.freeze({ kind: 'text', key: 'footer.marker', text: '-- footer --', style: Object.freeze({ dimColor: true }) }),
      ]),
    }) as TuiTerminalFooterLeaf,
  }))
  assert.equal(leaves.footer.children.length, 3)
  assert.equal(leaves.footer.children[1]?.key, 'footer.notice')
  assert.equal(leaves.footer.children[2]?.key, 'footer.marker')
})

test('projects filtered slash command suggestions above the composer input', () => {
  const { ui } = install()
  const leaves = ui.project(projectionInput({
    commandSuggestions: [
      { command: '/models', description: 'choose a model and thinking effort' },
      { command: '/model', description: 'switch model' },
    ],
  }))
  assert.equal(leaves.composer.children[0]?.text, '/models  choose a model and thinking effort')
  assert.equal(leaves.composer.children[1]?.text, '/model  switch model')
  assert.equal(leaves.composer.children[2]?.text, '\n> draft▌\n')
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

test('groups tool-card segments by explicit line breaks while keeping each line inline', () => {
  const { ui } = install()
  const leaves = ui.project({ ...(projectionInput() as Record<string, unknown>), model: semanticModel() })
  const row = leaves.transcript.children[0] as any
  assert.equal(row.style.flexDirection, 'row')
  assert.deepEqual(row.children.map((child: any) => child.text), ['› hello v4'])
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
      children: [{ kind: 'text', key: 'styled-text', text: 'ok', style: { color: 'yellow', backgroundColor: 'black' } }],
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
  assert.throws(() => validateTerminalFrameTree(deepFreeze({
    contract: 'tui.terminal-frame-tree.v1',
    publicationRevision: 1,
    root: {
      kind: 'box',
      key: 'bad-text-color',
      style: { flexDirection: 'column' },
      children: [{ kind: 'text', key: 'text', text: 'bad', style: { color: 'cyan' } }],
    },
  })), /color is not closed/)
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
