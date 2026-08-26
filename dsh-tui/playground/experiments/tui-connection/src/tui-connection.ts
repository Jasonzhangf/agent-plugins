import type { Context } from '@deepseek-ai/cordis'
import {
  chromeControlProjection,
  type TuiChromeSlotProducer,
} from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'

export interface TuiConnectionDisplayPlugin {
  readonly name: 'tui.connection'
  readonly slotId: 'header.connection'
  apply(ctx: Context): void
}

export function createConnectionProducer(): TuiChromeSlotProducer<{
  slotId: 'header.connection'; revision: number; publicationRevision: number; state: 'connecting' | 'connected' | 'disconnected' | 'failed'
}> {
  return {
    slotId: 'header.connection',
    project(input) {
      const control = chromeControlProjection(input, 'connection')
      if (control.control !== 'connection') throw new TypeError('tui-connection: projection mismatch')
      return Object.freeze({
        slotId: 'header.connection',
        revision: control.revision,
        publicationRevision: input.publicationRevision,
        state: control.state,
      })
    },
  }
}

export const tuiConnectionDisplayPlugin: TuiConnectionDisplayPlugin = Object.freeze({
  name: 'tui.connection',
  slotId: 'header.connection',
  apply(ctx: Context): void {
    ctx.tuiChromeSlotRegistry.register(ctx, createConnectionProducer())
  },
})
