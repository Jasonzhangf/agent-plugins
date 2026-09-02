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
  readonly view: 'fatal' | 'approval-question' | 'selector.resume-current-cwd' | 'command' | 'queue' | 'overlay.jobs' | 'overlay.trajectory' | 'overlay.help' | 'interaction.approval' | 'interaction.question' | 'selector.model' | 'selector.provider' | 'selector.permission' | 'selector.fork-history' | 'selector.workspaces' | 'selector.subagents' | 'selector.session-search'
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
