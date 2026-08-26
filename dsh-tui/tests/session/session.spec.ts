import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {
  ApprovalResponsePayload,
  ClientResponse,
  HistoryEntry,
  HostFrame,
  MuxFrame,
  QuestionResponsePayload,
  RpcRequest,
  RpcReceipt,
  RpcResponse,
  SessionSummary,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  TuiSessionError,
  apply,
  canonicalCurrentCwd,
  tuiSessionServiceName,
} from '../../playground/experiments/session/src/session.ts'
import type { TuiSessionHost } from '../../playground/experiments/session/src/session.ts'

function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: RpcId('rpc-1'), result: { ok: true, value } }
}

function event(type: string, seq: number): SessionEvent {
  return { type, seq, time: seq * 1000, data: {} } as unknown as SessionEvent
}

function historyEntry(seq: number): HistoryEntry {
  return { event: event('user/message', seq) }
}

async function* frameStream<F>(frames: readonly F[]): AsyncGenerator<RpcRequest<F>> {
  for (const frame of frames) yield { rpcId: RpcId('rpc-1'), payload: frame }
  await new Promise<void>(() => undefined)
}

interface FakeCalls {
  create: unknown[]
  prompt: unknown[]
  cancel: unknown[]
  listCalls: number
  respond: ClientResponse[]
  muxSignals: AbortSignal[]
  hostSignals: AbortSignal[]
  historyCalls: number
}

function makeHost(options: {
  items?: SessionSummary[]
  historyEvents?: readonly HistoryEntry[]
  muxFrames?: readonly MuxFrame[]
  hostFrames?: readonly HostFrame[]
} = {}): { host: TuiSessionHost; calls: FakeCalls } {
  const calls: FakeCalls = {
    create: [],
    prompt: [],
    cancel: [],
    listCalls: 0,
    respond: [],
    muxSignals: [],
    hostSignals: [],
    historyCalls: 0,
  }
  const host = {
    sessions: {
      list: async () => {
        calls.listCalls += 1
        return ok({ items: options.items ?? [] })
      },
      create: async (payload: unknown) => {
        calls.create.push(payload)
        const typed = payload as { sessionId?: string }
        return ok({ sessionId: SessionId(typed.sessionId ?? 'new-session') })
      },
      history: async () => {
        calls.historyCalls += 1
        return ok({ events: options.historyEvents ?? [], hasMore: false })
      },
      prompt: async (payload: unknown) => {
        calls.prompt.push(payload)
        return ok({ accepted: true as const })
      },
      cancel: async (payload: unknown) => {
        calls.cancel.push(payload)
        return ok({ accepted: true as const })
      },
    },
    events: {
      mux: (_payload: unknown, signal: AbortSignal, onOpen?: () => void) => {
        calls.muxSignals.push(signal)
        onOpen?.()
        return frameStream(options.muxFrames ?? [])
      },
      host: (_payload: unknown, signal: AbortSignal) => {
        calls.hostSignals.push(signal)
        return frameStream(options.hostFrames ?? [])
      },
    },
    respond: async (message: ClientResponse): Promise<RpcReceipt> => {
      calls.respond.push(message)
      return { accepted: true }
    },
  } as unknown as TuiSessionHost
  return { host, calls }
}

function installed(): Context {
  const ctx = new Context()
  apply(ctx)
  return ctx
}

async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('createCurrentCwd creates one canonical current-cwd Session and hydrates history', async () => {
  const ctx = installed()
  const { host, calls } = makeHost({
    historyEvents: [historyEntry(0), historyEntry(1)],
    muxFrames: [{ type: 'session/subscribed', sessionId: SessionId('new-session'), lastSeq: 1 }],
  })
  const snapshot = await ctx.tuiSession.createCurrentCwd(host)
  assert.equal(snapshot.sessionId, SessionId('new-session'))
  assert.equal(snapshot.cwd, await canonicalCurrentCwd())
  assert.equal(snapshot.entries.length, 2)
  assert.equal(snapshot.lastSeq, 1)
  assert.deepEqual(snapshot.availableSessionIds, [SessionId('new-session')])
  assert.deepEqual(calls.create[0], { cwd: await canonicalCurrentCwd() })
  await waitFor(() => ctx.tuiSession.snapshot?.live === true)
  assert.equal(ctx.tuiSession.snapshot?.lastSeq, 1)
})

test('resume accepts only a listed Session whose canonical cwd equals current cwd', async () => {
  const ctx = installed()
  const canonical = await canonicalCurrentCwd()
  const summary = {
    sessionId: SessionId('session-a'),
    updatedAt: 1,
    running: false,
    blank: false,
    cwd: canonical,
  } as SessionSummary
  const { host, calls } = makeHost({
    items: [summary],
    historyEvents: [historyEntry(0)],
  })
  const snapshot = await ctx.tuiSession.resume(host, 'session-a')
  assert.equal(snapshot.sessionId, SessionId('session-a'))
  assert.deepEqual(snapshot.availableSessionIds, [SessionId('session-a')])
  assert.deepEqual(calls.create[0], { sessionId: SessionId('session-a'), cwd: canonical })
  assert.equal(calls.listCalls, 1)
})

test('current-cwd resume options include only canonical matches, sorted by updatedAt descending', async () => {
  const ctx = installed()
  const canonical = await canonicalCurrentCwd()
  const { host, calls } = makeHost({
    items: [
      { sessionId: SessionId('session-a'), updatedAt: 1, running: false, blank: false, cwd: canonical } as SessionSummary,
      { sessionId: SessionId('session-other'), updatedAt: 2, running: false, blank: false, cwd: tmpdir() } as SessionSummary,
      { sessionId: SessionId('session-b'), updatedAt: 3, running: true, blank: false, cwd: canonical } as SessionSummary,
    ],
  })
  const options = await ctx.tuiSession.listCurrentCwdSessions(host)
  assert.deepEqual(options, [
    { sessionId: SessionId('session-b'), cwd: canonical, running: true, updatedAt: 3, blank: false },
    { sessionId: SessionId('session-a'), cwd: canonical, running: false, updatedAt: 1, blank: false },
  ])
  assert.equal(ctx.tuiSession.snapshot, null)
  assert.equal(calls.listCalls, 1)
})

test('latestCurrentCwdSession picks the newest non-blank current-cwd Session', async () => {
  const ctx = installed()
  const canonical = await canonicalCurrentCwd()
  const { host } = makeHost({
    items: [
      { sessionId: SessionId('session-old'), updatedAt: 10, running: false, blank: false, cwd: canonical } as SessionSummary,
      { sessionId: SessionId('session-newer'), updatedAt: 20, running: false, blank: false, cwd: canonical } as SessionSummary,
      { sessionId: SessionId('session-blank'), updatedAt: 30, running: false, blank: true, cwd: canonical } as SessionSummary,
      { sessionId: SessionId('session-other'), updatedAt: 40, running: false, blank: false, cwd: tmpdir() } as SessionSummary,
    ],
  })
  const latest = await ctx.tuiSession.latestCurrentCwdSession(host)
  assert.deepEqual(latest, {
    sessionId: SessionId('session-newer'),
    cwd: canonical,
    running: false,
    updatedAt: 20,
    blank: false,
  })
})

test('latestCurrentCwdSession returns null when every current-cwd Session is blank', async () => {
  const ctx = installed()
  const canonical = await canonicalCurrentCwd()
  const { host } = makeHost({
    items: [
      { sessionId: SessionId('session-blank'), updatedAt: 30, running: false, blank: true, cwd: canonical } as SessionSummary,
    ],
  })
  assert.equal(await ctx.tuiSession.latestCurrentCwdSession(host), null)
})

test('current-cwd resume options skip stale sessions with malformed cwd truth', async () => {
  const ctx = installed()
  const canonical = await canonicalCurrentCwd()
  const { host } = makeHost({
    items: [
      {
        sessionId: SessionId('session-bad'), updatedAt: 2, running: false, blank: false,
        cwd: '/definitely/not/a/dsh-session-dir',
      } as SessionSummary,
      {
        sessionId: SessionId('session-good'), updatedAt: 1, running: false, blank: false,
        cwd: canonical,
      } as SessionSummary,
    ],
  })
  assert.deepEqual(await ctx.tuiSession.listCurrentCwdSessions(host), [{
    sessionId: SessionId('session-good'),
    cwd: canonical,
    running: false,
    updatedAt: 1,
    blank: false,
  }])
})

test('resume atomically switches an already selected Session and stops its live streams', async () => {
  const ctx = installed()
  const canonical = await canonicalCurrentCwd()
  const { host, calls } = makeHost({
    items: [{
      sessionId: SessionId('session-b'),
      updatedAt: 2,
      running: false,
      blank: false,
      cwd: canonical,
    } as SessionSummary],
    historyEvents: [historyEntry(0)],
  })

  await ctx.tuiSession.createCurrentCwd(host)
  const oldMuxSignal = calls.muxSignals[0]
  const oldHostSignal = calls.hostSignals[0]
  assert.equal(ctx.tuiSession.snapshot?.sessionId, SessionId('new-session'))

  const switched = await ctx.tuiSession.resume(host, 'session-b')
  assert.equal(switched.sessionId, SessionId('session-b'))
  assert.equal(ctx.tuiSession.snapshot?.sessionId, SessionId('session-b'))
  assert.equal(oldMuxSignal?.aborted, true)
  assert.equal(oldHostSignal?.aborted, true)
  assert.equal(calls.muxSignals.length, 2)
  assert.equal(calls.hostSignals.length, 2)
})

test('failed resume keeps the existing Session selected and its streams active', async () => {
  const ctx = installed()
  const { host, calls } = makeHost({ items: [] })
  await ctx.tuiSession.createCurrentCwd(host)
  const oldMuxSignal = calls.muxSignals[0]
  const oldHostSignal = calls.hostSignals[0]

  await assert.rejects(
    ctx.tuiSession.resume(host, 'missing-session'),
    (error: unknown) => error instanceof TuiSessionError && error.kind === 'resume-not-found',
  )

  assert.equal(ctx.tuiSession.snapshot?.sessionId, SessionId('new-session'))
  assert.equal(oldMuxSignal?.aborted, false)
  assert.equal(oldHostSignal?.aborted, false)
  assert.equal(calls.create.length, 1)
})

test('resume fails closed and never creates on missing, invalid or mismatched cwd', async () => {
  const canonical = await canonicalCurrentCwd()
  const scenarios: Array<{ name: string; summary: SessionSummary; expected: string }> = [
    {
      name: 'missing-cwd',
      summary: {
        sessionId: SessionId('session-a'),
        updatedAt: 1,
        running: false,
        blank: false,
      } as SessionSummary,
      expected: 'resume-cwd-missing',
    },
    {
      name: 'invalid-cwd',
      summary: {
        sessionId: SessionId('session-a'),
        updatedAt: 1,
        running: false,
        blank: false,
        cwd: '/definitely/not/a/dsh-session-dir',
      } as SessionSummary,
      expected: 'resume-cwd-invalid',
    },
    {
      name: 'mismatched-cwd',
      summary: {
        sessionId: SessionId('session-a'),
        updatedAt: 1,
        running: false,
        blank: false,
        cwd: tmpdir(),
      } as SessionSummary,
      expected: 'resume-cwd-mismatch',
    },
  ]
  for (const scenario of scenarios) {
    const ctx = installed()
    const { host, calls } = makeHost({ items: [scenario.summary] })
    await assert.rejects(
      ctx.tuiSession.resume(host, 'session-a'),
      (error: unknown) => error instanceof TuiSessionError && error.kind === scenario.expected,
    )
    assert.equal(calls.create.length, 0, scenario.name)
    assert.equal(canonical.length > 0, true)
  }
})

test('resume rejects an unknown Session without a replacement create', async () => {
  const ctx = installed()
  const { host, calls } = makeHost({ items: [] })
  await assert.rejects(
    ctx.tuiSession.resume(host, 'missing-session'),
    (error: unknown) => error instanceof TuiSessionError && error.kind === 'resume-not-found',
  )
  assert.equal(calls.create.length, 0)
})

test('live mux frames append by seq and ignore duplicates', async () => {
  const ctx = installed()
  const { host } = makeHost({
    historyEvents: [historyEntry(0), historyEntry(1)],
    muxFrames: [
      { type: 'session/subscribed', sessionId: SessionId('new-session'), lastSeq: 1 },
      {
        type: 'session/event',
        sessionId: SessionId('new-session'),
        event: event('assistant/chunk', 2),
      },
      {
        type: 'session/event',
        sessionId: SessionId('new-session'),
        event: event('assistant/chunk', 1),
      },
      {
        type: 'session/event',
        sessionId: SessionId('new-session'),
        event: event('assistant/chunk', 3),
      },
    ],
  })
  await ctx.tuiSession.createCurrentCwd(host)
  await waitFor(() => ctx.tuiSession.snapshot?.lastSeq === 3)
  assert.equal(ctx.tuiSession.snapshot?.entries.length, 4)
  assert.equal(ctx.tuiSession.snapshot?.entries[3]?.event.seq, 3)
})

test('live sequence gaps are explicit errors, never silent fallback', async () => {
  const ctx = installed()
  const { host } = makeHost({
    historyEvents: [historyEntry(0), historyEntry(1)],
    muxFrames: [
      { type: 'session/subscribed', sessionId: SessionId('new-session'), lastSeq: 1 },
      {
        type: 'session/event',
        sessionId: SessionId('new-session'),
        event: event('assistant/chunk', 3),
      },
    ],
  })
  await ctx.tuiSession.createCurrentCwd(host)
  await waitFor(() => ctx.tuiSession.snapshot?.error !== undefined)
  assert.match(ctx.tuiSession.snapshot?.error ?? '', /sequence gap/)
  assert.equal(ctx.tuiSession.snapshot?.entries.length, 2)
  assert.equal(ctx.tuiSession.snapshot?.live, false)
})

test('mux reconnect rebaselines history before applying the new subscription', async () => {
  const ctx = installed()
  const muxFrames: MuxFrame[] = []
  let reconnect: (() => void) | undefined
  const calls = { history: 0 }
  const host = {
    sessions: {
      list: async () => ok({ items: [] }),
      create: async () => ok({ sessionId: SessionId('new-session') }),
      history: async () => {
        calls.history += 1
        return ok({
          events: calls.history === 1
            ? [historyEntry(0), historyEntry(1)]
            : [historyEntry(0), historyEntry(1), historyEntry(2), historyEntry(3)],
          hasMore: false,
        })
      },
      prompt: async () => ok({ accepted: true as const }),
      cancel: async () => ok({ accepted: true as const }),
    },
    events: {
      mux: (_payload: unknown, _signal: AbortSignal, onOpen?: () => void) => {
        onOpen?.()
        reconnect = onOpen
        return frameStream(muxFrames)
      },
      host: (_payload: unknown, _signal: AbortSignal) => frameStream([]),
    },
    respond: async (): Promise<RpcReceipt> => ({ accepted: true }),
  } as unknown as TuiSessionHost

  await ctx.tuiSession.createCurrentCwd(host)
  reconnect?.()
  await waitFor(() => ctx.tuiSession.snapshot?.lastSeq === 3)
  assert.equal(calls.history, 2)
  assert.deepEqual(ctx.tuiSession.snapshot?.entries.map(entry => entry.event.seq), [0, 1, 2, 3])
  assert.equal(ctx.tuiSession.snapshot?.error, undefined)
})

test('failed reconnect rebaseline is explicit and preserves the last good history', async () => {
  const ctx = installed()
  let reconnect: (() => void) | undefined
  let historyCalls = 0
  const host = {
    sessions: {
      list: async () => ok({ items: [] }),
      create: async () => ok({ sessionId: SessionId('new-session') }),
      history: async () => {
        historyCalls += 1
        if (historyCalls > 1) {
          return { rpcId: RpcId('rpc-fail'), result: { ok: false, error: { code: 'history-failed', message: 'history failed' } } }
        }
        return ok({ events: [historyEntry(0), historyEntry(1)], hasMore: false })
      },
      prompt: async () => ok({ accepted: true as const }),
      cancel: async () => ok({ accepted: true as const }),
    },
    events: {
      mux: (_payload: unknown, _signal: AbortSignal, onOpen?: () => void) => {
        onOpen?.()
        reconnect = onOpen
        return frameStream([])
      },
      host: (_payload: unknown, _signal: AbortSignal) => frameStream([]),
    },
    respond: async (): Promise<RpcReceipt> => ({ accepted: true }),
  } as unknown as TuiSessionHost

  await ctx.tuiSession.createCurrentCwd(host)
  reconnect?.()
  await waitFor(() => ctx.tuiSession.snapshot?.error !== undefined)
  assert.match(ctx.tuiSession.snapshot?.error ?? '', /session\.history failed/)
  assert.deepEqual(ctx.tuiSession.snapshot?.entries.map(entry => entry.event.seq), [0, 1])
  assert.equal(ctx.tuiSession.snapshot?.live, false)
})

test('prompt and cancel route through the selected Session public host', async () => {
  const ctx = installed()
  const { host, calls } = makeHost({ historyEvents: [historyEntry(0)] })
  await ctx.tuiSession.createCurrentCwd(host)
  const promptResult = await ctx.tuiSession.prompt('继续')
  assert.equal(promptResult.ok, true)
  assert.deepEqual(calls.prompt[0], {
    sessionId: SessionId('new-session'),
    mode: 'queue',
    content: [{ type: 'text', text: '继续' }],
  })
  const cancelResult = await ctx.tuiSession.cancel()
  assert.equal(cancelResult.ok, true)
  assert.deepEqual(calls.cancel[0], { sessionId: SessionId('new-session') })
})

test('approval and question responses use pending mux rpcIds and public respond', async () => {
  const ctx = installed()
  const { host, calls } = makeHost({
    muxFrames: [
      {
        type: 'approval/requested',
        sessionId: SessionId('new-session'),
        approvalId: 'approval-1' as never,
        toolName: 'shell',
      },
      {
        type: 'question/requested',
        sessionId: SessionId('new-session'),
        questions: [{ id: 'question-1', question: 'Continue?' }],
      },
    ],
  })
  await ctx.tuiSession.createCurrentCwd(host)
  await waitFor(() => ctx.tuiSession.snapshot?.interactions.length === 2)

  const approval = ctx.tuiSession.snapshot?.interactions.find(item => item.kind === 'approval')
  const question = ctx.tuiSession.snapshot?.interactions.find(item => item.kind === 'question')
  if (!approval || !question) throw new Error('expected pending interactions')

  const approvalReceipt = await ctx.tuiSession.respondApproval(approval.interactionId, true)
  const questionReceipt = await ctx.tuiSession.respondQuestion(question.interactionId, {
    answers: [{ id: 'question-1', selected: ['Yes'] }],
  })
  assert.deepEqual(approvalReceipt, { accepted: true })
  assert.deepEqual(questionReceipt, { accepted: true })
  assert.deepEqual((calls.respond[0]?.result as { value: ApprovalResponsePayload }).value, {
    sessionId: SessionId('new-session'),
    approvalId: 'approval-1',
    outcome: 'allowed-once',
  })
  assert.deepEqual((calls.respond[1]?.result as { value: QuestionResponsePayload }).value, {
    sessionId: SessionId('new-session'),
    answer: { answers: [{ id: 'question-1', selected: ['Yes'] }] },
  })
  assert.equal(ctx.tuiSession.snapshot?.interactions.length, 0)
})

test('interaction response rejects unknown IDs and never calls public respond', async () => {
  const ctx = installed()
  const { host, calls } = makeHost()
  await ctx.tuiSession.createCurrentCwd(host)
  await assert.rejects(ctx.tuiSession.respondApproval('missing', true), /pending approval/)
  await assert.rejects(ctx.tuiSession.respondQuestion('missing', { answers: [] }), /pending question/)
  assert.deepEqual(calls.respond, [])
})

test('session service is installed under the canonical name', () => {
  const ctx = installed()
  assert.equal(ctx.tuiSession.name, tuiSessionServiceName)
  assert.equal(ctx.get(tuiSessionServiceName)?.name, tuiSessionServiceName)
})
