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

export interface TuiTerminalOverlayState {
  readonly view: 'overlay.help' | 'selector.resume-current-cwd'
  readonly title: string
  readonly items: ReadonlyArray<string>
  readonly selectedIndex: number
}

export interface TuiTerminalLocalEchoState {
  readonly echoId: string
  readonly text: string
  readonly state: 'pending' | 'failed'
}

export interface TuiTerminalShellTranscriptCell {
  readonly nodeId: string
  readonly lifecycle: TuiTerminalNodeLifecycle
  readonly output: TuiRenderOutput
}

export interface TuiTerminalNode {
  readonly nodeId: string
  readonly kind: string
  readonly publicationRevision: number
  readonly lifecycle: TuiTerminalNodeLifecycle
  readonly value: Readonly<Record<string, unknown>>
}

export interface TuiTerminalModel {
  readonly nodes: ReadonlyArray<TuiTerminalNode>
  readonly publicationRevision: number
}

export interface TuiTerminalUiCompositionFace {
  composeInkTree(input: {
    readonly model: TuiTerminalModel
    readonly composer?: TuiTerminalComposerState
    readonly status?: TuiTerminalStatusState
    readonly width?: number
    readonly scrollOffset?: number
    readonly localEchoes?: readonly TuiTerminalLocalEchoState[]
    readonly overlay?: TuiTerminalOverlayState
  }): TuiInkTreeComposed
}

export interface TuiTerminalShellDescriptor {
  readonly contract: 'tui.terminal-shell.v1'
  readonly width: number
  readonly scrollOffset: number
  readonly transcript: ReadonlyArray<TuiTerminalShellTranscriptCell>
  readonly localEchoes: ReadonlyArray<TuiTerminalLocalEchoState>
  readonly composer: TuiTerminalComposerState
  readonly status: TuiTerminalStatusState
  readonly overlay?: TuiTerminalOverlayState
}

export interface TuiInkTreeComposed {
  readonly nodeId: 'tui.shell'
  readonly kind: 'tui.shell'
  readonly publicationRevision: number
  readonly lifecycle: 'settled'
  readonly descriptor: TuiTerminalShellDescriptor
}

export type TuiTerminalCompositionErrorCode =
  | 'invalid-model'
  | 'invalid-composer'
  | 'invalid-status'
  | 'invalid-dimension'
  | 'invalid-scroll-offset'
  | 'invalid-overlay'
  | 'invalid-local-echo'

export interface TuiTerminalCompositionError {
  readonly code: TuiTerminalCompositionErrorCode
  readonly message: string
  readonly cause: Error
}

export type TuiTerminalCompositionResult =
  | { readonly ok: true; readonly value: TuiInkTreeComposed }
  | { readonly ok: false; readonly error: TuiTerminalCompositionError }
