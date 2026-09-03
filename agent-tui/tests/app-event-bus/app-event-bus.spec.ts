import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  appEventBusServiceName,
  apply,
  validateTerminalIntent,
} from '../../src/experiments/app-event-bus/src/app-event-bus.ts'

function install(): Context {
  const ctx = new Context()
  apply(ctx)
  return ctx
}

test('publish delivers the exact immutable terminal intent to listeners', () => {
  const ctx = install()
  const received: unknown[] = []
  const dispose = ctx.tuiEventBus.subscribe(event => received.push(event))
  const intent = { kind: 'terminal.submit', sourceId: 'composer-1', text: '继续' } as const
  const event = ctx.tuiEventBus.publish(intent, 'event-1', 1234)
  assert.equal(received.length, 1)
  assert.equal(received[0], event)
  assert.equal(event.eventId, 'event-1')
  assert.equal(event.acceptedAt, 1234)
  assert.equal(event.intent, intent)
  assert.equal(Object.isFrozen(event), true)
  dispose()
})

test('dispose stops delivery for the registered listener', () => {
  const ctx = install()
  let count = 0
  const dispose = ctx.tuiEventBus.subscribe(() => count += 1)
  ctx.tuiEventBus.publish({ kind: 'terminal.cancel', sourceId: 'composer-1' })
  dispose()
  ctx.tuiEventBus.publish({ kind: 'terminal.cancel', sourceId: 'composer-1' })
  assert.equal(count, 1)
})

test('invalid intents fail fast and never dispatch', () => {
  const ctx = install()
  let count = 0
  ctx.tuiEventBus.subscribe(() => count += 1)
  assert.throws(() => ctx.tuiEventBus.publish(
    { kind: 'terminal.unknown', sourceId: 'composer-1' } as never,
  ), /closed family/)
  assert.throws(() => ctx.tuiEventBus.publish(
    { kind: 'terminal.submit', sourceId: '' } as never,
  ), /non-empty sourceId/)
  assert.throws(() => ctx.tuiEventBus.publish(
    { kind: 'terminal.submit', sourceId: 'composer-1', text: 42 } as never,
  ), /text: string/)
  assert.throws(() => ctx.tuiEventBus.publish(
    { kind: 'terminal.submit', sourceId: 'composer-1', text: 'hello', endpoint: 'http://127.0.0.1:3080' } as never,
  ), /unexpected field|forbidden/)
  assert.throws(() => ctx.tuiEventBus.publish(
    { kind: 'terminal.cancel', sourceId: 'composer-1', retry: true } as never,
  ), /unexpected field|forbidden/)
  assert.equal(count, 0)
})

test('each intent variant is closed and attachments must contain only strings', () => {
  const ctx = install()
  assert.throws(() => ctx.tuiEventBus.publish(
    { kind: 'terminal.submit', sourceId: 'composer-1', text: 'hello', attachments: ['a', 2] } as never,
  ), /attachments/)
  assert.throws(() => ctx.tuiEventBus.publish(
    { kind: 'terminal.cancel', sourceId: 'composer-1', text: 'not allowed' } as never,
  ), /unexpected field/)
  assert.throws(() => ctx.tuiEventBus.publish(
    { kind: 'interaction.question', sourceId: 'question-1' } as never,
  ), /answer/)
})

test('resize requires positive integer viewport dimensions', () => {
  const ctx = install()
  assert.throws(() => ctx.tuiEventBus.publish(
    { kind: 'terminal.resize', sourceId: 'shell', size: { columns: 0, rows: 24 } } as never,
  ), /positive integer/)
  const event = ctx.tuiEventBus.publish(
    { kind: 'terminal.resize', sourceId: 'shell', size: { columns: 80, rows: 24 } },
  )
  if (event.intent.kind !== 'terminal.resize') {
    throw new Error('expected terminal.resize intent')
  }
  assert.deepEqual(event.intent.size, { columns: 80, rows: 24 })
})

test('validateTerminalIntent rejects non-plain or mutable-shaped payloads', () => {
  assert.throws(() => validateTerminalIntent(null), /plain object/)
  assert.throws(() => validateTerminalIntent(['terminal.submit']), /plain object/)
  assert.throws(() => validateTerminalIntent(new Date()), /plain object/)
})

test('service is installed under the canonical name', () => {
  const ctx = install()
  const installed = ctx.get(appEventBusServiceName) as { name?: string } | undefined
  assert.equal(ctx.tuiEventBus.name, appEventBusServiceName)
  assert.equal(installed?.name, appEventBusServiceName)
})
