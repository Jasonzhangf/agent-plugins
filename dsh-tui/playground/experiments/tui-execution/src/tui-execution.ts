import type { Context } from '@deepseek-ai/cordis'
import {
  chromeControlProjection,
  type TuiChromeSlotProducer,
} from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'
import type { TuiDisplayControlLifecycle } from '../../../../contracts/tui/display-control/display-control.types.ts'

export interface TuiExecutionDisplayPlugin {
  readonly name: 'tui.execution'
  readonly slotId: 'execution'
  apply(ctx: Context): void
}

export function createExecutionProducer(lifecycle?: TuiDisplayControlLifecycle): TuiChromeSlotProducer<{
  slotId: 'execution'; revision: number; publicationRevision: number; displayMode: 'persistent' | 'live'; state: 'idle' | 'running' | 'completed' | 'failed'
}> {
  return {
    slotId: 'execution',
    project(input) {
      const control = chromeControlProjection(input, 'execution')
      if (control.control !== 'execution') throw new TypeError('tui-execution: projection mismatch')
      return Object.freeze({
        slotId: 'execution',
        revision: control.revision,
        publicationRevision: input.publicationRevision,
        displayMode: lifecycle?.state.mode === 'live' ? 'live' : 'persistent',
        state: control.state,
      })
    },
  }
}

export const tuiExecutionDisplayPlugin: TuiExecutionDisplayPlugin = Object.freeze({
  name: 'tui.execution',
  slotId: 'execution',
  apply(ctx: Context): void {
    const lifecycle = ctx.tuiDisplayControl.create('tui.execution')
    lifecycle.attach()
    ctx.tuiChromeSlotRegistry.register(ctx, createExecutionProducer(lifecycle))
  },
})
