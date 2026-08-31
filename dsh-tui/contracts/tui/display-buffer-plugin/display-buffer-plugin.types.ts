import type { Context } from '@deepseek-ai/cordis'
import type { TuiDisplayElement, TuiDisplayLine } from '../interpreter-plugin/interpreter-plugin.types.ts'

export interface TuiDisplayRow {
  readonly absoluteRow: number
  readonly elementId: string
  readonly sourceId: string
  readonly lineIndex: number
  readonly lifecycle: 'stable' | 'live'
  readonly line: TuiDisplayLine
}

export interface TuiDisplayViewport {
  readonly topRow: number
  readonly height: number
  readonly followTail: boolean
}

export interface TuiDisplayLayout {
  readonly width: number
  readonly paddingX: number
}

export interface TuiDisplayBufferSnapshot {
  readonly revision: number
  readonly width: number
  readonly paddingX: number
  readonly committedRows: readonly TuiDisplayRow[]
  readonly liveRows: readonly TuiDisplayRow[]
  readonly viewport: TuiDisplayViewport
}

export interface TuiDisplayBufferFace {
  readonly name: 'tuiDisplayBuffer'
  reset(): TuiDisplayBufferSnapshot
  reflow(elements: readonly TuiDisplayElement[], layout: TuiDisplayLayout): TuiDisplayBufferSnapshot
  setViewport(viewport: TuiDisplayViewport): TuiDisplayBufferSnapshot
  read(): TuiDisplayBufferSnapshot
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { tuiDisplayBuffer?: TuiDisplayBufferFace }
}
