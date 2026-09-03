import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyChromeSlotRegistry } from '../../src/experiments/chrome-slot-registry/src/chrome-slot-registry.ts'
import { apply as applyDisplayControl } from '../../src/experiments/display-control/src/display-control.ts'
import { createStatusProducer, tuiStatusDisplayPlugin } from '../../src/experiments/tui-status/src/tui-status.ts'
import type { TuiLogicControlProjector } from '../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'

const logicControls: TuiLogicControlProjector = {
  project(control) {
    if (control !== 'status') throw new Error(`tui.status cannot consume ${control}`)
    return Object.freeze({ control, stableKey: 'control.status', sessionId: 'session-live', cwd: '/tmp/work', mode: 'streaming', revision: 6 })
  },
}

test('tui.status has the exact independent Cordis identity and slot', () => {
  assert.equal(tuiStatusDisplayPlugin.name, 'tui.status')
  assert.equal(tuiStatusDisplayPlugin.slotId, 'header.status')
})

test('tui.status projects a closed immutable model and unloads its own registration', async () => {
  const ctx = new Context()
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = logicControls
  applyDisplayControl(ctx)
  applyChromeSlotRegistry(ctx)
  const fiber = await ctx.plugin(tuiStatusDisplayPlugin)
  assert.deepEqual(ctx.tuiChromeSlotRegistry.registeredSlots, ['header.status'])
  const model = createStatusProducer().project({ publicationRevision: 10, logicControls })
  assert.deepEqual(model, { slotId: 'header.status', revision: 6, publicationRevision: 10, displayMode: 'persistent', text: 'streaming' })
  assert.equal(Object.isFrozen(model), true)
  await fiber.dispose()
  assert.equal(ctx.tuiChromeSlotRegistry.registeredSlots.includes('header.status'), false)
})

test('createStatusProducer rejects a foreign logic-control projection', () => {
  assert.throws(() => createStatusProducer().project({
    publicationRevision: 1,
    logicControls: { project: () => ({ control: 'logo', stableKey: 'control.logo', variant: 'full', visible: true, revision: 1 }) },
  }), /projection mismatch/)
})
