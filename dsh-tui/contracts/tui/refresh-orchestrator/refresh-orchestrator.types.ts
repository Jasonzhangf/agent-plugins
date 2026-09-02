export type TuiRefreshSourceModuleId =
  | 'app-shell'
  | 'app-container'
  | 'presentation'
  | 'logic-controls'
  | 'chrome-slot-registry'
  | 'tui-logo'
  | 'tui-connection'
  | 'tui-session'
  | 'tui-status'
  | 'tui-execution'
  | 'slash-command-plugin'
  | 'session-switcher-plugin'
  | 'overlay-manager-plugin'
  | 'composer-plugin'
  | 'status-footer-plugin'

export type TuiRefreshReason =
  | 'presentation'
  | 'logic-control'
  | 'chrome-slot'
  | 'composer'
  | 'overlay'
  | 'viewport'
  | 'error'

export type TuiRefreshRevision = number

export interface TuiRefreshIntent {
  readonly sourceModuleId: TuiRefreshSourceModuleId
  readonly reason: TuiRefreshReason
  readonly sourceRevision: TuiRefreshRevision
}

export interface TuiRefreshPublication {
  readonly publicationRevision: TuiRefreshRevision
  readonly causes: readonly TuiRefreshIntent[]
}

export type TuiRefreshRequestResult =
  | { readonly status: 'queued' }
  | { readonly status: 'coalesced' }
  | { readonly status: 'rejected'; readonly reason: 'stale' | 'disposed'; readonly message: string }

export interface TuiRefreshOrchestratorFace {
  readonly name: 'tuiRefreshOrchestrator'
  request(intent: TuiRefreshIntent): TuiRefreshRequestResult
  subscribe(listener: (publication: TuiRefreshPublication) => void): () => void
  dispose(): void
}

export const tuiRefreshSourceModuleIds = Object.freeze([
  'app-shell',
  'app-container',
  'presentation',
  'logic-controls',
  'chrome-slot-registry',
  'tui-logo',
  'tui-connection',
  'tui-session',
  'tui-status',
  'tui-execution',
  'slash-command-plugin',
  'session-switcher-plugin',
  'overlay-manager-plugin',
  'composer-plugin',
  'status-footer-plugin',
] as const satisfies ReadonlyArray<TuiRefreshSourceModuleId>)

export const tuiRefreshReasons = Object.freeze([
  'presentation',
  'logic-control',
  'chrome-slot',
  'composer',
  'overlay',
  'viewport',
  'error',
] as const satisfies ReadonlyArray<TuiRefreshReason>)

export function isTuiRefreshSourceModuleId(value: unknown): value is TuiRefreshSourceModuleId {
  return typeof value === 'string' && (tuiRefreshSourceModuleIds as readonly string[]).includes(value)
}

export function isTuiRefreshReason(value: unknown): value is TuiRefreshReason {
  return typeof value === 'string' && (tuiRefreshReasons as readonly string[]).includes(value)
}

function assertClosedIntent(value: unknown): asserts value is TuiRefreshIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('refresh-orchestrator: intent must be an object')
  }
  const record = value as Record<string, unknown>
  if (Reflect.ownKeys(value).length !== 3
    || Reflect.ownKeys(value).some(key => key !== 'sourceModuleId' && key !== 'reason' && key !== 'sourceRevision')) {
    throw new TypeError('refresh-orchestrator: invalid closed intent contract')
  }
  if (!isTuiRefreshSourceModuleId(record['sourceModuleId'])) {
    throw new TypeError(`refresh-orchestrator: unknown source ${String(record['sourceModuleId'])}`)
  }
  if (!isTuiRefreshReason(record['reason'])) {
    throw new TypeError(`refresh-orchestrator: unknown reason ${String(record['reason'])}`)
  }
  if (typeof record['sourceRevision'] !== 'number' || !Number.isSafeInteger(record['sourceRevision']) || record['sourceRevision'] < 0) {
    throw new TypeError('refresh-orchestrator: sourceRevision must be a non-negative safe integer')
  }
}

export function assertTuiRefreshIntent(value: unknown): asserts value is TuiRefreshIntent {
  assertClosedIntent(value)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiRefreshOrchestrator: TuiRefreshOrchestratorFace
  }
}
