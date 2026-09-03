import type { Context } from '@deepseek-ai/cordis'
import type { TuiDisplayBufferSnapshot } from '../display-buffer-plugin/display-buffer-plugin.types.ts'
import type { TuiDisplayLine } from '../interpreter-plugin/interpreter-plugin.types.ts'

export interface TuiTerminalVisibleRow {
  readonly absoluteRow: number
  readonly line: TuiDisplayLine
}

export interface TuiTerminalRenderFrame {
  readonly revision: number
  readonly width: number
  readonly paddingX: number
  readonly topRow: number
  readonly height: number
  readonly committedRows: readonly number[]
  /** Complete stable rows that must be emitted into terminal scrollback. */
  readonly scrollbackRows: readonly TuiTerminalVisibleRow[]
  readonly rows: readonly TuiTerminalVisibleRow[]
}

export interface TuiTerminalRenderFace {
  readonly name: 'tuiTerminalRender'
  project(snapshot: TuiDisplayBufferSnapshot): TuiTerminalRenderFrame
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { tuiTerminalRender?: TuiTerminalRenderFace }
}
