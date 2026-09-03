export interface TuiSessionSummary {
  readonly sessionId: string
  readonly cwd: string
  readonly running: boolean
  readonly updatedAt: number
  readonly title: string | null
  readonly lifecycle: 'idle' | 'running' | 'failed' | 'terminated'
}

export interface TuiSessionListResult {
  readonly summaries: readonly TuiSessionSummary[]
  readonly filteredCount: number
  readonly requestRevision: number
}

export type TuiSessionListFailure =
  | { readonly kind: 'host-unreachable'; readonly message: string }
  | { readonly kind: 'invalid-response'; readonly message: string }
  | { readonly kind: 'stale-revision'; readonly latestRequestRevision: number }
  | { readonly kind: 'disposed' }

export type TuiSessionSelectionIntent =
  | {
      readonly kind: 'select'
      readonly sessionId: string
      readonly cwd: string
      readonly sourceRevision: number
    }
  | {
      readonly kind: 'rejected'
      readonly code: 'empty-list' | 'invalid-summary' | 'mismatched-cwd' | 'stale' | 'disposed' | 'busy'
      readonly message: string
      readonly sourceRevision: number
    }

export type TuiSelectorStateKind =
  | 'idle'
  | 'listing'
  | 'selecting'
  | 'succeeded'
  | 'failed'

export interface TuiSelectorState {
  readonly kind: TuiSelectorStateKind
  readonly list: readonly TuiSessionSummary[]
  readonly filteredCount: number
  readonly selectedSessionId: string | null
  readonly selectedIndex: number
  readonly busy: boolean
  readonly errorMessage: string | null
  readonly requestRevision: number
}

export interface TuiSessionListFetcher {
  listForCurrentCwd(requestRevision: number): Promise<TuiSessionListResult>
}

export interface TuiSessionSelectionPublisher {
  publish(intent: TuiSessionSelectionIntent): void
}

export interface TuiRefreshRequestPublisher {
  request(intent: { readonly sourceModuleId: 'session-switcher-plugin'; readonly reason: 'overlay'; readonly sourceRevision: number }): void
}

export interface TuiSessionSwitcherFace {
  readonly name: 'tuiSessionSwitcher'
  startListing(sourceRevision: number): void
  select(summary: TuiSessionSummary, sourceRevision: number): TuiSessionSelectionIntent
  subscribe(listener: (state: TuiSelectorState) => void): () => void
  projectState(): TuiSelectorState
  dispose(): void
}

export function isTuiSessionSummary(value: unknown): value is TuiSessionSummary {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record['sessionId'] !== 'string' || record['sessionId'].length === 0) return false
  if (typeof record['cwd'] !== 'string' || record['cwd'].length === 0) return false
  if (typeof record['running'] !== 'boolean') return false
  if (typeof record['updatedAt'] !== 'number'
    || !Number.isSafeInteger(record['updatedAt'])
    || record['updatedAt'] < 0
    || !Number.isFinite(new Date(record['updatedAt']).getTime())) return false
  if (typeof record['lifecycle'] !== 'string') return false
  if (record['lifecycle'] !== 'idle' && record['lifecycle'] !== 'running' && record['lifecycle'] !== 'failed' && record['lifecycle'] !== 'terminated') return false
  if (record['title'] !== null && typeof record['title'] !== 'string') return false
  return true
}

export function assertTuiSessionListResult(value: unknown): asserts value is TuiSessionListResult {
  if (!value || typeof value !== 'object') {
    throw new TypeError('session-switcher-plugin: list result must be an object')
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record['summaries'])) {
    throw new TypeError('session-switcher-plugin: list result summaries must be an array')
  }
  for (const summary of record['summaries']) {
    if (!isTuiSessionSummary(summary)) {
      throw new TypeError('session-switcher-plugin: list result contains invalid summary')
    }
  }
  if (typeof record['filteredCount'] !== 'number' || !Number.isInteger(record['filteredCount']) || record['filteredCount'] < 0) {
    throw new TypeError('session-switcher-plugin: list result filteredCount must be a non-negative safe integer')
  }
  if (typeof record['requestRevision'] !== 'number' || !Number.isInteger(record['requestRevision']) || record['requestRevision'] < 0) {
    throw new TypeError('session-switcher-plugin: list result requestRevision must be a non-negative safe integer')
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly tuiSessionSwitcher?: TuiSessionSwitcherFace
  }
}
