export type TuiDisplayControlMode = 'detached' | 'persistent' | 'live'

export type TuiDisplayControlEvent =
  | { readonly kind: 'attach' }
  | { readonly kind: 'persistent'; readonly sourceRevision: number }
  | { readonly kind: 'live'; readonly sourceRevision: number; readonly timeoutMs: number }
  | { readonly kind: 'dismiss' }

export interface TuiDisplayControlState {
  readonly mode: TuiDisplayControlMode
  readonly revision: number
  readonly lastTransitionAt: number
  readonly expiresAt?: number
  readonly sourceRevision?: number
}

export interface TuiDisplayControlLifecycle {
  readonly controlId: string
  readonly state: TuiDisplayControlState
  attach(): TuiDisplayControlState
  setPersistent(sourceRevision: number): TuiDisplayControlState
  showLive(sourceRevision: number, timeoutMs: number): TuiDisplayControlState
  dismissLive(): TuiDisplayControlState
  touch(sourceRevision: number, timeoutMs: number): TuiDisplayControlState
  subscribe(listener: (state: TuiDisplayControlState) => void): () => void
  dispose(): void
}

export interface TuiDisplayControlServiceFace {
  readonly name: 'tuiDisplayControl'
  create(controlId: string): TuiDisplayControlLifecycle
  get(controlId: string): TuiDisplayControlLifecycle | null
  list(): readonly string[]
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiDisplayControl: TuiDisplayControlServiceFace
  }
}

export function isTuiDisplayControlMode(value: unknown): value is TuiDisplayControlMode {
  return value === 'detached' || value === 'persistent' || value === 'live'
}

export function assertTuiDisplayControlId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('display-control: controlId must be a non-empty string')
  }
}

export function assertTuiDisplayControlEvent(value: unknown): asserts value is TuiDisplayControlEvent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('display-control: event must be a plain object')
  }
  const record = value as Record<string, unknown>
  if (Object.getPrototypeOf(record) !== Object.prototype) {
    throw new TypeError('display-control: event must be a plain object')
  }
  const allowed = new Set(['kind', 'sourceRevision', 'timeoutMs'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new TypeError(`display-control: unknown event field '${key}'`)
  }
  switch (record.kind) {
    case 'attach':
      if (Reflect.ownKeys(record).length !== 1) throw new TypeError('display-control: attach event is closed')
      return
    case 'persistent':
      if (Reflect.ownKeys(record).length !== 2) throw new TypeError('display-control: persistent event is closed')
      assertRevision(record['sourceRevision'])
      return
    case 'live':
      if (Reflect.ownKeys(record).length !== 3) throw new TypeError('display-control: live event is closed')
      assertRevision(record['sourceRevision'])
      assertTimeout(record['timeoutMs'])
      return
    case 'dismiss':
      if (Reflect.ownKeys(record).length !== 1) throw new TypeError('display-control: dismiss event is closed')
      return
    default:
      throw new TypeError(`display-control: unknown event kind '${String(record.kind)}'`)
  }
}

export function assertTuiDisplayControlState(value: unknown): asserts value is TuiDisplayControlState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('display-control: state must be a frozen plain object')
  }
  if (!Object.isFrozen(value)) throw new TypeError('display-control: state must be frozen')
  const record = value as Record<string, unknown>
  const allowed = new Set(['mode', 'revision', 'lastTransitionAt', 'expiresAt', 'sourceRevision'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new TypeError(`display-control: unknown state field '${key}'`)
  }
  if (!isTuiDisplayControlMode(record['mode'])) throw new TypeError('display-control: invalid mode')
  assertRevision(record['revision'])
  assertTime(record['lastTransitionAt'])
  if (record['expiresAt'] !== undefined) assertTime(record['expiresAt'])
  if (record['sourceRevision'] !== undefined) assertRevision(record['sourceRevision'])
  if (record['mode'] !== 'live' && record['expiresAt'] !== undefined) {
    throw new TypeError('display-control: only live state may carry expiresAt')
  }
  if (record['mode'] === 'live' && record['expiresAt'] === undefined) {
    throw new TypeError('display-control: live state requires expiresAt')
  }
  if (record['mode'] === 'detached' && record['sourceRevision'] !== undefined) {
    throw new TypeError('display-control: detached state cannot carry sourceRevision')
  }
}

function assertRevision(value: unknown): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('display-control: sourceRevision must be a non-negative safe integer')
  }
}

function assertTimeout(value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError('display-control: timeoutMs must be a positive finite number')
  }
}

function assertTime(value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError('display-control: timestamp must be a non-negative finite number')
  }
}
