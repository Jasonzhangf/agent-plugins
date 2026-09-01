import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { realpath } from 'node:fs/promises'
import type {
  ApprovalResponsePayload,
  ClientResponse,
  HistoryEntry,
  HostFrame,
  MuxFrame,
  QuestionResponsePayload,
  RpcId,
  RpcReceipt,
  RpcResponse,
  RpcResult,
  RpcRequest,
  SessionSummary,
  SessionProjectionsBlock,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'

export const tuiSessionServiceName = 'tuiSession' as const

/** Bounded initial/older history page. The display pipeline never hydrates the full log. */
export const TUI_HISTORY_PAGE_MESSAGES = 100

export interface TuiSessionHost {
  readonly sessions: Pick<IApiClient['sessions'], 'list' | 'create' | 'fork' | 'history' | 'prompt' | 'cancel' | 'models' | 'selectModel'>
  readonly command: (sessionId: SessionId, line: string) => Promise<RpcResponse<{ matched: boolean }>>
  readonly events: Pick<IApiClient['events'], 'mux' | 'host'>
  readonly respond: IApiClient['respond']
}

export type TuiPendingInteraction =
  | {
      readonly kind: 'approval'
      readonly interactionId: string
      readonly approvalId: string
      readonly toolName: string
      readonly reason?: string
    }
  | {
      readonly kind: 'question'
      readonly interactionId: string
      readonly questions: readonly {
        readonly id: string
        readonly question: string
        readonly detail?: string
        readonly header?: string
        readonly options?: readonly { readonly label: string; readonly description?: string }[]
        readonly multiSelect?: boolean
      }[]
    }

export interface TuiSessionSnapshot {
  readonly sessionId: SessionId
  readonly availableSessionIds?: readonly SessionId[]
  readonly cwd: string
  readonly running: boolean
  readonly live: boolean
  readonly lastSeq: number
  readonly entries: readonly HistoryEntry[]
  readonly hasMoreBefore: boolean
  readonly oldestLoadedSeq: number | null
  readonly loadingOlder: boolean
  readonly interactions: readonly TuiPendingInteraction[]
  readonly projections?: SessionProjectionsBlock
  readonly model?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
  readonly permission?: string
  readonly goal?: 'active' | 'paused' | 'blocked' | 'complete' | null
  readonly error?: string
}

export interface TuiCurrentCwdSessionOption {
  readonly sessionId: SessionId
  readonly cwd: string
  readonly running: boolean
  /** Unix ms - latest of creation and last human-authored prompt. */
  readonly updatedAt: number
  /** True while no turn has run. Blank sessions are excluded from --continue logic. */
  readonly blank: boolean
}

export type TuiSessionErrorKind =
  | 'already-selected'
  | 'selection-in-progress'
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
    ...(snapshot.availableSessionIds === undefined ? {} : { availableSessionIds: Object.freeze([...snapshot.availableSessionIds]) }),
    entries: Object.freeze([...snapshot.entries]),
    interactions: Object.freeze([...snapshot.interactions]),
  })
}

function mergeHistoryEntries(left: readonly HistoryEntry[], right: readonly HistoryEntry[]): HistoryEntry[] {
  const bySeq = new Map<number, HistoryEntry>()
  for (const entry of [...left, ...right]) bySeq.set(entry.event.seq, entry)
  return [...bySeq.values()].sort((a, b) => a.event.seq - b.event.seq)
}

export async function canonicalCurrentCwd(cwd = process.cwd()): Promise<string> {
  try {
    return await realpath(cwd)
  } catch (error) {
    throw new TuiSessionError('resume-cwd-invalid', `cannot canonicalize cwd ${cwd}`, error)
  }
}

async function canonicalSummaryCwd(summary: SessionSummary): Promise<string> {
  if (typeof summary.cwd !== 'string' || summary.cwd.length === 0) {
    throw new TuiSessionError('resume-cwd-missing', `Session ${summary.sessionId} does not record a cwd`)
  }
  try {
    return await realpath(summary.cwd)
  } catch (error) {
    throw new TuiSessionError('resume-cwd-invalid', `Session ${summary.sessionId} cwd ${summary.cwd} cannot be canonicalized`, error)
  }
}

async function canonicalSummaryCwdForListing(summary: SessionSummary): Promise<string | null> {
  try {
    return await canonicalSummaryCwd(summary)
  } catch (error) {
    if (error instanceof TuiSessionError
      && (error.kind === 'resume-cwd-missing' || error.kind === 'resume-cwd-invalid')) {
      return null
    }
    throw error
  }
}

function hasCompletedWork(summary: SessionSummary): boolean {
  if (summary.running) return true
  const projections = (summary as unknown as { readonly projections?: { readonly values?: Record<string, unknown> } }).projections
  const stats = projections?.values?.['sessionStats']
  if (!stats || typeof stats !== 'object') return false
  const values = stats as Record<string, unknown>
  return ['llmMs', 'toolMs', 'outputTokens'].some(key => typeof values[key] === 'number' && values[key] > 0)
}

export interface TuiSessionServiceFace {
  readonly name: typeof tuiSessionServiceName
  readonly snapshot: TuiSessionSnapshot | null
  subscribe(listener: (snapshot: TuiSessionSnapshot) => void): () => void
  createCurrentCwd(host: TuiSessionHost, cwd?: string): Promise<TuiSessionSnapshot>
  listCurrentCwdSessions(host: TuiSessionHost, cwd?: string): Promise<readonly TuiCurrentCwdSessionOption[]>
  latestCurrentCwdSession(host: TuiSessionHost, cwd?: string): Promise<TuiCurrentCwdSessionOption | null>
  resume(host: TuiSessionHost, rawSessionId: string, cwd?: string): Promise<TuiSessionSnapshot>
  loadOlder(): Promise<TuiSessionSnapshot>
  prompt(text: string): Promise<RpcResult<{ accepted: true; command?: { kind: 'success'; text?: string } }>>
  command(line: string): Promise<RpcResult<{ matched: boolean }>>
  cancel(): Promise<RpcResult<{ accepted: true }>>
  selectModel(selection: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }): Promise<RpcResult<{ selected: { provider: string; model: string; reasoningEffort?: string } }>>
  fork(atSeq?: number): Promise<TuiSessionSnapshot>
  respondApproval(interactionId: string, decision: boolean): Promise<RpcReceipt>
  respondQuestion(interactionId: string, answer: QuestionResponsePayload['answer']): Promise<RpcReceipt>
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
  private selecting = false
  private pendingResponseRpcIds = new Map<string, RpcId>()
  private loadingOlder = false

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
    return this.select(async () => {
      const canonical = await canonicalCurrentCwd(cwd)
      const response = await host.sessions.create({ cwd: canonical })
      if (!response.result.ok) {
        throw new TuiSessionError('host-error', `session.create failed: ${response.result.error.code}`, response.result.error)
      }
      return this.prepare(host, response.result.value.sessionId, canonical)
    })
  }

  async listCurrentCwdSessions(host: TuiSessionHost, cwd = process.cwd()): Promise<readonly TuiCurrentCwdSessionOption[]> {
    const canonical = await canonicalCurrentCwd(cwd)
    const listResponse = await host.sessions.list({})
    if (!listResponse.result.ok) {
      throw new TuiSessionError('host-error', `session.list failed: ${listResponse.result.error.code}`, listResponse.result.error)
    }
    const options: TuiCurrentCwdSessionOption[] = []
    for (const summary of listResponse.result.value.items) {
      if (summary.origin === 'subagent') continue
      const summaryCwd = await canonicalSummaryCwdForListing(summary)
      if (summaryCwd === null) continue
      if (summaryCwd === canonical) {
        options.push(Object.freeze({
          sessionId: summary.sessionId,
          cwd: summaryCwd,
          running: summary.running,
          updatedAt: summary.updatedAt,
          blank: summary.blank,
        }))
      }
    }
    return Object.freeze([...options].sort((left, right) => right.updatedAt - left.updatedAt))
  }

  async latestCurrentCwdSession(host: TuiSessionHost, cwd = process.cwd()): Promise<TuiCurrentCwdSessionOption | null> {
    const canonical = await canonicalCurrentCwd(cwd)
    const listResponse = await host.sessions.list({})
    if (!listResponse.result.ok) {
      throw new TuiSessionError('host-error', `session.list failed: ${listResponse.result.error.code}`, listResponse.result.error)
    }
    const candidates = [...listResponse.result.value.items]
      .filter(summary => summary.origin !== 'subagent' && summary.blank === false && hasCompletedWork(summary))
      .sort((left, right) => right.updatedAt - left.updatedAt)
    for (const summary of candidates) {
      const summaryCwd = summary.cwd === canonical ? canonical : await canonicalSummaryCwdForListing(summary)
      if (summaryCwd !== canonical) continue
      return Object.freeze({
        sessionId: summary.sessionId,
        cwd: summaryCwd,
        running: summary.running,
        updatedAt: summary.updatedAt,
        blank: summary.blank,
      })
    }
    return null
  }

  async resume(host: TuiSessionHost, rawSessionId: string, cwd = process.cwd()): Promise<TuiSessionSnapshot> {
    if (typeof rawSessionId !== 'string' || rawSessionId.length === 0) {
      throw new TypeError('resume requires a non-empty Session ID')
    }
    return this.select(async () => {
      const canonical = await canonicalCurrentCwd(cwd)
      const listResponse = await host.sessions.list({})
      if (!listResponse.result.ok) {
        throw new TuiSessionError('host-error', `session.list failed: ${listResponse.result.error.code}`, listResponse.result.error)
      }
      const summary = listResponse.result.value.items.find(item => item.sessionId === rawSessionId)
      if (!summary) {
        throw new TuiSessionError('resume-not-found', `no Session ${rawSessionId} in the public session list`)
      }
      const summaryCwd = await canonicalSummaryCwd(summary)
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
      return this.prepare(host, response.result.value.sessionId, canonical)
    })
  }

  async loadOlder(): Promise<TuiSessionSnapshot> {
    const snapshot = this.requireSelected()
    if (!snapshot.hasMoreBefore || snapshot.oldestLoadedSeq === null) return snapshot
    if (this.loadingOlder) return snapshot
    const host = this.requireHost()
    this.loadingOlder = true
    this.update(current => freezeSnapshot({ ...current, loadingOlder: true }))
    try {
      const response = await host.sessions.history({
        sessionId: snapshot.sessionId,
        beforeSeq: snapshot.oldestLoadedSeq,
        maxMessages: TUI_HISTORY_PAGE_MESSAGES,
      })
      if (!response.result.ok) {
        throw new TuiSessionError('host-error', `session.history(older) failed: ${response.result.error.code}`, response.result.error)
      }
      const current = this.current
      if (current?.sessionId !== snapshot.sessionId) throw new TuiSessionError('not-selected', 'Session changed while loading older history')
      const older = response.result.value.events
      if (older.length === 0 && response.result.value.hasMore) {
        throw new TuiSessionError('host-error', 'session.history(older) returned no progress')
      }
      const merged = mergeHistoryEntries(older, current.entries)
      const next = freezeSnapshot({
        ...current,
        entries: merged,
        hasMoreBefore: response.result.value.hasMore,
        oldestLoadedSeq: merged[0]?.event.seq ?? null,
        loadingOlder: false,
      })
      this.current = next
      this.notify()
      return next
    } finally {
      this.loadingOlder = false
      if (this.current?.sessionId === snapshot.sessionId && this.current.loadingOlder) {
        this.update(current => freezeSnapshot({ ...current, loadingOlder: false }))
      }
    }
  }

  async fork(atSeq?: number): Promise<TuiSessionSnapshot> {
    const snapshot = this.requireSelected()
    if (atSeq !== undefined && (!Number.isSafeInteger(atSeq) || atSeq < 0)) {
      throw new TypeError('fork atSeq must be a non-negative safe integer')
    }
    const response = await this.requireHost().sessions.fork({
      sessionId: snapshot.sessionId,
      ...(atSeq === undefined ? {} : { atSeq }),
    })
    if (!response.result.ok) {
      throw new TuiSessionError('host-error', `session.fork failed: ${response.result.error.code}`, response.result.error)
    }
    const childSessionId = response.result.value.sessionId
    return this.select(async () => {
      const canonical = await canonicalCurrentCwd(snapshot.cwd)
      return this.prepare(this.requireHost(), childSessionId, canonical)
    })
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

  async command(line: string): Promise<RpcResult<{ matched: boolean }>> {
    const snapshot = this.requireSelected()
    if (typeof line !== 'string' || line.length === 0) throw new TypeError('command requires a non-empty line')
    const host = this.requireHost()
    const response = await host.command(snapshot.sessionId, line)
    if (!response.result.ok) return response.result
    const refreshed = await this.hydrate(host, snapshot.sessionId)
    if (refreshed.projections === undefined) {
      throw new TuiSessionError('host-error', 'command succeeded but session projections are unavailable')
    }
    if (this.current?.sessionId !== snapshot.sessionId) {
      throw new TuiSessionError('not-selected', 'Session changed while refreshing command state')
    }
    const merged = mergeHistoryEntries(snapshot.entries, refreshed.entries)
    this.update(current => freezeSnapshot({
      ...current,
      lastSeq: refreshed.lastSeq,
      entries: merged,
      hasMoreBefore: refreshed.hasMoreBefore,
      oldestLoadedSeq: merged[0]?.event.seq ?? null,
      ...(refreshed.projections === undefined ? {} : { projections: refreshed.projections }),
    }))
    return response.result
  }

  async cancel(): Promise<RpcResult<{ accepted: true }>> {
    const snapshot = this.requireSelected()
    const response = await this.requireHost().sessions.cancel({ sessionId: snapshot.sessionId })
    return response.result
  }

  async selectModel(selection: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }): Promise<RpcResult<{ selected: { provider: string; model: string; reasoningEffort?: string } }>> {
    const snapshot = this.requireSelected()
    const host = this.requireHost()
    const response = await host.sessions.selectModel({
      sessionId: snapshot.sessionId,
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    })
    if (!response.result.ok) return response.result
    const refreshed = await this.hydrate(host, snapshot.sessionId)
    if (refreshed.projections === undefined) {
      throw new TuiSessionError('host-error', 'model selection succeeded but session projections are unavailable')
    }
    if (this.current?.sessionId !== snapshot.sessionId) {
      throw new TuiSessionError('not-selected', 'Session changed while refreshing model state')
    }
    const merged = mergeHistoryEntries(snapshot.entries, refreshed.entries)
    this.update(current => freezeSnapshot({
      ...current,
      lastSeq: refreshed.lastSeq,
      entries: merged,
      hasMoreBefore: refreshed.hasMoreBefore,
      oldestLoadedSeq: merged[0]?.event.seq ?? null,
      ...(refreshed.projections === undefined ? {} : { projections: refreshed.projections }),
    }))
    return response.result
  }

  async respondApproval(interactionId: string, decision: boolean): Promise<RpcReceipt> {
    const snapshot = this.requireSelected()
    const interaction = snapshot.interactions.find(
      candidate => candidate.kind === 'approval' && candidate.interactionId === interactionId,
    )
    if (!interaction || interaction.kind !== 'approval') {
      throw new TuiSessionError('not-selected', `no pending approval ${interactionId}`)
    }
    const rpcId = this.pendingResponseRpcIds.get(interactionId)
    if (!rpcId) throw new TuiSessionError('not-selected', `pending approval ${interactionId} has no response channel`)
    const value: ApprovalResponsePayload = {
      sessionId: snapshot.sessionId,
      approvalId: interaction.approvalId as ApprovalResponsePayload['approvalId'],
      outcome: decision ? 'allowed-once' : 'rejected',
    }
    return this.respond(interactionId, { type: 'client-response', rpcId, result: { ok: true, value } })
  }

  async respondQuestion(
    interactionId: string,
    answer: QuestionResponsePayload['answer'],
  ): Promise<RpcReceipt> {
    const snapshot = this.requireSelected()
    const interaction = snapshot.interactions.find(
      candidate => candidate.kind === 'question' && candidate.interactionId === interactionId,
    )
    if (!interaction) throw new TuiSessionError('not-selected', `no pending question ${interactionId}`)
    const rpcId = this.pendingResponseRpcIds.get(interactionId)
    if (!rpcId) throw new TuiSessionError('not-selected', `pending question ${interactionId} has no response channel`)
    const value: QuestionResponsePayload = { sessionId: snapshot.sessionId, answer }
    return this.respond(interactionId, { type: 'client-response', rpcId, result: { ok: true, value } })
  }

  dispose(): void {
    this.muxController?.abort()
    this.hostController?.abort()
    this.muxController = null
    this.hostController = null
    this.activeHost = null
    this.pendingResponseRpcIds.clear()
    this.loadingOlder = false
    if (this.current) {
      this.current = freezeSnapshot({ ...this.current, live: false, error: this.current.error ?? 'session disposed' })
      this.notify()
    }
  }

  private async select(
    prepare: () => Promise<{ host: TuiSessionHost; snapshot: TuiSessionSnapshot }>,
  ): Promise<TuiSessionSnapshot> {
    if (this.selecting) {
      throw new TuiSessionError('selection-in-progress', 'Session selection is already in progress')
    }
    this.selecting = true
    try {
      const target = await prepare()
      this.muxController?.abort()
      this.hostController?.abort()
      this.muxController = null
      this.hostController = null
      this.activeHost = target.host
      this.current = target.snapshot
      this.pendingResponseRpcIds.clear()
      this.startLive(target.host, target.snapshot.sessionId)
      this.notify()
      return target.snapshot
    } finally {
      this.selecting = false
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

  private async prepare(
    host: TuiSessionHost,
    sessionId: SessionId,
    cwd: string,
  ): Promise<{ host: TuiSessionHost; snapshot: TuiSessionSnapshot }> {
    const hydrated = await this.hydrate(host, sessionId)
    const snapshot = freezeSnapshot({
      sessionId,
      availableSessionIds: [sessionId],
      cwd,
      running: false,
      live: false,
      lastSeq: hydrated.lastSeq,
      entries: hydrated.entries,
      hasMoreBefore: hydrated.hasMoreBefore,
      oldestLoadedSeq: hydrated.entries[0]?.event.seq ?? null,
      loadingOlder: false,
      interactions: [],
      ...(hydrated.projections === undefined ? {} : { projections: hydrated.projections }),
    })
    return { host, snapshot }
  }

  private async hydrate(
    host: TuiSessionHost,
    sessionId: SessionId,
  ): Promise<{ entries: readonly HistoryEntry[]; projections?: SessionProjectionsBlock; lastSeq: number; hasMoreBefore: boolean }> {
    const response = await host.sessions.history({ sessionId, maxMessages: TUI_HISTORY_PAGE_MESSAGES })
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
      hasMoreBefore: response.result.value.hasMore,
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
    let openCount = 0
    let rebaseline = Promise.resolve(true)
    const handleOpen = (): void => {
      openCount += 1
      if (openCount === 1 || signal.aborted) return
      rebaseline = rebaseline.then(async previousSucceeded => {
        if (!previousSucceeded || signal.aborted) return false
        try {
          await this.rebaseline(host, sessionId)
          return true
        } catch (error) {
          if (!signal.aborted) this.fail(error instanceof Error ? error.message : String(error))
          return false
        }
      })
    }
    try {
      for await (const frame of host.events.mux({}, signal, handleOpen)) {
        if (this.current?.sessionId !== sessionId) return
        if (!await rebaseline) return
        this.applyMuxFrame(frame)
      }
      if (!signal.aborted) this.fail('mux stream ended without abort')
    } catch (error) {
      if (!signal.aborted) this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  private async rebaseline(host: TuiSessionHost, sessionId: SessionId): Promise<void> {
    if (this.current?.sessionId !== sessionId) return
    this.update(snapshot => {
      const { error: _error, ...withoutError } = snapshot
      return freezeSnapshot({ ...withoutError, live: false })
    })
    const hydrated = await this.hydrate(host, sessionId)
    if (this.current?.sessionId !== sessionId) return
    this.pendingResponseRpcIds.clear()
    this.update(snapshot => {
      const { error: _error, projections: _projections, ...baseline } = snapshot
      return freezeSnapshot({
        ...baseline,
        live: false,
        lastSeq: hydrated.lastSeq,
        entries: hydrated.entries,
        hasMoreBefore: hydrated.hasMoreBefore,
        oldestLoadedSeq: hydrated.entries[0]?.event.seq ?? null,
        loadingOlder: false,
        interactions: [],
        ...(hydrated.projections === undefined ? {} : { projections: hydrated.projections }),
      })
    })
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
      case 'approval/requested': {
        if (payload.sessionId !== this.current?.sessionId) return
        const interactionId = `approval:${payload.approvalId}`
        this.pendingResponseRpcIds.set(interactionId, frame.rpcId)
        this.update(snapshot => freezeSnapshot({
          ...snapshot,
          interactions: [
            ...snapshot.interactions.filter(item => item.interactionId !== interactionId),
            {
              kind: 'approval',
              interactionId,
              approvalId: payload.approvalId,
              toolName: payload.toolName,
              ...(payload.reason === undefined ? {} : { reason: payload.reason }),
            },
          ],
        }))
        return
      }
      case 'approval/resolved': {
        if (payload.sessionId !== this.current?.sessionId) return
        this.removeInteraction(`approval:${payload.approvalId}`)
        return
      }
      case 'question/requested': {
        if (payload.sessionId !== this.current?.sessionId) return
        const interactionId = `question:${frame.rpcId}`
        this.pendingResponseRpcIds.set(interactionId, frame.rpcId)
        this.update(snapshot => freezeSnapshot({
          ...snapshot,
          interactions: [
            ...snapshot.interactions.filter(item => item.interactionId !== interactionId),
            { kind: 'question', interactionId, questions: payload.questions },
          ],
        }))
        return
      }
      case 'question/resolved': {
        if (payload.sessionId !== this.current?.sessionId) return
        this.removeInteraction(`question:${payload.questionRpcId}`)
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

  private async respond(interactionId: string, message: ClientResponse): Promise<RpcReceipt> {
    const receipt = await this.requireHost().respond(message)
    if (!receipt.accepted) {
      throw new TuiSessionError('host-error', `interaction response rejected: ${receipt.reason}`, receipt)
    }
    this.removeInteraction(interactionId)
    return receipt
  }

  private removeInteraction(interactionId: string): void {
    this.pendingResponseRpcIds.delete(interactionId)
    this.update(snapshot => freezeSnapshot({
      ...snapshot,
      interactions: snapshot.interactions.filter(item => item.interactionId !== interactionId),
    }))
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
