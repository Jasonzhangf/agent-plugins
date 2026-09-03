import type { Context } from '@deepseek-ai/cordis'
import type { TuiTerminalRenderFrame, TuiTerminalVisibleRow } from '../terminal-render-plugin/terminal-render-plugin.types.ts'

export interface TuiTerminalOutputSnapshot {
  readonly sessionKey: string | null
  readonly revision: number
  readonly width: number
  readonly paddingX: number
  readonly scrollbackRows: readonly number[]
  readonly stableRows: readonly TuiTerminalVisibleRow[]
  /** Stable rows newly admitted since the preceding render frame. */
  readonly pendingStableRows: readonly TuiTerminalVisibleRow[]
  readonly liveRows: readonly number[]
  /** Visible neutral rows retained for the terminal carrier's next frame. */
  readonly visibleRows: readonly TuiTerminalVisibleRow[]
  /** Absolute rows whose terminal cells must be rewritten by the carrier. */
  readonly dirtyRows: readonly number[]
}

export interface TuiTerminalOutputFace {
  readonly name: 'tuiTerminalOutput'
  reset(sessionKey: string): void
  apply(frame: TuiTerminalRenderFrame): TuiTerminalOutputSnapshot
  read(): TuiTerminalOutputSnapshot
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { tuiTerminalOutput?: TuiTerminalOutputFace }
}
