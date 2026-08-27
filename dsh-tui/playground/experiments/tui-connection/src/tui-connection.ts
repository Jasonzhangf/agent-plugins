import type { Context } from '@deepseek-ai/cordis'
import {
  chromeControlProjection,
  type TuiChromeSlotProducer,
} from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'
import type { TuiDisplayControlLifecycle } from '../../../../contracts/tui/display-control/display-control.types.ts'

export interface TuiConnectionDisplayPlugin {
  readonly name: 'tui.connection'
  readonly slotId: 'header.connection'
  apply(ctx: Context): void
}

export function createConnectionProducer(lifecycle?: TuiDisplayControlLifecycle): TuiChromeSlotProducer<{
  slotId: 'header.connection'; revision: number; publicationRevision: number; displayMode: 'persistent' | 'live'; state: 'connecting' | 'connected' | 'disconnected' | 'failed'
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
        displayMode: lifecycle?.state.mode === 'live' ? 'live' : 'persistent',
        state: control.state,
      })
    },
  }
}

export const tuiConnectionDisplayPlugin: TuiConnectionDisplayPlugin = Object.freeze({
  name: 'tui.connection',
  slotId: 'header.connection',
  apply(ctx: Context): void {
    const lifecycle = ctx.tuiDisplayControl.create('tui.connection')
    lifecycle.attach()
    ctx.tuiChromeSlotRegistry.register(ctx, createConnectionProducer(lifecycle))
  },
})
