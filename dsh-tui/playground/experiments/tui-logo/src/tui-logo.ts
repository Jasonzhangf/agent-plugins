import type { Context } from '@deepseek-ai/cordis'
import {
  chromeControlProjection,
  type TuiChromeSlotProducer,
} from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'
import type { TuiDisplayControlLifecycle } from '../../../../contracts/tui/display-control/display-control.types.ts'

export interface TuiLogoDisplayPlugin {
  readonly name: 'tui.logo'
  readonly slotId: 'header.logo'
  apply(ctx: Context): void
}

export function createLogoProducer(lifecycle?: TuiDisplayControlLifecycle): TuiChromeSlotProducer<{
  slotId: 'header.logo'; revision: number; publicationRevision: number; displayMode: 'persistent' | 'live'; variant: 'full' | 'compact'; visible: boolean
}> {
  return {
    slotId: 'header.logo',
    project(input) {
      const control = chromeControlProjection(input, 'logo')
      if (control.control !== 'logo') throw new TypeError('tui-logo: projection mismatch')
      return Object.freeze({
        slotId: 'header.logo',
        revision: control.revision,
        publicationRevision: input.publicationRevision,
        displayMode: lifecycle?.state.mode === 'live' ? 'live' : 'persistent',
        variant: control.variant,
        visible: control.visible,
      })
    },
  }
}

export const tuiLogoDisplayPlugin: TuiLogoDisplayPlugin = Object.freeze({
  name: 'tui.logo',
  slotId: 'header.logo',
  apply(ctx: Context): void {
    const lifecycle = ctx.tuiDisplayControl.create('tui.logo')
    lifecycle.attach()
    ctx.tuiChromeSlotRegistry.register(ctx, createLogoProducer(lifecycle))
  },
})
