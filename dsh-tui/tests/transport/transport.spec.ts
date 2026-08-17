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

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  private readonly listeners = new Map<string, Set<(event: { data?: unknown }) => void>>()

  constructor(url: string) {
    this.url = String(url)
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN
      this.emit('open')
    })
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close')
  }

  sendFrame(data: string): void {
    if (this.readyState === FakeWebSocket.OPEN) this.emit('message', { data })
  }

  private emit(type: string, event: { data?: unknown } = {}): void {
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

test('NodeApiClient mux opens a loopback WebSocket and yields parsed downlink frames', async () => {
  await withFakeWebSocket(async () => {
    const client = new NodeApiClient(validateEndpoint('http://127.0.0.1:3080'))
    const ac = new AbortController()
    const stream = client.events.mux({}, ac.signal)
    const iterator = stream[Symbol.asyncIterator]()
    const pending = iterator.next()
    await new Promise(resolve => setTimeout(resolve, 0))
    const socket = FakeWebSocket.instances[0]
    assert.ok(socket)
    assert.equal(socket.url, 'ws://127.0.0.1:3080/api/events.mux')
    socket.sendFrame(JSON.stringify({
      type: 'server-request',
      rpcId: 'rpc-1',
      method: 'session/subscribed',
      payload: { type: 'session/subscribed', sessionId: 'session-1', lastSeq: 0 },
    }))
    const first = await pending
    assert.equal(first.done, false)
    if (first.done || first.value.payload.type !== 'session/subscribed') {
      throw new Error('expected session/subscribed downlink frame')
    }
    assert.equal(first.value.rpcId, 'rpc-1')
    assert.equal(first.value.payload.sessionId, 'session-1')
    ac.abort()
    const end = await iterator.next()
    assert.equal(end.done, true)
  })
})

test('NodeApiClient drops malformed downlink frames without killing the stream', async () => {
  const originalError = console.error
  console.error = () => undefined
  try {
    await withFakeWebSocket(async () => {
      const client = new NodeApiClient(validateEndpoint('http://127.0.0.1:3080'))
      const ac = new AbortController()
      const iterator = client.events.mux({}, ac.signal)[Symbol.asyncIterator]()
      const pending = iterator.next()
      await new Promise(resolve => setTimeout(resolve, 0))
      const socket = FakeWebSocket.instances[0]
      assert.ok(socket)
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
        throw new Error('expected the valid frame after the malformed frame')
      }
      assert.equal(first.value.payload.sessionId, 'session-2')
      ac.abort()
      await iterator.next()
    })
  } finally {
    console.error = originalError
  }
})
