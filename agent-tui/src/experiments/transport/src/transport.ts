/**
 * Thin alpha4 wire client for the DSH TUI.
 *
 * Owns: endpoint validation, the HTTP `/api/<ns>/<method>` RPC carrier, the
 * `/api/remote.mux` WebSocket stream carrier, and the `/api/session.export`
 * ZIP download. Other modules consume the typed `TuiAlpha4Host` surface and
 * must not speak the wire directly.
 *
 * The legacy host API was removed in alpha4; the wire shapes below come from
 * `@deepseek-ai/dsh-client-connection`
 * and `@deepseek-ai/dsh-api-gateway/src/stream-protocol.ts`.
 */

import { randomUUID } from 'node:crypto'
/** Local projection of the connection-level result envelope; declared inline to keep transport self-contained. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }
interface ServerResponse {
  readonly type: 'server-response'
  readonly rpcId: string
  readonly result: RemoteResult<unknown>
}
import type {
  QueueAction,
  SessionAddress,
  SessionControlFrame,
  SessionCreateRequest,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionHistoryRecord,
  SessionPage,
  SessionPageRequest,
  SessionPromptRequest,
  SessionPromptValue,
  SessionSelectModelRequest,
  SessionSummary,
  SessionUpdateQueueRequest,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
} from '@deepseek-ai/dsh-user-questions/types'
import type {
  ApprovalOutcome,
} from '@deepseek-ai/dsh-user-approval/types'

export const DEFAULT_ENDPOINT = 'http://127.0.0.1:3080'

/** Exact WebSocket route carrying every Typert Remote stream. */
export const REMOTE_STREAM_MUX_PATH = '/api/remote.mux'
const SESSION_LOG_EXPORT_PATH = '/api/session.export'

export interface EndpointPrecedence {
  readonly cli?: string
  readonly env?: string
}

export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts[0] !== '127') return false
  return parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

export function validateEndpoint(value: string): URL {
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new TypeError(`invalid DSH endpoint: ${value}`)
  }
  if (endpoint.protocol !== 'http:') {
    throw new TypeError(`DSH endpoint must use http:, got ${endpoint.protocol}`)
  }
  if (endpoint.username !== '' || endpoint.password !== '') {
    throw new TypeError('DSH endpoint must not contain credentials')
  }
  if (endpoint.search !== '' || endpoint.hash !== '') {
    throw new TypeError('DSH endpoint must not contain query or fragment')
  }
  if (endpoint.pathname !== '/') {
    throw new TypeError(`DSH endpoint must use the origin root, got ${endpoint.pathname}`)
  }
  if (!isLoopbackHostname(endpoint.hostname)) {
    throw new TypeError(`DSH endpoint must target loopback, got ${endpoint.hostname}`)
  }
  return new URL(endpoint.origin)
}

export function resolveEndpoint(precedence: EndpointPrecedence = {}): URL {
  return validateEndpoint(precedence.cli ?? precedence.env ?? DEFAULT_ENDPOINT)
}

/** Remote carrier result envelope; the connection layer keeps the wire form. */

/** Stream frame kinds carried by the `/api/remote.mux` carrier. */
export type RemoteStreamFrame =
  | { readonly type: 'item'; readonly streamId: string; readonly value?: unknown }
  | { readonly type: 'end'; readonly streamId: string }
  | { readonly type: 'error'; readonly streamId: string; readonly error: { readonly code: string; readonly message: string; readonly details: object } }

interface RemoteStreamClientMessage {
  readonly type: 'open' | 'cancel'
  readonly streamId: string
  readonly endpoint?: string
  readonly payload?: unknown
}

interface TuiWebSocket {
  readonly readyState: number
  close(): void
  send(data: string): void
  addEventListener(type: 'open' | 'message' | 'close', handler: (event: { data?: unknown; code?: number }) => void, options?: { once?: boolean }): void
  removeEventListener(type: 'open' | 'message' | 'close', handler: (event: { data?: unknown; code?: number }) => void): void
}
type TuiWebSocketCtor = new (url: string) => TuiWebSocket

function websocketCtor(): TuiWebSocketCtor {
  const Ctor = (globalThis as { WebSocket?: TuiWebSocketCtor }).WebSocket
  if (typeof Ctor !== 'function') {
    throw new Error('transport failure: global WebSocket is unavailable in this Node runtime (Node >= 22 required)')
  }
  return Ctor
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRemoteFrame(value: unknown): RemoteStreamFrame {
  if (!isRecord(value) || typeof value.streamId !== 'string' || value.streamId.length === 0) {
    throw new Error('transport failure: Remote stream frame must carry streamId')
  }
  if (value.type === 'item') {
    return Object.hasOwn(value, 'value')
      ? { type: 'item', streamId: value.streamId, value: value.value }
      : { type: 'item', streamId: value.streamId }
  }
  if (value.type === 'end') return { type: 'end', streamId: value.streamId }
  if (value.type === 'error') {
    const error = value.error
    if (!isRecord(error)
      || typeof error.code !== 'string'
      || typeof error.message !== 'string'
      || typeof error.details !== 'object' || error.details === null) {
      throw new Error('transport failure: Remote stream error must carry {code,message,details}')
    }
    return { type: 'error', streamId: value.streamId, error: { code: error.code, message: error.message, details: error.details } }
  }
  throw new Error('transport failure: Remote stream frame type is unknown')
}

/** Options consumed when constructing a host wire client. */
export interface TuiAlpha4HostOptions {
  /** Cookie attached to every `/api` request when an authenticated host serves it. */
  readonly cookie?: string
  /** Override the global `fetch`; tests inject a recorder here. */
  readonly fetchImpl?: typeof fetch
  /** Override the global `WebSocket`; tests inject a recorder here. */
  readonly websocketImpl?: TuiWebSocketCtor
}

/** Exact method used to settle a forwarded-event waterfall. */
export const FORWARDED_EVENT_RESULT_ENDPOINT = '$events/result'
/** Exact WebSocket endpoint that delivers the forwarded Host events. */
export const FORWARDED_EVENT_STREAM_ENDPOINT = '$events'
/** Host facts delivered alongside the opening forwarded-event frame. */
export interface TuiForwardedEventHostInfo {
  readonly home: string
}

/** Opening item proving the forwarded-event generation is ready. */
export interface TuiForwardedEventReadyFrame {
  readonly type: 'ready'
  readonly clientId: string
  readonly host: TuiForwardedEventHostInfo
}

/** Emit-style forwarded event notification. */
export interface TuiForwardedEventEmitFrame {
  readonly type: 'emit'
  readonly event: string
  readonly args: readonly unknown[]
}

/** Waterfall-style forwarded event delivery awaiting a client response. */
export interface TuiForwardedEventInvocationFrame {
  readonly type: 'waterfall'
  readonly event: string
  readonly eventId: string
  readonly agentId: string
  readonly request: Readonly<Record<string, unknown>>
}

/** Cancellation of a previously delivered waterfall. */
export interface TuiForwardedEventCancellationFrame {
  readonly type: 'cancel'
  readonly eventId: string
}

export type TuiForwardedEvent =
  | TuiForwardedEventReadyFrame
  | TuiForwardedEventEmitFrame
  | TuiForwardedEventInvocationFrame
  | TuiForwardedEventCancellationFrame

/** Outcome returned by the TUI client to one pending Host waterfall. */
export interface TuiForwardedEventOutcome {
  readonly kind: 'next' | 'result' | 'rejected'
  readonly value?: unknown
  readonly error?: { readonly name: string; readonly message: string; readonly code?: string; readonly details?: unknown }
}

/** Payload delivered to the Gateway result HTTP endpoint. */
export interface TuiForwardedEventResult {
  readonly clientId: string
  readonly eventId: string
  readonly outcome: TuiForwardedEventOutcome
}

export function parseForwardedEventFrame(value: unknown): TuiForwardedEvent {
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    throw new Error('transport failure: forwarded-event frame must carry a string type')
  }
  const type = value['type']
  if (type === 'ready') {
    if (typeof value['clientId'] !== 'string' || value['clientId'].length === 0) {
      throw new Error('transport failure: forwarded-event ready frame requires clientId')
    }
    const host = value['host']
    if (!isRecord(host) || typeof host['home'] !== 'string') {
      throw new Error('transport failure: forwarded-event ready frame requires host.home')
    }
    return { type: 'ready', clientId: value['clientId'], host: { home: host['home'] } }
  }
  if (type === 'emit') {
    if (typeof value['event'] !== 'string' || !Array.isArray(value['args'])) {
      throw new Error('transport failure: forwarded-event emit frame requires event and args')
    }
    return { type: 'emit', event: value['event'], args: value['args'] as readonly unknown[] }
  }
  if (type === 'waterfall') {
    if (typeof value['event'] !== 'string'
      || typeof value['eventId'] !== 'string'
      || typeof value['agentId'] !== 'string'
      || !isRecord(value['request'])) {
      throw new Error('transport failure: forwarded-event waterfall frame requires event/eventId/agentId/request')
    }
    return {
      type: 'waterfall',
      event: value['event'],
      eventId: value['eventId'],
      agentId: value['agentId'],
      request: value['request'],
    }
  }
  if (type === 'cancel') {
    if (typeof value['eventId'] !== 'string') {
      throw new Error('transport failure: forwarded-event cancel frame requires eventId')
    }
    return { type: 'cancel', eventId: value['eventId'] }
  }
  throw new Error(`transport failure: forwarded-event frame type is unknown: ${type}`)
}

/**
 * Typed alpha4 Remote namespace callers may use.
 *
 * The namespace names intentionally mirror the generated declarations from the
 * alpha4 Remote client packages (`@deepseek-ai/dsh-api-session-controller`,
 * `@deepseek-ai/dsh-api-workspace-controller`, `@deepseek-ai/dsh-goal`, etc.)
 * while remaining a thin typed projection. This file is the transport owner:
 * business modules import only this typed facade and never the published
 * browser-only Client bundles or the raw HTTP/WebSocket wire.
 */
export interface TuiAlpha4Remote {
  readonly session: {
    list(signal?: AbortSignal): Promise<RemoteResult<{ items: readonly SessionSummary[] }>>
    create(request: SessionCreateRequest): Promise<RemoteResult<{ sessionId: string; agentPreset?: string }>>
    fork(request: { sessionId: string; atSeq?: number }): Promise<RemoteResult<{ sessionId: string }>>
    openWorkspacePath(request: { path: string }): Promise<RemoteResult<unknown>>
    page(request: SessionPageRequest, signal?: AbortSignal): Promise<RemoteResult<SessionPage>>
    follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame>
    control(signal: AbortSignal): AsyncIterable<SessionControlFrame>
    prompt(request: SessionPromptRequest): Promise<RemoteResult<SessionPromptValue>>
    updateQueue(request: SessionUpdateQueueRequest): Promise<RemoteResult<{ accepted: true }>>
    cancel(request: { sessionId: string }): Promise<RemoteResult<{ accepted: true }>>
    selectModel(request: SessionSelectModelRequest): Promise<RemoteResult<{ selected: { provider: string; model: string; reasoningEffort?: string } }>>
    modelCatalog(): Promise<RemoteResult<unknown>>
    search(request: { query: string }, signal?: AbortSignal): Promise<RemoteResult<{ items: readonly { sessionId: string; snippet: string }[]; hasMore: boolean }>>
    rename(request: { sessionId: string; title: string }): Promise<RemoteResult<{ title: string; seq: number }>>
  }
  readonly workspace: {
    follow(signal: AbortSignal): AsyncIterable<{ readonly type: 'baseline'; readonly value: { readonly items: readonly unknown[]; readonly archivedSessionIds: readonly unknown[] } } | { readonly type: 'upsert' | 'remove' | 'order' | 'archived'; readonly workspace?: unknown; readonly workspaceId?: unknown; readonly workspaceIds?: readonly unknown[]; readonly archivedSessionIds?: readonly unknown[] }>
    list(): Promise<RemoteResult<unknown>>
    create(request: { path: string }): Promise<RemoteResult<unknown>>
    rename(request: { workspaceId: string; title: string }): Promise<RemoteResult<unknown>>
    delete(request: { workspaceId: string }): Promise<RemoteResult<unknown>>
    archiveSession(request: { sessionId: string }): Promise<RemoteResult<unknown>>
  }
  readonly directoryPicker: {
    list(path: string | undefined, signal?: AbortSignal): Promise<RemoteResult<unknown>>
    pick(signal?: AbortSignal): Promise<RemoteResult<string | null>>
    createDirectory(path: string, name: string): Promise<RemoteResult<string>>
  }
  readonly settings: {
    describe(): Promise<RemoteResult<unknown>>
    mutate(ns: string, ops: readonly unknown[], expectedRevision: number | undefined): Promise<RemoteResult<unknown>>
    openSettingsDocument(signal?: AbortSignal): Promise<RemoteResult<unknown>>
  }
  readonly credentials: {
    describe(refs: readonly string[]): Promise<RemoteResult<unknown>>
  }
  readonly agentPresets: {
    list(): Promise<RemoteResult<unknown>>
    select(agentId: string, agentPreset: string): Promise<RemoteResult<string>>
    read(agentPreset: string): Promise<RemoteResult<unknown>>
    copy(from: string, id: string, name?: string): Promise<RemoteResult<void>>
    deletePreset(id: string): Promise<RemoteResult<void>>
  }
  readonly goals: {
    pause(agentId: string, ref: { readonly id: string; readonly revision: number }): Promise<RemoteResult<unknown>>
    resume(agentId: string, ref: { readonly id: string; readonly revision: number }): Promise<RemoteResult<unknown>>
    clear(agentId: string, ref: { readonly id: string; readonly revision: number }): Promise<RemoteResult<unknown>>
    edit(agentId: string, ref: { readonly id: string; readonly revision: number }, request: { readonly objective: string }): Promise<RemoteResult<unknown>>
  }
  readonly llm: {
    listProviders(): Promise<RemoteResult<unknown>>
    listConfigurableProviders(): Promise<RemoteResult<unknown>>
    discoverModels(settingsNs: string, request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  }
  readonly skills: {
    list(request: { sessionId: string }): Promise<RemoteResult<unknown>>
  }
  readonly subagents: {
    list(parentSessionId: string, signal?: AbortSignal): Promise<RemoteResult<unknown>>
    prompt(request: { parentSessionId: string; childSessionId: string; mode: 'continuable'; content: readonly unknown[]; clientTimeZone?: string }, signal?: AbortSignal): Promise<RemoteResult<unknown>>
    interruptByParent(childSessionId: string, parentSessionId: string, mode: 'continuable'): Promise<RemoteResult<unknown>>
  }
  readonly commands: {
    execute(agentId: string, line: string, images: readonly unknown[], signal?: AbortSignal): Promise<RemoteResult<{ readonly kind: 'success'; readonly text?: string } | undefined>>
  }
  readonly events: {
    follow(signal: AbortSignal): AsyncIterable<TuiForwardedEvent>
    respond(result: TuiForwardedEventResult): Promise<void>
  }
}

/**
 * Thin alpha4 wire client.
 *
 * Exposes `call()` for typed unary HTTP RPC, `stream()` for logical
 * `/api/remote.mux` streams, `$events` for forwarded Host events, and
 * `exportSessionLog()` for the ZIP download.
 */
export class TuiAlpha4Host {
  private readonly base: string
  private readonly cookie?: string
  private readonly fetchImpl: typeof fetch
  private readonly websocketImpl: TuiWebSocketCtor
  private disposed = false

  constructor(endpoint: URL, options: TuiAlpha4HostOptions = {}) {
    if (!(endpoint instanceof URL)) throw new TypeError('endpoint must be a URL')
    this.base = endpoint.origin
    if (options.cookie !== undefined) {
      if (typeof options.cookie !== 'string' || options.cookie.length === 0) {
        throw new TypeError('cookie must be a non-empty string when provided')
      }
      this.cookie = options.cookie
    }
    this.fetchImpl = options.fetchImpl ?? fetch
    this.websocketImpl = options.websocketImpl ?? websocketCtor()
  }

  get origin(): string {
    return this.base
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  private authHeaders(): Record<string, string> {
    return this.cookie === undefined ? {} : { cookie: this.cookie }
  }

  /**
   * Send one unary RPC over `POST /api/<method>`.
   * The promise resolves with the validated `RemoteResult<T>`; transport faults reject.
   */
  async call<T>(method: string, args: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<RemoteResult<T>> {
    if (this.disposed) throw new Error('transport failure: TuiAlpha4Host is disposed')
    if (typeof method !== 'string' || method.length === 0) throw new TypeError('method must be a non-empty string')
    if (!isRecord(args)) throw new TypeError('args must be an object')
    const rpcId = randomUUID()
    const url = new URL(`/api/${method}`, this.base)
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (signal?.aborted === true) throw new Error('transport failure: unary RPC cancelled', { cause: error })
      throw new Error(`transport failure for /api/${method}: ${String((error as Error | undefined)?.message ?? error)}`)
    }
    if (!response.ok) {
      throw new Error(`transport failure for /api/${method}: HTTP ${String(response.status)}`)
    }
    let parsed: unknown
    try {
      parsed = await response.json()
    } catch (error) {
      throw new Error(`transport failure for /api/${method}: response is not JSON`, { cause: error })
    }
    if (!isRecord(parsed)
      || parsed.type !== 'server-response'
      || typeof parsed.rpcId !== 'string'
      || !isRecord(parsed.result)) {
      throw new Error(`transport failure for /api/${method}: malformed server-response envelope`)
    }
    const envelope = parsed as Partial<ServerResponse>
    if (envelope.rpcId !== rpcId) {
      throw new Error(`transport failure for /api/${method}: rpcId mismatch (sent ${rpcId}, got ${String(envelope.rpcId)})`)
    }
    return envelope.result as RemoteResult<T>
  }

  /** Typed namespace adapter. Each namespace call maps onto {@link call}. */
  get remote(): TuiAlpha4Remote {
    const call = this.call.bind(this)
    const json = (value: object): Readonly<Record<string, unknown>> => ({ ...value })
    const callJson = <T>(method: string, value: object, signal?: AbortSignal): Promise<RemoteResult<T>> =>
      call<T>(method, json(value), signal)
    return {
      session: {
        list: signal => call('session/list', {}, signal),
        create: request => callJson('session/create', request),
        fork: request => callJson('session/fork', request),
        openWorkspacePath: request => callJson('session/openWorkspacePath', request),
        page: (request, signal) => callJson('session/page', request, signal),
        follow: (request, signal) => this.typedStream<SessionFollowFrame>('session/follow', json(request), signal),
        control: signal => this.typedStream<SessionControlFrame>('session/control', {}, signal),
        prompt: request => callJson('session/prompt', request),
        updateQueue: request => callJson('session/updateQueue', request),
        cancel: request => callJson('session/cancel', request),
        selectModel: request => callJson('session/selectModel', request),
        modelCatalog: () => call('session/modelCatalog', {}),
        search: (request, signal) => callJson('session/search', request, signal),
        rename: request => callJson('session/rename', request),
      },
      workspace: {
        follow: signal => this.typedStream('workspace/follow', {}, signal),
        list: () => call('workspace/list', {}),
        create: request => callJson('workspace/create', request),
        rename: request => callJson('workspace/rename', request),
        delete: request => callJson('workspace/delete', request),
        archiveSession: request => callJson('workspace/archiveSession', request),
      },
      directoryPicker: {
        list: (path, signal) => call('directoryPicker/list', { path }, signal),
        pick: signal => call('directoryPicker/pick', {}, signal),
        createDirectory: (path, name) => callJson('directoryPicker/createDirectory', { path, name }),
      },
      settings: {
        describe: () => call('settings/describe', {}),
        mutate: (ns, ops, expectedRevision) => callJson('settings/mutate', { ns, ops, expectedRevision }),
        openSettingsDocument: signal => call('settings/openSettingsDocument', {}, signal),
      },
      credentials: {
        describe: refs => callJson('credentials/describe', { refs }),
      },
      agentPresets: {
        list: () => call('agentPresets/list', {}),
        select: (agentId, agentPreset) => callJson('agentPresets/select', { agentId, agentPreset }),
        read: agentPreset => callJson('agentPresets/read', { agentPreset }),
        copy: (from, id, name) => callJson('agentPresets/copy', { from, id, name }),
        deletePreset: id => callJson('agentPresets/deletePreset', { id }),
      },
      goals: {
        pause: (agentId, ref) => callJson('goals/pause', { agentId, ref }),
        resume: (agentId, ref) => callJson('goals/resume', { agentId, ref }),
        clear: (agentId, ref) => callJson('goals/clear', { agentId, ref }),
        edit: (agentId, ref, request) => callJson('goals/edit', { agentId, ref, ...request }),
      },
      llm: {
        listProviders: () => call('llm/listProviders', {}),
        listConfigurableProviders: () => call('llm/listConfigurableProviders', {}),
        discoverModels: (settingsNs, request, signal) => callJson('llm/discoverModels', { settingsNs, ...(request as object) }, signal),
      },
      skills: {
        list: request => callJson('skills/list', request),
      },
      subagents: {
        list: (parentSessionId, signal) => callJson('subagents/list', { parentSessionId }, signal),
        prompt: (request, signal) => callJson('subagents/prompt', request, signal),
        interruptByParent: (childSessionId, parentSessionId, mode) => callJson('subagents/interruptByParent', { childSessionId, parentSessionId, mode }),
      },
      commands: {
        execute: (agentId, line, images, signal) => callJson('commands/execute', { agentId, line, images }, signal),
      },
      events: {
        follow: signal => this.forwardedEventStream(signal),
        respond: result => this.respondForwardedEvent(result),
      },
    }
  }

  /**
   * Open the Gateway-internal forwarded-event stream and yield typed frames.
   *
   * The caller owns an AbortSignal; cancellation closes the WebSocket carrier.
   * Waterfall frames are answered through {@link respondForwardedEvent}.
   */
  async *forwardedEventStream(signal: AbortSignal): AsyncGenerator<TuiForwardedEvent, void, void> {
    if (this.disposed) throw new Error('transport failure: TuiAlpha4Host is disposed')
    if (signal === undefined) throw new TypeError('forwarded event stream requires an AbortSignal')
    signal.throwIfAborted()
    for await (const raw of this.stream(FORWARDED_EVENT_STREAM_ENDPOINT, {}, signal)) {
      if (raw.type === 'error') {
        throw new Error(`transport failure: forwarded-event stream ended with ${raw.error.code}: ${raw.error.message}`)
      }
      if (raw.type !== 'item') continue
      yield parseForwardedEventFrame(raw.value)
    }
  }

  /**
   * Return one waterfall outcome to the Host through the `$events/result`
   * unary RPC. `kind: 'next'` delegates to the next listener.
   */
  async respondForwardedEvent(result: TuiForwardedEventResult): Promise<void> {
    if (!result || typeof result.clientId !== 'string' || typeof result.eventId !== 'string' || !result.outcome) {
      throw new TypeError('forwarded-event result requires clientId, eventId and outcome')
    }
    await this.call<{ accepted?: true }>(FORWARDED_EVENT_RESULT_ENDPOINT, { ...result })
  }

  /**
   * Open one typed `session/follow` / `session/control` / `$events` stream.
   * Item values are returned as typed frames after structural validation.
   */
  async *typedStream<T>(endpoint: string, args: Readonly<Record<string, unknown>>, signal: AbortSignal): AsyncGenerator<T, void, void> {
    for await (const raw of this.stream(endpoint, args, signal)) {
      if (raw.type === 'item') yield raw.value as T
      else if (raw.type === 'error') throw new Error(`transport failure: Remote stream ${endpoint} ended with ${raw.error.code}: ${raw.error.message}`)
      else return
    }
  }

  /**
   * Open one logical stream on the shared `/api/remote.mux` carrier.
   * Yields raw wire frames so consumers can validate and project; cancellation
   * closes the underlying WebSocket.
   */
  async *stream(endpoint: string, args: Readonly<Record<string, unknown>>, signal: AbortSignal): AsyncGenerator<RemoteStreamFrame, void, void> {
    if (this.disposed) throw new Error('transport failure: TuiAlpha4Host is disposed')
    if (typeof endpoint !== 'string' || endpoint.length === 0) throw new TypeError('stream endpoint must be a non-empty string')
    if (!isRecord(args)) throw new TypeError('stream args must be an object')
    signal.throwIfAborted()
    const streamId = randomUUID()
    const url = new URL(REMOTE_STREAM_MUX_PATH, this.base)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new this.websocketImpl(String(url))
    type InboxItem = { kind: 'frame'; frame: RemoteStreamFrame } | { kind: 'close'; failure: Error | null }
    const inbox: InboxItem[] = []
    let wake: (() => void) | undefined
    let opened = false
    let terminal = false
    let failure: Error | null = null
    const enqueue = (item: InboxItem): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const handleOpen = (): void => {
      opened = true
      try {
        socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } } satisfies RemoteStreamClientMessage))
      } catch (error) {
        failure = new Error(`transport failure: Remote stream open send failed for ${endpoint}`, { cause: error })
        enqueue({ kind: 'close', failure })
      }
    }
    const handleMessage = (event: { data?: unknown }): void => {
      if (typeof event.data !== 'string') {
        enqueue({ kind: 'close', failure: new Error(`transport failure: Remote stream binary frame on ${endpoint}`) })
        if (socket.readyState === 0 || socket.readyState === 1) socket.close()
        return
      }
      let decoded: unknown
      try {
        decoded = JSON.parse(event.data)
      } catch (error) {
        enqueue({ kind: 'close', failure: new Error(`transport failure: Remote stream invalid JSON on ${endpoint}`, { cause: error }) })
        if (socket.readyState === 0 || socket.readyState === 1) socket.close()
        return
      }
      let frame: RemoteStreamFrame
      try {
        frame = parseRemoteFrame(decoded)
      } catch (error) {
        enqueue({ kind: 'close', failure: error instanceof Error ? error : new Error(String(error)) })
        if (socket.readyState === 0 || socket.readyState === 1) socket.close()
        return
      }
      if (frame.streamId !== streamId) return
      enqueue({ kind: 'frame', frame })
    }
    const handleClose = (): void => { enqueue({ kind: 'close', failure: null }) }
    const handleAbort = (): void => {
      if (socket.readyState === 0 || socket.readyState === 1) socket.close()
    }
    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as InboxItem
          if (item.kind === 'close') {
            if (item.failure !== null) throw item.failure
            terminal = true
            return
          }
          const frame = item.frame
          yield frame
          if (frame.type === 'end') {
            terminal = true
            return
          }
          if (frame.type === 'error') {
            terminal = true
            throw new Error(`transport failure: Remote stream ${endpoint} ended with ${frame.error.code}: ${frame.error.message}`)
          }
        }
        await new Promise<void>(resolve => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      if (!terminal && opened && socket.readyState === 1) {
        try {
          socket.send(JSON.stringify({ type: 'cancel', streamId } satisfies RemoteStreamClientMessage))
        } catch {
          // socket already closed; nothing to cancel
        }
      }
      if (socket.readyState === 0 || socket.readyState === 1) socket.close()
    }
  }

  /** Stream the Session-log ZIP archive as one byte payload. */
  async exportSessionLog(sessionId: string, includeDescendants = true): Promise<Uint8Array> {
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new TypeError('export requires a Session ID')
    if (this.disposed) throw new Error('transport failure: TuiAlpha4Host is disposed')
    const url = new URL(SESSION_LOG_EXPORT_PATH, this.base)
    url.searchParams.set('sessionId', sessionId)
    url.searchParams.set('includeDescendants', String(includeDescendants))
    let response: Response
    try {
      response = await this.fetchImpl(url, { headers: this.authHeaders() })
    } catch (error) {
      throw new Error(`transport failure for ${SESSION_LOG_EXPORT_PATH}: ${String((error as Error | undefined)?.message ?? error)}`)
    }
    if (!response.ok) {
      throw new Error(`transport failure for ${SESSION_LOG_EXPORT_PATH}: HTTP ${String(response.status)}`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }

  /** Release held resources; further calls reject. */
  dispose(): void {
    this.disposed = true
  }
}

export function createTuiAlpha4Host(endpoint: URL, options: TuiAlpha4HostOptions = {}): TuiAlpha4Host {
  return new TuiAlpha4Host(endpoint, options)
}
