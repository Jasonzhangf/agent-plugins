import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyChromeSlotRegistry } from '../../src/experiments/chrome-slot-registry/src/chrome-slot-registry.ts'
import { apply as applyDisplayControl } from '../../src/experiments/display-control/src/display-control.ts'
import { createExecutionProducer, tuiExecutionDisplayPlugin } from '../../src/experiments/tui-execution/src/tui-execution.ts'
import type { TuiLogicControlProjector } from '../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'

const logicControls: TuiLogicControlProjector = {
  project(control) {
    if (control !== 'execution') throw new Error(`tui.execution cannot consume ${control}`)
    return Object.freeze({ control, stableKey: 'control.execution', state: 'running', turnId: 'turn-1', revision: 3 })
  },
}

test('tui.execution has the exact independent Cordis identity and slot', () => {
  assert.equal(tuiExecutionDisplayPlugin.name, 'tui.execution')
  assert.equal(tuiExecutionDisplayPlugin.slotId, 'execution')
})

test('tui.execution projects a closed immutable model and unloads its own registration', async () => {
  const ctx = new Context()
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = logicControls
  applyDisplayControl(ctx)
  applyChromeSlotRegistry(ctx)
  const fiber = await ctx.plugin(tuiExecutionDisplayPlugin)
  assert.deepEqual(ctx.tuiChromeSlotRegistry.registeredSlots, ['execution'])
  const model = createExecutionProducer().project({ publicationRevision: 11, logicControls })
  assert.deepEqual(model, { slotId: 'execution', revision: 3, publicationRevision: 11, displayMode: 'persistent', state: 'running' })
  assert.equal(Object.isFrozen(model), true)
  await fiber.dispose()
  assert.equal(ctx.tuiChromeSlotRegistry.registeredSlots.includes('execution'), false)
})

test('createExecutionProducer rejects a foreign logic-control projection', () => {
  assert.throws(() => createExecutionProducer().project({
    publicationRevision: 1,
    logicControls: { project: () => ({ control: 'status', stableKey: 'control.status', sessionId: null, cwd: null, mode: 'idle', revision: 1 }) },
  }), /projection mismatch/)
})
