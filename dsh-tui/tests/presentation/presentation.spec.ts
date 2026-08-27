import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { HistoryEntry } from '@deepseek-ai/dsh-host-apiproxy/api'
import {
  apply,
  projectSession,
  tuiPresentationServiceName,
} from '../../playground/experiments/presentation/src/presentation.ts'

function entry(type: string, seq: number, data: unknown, view?: HistoryEntry['view']): HistoryEntry {
  return {
    event: { type, seq, time: 1000 + seq, data } as HistoryEntry['event'],
    ...(view === undefined ? {} : { view }),
  }
}

function project(entries: HistoryEntry[]) {
  return projectSession({ sessionId: 'session-1', lastSeq: entries.at(-1)?.event.seq ?? -1, entries })
}

test('projects user and plugin context messages as distinct literal nodes', () => {
  const model = project([
    entry('user/message', 0, {
      id: 'message-1',
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: '继续' }],
    }),
    entry('user/message', 1, {
      id: 'message-2',
      role: 'user',
      source: { kind: 'plugin', plugin: 'workspace', form: 'notice', summary: 'changed' },
      content: [{ type: 'text', text: 'AGENTS.md changed' }],
    }),
  ])
  assert.deepEqual(model.nodes.map(node => node.kind), [
    'conversation.user',
    'conversation.context',
  ])
  const user = model.nodes[0]
  const context = model.nodes[1]
  if (user?.kind !== 'conversation.user') throw new Error('expected user node')
  if (context?.kind !== 'conversation.context') throw new Error('expected context node')
  assert.equal(user.value.text, '继续')
  assert.equal(context.value.text, 'AGENTS.md changed')
})

test('clears transient steering nodes when the turn ends', () => {
  const model = project([
    entry('user/message', 0, {
      id: 'message-steering',
      role: 'user',
      source: { kind: 'steering' },
      content: [{ type: 'text', text: 'temporary steering' }],
    }),
    entry('turn/start', 1, { turn: 1 }),
    entry('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
  ])
  assert.deepEqual(model.nodes.map(node => node.kind), [
    'conversation.turn-tail',
  ])
})

test('assistant chunks update one stable node without duplicating block-end content', () => {
  const model = project([
    entry('assistant/chunk', 0, {
      turn: 1,
      step: 1,
      chunk: { type: 'block-start', index: 0, blockType: 'text' },
    }),
    entry('assistant/chunk', 1, {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'Hel' },
    }),
    entry('assistant/chunk', 2, {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'lo' },
    }),
    entry('assistant/chunk', 3, {
      turn: 1,
      step: 1,
      chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello' } },
    }),
  ])
  assert.equal(model.nodes.length, 1)
  const assistant = model.nodes[0]
  assert.equal(assistant?.kind, 'conversation.assistant')
  if (assistant?.kind !== 'conversation.assistant') throw new Error('expected assistant node')
  assert.equal(assistant.nodeId, 'session-1:assistant:1:1')
  assert.equal(assistant.publicationRevision, 3)
  assert.equal(assistant.lifecycle, 'streaming')
  assert.deepEqual(assistant.value.blocks, [{
    kind: 'text',
    text: 'Hello',
    markdown: ['paragraph:start', 'text\tHello', 'paragraph:end'],
  }])
})

test('settled assistant replaces the streaming value while preserving node identity', () => {
  const model = project([
    entry('assistant/chunk', 0, {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'think' },
    }),
    entry('assistant/message', 1, {
      turn: 1,
      step: 1,
      message: {
        id: 'assistant-1',
        role: 'assistant',
        source: { kind: 'model', provider: 'rcc', model: 'deepseek' },
        content: [
          { type: 'reasoning', text: 'thought' },
          { type: 'text', text: 'answer' },
        ],
      },
    }),
  ])
  assert.equal(model.nodes.length, 1)
  const assistant = model.nodes[0]
  assert.equal(assistant?.kind, 'conversation.assistant')
  if (assistant?.kind !== 'conversation.assistant') throw new Error('expected assistant node')
  assert.equal(assistant.nodeId, 'session-1:assistant:1:1')
  assert.equal(assistant.lifecycle, 'settled')
  assert.deepEqual(assistant.value.blocks, [
    { kind: 'reasoning', text: 'thought' },
    {
      kind: 'text',
      text: 'answer',
      markdown: ['paragraph:start', 'text\tanswer', 'paragraph:end'],
    },
  ])
})

test('pairs tool call and result by callId into one settled tool node', () => {
  const model = project([
    entry('tool/call', 0, {
      turn: 1,
      step: 1,
      callId: 'call-1',
      name: 'read_file',
      arguments: '{"path":"README.md"}',
    }),
    entry('tool/result', 1, {
      turn: 1,
      step: 1,
      message: {
        id: 'tool-result-1',
        role: 'user',
        source: { kind: 'tool', callId: 'call-1' },
        content: [{ type: 'text', text: 'contents' }],
      },
    }),
  ])
  assert.equal(model.nodes.length, 1)
  const tool = model.nodes[0]
  assert.equal(tool?.kind, 'tool.generic')
  if (tool?.kind !== 'tool.generic') throw new Error('expected generic tool node')
  assert.equal(tool.nodeId, 'session-1:tool:call-1')
  assert.equal(tool.lifecycle, 'settled')
  assert.deepEqual(tool.value, {
    name: 'read_file',
    arguments: '{"path":"README.md"}',
    status: 'completed',
    result: 'contents',
  })
})

test('uses public ToolEventView to select terminal renderer and preserve display intent', () => {
  const model = project([
    entry('tool/call', 0, {
      turn: 1, step: 1, callId: 'call-terminal', name: 'shell', arguments: '{"command":"pnpm test"}',
    }, {
      for: 'call',
      view: { card: 'terminal', title: 'pnpm test', cwd: '/workspace' },
    }),
    entry('tool/result', 1, {
      turn: 1, step: 1,
      message: {
        id: 'tool-result-terminal', role: 'user', source: { kind: 'tool', callId: 'call-terminal' },
        content: [{ type: 'text', text: 'raw result' }],
      },
    }, {
      for: 'result',
      view: { card: 'terminal', output: 'TAP ok', exitCode: 0 },
    }),
  ])
  const tool = model.nodes[0]
  assert.equal(tool?.kind, 'tool.terminal')
  if (tool?.kind !== 'tool.terminal') throw new Error('expected terminal tool node')
  assert.deepEqual(tool.value.callRenderIntent, { card: 'terminal', title: 'pnpm test', cwd: '/workspace' })
  assert.deepEqual(tool.value.resultRenderIntent, { card: 'terminal', output: 'TAP ok', exitCode: 0 })
})

test('projects turn failures and unknown events without exposing known internal markers', () => {
  const model = project([
    entry('request/header', 0, { header: {}, reason: 'initial' }),
    entry('turn/start', 1, { turn: 1 }),
    entry('turn/end', 2, {
      turn: 1,
      reason: { kind: 'error', error: { message: 'provider failed', code: 'UPSTREAM' } },
    }),
    entry('plugin/new-required-event', 3, { value: true }),
  ])
  assert.deepEqual(model.nodes.map(node => node.kind), [
    'conversation.turn-error',
    'conversation.turn-tail',
    'conversation.unknown',
  ])
  const error = model.nodes[0]
  if (error?.kind !== 'conversation.turn-error') throw new Error('expected error node')
  assert.equal(error.value.message, 'provider failed')
  const unknown = model.nodes[2]
  if (unknown?.kind !== 'conversation.unknown') throw new Error('expected unknown node')
  assert.deepEqual(unknown.value, { type: 'plugin/new-required-event', seq: 3 })
})

test('presentation service publishes immutable models under its canonical Cordis name', () => {
  const ctx = new Context()
  apply(ctx)
  const received: unknown[] = []
  ctx.tuiPresentation.subscribe(model => received.push(model))
  const model = ctx.tuiPresentation.project({
    sessionId: 'session-1',
    lastSeq: 0,
    entries: [entry('user/message', 0, {
      id: 'message-1',
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'hello' }],
    })],
  })
  assert.equal(ctx.tuiPresentation.name, tuiPresentationServiceName)
  assert.equal(ctx.get(tuiPresentationServiceName)?.name, tuiPresentationServiceName)
  assert.equal(received[0], model)
  assert.equal(Object.isFrozen(model), true)
  assert.equal(Object.isFrozen(model.nodes), true)
  assert.equal(Object.isFrozen(model.nodes[0]), true)
  assert.equal(Object.isFrozen(model.nodes[0]?.value), true)
})
