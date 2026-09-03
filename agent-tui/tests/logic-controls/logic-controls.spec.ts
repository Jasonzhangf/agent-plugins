import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import manifest from '../../contracts/tui/logic-controls/logic-controls.manifest.json' with { type: 'json' }
import {
  apply,
  applyConnection,
  applyExecution,
  applyInput,
  applyLogo,
  applySession,
  applySlashCommand,
  applyStatus,
  createLogicControlPlugin,
  logicControlPluginNames,
  logicControlPlugins,
  type LogicControlProjection,
  type TuiLogicControlRegistry,
} from '../../src/experiments/logic-controls/src/logic-controls.ts'

function installAll(): { ctx: Context; registry: TuiLogicControlRegistry; emit: (event: Parameters<ReturnType<TuiLogicControlRegistry['bindSource']>['dispatch']>[0]) => LogicControlProjection } {
  const ctx = new Context()
  apply(ctx)
  applyInput(ctx)
  applyStatus(ctx)
  applyConnection(ctx)
  applyExecution(ctx)
  applySession(ctx)
  applySlashCommand(ctx)
  applyLogo(ctx)
  const sources = new Map(manifest.controls.map(item => [item.control, ctx.tuiLogicControls.bindSource(ctx, item.source_resource as Parameters<TuiLogicControlRegistry['bindSource']>[1])]))
  return {
    ctx,
    registry: ctx.tuiLogicControls,
    emit: event => (sources.get(event.control) ?? sources.get('input')!).dispatch(event),
  }
}

test('registers seven independent Cordis logic plugins with stable projections', () => {
  const { registry, emit } = installAll()
  assert.deepEqual(registry.list(), ['input', 'status', 'connection', 'execution', 'session', 'slash-command', 'logo'])
  assert.deepEqual(logicControlPluginNames, [
    'tui.logic.input', 'tui.logic.status', 'tui.logic.connection', 'tui.logic.execution',
    'tui.logic.session', 'tui.logic.slash-command', 'tui.logic.logo',
  ])
  assert.equal(registry.project('input').stableKey, 'control.input')
  assert.equal(registry.project('status').stableKey, 'control.status')
  assert.equal(registry.project('connection').stableKey, 'control.connection')
  assert.equal(registry.project('execution').stableKey, 'control.execution')
  assert.equal(registry.project('session').stableKey, 'control.session')
  assert.equal(registry.project('slash-command').stableKey, 'control.slash-command')
  assert.equal(registry.project('logo').stableKey, 'control.logo')
})

test('manifest and Cordis plugin objects bind one lifecycle owner per control', async () => {
  assert.equal(manifest.controls.length, 7)
  assert.equal(new Set(manifest.controls.map(item => item.control)).size, 7)
  assert.equal(new Set(manifest.controls.map(item => item.plugin)).size, 7)
  assert.equal(new Set(manifest.controls.map(item => item.lifecycle_owner)).size, 7)
  assert.ok(manifest.controls.every(item => item.source_owner && item.source_resource && item.required_gates.length > 0))
  assert.deepEqual(logicControlPlugins.map(plugin => plugin.name), manifest.controls.map(item => item.plugin))
  const ctx = new Context()
  apply(ctx)
  const fibers = await Promise.all(logicControlPlugins.map(plugin => ctx.plugin(plugin)))
  assert.deepEqual(ctx.tuiLogicControls.list(), ['input', 'status', 'connection', 'execution', 'session', 'slash-command', 'logo'])
  await Promise.all(fibers.map(fiber => fiber.dispose()))
  assert.deepEqual(ctx.tuiLogicControls.list(), [])
})

test('runtime registry rejects undeclared or mismatched plugin capabilities', () => {
  const ctx = new Context()
  apply(ctx)
  const plugin = createLogicControlPlugin('input')
  assert.throws(() => ctx.tuiLogicControls.register(ctx, {
    ...plugin,
    name: 'tui.logic.logo',
  }), /not declared by the manifest/)
  assert.throws(() => ctx.tuiLogicControls.register(ctx, {
    ...plugin,
    control: 'unknown',
    name: 'tui.logic.unknown',
  } as never), /not declared by the manifest/)
})

test('projects input, status, connection, execution and logo without a renderer', () => {
  const { registry, emit } = installAll()
  assert.deepEqual(emit({ control: 'input', action: 'edit', text: 'hello', cursor: 5 }), {
    control: 'input', stableKey: 'control.input', text: 'hello', cursor: 5, mode: 'idle', revision: 1,
  })
  assert.deepEqual(emit({ control: 'status', action: 'set', sessionId: 'session-1', cwd: '/tmp/dsh', mode: 'streaming' }), {
    control: 'status', stableKey: 'control.status', sessionId: 'session-1', cwd: '/tmp/dsh', mode: 'streaming', revision: 2,
  })
  assert.deepEqual(emit({ control: 'connection', action: 'set', state: 'connected' }), {
    control: 'connection', stableKey: 'control.connection', state: 'connected', revision: 3,
  })
  assert.deepEqual(emit({ control: 'execution', action: 'set', state: 'running', turnId: 'turn-1' }), {
    control: 'execution', stableKey: 'control.execution', state: 'running', turnId: 'turn-1', revision: 4,
  })
  assert.deepEqual(emit({ control: 'logo', action: 'set', variant: 'compact', visible: false }), {
    control: 'logo', stableKey: 'control.logo', variant: 'compact', visible: false, revision: 5,
  })
})

test('projection is consumable by a renderer seam without importing Ink or an agent', () => {
  const { registry, emit } = installAll()
  const fakeRenderer = (projection: ReturnType<typeof registry.project>) => ({
    contract: 'tui.element.v1',
    elementType: projection.control,
    props: { stableKey: projection.stableKey, revision: projection.revision },
  })
  const projection = emit({ control: 'logo', action: 'set', variant: 'full', visible: true })
  assert.deepEqual(fakeRenderer(projection), {
    contract: 'tui.element.v1', elementType: 'logo', props: { stableKey: 'control.logo', revision: 1 },
  })
})

test('session selection is public-list scoped and slash commands are parse-only', () => {
  const { registry, emit } = installAll()
  emit({ control: 'session', action: 'snapshot', selectedSessionId: 'session-a', availableSessionIds: ['session-a', 'session-b'], cwd: '/tmp/dsh', lifecycle: 'active' })
  assert.deepEqual(emit({ control: 'session', action: 'request-select', sessionId: 'session-b' }), {
    control: 'session', stableKey: 'control.session', selectedSessionId: 'session-a', availableSessionIds: ['session-a', 'session-b'], cwd: '/tmp/dsh', lifecycle: 'active', requestedSessionId: 'session-b', revision: 2,
  })
  assert.deepEqual(emit({ control: 'slash-command', action: 'project', input: '/resume session-b', command: '/resume', args: ['session-b'], accepted: true }), {
    control: 'slash-command', stableKey: 'control.slash-command', input: '/resume session-b', command: '/resume', args: ['session-b'], accepted: true, revision: 3,
  })
  assert.throws(() => emit({ control: 'session', action: 'request-select', sessionId: 'session-b' }), /already active/)
  emit({ control: 'session', action: 'snapshot', selectedSessionId: null, availableSessionIds: [], cwd: '/tmp/dsh', lifecycle: 'terminated' })
  assert.throws(() => emit({ control: 'session', action: 'request-select', sessionId: 'session-b' }), /terminated session/)
  assert.throws(() => emit({ control: 'session', action: 'snapshot', selectedSessionId: 'outside', availableSessionIds: [], cwd: '/tmp/dsh', lifecycle: 'active' }), /outside the owner-provided session scope/)
  const command = emit({ control: 'slash-command', action: 'project', input: '/agent-private', command: '/agent-private', args: [], accepted: true }) as Extract<LogicControlProjection, { control: 'slash-command' }>
  assert.equal(command.accepted, true)
  assert.equal(command.command, '/agent-private')
  assert.throws(() => emit({ control: 'slash-command', action: 'project', command: null, args: [], accepted: false }), /app-shell rejected slash command/)
  assert.throws(() => emit({ control: 'slash-command', action: 'parse', input: '/' } as never), /unsupported logic control event/)
  assert.throws(() => emit({ control: 'session', action: 'select', sessionId: 'session-b' } as never), /unsupported logic control event/)
})

test('rejects invalid transitions and control metadata leakage', () => {
  const { registry, emit } = installAll()
  assert.throws(() => emit({ control: 'input', action: 'submit', text: '' }), /empty input/)
  assert.deepEqual(emit({ control: 'execution', action: 'set', state: 'failed', turnId: 'turn-1', message: 'owner reported failure' }), {
    control: 'execution', stableKey: 'control.execution', state: 'failed', turnId: 'turn-1', message: 'owner reported failure', revision: 1,
  })
  emit({ control: 'connection', action: 'set', state: 'failed', message: 'offline' })
  assert.equal(emit({ control: 'connection', action: 'set', state: 'connected' }).control, 'connection')
  assert.throws(() => emit({ control: 'input', action: 'edit', text: 'x', cursor: 1, metadata: {} } as never), /control field 'metadata'/)
  assert.throws(() => emit({ control: 'input', action: 'edit', text: 'x', cursor: 2 }), /outside text/)
  assert.throws(() => emit({ control: 'connection', action: 'set', state: 'bogus' } as never), /connection.state is invalid/)
  assert.throws(() => emit({ control: 'logo', action: 'set', variant: 'full', visible: true, extra: true } as never), /unknown control field 'extra'/)
  assert.deepEqual(registry.error(), {
    control: 'logo', code: 'invalid-event', message: "unknown control field 'extra'", revision: 5,
  })
})

test('records typed control failures without projecting them into business data', () => {
  const { registry, emit } = installAll()
  assert.throws(() => emit({ control: 'input', action: 'edit', text: 'x', cursor: 2 }), /outside text/)
  assert.deepEqual(registry.error(), {
    control: 'input', code: 'invalid-event', message: 'input cursor is outside text', revision: 1,
  })
  assert.deepEqual(registry.project('input'), {
    control: 'input', stableKey: 'control.input', text: '', cursor: 0, mode: 'idle', revision: 0,
  })
})

test('rejects stale control events before state mutation', () => {
  const { registry, emit } = installAll()
  emit({ control: 'input', action: 'edit', text: 'new', cursor: 3, revision: 8 })
  assert.throws(() => emit({ control: 'input', action: 'edit', text: 'old', cursor: 3, revision: 7 }), /newer than the global revision/)
  const projection = registry.project('input') as Extract<LogicControlProjection, { control: 'input' }>
  assert.equal(projection.text, 'new')
  assert.throws(() => emit({ control: 'status', action: 'set', sessionId: null, cwd: null, mode: 'idle', revision: 8 }), /newer than the global revision/)
  assert.deepEqual(registry.error(), {
    control: 'status', code: 'stale-event', message: 'control revision must be newer than the global revision', revision: 2, eventRevision: 8,
  })
})

test('keeps error sequence monotonic after high-revision rejection and records public operation failures', () => {
  const ctx = new Context()
  apply(ctx)
  applyInput(ctx)
  const registry = ctx.tuiLogicControls
  const emit = ctx.tuiLogicControls.bindSource(ctx, 'terminal_input_control').dispatch
  assert.throws(() => emit({ control: 'input', action: 'edit', text: 'bad', cursor: 4, revision: 100 }), /outside text/)
  assert.deepEqual(registry.error(), { control: 'input', code: 'invalid-event', message: 'input cursor is outside text', revision: 1, eventRevision: 100 })
  assert.deepEqual(emit({ control: 'input', action: 'edit', text: 'ok', cursor: 2 }), {
    control: 'input', stableKey: 'control.input', text: 'ok', cursor: 2, mode: 'idle', revision: 1,
  })
  assert.throws(() => registry.project('status'), /not registered/)
  assert.deepEqual(registry.error(), { control: 'status', code: 'invalid-transition', message: 'status plugin is not registered', revision: 2 })
})

test('closes unknown controls and malformed fields through the typed error chain', () => {
  const { registry, emit } = installAll()
  assert.throws(() => emit({ control: 'bogus', action: 'set' } as never), /not owned by source resource/)
  assert.deepEqual(registry.error()?.control, 'unknown')
  assert.throws(() => emit({ control: 'status', action: 'set', sessionId: 1, cwd: null, mode: 'idle' } as never), /status.sessionId must be a string/)
  assert.deepEqual(registry.error()?.control, 'status')
  assert.equal(registry.project('status').revision, 0)
})

test('source capabilities enforce manifest ownership and Cordis disposal', async () => {
  const ctx = new Context()
  apply(ctx)
  applyInput(ctx)
  const input = ctx.tuiLogicControls.bindSource(ctx, 'terminal_input_control')
  assert.throws(() => input.dispatch({ control: 'status', action: 'set', sessionId: null, cwd: null, mode: 'idle' }), /not owned by source resource/)
  assert.throws(() => ctx.tuiLogicControls.bindSource(ctx, 'not-a-resource' as never), /not declared by the manifest/)
  assert.deepEqual(input.dispatch({ control: 'input', action: 'edit', text: 'ok', cursor: 2 }), {
    control: 'input', stableKey: 'control.input', text: 'ok', cursor: 2, mode: 'idle', revision: 1,
  })
  let owned: ReturnType<TuiLogicControlRegistry['bindSource']> | undefined
  const owner = ctx.plugin({ name: 'source-owner', apply(pluginContext: Context) {
    owned = ctx.tuiLogicControls.bindSource(pluginContext, 'terminal_input_control')
  } })
  await owner
  await owner.dispose()
  assert.throws(() => owned!.dispatch({ control: 'input', action: 'edit', text: 'nope', cursor: 4 }), /source is disposed/)
})

test('plugin registration is duplicate-safe and effect-owned', async () => {
  const ctx = new Context()
  apply(ctx)
  applyInput(ctx)
  assert.throws(() => applyInput(ctx), /already registered/)
  const fiber = ctx.plugin({
    name: 'logic-test-plugin',
    apply(pluginContext: Context) { applyStatus(pluginContext) },
  })
  await fiber
  assert.equal(ctx.tuiLogicControls.project('status').control, 'status')
  await fiber.dispose()
  assert.throws(() => ctx.tuiLogicControls.project('status'), /not registered/)
})

test('disposed plugin rejects new control work after its Cordis owner unloads', async () => {
  const ctx = new Context()
  apply(ctx)
  const fiber = ctx.plugin({
    name: 'logic-dispose-plugin',
    apply(pluginContext: Context) { applyInput(pluginContext) },
  })
  await fiber
  await fiber.dispose()
  assert.throws(() => ctx.tuiLogicControls.project('input'), /not registered/)
})
