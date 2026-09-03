import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyChromeSlotRegistry } from '../../src/experiments/chrome-slot-registry/src/chrome-slot-registry.ts'
import { apply as applyDisplayControl } from '../../src/experiments/display-control/src/display-control.ts'
import { createConnectionProducer, tuiConnectionDisplayPlugin } from '../../src/experiments/tui-connection/src/tui-connection.ts'
import type { TuiLogicControlProjector } from '../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'

const logicControls: TuiLogicControlProjector = {
  project(control) {
    if (control !== 'connection') throw new Error(`tui.connection cannot consume ${control}`)
    return Object.freeze({ control, stableKey: 'control.connection', state: 'connecting', revision: 4 })
  },
}

test('tui.connection has the exact independent Cordis identity and slot', () => {
  assert.equal(tuiConnectionDisplayPlugin.name, 'tui.connection')
  assert.equal(tuiConnectionDisplayPlugin.slotId, 'header.connection')
})

test('tui.connection projects a closed immutable model and unloads its own registration', async () => {
  const ctx = new Context()
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = logicControls
  applyDisplayControl(ctx)
  applyChromeSlotRegistry(ctx)
  const fiber = await ctx.plugin(tuiConnectionDisplayPlugin)
  assert.deepEqual(ctx.tuiChromeSlotRegistry.registeredSlots, ['header.connection'])
  const model = createConnectionProducer().project({ publicationRevision: 8, logicControls })
  assert.deepEqual(model, { slotId: 'header.connection', revision: 4, publicationRevision: 8, displayMode: 'persistent', state: 'connecting' })
  assert.equal(Object.isFrozen(model), true)
  await fiber.dispose()
  assert.equal(ctx.tuiChromeSlotRegistry.registeredSlots.includes('header.connection'), false)
})

test('createConnectionProducer rejects a foreign logic-control projection', () => {
  assert.throws(() => createConnectionProducer().project({
    publicationRevision: 1,
    logicControls: { project: () => ({ control: 'logo', stableKey: 'control.logo', variant: 'full', visible: true, revision: 1 }) },
  }), /projection mismatch/)
})

test('tui.connection can pulse only its connecting display mode', () => {
  const producer = createConnectionProducer()
  const input = {
    publicationRevision: 1,
    logicControls: {
      project: () => ({ control: 'connection', stableKey: 'control.connection', state: 'connecting', revision: 1 }),
    },
  } as never
  assert.equal(producer.project(input).displayMode, 'persistent')
  producer.setPulse(true)
  assert.equal(producer.project(input).displayMode, 'live')
})
