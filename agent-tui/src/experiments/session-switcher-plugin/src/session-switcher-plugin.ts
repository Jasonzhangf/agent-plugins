import { Service, type Context } from '@deepseek-ai/cordis'
import {
  assertTuiSessionListResult,
  isTuiSessionSummary,
  type TuiRefreshRequestPublisher,
  type TuiSessionListFetcher,
  type TuiSessionSelectionIntent,
  type TuiSessionSelectionPublisher,
  type TuiSessionSwitcherFace,
  type TuiSelectorState,
  type TuiSessionSummary,
} from '../../../../contracts/tui/session-switcher-plugin/session-switcher-plugin.types.ts'

export const tuiSessionSwitcherName = 'tuiSessionSwitcher' as const

const EMPTY_STATE: TuiSelectorState = Object.freeze({
  kind: 'idle',
  list: Object.freeze([]) as ReadonlyArray<TuiSessionSummary>,
  filteredCount: 0,
  selectedSessionId: null,
  selectedIndex: -1,
  busy: false,
  errorMessage: null,
  requestRevision: 0,
})

function freezeState(state: TuiSelectorState): TuiSelectorState {
  return Object.freeze({
    ...state,
    list: Object.freeze([...state.list]) as ReadonlyArray<TuiSessionSummary>,
  })
}

export function resumeSessionLabel(summary: TuiSessionSummary, current: boolean): string {
  if (!isTuiSessionSummary(summary)) {
    throw new TypeError('session-switcher-plugin: summary must satisfy TuiSessionSummary')
  }
  const candidate = summary.title?.trim()
  const timestamp = new Date(summary.updatedAt).toISOString().slice(0, 16).replace('T', ' ')
  const description = candidate && candidate !== summary.sessionId
    ? candidate
    : `Updated ${timestamp} UTC`
  return `${current ? 'Current' : 'Recent'} · ${description}${summary.running ? ' · running' : ''}`
}

export interface TuiSessionSwitcherOptions {
  fetcher: TuiSessionListFetcher
  selectionPublisher?: TuiSessionSelectionPublisher
  refreshPublisher?: TuiRefreshRequestPublisher
  currentCwd: string
}

export class TuiSessionSwitcherService extends Service implements TuiSessionSwitcherFace {
  readonly name = tuiSessionSwitcherName
  private state: TuiSelectorState = EMPTY_STATE
  private readonly listeners = new Set<(state: TuiSelectorState) => void>()
  private disposed = false
  private nextRequestRevision = 1
  private readonly fetcher: TuiSessionListFetcher
  private readonly selectionPublisher: TuiSessionSelectionPublisher | undefined
  private readonly refreshPublisher: TuiRefreshRequestPublisher | undefined
  private readonly currentCwd: string

  constructor(private contextRef: Context, options: TuiSessionSwitcherOptions) {
    super(contextRef, tuiSessionSwitcherName)
    if (!options || typeof options !== 'object') {
      throw new TypeError('session-switcher-plugin: options are required')
    }
    if (!options.fetcher || typeof options.fetcher.listForCurrentCwd !== 'function') {
      throw new TypeError('session-switcher-plugin: options.fetcher.listForCurrentCwd must be a function')
    }
    if (typeof options.currentCwd !== 'string' || options.currentCwd.length === 0) {
      throw new TypeError('session-switcher-plugin: options.currentCwd must be a non-empty string')
    }
    this.fetcher = options.fetcher
    this.selectionPublisher = options.selectionPublisher ?? undefined
    this.refreshPublisher = options.refreshPublisher ?? undefined
    this.currentCwd = options.currentCwd
    contextRef.effect(() => () => this.dispose(), 'session-switcher-plugin.dispose')
  }

  startListing(sourceRevision: number): void {
    if (this.disposed) throw new Error('session-switcher-plugin: cannot start listing after disposed state')
    if (typeof sourceRevision !== 'number' || !Number.isInteger(sourceRevision) || sourceRevision < 0) {
      throw new TypeError('session-switcher-plugin: sourceRevision must be a non-negative safe integer')
    }
    const requestRevision = this.nextRequestRevision++
    this.transition({ ...this.state, kind: 'listing', busy: true, errorMessage: null, requestRevision })
    void this.fetcher
      .listForCurrentCwd(requestRevision)
      .then(result => {
        if (this.disposed) return
        if (result.requestRevision !== this.state.requestRevision) return
        assertTuiSessionListResult(result)
        const filtered = result.summaries.filter(summary => summary.cwd === this.currentCwd && summary.lifecycle !== 'terminated')
        const filteredCount = result.summaries.length - filtered.length
        this.transition(freezeState({
          kind: 'idle',
          list: filtered,
          filteredCount,
          selectedSessionId: this.state.selectedSessionId,
          selectedIndex: this.state.selectedIndex,
          busy: false,
          errorMessage: null,
          requestRevision,
        }))
      })
      .catch(error => {
        if (this.disposed) return
        if (requestRevision !== this.state.requestRevision) return
        const message = error instanceof Error ? error.message : 'session-switcher-plugin: list failed'
        this.transition(freezeState({
          kind: 'failed',
          list: Object.freeze([]) as ReadonlyArray<TuiSessionSummary>,
          filteredCount: 0,
          selectedSessionId: this.state.selectedSessionId,
          selectedIndex: -1,
          busy: false,
          errorMessage: message,
          requestRevision,
        }))
      })
  }

  select(summary: TuiSessionSummary, sourceRevision: number): TuiSessionSelectionIntent {
    if (this.disposed) {
      return Object.freeze({
        kind: 'rejected',
        code: 'disposed',
        message: 'session-switcher-plugin: disposed',
        sourceRevision,
      })
    }
    if (typeof sourceRevision !== 'number' || !Number.isInteger(sourceRevision) || sourceRevision < 0) {
      throw new TypeError('session-switcher-plugin: sourceRevision must be a non-negative safe integer')
    }
    if (!isTuiSessionSummary(summary)) {
      throw new TypeError('session-switcher-plugin: summary must satisfy TuiSessionSummary')
    }
    if (this.state.busy) {
      const intent: TuiSessionSelectionIntent = Object.freeze({
        kind: 'rejected',
        code: 'busy',
        message: 'session-switcher-plugin: selector is busy',
        sourceRevision,
      })
      this.publishSelection(intent)
      return intent
    }
    if (this.state.list.length === 0) {
      const intent: TuiSessionSelectionIntent = Object.freeze({
        kind: 'rejected',
        code: 'empty-list',
        message: 'session-switcher-plugin: selector has no summaries',
        sourceRevision,
      })
      this.publishSelection(intent)
      return intent
    }
    if (summary.cwd !== this.currentCwd) {
      const intent: TuiSessionSelectionIntent = Object.freeze({
        kind: 'rejected',
        code: 'mismatched-cwd',
        message: 'session-switcher-plugin: summary cwd does not match current cwd',
        sourceRevision,
      })
      this.publishSelection(intent)
      return intent
    }
    const intent: TuiSessionSelectionIntent = Object.freeze({
      kind: 'select',
      sessionId: summary.sessionId,
      cwd: summary.cwd,
      sourceRevision,
    })
    this.transition(freezeState({
      kind: 'succeeded',
      list: this.state.list,
      filteredCount: this.state.filteredCount,
      selectedSessionId: summary.sessionId,
      selectedIndex: this.state.list.findIndex(item => item.sessionId === summary.sessionId),
      busy: false,
      errorMessage: null,
      requestRevision: this.state.requestRevision,
    }))
    this.publishSelection(intent)
    if (this.refreshPublisher) {
      this.refreshPublisher.request({ sourceModuleId: 'session-switcher-plugin', reason: 'overlay', sourceRevision })
    }
    return intent
  }

  subscribe(listener: (state: TuiSelectorState) => void): () => void {
    if (this.disposed) throw new Error('session-switcher-plugin: cannot subscribe after disposed state')
    if (typeof listener !== 'function') throw new TypeError('session-switcher-plugin: listener must be a function')
    this.listeners.add(listener)
    listener(freezeState(this.state))
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  projectState(): TuiSelectorState {
    return freezeState(this.state)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.listeners.clear()
    void this.contextRef
  }

  private transition(next: TuiSelectorState): void {
    this.state = freezeState(next)
    for (const listener of [...this.listeners]) listener(this.state)
  }

  private publishSelection(intent: TuiSessionSelectionIntent): void {
    if (this.selectionPublisher) this.selectionPublisher.publish(intent)
  }
}

export function apply(ctx: Context, options: TuiSessionSwitcherOptions): void {
  ;(ctx as { tuiSessionSwitcher?: typeof ctx.tuiSessionSwitcher }).tuiSessionSwitcher = new TuiSessionSwitcherService(ctx, options)
}
