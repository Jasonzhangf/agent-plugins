import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyChromeSlotRegistry } from '../../src/experiments/chrome-slot-registry/src/chrome-slot-registry.ts'
import { apply as applyDisplayControl } from '../../src/experiments/display-control/src/display-control.ts'
import { createSessionProducer, tuiSessionDisplayPlugin } from '../../src/experiments/tui-session/src/tui-session.ts'
import type { TuiLogicControlProjector } from '../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'

const logicControls: TuiLogicControlProjector = {
  project(control) {
    if (control !== 'session') throw new Error(`tui.session cannot consume ${control}`)
    return Object.freeze({ control, stableKey: 'control.session', selectedSessionId: 'session-live', availableSessionIds: ['session-live'], cwd: '/tmp/work', lifecycle: 'active', requestedSessionId: null, revision: 2 })
  },
}

test('tui.session has the exact independent Cordis identity and slot', () => {
  assert.equal(tuiSessionDisplayPlugin.name, 'tui.session')
  assert.equal(tuiSessionDisplayPlugin.slotId, 'header.session')
})

test('tui.session projects a closed immutable model and unloads its own registration', async () => {
  const ctx = new Context()
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = logicControls
  applyDisplayControl(ctx)
  applyChromeSlotRegistry(ctx)
  const fiber = await ctx.plugin(tuiSessionDisplayPlugin)
  assert.deepEqual(ctx.tuiChromeSlotRegistry.registeredSlots, ['header.session'])
  const model = createSessionProducer().project({ publicationRevision: 5, logicControls })
  assert.deepEqual(model, { slotId: 'header.session', revision: 2, publicationRevision: 5, displayMode: 'persistent', text: '/tmp/work' })
  assert.equal(model.text.includes('session-live'), false)
  assert.equal(Object.isFrozen(model), true)
  await fiber.dispose()
  assert.equal(ctx.tuiChromeSlotRegistry.registeredSlots.includes('header.session'), false)
})

test('tui.session omits the workspace row when cwd is unavailable', () => {
  const model = createSessionProducer().project({
    publicationRevision: 5,
    logicControls: {
      project: () => Object.freeze({ control: 'session', stableKey: 'control.session', selectedSessionId: 'session-hidden', availableSessionIds: ['session-hidden'], cwd: null, lifecycle: 'active', requestedSessionId: null, revision: 2 }),
    },
  })
  assert.equal(model.text, '')
  assert.equal(model.text.includes('session-hidden'), false)
})

test('createSessionProducer rejects a foreign logic-control projection', () => {
  assert.throws(() => createSessionProducer().project({
    publicationRevision: 1,
    logicControls: { project: () => ({ control: 'status', stableKey: 'control.status', sessionId: null, cwd: null, mode: 'idle', revision: 1 }) },
  }), /projection mismatch/)
})
