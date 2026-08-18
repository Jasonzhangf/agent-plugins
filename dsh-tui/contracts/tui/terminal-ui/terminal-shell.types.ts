import type { TuiRenderOutput } from '../component-registry/component-registry.types.ts'

export type TuiTerminalNodeLifecycle = 'streaming' | 'settled' | 'interrupted' | 'failed'
export type TuiComposerMode = 'idle' | 'streaming' | 'tool' | 'error'
export type TuiStatusMode = TuiComposerMode

export interface TuiTerminalComposerState {
  readonly text: string
  readonly cursor: number
  readonly lines: ReadonlyArray<string>
  readonly cursorLine: number
  readonly cursorColumn: number
  readonly mode: TuiComposerMode
}

export interface TuiTerminalStatusState {
  readonly sessionId: string | null
  readonly cwd: string | null
  readonly mode: TuiStatusMode
  readonly publicationRevision: number
  readonly message?: string
}

export interface TuiTerminalShellTranscriptCell {
  readonly nodeId: string
  readonly lifecycle: TuiTerminalNodeLifecycle
  readonly output: TuiRenderOutput
}

export interface TuiTerminalShellDescriptor {
  readonly contract: 'tui.terminal-shell.v1'
  readonly width: number
  readonly scrollOffset: number
  readonly transcript: ReadonlyArray<TuiTerminalShellTranscriptCell>
  readonly composer: TuiTerminalComposerState
  readonly status: TuiTerminalStatusState
}

export interface TuiInkTreeComposed {
  readonly nodeId: 'tui.shell'
  readonly kind: 'tui.shell'
  readonly publicationRevision: number
  readonly lifecycle: 'settled'
  readonly descriptor: TuiTerminalShellDescriptor
}
