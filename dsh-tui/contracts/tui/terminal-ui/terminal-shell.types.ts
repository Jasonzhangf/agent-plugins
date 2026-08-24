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
