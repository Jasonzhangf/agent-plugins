import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { Key } from 'ink'
import {
  apply as applyLifecycle,
  projectKeyboardInput,
  type TuiTerminalInputEvent,
  type InkInstance,
  type InkRenderFactory,
  type TuiTerminalLifecycle,
} from '../../playground/experiments/terminal-lifecycle/src/terminal-lifecycle.ts'

interface RecordingInstance extends InkInstance {
  rerenderCalls: number
  unmountCalls: number
  lastElement: unknown
}

type BridgeElement = {
  props: {
    handler: ((event: TuiTerminalInputEvent) => void) | null
    children: unknown
  }
}

function makeFactory(options: {
  mountThrows?: Error
  rerenderThrows?: Error
  flushRejects?: Error
} = {}) {
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

function install(factory: InkRenderFactory, eventBus?: { publish(event: unknown): void }) {
  const ctx = new Context()
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
  assert.equal((bridge.props.children as { key?: string }).key, 'carrier.input')
  bridge.props.handler?.({ type: 'key', input: '/', key: {} as never })
  assert.deepEqual(events, [{ type: 'key', input: '/', key: {} }])
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

test('first render mounts and later render rerenders the same carrier', () => {
  const { factory, instance } = makeFactory()
  const { lifecycle } = install(factory)
  lifecycle.enter(streams())
  const first = lifecycle.render(tree('one'))
  const second = lifecycle.render(tree('two'))
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
