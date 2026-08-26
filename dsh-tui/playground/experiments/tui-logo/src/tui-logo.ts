import type { Context } from '@deepseek-ai/cordis'
import {
  chromeControlProjection,
  type TuiChromeSlotProducer,
} from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'

export interface TuiLogoDisplayPlugin {
  readonly name: 'tui.logo'
  readonly slotId: 'header.logo'
  apply(ctx: Context): void
}

export function createLogoProducer(): TuiChromeSlotProducer<{
  slotId: 'header.logo'; revision: number; publicationRevision: number; variant: 'full' | 'compact'; visible: boolean
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
    ctx.tuiChromeSlotRegistry.register(ctx, createLogoProducer())
  },
})
