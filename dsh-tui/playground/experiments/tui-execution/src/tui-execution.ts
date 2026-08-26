import type { Context } from '@deepseek-ai/cordis'
import {
  chromeControlProjection,
  type TuiChromeSlotProducer,
} from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'

export interface TuiExecutionDisplayPlugin {
  readonly name: 'tui.execution'
  readonly slotId: 'execution'
  apply(ctx: Context): void
}

export function createExecutionProducer(): TuiChromeSlotProducer<{
  slotId: 'execution'; revision: number; publicationRevision: number; state: 'idle' | 'running' | 'completed' | 'failed'
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
        state: control.state,
      })
    },
  }
}

export const tuiExecutionDisplayPlugin: TuiExecutionDisplayPlugin = Object.freeze({
  name: 'tui.execution',
  slotId: 'execution',
  apply(ctx: Context): void {
    ctx.tuiChromeSlotRegistry.register(ctx, createExecutionProducer())
  },
})
