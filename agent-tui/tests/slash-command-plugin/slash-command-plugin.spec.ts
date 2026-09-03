import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply, tuiSlashCommandName } from '../../src/experiments/slash-command-plugin/src/slash-command-plugin.ts'
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
  assert.deepEqual(ctx.tuiSlashCommand!.parse({ text: '/resume', sourceRevision: 4 }), {
    kind: 'resume',
    sessionId: null,
    sourceRevision: 4,
  })
  ctx.tuiSlashCommand!.dispose()
})

test('rejects empty, non-command, and malformed arguments', () => {
  const ctx = setup()
  const empty = ctx.tuiSlashCommand!.parse({ text: '', sourceRevision: 1 }) as Extract<TuiCommandIntent, { kind: 'rejected' }>
  assert.equal(empty.kind, 'rejected')
  assert.equal(empty.code, 'empty')
  const text = ctx.tuiSlashCommand!.parse({ text: 'hello world', sourceRevision: 1 }) as Extract<TuiCommandIntent, { kind: 'rejected' }>
  assert.equal(text.code, 'not-command')
  const host = ctx.tuiSlashCommand!.parse({ text: '/unknown', sourceRevision: 1 }) as Extract<TuiCommandIntent, { kind: 'rejected' }>
  assert.equal(host.kind, 'rejected')
  assert.equal(host.code, 'unknown')
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

test('accepts /new as a closed intent', () => {
  const ctx = setup()
  const result = ctx.tuiSlashCommand!.parse({ text: '/new', sourceRevision: 1 })
  assert.equal(result.kind, 'new')
  assert.equal(result.sourceRevision, 1)
  ctx.tuiSlashCommand!.dispose()
})

test('accepts all Host commands with and without arguments', () => {
  const ctx = setup()
  const hostCommands = [
    ['/plan message here', 'plan', ['message', 'here'], '/plan message here'],
    ['/plan off', 'plan', ['off'], '/plan off'],
    ['/permission workspace-write', 'permission', ['workspace-write'], '/permission workspace-write'],
    ['/model deepseek-chat', 'model', ['deepseek-chat'], '/model deepseek-chat'],
    ['/compact', 'compact', [], '/compact'],
    ['/goal', 'goal', [], '/goal'],
    ['/goal fix this bug', 'goal', ['fix', 'this', 'bug'], '/goal fix this bug'],
    ['/doctor', 'doctor', [], '/doctor'],
    ['/rename New Title', 'rename', ['New', 'Title'], '/rename New Title'],
    ['/thinking high', 'thinking', ['high'], '/thinking high'],
    ['/feedback useful result', 'feedback', ['useful', 'result'], '/feedback useful result'],
    ['/export', 'export', [], '/export'],
    ['/export root-only', 'export', ['root-only'], '/export root-only'],
  ]
  for (const [input, cmd, expectedArgs, expectedRaw] of hostCommands) {
    const intent = ctx.tuiSlashCommand!.parse({ text: input, sourceRevision: 1 }) as Extract<TuiCommandIntent, { kind: 'host' }>
    assert.equal(intent.kind, 'host', 'expected host for ' + input)
    assert.equal(intent.command, cmd, 'expected command ' + cmd + ' for ' + input)
    assert.deepEqual([...intent.args], expectedArgs, 'expected args for ' + input)
    assert.equal(intent.sourceRevision, 1)
  }
  ctx.tuiSlashCommand!.dispose()
})

test('host intents are frozen and carry no control metadata', () => {
  const ctx = setup()
  const intent = ctx.tuiSlashCommand!.parse({ text: '/plan hello', sourceRevision: 7 }) as Extract<TuiCommandIntent, { kind: 'host' }>
  assert.equal(Object.isFrozen(intent), true)
  assert.equal(Object.isFrozen(intent.args), true)
  assert.equal(intent.kind, 'host')
  assert.equal(intent.command, 'plan')
  assert.deepEqual([...intent.args], ['hello'])
  assert.equal(intent.sourceRevision, 7)
  const keys = Object.keys(intent)
  assert.ok(['kind', 'command', 'args', 'sourceRevision'].every(k => keys.includes(k)))
  ctx.tuiSlashCommand!.dispose()
})

test('registered feedback slash command is admitted before host dispatch', () => {
  const ctx = setup()
  const command = ctx.tuiSlashCommand!.parse({ text: '/feedback note', sourceRevision: 1 }) as Extract<TuiCommandIntent, { kind: 'host' }>
  assert.equal(command.kind, 'host')
  assert.equal(command.command, 'feedback')
  assert.deepEqual([...command.args], ['note'])
  ctx.tuiSlashCommand!.dispose()
})

test('copy is admitted as a typed interactive command', () => {
  const ctx = new Context()
  apply(ctx)
  const command = ctx.tuiSlashCommand!.parse({ text: '/copy 12', sourceRevision: 1 }) as Extract<TuiCommandIntent, { kind: 'interactive' }>
  assert.equal(command.command, 'copy')
  assert.deepEqual(command.args, ['12'])
})

test('trajectory-more is admitted as a typed interactive command', () => {
  const ctx = new Context()
  apply(ctx)
  const command = ctx.tuiSlashCommand!.parse({ text: '/trajectory-more', sourceRevision: 1 }) as Extract<TuiCommandIntent, { kind: 'interactive' }>
  assert.equal(command.command, 'trajectory-more')
  assert.deepEqual(command.args, [])
})

test('subscribe receives host and /new intents', () => {
  const ctx = setup()
  const received: TuiCommandIntent[] = []
  const unsubscribe = ctx.tuiSlashCommand!.subscribe(intent => received.push(intent))
  ctx.tuiSlashCommand!.parse({ text: '/plan test', sourceRevision: 1 })
  ctx.tuiSlashCommand!.parse({ text: '/new', sourceRevision: 2 })
  ctx.tuiSlashCommand!.parse({ text: '/doctor', sourceRevision: 3 })
  unsubscribe()
  assert.equal(received.length, 3)
  assert.equal(received[0]!.kind, 'host')
  assert.equal(received[1]!.kind, 'new')
  assert.equal(received[2]!.kind, 'host')
  ctx.tuiSlashCommand!.dispose()
})

test('host commands update latestRevision and are rejected on stale revision', () => {
  const ctx = setup()
  ctx.tuiSlashCommand!.parse({ text: '/model gpt-4', sourceRevision: 10 })
  const stale = ctx.tuiSlashCommand!.parse({ text: '/compact', sourceRevision: 9 }) as Extract<TuiCommandIntent, { kind: 'rejected' }>
  assert.equal(stale.kind, 'rejected')
  assert.equal(stale.code, 'stale')
  ctx.tuiSlashCommand!.dispose()
})

test('interactive commands remain typed window intents', () => {
  const ctx = setup()
  let sourceRevision = 0
  for (const [text, command] of [['/models', 'models'], ['/provider', 'provider'], ['/permissions', 'permissions'], ['/workspace-create /tmp/project', 'workspace-create'], ['/workspace-rename ws-1 Project', 'workspace-rename'], ['/workspace-delete ws-1', 'workspace-delete'], ['/archive', 'archive']] as const) {
    sourceRevision += 1
    const intent = ctx.tuiSlashCommand!.parse({ text, sourceRevision })
    assert.equal(intent.kind, 'interactive')
    assert.equal(intent.command, command)
  }
  ctx.tuiSlashCommand!.dispose()
})

test('/jobs is admitted as an interactive command and rejects trailing arguments at startup boundary', () => {
  const ctx = setup()
  const intent = ctx.tuiSlashCommand!.parse({ text: '/jobs', sourceRevision: 1 })
  assert.deepEqual(intent, { kind: 'interactive', command: 'jobs', args: [], sourceRevision: 1 })
  const withArgs = ctx.tuiSlashCommand!.parse({ text: '/jobs extra', sourceRevision: 2 })
  assert.deepEqual(withArgs, { kind: 'interactive', command: 'jobs', args: ['extra'], sourceRevision: 2 })
})

test('/attach preserves the image path and optional prompt text as typed arguments', () => {
  const ctx = setup()
  assert.deepEqual(ctx.tuiSlashCommand!.parse({ text: '/attach screen.png inspect this', sourceRevision: 1 }), {
    kind: 'interactive',
    command: 'attach',
    args: ['screen.png', 'inspect', 'this'],
    sourceRevision: 1,
  })
})

test('suggestions filter slash commands and retain descriptions without parsing or dispatching', () => {
  const ctx = new Context()
  apply(ctx)
  assert.deepEqual(ctx.tuiSlashCommand!.suggest('/models'), [
    { command: '/models', description: 'choose a model and thinking effort' },
  ])
  assert.deepEqual(ctx.tuiSlashCommand!.suggest('/thin'), [
    { command: '/thinking', description: 'choose thinking effort' },
  ])
  assert.equal(ctx.tuiSlashCommand!.suggest('mo').length, 0)
  assert.equal(ctx.tuiSlashCommand!.suggest('/models x').length, 0)
})

test('host command registry validates argument shape before dispatch', () => {
  const ctx = setup()
  const permission = ctx.tuiSlashCommand!.parse({ text: '/permission', sourceRevision: 1 }) as Extract<TuiCommandIntent, { kind: 'rejected' }>
  assert.equal(permission.code, 'malformed-argument')
  const valid = ctx.tuiSlashCommand!.parse({ text: '/permission workspace-write', sourceRevision: 2 }) as Extract<TuiCommandIntent, { kind: 'host' }>
  assert.deepEqual([...valid.args], ['workspace-write'])
  const model = ctx.tuiSlashCommand!.parse({ text: '/model a b', sourceRevision: 3 }) as Extract<TuiCommandIntent, { kind: 'rejected' }>
  assert.equal(model.code, 'malformed-argument')
  ctx.tuiSlashCommand!.dispose()
})
