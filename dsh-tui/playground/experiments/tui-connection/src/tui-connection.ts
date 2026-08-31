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

type TuiConnectionSlot = {
  slotId: 'header.connection'; revision: number; publicationRevision: number; displayMode: 'persistent' | 'live'; state: 'connecting' | 'connected' | 'disconnected' | 'failed'
}

export interface TuiConnectionProducer extends TuiChromeSlotProducer<TuiConnectionSlot> {
  setPulse(value: boolean): void
}

export function createConnectionProducer(lifecycle?: TuiDisplayControlLifecycle): TuiConnectionProducer {
  let pulse = false
  return {
    slotId: 'header.connection',
    project(input) {
      const control = chromeControlProjection(input, 'connection')
      if (control.control !== 'connection') throw new TypeError('tui-connection: projection mismatch')
      return Object.freeze({
        slotId: 'header.connection',
        revision: control.revision,
        publicationRevision: input.publicationRevision,
        displayMode: control.state === 'connecting'
          ? pulse ? 'live' : 'persistent'
          : lifecycle?.state.mode === 'live' ? 'live' : 'persistent',
        state: control.state,
      })
    },
    setPulse(value: boolean): void { pulse = value },
  }
}

export const tuiConnectionDisplayPlugin: TuiConnectionDisplayPlugin = Object.freeze({
  name: 'tui.connection',
  slotId: 'header.connection',
  apply(ctx: Context): void {
    const lifecycle = ctx.tuiDisplayControl.create('tui.connection')
    lifecycle.attach()
    const producer = createConnectionProducer(lifecycle)
    ctx.tuiChromeSlotRegistry.register(ctx, producer)
    let pulse = false
    let sourceRevision = 0
    const timer = setInterval(() => {
      const control = ctx.tuiLogicControls.project('connection')
      if (control.control !== 'connection' || control.state !== 'connecting') return
      pulse = !pulse
      producer.setPulse(pulse)
      sourceRevision += 1
      ctx.tuiRefreshOrchestrator.request({ sourceModuleId: 'tui-connection', reason: 'chrome-slot', sourceRevision })
    }, 180)
    ctx.effect(() => () => clearInterval(timer), 'tui-connection.pulse')
  },
})
