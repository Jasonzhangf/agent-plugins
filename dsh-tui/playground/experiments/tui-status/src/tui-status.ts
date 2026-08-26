import type { Context } from '@deepseek-ai/cordis'
import {
  chromeControlProjection,
  type TuiChromeSlotProducer,
} from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'

export interface TuiStatusDisplayPlugin {
  readonly name: 'tui.status'
  readonly slotId: 'header.status'
  apply(ctx: Context): void
}

export function createStatusProducer(): TuiChromeSlotProducer<{
  slotId: 'header.status'; revision: number; publicationRevision: number; text: string
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
        text: `Status ${control.mode}`,
      })
    },
  }
}

export const tuiStatusDisplayPlugin: TuiStatusDisplayPlugin = Object.freeze({
  name: 'tui.status',
  slotId: 'header.status',
  apply(ctx: Context): void {
    ctx.tuiChromeSlotRegistry.register(ctx, createStatusProducer())
  },
})
