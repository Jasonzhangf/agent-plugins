import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'

export const DEFAULT_ENDPOINT = 'http://127.0.0.1:3080'

const MUX_EVENTS_PATH = '/api/events.mux'
const HOST_EVENTS_PATH = '/api/events.host'
const WS_CONNECTING = 0
const WS_OPEN = 1

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

  constructor(endpoint: URL, timeoutMs?: number) {
    super(timeoutMs)
    this.endpoint = new URL(endpoint.origin)
  }

  protected override resolveBase(): string {
    return this.endpoint.origin
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
    const url = new URL(path, this.resolveBase())
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    const inbox: (RpcRequest<F> | typeof END_MARKER)[] = []
    let wake: (() => void) | undefined

    const enqueue = (item: RpcRequest<F> | typeof END_MARKER): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const handleOpen = (): void => onOpen?.()
    const handleMessage = (event: { data: unknown }): void => {
      let full: ServerRequest
      let frame: F
      try {
        if (typeof event.data !== 'string') {
          throw new TypeError('transport WebSocket frame must be text')
        }
        full = serverRequestSchema.parse(JSON.parse(event.data)) as ServerRequest
        frame = frameSchema.parse(full.payload)
      } catch (error) {
        console.error(`[dsh-tui] dropping malformed WebSocket frame on ${path}:`, error)
        return
      }
      this.onEnvelope(full)
      enqueue({ rpcId: full.rpcId, payload: frame })
    }
    const handleClose = (): void => enqueue(END_MARKER)
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
          const item = inbox.shift()
          if (item === END_MARKER) return
          if (item !== undefined) yield item
        }
        await new Promise<void>(resolve => {
          wake = resolve
        })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      handleAbort()
    }
  }
}

const END_MARKER = Symbol('dsh-tui-transport-stream-end')
