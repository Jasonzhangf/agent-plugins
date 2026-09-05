import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { readFile, realpath } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  ApprovalOutcome,
  SessionControlFrame,
  SessionFollowFrame,
  SessionQueuedItem,
  SessionWireEvent,
  SessionJob,
  SessionProjectionBaseline,
  SessionAddress,
  SessionPageRequest,
  SessionPromptRequest,
  SessionUpdateQueueRequest,
  SessionSelectModelRequest,
  AgentResult as RemoteResult,
  SessionId,
  SessionSummary,
  AgentHost,
  TuiForwardedEvent,
  TuiForwardedEventResult,
} from '../../transport/src/transport.ts'
import { OpenCodeServeClient } from '../../transport/src/opencode-serve.ts'
import type {
  TuiHistoryEntry,
} from '../../../../contracts/tui/session/history-entry.types.ts'
import {
  normalizeHistoryRecords,
  lastSeqOf,
} from './session.normalizer.ts'

export const tuiSessionServiceName = 'tuiSession' as const

/** Bounded initial/older history page. The display pipeline never hydrates the full log. */
export const TUI_HISTORY_PAGE_MESSAGES = 100

/** Session host surface shared by the OpenCode adaptor and legacy test doubles. */
export type TuiSessionHost = AgentHost | OpenCodeServeClient

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
  readonly entries: readonly TuiHistoryEntry[]
  readonly hasMoreBefore: boolean
  readonly oldestLoadedSeq: number | null
  readonly loadingOlder: boolean
  readonly interactions: readonly TuiPendingInteraction[]
  readonly queue: readonly SessionQueuedItem[]
  readonly jobs: readonly SessionJob[]
  readonly projections?: SessionProjectionBaseline
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

function freezeSnapshot(snapshot: TuiSessionSnapshot): TuiSessionSnapshot {
  return Object.freeze({
    ...snapshot,
    ...(snapshot.availableSessionIds === undefined ? {} : { availableSessionIds: Object.freeze([...snapshot.availableSessionIds]) }),
    entries: Object.freeze([...snapshot.entries]),
    interactions: Object.freeze([...snapshot.interactions]),
    queue: Object.freeze([...snapshot.queue]),
    jobs: Object.freeze([...snapshot.jobs]),
  })
}

function mergeHistoryEntries(left: readonly TuiHistoryEntry[], right: readonly TuiHistoryEntry[]): TuiHistoryEntry[] {
  const bySeq = new Map<number, TuiHistoryEntry>()
  for (const entry of [...left, ...right]) bySeq.set(entry.event.seq, entry)
  return [...bySeq.values()].sort((a, b) => a.event.seq - b.event.seq)
}

type LocalQueuedPrompt = {
  readonly request: SessionPromptRequest
  readonly item: SessionQueuedItem
}

type ActivePrompt = {
  readonly sessionId: SessionId
  readonly requestId: string
  readonly accepted: Promise<void>
  readonly lifecycle: Promise<'started' | 'ended'>
  readonly markAccepted: () => void
  readonly markLifecycle: (state: 'started' | 'ended') => void
}

function addressFor(sessionId: SessionId): SessionAddress {
  return { kind: 'session', sessionId }
}

function asPageRequest(
  sessionId: SessionId,
  throughSeq: number,
  beforeSeq?: number,
  maxMessages = TUI_HISTORY_PAGE_MESSAGES,
): SessionPageRequest {
  return {
    address: addressFor(sessionId),
    throughSeq,
    ...(beforeSeq === undefined ? {} : { beforeSeq }),
    ...(maxMessages === undefined ? {} : { maxMessages }),
  }
}

function remoteFailure(error: { code: string; message: string }): never {
  throw new TuiSessionError('host-error', `Host RPC failed: ${error.code}: ${error.message}`)
}

function unwrap<T>(result: RemoteResult<T>, operation: string): T {
  if (!result.ok) remoteFailure(result.error)
  return result.value
}

export interface TuiSessionServiceFace {
  readonly name: typeof tuiSessionServiceName
  readonly snapshot: TuiSessionSnapshot | null
  subscribe(listener: (snapshot: TuiSessionSnapshot) => void): () => void
  subscribeSubagent(listener: (event: {
    readonly agentId: SessionId
    readonly type: 'started' | 'stopped' | 'event'
    readonly event?: SessionWireEvent
    readonly view?: TuiHistoryEntry['view']
  }) => void): () => void
  createCurrentCwd(host: TuiSessionHost, cwd?: string): Promise<TuiSessionSnapshot>
  listCurrentCwdSessions(host: TuiSessionHost, cwd?: string): Promise<readonly TuiCurrentCwdSessionOption[]>
  latestCurrentCwdSession(host: TuiSessionHost, cwd?: string): Promise<TuiCurrentCwdSessionOption | null>
  resume(host: TuiSessionHost, rawSessionId: string, cwd?: string): Promise<TuiSessionSnapshot>
  loadOlder(): Promise<TuiSessionSnapshot>
  updateQueue(itemId: string, action: SessionUpdateQueueRequest['action']): Promise<RemoteResult<{ accepted: true }>>
  prompt(text: string): Promise<RemoteResult<{ accepted: true; command?: { kind: 'success'; text?: string } }>>
  promptImage(path: string, text?: string): Promise<RemoteResult<{ accepted: true; command?: { kind: 'success'; text?: string } }>>
  command(line: string): Promise<RemoteResult<{ matched: boolean }>>
  cancel(): Promise<RemoteResult<{ accepted: true }>>
  selectModel(selection: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }): Promise<RemoteResult<{ selected: { provider: string; model: string; reasoningEffort?: string } }>>
  fork(atSeq?: number): Promise<TuiSessionSnapshot>
  respondApproval(interactionId: string, decision: boolean): Promise<{ accepted: true }>
  respondQuestion(interactionId: string, answer: AskUserQuestionAnswer): Promise<{ accepted: true }>
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
  private controlController: AbortController | null = null
  private followController: AbortController | null = null
  private eventController: AbortController | null = null
  private promptController: AbortController | null = null
  private current: TuiSessionSnapshot | null = null
  private listeners = new Set<(snapshot: TuiSessionSnapshot) => void>()
  private subagentListeners = new Set<(event: {
    readonly agentId: SessionId
    readonly type: 'started' | 'stopped' | 'event'
    readonly event?: SessionWireEvent
    readonly view?: TuiHistoryEntry['view']
  }) => void>()
  private selecting = false
  private pendingInteractions = new Map<string, {
    readonly clientId: string
    readonly eventId: string
    readonly kind: 'approval' | 'question'
    readonly approvalId?: string
    readonly questions?: readonly AskUserQuestionItem[]
  }>()
  private loadingOlder = false
  private activePrompt: ActivePrompt | null = null
  private queuedPrompts: LocalQueuedPrompt[] = []
  private drainingPrompts = false

  constructor(ctx: Context) {
    super(ctx, tuiSessionServiceName)
    ctx.effect(() => () => {
      this.dispose()
      this.listeners.clear()
      this.subagentListeners.clear()
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

  subscribeSubagent(listener: (event: {
    readonly agentId: SessionId
    readonly type: 'started' | 'stopped' | 'event'
    readonly event?: SessionWireEvent
    readonly view?: TuiHistoryEntry['view']
  }) => void): () => void {
    this.subagentListeners.add(listener)
    return () => this.subagentListeners.delete(listener)
  }

  async createCurrentCwd(host: TuiSessionHost, cwd = process.cwd()): Promise<TuiSessionSnapshot> {
    const canonical = await canonicalCurrentCwd(cwd)
    return this.select(host, async () => {
      const response = await host.remote.session.create({ cwd: canonical })
      const value = unwrap(response, 'session.create')
      return this.prepare(host, asSessionId(value.sessionId), canonical)
    })
  }

  async listCurrentCwdSessions(host: TuiSessionHost, cwd = process.cwd()): Promise<readonly TuiCurrentCwdSessionOption[]> {
    const canonical = await canonicalCurrentCwd(cwd)
    const response = await host.remote.session.list()
    const value = unwrap(response, 'session.list')
    const options: TuiCurrentCwdSessionOption[] = []
    for (const summary of value.items) {
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
    const response = await host.remote.session.list()
    const value = unwrap(response, 'session.list')
    const candidates = [...value.items]
      .filter(summary => summary.origin !== 'subagent' && summary.blank === false)
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
    const canonical = await canonicalCurrentCwd(cwd)
    return this.select(host, async () => {
      const created = await host.remote.session.create({ sessionId: asSessionId(rawSessionId), cwd: canonical })
      const createdValue = unwrap(created, 'session.create(resume)')
      return this.prepare(host, asSessionId(createdValue.sessionId), canonical)
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
      const response = await host.remote.session.page(
        asPageRequest(
          snapshot.sessionId,
          snapshot.lastSeq,
          snapshot.oldestLoadedSeq,
          TUI_HISTORY_PAGE_MESSAGES,
        ),
      )
      const value = unwrap(response, 'session.page(older)')
      const current = this.current
      if (current?.sessionId !== snapshot.sessionId) throw new TuiSessionError('not-selected', 'Session changed while loading older history')
      const older = normalizeHistoryRecords(value.records)
      if (older.length === 0 && value.hasMore) {
        throw new TuiSessionError('host-error', 'session.page(older) returned no progress')
      }
      const merged = mergeHistoryEntries(older, current.entries)
      const next = freezeSnapshot({
        ...current,
        entries: merged,
        hasMoreBefore: value.hasMore,
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

  async updateQueue(itemId: string, action: SessionUpdateQueueRequest['action']): Promise<RemoteResult<{ accepted: true }>> {
    const snapshot = this.requireSelected()
    if (typeof itemId !== 'string' || itemId.length === 0) throw new TypeError('queue item id must be non-empty')
    if (!snapshot.queue.some(item => String(item.id) === itemId)) throw new TuiSessionError('host-error', `unknown queue item: ${itemId}`)
    try {
      return await this.requireHost().remote.session.updateQueue({ sessionId: snapshot.sessionId, itemId: itemId as never, action })
    } catch (error) {
      return { ok: false, error: { code: 'transport', message: String(error), details: {} } }
    }
  }

  async fork(atSeq?: number): Promise<TuiSessionSnapshot> {
    const snapshot = this.requireSelected()
    if (atSeq !== undefined && (!Number.isSafeInteger(atSeq) || atSeq < 0)) {
      throw new TypeError('fork atSeq must be a non-negative safe integer')
    }
    const response = await this.requireHost().remote.session.fork({
      sessionId: snapshot.sessionId,
      ...(atSeq === undefined ? {} : { atSeq }),
    })
    const value = unwrap(response, 'session.fork')
    const host = this.requireHost()
    return this.select(host, async () => {
      const canonical = await canonicalCurrentCwd(snapshot.cwd)
      return this.prepare(host, asSessionId(value.sessionId), canonical)
    })
  }

  async prompt(text: string): Promise<RemoteResult<{ accepted: true; command?: { kind: 'success'; text?: string } }>> {
    const snapshot = this.requireSelected()
    if (typeof text !== 'string' || text.length === 0) {
      throw new TypeError('prompt requires non-empty text')
    }
    const request: SessionPromptRequest = {
      sessionId: snapshot.sessionId,
      requestId: randomUUID() as SessionPromptRequest['requestId'],
      mode: 'queue',
      content: [{ type: 'text', text }],
    }
    return this.queueOrSendPrompt(request, snapshot)
  }

  async promptImage(path: string, text = ''): Promise<RemoteResult<{ accepted: true; command?: { kind: 'success'; text?: string } }>> {
    const snapshot = this.requireSelected()
    if (typeof path !== 'string' || path.length === 0) throw new TypeError('prompt image requires a non-empty path')
    const mediaTypeByExtension: Readonly<Record<string, 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'>> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    }
    const mediaType = mediaTypeByExtension[extname(path).toLowerCase()]
    if (mediaType === undefined) throw new TypeError('prompt image supports png, jpeg, webp, and gif files only')
    const data = (await readFile(path)).toString('base64')
    const content = [
      ...(text.length === 0 ? [] : [{ type: 'text' as const, text }]),
      { type: 'image' as const, mediaType, data, name: basename(path) },
    ]
    const request: SessionPromptRequest = {
      sessionId: snapshot.sessionId,
      requestId: randomUUID() as SessionPromptRequest['requestId'],
      mode: 'queue',
      content,
    }
    return this.queueOrSendPrompt(request, snapshot)
  }

  async command(line: string): Promise<RemoteResult<{ matched: boolean }>> {
    const snapshot = this.requireSelected()
    if (typeof line !== 'string' || line.length === 0) throw new TypeError('command requires a non-empty line')
    const host = this.requireHost()
    const response = await host.remote.commands.execute(snapshot.sessionId, line, [])
    if (!response.ok) return response
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
    return { ok: true, value: { matched: response.value?.kind === 'success' } }
  }

  async cancel(): Promise<RemoteResult<{ accepted: true }>> {
    const snapshot = this.requireSelected()
    const activePrompt = this.activePrompt
    const promptController = this.promptController
    if (activePrompt !== null) {
      await activePrompt.accepted
      const lifecycle = await activePrompt.lifecycle
      if (lifecycle === 'ended') {
        if (promptController !== null && this.promptController === promptController) promptController.abort()
        return { ok: true, value: { accepted: true } }
      }
    }
    try {
      return await this.requireHost().remote.session.cancel({ sessionId: snapshot.sessionId })
    } finally {
      // Let OpenCode admit the prompt and receive the typed abort request before
      // closing the local fetch. Aborting first can race prompt_async and leave
      // the Host turn running after the UI has already reported cancellation.
      if (promptController !== null && this.promptController === promptController) promptController.abort()
    }
  }

  async selectModel(selection: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }): Promise<RemoteResult<{ selected: { provider: string; model: string; reasoningEffort?: string } }>> {
    const snapshot = this.requireSelected()
    const host = this.requireHost()
    const request: SessionSelectModelRequest = {
      sessionId: snapshot.sessionId,
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    }
    const response = await host.remote.session.selectModel(request)
    if (!response.ok) return response
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
    return response
  }

  async respondApproval(interactionId: string, decision: boolean): Promise<{ accepted: true }> {
    const interaction = this.pendingInteractions.get(interactionId)
    if (!interaction || interaction.kind !== 'approval') {
      throw new TuiSessionError('not-selected', `no pending approval ${interactionId}`)
    }
    const outcome: ApprovalOutcome = decision ? 'allowed-once' : 'rejected'
    const result: TuiForwardedEventResult = {
      clientId: interaction.clientId,
      eventId: interaction.eventId,
      outcome: { kind: 'result', value: outcome },
    }
    await this.requireHost().remote.events.respond(result)
    this.pendingInteractions.delete(interactionId)
    this.removeInteraction(interactionId)
    return { accepted: true }
  }

  async respondQuestion(interactionId: string, answer: AskUserQuestionAnswer): Promise<{ accepted: true }> {
    const interaction = this.pendingInteractions.get(interactionId)
    if (!interaction || interaction.kind !== 'question') {
      throw new TuiSessionError('not-selected', `no pending question ${interactionId}`)
    }
    const result: TuiForwardedEventResult = {
      clientId: interaction.clientId,
      eventId: interaction.eventId,
      outcome: { kind: 'result', value: answer },
    }
    await this.requireHost().remote.events.respond(result)
    this.pendingInteractions.delete(interactionId)
    this.removeInteraction(interactionId)
    return { accepted: true }
  }

  dispose(): void {
    this.promptController?.abort()
    this.followController?.abort()
    this.controlController?.abort()
    this.eventController?.abort()
    this.followController = null
    this.controlController = null
    this.eventController = null
    this.promptController = null
    this.activePrompt = null
    this.queuedPrompts = []
    this.drainingPrompts = false
    this.activeHost = null
    this.pendingInteractions.clear()
    this.loadingOlder = false
    if (this.current) {
      this.current = freezeSnapshot({ ...this.current, live: false, error: this.current.error ?? 'session disposed' })
      this.notify()
    }
  }

  private async select(
    host: TuiSessionHost,
    prepare: () => Promise<{ host: TuiSessionHost; snapshot: TuiSessionSnapshot }>,
  ): Promise<TuiSessionSnapshot> {
    if (this.selecting) {
      throw new TuiSessionError('selection-in-progress', 'Session selection is already in progress')
    }
    this.selecting = true
    try {
      const target = await prepare()
      this.followController?.abort()
      this.followController = null
      this.controlController?.abort()
      this.controlController = null
      this.eventController?.abort()
      this.eventController = null
      this.promptController?.abort()
      this.promptController = null
      this.activePrompt = null
      this.queuedPrompts = []
      this.drainingPrompts = false
      this.activeHost = target.host
      this.current = target.snapshot
      this.pendingInteractions.clear()
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
      queue: [],
      jobs: [],
      ...(hydrated.projections === undefined ? {} : { projections: hydrated.projections }),
    })
    return { host, snapshot }
  }

  private async hydrate(
    host: TuiSessionHost,
    sessionId: SessionId,
  ): Promise<{ entries: readonly TuiHistoryEntry[]; projections?: SessionProjectionBaseline; lastSeq: number; hasMoreBefore: boolean }> {
    const controller = new AbortController()
    let snapshot: SessionFollowFrame & { readonly type: 'snapshot' } | null = null
    try {
      for await (const frame of host.remote.session.follow(
        { address: addressFor(sessionId), maxMessages: TUI_HISTORY_PAGE_MESSAGES },
        controller.signal,
      )) {
        if (frame.type === 'snapshot') {
          snapshot = frame
          break
        }
      }
    } finally {
      controller.abort()
    }
    if (snapshot === null) {
      throw new TuiSessionError('host-error', 'session.follow opened without an initial snapshot')
    }
    const entries = normalizeHistoryRecords(snapshot.records)
    const projections = snapshot.projections
    const last = lastSeqOf(entries)
    return {
      entries: Object.freeze([...entries]),
      ...(projections === undefined ? {} : { projections }),
      lastSeq: snapshot.cursor >= 0 ? snapshot.cursor : (last >= 0 ? last : -1),
      hasMoreBefore: snapshot.hasMore,
    }
  }

  private startLive(host: TuiSessionHost, sessionId: SessionId): void {
    const controlController = new AbortController()
    const followController = new AbortController()
    const eventController = new AbortController()
    this.controlController = controlController
    this.followController = followController
    this.eventController = eventController
    void this.pumpControl(host, controlController.signal)
    void this.pumpFollow(host, sessionId, followController.signal)
    void this.pumpEvents(host, eventController.signal)
  }

  private async pumpControl(host: TuiSessionHost, signal: AbortSignal): Promise<void> {
    try {
      for await (const frame of host.remote.session.control(signal)) {
        if (this.current === null) return
        this.applyControlFrame(frame)
      }
      if (!signal.aborted) this.fail('control stream ended without abort')
    } catch (error) {
      if (!signal.aborted) this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  private async pumpFollow(host: TuiSessionHost, sessionId: SessionId, signal: AbortSignal): Promise<void> {
    try {
      for await (const frame of host.remote.session.follow(
        { address: addressFor(sessionId), maxMessages: TUI_HISTORY_PAGE_MESSAGES },
        signal,
      )) {
        if (this.current?.sessionId !== sessionId) return
        this.applyFollowFrame(frame)
      }
      if (!signal.aborted) this.fail('session follow stream ended without abort')
    } catch (error) {
      if (!signal.aborted) this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  private async pumpEvents(host: TuiSessionHost, signal: AbortSignal): Promise<void> {
    try {
      for await (const frame of host.remote.events.follow(signal)) {
        this.applyForwardedEvent(frame)
      }
      if (!signal.aborted) this.fail('forwarded event stream ended without abort')
    } catch (error) {
      if (!signal.aborted) this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  private applyControlFrame(frame: SessionControlFrame): void {
    const sessionId = this.current?.sessionId
    if (!sessionId) return
    if (frame.type === 'baseline') {
      const queues = frame.value.queues[sessionId] ?? []
      const jobs = frame.value.jobs[sessionId] ?? []
      this.update(snapshot => freezeSnapshot({
        ...snapshot,
        queue: this.queueWithLocal(queues),
        jobs,
        ...(frame.value.projections[sessionId] === undefined
          ? {}
          : { projections: frame.value.projections[sessionId] }),
      }))
      return
    }
    if (frame.type === 'queue' && frame.sessionId === sessionId) {
      this.update(snapshot => freezeSnapshot({ ...snapshot, queue: this.queueWithLocal(frame.items) }))
      return
    }
    if (frame.type === 'jobs' && frame.sessionId === sessionId) {
      this.update(snapshot => freezeSnapshot({ ...snapshot, jobs: frame.jobs }))
      return
    }
    if (frame.type === 'projection' && frame.sessionId === sessionId) {
      this.update(snapshot => freezeSnapshot({
        ...snapshot,
        projections: {
          asOfSeq: Math.max(snapshot.projections?.asOfSeq ?? -1, frame.seq),
          values: {
            ...(snapshot.projections?.values ?? {}),
            [frame.key]: frame.value,
          },
        },
      }))
    }
  }

  private applyFollowFrame(frame: SessionFollowFrame): void {
    if (frame.type === 'snapshot') {
      const records = normalizeHistoryRecords(frame.records)
      const entries = mergeHistoryEntries(this.current?.entries ?? [], records)
      this.update(snapshot => freezeSnapshot({
        ...snapshot,
        live: true,
        lastSeq: Math.max(snapshot.lastSeq, lastSeqOf(records)),
        entries,
        hasMoreBefore: frame.hasMore,
        ...(frame.projections === undefined ? {} : { projections: frame.projections }),
      }))
      return
    }
    this.applyLiveEvent(frame.event)
  }

  private applyForwardedEvent(frame: TuiForwardedEvent): void {
    if (frame.type === 'ready') {
      this.forwardedClientId = frame.clientId
      return
    }
    if (frame.type === 'emit') {
      const event = frame.event
      const args = frame.args
      if (event === 'api-session/status') {
        const sessionId = args[0] as string | undefined
        const running = args[1] as boolean | undefined
        if (typeof sessionId === 'string') {
          for (const listener of [...this.subagentListeners]) {
            listener({ agentId: sessionId as SessionId, type: running ? 'started' : 'stopped' })
          }
        }
        return
      }
      if (event === 'api-session/removed') {
        const sessionId = args[0] as string | undefined
        if (typeof sessionId === 'string') {
          for (const listener of [...this.subagentListeners]) {
            listener({ agentId: sessionId as SessionId, type: 'stopped' })
          }
        }
        return
      }
      if (event === 'api-session/error') {
        const sessionId = args[0] as string | undefined
        if (typeof sessionId === 'string') {
          for (const listener of [...this.subagentListeners]) {
            listener({ agentId: sessionId as SessionId, type: 'stopped' })
          }
        }
        return
      }
      return
    }
    if (frame.type === 'waterfall') {
      if (frame.event === 'approval/request') {
        const request = frame.request as Record<string, unknown>
        const interactionId = `approval:${frame.eventId}`
        this.pendingInteractions.set(interactionId, {
          clientId: this.forwardedClientId,
          eventId: frame.eventId,
          kind: 'approval',
          approvalId: String(request.approvalId ?? ''),
        })
        this.update(snapshot => freezeSnapshot({
          ...snapshot,
          interactions: [
            ...snapshot.interactions.filter(item => item.interactionId !== interactionId),
            {
              kind: 'approval',
              interactionId,
              approvalId: String(request.approvalId ?? ''),
              toolName: typeof request.toolName === 'string' ? request.toolName : 'tool',
            },
          ],
        }))
        return
      }
      if (frame.event === 'user-questions/request') {
        const request = frame.request as Record<string, unknown>
        const questions = Array.isArray(request.questions)
          ? request.questions.map(item => asAskUserQuestion(item))
          : []
        const interactionId = `question:${frame.eventId}`
        this.pendingInteractions.set(interactionId, {
          clientId: this.forwardedClientId,
          eventId: frame.eventId,
          kind: 'question',
          questions,
        })
        this.update(snapshot => freezeSnapshot({
          ...snapshot,
          interactions: [
            ...snapshot.interactions.filter(item => item.interactionId !== interactionId),
            { kind: 'question', interactionId, questions },
          ],
        }))
        return
      }
      return
    }
    if (frame.type === 'cancel') {
      for (const interaction of this.pendingInteractions.values()) {
        if (interaction.eventId === frame.eventId) {
          this.removeInteraction(this.interactionIdFor(interaction))
          this.pendingInteractions.delete(this.interactionIdFor(interaction))
          return
        }
      }
    }
  }

  private forwardedClientId = ''

  private interactionIdFor(
    interaction: { kind: 'approval' | 'question'; eventId: string; approvalId?: string },
  ): string {
    return interaction.kind === 'approval'
      ? `approval:${interaction.approvalId ?? interaction.eventId}`
      : `question:${interaction.eventId}`
  }

  private applyLiveEvent(event: SessionWireEvent): void {
    const turnEnded = event.type === 'turn/end'
    const reasonKind = turnEnded && event.data && typeof event.data === 'object' && event.data.reason && typeof event.data.reason === 'object'
      ? event.data.reason.kind
      : undefined
    let applied = false
    this.update(snapshot => {
      if (event.seq <= snapshot.lastSeq) return snapshot
      if (snapshot.lastSeq !== -1 && event.seq !== snapshot.lastSeq + 1) {
        return freezeSnapshot({
          ...snapshot,
          live: false,
          error: `live sequence gap: expected ${snapshot.lastSeq + 1}, got ${event.seq}`,
        })
      }
      const running = event.type === 'turn/start'
        ? true
        : event.type === 'turn/end'
          ? false
          : snapshot.running
      const turnError = turnEnded && reasonKind !== 'completed'
        ? `turn ended: ${typeof reasonKind === 'string' ? reasonKind : 'unknown'}`
        : snapshot.error
      applied = true
      return freezeSnapshot({
        ...snapshot,
        running,
        lastSeq: event.seq,
        entries: [...snapshot.entries, { event }],
        ...(turnError === undefined ? {} : { error: turnError }),
      })
    })
    if (turnEnded && applied) {
      this.activePrompt?.markLifecycle('ended')
      this.activePrompt = null
      if (reasonKind === 'completed') this.drainPromptQueue()
    } else if (event.type === 'turn/start' && applied) {
      this.activePrompt?.markLifecycle('started')
    }
  }

  private queueOrSendPrompt(
    request: SessionPromptRequest,
    snapshot: TuiSessionSnapshot,
  ): Promise<RemoteResult<{ accepted: true; command?: { kind: 'success'; text?: string } }>> {
    if (this.activePrompt !== null || snapshot.running || this.queuedPrompts.length > 0) {
      const item = Object.freeze({
        id: `local-prompt-${String(request.requestId)}`,
        placement: 'next',
        message: { content: request.content },
      }) as SessionQueuedItem
      this.queuedPrompts.push({ request, item })
      this.update(current => freezeSnapshot({
        ...current,
        queue: [...current.queue, item],
      }))
      return Promise.resolve({ ok: true, value: { accepted: true } })
    }
    return this.sendPrompt(request)
  }

  private async sendPrompt(
    request: SessionPromptRequest,
  ): Promise<RemoteResult<{ accepted: true; command?: { kind: 'success'; text?: string } }>> {
    const controller = new AbortController()
    let markAccepted: () => void = () => undefined
    const accepted = new Promise<void>(resolve => {
      markAccepted = resolve
    })
    let markLifecycle: (state: 'started' | 'ended') => void = () => undefined
    const lifecycle = new Promise<'started' | 'ended'>(resolve => {
      markLifecycle = resolve
    })
    const activePrompt: ActivePrompt = {
      sessionId: request.sessionId,
      requestId: String(request.requestId),
      accepted,
      lifecycle,
      markAccepted: () => markAccepted(),
      markLifecycle: state => markLifecycle(state),
    }
    this.activePrompt = activePrompt
    this.promptController = controller
    try {
      const result = await this.requireHost().remote.session.prompt(request, controller.signal)
      activePrompt.markAccepted()
      if (!result.ok) {
        activePrompt.markLifecycle('ended')
        this.clearActivePrompt(String(request.requestId))
        this.update(current => freezeSnapshot({ ...current, error: result.error.message }))
      }
      return result
    } catch (error) {
      activePrompt.markAccepted()
      activePrompt.markLifecycle('ended')
      this.clearActivePrompt(String(request.requestId))
      throw error
    } finally {
      activePrompt.markAccepted()
      if (this.promptController === controller) this.promptController = null
    }
  }

  private clearActivePrompt(requestId: string): void {
    if (this.activePrompt?.requestId === requestId) this.activePrompt = null
  }

  private drainPromptQueue(): void {
    if (this.drainingPrompts || this.activePrompt !== null || this.current?.running === true) return
    const next = this.queuedPrompts.shift()
    if (next === undefined) return
    this.drainingPrompts = true
    this.update(current => freezeSnapshot({
      ...current,
      queue: current.queue.filter(item => String(item.id) !== String(next.item.id)),
    }))
    void this.sendPrompt(next.request).then(result => {
      if (result.ok) return
      this.requeuePrompt(next, result.error.message)
    }).catch(error => {
      this.requeuePrompt(next, error instanceof Error ? error.message : String(error))
    }).finally(() => {
      this.drainingPrompts = false
    })
  }

  private requeuePrompt(item: LocalQueuedPrompt, message: string): void {
    this.queuedPrompts.unshift(item)
    this.update(current => freezeSnapshot({
      ...current,
      queue: this.queueWithLocal(current.queue),
      error: message,
    }))
  }

  private queueWithLocal(queue: readonly SessionQueuedItem[]): readonly SessionQueuedItem[] {
    const localIds = new Set(this.queuedPrompts.map(prompt => String(prompt.item.id)))
    return [
      ...queue.filter(item => !localIds.has(String(item.id))),
      ...this.queuedPrompts.map(prompt => prompt.item),
    ]
  }

  private removeInteraction(interactionId: string): void {
    this.update(snapshot => freezeSnapshot({
      ...snapshot,
      interactions: snapshot.interactions.filter(item => item.interactionId !== interactionId),
    }))
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

function asAskUserQuestion(value: unknown): AskUserQuestionItem {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TuiSessionError('host-error', 'question item must be an object')
  }
  const record = value as Record<string, unknown>
  const question: AskUserQuestionItem = {
    id: String(record.id),
    question: typeof record.question === 'string' ? record.question : '',
    ...(record.detail === undefined ? {} : { detail: String(record.detail) }),
    ...(record.header === undefined ? {} : { header: String(record.header) }),
    ...(record.options === undefined ? {} : {
      options: (record.options as unknown[]).map(option => {
        const optionRecord = option as Record<string, unknown>
        return {
          label: String(optionRecord.label),
          ...(optionRecord.description === undefined ? {} : { description: String(optionRecord.description) }),
        }
      }),
    }),
    ...(record.multiSelect === undefined ? {} : { multiSelect: Boolean(record.multiSelect) }),
  }
  return question
}

export const name = 'session'

export function apply(ctx: Context): void {
  new TuiSessionService(ctx)
}
