import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { realpath } from 'node:fs/promises'
import type {
  HistoryEntry,
  HostFrame,
  MuxFrame,
  RpcResult,
  RpcRequest,
  SessionProjectionsBlock,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'

export const tuiSessionServiceName = 'tuiSession' as const

export interface TuiSessionHost {
  readonly sessions: Pick<IApiClient['sessions'], 'list' | 'create' | 'history' | 'prompt' | 'cancel'>
  readonly events: Pick<IApiClient['events'], 'mux' | 'host'>
}

export interface TuiSessionSnapshot {
  readonly sessionId: SessionId
  readonly cwd: string
  readonly running: boolean
  readonly live: boolean
  readonly lastSeq: number
  readonly entries: readonly HistoryEntry[]
  readonly projections?: SessionProjectionsBlock
  readonly error?: string
}

export type TuiSessionErrorKind =
  | 'already-selected'
  | 'not-selected'
  | 'resume-not-found'
  | 'resume-cwd-missing'
  | 'resume-cwd-invalid'
  | 'resume-cwd-mismatch'
  | 'host-error'

export class TuiSessionError extends Error {
  readonly kind: TuiSessionErrorKind
  readonly details?: unknown

  constructor(kind: TuiSessionErrorKind, message: string, details?: unknown) {
    super(message)
    this.name = 'TuiSessionError'
    this.kind = kind
    this.details = details
  }
}

function asSessionId(value: string): SessionId {
  return value as SessionId
}

function freezeSnapshot(snapshot: TuiSessionSnapshot): TuiSessionSnapshot {
  return Object.freeze({
    ...snapshot,
    entries: Object.freeze([...snapshot.entries]),
  })
}

export async function canonicalCurrentCwd(cwd = process.cwd()): Promise<string> {
  try {
    return await realpath(cwd)
  } catch (error) {
    throw new TuiSessionError('resume-cwd-invalid', `cannot canonicalize cwd ${cwd}`, error)
  }
}

export interface TuiSessionServiceFace {
  readonly name: typeof tuiSessionServiceName
  readonly snapshot: TuiSessionSnapshot | null
  subscribe(listener: (snapshot: TuiSessionSnapshot) => void): () => void
  createCurrentCwd(host: TuiSessionHost, cwd?: string): Promise<TuiSessionSnapshot>
  resume(host: TuiSessionHost, rawSessionId: string, cwd?: string): Promise<TuiSessionSnapshot>
  prompt(text: string): Promise<RpcResult<{ accepted: true; command?: { kind: 'success'; text?: string } }>>
  cancel(): Promise<RpcResult<{ accepted: true }>>
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiSession: TuiSessionServiceFace
  }
}

export class TuiSessionService extends Service implements TuiSessionServiceFace {
  readonly name = tuiSessionServiceName
  private activeHost: TuiSessionHost | null = null
  private muxController: AbortController | null = null
  private hostController: AbortController | null = null
  private current: TuiSessionSnapshot | null = null
  private listeners = new Set<(snapshot: TuiSessionSnapshot) => void>()

  constructor(ctx: Context) {
    super(ctx, tuiSessionServiceName)
    ctx.effect(() => () => {
      this.dispose()
      this.listeners.clear()
    }, 'tui-session.dispose')
  }

  get snapshot(): TuiSessionSnapshot | null {
    return this.current
  }

  subscribe(listener: (snapshot: TuiSessionSnapshot) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('subscribe requires a function listener')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async createCurrentCwd(host: TuiSessionHost, cwd = process.cwd()): Promise<TuiSessionSnapshot> {
    this.requireIdle()
    const canonical = await canonicalCurrentCwd(cwd)
    const response = await host.sessions.create({ cwd: canonical })
    if (!response.result.ok) {
      throw new TuiSessionError('host-error', `session.create failed: ${response.result.error.code}`, response.result.error)
    }
    return this.activate(host, response.result.value.sessionId, canonical)
  }

  async resume(host: TuiSessionHost, rawSessionId: string, cwd = process.cwd()): Promise<TuiSessionSnapshot> {
    this.requireIdle()
    if (typeof rawSessionId !== 'string' || rawSessionId.length === 0) {
      throw new TypeError('resume requires a non-empty Session ID')
    }
    const canonical = await canonicalCurrentCwd(cwd)
    const listResponse = await host.sessions.list({})
    if (!listResponse.result.ok) {
      throw new TuiSessionError('host-error', `session.list failed: ${listResponse.result.error.code}`, listResponse.result.error)
    }
    const summary = listResponse.result.value.items.find(item => item.sessionId === rawSessionId)
    if (!summary) {
      throw new TuiSessionError('resume-not-found', `no Session ${rawSessionId} in the public session list`)
    }
    if (typeof summary.cwd !== 'string' || summary.cwd.length === 0) {
      throw new TuiSessionError('resume-cwd-missing', `Session ${rawSessionId} does not record a cwd`)
    }
    let summaryCwd: string
    try {
      summaryCwd = await realpath(summary.cwd)
    } catch (error) {
      throw new TuiSessionError('resume-cwd-invalid', `Session ${rawSessionId} cwd ${summary.cwd} cannot be canonicalized`, error)
    }
    if (summaryCwd !== canonical) {
      throw new TuiSessionError(
        'resume-cwd-mismatch',
        `Session ${rawSessionId} cwd ${summaryCwd} does not match current cwd ${canonical}`,
      )
    }
    const response = await host.sessions.create({ sessionId: asSessionId(rawSessionId), cwd: canonical })
    if (!response.result.ok) {
      throw new TuiSessionError('host-error', `session.create(resume) failed: ${response.result.error.code}`, response.result.error)
    }
    return this.activate(host, response.result.value.sessionId, canonical)
  }

  async prompt(text: string): Promise<RpcResult<{ accepted: true; command?: { kind: 'success'; text?: string } }>> {
    const snapshot = this.requireSelected()
    if (typeof text !== 'string' || text.length === 0) {
      throw new TypeError('prompt requires non-empty text')
    }
    const response = await this.requireHost().sessions.prompt({
      sessionId: snapshot.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    })
    return response.result
  }

  async cancel(): Promise<RpcResult<{ accepted: true }>> {
    const snapshot = this.requireSelected()
    const response = await this.requireHost().sessions.cancel({ sessionId: snapshot.sessionId })
    return response.result
  }

  dispose(): void {
    this.muxController?.abort()
    this.hostController?.abort()
    this.muxController = null
    this.hostController = null
    this.activeHost = null
    if (this.current) {
      this.current = freezeSnapshot({ ...this.current, live: false, error: this.current.error ?? 'session disposed' })
      this.notify()
    }
  }

  private requireIdle(): void {
    if (this.current) {
      throw new TuiSessionError('already-selected', `Session ${this.current.sessionId} is already selected`)
    }
  }

  private requireSelected(): TuiSessionSnapshot {
    if (!this.current) throw new TuiSessionError('not-selected', 'no Session is selected')
    return this.current
  }

  private requireHost(): TuiSessionHost {
    if (!this.activeHost) throw new TuiSessionError('not-selected', 'no Session host is active')
    return this.activeHost
  }

  private async activate(host: TuiSessionHost, sessionId: SessionId, cwd: string): Promise<TuiSessionSnapshot> {
    const hydrated = await this.hydrate(host, sessionId)
    this.activeHost = host
    this.current = freezeSnapshot({
      sessionId,
      cwd,
      running: false,
      live: false,
      lastSeq: hydrated.lastSeq,
      entries: hydrated.entries,
      ...(hydrated.projections === undefined ? {} : { projections: hydrated.projections }),
    })
    this.startLive(host, sessionId)
    this.notify()
    return this.current
  }

  private async hydrate(
    host: TuiSessionHost,
    sessionId: SessionId,
  ): Promise<{ entries: readonly HistoryEntry[]; projections?: SessionProjectionsBlock; lastSeq: number }> {
    const response = await host.sessions.history({ sessionId })
    if (!response.result.ok) {
      throw new TuiSessionError('host-error', `session.history failed: ${response.result.error.code}`, response.result.error)
    }
    const events = response.result.value.events
    const projections = response.result.value.projections
    const lastEvent = events[events.length - 1]
    const lastSeq = lastEvent ? lastEvent.event.seq : (projections?.asOfSeq ?? -1)
    return {
      entries: Object.freeze([...events]),
      ...(projections === undefined ? {} : { projections }),
      lastSeq,
    }
  }

  private startLive(host: TuiSessionHost, sessionId: SessionId): void {
    const muxController = new AbortController()
    const hostController = new AbortController()
    this.muxController = muxController
    this.hostController = hostController
    void this.pumpMux(host, sessionId, muxController.signal)
    void this.pumpHost(host, sessionId, hostController.signal)
  }

  private async pumpMux(host: TuiSessionHost, sessionId: SessionId, signal: AbortSignal): Promise<void> {
    try {
      for await (const frame of host.events.mux({}, signal)) {
        if (this.current?.sessionId !== sessionId) return
        this.applyMuxFrame(frame)
      }
      if (!signal.aborted) this.fail('mux stream ended without abort')
    } catch (error) {
      if (!signal.aborted) this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  private async pumpHost(host: TuiSessionHost, sessionId: SessionId, signal: AbortSignal): Promise<void> {
    try {
      for await (const frame of host.events.host({}, signal)) {
        if (this.current?.sessionId !== sessionId) return
        this.applyHostFrame(frame)
      }
      if (!signal.aborted) this.fail('host stream ended without abort')
    } catch (error) {
      if (!signal.aborted) this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  private applyMuxFrame(frame: RpcRequest<MuxFrame>): void {
    const payload = frame.payload
    switch (payload.type) {
      case 'session/subscribed': {
        if (payload.sessionId !== this.current?.sessionId) return
        this.update(snapshot => freezeSnapshot({
          ...snapshot,
          live: true,
          lastSeq: Math.max(snapshot.lastSeq, payload.lastSeq),
        }))
        return
      }
      case 'session/event': {
        if (payload.sessionId !== this.current?.sessionId) return
        this.applyLiveEvent(payload.event, payload.view)
        return
      }
      case 'stream/error':
        this.fail(payload.error.message)
        return
      default:
        return
    }
  }

  private applyLiveEvent(event: SessionEvent, view: HistoryEntry['view']): void {
    this.update(snapshot => {
      if (event.seq <= snapshot.lastSeq) return snapshot
      if (snapshot.lastSeq !== -1 && event.seq !== snapshot.lastSeq + 1) {
        return freezeSnapshot({
          ...snapshot,
          live: false,
          error: `live sequence gap: expected ${snapshot.lastSeq + 1}, got ${event.seq}`,
        })
      }
      return freezeSnapshot({
        ...snapshot,
        lastSeq: event.seq,
        entries: [
          ...snapshot.entries,
          view === undefined ? { event } : { event, view },
        ],
      })
    })
  }

  private applyHostFrame(frame: RpcRequest<HostFrame>): void {
    const payload = frame.payload
    switch (payload.type) {
      case 'host/session-status': {
        if (payload.sessionId !== this.current?.sessionId) return
        this.update(snapshot => freezeSnapshot({ ...snapshot, running: payload.running }))
        return
      }
      case 'host/session-removed': {
        if (payload.sessionId !== this.current?.sessionId) return
        this.fail('selected Session was removed')
        return
      }
      case 'host/agent-error': {
        if (payload.sessionId !== this.current?.sessionId) return
        this.fail(`host agent error: ${payload.message}`)
        return
      }
      case 'stream/error':
        this.fail(payload.error.message)
        return
      default:
        return
    }
  }

  private update(mutator: (snapshot: TuiSessionSnapshot) => TuiSessionSnapshot): void {
    if (!this.current) return
    const next = mutator(this.current)
    if (next !== this.current) {
      this.current = next
      this.notify()
    }
  }

  private fail(message: string): void {
    if (!this.current) return
    this.update(snapshot => freezeSnapshot({ ...snapshot, live: false, error: message }))
  }

  private notify(): void {
    if (!this.current) return
    for (const listener of [...this.listeners]) listener(this.current)
  }
}

export const name = 'session'

export function apply(ctx: Context): void {
  new TuiSessionService(ctx)
}
