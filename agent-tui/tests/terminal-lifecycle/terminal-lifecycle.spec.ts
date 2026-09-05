import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Static } from 'ink'
import { apply as applyTheme } from '../../src/experiments/theme-plugin/src/theme-plugin.ts'
import type { Key } from 'ink'
import {
  apply as applyLifecycle,
  projectKeyboardInput,
  type TuiTerminalInputEvent,
  type InkInstance,
  type InkRenderFactory,
  type TuiTerminalLifecycle,
} from '../../src/experiments/terminal-lifecycle/src/terminal-lifecycle.ts'

interface RecordingInstance extends InkInstance {
  rerenderCalls: number
  unmountCalls: number
  lastElement: unknown
}

type BridgeElement = {
  props: {
    handlerBox: { handler: ((event: TuiTerminalInputEvent) => void) | null }
    children: unknown
  }
}

function makeFactory(options: {
  mountThrows?: Error
  rerenderThrows?: Error
  flushRejects?: Error
  flushes?: readonly Promise<void>[]
} = {}) {
  let flushIndex = 0
  const instance: RecordingInstance = {
    rerenderCalls: 0,
    unmountCalls: 0,
    lastElement: null,
    rerender(element: unknown) {
      this.rerenderCalls += 1
      this.lastElement = element
      if (options.rerenderThrows) throw options.rerenderThrows
    },
    unmount() {
      this.unmountCalls += 1
    },
    waitUntilRenderFlush() {
      const flush = options.flushes?.[flushIndex]
      flushIndex += 1
      if (flush !== undefined) return flush
      return options.flushRejects ? Promise.reject(options.flushRejects) : Promise.resolve()
    },
    cleanup() {
      this.unmountCalls += 1
    },
  }
  const factory: InkRenderFactory = element => {
    if (options.mountThrows) throw options.mountThrows
    return instance
  }
  return { factory, instance }
}

function streams(columns = 80, rows = 24) {
  const stdout = new PassThrough() as any
  stdout.columns = columns
  stdout.rows = rows
  return {
    stdout: stdout as NodeJS.WriteStream,
    stdin: new PassThrough() as unknown as NodeJS.ReadStream,
    stderr: new PassThrough() as unknown as NodeJS.WriteStream,
  }
}

function install(factory: InkRenderFactory, eventBus?: { publish(event: unknown): void }, stableRows: readonly unknown[] = []) {
  const ctx = new Context()
  applyTheme(ctx)
  ctx.tuiTerminalOutput = { reset: () => undefined, read: () => ({ sessionKey: 'test', width: 80, paddingX: 1, scrollbackRows: stableRows.map((row: any) => row.absoluteRow), stableRows, pendingStableRows: stableRows, liveRows: [], visibleRows: [], dirtyRows: [], revision: 1 }) } as never
  const publisher = eventBus ?? { publish: () => undefined }
  const processTarget = new EventEmitter()
  applyLifecycle(ctx, {
    factory,
    processTarget: processTarget as never,
    eventBus: publisher as never,
  })
  return { lifecycle: ctx.tuiTerminalLifecycle as TuiTerminalLifecycle, processTarget }
}

function tree(marker = 'frame') {
  return {
    contract: 'tui.realized-terminal-primitive-tree.v1',
    root: {
      kind: 'text',
      key: `carrier.${marker}`,
      text: marker,
      style: {},
    },
  } as never
}

test('carrier realization keeps one lifecycle-owned input bridge', () => {
  const recording = makeFactory()
  let mounted: unknown = null
  const { lifecycle } = install((element, options) => {
    mounted = element
    return recording.factory(element, options)
  })
  const events: TuiTerminalInputEvent[] = []
  const handler = (event: TuiTerminalInputEvent): void => {
    events.push(event)
  }
  lifecycle.setInputHandler(handler)
  lifecycle.enter(streams())
  const result = lifecycle.render(tree('input'))
  assert.deepEqual(result, { ok: true })
  const bridge = mounted as BridgeElement
  const carrierRoot = bridge.props.children as { key?: string; props?: { children?: ReadonlyArray<{ key?: string }> } }
  assert.equal(carrierRoot.key, 'terminal-carrier-root')
  assert.equal(carrierRoot.props?.children?.[1]?.key, 'carrier.input')
  bridge.props.handlerBox.handler?.({ type: 'key', input: '/', key: {} as never })
  assert.deepEqual(events, [{ type: 'key', input: '/', key: {} }])
})

test('carrier stays on the primary screen so stable output can enter terminal scrollback', () => {
  let alternateScreen: boolean | undefined
  const recording = makeFactory()
  const { lifecycle } = install((element, options) => {
    alternateScreen = options.alternateScreen
    return recording.factory(element, options)
  })
  lifecycle.enter(streams())
  lifecycle.render(tree('inline-scrollback'))
  assert.equal(alternateScreen, false)
})

test('carrier sends stable rows through Ink Static and leaves live tree dynamic', () => {
  const recording = makeFactory()
  let mounted: any = null
  const stableRows = [{ absoluteRow: 4, line: { spans: [{ text: 'history', style: 'white' }] } }]
  const { lifecycle } = install((element, options) => {
    mounted = element
    return recording.factory(element, options)
  }, undefined, stableRows)
  lifecycle.enter(streams())
  lifecycle.render({
    contract: 'tui.realized-terminal-primitive-tree.v1',
    root: { kind: 'box', key: 'root', style: { flexDirection: 'column' }, children: [
      { kind: 'box', key: 'display-row-4', style: { flexDirection: 'row' }, children: [{ kind: 'text', key: 'text-4', text: 'history', style: { color: 'white' } }] },
      { kind: 'box', key: 'display-row-5', style: { flexDirection: 'row' }, children: [{ kind: 'text', key: 'text-5', text: 'live', style: { color: 'white' } }] },
    ] },
  } as never)
  const carrierRoot = mounted.props.children
  const staticNode = carrierRoot.props.children[0]
  const dynamicRoot = carrierRoot.props.children[1]
  assert.equal(staticNode.type, Static)
  assert.equal(staticNode.props.items.length, 5)
  assert.deepEqual(staticNode.props.items.filter(Boolean).map((item: any) => item.key), ['display-row-4'])
  const dynamicChildren = Array.isArray(dynamicRoot.props.children) ? dynamicRoot.props.children : [dynamicRoot.props.children]
  assert.equal(dynamicChildren.length, 1)
  assert.equal(dynamicChildren[0].key, 'display-row-5')
})

test('stable rows share the layout gutter and realize body, tool, and thinking palette roles', () => {
  const recording = makeFactory()
  let mounted: any = null
  const stableRows = [
    { absoluteRow: 1, line: { spans: [{ text: 'body', style: 'white' }] } },
    { absoluteRow: 2, line: { spans: [{ text: 'tool', style: 'tool' }] } },
    { absoluteRow: 3, line: { spans: [{ text: 'thinking', style: 'thinking' }] } },
  ]
  const { lifecycle } = install((element, options) => {
    mounted = element
    return recording.factory(element, options)
  }, undefined, stableRows)
  lifecycle.enter(streams())
  lifecycle.render(tree('semantic-stable'))
  const items = mounted.props.children.props.children[0].props.items.filter(Boolean)
  const text = (item: any): any => Array.isArray(item.props.children) ? item.props.children[0] : item.props.children
  assert.deepEqual(items.map((item: any) => item.props.paddingX), [1, 1, 1])
  assert.equal(text(items[0]).props.color, '#DCDFE4')
  assert.equal(text(items[1]).props.color, '#56B6C2')
  assert.equal(text(items[2]).props.color, '#8F98A7')
  assert.equal(text(items[2]).props.italic, true)
})

test('empty stable rows retain one terminal row for card and paragraph spacing', () => {
  const recording = makeFactory()
  let mounted: any = null
  const stableRows = [{ absoluteRow: 0, line: { spans: [] } }]
  const { lifecycle } = install((element, options) => {
    mounted = element
    return recording.factory(element, options)
  }, undefined, stableRows)
  lifecycle.enter(streams())
  lifecycle.render(tree('semantic-empty-row'))
  const item = mounted.props.children.props.children[0].props.items[0]
  assert.equal(item.props.paddingX, 1)
  const text = Array.isArray(item.props.children) ? item.props.children[0] : item.props.children
  assert.equal(text.props.children, ' ')
})

test('each later stable append remains in the Static emission batch while prior stable rows stay filtered from live output', async () => {
  const recording = makeFactory()
  const ctx = new Context()
  applyTheme(ctx)
  let snapshot: any = {
    sessionKey: 'test', revision: 1, width: 80, paddingX: 1,
    scrollbackRows: [0],
    stableRows: [{ absoluteRow: 0, line: { spans: [{ text: 'first', style: 'white' }] } }],
    pendingStableRows: [{ absoluteRow: 0, line: { spans: [{ text: 'first', style: 'white' }] } }],
    liveRows: [], visibleRows: [], dirtyRows: [],
  }
  ctx.tuiTerminalOutput = { reset: () => undefined, read: () => snapshot } as never
  applyLifecycle(ctx, { factory: recording.factory, processTarget: new EventEmitter() as never, eventBus: { publish: () => undefined } as never })
  const lifecycle = ctx.tuiTerminalLifecycle
  lifecycle.enter(streams())
  lifecycle.render({
    contract: 'tui.realized-terminal-primitive-tree.v1',
    root: { kind: 'box', key: 'frame.root', style: { flexDirection: 'column', height: 24, minHeight: 8 }, children: [
      { kind: 'box', key: 'display-row-0', style: { flexDirection: 'row' }, children: [{ kind: 'text', key: 'text-0', text: 'first', style: { color: 'white' } }] },
    ] },
  } as never)
  await new Promise<void>(resolve => setImmediate(resolve))
  snapshot = {
    ...snapshot,
    revision: 2,
    scrollbackRows: [0, 1],
    stableRows: [...snapshot.stableRows, { absoluteRow: 1, line: { spans: [{ text: 'second', style: 'white' }] } }],
    pendingStableRows: [{ absoluteRow: 1, line: { spans: [{ text: 'second', style: 'white' }] } }],
  }
  lifecycle.render({
    contract: 'tui.realized-terminal-primitive-tree.v1',
    root: { kind: 'box', key: 'frame.root', style: { flexDirection: 'column', height: 24, minHeight: 8 }, children: [
      { kind: 'box', key: 'display-row-0', style: { flexDirection: 'row' }, children: [{ kind: 'text', key: 'text-0', text: 'first', style: { color: 'white' } }] },
      { kind: 'box', key: 'display-row-1', style: { flexDirection: 'row' }, children: [{ kind: 'text', key: 'text-1', text: 'second', style: { color: 'white' } }] },
      { kind: 'box', key: 'display-row-2', style: { flexDirection: 'row' }, children: [{ kind: 'text', key: 'text-2', text: 'live', style: { color: 'white' } }] },
    ] },
  } as never)
  await new Promise<void>(resolve => setImmediate(resolve))
  const rerendered: any = recording.instance.lastElement
  const carrier = rerendered.props.children
  assert.deepEqual(carrier.props.children[0].props.items.filter(Boolean).map((item: any) => item.key), ['display-row-1'])
  const dynamicChildren = carrier.props.children[1].props.children
  assert.deepEqual((Array.isArray(dynamicChildren) ? dynamicChildren : [dynamicChildren]).map((item: any) => item.key), ['display-row-2'])
})

test('same-layout stable appends preserve Static identity and advance its monotonic item index', async () => {
  const recording = makeFactory()
  const ctx = new Context()
  applyTheme(ctx)
  let snapshot: any = {
    sessionKey: 'session-a', revision: 4, width: 80, paddingX: 1,
    scrollbackRows: [4],
    stableRows: [{ absoluteRow: 4, line: { spans: [{ text: 'first', style: 'white' }] } }],
    pendingStableRows: [{ absoluteRow: 4, line: { spans: [{ text: 'first', style: 'white' }] } }],
    liveRows: [], visibleRows: [], dirtyRows: [],
  }
  let mounted: any = null
  ctx.tuiTerminalOutput = { reset: () => undefined, read: () => snapshot } as never
  applyLifecycle(ctx, {
    factory: (element, options) => { mounted = element; return recording.factory(element, options) },
    processTarget: new EventEmitter() as never,
    eventBus: { publish: () => undefined } as never,
  })
  const lifecycle = ctx.tuiTerminalLifecycle
  lifecycle.enter(streams())
  lifecycle.render(tree('first'))
  await new Promise<void>(resolve => setImmediate(resolve))
  const firstStatic = mounted.props.children.props.children[0]

  snapshot = {
    ...snapshot,
    revision: 5,
    pendingStableRows: [],
  }
  lifecycle.render(tree('no-append'))
  await new Promise<void>(resolve => setImmediate(resolve))
  const unchanged: any = recording.instance.lastElement
  const unchangedStatic = unchanged.props.children.props.children[0]
  assert.equal(unchangedStatic.key, firstStatic.key)
  assert.equal(unchangedStatic.props.items.length, 5)
  assert.equal(unchangedStatic.props.items.filter(Boolean).length, 0)

  snapshot = {
    ...snapshot,
    revision: 6,
    scrollbackRows: [4, 5],
    stableRows: [...snapshot.stableRows, { absoluteRow: 5, line: { spans: [{ text: 'second', style: 'white' }] } }],
    pendingStableRows: [{ absoluteRow: 5, line: { spans: [{ text: 'second', style: 'white' }] } }],
  }
  lifecycle.render(tree('second'))
  await new Promise<void>(resolve => setImmediate(resolve))
  const rerendered: any = recording.instance.lastElement
  const secondStatic = rerendered.props.children.props.children[0]

  assert.equal(secondStatic.key, firstStatic.key)
  assert.equal(firstStatic.props.items.length, 5)
  assert.equal(secondStatic.props.items.length, 6)
  assert.equal(firstStatic.props.items[4].key, 'display-row-4')
  assert.equal(secondStatic.props.items[5].key, 'display-row-5')
})

test('stable batches arriving during one pending flush are emitted together in absolute-row order', async () => {
  let releaseFirstFlush!: () => void
  const firstFlush = new Promise<void>(resolve => { releaseFirstFlush = resolve })
  const recording = makeFactory({ flushes: [firstFlush] })
  const ctx = new Context()
  applyTheme(ctx)
  const row = (absoluteRow: number) => ({ absoluteRow, line: { spans: [{ text: `stable-${String(absoluteRow)}`, style: 'white' }] } })
  let snapshot: any = {
    sessionKey: 'session-a', revision: 1, width: 80, paddingX: 1,
    scrollbackRows: [0], stableRows: [row(0)], pendingStableRows: [row(0)],
    liveRows: [], visibleRows: [], dirtyRows: [],
  }
  ctx.tuiTerminalOutput = { reset: () => undefined, read: () => snapshot } as never
  applyLifecycle(ctx, {
    factory: recording.factory,
    processTarget: new EventEmitter() as never,
    eventBus: { publish: () => undefined } as never,
  })
  const lifecycle = ctx.tuiTerminalLifecycle
  lifecycle.enter(streams())
  lifecycle.render(tree('initial'))

  snapshot = { ...snapshot, revision: 2, scrollbackRows: [0, 1], stableRows: [row(0), row(1)], pendingStableRows: [row(1)] }
  lifecycle.render(tree('tool'))
  snapshot = { ...snapshot, revision: 3, scrollbackRows: [0, 1, 2], stableRows: [row(0), row(1), row(2)], pendingStableRows: [row(2)] }
  lifecycle.render(tree('assistant'))
  snapshot = { ...snapshot, revision: 4, scrollbackRows: [0, 1, 2, 3], stableRows: [row(0), row(1), row(2), row(3)], pendingStableRows: [row(3)] }
  lifecycle.render(tree('divider'))

  assert.equal(recording.instance.rerenderCalls, 3)
  releaseFirstFlush()
  await new Promise<void>(resolve => setImmediate(resolve))

  assert.equal(recording.instance.rerenderCalls, 4)
  const rerendered: any = recording.instance.lastElement
  const staticNode = rerendered.props.children.props.children[0]
  assert.deepEqual(staticNode.props.items.filter(Boolean).map((item: any) => item.key), [
    'display-row-1',
    'display-row-2',
    'display-row-3',
  ])
})

test('dynamic-only frames during one pending flush coalesce to the latest SSE frame', async () => {
  let releaseFirstFlush!: () => void
  const firstFlush = new Promise<void>(resolve => { releaseFirstFlush = resolve })
  const recording = makeFactory({ flushes: [firstFlush] })
  const { lifecycle } = install(recording.factory)
  lifecycle.enter(streams())
  lifecycle.render(tree('initial'))
  lifecycle.render(tree('stream-1'))
  lifecycle.render(tree('stream-2'))
  lifecycle.render(tree('stream-latest'))

  assert.equal(recording.instance.rerenderCalls, 3)
  releaseFirstFlush()
  await new Promise<void>(resolve => setImmediate(resolve))

  assert.equal(recording.instance.rerenderCalls, 4)
  const rerendered: any = recording.instance.lastElement
  assert.equal(rerendered.props.children.props.children[1].key, 'carrier.stream-latest')
  assert.equal(rerendered.props.children.props.children[0].props.items.filter(Boolean).length, 0)
})

test('layout changes replace Static identity and replay the retained stable window', async () => {
  const recording = makeFactory()
  const ctx = new Context()
  applyTheme(ctx)
  const rows = [7, 8].map(absoluteRow => ({ absoluteRow, line: { spans: [{ text: String(absoluteRow), style: 'white' }] } }))
  let snapshot: any = {
    sessionKey: 'session-a', revision: 8, width: 80, paddingX: 1,
    scrollbackRows: [7, 8], stableRows: rows, pendingStableRows: rows,
    liveRows: [], visibleRows: [], dirtyRows: [],
  }
  let mounted: any = null
  ctx.tuiTerminalOutput = { reset: () => undefined, read: () => snapshot } as never
  applyLifecycle(ctx, {
    factory: (element, options) => { mounted = element; return recording.factory(element, options) },
    processTarget: new EventEmitter() as never,
    eventBus: { publish: () => undefined } as never,
  })
  const lifecycle = ctx.tuiTerminalLifecycle
  lifecycle.enter(streams())
  lifecycle.render(tree('before-resize'))
  await new Promise<void>(resolve => setImmediate(resolve))
  const firstStatic = mounted.props.children.props.children[0]

  snapshot = { ...snapshot, revision: 9, width: 100, pendingStableRows: rows }
  lifecycle.render(tree('after-resize'))
  await new Promise<void>(resolve => setImmediate(resolve))
  const rerendered: any = recording.instance.lastElement
  const secondStatic = rerendered.props.children.props.children[0]

  assert.notEqual(secondStatic.key, firstStatic.key)
  assert.deepEqual(secondStatic.props.items.filter(Boolean).map((item: any) => item.key), ['display-row-7', 'display-row-8'])
})

test('carrier reserves current-screen rows for newly stable history above the live viewport', () => {
  const recording = makeFactory()
  let mounted: any = null
  const stableRows = [0, 1].map(absoluteRow => ({ absoluteRow, line: { spans: [{ text: `history-${String(absoluteRow)}`, style: 'white' }] } }))
  const { lifecycle } = install((element, options) => {
    mounted = element
    return recording.factory(element, options)
  }, undefined, stableRows)
  lifecycle.enter(streams(80, 24))
  lifecycle.render({
    contract: 'tui.realized-terminal-primitive-tree.v1',
    root: { kind: 'box', key: 'frame.root', style: { flexDirection: 'column', height: 24, minHeight: 10 }, children: [] },
  } as never)
  const dynamicRoot = mounted.props.children.props.children[1]
  assert.equal(dynamicRoot.props.height, 22)
})

test('carrier never shrinks the live viewport below the layout-owned minimum', () => {
  const recording = makeFactory()
  let mounted: any = null
  const stableRows = Array.from({ length: 30 }, (_, absoluteRow) => ({ absoluteRow, line: { spans: [{ text: `history-${String(absoluteRow)}`, style: 'white' }] } }))
  const { lifecycle } = install((element, options) => {
    mounted = element
    return recording.factory(element, options)
  }, undefined, stableRows)
  lifecycle.enter(streams(80, 24))
  lifecycle.render({
    contract: 'tui.realized-terminal-primitive-tree.v1',
    root: { kind: 'box', key: 'frame.root', style: { flexDirection: 'column', height: 24, minHeight: 10 }, children: [] },
  } as never)
  const dynamicRoot = mounted.props.children.props.children[1]
  assert.equal(dynamicRoot.props.height, 10)
})

test('input bridge observes a handler installed after its first render', () => {
  const recording = makeFactory()
  let mounted: BridgeElement | null = null
  const { lifecycle } = install((element, options) => {
    mounted = element as BridgeElement
    return recording.factory(element, options)
  })
  const events: TuiTerminalInputEvent[] = []
  lifecycle.enter(streams())
  lifecycle.render(tree('handler-late'))
  lifecycle.setInputHandler(event => events.push(event))

  const mountedElement = mounted as unknown as BridgeElement
  mountedElement.props.handlerBox.handler?.({ type: 'key', input: 'x', key: {} as never })

  assert.deepEqual(events, [{ type: 'key', input: 'x', key: {} }])
})

test('keyboard chunks containing carriage returns submit once', () => {
  const events: TuiTerminalInputEvent[] = []
  const key: Key = {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  }
  projectKeyboardInput('/quit\r', key, event => events.push(event))
  assert.deepEqual(events, [
    { type: 'key', input: '/quit', key },
    { type: 'key', input: '', key: { ...key, return: true } },
  ])
})

test('Shift+Enter escape sequences become newline key events', () => {
  const events: TuiTerminalInputEvent[] = []
  const key = {} as Key
  for (const input of ['\u001b[13;2u', '\u001b[27;2;13~', '\u001b[13;2~']) {
    projectKeyboardInput(input, key, event => events.push(event))
  }
  assert.deepEqual(events.map(event => ({ input: event.input, return: event.key.return, shift: event.key.shift })), [
    { input: '', return: true, shift: true },
    { input: '', return: true, shift: true },
    { input: '', return: true, shift: true },
  ])
})

test('coalesced physical Tab input is projected between adjacent text events', () => {
  const events: TuiTerminalInputEvent[] = []
  projectKeyboardInput('queued\tsecond', {} as Key, event => events.push(event))
  assert.deepEqual(events.map(event => ({ input: event.input, tab: event.key.tab, return: event.key.return })), [
    { input: 'queued', tab: undefined, return: undefined },
    { input: '', tab: true, return: false },
    { input: 'second', tab: undefined, return: undefined },
  ])
})

test('a raw physical Tab becomes a key event instead of literal composer text', () => {
  const events: TuiTerminalInputEvent[] = []
  projectKeyboardInput('\t', {} as Key, event => events.push(event))
  assert.deepEqual(events.map(event => ({ input: event.input, tab: event.key.tab })), [
    { input: '', tab: true },
  ])
})

test('raw ETX Ctrl+C is normalized to the canonical ctrl-c key event', () => {
  const events: TuiTerminalInputEvent[] = []
  projectKeyboardInput('\u0003', {} as Key, event => events.push(event))
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, 'c')
  assert.equal(events[0]?.key.ctrl, true)
})

test('multiple ETX bytes in one stdin chunk remain separate Ctrl+C events', () => {
  const events: TuiTerminalInputEvent[] = []
  projectKeyboardInput('\u0003\u0003', {} as Key, event => events.push(event))
  assert.deepEqual(events.map(event => ({ input: event.input, ctrl: event.key.ctrl })), [
    { input: 'c', ctrl: true },
    { input: 'c', ctrl: true },
  ])
})

test('empty-input editing keys are forwarded to the runtime handler', () => {
  const events: TuiTerminalInputEvent[] = []
  const key: Key = {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: true,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  }
  projectKeyboardInput('', key, event => events.push(event))
  assert.deepEqual(events, [{ type: 'key', input: '', key }])
})

test('enter activates once and rejects a second activation', () => {
  const { lifecycle } = install(makeFactory().factory)
  lifecycle.enter(streams())
  assert.equal(lifecycle.state(), 'active')
  assert.throws(() => lifecycle.enter(streams()), /already active|illegal transition/)
})

test('render outside active state routes carrier failure without throwing', () => {
  const { lifecycle } = install(makeFactory().factory)
  const states: string[] = []
  lifecycle.subscribe(state => states.push(state))
  const result = lifecycle.render(tree('idle'))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.stage, 'rerender')
    assert.equal(result.error.code, 'terminal-carrier-failed')
  }
  assert.equal(lifecycle.state(), 'failed')
  assert.match(lifecycle.failure()?.message ?? '', /requires active state/)
  assert.deepEqual(states.at(-2), 'idle')
  assert.equal(states.at(-1), 'failed')
})

test('first render mounts and later render rerenders the same carrier', async () => {
  const { factory, instance } = makeFactory()
  const { lifecycle } = install(factory)
  lifecycle.enter(streams())
  const first = lifecycle.render(tree('one'))
  await new Promise<void>(resolve => setImmediate(resolve))
  const second = lifecycle.render(tree('two'))
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(first, { ok: true })
  assert.deepEqual(second, { ok: true })
  assert.equal(instance.rerenderCalls, 1)
  assert.notEqual(instance.lastElement, undefined)
})

test('synchronous invalidation during first mount reuses the pending instance', () => {
  const recording = makeFactory()
  let service!: TuiTerminalLifecycle
  let factoryCalls = 0
  let invalidated = false
  const reentrant: InkRenderFactory = (element, renderOptions) => {
    factoryCalls += 1
    if (!invalidated) {
      invalidated = true
      service.render(tree('latest'))
    }
    return recording.factory(element, renderOptions)
  }
  ;({ lifecycle: service } = install(reentrant))
  service.enter(streams())
  const result = service.render(tree('initial'))
  assert.deepEqual(result, { ok: true })
  assert.equal(factoryCalls, 1)
  assert.equal(recording.instance.rerenderCalls, 1)
})

test('mount failure returns typed result and transitions failed exactly once', () => {
  const cause = new Error('mount exploded')
  const { lifecycle } = install(makeFactory({ mountThrows: cause }).factory)
  const states: string[] = []
  lifecycle.subscribe(state => states.push(state))
  lifecycle.enter(streams())
  const result = lifecycle.render(tree())
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.stage, 'mount')
    assert.equal(result.error.cause, cause)
  }
  assert.equal(lifecycle.state(), 'failed')
  assert.equal(states.filter(state => state === 'failed').length, 1)
})

test('async flush rejection routes the dedicated flush source', async () => {
  const flushCause = new Error('flush exploded')
  const flush = makeFactory({ flushRejects: flushCause })
  const { lifecycle } = install(flush.factory)
  lifecycle.enter(streams())
  const result = lifecycle.render(tree())
  assert.deepEqual(result, { ok: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(lifecycle.state(), 'failed')
  assert.equal(lifecycle.failure()?.cause, flushCause)
  assert.match(lifecycle.failure()?.message ?? '', /async render flush failed/)
})

test('enter observes real viewport and publishes one frozen terminal.resize intent', () => {
  const published: any[] = []
  const { lifecycle } = install(makeFactory().factory, { publish: event => published.push(event) })
  lifecycle.enter(streams(101, 31))
  assert.equal(published.length, 1)
  assert.equal(published[0].kind, 'terminal.resize')
  assert.equal(published[0].sourceId, 'terminal.streams')
  assert.deepEqual(published[0].size, { columns: 101, rows: 31 })
  assert.ok(Object.isFrozen(published[0].size))
})

test('enter fails closed when real stdout has no valid viewport', () => {
  const { lifecycle: missingDimensions } = install(makeFactory().factory)
  missingDimensions.enter(streams(0, 0))
  assert.equal(missingDimensions.state(), 'failed')
  assert.match(missingDimensions.failure()?.message ?? '', /positive columns/)

})

test('exit unmounts once and settles exited; later fail cannot revive it', () => {
  const { factory, instance } = makeFactory()
  const { lifecycle } = install(factory)
  lifecycle.enter(streams())
  lifecycle.render(tree())
  lifecycle.exit({ reason: 'normal' })
  assert.equal(instance.unmountCalls, 1)
  assert.equal(lifecycle.state(), 'exited')
  lifecycle.fail(new Error('late'), 'late')
  assert.equal(lifecycle.failure(), null)
})

test('SIGINT enters the canonical input path instead of exiting immediately', () => {
  const { lifecycle, processTarget } = install(makeFactory().factory)
  const events: TuiTerminalInputEvent[] = []
  lifecycle.setInputHandler(event => events.push(event))
  lifecycle.enter(streams())

  processTarget.emit('SIGINT')

  assert.equal(lifecycle.state(), 'active')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.type, 'key')
  assert.equal(events[0]?.input, 'c')
  assert.equal(events[0]?.key.ctrl, true)
})

test('SIGINT listener removal is deferred when the input handler exits the lifecycle', async () => {
  const { lifecycle, processTarget } = install(makeFactory().factory)
  lifecycle.setInputHandler(() => lifecycle.exit({ reason: 'ctrl-c-confirm' }))
  lifecycle.enter(streams())

  processTarget.emit('SIGINT')

  assert.equal(lifecycle.state(), 'exited')
  assert.equal(processTarget.listenerCount('SIGINT'), 1)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(processTarget.listenerCount('SIGINT'), 0)
})
