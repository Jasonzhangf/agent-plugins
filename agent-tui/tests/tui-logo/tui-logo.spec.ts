import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyChromeSlotRegistry } from '../../src/experiments/chrome-slot-registry/src/chrome-slot-registry.ts'
import { apply as applyDisplayControl } from '../../src/experiments/display-control/src/display-control.ts'
import { createLogoProducer, projectLogoStableElement, tuiLogoDisplayPlugin } from '../../src/experiments/tui-logo/src/tui-logo.ts'
import type { TuiLogicControlProjector } from '../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'

const logicControls: TuiLogicControlProjector = {
  project(control) {
    if (control !== 'logo') throw new Error(`tui.logo cannot consume ${control}`)
    return Object.freeze({ control, stableKey: 'control.logo', variant: 'compact', visible: false, revision: 7 })
  },
}

test('tui.logo has the exact independent Cordis identity and slot', () => {
  assert.equal(tuiLogoDisplayPlugin.name, 'tui.logo')
  assert.equal(tuiLogoDisplayPlugin.slotId, 'header.logo')
})

test('tui.logo projects a closed immutable model and unloads its own registration', async () => {
  const ctx = new Context()
  ;(ctx as unknown as { tuiLogicControls: TuiLogicControlProjector }).tuiLogicControls = logicControls
  applyDisplayControl(ctx)
  applyChromeSlotRegistry(ctx)
  const fiber = await ctx.plugin(tuiLogoDisplayPlugin)
  assert.deepEqual(ctx.tuiChromeSlotRegistry.registeredSlots, ['header.logo'])
  const model = createLogoProducer().project({ publicationRevision: 9, logicControls })
  assert.deepEqual(model, {
    slotId: 'header.logo', revision: 7, publicationRevision: 9, displayMode: 'persistent', variant: 'compact', visible: false,
  })
  assert.equal(Object.isFrozen(model), true)
  await fiber.dispose()
  assert.equal(ctx.tuiChromeSlotRegistry.registeredSlots.includes('header.logo'), false)
})

test('tui.logo is projected as the first stable display element', () => {
  const full = projectLogoStableElement(100)
  const compact = projectLogoStableElement(60)
  assert.equal(full.elementId, 'stable.logo')
  assert.equal(full.lifecycle, 'stable')
  assert.equal(full.lines.length, 3)
  assert.match(full.lines[1]?.spans[0]?.text ?? '', /AGENT TUI/)
  assert.equal(compact.lines[0]?.spans[0]?.text, '[A]')
})

test('createLogoProducer rejects a foreign logic-control projection', () => {
  assert.throws(() => createLogoProducer().project({
    publicationRevision: 1,
    logicControls: { project: () => ({ control: 'status', stableKey: 'control.status', sessionId: null, cwd: null, mode: 'idle', revision: 1 }) },
  }), /projection mismatch/)
})
