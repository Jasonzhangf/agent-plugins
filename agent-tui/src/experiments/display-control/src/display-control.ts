import { Service, type Context } from '@deepseek-ai/cordis'
import {
  assertTuiDisplayControlEvent,
  assertTuiDisplayControlId,
  assertTuiDisplayControlState,
  type TuiDisplayControlLifecycle,
  type TuiDisplayControlServiceFace,
  type TuiDisplayControlState,
} from '../../../../contracts/tui/display-control/display-control.types.ts'

export const tuiDisplayControlServiceName = 'tuiDisplayControl' as const

export interface TuiDisplayControlScheduler {
  setTimeout(callback: () => void, timeoutMs: number): unknown
  clearTimeout(handle: unknown): void
  now(): number
}

const DEFAULT_SCHEDULER: TuiDisplayControlScheduler = Object.freeze({
  setTimeout: (callback: () => void, timeoutMs: number) => setTimeout(callback, timeoutMs),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
})

function initialState(controlId: string): TuiDisplayControlState {
  return Object.freeze({
    mode: 'detached',
    revision: 0,
    lastTransitionAt: 0,
  })
}

function nextState(
  current: TuiDisplayControlState,
  mode: TuiDisplayControlState['mode'],
  now: number,
  sourceRevision?: number,
  timeoutMs?: number,
): TuiDisplayControlState {
  const base: TuiDisplayControlState = Object.freeze({
    mode,
    revision: current.revision + 1,
    lastTransitionAt: now,
    ...(sourceRevision === undefined ? {} : { sourceRevision }),
  })
  if (mode !== 'live') return base
  if (timeoutMs === undefined) throw new TypeError('display-control: live transition requires timeoutMs')
  return Object.freeze({
    ...base,
    expiresAt: now + timeoutMs,
  })
}

export class TuiDisplayControlService extends Service implements TuiDisplayControlServiceFace {
  readonly name = tuiDisplayControlServiceName
  private readonly controls = new Map<string, TuiDisplayControlLifecycle>()
  private disposed = false

  constructor(
    private readonly context: Context,
    private readonly scheduler: TuiDisplayControlScheduler = DEFAULT_SCHEDULER,
  ) {
    super(context, tuiDisplayControlServiceName)
    context.effect(() => () => this.dispose(), 'display-control.dispose')
  }

  create(controlId: string): TuiDisplayControlLifecycle {
    if (this.disposed) throw new Error('display-control: disposed')
    assertTuiDisplayControlId(controlId)
    if (this.controls.has(controlId)) {
      throw new Error(`display-control: duplicate control '${controlId}'`)
    }
    const lifecycle = createDisplayControlLifecycle(
      controlId,
      this.scheduler,
      () => {
        if (this.controls.get(controlId) === lifecycle) this.controls.delete(controlId)
      },
    )
    this.controls.set(controlId, lifecycle)
    return lifecycle
  }

  get(controlId: string): TuiDisplayControlLifecycle | null {
    if (this.disposed) return null
    assertTuiDisplayControlId(controlId)
    return this.controls.get(controlId) ?? null
  }

  list(): readonly string[] {
    return Object.freeze([...this.controls.keys()])
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const lifecycle of this.controls.values()) lifecycle.dispose()
    this.controls.clear()
  }
}

export function createDisplayControlLifecycle(
  controlId: string,
  scheduler: TuiDisplayControlScheduler,
  onDispose?: () => void,
): TuiDisplayControlLifecycle {
  let current = initialState(controlId)
  let persistentRevision: number | null = null
  let disposed = false
  let timerHandle: unknown | null = null
  const listeners = new Set<(state: TuiDisplayControlState) => void>()

  function clearTimer(): void {
    if (timerHandle === null) return
    scheduler.clearTimeout(timerHandle)
    timerHandle = null
  }

  function scheduleExpiry(timeoutMs: number): void {
    clearTimer()
    timerHandle = scheduler.setTimeout(() => {
      timerHandle = null
      if (disposed || current.mode !== 'live') return
      const persistent = persistentRevision
      current = nextState(
        current,
        'persistent',
        scheduler.now(),
        persistent === null ? undefined : persistent,
      )
      publish()
    }, timeoutMs)
  }

  function publish(): TuiDisplayControlState {
    assertTuiDisplayControlState(current)
    for (const listener of [...listeners]) listener(current)
    return current
  }

  function transition(
    mode: TuiDisplayControlState['mode'],
    sourceRevision?: number,
    timeoutMs?: number,
  ): TuiDisplayControlState {
    if (disposed) throw new Error(`display-control: ${controlId} disposed`)
    current = nextState(current, mode, scheduler.now(), sourceRevision, timeoutMs)
    return publish()
  }

  return Object.freeze({
    controlId,
    get state(): TuiDisplayControlState {
      return current
    },
    attach(): TuiDisplayControlState {
      return transition('persistent')
    },
    setPersistent(sourceRevision: number): TuiDisplayControlState {
      if (typeof sourceRevision !== 'number' || !Number.isSafeInteger(sourceRevision) || sourceRevision < 0) {
        throw new TypeError('display-control: sourceRevision must be a non-negative safe integer')
      }
      clearTimer()
      persistentRevision = sourceRevision
      return transition('persistent', sourceRevision)
    },
    showLive(sourceRevision: number, timeoutMs: number): TuiDisplayControlState {
      if (typeof sourceRevision !== 'number' || !Number.isSafeInteger(sourceRevision) || sourceRevision < 0) {
        throw new TypeError('display-control: sourceRevision must be a non-negative safe integer')
      }
      if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new TypeError('display-control: timeoutMs must be a positive finite number')
      }
      const state = transition('live', sourceRevision, timeoutMs)
      scheduleExpiry(timeoutMs)
      return state
    },
    dismissLive(): TuiDisplayControlState {
      if (current.mode !== 'live') return current
      clearTimer()
      const persistent = persistentRevision
      current = nextState(
        current,
        'persistent',
        scheduler.now(),
        persistent === null ? undefined : persistent,
      )
      return publish()
    },
    touch(sourceRevision: number, timeoutMs: number): TuiDisplayControlState {
      if (current.mode !== 'live') return this.showLive(sourceRevision, timeoutMs)
      if (typeof sourceRevision !== 'number' || !Number.isSafeInteger(sourceRevision) || sourceRevision < 0) {
        throw new TypeError('display-control: sourceRevision must be a non-negative safe integer')
      }
      if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new TypeError('display-control: timeoutMs must be a positive finite number')
      }
      const state = transition('live', sourceRevision, timeoutMs)
      scheduleExpiry(timeoutMs)
      return state
    },
    subscribe(listener: (state: TuiDisplayControlState) => void): () => void {
      if (typeof listener !== 'function') throw new TypeError('display-control: listener must be a function')
      if (disposed) throw new Error(`display-control: ${controlId} disposed`)
      listeners.add(listener)
      let active = true
      return () => {
        if (!active) return
        active = false
        listeners.delete(listener)
      }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      clearTimer()
      listeners.clear()
      onDispose?.()
    },
  })
}

export function apply(ctx: Context): void {
  ctx.tuiDisplayControl = new TuiDisplayControlService(ctx)
}
