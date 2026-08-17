import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {
  HistoryEntry,
  HostFrame,
  MuxFrame,
  RpcRequest,
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
}

function makeHost(options: {
  items?: SessionSummary[]
  historyEvents?: readonly HistoryEntry[]
  muxFrames?: readonly MuxFrame[]
  hostFrames?: readonly HostFrame[]
} = {}): { host: TuiSessionHost; calls: FakeCalls } {
  const calls: FakeCalls = { create: [], prompt: [], cancel: [], listCalls: 0 }
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
      history: async () => ok({
        events: options.historyEvents ?? [],
        hasMore: false,
      }),
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
      mux: () => frameStream(options.muxFrames ?? []),
      host: () => frameStream(options.hostFrames ?? []),
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
  assert.deepEqual(calls.create[0], { sessionId: SessionId('session-a'), cwd: canonical })
  assert.equal(calls.listCalls, 1)
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

test('session service is installed under the canonical name', () => {
  const ctx = installed()
  assert.equal(ctx.tuiSession.name, tuiSessionServiceName)
  assert.equal(ctx.get(tuiSessionServiceName)?.name, tuiSessionServiceName)
})
