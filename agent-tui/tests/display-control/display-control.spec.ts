import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  createDisplayControlLifecycle,
  tuiDisplayControlServiceName,
  type TuiDisplayControlScheduler,
} from '../../src/experiments/display-control/src/display-control.ts'
import {
  assertTuiDisplayControlEvent,
  assertTuiDisplayControlState,
  type TuiDisplayControlState,
} from '../../contracts/tui/display-control/display-control.types.ts'

function fakeScheduler(): TuiDisplayControlScheduler & { readonly runTimers: () => void; readonly now: () => number } {
  let currentTime = 1000
  let nextHandle = 1
  const timers = new Map<number, () => void>()
  return {
    setTimeout(callback, timeoutMs) {
      const handle = nextHandle
      nextHandle += 1
      timers.set(handle, callback)
      return handle
    },
    clearTimeout(handle) {
      timers.delete(handle as number)
    },
    now: () => currentTime,
    runTimers() {
      const callbacks = [...timers.values()]
      timers.clear()
      currentTime += 100
      for (const callback of callbacks) callback()
    },
  }
}

test('display-control service creates exactly one lifecycle per control and lists it', () => {
  const ctx = new Context()
  apply(ctx)
  assert.equal(ctx.tuiDisplayControl.name, tuiDisplayControlServiceName)
  const lifecycle = ctx.tuiDisplayControl.create('tui.connection')
  assert.deepEqual(ctx.tuiDisplayControl.list(), ['tui.connection'])
  assert.equal(ctx.tuiDisplayControl.get('tui.connection'), lifecycle)
  assert.equal(ctx.tuiDisplayControl.get('tui.status'), null)
  assert.equal(lifecycle.controlId, 'tui.connection')
  assert.equal(lifecycle.state.mode, 'detached')
  assert.throws(() => ctx.tuiDisplayControl.create('tui.connection'), /duplicate control/)
  assert.throws(() => ctx.tuiDisplayControl.create(''), /non-empty string/)
  lifecycle.dispose()
  assert.deepEqual(ctx.tuiDisplayControl.list(), [])
})

test('attach and persistent transitions publish immutable closed states', () => {
  const scheduler = fakeScheduler()
  const lifecycle = createDisplayControlLifecycle('tui.status', scheduler)
  const received: TuiDisplayControlState[] = []
  lifecycle.subscribe(state => received.push(state))
  const attached = lifecycle.attach()
  assert.equal(attached.mode, 'persistent')
  assert.equal(attached.revision, 1)
  const persistent = lifecycle.setPersistent(7)
  assert.equal(persistent.mode, 'persistent')
  assert.equal(persistent.sourceRevision, 7)
  assert.equal(persistent.expiresAt, undefined)
  assert.equal(lifecycle.state.sourceRevision, 7)
  assert.deepEqual(received, [attached, persistent])
  assertTuiDisplayControlState(attached)
  assertTuiDisplayControlState(persistent)
  lifecycle.dispose()
})

test('showLive keeps the persistent baseline and expires back to it', () => {
  const scheduler = fakeScheduler()
  const lifecycle = createDisplayControlLifecycle('tui.execution', scheduler)
  lifecycle.attach()
  lifecycle.setPersistent(1)
  const live = lifecycle.showLive(2, 250)
  assert.equal(live.mode, 'live')
  assert.equal(live.sourceRevision, 2)
  assert.equal(live.expiresAt, 1250)
  assert.equal(lifecycle.state.mode, 'live')
  scheduler.runTimers()
  const expired = lifecycle.state
  assert.equal(expired.mode, 'persistent')
  assert.equal(expired.sourceRevision, 1)
  assert.equal(expired.expiresAt, undefined)
  assertTuiDisplayControlState(expired)
  lifecycle.dispose()
})

test('dismissLive returns to persistent immediately and cancels the timer', () => {
  const scheduler = fakeScheduler()
  const lifecycle = createDisplayControlLifecycle('tui.connection', scheduler)
  lifecycle.attach()
  lifecycle.setPersistent(3)
  lifecycle.showLive(4, 500)
  const dismissed = lifecycle.dismissLive()
  assert.equal(dismissed.mode, 'persistent')
  assert.equal(dismissed.sourceRevision, 3)
  scheduler.runTimers()
  assert.equal(lifecycle.state.mode, 'persistent')
  lifecycle.dispose()
})

test('touch refreshes a live display without leaving live and dismiss resets timer', () => {
  const scheduler = fakeScheduler()
  const lifecycle = createDisplayControlLifecycle('tui.status', scheduler)
  lifecycle.attach()
  lifecycle.setPersistent(1)
  lifecycle.showLive(2, 100)
  const touched = lifecycle.touch(5, 300)
  assert.equal(touched.mode, 'live')
  assert.equal(touched.sourceRevision, 5)
  assert.equal(touched.expiresAt, 1300)
  lifecycle.dismissLive()
  lifecycle.dispose()
})

test('touch on a persistent control enters live like showLive', () => {
  const scheduler = fakeScheduler()
  const lifecycle = createDisplayControlLifecycle('tui.session', scheduler)
  lifecycle.attach()
  lifecycle.setPersistent(1)
  const live = lifecycle.touch(2, 100)
  assert.equal(live.mode, 'live')
  lifecycle.dismissLive()
  lifecycle.dispose()
})

test('subscribe is removed exactly once and disposed lifecycle rejects new work', () => {
  const scheduler = fakeScheduler()
  const lifecycle = createDisplayControlLifecycle('tui.logo', scheduler)
  let calls = 0
  const unsubscribe = lifecycle.subscribe(() => { calls += 1 })
  lifecycle.attach()
  assert.equal(calls, 1)
  unsubscribe()
  lifecycle.setPersistent(1)
  assert.equal(calls, 1)
  lifecycle.dispose()
  assert.throws(() => lifecycle.showLive(2, 100), /disposed/)
  assert.throws(() => lifecycle.subscribe(() => {}), /disposed/)
})

test('state and event validators reject leaks and invalid transitions', () => {
  assert.throws(() => assertTuiDisplayControlEvent({ kind: 'live', sourceRevision: 1, timeoutMs: 0 }), /positive finite number/)
  assert.throws(() => assertTuiDisplayControlEvent({ kind: 'persistent', sourceRevision: -1 }), /non-negative safe integer/)
  assert.throws(() => assertTuiDisplayControlEvent({ kind: 'attach', sourceRevision: 1 }), /closed/)
  assert.throws(() => assertTuiDisplayControlEvent({ kind: 'live', sourceRevision: 1, timeoutMs: 100, metadata: {} }), /unknown event field/)
  assert.throws(() => assertTuiDisplayControlState(Object.freeze({ mode: 'live', revision: 1, lastTransitionAt: 0 })), /live state requires expiresAt/)
  assert.throws(() => assertTuiDisplayControlState(Object.freeze({ mode: 'live', revision: 1, lastTransitionAt: 0, expiresAt: 100, sourceRevision: -1 })), /sourceRevision/)
  assert.throws(() => assertTuiDisplayControlState(Object.freeze({ mode: 'detached', revision: 1, lastTransitionAt: 0, sourceRevision: 1 })), /detached state cannot carry sourceRevision/)
  assert.throws(() => assertTuiDisplayControlState({ mode: 'live', revision: 1, lastTransitionAt: 0, expiresAt: 100 }), /state must be frozen/)
})
