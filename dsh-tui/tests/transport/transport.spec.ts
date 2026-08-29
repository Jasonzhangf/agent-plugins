import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_ENDPOINT,
  NodeApiClient,
  isLoopbackHostname,
  resolveEndpoint,
  validateEndpoint,
} from '../../playground/experiments/transport/src/transport.ts'

function installedClient(endpoint: URL): { readonly base: string } {
  return new (class extends NodeApiClient {
    get base(): string {
      return this.resolveBase()
    }
  })(endpoint)
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

test('NodeApiClient resolves the validated endpoint as its base', () => {
  const endpoint = validateEndpoint('http://127.0.0.1:3080')
  const client = installedClient(endpoint)
  assert.equal(client.base, 'http://127.0.0.1:3080')
})

test('NodeApiClient sends commands through the generic control RPC channel', async () => {
  let request: { url: string; init: RequestInit | undefined } | undefined
  const client = new (class extends NodeApiClient {
    protected override doFetch(input: URL, init?: RequestInit): Promise<Response> {
      request = { url: String(input), init }
      return Promise.resolve(Response.json({
        type: 'server-response',
        rpcId: JSON.parse(String(init?.body)).rpcId,
        result: { ok: true, value: { commandId: 'cmd-1', result: { kind: 'success' } } },
      }))
    }
  })(validateEndpoint('http://127.0.0.1:3080'))
  const result = await client.command('session-1', '/permission read-only')
  assert.deepEqual(result.result, { ok: true, value: { matched: true } })
  assert.equal(request?.url, 'http://127.0.0.1:3080/api/commands/execute')
  assert.deepEqual(JSON.parse(String(request?.init?.body)).payload, {
    args: { agentId: 'session-1', line: '/permission read-only', images: [] },
  })
})

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  private readonly listeners = new Map<string, Set<(event: { data?: unknown; code?: number }) => void>>()

  constructor(url: string) {
    this.url = String(url)
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      if (this.readyState === FakeWebSocket.CLOSED) return
      this.readyState = FakeWebSocket.OPEN
      this.emit('open')
    })
  }

  addEventListener(type: string, listener: (event: { data?: unknown; code?: number }) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: (event: { data?: unknown; code?: number }) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', { code: 1000 })
  }

  serverClose(code = 1006): void {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', { code })
  }

  sendFrame(data: unknown): void {
    if (this.readyState === FakeWebSocket.OPEN) this.emit('message', { data })
  }

  private emit(type: string, event: { data?: unknown; code?: number } = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }
}

function withFakeWebSocket(body: () => Promise<void>): Promise<void> {
  const original = globalThis.WebSocket
  FakeWebSocket.instances = []
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  return body().finally(() => {
    globalThis.WebSocket = original
  })
}

test('NodeApiClient opens exact mux and host WebSocket downlinks and yields typed frames', async () => {
  await withFakeWebSocket(async () => {
    const client = new NodeApiClient(validateEndpoint('http://127.0.0.1:3080'))
    const muxAbort = new AbortController()
    const hostAbort = new AbortController()
    const opened: string[] = []
    const mux = client.events.mux({}, muxAbort.signal, () => opened.push('mux'))[Symbol.asyncIterator]()
    const host = client.events.host({}, hostAbort.signal, () => opened.push('host'))[Symbol.asyncIterator]()
    const muxPending = mux.next()
    const hostPending = host.next()
    await new Promise(resolve => setTimeout(resolve, 0))
    const muxSocket = FakeWebSocket.instances[0]
    const hostSocket = FakeWebSocket.instances[1]
    assert.ok(muxSocket)
    assert.ok(hostSocket)
    assert.deepEqual(FakeWebSocket.instances.map(socket => socket.url), [
      'ws://127.0.0.1:3080/api/events.mux',
      'ws://127.0.0.1:3080/api/events.host',
    ])
    assert.deepEqual(opened, ['mux', 'host'])
    muxSocket.sendFrame(JSON.stringify({
      type: 'server-request',
      rpcId: 'rpc-mux',
      method: 'session/subscribed',
      payload: { type: 'session/subscribed', sessionId: 'session-1', lastSeq: 0 },
    }))
    hostSocket.sendFrame(JSON.stringify({
      type: 'server-request',
      rpcId: 'rpc-host',
      method: 'host/remote-event',
      payload: { type: 'host/remote-event', event: 'commands/change', args: [] },
    }))
    const muxFirst = await muxPending
    const hostFirst = await hostPending
    assert.equal(muxFirst.done, false)
    assert.equal(hostFirst.done, false)
    if (muxFirst.done || muxFirst.value.payload.type !== 'session/subscribed') {
      throw new Error('expected session/subscribed downlink frame')
    }
    if (hostFirst.done || hostFirst.value.payload.type !== 'host/remote-event') {
      throw new Error('expected host/remote-event downlink frame')
    }
    assert.equal(muxFirst.value.rpcId, 'rpc-mux')
    assert.equal(muxFirst.value.payload.sessionId, 'session-1')
    assert.equal(hostFirst.value.rpcId, 'rpc-host')
    muxAbort.abort()
    hostAbort.abort()
    assert.equal((await mux.next()).done, true)
    assert.equal((await host.next()).done, true)
  })
})

test('NodeApiClient rejects malformed WebSocket frames without killing the stream', async () => {
  const originalError = console.error
  console.error = () => undefined
  try {
    await withFakeWebSocket(async () => {
      const client = new NodeApiClient(validateEndpoint('http://127.0.0.1:3080'))
      const abort = new AbortController()
      const iterator = client.events.mux({}, abort.signal)[Symbol.asyncIterator]()
      const pending = iterator.next()
      await new Promise(resolve => setTimeout(resolve, 0))
      const socket = FakeWebSocket.instances[0]
      assert.ok(socket)
      socket.sendFrame(new Uint8Array([1, 2, 3]))
      socket.sendFrame('not-json')
      socket.sendFrame(JSON.stringify({
        type: 'server-request',
        rpcId: 'rpc-2',
        method: 'session/subscribed',
        payload: { type: 'session/subscribed', sessionId: 'session-2', lastSeq: 1 },
      }))
      const first = await pending
      assert.equal(first.done, false)
      if (first.done || first.value.payload.type !== 'session/subscribed') {
        throw new Error('expected the valid frame after malformed frames')
      }
      assert.equal(first.value.payload.sessionId, 'session-2')
      abort.abort()
      assert.equal((await iterator.next()).done, true)
    })
  } finally {
    console.error = originalError
  }
})

test('NodeApiClient reconnects the same public stream after peer close', async () => {
  await withFakeWebSocket(async () => {
    const client = new NodeApiClient(validateEndpoint('http://127.0.0.1:3080'), undefined, 0)
    const abort = new AbortController()
    const opened: number[] = []
    const iterator = client.events.mux({}, abort.signal, () => opened.push(FakeWebSocket.instances.length))[Symbol.asyncIterator]()
    const firstPending = iterator.next()
    await new Promise(resolve => setTimeout(resolve, 0))
    const firstSocket = FakeWebSocket.instances[0]
    assert.ok(firstSocket)
    firstSocket.sendFrame(JSON.stringify({
      type: 'server-request',
      rpcId: 'rpc-before-close',
      method: 'session/subscribed',
      payload: { type: 'session/subscribed', sessionId: 'session-1', lastSeq: 1 },
    }))
    assert.equal((await firstPending).done, false)

    const secondPending = iterator.next()
    firstSocket.serverClose()
    await new Promise(resolve => setTimeout(resolve, 10))
    const secondSocket = FakeWebSocket.instances[1]
    assert.ok(secondSocket)
    secondSocket.sendFrame(JSON.stringify({
      type: 'server-request',
      rpcId: 'rpc-after-close',
      method: 'session/subscribed',
      payload: { type: 'session/subscribed', sessionId: 'session-1', lastSeq: 4 },
    }))
    const second = await secondPending
    assert.equal(second.done, false)
    if (second.done || second.value.payload.type !== 'session/subscribed') {
      throw new Error('expected subscribed frame after reconnect')
    }
    assert.equal(second.value.payload.lastSeq, 4)
    assert.deepEqual(opened, [1, 2])
    abort.abort()
    assert.equal((await iterator.next()).done, true)
  })
})

test('NodeApiClient abort never opens a replacement socket', async () => {
  await withFakeWebSocket(async () => {
    const client = new NodeApiClient(validateEndpoint('http://127.0.0.1:3080'), undefined, 0)
    const abort = new AbortController()
    const iterator = client.events.host({}, abort.signal)[Symbol.asyncIterator]()
    const pending = iterator.next()
    await new Promise(resolve => setTimeout(resolve, 0))
    abort.abort()
    assert.equal((await pending).done, true)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(FakeWebSocket.instances.length, 1)
  })
})

test('NodeApiClient fails explicitly when the Node WebSocket carrier is unavailable', async () => {
  const original = globalThis.WebSocket
  globalThis.WebSocket = undefined as unknown as typeof WebSocket
  try {
    const client = new NodeApiClient(validateEndpoint('http://127.0.0.1:3080'))
    const iterator = client.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]()
    await assert.rejects(() => iterator.next(), /global WebSocket is unavailable/)
  } finally {
    globalThis.WebSocket = original
  }
})
