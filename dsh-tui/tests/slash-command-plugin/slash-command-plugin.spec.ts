import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply, tuiSlashCommandName } from '../../playground/experiments/slash-command-plugin/src/slash-command-plugin.ts'
import type { TuiCommandIntent } from '../../contracts/tui/slash-command-plugin/slash-command-plugin.types.ts'

function setup() {
  const ctx = new Context()
  apply(ctx)
  return ctx
}

test('apply installs one Cordis effect-owned slash command parser', () => {
  const ctx = setup()
  assert.equal(ctx.tuiSlashCommand?.name, tuiSlashCommandName)
  assert.ok(ctx.fiber.getEffects().some(effect => effect.label === 'slash-command-plugin.dispose'))
  ctx.tuiSlashCommand!.dispose()
})

test('accepts /help, /quit, and /resume <id> as closed intents', () => {
  const ctx = setup()
  assert.deepEqual(ctx.tuiSlashCommand!.parse({ text: '/help', sourceRevision: 1 }), { kind: 'help', sourceRevision: 1 })
  assert.deepEqual(ctx.tuiSlashCommand!.parse({ text: '/quit', sourceRevision: 2 }), { kind: 'quit', sourceRevision: 2 })
  assert.deepEqual(ctx.tuiSlashCommand!.parse({ text: '/resume sess-1', sourceRevision: 3 }), { kind: 'resume', sessionId: 'sess-1', sourceRevision: 3 })
  ctx.tuiSlashCommand!.dispose()
})

test('rejects empty, non-command, unknown, and malformed arguments', () => {
  const ctx = setup()
  const empty = ctx.tuiSlashCommand!.parse({ text: '', sourceRevision: 1 }) as Extract<TuiCommandIntent, { kind: 'rejected' }>
  assert.equal(empty.kind, 'rejected')
  assert.equal(empty.code, 'empty')
  const text = ctx.tuiSlashCommand!.parse({ text: 'hello world', sourceRevision: 1 }) as Extract<TuiCommandIntent, { kind: 'rejected' }>
  assert.equal(text.code, 'not-command')
  const unknown = ctx.tuiSlashCommand!.parse({ text: '/unknown', sourceRevision: 1 }) as Extract<TuiCommandIntent, { kind: 'rejected' }>
  assert.equal(unknown.code, 'unknown')
  const missing = ctx.tuiSlashCommand!.parse({ text: '/resume', sourceRevision: 1 }) as Extract<TuiCommandIntent, { kind: 'rejected' }>
  assert.equal(missing.code, 'malformed-argument')
  const extra = ctx.tuiSlashCommand!.parse({ text: '/resume a b', sourceRevision: 1 }) as Extract<TuiCommandIntent, { kind: 'rejected' }>
  assert.equal(extra.code, 'malformed-argument')
  ctx.tuiSlashCommand!.dispose()
})

test('rejects stale revisions and updates the latest revision monotonically', () => {
  const ctx = setup()
  assert.equal(ctx.tuiSlashCommand!.parse({ text: '/help', sourceRevision: 5 }).kind, 'help')
  const stale = ctx.tuiSlashCommand!.parse({ text: '/help', sourceRevision: 4 }) as Extract<TuiCommandIntent, { kind: 'rejected' }>
  assert.equal(stale.code, 'stale')
  ctx.tuiSlashCommand!.dispose()
})

test('subscribe receives intents and unsubscribe stops delivery', () => {
  const ctx = setup()
  const received: TuiCommandIntent[] = []
  const unsubscribe = ctx.tuiSlashCommand!.subscribe(intent => received.push(intent))
  ctx.tuiSlashCommand!.parse({ text: '/help', sourceRevision: 1 })
  ctx.tuiSlashCommand!.parse({ text: '/quit', sourceRevision: 2 })
  unsubscribe()
  ctx.tuiSlashCommand!.parse({ text: '/help', sourceRevision: 3 })
  assert.equal(received.length, 2)
  ctx.tuiSlashCommand!.dispose()
})

test('dispose blocks parse and subscribe', () => {
  const ctx = setup()
  ctx.tuiSlashCommand!.dispose()
  assert.throws(() => ctx.tuiSlashCommand!.parse({ text: '/help', sourceRevision: 1 }), /disposed/)
  assert.throws(() => ctx.tuiSlashCommand!.subscribe(() => undefined), /disposed/)
})

test('intents are frozen and carry no control payload beyond declared fields', () => {
  const ctx = setup()
  const help = ctx.tuiSlashCommand!.parse({ text: '/help', sourceRevision: 1 })
  assert.equal(Object.isFrozen(help), true)
  const rejected = ctx.tuiSlashCommand!.parse({ text: '', sourceRevision: 2 }) as Extract<TuiCommandIntent, { kind: 'rejected' }>
  for (const key of Object.keys(rejected)) {
    assert.ok(['kind', 'code', 'message', 'sourceRevision'].includes(key), `unexpected rejected field ${key}`)
  }
  ctx.tuiSlashCommand!.dispose()
})

test('parse rejects malformed closed inputs without leaking unexpected fields', () => {
  const ctx = setup()
  assert.throws(() => ctx.tuiSlashCommand!.parse({ text: 1, sourceRevision: 1 } as never), /string/)
  assert.throws(() => ctx.tuiSlashCommand!.parse({ text: '/help', sourceRevision: -1 } as never), /safe integer/)
  assert.throws(() => ctx.tuiSlashCommand!.parse({ text: '/help', sourceRevision: 1, extra: 'x' } as never), /unexpected/)
  ctx.tuiSlashCommand!.dispose()
})
