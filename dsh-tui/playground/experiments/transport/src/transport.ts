import { randomUUID } from 'node:crypto'
import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, RpcResponse, ServerRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { serverResponseSchema, serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'

// Node 22 exposes a browser-compatible global WebSocket (undici). The DSH web
// host serves the two downlink event streams over WebSocket (an HTTP GET to
// /api/events.* answers 426 Upgrade Required), so the carrier must be
// WebSocket, matching the official WebApiClient. Minimal typed accessor since
// @types/node for this toolchain does not declare the global.
const WS_CONNECTING = 0
const WS_OPEN = 1
interface TuiWebSocket {
  readonly readyState: number
  close(): void
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

export const DEFAULT_ENDPOINT = 'http://127.0.0.1:3080'

const MUX_EVENTS_PATH = '/api/events.mux'
const HOST_EVENTS_PATH = '/api/events.host'

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

type FrameParser<F> = { parse(value: unknown): F }

export class NodeApiClient extends AbstractApiClient {
  private readonly endpoint: URL
  private readonly reconnectDelayMs: number

  constructor(endpoint: URL, timeoutMs?: number, reconnectDelayMs = 250) {
    super(timeoutMs)
    this.endpoint = new URL(endpoint.origin)
    if (!Number.isInteger(reconnectDelayMs) || reconnectDelayMs < 0) {
      throw new TypeError('reconnectDelayMs must be a non-negative integer')
    }
    this.reconnectDelayMs = reconnectDelayMs
  }

  protected override resolveBase(): string {
    return this.endpoint.origin
  }

  /**
   * Execute a Host command through the generic Typert RPC channel. Commands
   * are control-plane operations and must not be sent as model prompt text.
   */
  async command(sessionId: string, line: string): Promise<RpcResponse<{ matched: boolean }>> {
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new TypeError('command requires a Session ID')
    if (typeof line !== 'string' || line.length === 0) throw new TypeError('command requires a non-empty line')
    const rpcId = randomUUID()
    const response = await this.doFetch(new URL('/api/commands/execute', this.resolveBase()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId,
        method: 'commands/execute',
        payload: { args: { agentId: sessionId, line, images: [] } },
      }),
    })
    if (!response.ok) throw new Error(`transport failure for /api/commands/execute: HTTP ${response.status}`)
    const full = serverResponseSchema.parse(await response.json())
    if (full.rpcId !== rpcId) throw new Error(`rpcId mismatch for commands/execute: sent ${rpcId}, got ${full.rpcId}`)
    if (!full.result.ok) return { rpcId: full.rpcId, result: full.result }
    return {
      rpcId: full.rpcId,
      result: { ok: true, value: { matched: full.result.value !== undefined } },
    }
  }

  protected override doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init)
  }

  protected override openMux(
    payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readWebSocket(MUX_EVENTS_PATH, signal, muxFrameSchema, onOpen)
  }

  protected override openHost(
    payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readWebSocket(HOST_EVENTS_PATH, signal, hostFrameSchema, onOpen)
  }

  private async *readWebSocket<F extends MuxFrame | HostFrame>(
    path: string,
    signal: AbortSignal,
    frameSchema: FrameParser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    while (!signal.aborted) {
      yield* this.readWebSocketGeneration(path, signal, frameSchema, onOpen)
      if (signal.aborted) return
      await this.waitForReconnect(signal)
    }
  }

  private async *readWebSocketGeneration<F extends MuxFrame | HostFrame>(
    path: string,
    signal: AbortSignal,
    frameSchema: FrameParser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const url = new URL(path, this.resolveBase())
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const WebSocketCtor = websocketCtor()
    const socket = new WebSocketCtor(String(url))
    type Item = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }
    const inbox: Item[] = []
    let wake: (() => void) | undefined
    const enqueue = (item: Item): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const handleOpen = (): void => { onOpen?.() }
    const handleMessage = (event: { data?: unknown }): void => {
      let full: ServerRequest
      let frame: F
      try {
        if (typeof event.data !== 'string') throw new Error('binary WebSocket frame')
        full = serverRequestSchema.parse(JSON.parse(event.data)) as ServerRequest
        frame = frameSchema.parse(full.payload)
      } catch (error) {
        console.error(`[dsh-tui] dropping malformed WebSocket frame on ${path}:`, error)
        return
      }
      this.onEnvelope(full)
      enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
    }
    const handleClose = (): void => { enqueue({ kind: 'end' }) }
    const handleAbort = (): void => {
      if (socket.readyState === WS_CONNECTING || socket.readyState === WS_OPEN) socket.close()
    }
    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as Item
          if (item.kind === 'end') return
          yield item.envelope
        }
        await new Promise<void>(resolve => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      handleAbort()
    }
  }

  private waitForReconnect(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve()
    return new Promise(resolve => {
      const timer = setTimeout(done, this.reconnectDelayMs)
      function done(): void {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        resolve()
      }
      signal.addEventListener('abort', done, { once: true })
    })
  }
}
