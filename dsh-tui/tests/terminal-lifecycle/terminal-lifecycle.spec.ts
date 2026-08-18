import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  type InkInstance,
  type InkRenderFactory,
  type TuiTerminalLifecycle,
} from '../../playground/experiments/terminal-lifecycle/src/terminal-lifecycle.ts'

interface RecordingInstance extends InkInstance {
  rerenderCalls: number
  unmountCalls: number
  scheduledFlushes: number
  completedFlushes: number
  lastRendered: unknown
  drainFlush(): Promise<void>
}

function makeRecordingFactory(): { factory: InkRenderFactory; instance: RecordingInstance; rebuild: () => RecordingInstance } {
  let next: RecordingInstance
  const rebuild = (): RecordingInstance => {
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
        // Allow any pending flush microtasks to settle.
        await new Promise(resolve => setImmediate(resolve))
      },
    }
    return instance
  }
  next = rebuild()
  const factory: InkRenderFactory = (node, _options) => {
    void node
    return next
  }
  return { factory, instance: next, rebuild: () => { next = rebuild(); return next } }
}

function installContext(opts: { factory?: InkRenderFactory } = {}): { ctx: Context; service: TuiTerminalLifecycle } {
  const ctx = new Context()
  const recording = makeRecordingFactory()
  apply(ctx, { factory: opts.factory ?? recording.factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  return { ctx, service, instance: recording.instance } as never
}

function streamPair(): { stdout: NodeJS.WriteStream; stdin: NodeJS.ReadStream; stderr: NodeJS.WriteStream } {
  return {
    stdout: new PassThrough() as unknown as NodeJS.WriteStream,
    stdin: new PassThrough() as unknown as NodeJS.ReadStream,
    stderr: new PassThrough() as unknown as NodeJS.WriteStream,
  }
}

test('default state is idle and observable', () => {
  const ctx = new Context()
  apply(ctx, { factory: makeRecordingFactory().factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  assert.equal(service.state(), 'idle')
  const states: string[] = []
  const dispose = service.subscribe(state => states.push(state))
  assert.deepEqual(states, ['idle'])
  dispose()
})

test('enter() activates once; second enter fails closed', () => {
  const ctx = new Context()
  apply(ctx, { factory: makeRecordingFactory().factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  const streams = streamPair()
  service.enter(streams)
  assert.equal(service.state(), 'active')
  assert.throws(() => service.enter(streams), /already active/)
})

test('render() rejects nodes that smuggle transport/control fields', () => {
  const ctx = new Context()
  apply(ctx, { factory: makeRecordingFactory().factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  assert.throws(
    () => service.render({ nodeId: 'a', kind: 'conversation.user', publicationRevision: 1, lifecycle: 'settled', value: { text: 'x', transport: 'foo' } } as never),
    /forbidden prop|transport|control/,
  )
  assert.throws(
    () => service.render({ nodeId: 'b', kind: 'conversation.user', publicationRevision: 1, lifecycle: 'settled', value: { text: 'x', metadata: { source: 'control' } } } as never),
    /forbidden prop|metadata|control/,
  )
  assert.throws(
    () => service.render({ nodeId: 'c', kind: 'conversation.user', publicationRevision: 1, lifecycle: 'settled', value: { text: 'x', seq: 1, event: { type: 'user/message' } } } as never),
    /forbidden prop|seq|control/,
  )
  assert.throws(
    () => service.render({ nodeId: 'd', kind: 'conversation.user', publicationRevision: 1, lifecycle: 'settled', value: { text: 'x', endpoint: 'http://x', rpcId: 'r1' } } as never),
    /forbidden prop|endpoint|control/,
  )
})

test('render() forwards canonical nodes and coalesces same-tick calls', async () => {
  const ctx = new Context()
  const recording = makeRecordingFactory()
  apply(ctx, { factory: recording.factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  service.render({ nodeId: 'n1', kind: 'conversation.user', publicationRevision: 1, lifecycle: 'settled', value: { text: 'hello' } })
  service.render({ nodeId: 'n1', kind: 'conversation.user', publicationRevision: 2, lifecycle: 'settled', value: { text: 'hello world' } })
  service.render({ nodeId: 'n1', kind: 'conversation.user', publicationRevision: 3, lifecycle: 'settled', value: { text: 'hello world!' } })
  assert.equal(recording.instance.rerenderCalls, 3)
  assert.deepEqual(recording.instance.lastRendered, { nodeId: 'n1', kind: 'conversation.user', publicationRevision: 3, lifecycle: 'settled', value: { text: 'hello world!' } })
  assert.equal(recording.instance.scheduledFlushes, 1)
  await recording.instance.drainFlush()
  assert.equal(recording.instance.completedFlushes, 1)
})

test('exit() restores through the active instance and rejects re-entry', () => {
  const ctx = new Context()
  const recording = makeRecordingFactory()
  apply(ctx, { factory: recording.factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  service.exit({ reason: 'normal' })
  assert.equal(service.state(), 'exited')
  assert.equal(recording.instance.unmountCalls, 1)
  assert.throws(() => service.exit({ reason: 'normal' }), /already exited/)
  assert.throws(() => service.enter(streamPair()), /already exited/)
})

test('render exception routes through restore() and fails closed', () => {
  const ctx = new Context()
 const throwingInstance: InkInstance = {
    rerender() { throw new Error('ink-render-failure') },
    unmount() {},
    waitUntilRenderFlush() { return Promise.resolve() },
    cleanup() {},
  }
  const throwingFactory: InkRenderFactory = () => throwingInstance
  apply(ctx, { factory: throwingFactory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  service.render({ nodeId: 'n1', kind: 'conversation.user', publicationRevision: 1, lifecycle: 'settled', value: { text: 'x' } })
  assert.equal(service.state(), 'failed')
})

test('suspend/resume preserve the render instance and gate render() during suspension', () => {
  const ctx = new Context()
  const recording = makeRecordingFactory()
  apply(ctx, { factory: recording.factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  service.suspend({ reason: 'suspend-test' })
  assert.equal(service.state(), 'suspended')
  service.render({ nodeId: 'n1', kind: 'conversation.user', publicationRevision: 1, lifecycle: 'settled', value: { text: 'ignored' } })
  assert.equal(recording.instance.rerenderCalls, 0)
  service.resume()
  assert.equal(service.state(), 'active')
  service.render({ nodeId: 'n2', kind: 'conversation.user', publicationRevision: 1, lifecycle: 'settled', value: { text: 'after' } })
  assert.equal(recording.instance.rerenderCalls, 1)
})

test('illegal state transitions fail fast', () => {
  const ctx = new Context()
  apply(ctx, { factory: makeRecordingFactory().factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  assert.throws(() => service.suspend({ reason: 'x' }), /idle|suspend|illegal/)
  assert.throws(() => service.exit({ reason: 'x' }), /idle|exit|illegal/)
  assert.throws(() => service.render({ nodeId: 'n', kind: 'k', publicationRevision: 1, lifecycle: 'settled', value: {} }), /idle|render|illegal/)
})

test('Cordis effect disposal exits the lifecycle and releases the instance', () => {
  const ctx = new Context()
  const recording = makeRecordingFactory()
  apply(ctx, { factory: recording.factory })
  const service = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  service.enter(streamPair())
  ctx.effect(() => () => undefined, 'terminal-lifecycle.disposal-observer')
  ctx.dispose()
  assert.equal(service.state(), 'exited')
  assert.equal(recording.instance.unmountCalls, 1)
})

test('module never invokes process.exit directly', () => {
  const ctx = new Context()
  const recording = makeRecordingFactory()
  apply(ctx, { factory: recording.factory })
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

