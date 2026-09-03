import { Service, type Context } from '@deepseek-ai/cordis'
import {
  assertTuiComposerMode,
  type TuiCancelIntent,
  type TuiComposerFace,
  type TuiComposerLocalEcho,
  type TuiComposerMode,
  type TuiComposerState,
  type TuiOfficialUserEcho,
  type TuiSubmitIntent,
} from '../../../../contracts/tui/composer-plugin/composer-plugin.types.ts'

export const tuiComposerName = 'tuiComposer' as const

function derive(text: string, cursor: number, mode: TuiComposerMode): TuiComposerState {
  const before = text.slice(0, cursor)
  const cursorLine = before.split('\n').length - 1
  const cursorColumn = before.length - before.lastIndexOf('\n') - 1
  return Object.freeze({
    text,
    cursor,
    lines: Object.freeze(text.split('\n')),
    cursorLine,
    cursorColumn,
    mode,
  })
}

function sameState(left: TuiComposerState, right: TuiComposerState): boolean {
  return left.text === right.text && left.cursor === right.cursor && left.mode === right.mode
}

export class TuiComposerService extends Service implements TuiComposerFace {
  readonly name = tuiComposerName
  private state: TuiComposerState = derive('', 0, 'idle')
  private echoes: ReadonlyArray<(TuiComposerLocalEcho & { readonly afterRevision: number }) | (Omit<TuiComposerLocalEcho, 'state'> & { readonly afterRevision: number; readonly state: 'submitted' })> = Object.freeze([])
  private readonly listeners = new Set<(state: TuiComposerState) => void>()
  private disposed = false
  private latestRevision = 0
  private echoSequence = 0
  private history: string[] = []
  private historyIndex: number | null = null
  private historyDraft = ''
  private readonly consumedOfficialNodeIds = new Set<string>()

  constructor(private contextRef: Context) {
    super(contextRef, tuiComposerName)
    contextRef.effect(() => () => this.dispose(), 'composer-plugin.dispose')
  }

  emptyState(): TuiComposerState {
    return derive('', 0, this.state.mode)
  }

  insertText(value: string): void {
    this.assertEditable()
    if (typeof value !== 'string') throw new TypeError('composer-plugin: insert value must be a string')
    this.leaveHistoryNavigation()
    const cursor = this.state.cursor
    const text = this.state.text.slice(0, cursor) + value + this.state.text.slice(cursor)
    this.transition(derive(text, cursor + value.length, this.state.mode))
  }

  newline(): void {
    this.insertText('\n')
  }

  backspace(): void {
    this.assertEditable()
    if (this.state.cursor === 0) return
    this.leaveHistoryNavigation()
    const text = this.state.text.slice(0, this.state.cursor - 1) + this.state.text.slice(this.state.cursor)
    this.transition(derive(text, this.state.cursor - 1, this.state.mode))
  }

  delete(): void {
    this.assertEditable()
    if (this.state.cursor >= this.state.text.length) return
    this.leaveHistoryNavigation()
    const text = this.state.text.slice(0, this.state.cursor) + this.state.text.slice(this.state.cursor + 1)
    this.transition(derive(text, this.state.cursor, this.state.mode))
  }

  moveLeft(): void {
    this.assertEditable()
    if (this.state.cursor === 0) return
    this.leaveHistoryNavigation()
    this.transition(derive(this.state.text, this.state.cursor - 1, this.state.mode))
  }

  moveRight(): void {
    this.assertEditable()
    if (this.state.cursor >= this.state.text.length) return
    this.leaveHistoryNavigation()
    this.transition(derive(this.state.text, this.state.cursor + 1, this.state.mode))
  }

  home(): void {
    this.assertEditable()
    this.leaveHistoryNavigation()
    this.transition(derive(this.state.text, this.state.text.lastIndexOf('\n', this.state.cursor - 1) + 1, this.state.mode))
  }

  end(): void {
    this.assertEditable()
    this.leaveHistoryNavigation()
    const nextNewline = this.state.text.indexOf('\n', this.state.cursor)
    const lineEnd = nextNewline === -1 ? this.state.text.length : nextNewline
    this.transition(derive(this.state.text, lineEnd, this.state.mode))
  }

  historyPrevious(): void {
    this.assertEditable()
    if (this.history.length === 0) return
    if (this.historyIndex === null) {
      this.historyDraft = this.state.text
      this.historyIndex = this.history.length - 1
    } else if (this.historyIndex > 0) {
      this.historyIndex -= 1
    }
    const value = this.history[this.historyIndex] ?? ''
    this.transition(derive(value, value.length, this.state.mode))
  }

  historyNext(): void {
    this.assertEditable()
    if (this.historyIndex === null) return
    if (this.historyIndex >= this.history.length - 1) {
      this.historyIndex = null
      this.transition(derive(this.historyDraft, this.historyDraft.length, this.state.mode))
      return
    }
    this.historyIndex += 1
    const value = this.history[this.historyIndex] ?? ''
    this.transition(derive(value, value.length, this.state.mode))
  }

  historyNavigating(): boolean {
    return this.historyIndex !== null
  }

  moveUp(): void {
    this.assertEditable()
    if (this.state.cursorLine === 0) return
    const lines = this.state.lines
    const targetLine = lines[this.state.cursorLine - 1] ?? ''
    const column = Math.min(this.state.cursorColumn, targetLine.length)
    const cursor = lines.slice(0, this.state.cursorLine - 1).reduce((offset, line) => offset + line.length + 1, 0) + column
    this.transition(derive(this.state.text, cursor, this.state.mode))
  }

  moveDown(): void {
    this.assertEditable()
    if (this.state.cursorLine >= this.state.lines.length - 1) return
    const lines = this.state.lines
    const targetLine = lines[this.state.cursorLine + 1] ?? ''
    const column = Math.min(this.state.cursorColumn, targetLine.length)
    const cursor = lines.slice(0, this.state.cursorLine + 1).reduce((offset, line) => offset + line.length + 1, 0) + column
    this.transition(derive(this.state.text, cursor, this.state.mode))
  }

  clearText(): void {
    this.assertEditable()
    this.leaveHistoryNavigation()
    this.transition(derive('', 0, this.state.mode))
  }

  setMode(value: unknown): void {
    assertTuiComposerMode(value)
    this.transition(derive(this.state.text, this.state.cursor, value))
  }

  submit(eligibility: unknown): TuiSubmitIntent {
    if (this.disposed) throw new Error('composer-plugin: cannot submit after disposed state')
    if (!eligibility || typeof eligibility !== 'object') {
      throw new TypeError('composer-plugin: eligibility must be an object')
    }
    const record = eligibility as Record<string, unknown>
    const allowed = ['sessionSelected', 'sourceRevision']
    for (const key of Object.keys(record)) {
      if (!allowed.includes(key)) throw new TypeError(`composer-plugin: unexpected eligibility field '${key}'`)
    }
    if (typeof record['sessionSelected'] !== 'boolean') {
      throw new TypeError('composer-plugin: malformed sessionSelected flag')
    }
    if (typeof record['sourceRevision'] !== 'number' || !Number.isSafeInteger(record['sourceRevision']) || record['sourceRevision'] < 0) {
      throw new TypeError('composer-plugin: sourceRevision must be a non-negative safe integer')
    }
    const sourceRevision = record['sourceRevision']
    if (sourceRevision < this.latestRevision) {
      return Object.freeze({
        kind: 'rejected',
        code: 'stale',
        message: `composer-plugin: stale revision ${String(sourceRevision)}; latest is ${String(this.latestRevision)}`,
        sourceRevision,
      })
    }
    const text = this.state.text.trim()
    if (text.length === 0) {
      return Object.freeze({ kind: 'rejected', code: 'empty', message: 'composer-plugin: text is empty', sourceRevision })
    }
    this.latestRevision = sourceRevision
    if (text.startsWith('/')) {
      this.remember(text)
      const intent: TuiSubmitIntent = Object.freeze({ kind: 'command', text, sourceRevision })
      this.clearText()
      return intent
    }
    if (!record['sessionSelected']) {
      return Object.freeze({ kind: 'rejected', code: 'not-eligible', message: 'composer-plugin: Session is not selected', sourceRevision })
    }
    const submittedText = this.state.text
    this.echoSequence += 1
    this.remember(submittedText)
    const echoId = `local-${String(this.echoSequence)}`
    this.echoes = Object.freeze([...this.echoes, Object.freeze({
      echoId,
      text: submittedText,
      state: 'pending',
      afterRevision: this.latestPresentationRevision,
    })])
    const intent: TuiSubmitIntent = Object.freeze({ kind: 'prompt', text: submittedText, localEchoId: echoId, sourceRevision })
    this.clearText()
    return intent
  }

  cancel(input: unknown): TuiCancelIntent {
    if (this.disposed) throw new Error('composer-plugin: cannot cancel after disposed state')
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('composer-plugin: cancel input must be an object')
    }
    const record = input as Record<string, unknown>
    if (record['key'] !== 'ctrl-c' && record['key'] !== 'ctrl-d') {
      throw new TypeError('composer-plugin: cancel key must be ctrl-c or ctrl-d')
    }
    const keys = Object.keys(record)
    if (record['key'] === 'ctrl-c'
      ? keys.length !== 3 || !keys.includes('running') || !keys.includes('sourceRevision')
      : keys.length !== 2 || !keys.includes('sourceRevision')) {
      throw new TypeError('composer-plugin: malformed cancel input fields')
    }
    if (typeof record['sourceRevision'] !== 'number' || !Number.isSafeInteger(record['sourceRevision']) || record['sourceRevision'] < 0) {
      throw new TypeError('composer-plugin: sourceRevision must be a non-negative safe integer')
    }
    const sourceRevision = record['sourceRevision']
    if (record['key'] === 'ctrl-c') {
      if (typeof record['running'] !== 'boolean') {
        throw new TypeError('composer-plugin: cancel running flag must be boolean')
      }
      if (record['running']) return Object.freeze({ kind: 'cancel', sourceRevision })
      // Idle Ctrl+C is not a composer cancellation; app-shell owns exit policy.
      return Object.freeze({
        kind: 'rejected',
        code: 'idle',
        message: 'composer-plugin: nothing to cancel while idle',
        sourceRevision,
      })
    }
    if (this.state.text.length === 0) return Object.freeze({ kind: 'exit', sourceRevision })
    return Object.freeze({
      kind: 'rejected',
      code: 'non-empty',
      message: 'composer-plugin: Ctrl+D requires empty composer',
      sourceRevision,
    })
  }

  markSubmitted(localEchoId: unknown): void {
    this.assertEchoId(localEchoId)
    this.echoes = this.echoes.filter(echo => echo.echoId !== localEchoId)
  }

  markSubmissionFailed(localEchoId: unknown, message: unknown): void {
    this.assertEchoId(localEchoId)
    if (typeof message !== 'string' || message.length === 0) {
      throw new TypeError('composer-plugin: failure message must be a non-empty string')
    }
    this.echoes = Object.freeze(this.echoes.map(echo =>
      echo.echoId === localEchoId ? Object.freeze({ ...echo, state: 'failed' }) : echo))
  }

  attachOfficialEcho(event: unknown): boolean {
    if (this.disposed) throw new Error('composer-plugin: cannot converge after disposed state')
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new TypeError('composer-plugin: official echo must be an object')
    }
    const record = event as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length !== 3 || !keys.includes('nodeId') || !keys.includes('text') || !keys.includes('publicationRevision')) {
      throw new TypeError('composer-plugin: malformed official user echo fields')
    }
    if (typeof record['nodeId'] !== 'string' || record['nodeId'].length === 0
      || typeof record['text'] !== 'string'
      || typeof record['publicationRevision'] !== 'number'
      || !Number.isSafeInteger(record['publicationRevision'])) {
      throw new TypeError('composer-plugin: invalid official user echo values')
    }
    const official = record as unknown as TuiOfficialUserEcho
    if (this.consumedOfficialNodeIds.has(official.nodeId)) return false
    const matchIndex = this.echoes.findIndex(echo =>
      echo.state === 'pending'
      && echo.afterRevision <= official.publicationRevision
      && echo.text === official.text)
    if (matchIndex >= 0) {
      this.consumedOfficialNodeIds.add(official.nodeId)
      this.echoes = Object.freeze(this.echoes.map((echo, index) =>
        index === matchIndex ? Object.freeze({ ...echo, state: 'submitted' }) : echo))
    }
    return matchIndex >= 0
  }

  pendingEchoes(): ReadonlyArray<TuiComposerLocalEcho> {
    return Object.freeze(this.echoes.filter(echo => echo.state === 'pending')
      .map(echo => ({ echoId: echo.echoId, text: echo.text, state: 'pending' as const })))
  }

  failedEchoes(): ReadonlyArray<TuiComposerLocalEcho> {
    return Object.freeze(this.echoes.filter(echo => echo.state === 'failed')
      .map(echo => ({ echoId: echo.echoId, text: echo.text, state: 'failed' as const })))
  }

  projectState(): TuiComposerState {
    return this.state
  }

  subscribe(listener: (state: TuiComposerState) => void): () => void {
    if (this.disposed) throw new Error('composer-plugin: cannot subscribe after disposed state')
    if (typeof listener !== 'function') throw new TypeError('composer-plugin: listener must be a function')
    this.listeners.add(listener)
    listener(this.state)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.listeners.clear()
    this.echoes = Object.freeze([])
    this.consumedOfficialNodeIds.clear()
    void this.contextRef
  }

  setLatestPresentationRevision(revision: number): void {
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
      throw new TypeError('composer-plugin: presentation revision must be a non-negative safe integer')
    }
    this.latestPresentationRevision = revision
  }

  private latestPresentationRevision = -1

  private assertEditable(): void {
    if (this.disposed) throw new Error('composer-plugin: cannot edit after disposed state')
  }

  private assertEchoId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError('composer-plugin: localEchoId must be a non-empty string')
    }
    if (this.disposed) throw new Error('composer-plugin: disposed')
    if (!this.echoes.some(echo => echo.echoId === value)) {
      throw new Error(`composer-plugin: duplicate or unknown local echo ${value}`)
    }
  }

  private transition(next: TuiComposerState): void {
    if (sameState(this.state, next)) return
    this.state = next
    for (const listener of [...this.listeners]) listener(this.state)
  }

  private remember(text: string): void {
    this.history = [...this.history.filter(item => item !== text), text]
    this.historyIndex = null
    this.historyDraft = ''
  }

  private leaveHistoryNavigation(): void {
    this.historyIndex = null
    this.historyDraft = ''
  }
}

export function apply(ctx: Context): void {
  ;(ctx as { tuiComposer?: typeof ctx.tuiComposer }).tuiComposer = new TuiComposerService(ctx)
}
