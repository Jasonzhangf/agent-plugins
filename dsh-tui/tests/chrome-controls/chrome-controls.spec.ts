import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyChromeControls } from '../../playground/experiments/chrome-controls/src/chrome-controls.ts'
import { TuiChromeSlotRegistry } from '../../playground/experiments/chrome-controls/src/chrome-controls.ts'

import type { LogicControlProjection } from '../../contracts/tui/logic-controls/logic-controls.types.ts'

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
    controls: makeControls(),
    composer: { text: '', cursor: 0, lines: [''], cursorLine: 0, cursorColumn: 0, mode: 'idle' as const },
    status: { sessionId: 'session-a', cwd: '/tmp', mode: 'idle' as const, publicationRevision },
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

test('registry rejects an incomplete required slot set', () => {
  const ctx = new Context()
  ctx.tuiChromeSlotRegistry = new TuiChromeSlotRegistry(ctx)
  assert.throws(() => ctx.tuiChromeSlotRegistry.project(input()), /missing required slots/)
})
