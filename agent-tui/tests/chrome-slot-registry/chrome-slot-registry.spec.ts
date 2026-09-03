import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyChromeSlotRegistry, TuiChromeSlotRegistry } from '../../src/experiments/chrome-slot-registry/src/chrome-slot-registry.ts'
import { apply as applyLogicControls, logicControlPlugins } from '../../src/experiments/logic-controls/src/logic-controls.ts'

import type { LogicControlProjection } from '../../contracts/tui/logic-controls/logic-controls.types.ts'
import type {
  TuiChromeSlotId,
  TuiChromeSlotProducer,
  TuiChromeDisplayPlugin,
  TuiLogicControlProjector,
} from '../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'

function makeProducer(slotId: TuiChromeSlotId): TuiChromeSlotProducer {
  switch (slotId) {
    case 'header.logo':
      return { slotId, project: input => {
        const control = input.logicControls.project('logo')
        if (control.control !== 'logo') throw new Error('logo mismatch')
        return Object.freeze({ slotId, revision: control.revision, publicationRevision: input.publicationRevision, displayMode: 'persistent', variant: control.variant, visible: control.visible })
      } }
    case 'header.connection':
      return { slotId, project: input => {
        const control = input.logicControls.project('connection')
        if (control.control !== 'connection') throw new Error('connection mismatch')
        return Object.freeze({ slotId, revision: control.revision, publicationRevision: input.publicationRevision, displayMode: 'persistent', state: control.state })
      } }
    case 'header.session':
      return { slotId, project: input => {
        const control = input.logicControls.project('session')
        if (control.control !== 'session') throw new Error('session mismatch')
        return Object.freeze({ slotId, revision: control.revision, publicationRevision: input.publicationRevision, displayMode: 'persistent', text: control.cwd ?? 'Workspace unavailable' })
      } }
    case 'header.status':
      return { slotId, project: input => {
        const control = input.logicControls.project('status')
        if (control.control !== 'status') throw new Error('status mismatch')
        return Object.freeze({ slotId, revision: control.revision, publicationRevision: input.publicationRevision, displayMode: 'persistent', text: control.mode })
      } }
    case 'execution':
      return { slotId, project: input => {
        const control = input.logicControls.project('execution')
        if (control.control !== 'execution') throw new Error('execution mismatch')
        return Object.freeze({ slotId, revision: control.revision, publicationRevision: input.publicationRevision, displayMode: 'persistent', state: control.state })
      } }
  }
}

const SLOT_IDS: ReadonlyArray<TuiChromeSlotId> = Object.freeze([
  'header.logo', 'header.connection', 'header.session', 'header.status', 'execution',
])

function displayPlugin(name: string, slotId: TuiChromeSlotId): TuiChromeDisplayPlugin {
  return Object.freeze({
    name,
    slotId,
    apply: (ctx: Context) => { ctx.tuiChromeSlotRegistry.register(ctx, makeProducer(slotId)) },
  })
}

const displayPlugins: ReadonlyArray<TuiChromeDisplayPlugin> = Object.freeze([
  displayPlugin('tui.logo', 'header.logo'),
  displayPlugin('tui.connection', 'header.connection'),
  displayPlugin('tui.session', 'header.session'),
  displayPlugin('tui.status', 'header.status'),
  displayPlugin('tui.execution', 'execution'),
])

async function install(ctx: Context): Promise<void> {
  applyChromeSlotRegistry(ctx)
  for (const plugin of displayPlugins) await ctx.plugin(plugin)
}

function projector(): TuiLogicControlProjector {
  const controls: ReadonlyArray<LogicControlProjection> = Object.freeze([
    Object.freeze({ control: 'logo', stableKey: 'control.logo', variant: 'full', visible: true, revision: 1 }),
    Object.freeze({ control: 'connection', stableKey: 'control.connection', state: 'connected', revision: 1 }),
    Object.freeze({ control: 'session', stableKey: 'control.session', selectedSessionId: 'session-a', availableSessionIds: ['session-a'], cwd: '/tmp', lifecycle: 'active', requestedSessionId: null, revision: 1 }),
    Object.freeze({ control: 'status', stableKey: 'control.status', sessionId: 'session-a', cwd: '/tmp', mode: 'idle', revision: 1 }),
    Object.freeze({ control: 'execution', stableKey: 'control.execution', state: 'idle', turnId: null, revision: 1 }),
  ])
  const byControl = new Map(controls.map(control => [control.control, control]))
  return { project(control) {
    const projection = byControl.get(control)
    if (!projection) throw new Error(`missing ${control}`)
    return projection
  } }
}

function input(publicationRevision = 3) {
  return { publicationRevision, logicControls: projector() }
}

test('five plugins register exactly one canonical set through Cordis fibers', async () => {
  const ctx = new Context()
  await install(ctx)
  assert.deepEqual(displayPlugins.map(plugin => plugin.name), ['tui.logo', 'tui.connection', 'tui.session', 'tui.status', 'tui.execution'])
  assert.deepEqual([...ctx.tuiChromeSlotRegistry.registeredSlots], SLOT_IDS)
})

test('each display plugin is independently unloadable by its own effect', async () => {
  const ctx = new Context()
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = projector()
  applyChromeSlotRegistry(ctx)
  const fibers = []
  for (const plugin of displayPlugins) fibers.push(await ctx.plugin(plugin))
  for (const [index, fiber] of fibers.entries()) {
    await fiber.dispose()
    assert.equal(ctx.tuiChromeSlotRegistry.registeredSlots.includes(SLOT_IDS[index]!), false)
  }
  assert.equal(ctx.tuiChromeSlotRegistry.registeredSlots.length, 0)
})

test('registration requires the registry context or a descendant and rejects duplicates or unknown slots', async () => {
  const ctx = new Context()
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = projector()
  applyChromeSlotRegistry(ctx)
  assert.throws(() => ctx.tuiChromeSlotRegistry.register(undefined as never, makeProducer('header.logo')), /owning Cordis context/)
  assert.throws(() => ctx.tuiChromeSlotRegistry.register(new Context(), makeProducer('header.logo')), /registry context or a descendant/)
  ctx.tuiChromeSlotRegistry.register(ctx, makeProducer('header.logo'))
  assert.throws(() => ctx.tuiChromeSlotRegistry.register(ctx, makeProducer('header.logo')), /duplicate slot registration/)
  assert.throws(() => ctx.tuiChromeSlotRegistry.register(ctx, ({ slotId: 'unknown' } as never)), /unknown slot/)
})

test('disposed registry rejects registration and projection', async () => {
  const ctx = new Context()
  await install(ctx)
  ctx.tuiChromeSlotRegistry.dispose()
  assert.throws(() => ctx.tuiChromeSlotRegistry.register(ctx, makeProducer('header.logo')), /registry disposed/)
  assert.throws(() => ctx.tuiChromeSlotRegistry.project(input()), /registry disposed/)
})

test('canonical projection is immutable, complete and revision-consistent', async () => {
  const ctx = new Context()
  await install(ctx)
  const models = ctx.tuiChromeSlotRegistry.project(input())
  assert.deepEqual(models.map(model => model.slotId), SLOT_IDS)
  for (const model of models) {
    assert.equal(model.publicationRevision, 3)
    assert.equal(Object.isFrozen(model), true)
  }
})

test('projection rejects invalid publication revisions and extra inputs', async () => {
  const ctx = new Context()
  await install(ctx)
  assert.throws(() => ctx.tuiChromeSlotRegistry.project({ ...input(), publicationRevision: -1 }), /non-negative integer/)
  assert.throws(() => ctx.tuiChromeSlotRegistry.project({ ...input(), metadata: {} } as never), /invalid closed input contract/)
  assert.throws(() => ctx.tuiChromeSlotRegistry.projectState({ publicationRevision: 3, debug: true } as never), /invalid closed input contract/)
})

test('semantic projections do not leak control payload fields', async () => {
  const ctx = new Context()
  await install(ctx)
  const models = Object.fromEntries(ctx.tuiChromeSlotRegistry.project(input()).map(model => [model.slotId, model]))
  assert.equal((models['header.logo'] as any).visible, true)
  assert.equal((models['header.connection'] as any).state, 'connected')
  assert.equal((models['header.session'] as any).text, '/tmp')
  assert.equal((models['header.status'] as any).text, 'idle')
  assert.equal((models.execution as any).state, 'idle')
  for (const model of Object.values(models)) {
    assert.equal('metadata' in model, false)
    assert.equal('control' in model, false)
    assert.equal('transportFrame' in model, false)
  }
})

test('registry rejects smuggled, hidden and accessor-owned output fields', async () => {
  const leakingContext = new Context()
  ;(leakingContext as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = projector()
  applyChromeSlotRegistry(leakingContext)
  leakingContext.tuiChromeSlotRegistry.register(leakingContext, {
    slotId: 'header.logo',
    project: () => ({ ...makeProducer('header.logo').project(input()), metadata: { provider: 'x' } }),
  })
  assert.throws(() => leakingContext.tuiChromeSlotRegistry.project(input()), /invalid closed output contract/)

  const hiddenContext = new Context()
  ;(hiddenContext as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = projector()
  applyChromeSlotRegistry(hiddenContext)
  hiddenContext.tuiChromeSlotRegistry.register(hiddenContext, {
    slotId: 'header.logo',
    project: () => {
      const model: Record<string, unknown> = { slotId: 'header.logo', revision: 1, publicationRevision: 3, variant: 'full', visible: true }
      Object.defineProperty(model, 'metadata', { enumerable: false, value: { provider: 'x' } })
      return model as never
    },
  })
  assert.throws(() => hiddenContext.tuiChromeSlotRegistry.project(input()), /invalid closed output contract/)
})

test('registered identity, required completeness and logic owner are enforced', async () => {
  const identityContext = new Context()
  ;(identityContext as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = projector()
  applyChromeSlotRegistry(identityContext)
  identityContext.tuiChromeSlotRegistry.register(identityContext, {
    slotId: 'header.logo',
    project: () => Object.freeze({ slotId: 'header.connection', revision: 1, publicationRevision: 3, displayMode: 'persistent', state: 'connected' }),
  })
  assert.throws(() => identityContext.tuiChromeSlotRegistry.project(input()), /projected header\.connection/)

  const incompleteContext = new Context()
  ;(incompleteContext as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = projector()
  applyChromeSlotRegistry(incompleteContext)
  assert.throws(() => incompleteContext.tuiChromeSlotRegistry.project(input()), /missing required slots/)

  const missingOwnerContext = new Context()
  await install(missingOwnerContext)
  assert.throws(() => missingOwnerContext.tuiChromeSlotRegistry.projectState({ publicationRevision: 3 }), /tuiLogicControls is not installed/)

  const malformedOwnerContext = new Context()
  ;(malformedOwnerContext as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = {} as TuiLogicControlProjector
  await install(malformedOwnerContext)
  assert.throws(() => malformedOwnerContext.tuiChromeSlotRegistry.projectState({ publicationRevision: 3 }), /does not implement project/)
})

test('projectState binds to the concrete logic-control registry owner', async () => {
  const ctx = new Context()
  applyLogicControls(ctx)
  for (const plugin of logicControlPlugins) plugin.apply(ctx)
  await install(ctx)
  const state = ctx.tuiChromeSlotRegistry.projectState({ publicationRevision: 3 })
  assert.equal(state.logoVariant, 'full')
  assert.equal(state.connectionState, 'disconnected')
  assert.equal(state.headerSession, 'Workspace unavailable')
  assert.equal(state.headerStatus, 'idle')
  assert.equal(state.executionState, 'idle')
})
