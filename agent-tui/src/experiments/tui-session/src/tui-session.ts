import type { Context } from '@deepseek-ai/cordis'
import {
  chromeControlProjection,
  type TuiChromeSlotProducer,
} from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'
import type { TuiDisplayControlLifecycle } from '../../../../contracts/tui/display-control/display-control.types.ts'

export interface TuiSessionDisplayPlugin {
  readonly name: 'tui.session'
  readonly slotId: 'header.session'
  apply(ctx: Context): void
}

export function createSessionProducer(lifecycle?: TuiDisplayControlLifecycle): TuiChromeSlotProducer<{
  slotId: 'header.session'; revision: number; publicationRevision: number; displayMode: 'persistent' | 'live'; text: string
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
        displayMode: lifecycle?.state.mode === 'live' ? 'live' : 'persistent',
        text: control.cwd ?? '',
      })
    },
  }
}

export const tuiSessionDisplayPlugin: TuiSessionDisplayPlugin = Object.freeze({
  name: 'tui.session',
  slotId: 'header.session',
  apply(ctx: Context): void {
    const lifecycle = ctx.tuiDisplayControl.create('tui.session')
    lifecycle.attach()
    ctx.tuiChromeSlotRegistry.register(ctx, createSessionProducer(lifecycle))
  },
})
