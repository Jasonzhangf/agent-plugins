import type { Context } from '@deepseek-ai/cordis'
import {
  chromeControlProjection,
  type TuiChromeSlotProducer,
} from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'
import type { TuiDisplayControlLifecycle } from '../../../../contracts/tui/display-control/display-control.types.ts'

export interface TuiStatusDisplayPlugin {
  readonly name: 'tui.status'
  readonly slotId: 'header.status'
  apply(ctx: Context): void
}

export function createStatusProducer(lifecycle?: TuiDisplayControlLifecycle): TuiChromeSlotProducer<{
  slotId: 'header.status'; revision: number; publicationRevision: number; displayMode: 'persistent' | 'live'; text: string
}> {
  return {
    slotId: 'header.status',
    project(input) {
      const control = chromeControlProjection(input, 'status')
      if (control.control !== 'status') throw new TypeError('tui-status: projection mismatch')
      return Object.freeze({
        slotId: 'header.status',
        revision: control.revision,
        publicationRevision: input.publicationRevision,
        displayMode: lifecycle?.state.mode === 'live' ? 'live' : 'persistent',
        text: control.mode,
      })
    },
  }
}

export const tuiStatusDisplayPlugin: TuiStatusDisplayPlugin = Object.freeze({
  name: 'tui.status',
  slotId: 'header.status',
  apply(ctx: Context): void {
    const lifecycle = ctx.tuiDisplayControl.create('tui.status')
    lifecycle.attach()
    ctx.tuiChromeSlotRegistry.register(ctx, createStatusProducer(lifecycle))
  },
})
