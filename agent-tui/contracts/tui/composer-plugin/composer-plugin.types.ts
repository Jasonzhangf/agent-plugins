export type TuiComposerMode = 'idle' | 'streaming' | 'tool' | 'error'

export interface TuiComposerState {
  readonly text: string
  readonly cursor: number
  readonly lines: ReadonlyArray<string>
  readonly cursorLine: number
  readonly cursorColumn: number
  readonly mode: TuiComposerMode
}

export interface TuiComposerLocalEcho {
  readonly echoId: string
  readonly text: string
  readonly state: 'pending' | 'failed'
}

export type TuiSubmitIntent =
  | {
      readonly kind: 'command'
      readonly text: string
      readonly sourceRevision: number
    }
  | {
      readonly kind: 'prompt'
      readonly text: string
      readonly localEchoId: string
      readonly sourceRevision: number
    }
  | {
      readonly kind: 'rejected'
      readonly code: 'empty' | 'not-eligible' | 'stale'
      readonly message: string
      readonly sourceRevision: number
    }

export type TuiComposerCancelInput =
  | { readonly key: 'ctrl-c'; readonly running: boolean; readonly sourceRevision: number }
  | { readonly key: 'ctrl-d'; readonly sourceRevision: number }

export type TuiCancelIntent =
  | { readonly kind: 'cancel'; readonly sourceRevision: number }
  | { readonly kind: 'exit'; readonly sourceRevision: number }
  | { readonly kind: 'rejected'; readonly code: 'idle' | 'non-empty'; readonly message: string; readonly sourceRevision: number }

export interface TuiOfficialUserEcho {
  readonly nodeId: string
  readonly text: string
  readonly publicationRevision: number
}

export interface TuiComposerSubmitEligibility {
  readonly sessionSelected: boolean
  readonly sourceRevision: number
}

export interface TuiComposerFace {
  readonly name: 'tuiComposer'
  emptyState(): TuiComposerState
  insertText(value: string): void
  newline(): void
  backspace(): void
  delete(): void
  moveLeft(): void
  moveRight(): void
  moveUp(): void
  moveDown(): void
  home(): void
  end(): void
  historyPrevious(): void
  historyNext(): void
  historyNavigating(): boolean
  clearText(): void
  setMode(mode: TuiComposerMode): void
  submit(eligibility: TuiComposerSubmitEligibility): TuiSubmitIntent
  cancel(input: TuiComposerCancelInput): TuiCancelIntent
  markSubmitted(localEchoId: string): void
  markSubmissionFailed(localEchoId: string, message: string): void
  attachOfficialEcho(event: unknown): boolean
  pendingEchoes(): ReadonlyArray<TuiComposerLocalEcho>
  failedEchoes(): ReadonlyArray<TuiComposerLocalEcho>
  setLatestPresentationRevision(revision: number): void
  projectState(): TuiComposerState
  subscribe(listener: (state: TuiComposerState) => void): () => void
  dispose(): void
}

export function assertTuiComposerMode(value: unknown): asserts value is TuiComposerMode {
  if (value !== 'idle' && value !== 'streaming' && value !== 'tool' && value !== 'error') {
    throw new TypeError('composer-plugin: mode must be a closed supported mode')
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly tuiComposer?: TuiComposerFace
  }
}
