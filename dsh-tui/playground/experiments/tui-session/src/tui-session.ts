import type { Context } from '@deepseek-ai/cordis'
import {
  chromeControlProjection,
  type TuiChromeSlotProducer,
} from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'

export interface TuiSessionDisplayPlugin {
  readonly name: 'tui.session'
  readonly slotId: 'header.session'
  apply(ctx: Context): void
}

export function createSessionProducer(): TuiChromeSlotProducer<{
  slotId: 'header.session'; revision: number; publicationRevision: number; text: string
}> {
  return {
    slotId: 'header.session',
    project(input) {
      const control = chromeControlProjection(input, 'session')
      if (control.control !== 'session') throw new TypeError('tui-session: projection mismatch')
      return Object.freeze({
        slotId: 'header.session',
        revision: control.revision,
        publicationRevision: input.publicationRevision,
        text: `Session ${control.selectedSessionId ?? 'no-session'}`,
      })
    },
  }
}

export const tuiSessionDisplayPlugin: TuiSessionDisplayPlugin = Object.freeze({
  name: 'tui.session',
  slotId: 'header.session',
  apply(ctx: Context): void {
    ctx.tuiChromeSlotRegistry.register(ctx, createSessionProducer())
  },
})
