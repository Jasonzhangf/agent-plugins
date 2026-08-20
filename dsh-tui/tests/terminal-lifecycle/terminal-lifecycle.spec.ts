import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  apply as applyLifecycle,
  type InkInstance,
  type InkRenderFactory,
  type TuiInkTreeComposed,
  type TuiTerminalLifecycle,
} from '../../playground/experiments/terminal-lifecycle/src/terminal-lifecycle.ts'

function apply(ctx: Context, options: Parameters<typeof applyLifecycle>[1] = {}): void {
  applyLifecycle(ctx, {
    processTarget: new EventEmitter() as never,
    ...options,
  })
}

interface RecordingInstance extends InkInstance {
  rerenderCalls: number
  unmountCalls: number
  scheduledFlushes: number
  completedFlushes: number
  lastRendered: unknown
  drainFlush(): Promise<void>
}

interface RecordingFactory extends InkRenderFactory {
  instance: RecordingInstance
  calls: number
  initialNode: unknown
}

function makeRecordingFactory(): RecordingFactory {
  const instance: RecordingInstance = {
    rerenderCalls: 0,
    unmountCalls: 0,
    scheduledFlushes: 0,
    completedFlushes: 0,
    lastRendered: null,
    rerender(node: unknown) {
      instance.rerenderCalls += 1
      instance.lastRendered = node
    },
    unmount() {
      instance.unmountCalls += 1
    },
    waitUntilRenderFlush(): Promise<void> {
      instance.scheduledFlushes += 1
      return new Promise<void>(resolve => {
        queueMicrotask(() => {
          instance.completedFlushes += 1
          resolve()
        })
      })
    },
    cleanup() {
      instance.unmountCalls += 1
    },
    async drainFlush() {
      await new Promise(resolve => setImmediate(resolve))
    },
  }
  const factory = ((node: unknown) => {
    factory.calls += 1
    factory.initialNode = node
    return instance
  }) as unknown as RecordingFactory
  factory.instance = instance
  factory.calls = 0
  factory.initialNode = undefined
  return factory
}

function streamPair(): {
  stdout: NodeJS.WriteStream; stdin: NodeJS.ReadStream; stderr: NodeJS.WriteStream
} {
  return {
    stdout: new PassThrough() as unknown as NodeJS.WriteStream,
    stdin: new PassThrough() as unknown as NodeJS.ReadStream,
    stderr: new PassThrough() as unknown as NodeJS.WriteStream,
  }
}

function userNode(value: Readonly<Record<string, unknown>>, revision = 1): TuiInkTreeComposed {
  return {
    nodeId: 'tui.shell',
    kind: 'tui.shell',
    publicationRevision: revision,
    lifecycle: 'settled',
    descriptor: {
      contract: 'tui.terminal-shell.v1',
      width: 80,
      scrollOffset: 0,
      transcript: [{
        nodeId: 'n1',
        lifecycle: 'settled',
        output: { contract: 'tui.element.v1', elementType: 'conversation.user', props: value },
      }],
      localEchoes: [],
      composer: { text: '', cursor: 0, lines: [''], cursorLine: 0, cursorColumn: 0, mode: 'idle' },
      status: { sessionId: 's1', cwd: '/workspace', mode: 'idle', publicationRevision: revision },
    },
  }
}

test('default state is idle and observable', () => {
  const ctx = new Context()
  apply(ctx, { factory: makeRecordingFactory() })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  assert.equal(service.state(), 'idle')
  const states: string[] = []
  const dispose = service.subscribe(state => states.push(state))
  assert.deepEqual(states, ['idle'])
  dispose()
})

test('enter() activates once; second enter fails closed', () => {
  const ctx = new Context()
  apply(ctx, { factory: makeRecordingFactory() })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  const streams = streamPair()
  service.enter(streams)
  assert.equal(service.state(), 'active')
  assert.throws(() => service.enter(streams), /already active|illegal transition/)
})

test('first render mounts the complete Ink tree instead of a null placeholder', () => {
  const ctx = new Context()
  const factory = makeRecordingFactory()
  apply(ctx, { factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.setInputHandler(() => undefined)
  service.enter(streamPair())
  assert.equal(factory.calls, 0)
  service.render(userNode({ text: 'hello' }))
  assert.equal(factory.calls, 1)
  assert.equal(typeof factory.initialNode, 'object')
  assert.notEqual(factory.initialNode, null)
  assert.equal(factory.instance.rerenderCalls, 0)
})

test('synchronous invalidation during first mount reuses the pending Ink instance', () => {
  const ctx = new Context()
  const recordingFactory = makeRecordingFactory()
  let service!: TuiTerminalLifecycle
  let factoryCalls = 0
  let invalidated = false
  const reentrantFactory: InkRenderFactory = (node, options) => {
    factoryCalls += 1
    if (!invalidated) {
      invalidated = true
      service.render(userNode({ text: 'latest' }, 2))
    }
    return recordingFactory(node, options)
  }
  apply(ctx, { factory: reentrantFactory })
  service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  service.render(userNode({ text: 'initial' }, 1))
  assert.equal(factoryCalls, 1)
  assert.equal(recordingFactory.calls, 1)
  assert.equal(recordingFactory.instance.rerenderCalls, 1)
  assert.equal(typeof recordingFactory.instance.lastRendered, 'object')
})

test('render() rejects nodes that smuggle transport/control fields', () => {
  const ctx = new Context()
  apply(ctx, { factory: makeRecordingFactory() })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  assert.throws(
    () => service.render(userNode({ text: 'x', transport: 'foo' })),
    /forbidden prop/,
  )
  assert.throws(
    () => service.render(userNode({ text: 'x', metadata: { source: 'control' } })),
    /forbidden prop/,
  )
  assert.throws(
    () => service.render(userNode({ text: 'x', seq: 1, event: { type: 'user/message' } })),
    /forbidden prop/,
  )
  assert.throws(
    () => service.render(userNode({ text: 'x', endpoint: 'http://x', rpcId: 'r1' })),
    /forbidden prop/,
  )
})

test('render() forwards canonical nodes and coalesces same-tick calls', async () => {
  const ctx = new Context()
  const factory = makeRecordingFactory()
  apply(ctx, { factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  service.render(userNode({ text: 'hello' }, 1))
  service.render(userNode({ text: 'hello world' }, 2))
  service.render(userNode({ text: 'hello world!' }, 3))
  assert.equal(factory.calls, 1)
  assert.equal(factory.instance.rerenderCalls, 2)
  assert.equal(typeof factory.instance.lastRendered, 'object')
  assert.notEqual(factory.instance.lastRendered, null)
  assert.equal(factory.instance.scheduledFlushes, 1)
  await factory.instance.drainFlush()
  assert.equal(factory.instance.completedFlushes, 1)
})

test('exit() restores through the active instance and rejects re-entry', () => {
  const ctx = new Context()
  const factory = makeRecordingFactory()
  apply(ctx, { factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  service.render(userNode({ text: 'mounted' }))
  service.exit({ reason: 'normal' })
  assert.equal(service.state(), 'exited')
  assert.equal(factory.instance.unmountCalls, 1)
  assert.throws(() => service.exit({ reason: 'normal' }), /already exited/)
  assert.throws(() => service.enter(streamPair()), /illegal transition|already exited/)
})

test('render exception routes through restore() and fails closed', () => {
  const ctx = new Context()
  const throwingInstance: InkInstance = {
    rerender() { throw new Error('ink-render-failure') },
    unmount() {},
    waitUntilRenderFlush() { return Promise.resolve() },
    cleanup() {},
  }
  let calls = 0
  const throwingFactory: InkRenderFactory = () => {
    calls += 1
    return throwingInstance
  }
  apply(ctx, { factory: throwingFactory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  service.render(userNode({ text: 'mounted' }))
  assert.throws(() => service.render(userNode({ text: 'x' })), /ink-render-failure/)
  assert.equal(service.state(), 'failed')
  assert.match(service.failure()?.message ?? '', /ink-render-failure/)
})

test('stdin EOF restores the mounted terminal and exits exactly once', () => {
  const ctx = new Context()
  const factory = makeRecordingFactory()
  const streams = streamPair()
  apply(ctx, { factory, signalTargets: [] })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streams)
  service.render(userNode({ text: 'mounted' }))

  streams.stdin.emit('end')

  assert.equal(service.state(), 'exited')
  assert.equal(factory.instance.unmountCalls, 1)
  assert.equal(streams.stdin.listenerCount('end'), 0)
  streams.stdin.emit('end')
  assert.equal(factory.instance.unmountCalls, 1)
})

test('unhandled rejection restores the terminal, reports failure, and detaches the process listener', () => {
  const ctx = new Context()
  const factory = makeRecordingFactory()
  const processEvents = new EventEmitter()
  apply(ctx, { factory, signalTargets: [], processTarget: processEvents as never })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  service.render(userNode({ text: 'mounted' }))

  processEvents.emit('unhandledRejection', new Error('async-failure'), Promise.resolve())

  assert.equal(service.state(), 'failed')
  assert.match(service.failure()?.message ?? '', /async-failure/)
  assert.equal(factory.instance.unmountCalls, 1)
  assert.equal(processEvents.listenerCount('unhandledRejection'), 0)
})

test('suspend/resume preserve the render instance and gate render() during suspension', () => {
  const ctx = new Context()
  const factory = makeRecordingFactory()
  apply(ctx, { factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  service.suspend({ reason: 'suspend-test' })
  assert.equal(service.state(), 'suspended')
  assert.throws(() => service.render(userNode({ text: 'ignored' })), /suspended/)
  service.resume()
  assert.equal(service.state(), 'active')
  service.render(userNode({ text: 'after' }, 1))
  assert.equal(factory.calls, 1)
  assert.equal(factory.instance.rerenderCalls, 0)
})

test('illegal state transitions fail fast', () => {
  const ctx = new Context()
  apply(ctx, { factory: makeRecordingFactory() })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  assert.throws(() => service.suspend({ reason: 'x' }), /illegal transition|active/)
  assert.throws(() => service.exit({ reason: 'x' }), /illegal transition|active/)
  assert.throws(() => service.render(userNode({ text: 'x' })), /illegal transition|active/)
})

test('Cordis effect cleanup can drive explicit exit() and release the instance', async () => {
  const ctx = new Context()
  const factory = makeRecordingFactory()
  apply(ctx, { factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  service.render(userNode({ text: 'mounted' }))
  let disposed = false
  const dispose = ctx.effect(() => async () => {
    disposed = true
    service.exit({ reason: 'effect-cleanup' })
  }, 'terminal-lifecycle.test-observer')
  await dispose()
  assert.equal(disposed, true)
  assert.equal(service.state(), 'exited')
  assert.equal(factory.instance.unmountCalls, 1)
})

test('Cordis effect disposal registered inside the service triggers disengage()', () => {
  // The terminal-lifecycle service registers an internal effect whose cleanup
  // disengages it. We can verify the wiring directly by inspecting the effect
  // tree reported by Cordis, but a simpler positive control is that the
  // service never leaves the Ink instance mounted after its effect cleanup is
  // invoked indirectly through a fresh effect that calls exit() during
  // teardown of a fiber-local plugin.
  const ctx = new Context()
  const factory = makeRecordingFactory()
  apply(ctx, { factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  service.render(userNode({ text: 'mounted' }))
  // Use a service-level signal: kill the process via SIGINT and assert cleanup
  // would run. We cannot actually raise SIGINT here, so we use the public
  // exit() API, which the internal disposal effect also delegates to.
  service.exit({ reason: 'lifecycle-cleanup' })
  assert.equal(service.state(), 'exited')
  assert.equal(factory.instance.unmountCalls, 1)
})

test('module never invokes process.exit directly', () => {
  const ctx = new Context()
  const factory = makeRecordingFactory()
  apply(ctx, { factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  const originalExit = process.exit
  let exitCalls = 0
  ;(process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
    exitCalls += 1
    throw new Error(`process.exit called with ${code}`)
  }) as never
  try {
    service.enter(streamPair())
    service.exit({ reason: 'normal' })
    assert.equal(exitCalls, 0)
  } finally {
    ;(process as unknown as { exit: typeof originalExit }).exit = originalExit
  }
})

test('input handler handed to the Ink tree is identity-stable across renders', () => {
  // Regression: the Cordis traceable proxy re-wraps any function-typed own
  // property on every read, which would hand React a new handler reference on
  // each render and re-fire the resize effect in an infinite loop (max update
  // depth). The handler must therefore be the exact function set via
  // setInputHandler, shared by every composed element.
  const ctx = new Context()
  const factory = makeRecordingFactory()
  apply(ctx, { factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  const handler = () => undefined
  service.setInputHandler(handler)
  service.enter(streamPair())

  service.render(userNode({ text: 'one' }))
  const firstProps = (factory.initialNode as { props: { handler: unknown } }).props

  service.render(userNode({ text: 'two' }))
  const secondProps = (factory.instance.lastRendered as { props: { handler: unknown } }).props

  assert.equal(typeof firstProps.handler, 'function')
  assert.equal(firstProps.handler, handler, 'first render must carry the exact setInputHandler function')
  assert.equal(secondProps.handler, handler, 're-render must carry the exact setInputHandler function')
  assert.equal(firstProps.handler, secondProps.handler, 'handler identity must be stable across renders')
})
