import assert from 'node:assert/strict'
import test from 'node:test'
import { OpenCodeHttpError, OpenCodeServeClient, parseOpenCodeSemanticEvent } from '../../src/experiments/transport/src/opencode-serve.ts'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

test('OpenCode serve session routes bind the configured directory', async () => {
  const calls: Request[] = []
  const client = new OpenCodeServeClient({
    endpoint: 'http://127.0.0.1:4096',
    directory: '/tmp/agent-tui-opencode',
    fetchImpl: async (input, init) => {
      const request = new Request(input, init)
      calls.push(request)
      if (request.method === 'GET' && new URL(request.url).pathname === '/session') return jsonResponse([])
      if (request.method === 'POST' && new URL(request.url).pathname === '/session') return jsonResponse({ id: 'ses_1' })
      throw new Error(`unexpected ${request.method} ${request.url}`)
    },
  })
  assert.deepEqual(await client.listSessions({ limit: 20 }), [])
  assert.deepEqual(await client.createSession(), { id: 'ses_1' })
  assert.equal(new URL(calls[0]!.url).searchParams.get('directory'), '/tmp/agent-tui-opencode')
  assert.deepEqual(await calls[1]!.json(), {})
})

test('OpenCode session summaries distinguish empty sessions from sessions with content', async () => {
  const client = new OpenCodeServeClient({
    endpoint: 'http://127.0.0.1:4096',
    directory: '/tmp/agent-tui-opencode',
    fetchImpl: async input => {
      assert.equal(new URL(String(input)).pathname, '/session')
      return jsonResponse([
        {
          id: 'ses_empty',
          directory: '/tmp/agent-tui-opencode',
          title: 'New session',
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
        },
        {
          id: 'ses_content',
          directory: '/tmp/agent-tui-opencode',
          title: 'Completed work',
          summary: { additions: 0, deletions: 0, files: 0 },
          tokens: { input: 12, output: 4, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 2, updated: 2 },
        },
      ])
    },
  })
  const result = await client.remote.session.list()
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.value.items.map(item => ({ sessionId: item.sessionId, blank: item.blank })), [
    { sessionId: 'ses_empty', blank: true },
    { sessionId: 'ses_content', blank: false },
  ])
})

test('OpenCode resume validates the existing session instead of creating a replacement', async () => {
  const calls: Request[] = []
  const client = new OpenCodeServeClient({
    endpoint: 'http://127.0.0.1:4096',
    directory: '/tmp/agent-tui-opencode',
    fetchImpl: async (input, init) => {
      const request = new Request(input, init)
      calls.push(request)
      if (new URL(request.url).pathname === '/session/ses_1') {
        return jsonResponse({ id: 'ses_1', directory: '/tmp/agent-tui-opencode', time: { created: 1, updated: 1 } })
      }
      throw new Error(`unexpected ${request.method} ${request.url}`)
    },
  })
  const result = await client.remote.session.create({ sessionId: 'ses_1', cwd: '/tmp/agent-tui-opencode' } as never)
  assert.deepEqual(result, { ok: true, value: { sessionId: 'ses_1' } })
  assert.equal(calls.length, 1)
  assert.equal(new URL(calls[0]!.url).pathname, '/session/ses_1')
})

test('OpenCode v2-shaped session envelopes are rejected at the v1 adaptor boundary', async () => {
  const client = new OpenCodeServeClient({
    fetchImpl: async () => jsonResponse({ data: [] }),
  })
  await assert.rejects(client.listSessions(), /response must be an array/)
})

test('OpenCode agent catalog is projected without inventing a preset id', async () => {
  const client = new OpenCodeServeClient({
    endpoint: 'http://127.0.0.1:4096',
    directory: '/tmp/agent-tui-opencode',
    fetchImpl: async input => {
      assert.equal(new URL(String(input)).pathname, '/agent')
      return jsonResponse([
        { name: 'build', mode: 'primary', hidden: false, description: 'Build agent' },
        { name: 'general', mode: 'subagent', hidden: false },
      ])
    },
  })
  const response = await client.remote.agentPresets.list()
  assert.equal(response.ok, true)
  if (response.ok) assert.deepEqual(response.value, {
    presets: [
      { id: 'build', name: 'build', description: 'Build agent' },
      { id: 'general', name: 'general' },
    ],
    authorable: false,
  })
})

test('OpenCode model catalog projects the configured RCC 4444 provider', async () => {
  const client = new OpenCodeServeClient({
    endpoint: 'http://127.0.0.1:4096',
    directory: '/tmp/agent-tui-opencode',
    fetchImpl: async input => {
      const requestUrl = new URL(String(input))
      assert.ok(['/config/providers', '/global/config'].includes(requestUrl.pathname))
      if (requestUrl.pathname === '/global/config') return jsonResponse({ model: 'routecodex/gpt-5.5' })
      return jsonResponse({
        providers: [{
          id: 'routecodex',
          name: 'RouteCodex 4444',
          models: {
            'gpt-5.5': {
              id: 'gpt-5.5',
              name: 'gpt-5.5',
              status: 'active',
              capabilities: { reasoning: true },
              variants: { low: {}, high: {} },
            },
          },
        }],
        default: { routecodex: 'gpt-5.5' },
      })
    },
  })
  const response = await client.remote.session.modelCatalog()
  assert.deepEqual(response, {
    ok: true,
    value: {
      default: { provider: 'routecodex', model: 'gpt-5.5' },
      groups: [{
        id: 'routecodex',
        name: 'RouteCodex 4444',
        models: [{
          id: 'gpt-5.5',
          name: 'gpt-5.5',
          reasoning: {
            efforts: [
              { id: 'low', name: 'low' },
              { id: 'high', name: 'high' },
            ],
          },
        }],
      }],
    },
  })
})

test('OpenCode model catalog rejects malformed provider data', async () => {
  const client = new OpenCodeServeClient({ fetchImpl: async () => jsonResponse({ providers: [{}], default: {} }) })
  await assert.rejects(client.remote.session.modelCatalog(), /provider id/)
})

test('OpenCode HTTP errors are explicit', async () => {
  const client = new OpenCodeServeClient({ fetchImpl: async () => new Response('unauthorized', { status: 401 }) })
  await assert.rejects(client.listSessions(), (error: unknown) => {
    assert.ok(error instanceof OpenCodeHttpError)
    assert.equal(error.status, 401)
    assert.equal(error.body, 'unauthorized')
    return true
  })
})

test('OpenCode prompt forwards AbortSignal and aborts the in-flight request', async () => {
  const controller = new AbortController()
  let receivedSignal: AbortSignal | undefined
  const client = new OpenCodeServeClient({
    fetchImpl: async (_input, init) => {
      receivedSignal = init?.signal as AbortSignal | undefined
      await new Promise<never>((_resolve, reject) => {
        if (receivedSignal?.aborted) {
          reject(new DOMException('aborted', 'AbortError'))
          return
        }
        receivedSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
      return new Response()
    },
  })
  const pending = client.prompt('ses_1', 'hello', controller.signal)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(receivedSignal, controller.signal)
  assert.equal(controller.signal.aborted, false)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('OpenCode remote prompt uses the non-blocking prompt_async route', async () => {
  let requestPath = ''
  const client = new OpenCodeServeClient({
    fetchImpl: async (input, init) => {
      const request = new Request(input, init)
      requestPath = new URL(request.url).pathname
      assert.deepEqual(await request.json(), { parts: [{ type: 'text', text: 'hello' }] })
      return new Response(null, { status: 204 })
    },
  })
  const result = await client.remote.session.prompt({
    sessionId: 'ses_1',
    content: [{ type: 'text', text: 'hello' }],
  } as never)
  assert.deepEqual(result, { ok: true, value: { accepted: true } })
  assert.equal(requestPath, '/session/ses_1/prompt_async')
})

test('OpenCode events are parsed incrementally from SSE', async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"server.connected","properties":{}}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"session.updated","properties":{"sessionID":"ses_1"}}\n\n'))
      controller.close()
    },
  })
  const client = new OpenCodeServeClient({ fetchImpl: async request => {
    assert.equal(new URL(String(request)).pathname, '/event')
    return new Response(stream)
  } })
  const events: unknown[] = []
  for await (const event of client.events()) events.push(event)
  assert.deepEqual(events, [
    { type: 'server.connected', properties: {} },
    { type: 'session.updated', properties: { sessionID: 'ses_1' } },
  ])
})

test('OpenCode endpoint rejects credentials and paths', () => {
  assert.throws(() => new OpenCodeServeClient({ endpoint: 'http://user:pass@127.0.0.1:4096' }), /origin/)
  assert.throws(() => new OpenCodeServeClient({ endpoint: 'http://127.0.0.1:4096/api' }), /origin/)
})

test('OpenCode semantic parser maps streaming text, reasoning, and tool state', () => {
  assert.deepEqual(parseOpenCodeSemanticEvent({
    type: 'message.part.updated',
    properties: {
      sessionID: 'ses_1',
      part: { id: 'prt_1', messageID: 'msg_1', type: 'text', text: 'hello', time: { start: 1 } },
      time: 1,
    },
  }), {
    kind: 'text', sessionId: 'ses_1', messageId: 'msg_1', partId: 'prt_1', text: 'hello', streaming: true,
  })
  assert.deepEqual(parseOpenCodeSemanticEvent({
    type: 'message.part.updated',
    properties: {
      sessionID: 'ses_1',
      part: { id: 'prt_2', messageID: 'msg_1', type: 'tool', callID: 'call_1', tool: 'read', state: { status: 'running', input: { path: 'README.md' } } },
      time: 2,
    },
  }), {
    kind: 'tool', sessionId: 'ses_1', messageId: 'msg_1', partId: 'prt_2', callId: 'call_1', name: 'read', status: 'running', input: { path: 'README.md' },
  })
})

test('OpenCode live tool projection carries canonical semantics and lifecycle state', async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_tool","messageID":"msg_1","type":"tool","callID":"call_1","tool":"bash","state":{"status":"pending","input":{"command":"printf TOOL_OK"},"title":"Run printf TOOL_OK"}}}}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_tool","messageID":"msg_1","type":"tool","callID":"call_1","tool":"bash","state":{"status":"running","input":{"command":"printf TOOL_OK"},"title":"Run printf TOOL_OK"}}}}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_tool","messageID":"msg_1","type":"tool","callID":"call_1","tool":"bash","state":{"status":"completed","input":{"command":"printf TOOL_OK"},"output":"TOOL_OK","title":"Run printf TOOL_OK"}}}}\n\n'))
      controller.close()
    },
  })
  const client = new OpenCodeServeClient({ fetchImpl: async input => {
    const path = new URL(String(input)).pathname
    if (path === '/session/ses_1/message') return jsonResponse([])
    if (path === '/event') return new Response(stream)
    throw new Error('unexpected path')
  } })
  const iterator = client.remote.session.follow({ address: { kind: 'session', sessionId: 'ses_1' as never }, maxMessages: 10 }, new AbortController().signal)[Symbol.asyncIterator]()
  await iterator.next()
  const pending = await iterator.next()
  const running = await iterator.next()
  const completed = await iterator.next()
  assert.equal(pending.value?.type, 'event')
  assert.equal(running.value?.type, 'event')
  assert.equal(completed.value?.type, 'event')
  if (pending.value?.type !== 'event' || running.value?.type !== 'event' || completed.value?.type !== 'event') return
  assert.equal(pending.value.event.data.status, 'pending')
  assert.equal(running.value.event.data.status, 'running')
  assert.equal(running.value.event.data.toolKind, 'tool.terminal')
  assert.equal(running.value.event.data.title, 'Run printf TOOL_OK')
  assert.equal(completed.value.event.data.name, 'bash')
  assert.equal(completed.value.event.data.toolKind, 'tool.terminal')
  assert.equal(completed.value.event.data.message.content[0].text, 'TOOL_OK')
})

test('OpenCode semantic parser maps message.part.delta to typed text deltas', () => {
  assert.deepEqual(parseOpenCodeSemanticEvent({
    type: 'message.part.delta',
    properties: {
      sessionID: 'ses_1', messageID: 'msg_1', partID: 'prt_1', field: 'text', delta: 'hello',
    },
  }), {
    kind: 'delta', sessionId: 'ses_1', messageId: 'msg_1', partId: 'prt_1', field: 'text', delta: 'hello',
  })
})

test('OpenCode semantic parser fails closed for malformed known events and preserves unknown semantics', () => {
  assert.throws(() => parseOpenCodeSemanticEvent({
    type: 'session.status', properties: { sessionID: 'ses_1', status: { type: 'not-a-status' } },
  }), /unknown status/)
  assert.throws(() => parseOpenCodeSemanticEvent({
    type: 'message.part.updated', properties: { sessionID: 'ses_1', part: { type: 'text' }, time: 1 },
  }), /requires text|requires id/)
  assert.deepEqual(parseOpenCodeSemanticEvent({ type: 'future.event', properties: { sessionID: 'ses_1' } }), {
    kind: 'unknown', eventType: 'future.event', properties: { sessionID: 'ses_1' },
  })
})

test('OpenCode follow projects message parts and assigns monotonic live sequence numbers', async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_2","messageID":"msg_2","type":"text","text":"hello","time":{"start":1}},"time":1}}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"session.status","properties":{"sessionID":"ses_1","status":{"type":"idle"}}}\n\n'))
      controller.close()
    },
  })
  const client = new OpenCodeServeClient({ fetchImpl: async input => {
    const path = new URL(String(input)).pathname
    if (path === '/session/ses_1/message') return jsonResponse([{ info: { id: 'msg_1', role: 'user', time: { created: 1 } }, parts: [{ id: 'prt_1', type: 'text', text: 'prompt' }] }])
    if (path === '/event') return new Response(stream)
    throw new Error(`unexpected ${path}`)
  } })
  const controller = new AbortController()
  const iterator = client.remote.session.follow({ address: { kind: 'session', sessionId: 'ses_1' as never }, maxMessages: 10 }, controller.signal)[Symbol.asyncIterator]()
  const snapshot = await iterator.next()
  assert.equal(snapshot.done, false)
  if (snapshot.done) return
  assert.equal(snapshot.value.type, 'snapshot')
  if (snapshot.value.type !== 'snapshot') return
  assert.equal(snapshot.value.records[0]?.event.type, 'user/message')
  const first = await iterator.next()
  assert.equal(first.value?.type, 'event')
  if (first.value?.type !== 'event') return
  assert.equal(first.value.event.seq, 1)
  const second = await iterator.next()
  assert.equal(second.value?.type, 'event')
  if (second.value?.type !== 'event') return
  assert.equal(second.value.event.seq, 2)
  controller.abort()
  await iterator.return?.()
})

test('OpenCode session.idle closes the canonical turn when status idle is not repeated', async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"session.idle","properties":{"sessionID":"ses_1"}}\n\n'))
      controller.close()
    },
  })
  const client = new OpenCodeServeClient({
    fetchImpl: async input => {
      const path = new URL(String(input)).pathname
      if (path === '/session/ses_1/message') return jsonResponse([])
      if (path === '/event') return new Response(stream)
      throw new Error(`unexpected ${path}`)
    },
  })
  const controller = new AbortController()
  const iterator = client.remote.session.follow({ address: { kind: 'session', sessionId: 'ses_1' as never }, maxMessages: 10 }, controller.signal)[Symbol.asyncIterator]()
  await iterator.next()
  const idle = await iterator.next()
  assert.equal(idle.value?.type, 'event')
  if (idle.value?.type !== 'event') return
  assert.equal(idle.value.event.type, 'turn/end')
  assert.deepEqual(idle.value.event.data.reason, { kind: 'completed' })
  controller.abort()
  await iterator.return?.()
})

test('OpenCode history projects completed tool turns instead of rejecting tool-only messages', async () => {
  const client = new OpenCodeServeClient({
    fetchImpl: async input => {
      const path = new URL(String(input)).pathname
      if (path === '/session/ses_1/message') return jsonResponse([
        {
          info: { id: 'msg_user', role: 'user', time: { created: 1 } },
          parts: [{ id: 'prt_user', type: 'text', text: 'read README' }],
        },
        {
          info: { id: 'msg_tool', role: 'assistant', time: { created: 2 } },
          parts: [{
            id: 'prt_tool', type: 'tool', callID: 'call_1', tool: 'read',
            state: { status: 'completed', input: { filePath: 'README.md' }, output: 'file contents' },
          }],
        },
        {
          info: { id: 'msg_done', role: 'assistant', time: { created: 3 } },
          parts: [{ id: 'prt_done', type: 'text', text: 'done' }],
        },
      ])
      throw new Error(`unexpected ${path}`)
    },
  })
  const iterator = client.remote.session.follow({ address: { kind: 'session', sessionId: 'ses_1' as never }, maxMessages: 10 }, new AbortController().signal)[Symbol.asyncIterator]()
  const result = await iterator.next()
  assert.equal(result.value?.type, 'snapshot')
  if (result.value?.type !== 'snapshot') return
  assert.deepEqual(result.value.records.map((record: { readonly event: { readonly type: string } }) => record.event.type), ['user/message', 'tool/call', 'tool/result', 'assistant/message'])
  assert.equal(result.value.records[1]?.event.seq, 1)
  assert.equal(result.value.records[2]?.event.seq, 2)
})

test('OpenCode live assistant turns cannot reuse historical presentation identities', async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"message.updated","properties":{"sessionID":"ses_1","info":{"id":"msg_live","role":"assistant"}}}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_live","messageID":"msg_live","type":"text","text":"new"},"time":1}}\n\n'))
      controller.close()
    },
  })
  const client = new OpenCodeServeClient({ fetchImpl: async input => {
    const path = new URL(String(input)).pathname
    if (path === '/session/ses_1/message') return jsonResponse([
      { info: { id: 'msg_old', role: 'assistant', time: { created: 1 } }, parts: [{ id: 'prt_old', type: 'text', text: 'old' }] },
    ])
    if (path === '/event') return new Response(stream)
    throw new Error(`unexpected ${path}`)
  } })
  const iterator = client.remote.session.follow({ address: { kind: 'session', sessionId: 'ses_1' as never }, maxMessages: 10 }, new AbortController().signal)[Symbol.asyncIterator]()
  await iterator.next()
  const result = await iterator.next()
  assert.equal(result.value?.type, 'event')
  if (result.value?.type !== 'event') return
  assert.equal(result.value.event.type, 'assistant/chunk')
  assert.equal(result.value.event.data.turn, 2)
})

test('OpenCode follow projects a user message part so the local echo can settle', async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"message.updated","properties":{"sessionID":"ses_1","info":{"id":"msg_user","role":"user"}}}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_user","messageID":"msg_user","type":"text","text":"hello","time":{"start":1,"end":2}},"time":1}}\n\n'))
      controller.close()
    },
  })
  const client = new OpenCodeServeClient({ fetchImpl: async input => {
    const path = new URL(String(input)).pathname
    if (path === '/session/ses_1/message') return jsonResponse([])
    if (path === '/event') return new Response(stream)
    throw new Error(`unexpected ${path}`)
  } })
  const iterator = client.remote.session.follow({ address: { kind: 'session', sessionId: 'ses_1' as never }, maxMessages: 10 }, new AbortController().signal)[Symbol.asyncIterator]()
  await iterator.next()
  const result = await iterator.next()
  assert.equal(result.value?.type, 'event')
  if (result.value?.type !== 'event') return
  assert.equal(result.value.event.type, 'user/message')
  assert.deepEqual(result.value.event.data.content, [{ type: 'text', text: 'hello' }])
})

test('OpenCode follow preserves SSE text deltas and suppresses structural parts', async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"message.updated","properties":{"sessionID":"ses_1","info":{"id":"msg_assistant","role":"assistant"}}}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_step","messageID":"msg_assistant","type":"step-start"},"time":1}}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_text","messageID":"msg_assistant","type":"text","text":"","time":{"start":1}},"time":1}}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"message.part.delta","properties":{"sessionID":"ses_1","messageID":"msg_assistant","partID":"prt_text","field":"text","delta":"OK"}}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"message.part.updated","properties":{"sessionID":"ses_1","part":{"id":"prt_text","messageID":"msg_assistant","type":"text","text":"OK","time":{"start":1,"end":2}},"time":2}}\n\n'))
      controller.close()
    },
  })
  const client = new OpenCodeServeClient({ fetchImpl: async input => {
    const path = new URL(String(input)).pathname
    if (path === '/session/ses_1/message') return jsonResponse([])
    if (path === '/event') return new Response(stream)
    throw new Error(`unexpected ${path}`)
  } })
  const iterator = client.remote.session.follow({ address: { kind: 'session', sessionId: 'ses_1' as never }, maxMessages: 10 }, new AbortController().signal)[Symbol.asyncIterator]()
  await iterator.next()
  const result = await iterator.next()
  assert.equal(result.value?.type, 'event')
  if (result.value?.type !== 'event') return
  assert.equal(result.value.event.type, 'assistant/chunk')
  assert.deepEqual(result.value.event.data.chunk, { type: 'text-delta', index: 0, text: 'OK' })
  const done = await iterator.next()
  assert.equal(done.done, true)
})
