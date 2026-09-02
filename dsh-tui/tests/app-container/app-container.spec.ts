import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyComponentRegistry } from '../../src/experiments/component-registry/src/component-registry.ts'
import { apply as applyChromeSlotRegistry } from '../../src/experiments/chrome-slot-registry/src/chrome-slot-registry.ts'
import { apply as applyTerminalUi } from '../../src/experiments/terminal-ui/src/terminal-ui.ts'
import { apply as applyTheme } from '../../src/experiments/theme-plugin/src/theme-plugin.ts'
import { apply as applyAppContainer } from '../../src/experiments/app-container/src/app-container.ts'
import type {
  TuiChromeDisplayPlugin,
  TuiChromeSlotId,
  TuiChromeSlotProducer,
  TuiLogicControlProjector,
} from '../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'

function installLogicControls(ctx: Context): void {
  const controls: ReadonlyArray<ReturnType<TuiLogicControlProjector['project']>> = [
    { control: 'logo' as const, stableKey: 'control.logo', variant: 'full' as const, visible: true, revision: 1 },
    { control: 'connection' as const, stableKey: 'control.connection', state: 'connected' as const, revision: 1 },
    { control: 'session' as const, stableKey: 'control.session', selectedSessionId: null, availableSessionIds: [], cwd: null, lifecycle: 'active' as const, requestedSessionId: null, revision: 1 },
    { control: 'status' as const, stableKey: 'control.status', sessionId: null, cwd: null, mode: 'idle' as const, revision: 1 },
    { control: 'execution' as const, stableKey: 'control.execution', state: 'idle' as const, turnId: null, revision: 1 },
  ]
  const byControl = new Map(controls.map(control => [control.control, control]))
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = {
    project(control) {
      const projection = byControl.get(control)
      if (!projection) throw new Error(`missing ${control}`)
      return projection
    },
  }
}

function testProducer(slotId: TuiChromeSlotId): TuiChromeSlotProducer {
  const controlBySlot: Record<TuiChromeSlotId, Parameters<TuiLogicControlProjector['project']>[0]> = {
    'header.logo': 'logo',
    'header.connection': 'connection',
    'header.session': 'session',
    'header.status': 'status',
    execution: 'execution',
  }
  return {
    slotId,
    project(input) {
      const control = input.logicControls.project(controlBySlot[slotId])
      if (slotId === 'header.logo') {
        if (control.control !== 'logo') throw new Error('logo mismatch')
        return Object.freeze({ slotId, revision: control.revision, publicationRevision: input.publicationRevision, displayMode: 'persistent', variant: control.variant, visible: control.visible })
      }
      if (slotId === 'header.connection') {
        if (control.control !== 'connection') throw new Error('connection mismatch')
        return Object.freeze({ slotId, revision: control.revision, publicationRevision: input.publicationRevision, displayMode: 'persistent', state: control.state })
      }
      if (slotId === 'header.session') {
        if (control.control !== 'session') throw new Error('session mismatch')
        return Object.freeze({ slotId, revision: control.revision, publicationRevision: input.publicationRevision, displayMode: 'persistent', text: control.cwd ?? 'Workspace unavailable' })
      }
      if (slotId === 'header.status') {
        if (control.control !== 'status') throw new Error('status mismatch')
        return Object.freeze({ slotId, revision: control.revision, publicationRevision: input.publicationRevision, displayMode: 'persistent', text: control.mode })
      }
      if (control.control !== 'execution') throw new Error('execution mismatch')
      return Object.freeze({ slotId, revision: control.revision, publicationRevision: input.publicationRevision, displayMode: 'persistent', state: control.state })
    },
  }
}

function displayPlugin(name: string, slotId: TuiChromeSlotId): TuiChromeDisplayPlugin {
  return Object.freeze({
    name,
    slotId,
    apply: (ctx: Context) => { ctx.tuiChromeSlotRegistry.register(ctx, testProducer(slotId)) },
  })
}

const chromeDisplayPlugins: ReadonlyArray<TuiChromeDisplayPlugin> = Object.freeze([
  displayPlugin('app-container.test.logo', 'header.logo'),
  displayPlugin('app-container.test.connection', 'header.connection'),
  displayPlugin('app-container.test.session', 'header.session'),
  displayPlugin('app-container.test.status', 'header.status'),
  displayPlugin('app-container.test.execution', 'execution'),
])

async function install(withRegistry = true) {
  const ctx = new Context()
  applyComponentRegistry(ctx)
  applyTheme(ctx)
  applyTerminalUi(ctx)
  installLogicControls(ctx)
  if (withRegistry) {
    applyChromeSlotRegistry(ctx)
    for (const plugin of chromeDisplayPlugins) await ctx.plugin(plugin)
  }
  applyAppContainer(ctx)
  return ctx
}

function leaves(ctx: any, revision = 1) {
  return ctx.tuiTerminalUi.project({
    model: { nodes: [], publicationRevision: revision },
    composer: { text: '', cursor: 0, lines: [''], cursorLine: 0, cursorColumn: 0, mode: 'idle' },
    status: { sessionId: 'session-a', cwd: '/tmp', mode: 'idle', publicationRevision: revision },
    footer: Object.freeze({
      kind: 'box',
      key: 'leaf.footer',
      style: Object.freeze({ flexDirection: 'column' }),
      children: Object.freeze([
        Object.freeze({ kind: 'text', key: 'footer.status', text: 'Session session-a @ /tmp [idle]', style: Object.freeze({ color: 'white' }) }),
        Object.freeze({ kind: 'text', key: 'footer.marker', text: '-- footer --', style: Object.freeze({ dimColor: true }) }),
      ]),
    }),
    localEchoes: [],
    displayFrame: Object.freeze({
      revision,
      width: 80,
      paddingX: 1,
      topRow: 0,
      height: 0,
      committedRows: Object.freeze([]),
      scrollbackRows: Object.freeze([]),
      rows: Object.freeze([]),
    }),
  })
}

function replaceLeaves(projected: any, overrides: Record<string, unknown> = {}): any {
  const next = { ...projected, ...overrides }
  if (next.transcript !== projected.transcript) {
    next.transcript = Object.freeze({
      ...next.transcript,
      children: Object.freeze([...next.transcript.children]),
    })
  }
  return Object.freeze(next)
}

function input(ctx: any, overrides: Record<string, unknown> = {}) {
  return {
    publicationRevision: 1,
    layout: 'default',
    regionLeaves: leaves(ctx),
    viewport: Object.freeze({ columns: 80, rows: 24 }),
    ...overrides,
  } as any
}

test('composes a closed v3 frame and projects chrome through the slot registry', async () => {
  const ctx = await install()
  const frame: any = ctx.tuiAppContainer.composeFrame(input(ctx))
  assert.equal(frame.contract, 'tui.terminal-frame-tree.v1')
  assert.equal(frame.publicationRevision, 1)
  assert.deepEqual(frame.root.children.map((child: any) => child.key), [
    'region.header',
    'region.transcript',
    'region.composer',
    'region.footer',
  ])
  const header = frame.root.children[0]
  assert.deepEqual(header.children, [])
  const footerWorkspace = frame.root.children[3].children[0]
  assert.equal(footerWorkspace.key, 'region.footer.workspace')
  assert.deepEqual(footerWorkspace.children.map((child: any) => child.text), ['●  ', 'Workspace unavailable', ''])
  assert.equal(frame.root.children[3].children[1].key, 'leaf.footer')
  assert.equal(frame.root.children[0].style.borderStyle, undefined)
  assert.equal(frame.root.children[0].style.backgroundColor, 'black')
  assert.equal(frame.root.children[0].style.flexShrink, 0)
  assert.equal(frame.root.children[1].style.borderStyle, undefined)
  assert.equal(frame.root.children[1].style.backgroundColor, 'black')
  assert.equal(frame.root.children[1].style.flexGrow, 1)
  assert.equal(frame.root.children[1].style.overflow, 'hidden')
  assert.equal(frame.root.children[1].style.paddingX, undefined)
  assert.equal(frame.root.children[2].style.borderStyle, undefined)
  assert.equal(frame.root.children[2].style.backgroundColor, 'gray')
  assert.equal(frame.root.children[3].style.borderStyle, undefined)
  assert.equal(frame.root.children[3].style.backgroundColor, 'dark-gray')
  assert.equal(frame.root.style.width, 80)
  assert.equal(frame.root.style.height, 24)
})

test('compact ordering preserves the fixed chrome-to-composer flow', async () => {
  const ctx = await install()
  ctx.tuiAppContainer.setLayout('compact')
  const frame: any = ctx.tuiAppContainer.composeFrame(input(ctx, { layout: 'compact' }))
  assert.deepEqual(frame.root.children.map((child: any) => child.key), [
    'region.header',
    'region.transcript',
    'region.composer',
    'region.footer',
  ])
})

test('owns the one-cell transcript gutter supplied to display-buffer reflow', async () => {
  const ctx = await install()
  assert.deepEqual(ctx.tuiAppContainer.projectTranscriptLayout(80), { width: 80, paddingX: 1 })
  assert.throws(() => ctx.tuiAppContainer.projectTranscriptLayout(2), /leave room/)
})

test('places the execution leaf in one independent region immediately above composer', async () => {
  const ctx = await install()
  const projected = leaves(ctx)
  const execution = Object.freeze({
    kind: 'box' as const,
    key: 'leaf.execution' as const,
    style: Object.freeze({ flexDirection: 'column' as const }),
    children: Object.freeze([
      Object.freeze({ kind: 'text' as const, key: 'execution-status.line', text: 'Ran command · 0:04 · Esc interrupt', style: Object.freeze({ color: 'white' as const }) }),
    ]),
  })
  const frame: any = ctx.tuiAppContainer.composeFrame(input(ctx, {
    regionLeaves: replaceLeaves(projected, { execution }),
  }))
  assert.deepEqual(frame.root.children.map((child: any) => child.key), [
    'region.header',
    'region.transcript',
    'region.execution',
    'region.composer',
    'region.footer',
  ])
  assert.equal(frame.root.children[2].children[0].key, 'leaf.execution')
  assert.equal(frame.root.children[3].children[0].children.some((child: any) => child.key === 'execution-status.line'), false)
})

test('dynamic header consumes no row because logo is stable and workspace follows composer', async () => {
  const ctx = await install()
  const frame: any = ctx.tuiAppContainer.composeFrame(input(ctx, {
    viewport: Object.freeze({ columns: 60, rows: 12 }),
  }))
  assert.deepEqual(frame.root.children[0].children, [])
  assert.equal(frame.root.children[2].key, 'region.composer')
  assert.equal(frame.root.children[3].children[0].key, 'region.footer.workspace')
})

test('default ordering places an overlay between transcript and composer', async () => {
  const ctx = await install()
  const overlay = Object.freeze({
    kind: 'box' as const,
    key: 'leaf.overlay' as const,
    style: Object.freeze({ flexDirection: 'column' as const }),
    children: Object.freeze([
      Object.freeze({ kind: 'text' as const, key: 'overlay.title', text: 'Models', style: Object.freeze({}) }),
      Object.freeze({ kind: 'box' as const, key: 'overlay.item', style: Object.freeze({ flexDirection: 'row' as const }), children: Object.freeze([Object.freeze({ kind: 'text' as const, key: 'overlay.item.text', text: 'model', style: Object.freeze({}) })]) }),
    ]),
  })
  const frame: any = ctx.tuiAppContainer.composeFrame(input(ctx, {
    regionLeaves: replaceLeaves(leaves(ctx), { overlay }),
  }))
  assert.deepEqual(frame.root.children.map((child: any) => child.key), [
    'region.header',
    'region.transcript',
    'region.overlay',
    'region.composer',
    'region.footer',
  ])
  assert.equal(frame.root.children[2].style.height, 17)
  assert.equal(frame.root.children[2].style.width, 80)
  assert.equal(frame.root.children[2].style.flexGrow, 1)
  assert.equal(frame.root.children[2].children[0].children[1].style.width, 78)
  assert.equal(frame.root.children[2].style.flexShrink, 0)
  assert.equal(frame.root.children[2].style.overflow, 'hidden')
})

test('projects connection and workspace directly below composer without exposing Session ID', async () => {
  const ctx = await install()
  const baseProject = (ctx as any).tuiLogicControls.project.bind((ctx as any).tuiLogicControls)
  ;(ctx as any).tuiLogicControls = {
    project(control: Parameters<TuiLogicControlProjector['project']>[0]) {
      if (control !== 'session') return baseProject(control)
      return Object.freeze({
        ...baseProject(control),
        selectedSessionId: 'session-must-not-render',
        cwd: '/tmp/work',
      })
    },
  }
  const frame: any = ctx.tuiAppContainer.composeFrame(input(ctx))
  const headerText = frame.root.children[0].children.map((child: any) => child.text).join('\n')
  const workspace = frame.root.children.at(-1).children[0]
  const workspaceTexts = workspace.children.map((child: any) => child.text)
  assert.deepEqual(workspaceTexts, ['●  ', '/tmp/work', ''])
  assert.equal(workspaceTexts.join('\n').includes('session-must-not-render'), false)
  assert.doesNotMatch(headerText, /tmp\/work|session-must-not-render/)
})

test('workspace row remains below composer while execution is running', async () => {
  const ctx = await install()
  const baseProject = (ctx as any).tuiLogicControls.project.bind((ctx as any).tuiLogicControls)
  ;(ctx as any).tuiLogicControls = {
    project(control: Parameters<TuiLogicControlProjector['project']>[0]) {
      if (control !== 'status') return baseProject(control)
      return Object.freeze({ ...baseProject(control), mode: 'streaming' })
    },
  }
  const frame: any = ctx.tuiAppContainer.composeFrame(input(ctx))
  const workspaceTexts = frame.root.children.at(-1).children[0].children.map((child: any) => child.text)
  assert.deepEqual(workspaceTexts, ['●  ', 'Workspace unavailable', ''])
  assert.equal(frame.root.children.at(-2).key, 'region.composer')
})

test('connection lamp is the only connection copy and maps state to semantic shape and color', async () => {
  const cases = [
    ['connected', '●  ', 'green'],
    ['connecting', '●  ', 'red'],
    ['disconnected', '○  ', 'red'],
    ['failed', '×  ', 'red'],
  ] as const
  for (const [state, glyph, color] of cases) {
    const ctx = await install()
    const baseProject = (ctx as any).tuiLogicControls.project.bind((ctx as any).tuiLogicControls)
    ;(ctx as any).tuiLogicControls = {
      project(control: Parameters<TuiLogicControlProjector['project']>[0]) {
        if (control !== 'connection') return baseProject(control)
        return Object.freeze({ ...baseProject(control), state })
      },
    }
    const frame: any = ctx.tuiAppContainer.composeFrame(input(ctx))
    const connection = frame.root.children.at(-1).children[0].children[0]
    assert.equal(connection.text, glyph)
    assert.equal(connection.style.color, color)
  }
})

test('preserves all transcript children for display-buffer viewport ownership', async () => {
  const ctx = await install()
  const projected = leaves(ctx)
  const children = [1, 2, 3, 4, 5].map(index => Object.freeze({
    kind: 'text' as const,
    key: `cell.${index}`,
    text: `cell ${index}`,
    style: Object.freeze({}),
  }))
  const frameInput = input(ctx, {
    viewport: Object.freeze({ columns: 40, rows: 10 }),
    regionLeaves: replaceLeaves(projected, {
      transcript: {
        ...projected.transcript,
        children,
      },
    }),
  })
  const frame: any = ctx.tuiAppContainer.composeFrame(frameInput)
  const visible = frame.root.children[1].children[0].children
  assert.deepEqual(visible.map((child: any) => child.key), ['cell.1', 'cell.2', 'cell.3', 'cell.4', 'cell.5'])
  assert.equal(visible.some((child: any) => child.key === 'transcript.older'), false)
})

test('short transcript grows so composer stays anchored above the footer', async () => {
  const ctx = await install()
  const shortTranscript = leaves(ctx).transcript
  const frozenShort = Object.freeze({
    ...shortTranscript,
    children: Object.freeze([
      Object.freeze({
        kind: 'text' as const,
        key: 'cell.short',
        text: 'hello',
        style: Object.freeze({}),
      }),
    ]),
  })
  const frame: any = ctx.tuiAppContainer.composeFrame(input(ctx, {
    viewport: Object.freeze({ columns: 80, rows: 24 }),
    regionLeaves: replaceLeaves(leaves(ctx), { transcript: frozenShort }),
  }))
  assert.equal(frame.root.children[1].style.flexGrow, 1)
  assert.equal(frame.root.children[1].style.flexShrink, 1)
})

test('long transcript keeps grow so overflow clips before composer', async () => {
  const ctx = await install()
  const children = Array.from({ length: 40 }, (_, index) => Object.freeze({
    kind: 'text' as const,
    key: `cell.${index}`,
    text: `cell ${index}`,
    style: Object.freeze({}),
  }))
  const frame: any = ctx.tuiAppContainer.composeFrame(input(ctx, {
    viewport: Object.freeze({ columns: 80, rows: 24 }),
    regionLeaves: replaceLeaves(leaves(ctx), {
      transcript: {
        ...leaves(ctx).transcript,
        children,
      },
    }),
  }))
  assert.equal(frame.root.children[1].style.flexGrow, 1)
  assert.equal(frame.root.children[1].style.flexShrink, 1)
})

test('rejects stale revisions, mismatched regions, unknown layouts, and bad viewports', async () => {
  const ctx = await install()
  ctx.tuiAppContainer.composeFrame(input(ctx))
  const failures = [
    () => ctx.tuiAppContainer.composeFrame(input(ctx, { publicationRevision: 0 })),
    () => ctx.tuiAppContainer.composeFrame(input(ctx, { layout: 'wide' })),
    () => ctx.tuiAppContainer.composeFrame(input(ctx, {
      viewport: Object.freeze({ columns: 0, rows: 10 }),
    })),
    () => ctx.tuiAppContainer.composeFrame(input(ctx, {
      publicationRevision: 2,
      regionLeaves: replaceLeaves(leaves(ctx, 2), { publicationRevision: 1 }),
    })),
  ]
  for (const failure of failures) assert.throws(failure, /stale|unknown layout|viewport|must match/)
})

test('revision epoch reset permits a lower new-session revision without weakening same-epoch rejection', async () => {
  const ctx = await install()
  ctx.tuiAppContainer.setLayout('compact')
  ctx.tuiAppContainer.composeFrame(input(ctx, {
    publicationRevision: 38,
    regionLeaves: leaves(ctx, 38),
  }))
  assert.throws(() => ctx.tuiAppContainer.composeFrame(input(ctx, {
    publicationRevision: 2,
    regionLeaves: leaves(ctx, 2),
  })), /stale revision 2 < 38/)

  ctx.tuiAppContainer.resetRevision()
  const frame = ctx.tuiAppContainer.composeFrame(input(ctx, {
    publicationRevision: 2,
    regionLeaves: leaves(ctx, 2),
  }))
  assert.equal(frame.publicationRevision, 2)
  assert.equal(ctx.tuiAppContainer.layout, 'compact')

  ctx.tuiAppContainer.dispose()
  assert.throws(() => ctx.tuiAppContainer.resetRevision(), /disposed/)
})

test('safe composition reports missing registry without throwing', async () => {
  const ctx = await install(false)
  const result = ctx.tuiAppContainer.composeFrameSafe(input(ctx))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.stage, 'chrome-projection')
    assert.equal(result.error.code, 'invalid-app-container-frame')
    assert.match(result.error.message, /tuiChromeSlotRegistry is not installed/)
  }
})

test('safe composition returns typed validation failures and successful frames', async () => {
  const ctx = await install()
  const invalid = ctx.tuiAppContainer.composeFrameSafe(input(ctx, {
    publicationRevision: 2,
    regionLeaves: replaceLeaves(leaves(ctx, 2), { publicationRevision: 1 }),
  }))
  assert.equal(invalid.ok, false)
  if (!invalid.ok) {
    assert.equal(invalid.error.stage, 'validate')
    assert.equal(invalid.error.code, 'invalid-app-container-frame')
  }

  const valid = ctx.tuiAppContainer.composeFrameSafe(input(ctx))
  assert.equal(valid.ok, true)
  if (valid.ok) assert.equal((valid.value as any).root.key, 'frame.root')
})
