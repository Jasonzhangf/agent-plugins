import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { TuiHistoryEntry as HistoryEntry } from '../../contracts/tui/session/history-entry.types.ts'
import {
  apply,
  projectSession,
  tuiPresentationServiceName,
} from '../../src/experiments/presentation/src/presentation.ts'

function entry(type: string, seq: number, data: unknown, view?: HistoryEntry['view']): HistoryEntry {
  return {
    event: { type, seq, time: 1000 + seq, data } as HistoryEntry['event'],
    ...(view === undefined ? {} : { view }),
  }
}

function project(entries: HistoryEntry[]) {
  return projectSession({ sessionId: 'session-1', lastSeq: entries.at(-1)?.event.seq ?? -1, entries })
}

test('empty history starts the public presentation revision at zero', () => {
  assert.equal(project([]).publicationRevision, 0)
})

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

test('projects image user content as a bounded attachment summary', () => {
  const model = project([
    entry('user/message', 0, {
      id: 'message-image',
      role: 'user',
      source: { kind: 'user' },
      content: [
        { type: 'text', text: 'inspect this' },
        { type: 'image', mediaType: 'image/png', data: 'SECRET_BASE64', name: 'screen.png' },
      ],
    }),
  ])
  const node = model.nodes[0]
  if (node?.kind !== 'conversation.user') throw new Error('expected user node')
  assert.equal(node.value.text, 'inspect this\n[attachment: screen.png · image/png]')
  assert.doesNotMatch(node.value.text, /SECRET_BASE64/)
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

test('suppresses code-mode tool orchestration from the assistant transcript projection', () => {
  const model = project([
    entry('tool/call', 0, {
      turn: 1, step: 1, callId: 'call-shell', name: 'run_code', arguments: '{}',
    }),
    entry('assistant/chunk', 1, {
      turn: 1, step: 1,
      chunk: { type: 'block-start', index: 0, blockType: 'text' },
    }),
    entry('assistant/chunk', 2, {
      turn: 1, step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'const result = await tools.bash({ command: "printf OK" });' },
    }),
    entry('assistant/message', 1, {
      turn: 1,
      step: 1,
      message: {
        id: 'assistant-shell-code',
        role: 'assistant',
        source: { kind: 'model' },
        content: [{ type: 'text', text: 'const result = await tools.bash({ command: "printf OK" });\n{"exitCode":0,"stdout":"OK\\n"}' }],
      },
    }),
  ])
  assert.equal(model.nodes.some(node => node.kind === 'conversation.assistant'), false)
})

test('suppresses localized tool orchestration text from the assistant transcript projection', () => {
  const model = project([
    entry('assistant/message', 1, {
      turn: 1,
      step: 1,
      message: {
        id: 'assistant-localized-tool-text',
        role: 'assistant',
        source: { kind: 'model' },
        content: [{ type: 'text', text: '调用工具 run_code：执行用户指定的基础 shell 命令' }],
      },
    }),
  ])
  assert.equal(model.nodes.some(node => node.kind === 'conversation.assistant'), false)
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
  assert.equal(tool?.kind, 'tool.read')
  if (tool?.kind !== 'tool.read') throw new Error('expected read tool node')
  assert.equal(tool.nodeId, 'session-1:tool:call-1')
  assert.equal(tool.lifecycle, 'settled')
  assert.deepEqual(tool.value, {
    name: 'read_file',
    arguments: '{"path":"README.md"}',
    status: 'completed',
    result: 'contents',
  })
})

test('settles the requesting assistant step before a tool result becomes stable', () => {
  const model = project([
    entry('assistant/chunk', 0, {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'I will inspect the files.' },
    }),
    entry('tool/call', 1, {
      turn: 1,
      step: 1,
      callId: 'call-1',
      name: 'read_file',
      arguments: '{"path":"README.md"}',
    }),
    entry('tool/result', 2, {
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
  assert.deepEqual(model.nodes.map(node => [node.kind, node.lifecycle]), [
    ['conversation.assistant', 'settled'],
    ['tool.read', 'settled'],
  ])
})

test('projects skill calls as the dedicated semantic tool kind', () => {
  const model = project([
    entry('tool/call', 0, {
      turn: 1, step: 1, callId: 'call-skill', name: 'skill', arguments: '{"name":"dsh-manage-issues"}',
    }),
    entry('tool/result', 1, {
      turn: 1, step: 1,
      message: { source: { callId: 'call-skill' }, content: [{ type: 'text', text: 'loaded' }] },
    }),
  ])
  assert.equal(model.nodes[0]?.kind, 'tool.skill')
  assert.equal(model.nodes[0]?.value.arguments, '{"name":"dsh-manage-issues"}')
})

test('projects native OpenCode tool names into semantic card kinds', () => {
  const model = project([
    entry('tool/call', 0, { turn: 1, step: 1, callId: 'call-bash', name: 'bash', arguments: '{"command":"printf OK"}' }),
    entry('tool/result', 1, { turn: 1, step: 1, message: { source: { callId: 'call-bash' }, content: [{ type: 'text', text: 'OK' }] } }),
    entry('tool/call', 2, { turn: 1, step: 2, callId: 'call-todo', name: 'todowrite', arguments: '{"todos":[]}' }),
    entry('tool/result', 3, { turn: 1, step: 2, message: { source: { callId: 'call-todo' }, content: [{ type: 'text', text: 'ok' }] } }),
    entry('tool/call', 4, { turn: 1, step: 3, callId: 'call-patch', name: 'apply_patch', arguments: '{"path":"app.ts"}' }),
    entry('tool/call', 5, { turn: 1, step: 4, callId: 'call-find', name: 'find', arguments: '{"pattern":"*.ts"}' }),
  ])
  assert.deepEqual(model.nodes.map(node => node.kind), ['tool.terminal', 'tool.workflow', 'tool.diff', 'tool.search'])
})

test('preserves OpenCode tool title, canonical kind, and pending-to-running state on one node', () => {
  const pending = project([
    entry('tool/call', 0, {
      turn: 1, step: 1, callId: 'call-read', name: 'filesystem.read_file', toolKind: 'tool.read',
      title: 'Read package.json', arguments: '{"path":"package.json"}', status: 'pending',
    }),
  ])
  const running = project([
    entry('tool/call', 0, {
      turn: 1, step: 1, callId: 'call-read', name: 'filesystem.read_file', toolKind: 'tool.read',
      title: 'Read package.json', arguments: '{"path":"package.json"}', status: 'pending',
    }),
    entry('tool/call', 1, {
      turn: 1, step: 1, callId: 'call-read', name: 'filesystem.read_file', toolKind: 'tool.read',
      title: 'Read package.json', arguments: '{"path":"package.json"}', status: 'running',
    }),
  ])
  assert.equal(pending.nodes.length, 1)
  assert.equal(pending.nodes[0]?.kind, 'tool.read')
  assert.equal(pending.nodes[0]?.value['status'], 'pending')
  assert.equal(running.nodes.length, 1)
  assert.equal(running.nodes[0]?.nodeId, 'session-1:tool:call-read')
  assert.equal(running.nodes[0]?.value['title'], 'Read package.json')
  assert.equal(running.nodes[0]?.value['status'], 'running')
})

test('invalid OpenCode tool kinds fail closed and failed results never become successful cards', () => {
  const model = project([
    entry('tool/call', 0, {
      turn: 1, step: 1, callId: 'call-unknown', name: 'vendor.magic', toolKind: 'tool.not-real',
      arguments: '{}', status: 'running',
    }),
    entry('tool/result', 1, {
      turn: 1, step: 1, name: 'vendor.magic', toolKind: 'tool.not-real',
      error: { name: 'permission denied' },
      message: { source: { callId: 'call-unknown' }, content: [{ type: 'text', text: 'permission denied' }] },
    }),
  ])
  assert.equal(model.nodes.length, 1)
  assert.equal(model.nodes[0]?.kind, 'tool.error')
  assert.equal(model.nodes[0]?.lifecycle, 'settled')
  assert.equal(model.nodes[0]?.value['toolKind'], undefined)
  assert.equal(model.nodes[0]?.value['status'], 'failed')
})

test('retains repeated equivalent completed tool calls as immutable history nodes', () => {
  const model = project([
    entry('tool/call', 0, { turn: 1, step: 1, callId: 'call-1', name: 'read_file', arguments: '{"path":"README.md"}' }),
    entry('tool/result', 1, { turn: 1, step: 1, message: { source: { callId: 'call-1' }, content: [{ type: 'text', text: 'contents' }] } }),
    entry('tool/call', 2, { turn: 1, step: 2, callId: 'call-2', name: 'read_file', arguments: '{"path":"README.md"}' }),
    entry('tool/result', 3, { turn: 1, step: 2, message: { source: { callId: 'call-2' }, content: [{ type: 'text', text: 'contents' }] } }),
  ])
  assert.equal(model.nodes.length, 2)
  assert.equal(model.nodes[0]?.value['count'], undefined)
  assert.equal(model.nodes[1]?.value['count'], undefined)
})

test('projects Code Mode sub-dispatches as independent semantic tool nodes', () => {
  const model = project([
    entry('tool/code-dispatch-start', 0, {
      rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'root-1:code:1',
      name: 'bash', arguments: { command: 'echo OK' },
    }),
    entry('tool/code-dispatch', 1, {
      rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'root-1:code:1',
      name: 'bash', arguments: { command: 'echo OK' }, isError: false,
      content: [{ type: 'text', text: 'OK\n' }],
    }),
  ])
  assert.equal(model.nodes.length, 1)
  const tool = model.nodes[0]
  assert.equal(tool?.kind, 'tool.terminal')
  if (tool?.kind !== 'tool.terminal') throw new Error('expected terminal sub-dispatch node')
  assert.equal(tool.nodeId, 'session-1:tool:root-1:code:1')
  assert.equal(tool.value.name, 'bash')
  assert.equal(tool.value.result, 'OK\n')
})

test('projects Code Mode edit dispatches as a diff tool node', () => {
  const model = project([
    entry('tool/code-dispatch-start', 0, {
      rootCallId: 'root-edit', parentCallId: 'root-edit', subCallId: 'root-edit:code:1',
      name: 'edit', arguments: { file_path: 'app.ts', old_string: 'old', new_string: 'new' },
    }),
    entry('tool/code-dispatch', 1, {
      rootCallId: 'root-edit', parentCallId: 'root-edit', subCallId: 'root-edit:code:1',
      name: 'edit', arguments: { file_path: 'app.ts', old_string: 'old', new_string: 'new' }, isError: false,
      content: [{ type: 'text', text: 'updated' }],
    }),
  ])
  assert.equal(model.nodes[0]?.kind, 'tool.diff')
})

test('suppresses the Code Mode orchestration card when its public sub-call starts', () => {
  const model = project([
    entry('tool/call', 0, {
      turn: 1, step: 1, callId: 'root-1', name: 'read', arguments: '{"file_path":"package.json"}',
    }),
    entry('tool/code-dispatch-start', 1, {
      rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'root-1:code:1',
      name: 'read', arguments: { file_path: 'package.json' },
    }),
    entry('tool/code-dispatch', 2, {
      rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'root-1:code:1',
      name: 'read', arguments: { file_path: 'package.json' }, isError: false,
      content: [{ type: 'text', text: 'public file result' }],
    }),
    entry('tool/result', 3, {
      turn: 1, step: 1,
      message: {
        id: 'root-result', role: 'user', source: { kind: 'tool', callId: 'root-1' },
        content: [{ type: 'text', text: 'orchestration result must stay hidden' }],
      },
    }),
  ])
  assert.deepEqual(model.nodes.map(node => node.nodeId), ['session-1:tool:root-1:code:1'])
  assert.equal(model.nodes[0]?.kind, 'tool.read')
})

test('projects nested public tool-result text for tool-card parsing', () => {
  const model = project([
    entry('tool/call', 0, {
      turn: 1, step: 1, callId: 'call-nested', name: 'run_code', arguments: '{}',
    }),
    entry('tool/result', 1, {
      turn: 1, step: 1,
      message: {
        id: 'tool-result-nested', role: 'user', source: { kind: 'tool', callId: 'call-nested' },
        content: [{ type: 'tool-result', content: [{ type: 'text', text: '{"before":"old","after":"new"}' }] }],
      },
    }),
  ])
  assert.equal(model.nodes[0]?.value.result, '{"before":"old","after":"new"}')
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
    'conversation.unknown',
  ])
  const error = model.nodes[0]
  if (error?.kind !== 'conversation.turn-error') throw new Error('expected error node')
  assert.equal(error.value.message, 'provider failed')
  const unknown = model.nodes[1]
  if (unknown?.kind !== 'conversation.unknown') throw new Error('expected unknown node')
  assert.deepEqual(unknown.value, { type: 'plugin/new-required-event', text: 'plugin/new-required-event' })
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

test('presentation service appends new history entries without replaying the existing prefix', () => {
  const ctx = new Context()
  apply(ctx)
  const first = entry('user/message', 0, {
    id: 'message-1',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'first' }],
  })
  const second = entry('user/message', 1, {
    id: 'message-2',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'second' }],
  })
  const firstModel = ctx.tuiPresentation.project({ sessionId: 'session-1', lastSeq: 0, entries: [first] })
  const secondModel = ctx.tuiPresentation.project({ sessionId: 'session-1', lastSeq: 1, entries: [first, second] })
  assert.equal(firstModel.nodes.length, 1)
  assert.deepEqual(secondModel.nodes.map(node => node.value['text']), ['first', 'second'])
  assert.equal(secondModel.nodes[0], firstModel.nodes[0])
})

test('projects turn error with empty or missing message into a readable non-empty label', () => {
  for (const reason of [
    { kind: 'error', error: {} },
    { kind: 'error', error: { code: 'UPSTREAM' } },
    { kind: 'error', error: { message: '' } },
    { kind: 'error' },
  ] as const) {
    const model = project([
      entry('turn/start', 0, { turn: 1 }),
      entry('turn/end', 1, { turn: 1, reason }),
    ])
    const error = model.nodes.find(candidate => candidate.kind === 'conversation.turn-error')
    if (error?.kind !== 'conversation.turn-error') throw new Error('expected conversation.turn-error node')
    assert.equal(typeof error.value.message, 'string')
    assert.ok(error.value.message.length > 0, `expected non-empty message for ${JSON.stringify(reason)}`)
  }
})

test('projects turn error with string or failure-shaped error data', () => {
  for (const [error, expected] of [
    ['provider connection reset', 'provider connection reset'],
    [{ failure: { message: 'provider outage', code: 'UPSTREAM' } }, 'provider outage'],
    [{ failure: { code: 'UPSTREAM' } }, 'turn failed'],
    [{ message: 'provider failed', code: 'UPSTREAM' }, 'provider failed'],
  ] as const) {
    const model = project([
      entry('turn/start', 0, { turn: 1 }),
      entry('turn/end', 1, { turn: 1, reason: { kind: 'error', error } }),
    ])
    const node = model.nodes.find(candidate => candidate.kind === 'conversation.turn-error')
    if (node?.kind !== 'conversation.turn-error') throw new Error('expected conversation.turn-error node')
    assert.equal(node.value.message, expected)
  }
})
