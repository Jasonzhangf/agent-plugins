import type { Context } from '@deepseek-ai/cordis'
import {
  chromeControlProjection,
  type TuiChromeSlotProducer,
} from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'
import type { TuiDisplayControlLifecycle } from '../../../../contracts/tui/display-control/display-control.types.ts'

const FULL_LOGO = '  ╭────────────────────╮\n  │      AGENT TUI     │\n  ╰────────────────────╯'

/** Stable preamble owned by the logo plugin; terminal lifecycle only carries rows. */
export function projectLogoStableElement(columns: number, visible = true): {
  readonly elementId: string
  readonly sourceId: string
  readonly semanticKind: string
  readonly lifecycle: 'stable'
  readonly lines: readonly { readonly spans: readonly { readonly text: string; readonly style: 'white' }[] }[]
} {
  const text = !visible ? '' : columns < 80 ? '[A]' : FULL_LOGO
  return Object.freeze({
    elementId: 'stable.logo',
    sourceId: 'stable.logo',
    semanticKind: 'tui.logo',
    lifecycle: 'stable',
    lines: Object.freeze(text.split('\n').map(line => Object.freeze({ spans: Object.freeze([Object.freeze({ text: line, style: 'white' as const })]) }))),
  })
}

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
