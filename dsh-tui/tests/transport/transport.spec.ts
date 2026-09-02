import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_ENDPOINT,
  REMOTE_STREAM_MUX_PATH,
  TuiAlpha4Host,
  createTuiAlpha4Host,
  FORWARDED_EVENT_STREAM_ENDPOINT,
  FORWARDED_EVENT_RESULT_ENDPOINT,
  isLoopbackHostname,
  resolveEndpoint,
  validateEndpoint,
} from '../../playground/experiments/transport/src/transport.ts'

type AnyEvent = { data?: unknown; code?: number }

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  sent: string[] = []
  readyState = FakeWebSocket.CONNECTING
  private readonly listeners = new Map<string, Set<(event: AnyEvent) => void>>()

  constructor(url: string) {
    this.url = String(url)
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.open())
  }

  open(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.OPEN
    this.emit('open', {})
  }

  emit(type: string, event: AnyEvent = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }

  addEventListener(type: string, listener: (event: AnyEvent) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: (event: AnyEvent) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', { code: 1000 })
  }

  send(data: string): void {
    this.sent.push(data)
  }
}

function openedStreamId(socket: FakeWebSocket): string | null {
  for (const text of socket.sent) {
    try {
      const value = JSON.parse(text) as { type?: string; streamId?: string }
      if (value.type === 'open' && typeof value.streamId === 'string') return value.streamId
    } catch {
      // Ignore malformed probe writes.
    }
  }
  return null
}

function freshWebsockets(): void {
  FakeWebSocket.instances = []
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('resolveEndpoint follows cli over env over default', () => {
  const cli = resolveEndpoint({ cli: 'http://127.0.0.1:4444', env: 'http://127.0.0.1:5555' })
  assert.equal(cli.origin, 'http://127.0.0.1:4444')
  const env = resolveEndpoint({ env: 'http://localhost:5555' })
  assert.equal(env.origin, 'http://localhost:5555')
  const fallback = resolveEndpoint()
  assert.equal(fallback.origin, new URL(DEFAULT_ENDPOINT).origin)
})

test('validateEndpoint accepts only canonical loopback origins', () => {
  for (const value of [
    'http://127.0.0.1:3080',
    'http://127.8.1.9:3080/',
    'http://localhost:3080',
    'http://[::1]:3080',
  ]) {
    assert.equal(validateEndpoint(value).origin, new URL(value).origin)
  }
})

test('validateEndpoint rejects non-loopback or non-origin values', () => {
  for (const value of [
    'https://127.0.0.1:3080',
    'http://192.168.1.1:3080',
    'http://127.0.0.1:3080/root',
    'http://user:pass@127.0.0.1:3080',
    'http://127.0.0.1:3080?x=1',
    'http://127.0.0.1:3080#frag',
    'not a url',
  ]) {
    assert.throws(() => validateEndpoint(value), TypeError)
  }
})

test('isLoopbackHostname covers localhost, IPv6 and 127/8', () => {
  assert.equal(isLoopbackHostname('localhost'), true)
  assert.equal(isLoopbackHostname('[::1]'), true)
  assert.equal(isLoopbackHostname('127.0.0.1'), true)
  assert.equal(isLoopbackHostname('127.255.1.2'), true)
  assert.equal(isLoopbackHostname('192.168.1.1'), false)
  assert.equal(isLoopbackHostname('127.0.0'), false)
})

test('TuiAlpha4Host exposes the validated endpoint as its origin', () => {
  const endpoint = validateEndpoint('http://127.0.0.1:3080')
  const host = createTuiAlpha4Host(endpoint, {
    fetchImpl: (() => Promise.resolve(jsonResponse({ type: 'server-response', rpcId: 'ignored', result: { ok: true, value: null } }))) as typeof fetch,
    websocketImpl: FakeWebSocket,
  })
  assert.equal(host.origin, 'http://127.0.0.1:3080')
  assert.equal(host.isDisposed, false)
  host.dispose()
  assert.equal(host.isDisposed, true)
})

test('call sends an alpha4 unary RPC envelope and returns the typed result', async () => {
  let request: { url: string; init: RequestInit | undefined } | undefined
  const host = new TuiAlpha4Host(validateEndpoint('http://127.0.0.1:3080'), {
    fetchImpl: (async (input: URL | string | Request, init?: RequestInit) => {
      request = { url: String(input), init }
      const body = JSON.parse(String(init?.body)) as { rpcId: string }
      return jsonResponse({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { accepted: true } } })
    }) as typeof fetch,
    websocketImpl: FakeWebSocket,
  })
  const result = await host.call<{ accepted: true }>('session/cancel', { sessionId: 's-1' })
  assert.deepEqual(result, { ok: true, value: { accepted: true } })
  assert.equal(request?.url, 'http://127.0.0.1:3080/api/session/cancel')
  const sent = JSON.parse(String(request?.init?.body)) as { type: string; rpcId: string; method: string; payload: { args: unknown } }
  assert.equal(sent.type, 'client-request')
  assert.equal(typeof sent.rpcId, 'string')
  assert.equal(sent.method, 'session/cancel')
  assert.deepEqual(sent.payload.args, { sessionId: 's-1' })
})

test('call rejects a mismatched server response', async () => {
  const host = new TuiAlpha4Host(validateEndpoint('http://127.0.0.1:3080'), {
    fetchImpl: (async () => jsonResponse({ type: 'server-response', rpcId: 'other', result: { ok: true, value: 1 } })) as typeof fetch,
    websocketImpl: FakeWebSocket,
  })
  await assert.rejects(() => host.call('session/cancel', { sessionId: 's-1' }), /rpcId mismatch/)
})

test('call fails explicitly on non-2xx HTTP responses', async () => {
  const host = new TuiAlpha4Host(validateEndpoint('http://127.0.0.1:3080'), {
    fetchImpl: (async () => jsonResponse({ error: 'server failed' }, 500)) as typeof fetch,
    websocketImpl: FakeWebSocket,
  })
  await assert.rejects(() => host.call('session/cancel', { sessionId: 's-1' }), /HTTP 500/)
})

test('typedStream opens the remote.mux endpoint and unwraps typed items', async () => {
  freshWebsockets()
  const host = new TuiAlpha4Host(validateEndpoint('http://127.0.0.1:3080'), {
    fetchImpl: (async () => jsonResponse({ type: 'server-response', rpcId: 'unused', result: { ok: true, value: null } })) as typeof fetch,
    websocketImpl: FakeWebSocket,
  })
  const controller = new AbortController()
  const values: unknown[] = []
  const reader = (async () => {
    for await (const value of host.typedStream<{ type: 'baseline'; value: readonly number[] }>('session/follow', { address: { kind: 'session', sessionId: 's-1' } }, controller.signal)) {
      values.push(value)
    }
  })()
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  const socket = FakeWebSocket.instances[0]
  assert.ok(socket, 'stream opened a WebSocket')
  assert.equal(socket.url, `ws://127.0.0.1:3080${REMOTE_STREAM_MUX_PATH}`)
  const streamId = openedStreamId(socket)
  assert.equal(typeof streamId, 'string')
  socket.emit('message', { data: JSON.stringify({ type: 'item', streamId, value: { type: 'baseline', value: [1, 2] } }) })
  socket.emit('message', { data: JSON.stringify({ type: 'end', streamId }) })
  await reader
  assert.deepEqual(values, [{ type: 'baseline', value: [1, 2] }])
  controller.abort()
})

test('stream surface exposes raw frames and terminates on a remote error', async () => {
  freshWebsockets()
  const host = new TuiAlpha4Host(validateEndpoint('http://127.0.0.1:3080'), {
    fetchImpl: (async () => jsonResponse({ type: 'server-response', rpcId: 'unused', result: { ok: true, value: null } })) as typeof fetch,
    websocketImpl: FakeWebSocket,
  })
  const controller = new AbortController()
  const frames: string[] = []
  const reader = (async () => {
    try {
      for await (const frame of host.stream('session/control', {}, controller.signal)) frames.push(frame.type)
    } catch (error) {
      frames.push(`error:${String((error as Error).message)}`)
    }
  })()
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  const socket = FakeWebSocket.instances[0]
  assert.ok(socket, 'stream opened a WebSocket')
  const streamId = openedStreamId(socket)
  assert.equal(typeof streamId, 'string')
  socket.emit('message', {
    data: JSON.stringify({ type: 'error', streamId, error: { code: 'session/not-found', message: 'missing', details: {} } }),
  })
  await reader
  assert.equal(frames.at(-1)?.startsWith('error:transport failure: Remote stream session/control ended with session/not-found'), true)
  controller.abort()
})

test('forwardedEventStream opens $events and unwraps ready/emit/waterfall frames', async () => {
  freshWebsockets()
  const host = new TuiAlpha4Host(validateEndpoint('http://127.0.0.1:3080'), {
    fetchImpl: (async () => jsonResponse({ type: 'server-response', rpcId: 'unused', result: { ok: true, value: null } })) as typeof fetch,
    websocketImpl: FakeWebSocket,
  })
  const controller = new AbortController()
  const frames: unknown[] = []
  const reader = (async () => {
    for await (const frame of host.remote.events.follow(controller.signal)) frames.push(frame)
  })()
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  const socket = FakeWebSocket.instances[0]
  assert.ok(socket, 'forwarded events opened a WebSocket')
  const streamId = openedStreamId(socket)
  assert.equal(typeof streamId, 'string')
  const open = socket.sent.map(text => JSON.parse(text) as { type?: string }).find(value => value.type === 'open')
  assert.deepEqual(open && {
    type: open.type,
    endpoint: (open as { endpoint?: string }).endpoint,
    payload: (open as { payload?: unknown }).payload,
  }, {
    type: 'open',
    endpoint: FORWARDED_EVENT_STREAM_ENDPOINT,
    payload: { args: {} },
  })
  socket.emit('message', { data: JSON.stringify({ type: 'item', streamId, value: { type: 'ready', clientId: 'client-1', host: { home: '/home/test' } } }) })
  socket.emit('message', { data: JSON.stringify({ type: 'item', streamId, value: { type: 'emit', event: 'api-session/added', args: [{ sessionId: 's-1' }] } }) })
  socket.emit('message', { data: JSON.stringify({ type: 'item', streamId, value: { type: 'waterfall', event: 'approval/request', eventId: 'w-1', agentId: 'a-1', request: { toolName: 'bash' } } }) })
  socket.emit('message', { data: JSON.stringify({ type: 'end', streamId }) })
  await reader
  assert.equal(frames.length, 3)
  assert.deepEqual(frames[0], { type: 'ready', clientId: 'client-1', host: { home: '/home/test' } })
  assert.deepEqual(frames[1], { type: 'emit', event: 'api-session/added', args: [{ sessionId: 's-1' }] })
  assert.deepEqual(frames[2], { type: 'waterfall', event: 'approval/request', eventId: 'w-1', agentId: 'a-1', request: { toolName: 'bash' } })
  controller.abort()
})

test('respondForwardedEvent posts one client result to $events/result', async () => {
  let request: { url: string; init: RequestInit | undefined } | undefined
  const host = new TuiAlpha4Host(validateEndpoint('http://127.0.0.1:3080'), {
    fetchImpl: (async (input: URL | string | Request, init?: RequestInit) => {
      request = { url: String(input), init }
      const body = JSON.parse(String(init?.body)) as { rpcId: string }
      return jsonResponse({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { accepted: true } } })
    }) as typeof fetch,
    websocketImpl: FakeWebSocket,
  })
  await host.respondForwardedEvent({
    clientId: 'client-1',
    eventId: 'w-1',
    outcome: { kind: 'result', value: { outcome: 'allowed-once' } },
  })
  assert.equal(request?.url, 'http://127.0.0.1:3080/api/$events/result')
  const body = JSON.parse(String(request?.init?.body)) as { method: string; payload: { args: unknown } }
  assert.equal(body.method, FORWARDED_EVENT_RESULT_ENDPOINT)
  assert.deepEqual(body.payload.args, {
    clientId: 'client-1',
    eventId: 'w-1',
    outcome: { kind: 'result', value: { outcome: 'allowed-once' } },
  })
})

test('disposed hosts reject further calls', async () => {
  const host = new TuiAlpha4Host(validateEndpoint('http://127.0.0.1:3080'), {
    fetchImpl: (async () => jsonResponse({ type: 'server-response', rpcId: 'x', result: { ok: true, value: null } })) as typeof fetch,
    websocketImpl: FakeWebSocket,
  })
  host.dispose()
  await assert.rejects(() => host.call('session/list', {}), /disposed/)
})
