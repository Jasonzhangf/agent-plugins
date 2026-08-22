import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyChromeControls } from '../../playground/experiments/chrome-controls/src/chrome-controls.ts'
import { TuiChromeSlotRegistry } from '../../playground/experiments/chrome-controls/src/chrome-controls.ts'
import { apply as applyLogicControls, logicControlPlugins } from '../../playground/experiments/logic-controls/src/logic-controls.ts'

import type { LogicControlProjection } from '../../contracts/tui/logic-controls/logic-controls.types.ts'
import type { TuiLogicControlProjector } from '../../contracts/tui/chrome-controls/chrome-controls.types.ts'

function makeControls(): ReadonlyArray<LogicControlProjection> {
  return Object.freeze([
    Object.freeze({ control: 'logo' as const, stableKey: 'control.logo', variant: 'full' as const, visible: true, revision: 1 }),
    Object.freeze({ control: 'connection' as const, stableKey: 'control.connection', state: 'connected' as const, revision: 1 }),
    Object.freeze({ control: 'session' as const, stableKey: 'control.session', selectedSessionId: 'session-a', availableSessionIds: ['session-a'], cwd: '/tmp', lifecycle: 'active' as const, requestedSessionId: null, revision: 1 }),
    Object.freeze({ control: 'status' as const, stableKey: 'control.status', sessionId: 'session-a', cwd: '/tmp', mode: 'idle' as const, revision: 1 }),
    Object.freeze({ control: 'execution' as const, stableKey: 'control.execution', state: 'idle' as const, turnId: null, revision: 1 }),
  ]) as ReadonlyArray<LogicControlProjection>
}

function input(publicationRevision = 3) {
  return {
    publicationRevision,
    logicControls: projector(),
  }
}

function projector(): TuiLogicControlProjector {
  const controls = new Map(makeControls().map(control => [control.control, control]))
  return {
    project(control) {
      const projection = controls.get(control)
      if (!projection) throw new Error(`missing ${control}`)
      return projection
    },
  }
}

test('chrome-controls registers exactly the five independent plugins once each', () => {
  const ctx = new Context()
  applyChromeControls(ctx)
  assert.deepEqual(
    [...ctx.tuiChromeSlotRegistry.registeredSlots],
    ['header.logo', 'header.connection', 'header.session', 'header.status', 'execution'],
  )
})

test('registry rejects duplicate slot registration and unknown slots', () => {
  const ctx = new Context()
  applyChromeControls(ctx)
  const duplicateProducer = { slotId: 'header.logo' as const, project: () => ({ slotId: 'header.logo' as const, revision: 1, publicationRevision: 1, variant: 'full' as const, visible: true }) }
  assert.throws(() => ctx.tuiChromeSlotRegistry.register(duplicateProducer), /duplicate slot registration/)
  const unknownProducer = { slotId: 'unknown.slot', project: () => ({ slotId: 'unknown.slot', revision: 1, publicationRevision: 1 }) } as never
  assert.throws(() => ctx.tuiChromeSlotRegistry.register(unknownProducer), /unknown slot/)
})

test('disposed registry rejects registration and projection', () => {
  const ctx = new Context()
  applyChromeControls(ctx)
  ctx.tuiChromeSlotRegistry.dispose()
  assert.throws(() => ctx.tuiChromeSlotRegistry.register({ slotId: 'header.logo' as const, project: () => ({ slotId: 'header.logo' as const, revision: 1, publicationRevision: 1, variant: 'full' as const, visible: true }) }), /registry disposed/)
  assert.throws(() => ctx.tuiChromeSlotRegistry.project(input()), /registry disposed/)
})

test('slot output is immutable and revision-consistent', () => {
  const ctx = new Context()
  applyChromeControls(ctx)
  const models = ctx.tuiChromeSlotRegistry.project(input())
  assert.equal(models.length, 5)
  for (const model of models) {
    assert.equal(model.publicationRevision, 3)
    assert.equal(Object.isFrozen(model), true)
  }
  assert.deepEqual([...models.map(m => m.slotId)], ['header.logo', 'header.connection', 'header.session', 'header.status', 'execution'])
})

test('stale publication revision fails closed', () => {
  const ctx = new Context()
  applyChromeControls(ctx)
  assert.throws(() => ctx.tuiChromeSlotRegistry.project({ ...input(), publicationRevision: -1 }), /publicationRevision must be a non-negative integer/)
})

test('chrome plugins project semantic values without control payload leakage', () => {
  const ctx = new Context()
  applyChromeControls(ctx)
  const models = Object.fromEntries(ctx.tuiChromeSlotRegistry.project(input()).map(m => [m.slotId, m]))
  const logo = models['header.logo'] as never as { variant?: string; visible?: boolean }
  const connection = models['header.connection'] as never as { state?: string }
  const session = models['header.session'] as never as { text?: string }
  const status = models['header.status'] as never as { text?: string }
  const execution = models.execution as never as { state?: string }
  assert.equal(logo.variant, 'full')
  assert.equal(logo.visible, true)
  assert.equal(connection.state, 'connected')
  assert.equal(session.text, 'Session session-a')
  assert.equal(status.text, 'Status idle')
  assert.equal(execution.state, 'idle')
  for (const raw of [logo, connection, session, status, execution]) {
    assert.equal('metadata' in raw, false)
    assert.equal('control' in raw, false)
    assert.equal('transportFrame' in raw, false)
  }
})

test('registry rejects a registered producer that smuggles control fields', () => {
  const ctx = new Context()
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = projector()
  ctx.tuiChromeSlotRegistry = new TuiChromeSlotRegistry(ctx)
  ctx.tuiChromeSlotRegistry.register({
    slotId: 'header.logo',
    project: () => ({
      slotId: 'header.logo' as const,
      revision: 1,
      publicationRevision: 3,
      variant: 'full' as const,
      visible: true,
      metadata: { provider: 'x' },
    }),
  })
  assert.throws(() => ctx.tuiChromeSlotRegistry.project(input()), /invalid closed output contract/)
})

test('registry rejects hidden own properties, symbols, and accessors', () => {
  const ctx = new Context()
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = projector()
  const registry = new TuiChromeSlotRegistry(ctx)
  registry.register({
    slotId: 'header.logo',
    project: () => {
      const model = { slotId: 'header.logo', revision: 1, publicationRevision: 3, variant: 'full', visible: true } as Record<string, unknown>
      Object.defineProperty(model, 'metadata', { enumerable: false, value: { provider: 'x' } })
      Object.defineProperty(model, Symbol.for('provider'), { value: 'x' })
      return model as never
    },
  })
  assert.throws(() => registry.project(input()), /invalid closed output contract/)
  const accessorContext = new Context()
  ;(accessorContext as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = projector()
  const accessorRegistry = new TuiChromeSlotRegistry(accessorContext)
  accessorRegistry.register({
    slotId: 'header.logo',
    project: () => {
      const model = {} as Record<string, unknown>
      let visible = true
      Object.defineProperties(model, {
        slotId: { enumerable: true, value: 'header.logo' },
        revision: { enumerable: true, value: 1 },
        publicationRevision: { enumerable: true, value: 3 },
        variant: { enumerable: true, value: 'full' },
        visible: { enumerable: true, get: () => visible },
      })
      return model as never
    },
  })
  assert.throws(() => accessorRegistry.project(input()), /invalid visible property/)
})

test('registry binds registered identity to projected slot identity', () => {
  const ctx = new Context()
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = projector()
  const registry = new TuiChromeSlotRegistry(ctx)
  registry.register({
    slotId: 'header.logo',
    project: () => ({
      slotId: 'header.connection' as const,
      revision: 1,
      publicationRevision: 3,
      state: 'connected' as const,
    }),
  })
  assert.throws(() => registry.project(input()), /registered slot header\.logo projected header\.connection/)
})

test('registry rejects an incomplete required slot set', () => {
  const ctx = new Context()
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = projector()
  ctx.tuiChromeSlotRegistry = new TuiChromeSlotRegistry(ctx)
  assert.throws(() => ctx.tuiChromeSlotRegistry.project(input()), /missing required slots/)
})

test('registry rejects projectState without its logic-control owner', () => {
  const ctx = new Context()
  applyChromeControls(ctx)
  assert.throws(() => ctx.tuiChromeSlotRegistry.projectState({ publicationRevision: 3 }), /tuiLogicControls is not installed/)
})

test('registry binds projectState to the concrete logic-control owner', () => {
  const ctx = new Context()
  applyLogicControls(ctx)
  for (const plugin of logicControlPlugins) plugin.apply(ctx)
  applyChromeControls(ctx)
  const state = ctx.tuiChromeSlotRegistry.projectState({ publicationRevision: 3 })
  assert.equal(state.logoVariant, 'full')
  assert.equal(state.connectionState, 'disconnected')
  assert.equal(state.headerSession, 'Session no-session')
  assert.equal(state.headerStatus, 'Status idle')
  assert.equal(state.executionState, 'idle')
})

test('registry fails closed on extra projection input fields', () => {
  const ctx = new Context()
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = projector()
  applyChromeControls(ctx)
  assert.throws(() => ctx.tuiChromeSlotRegistry.projectState({
    publicationRevision: 3,
    metadata: { debug: true },
  } as never), /state input has an invalid closed input contract/)
  assert.throws(() => ctx.tuiChromeSlotRegistry.project({
    ...input(),
    composer: { text: '', cursor: 0, lines: [''], cursorLine: 0, cursorColumn: 0, mode: 'idle' },
  } as never), /projection input has an invalid closed input contract/)
})

test('registry rejects a malformed logic-control owner', () => {
  const ctx = new Context()
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = {} as TuiLogicControlProjector
  applyChromeControls(ctx)
  assert.throws(() => ctx.tuiChromeSlotRegistry.projectState({ publicationRevision: 3 }), /does not implement project/)
})
