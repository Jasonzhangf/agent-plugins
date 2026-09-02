import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  SessionAddress,
  SessionControlFrame,
  SessionFollowFrame,
  SessionHistoryRecord,
  SessionProjectionBaseline,
  SessionSummary,
  SessionWireEvent,
} from '@deepseek-ai/dsh-api-session-controller/types'
import {
  TuiSessionError,
  apply,
  canonicalCurrentCwd,
  tuiSessionServiceName,
} from '../../playground/experiments/session/src/session.ts'
import {
  createTuiAlpha4Host,
  type TuiAlpha4Host,
  type TuiAlpha4Remote,
  type TuiForwardedEvent,
} from '../../playground/experiments/transport/src/transport.ts'

interface FakeCalls {
  create: unknown[]
  prompt: unknown[]
  command: unknown[]
  cancel: unknown[]
  listCalls: number
  historyCalls: number
  historyRequests: unknown[]
  fork: unknown[]
  selectModel: unknown[]
  updateQueue: unknown[]
  approveResponses: Array<{ readonly clientId: string; readonly eventId: string; readonly outcome: { readonly kind: string; readonly value?: unknown } }>
  questionResponses: Array<{ readonly clientId: string; readonly eventId: string; readonly outcome: { readonly kind: string; readonly value?: unknown } }>
}

interface FakeHostOptions {
  items?: readonly SessionSummary[]
  historyRecords?: readonly SessionHistoryRecord[]
  historyPages?: readonly { readonly beforeSeq?: number; readonly records: readonly SessionHistoryRecord[]; readonly hasMore: boolean }[]
  historyProjections?: SessionProjectionBaseline | readonly SessionProjectionBaseline[]
  createdSessionId?: string
  followFrames?: readonly SessionFollowFrame[]
  controlFrames?: readonly SessionControlFrame[]
  eventsFrames?: readonly TuiForwardedEvent[]
  firstReady?: { readonly clientId: string }
  forkedSessionId?: string
}

function asSessionId(value: string): SessionId {
  return SessionId(value)
}

function event(type: string, seq: number, data: Record<string, unknown> = {}): SessionWireEvent {
  return { type, seq, time: 1000 + seq, data } as SessionWireEvent
}

function recordOf(seq: number, type = 'user/message'): SessionHistoryRecord {
  return { type: 'event', event: event(type, seq) }
}

function defaultProjections(asOfSeq: number): SessionProjectionBaseline {
  return { asOfSeq, values: {} }
}

async function followSnapshot(cursor: number, records: readonly SessionHistoryRecord[], hasMore = false): Promise<SessionFollowFrame> {
  return {
    type: 'snapshot',
    header: { version: 1, id: asSessionId('new-session'), createdAt: 1000, cwd: await canonicalCurrentCwd() },
    cursor,
    records,
    hasMore,
    projections: defaultProjections(cursor),
  }
}

function buildFakeRemote(options: FakeHostOptions): { remote: TuiAlpha4Remote; calls: FakeCalls } {
  const calls: FakeCalls = {
    create: [],
    prompt: [],
    command: [],
    cancel: [],
    listCalls: 0,
    historyCalls: 0,
    historyRequests: [],
    fork: [],
    selectModel: [],
    updateQueue: [],
    approveResponses: [],
    questionResponses: [],
  }
  const remote: TuiAlpha4Remote = {
    session: {
      list: async () => {
        calls.listCalls += 1
        return { ok: true as const, value: { items: options.items ?? [] } }
      },
      create: async (request: unknown) => {
        calls.create.push(request)
        const typed = request as { sessionId?: string }
        const sessionId = typed.sessionId ?? options.createdSessionId ?? 'new-session'
        return { ok: true as const, value: { sessionId } }
      },
      fork: async (request: unknown) => {
        calls.fork.push(request)
        return { ok: true as const, value: { sessionId: options.forkedSessionId ?? 'forked-session' } }
      },
      page: async (request: unknown) => {
        calls.historyCalls += 1
        calls.historyRequests.push(request)
        const page = options.historyPages?.[Math.min(calls.historyCalls - 1, (options.historyPages?.length ?? 1) - 1)]
        if (page !== undefined) {
          return { ok: true as const, value: { records: page.records, hasMore: page.hasMore } }
        }
        const projections = Array.isArray(options.historyProjections)
          ? options.historyProjections[Math.min(calls.historyCalls - 1, options.historyProjections.length - 1)]
          : options.historyProjections
        const value: { records: readonly SessionHistoryRecord[]; hasMore: boolean; projections?: SessionProjectionBaseline } = {
          records: options.historyRecords ?? [],
          hasMore: false,
        }
        if (projections !== undefined) value.projections = projections
        return { ok: true as const, value }
      },
      follow: async function* (_request: unknown, signal: AbortSignal) {
        for (const frame of options.followFrames ?? []) {
          if (signal.aborted) return
          yield frame
        }
        if ((options.followFrames === undefined || options.followFrames.length === 0)
          && (options.historyRecords !== undefined || options.historyPages !== undefined)) {
          const projections = Array.isArray(options.historyProjections)
            ? options.historyProjections[0]
            : options.historyProjections
          const snapshot: SessionFollowFrame = projections === undefined
            ? await followSnapshot(options.historyRecords ? options.historyRecords.length - 1 : 0, options.historyRecords ?? [], false)
            : { type: 'snapshot', header: { version: 1, id: asSessionId('new-session'), createdAt: 1000, cwd: await canonicalCurrentCwd() }, cursor: options.historyRecords ? options.historyRecords.length - 1 : 0, records: options.historyRecords ?? [], hasMore: false, projections }
          yield snapshot
        }
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
      control: async function* (signal: AbortSignal) {
        for (const frame of options.controlFrames ?? []) {
          if (signal.aborted) return
          yield frame
        }
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
      prompt: async (request: unknown) => {
        calls.prompt.push(request)
        return { ok: true as const, value: { accepted: true as const } }
      },
      updateQueue: async (request: unknown) => {
        calls.updateQueue.push(request)
        return { ok: true as const, value: { accepted: true as const } }
      },
      cancel: async (request: unknown) => {
        calls.cancel.push(request)
        return { ok: true as const, value: { accepted: true as const } }
      },
      selectModel: async (request: unknown) => {
        calls.selectModel.push(request)
        return { ok: true as const, value: { selected: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' } } }
      },
      modelCatalog: async () => ({ ok: true as const, value: { default: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }, groups: [], failures: [], routableProviders: [] } }),
      rename: async () => ({ ok: true as const, value: { title: '', seq: 0 } }),
      search: async () => ({ ok: true as const, value: { items: [], hasMore: false } }),
      openWorkspacePath: async () => ({ ok: true as const, value: { opened: true as const } }),
    },
    workspace: {
      follow: () => (async function* () {
        yield { type: 'baseline' as const, value: { items: [], archivedSessionIds: [] } }
      })(),
      list: async () => ({ ok: true as const, value: { items: [] } }),
      create: async () => ({ ok: true as const, value: undefined }),
      rename: async () => ({ ok: true as const, value: undefined }),
      delete: async () => ({ ok: true as const, value: undefined }),
      archiveSession: async () => ({ ok: true as const, value: undefined }),
    },
    directoryPicker: {
      list: async () => ({ ok: true as const, value: undefined }),
      pick: async () => ({ ok: true as const, value: null }),
      createDirectory: async () => ({ ok: true as const, value: '' }),
    },
    settings: {
      describe: async () => ({ ok: true as const, value: undefined }),
      mutate: async () => ({ ok: true as const, value: undefined }),
      openSettingsDocument: async () => ({ ok: true as const, value: undefined }),
    },
    credentials: { describe: async () => ({ ok: true as const, value: undefined }) },
    agentPresets: {
      list: async () => ({ ok: true as const, value: undefined }),
      select: async () => ({ ok: true as const, value: '' }),
      read: async () => ({ ok: true as const, value: undefined }),
      copy: async () => ({ ok: true as const, value: undefined }),
      deletePreset: async () => ({ ok: true as const, value: undefined }),
    },
    goals: {
      pause: async () => ({ ok: true as const, value: undefined }),
      resume: async () => ({ ok: true as const, value: undefined }),
      clear: async () => ({ ok: true as const, value: undefined }),
      edit: async () => ({ ok: true as const, value: undefined }),
    },
    llm: {
      listProviders: async () => ({ ok: true as const, value: undefined }),
      listConfigurableProviders: async () => ({ ok: true as const, value: undefined }),
      discoverModels: async () => ({ ok: true as const, value: undefined }),
    },
    skills: { list: async () => ({ ok: true as const, value: undefined }) },
    subagents: {
      list: async () => ({ ok: true as const, value: undefined }),
      prompt: async () => ({ ok: true as const, value: undefined }),
      interruptByParent: async () => ({ ok: true as const, value: undefined }),
    },
    commands: {
      execute: async (_agentId: string, line: string, _images: readonly unknown[]) => {
        calls.command.push({ line })
        return { ok: true as const, value: { kind: 'success' as const } }
      },
    },
    events: {
      follow: async function* (signal: AbortSignal) {
        const frames: TuiForwardedEvent[] = []
        if (options.firstReady !== undefined) {
          frames.push({ type: 'ready', clientId: options.firstReady.clientId, host: { home: '/home/fake' } })
        }
        for (const frame of options.eventsFrames ?? []) frames.push(frame)
        for (const emitted of frames) {
          if (signal.aborted) return
          yield emitted
        }
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
      respond: async (result) => {
        if (result.outcome.kind === 'rejected') {
          calls.approveResponses.push(result)
        } else if (result.eventId.startsWith('approval')) {
          calls.approveResponses.push(result)
        } else if (result.eventId.startsWith('question')) {
          calls.questionResponses.push(result)
        } else {
          calls.approveResponses.push(result)
        }
      },
    },
  }
  return { remote, calls }
}

function buildFakeHost(options: FakeHostOptions): { host: TuiAlpha4Host; calls: FakeCalls } {
  const real = createTuiAlpha4Host(new URL('http://127.0.0.1:3080/'))
  const { remote, calls } = buildFakeRemote(options)
  Object.defineProperty(real, 'remote', { configurable: true, get: () => remote })
  return { host: real, calls }
}

const _trackedContexts: Context[] = []

function installed(t: import('node:test').TestContext): Context {
  const ctx = new Context()
  apply(ctx)
  _trackedContexts.push(ctx)
  t.afterEach(() => { ctx.tuiSession.dispose() })
  return ctx
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('createCurrentCwd creates one canonical current-cwd Session and hydrates history', async (t) => {
  const ctx = installed(t)
  const snapshot = await followSnapshot(1, [recordOf(0), recordOf(1)])
  const { host, calls } = buildFakeHost({
    historyRecords: [recordOf(0), recordOf(1)],
    followFrames: [snapshot],
    eventsFrames: [{ type: 'ready', clientId: 'c-1', host: { home: '/home' } }, { type: 'emit', event: 'api-session/status', args: ['new-session', true] }],
  })
  const selected = await ctx.tuiSession.createCurrentCwd(host)
  assert.equal(selected.sessionId, asSessionId('new-session'))
  assert.equal(selected.cwd, await canonicalCurrentCwd())
  assert.equal(selected.entries.length, 2)
  assert.equal(selected.lastSeq, 1)
  assert.deepEqual(calls.create[0], { cwd: await canonicalCurrentCwd() })
})

test('hydrate returns the snapshot projections and last seq', async (t) => {
  const ctx = installed(t)
  const projections: SessionProjectionBaseline = { asOfSeq: 3, values: { permissions: { current: 'read-only' } } }
  const snapshot: SessionFollowFrame = { type: 'snapshot', header: { version: 1, id: asSessionId('new-session'), createdAt: 1000, cwd: await canonicalCurrentCwd() }, cursor: 3, records: [recordOf(0), recordOf(1), recordOf(2), recordOf(3)], hasMore: false, projections }
  const { host } = buildFakeHost({
    historyRecords: [recordOf(0), recordOf(1), recordOf(2), recordOf(3)],
    historyProjections: projections,
    followFrames: [snapshot],
  })
  const selected = await ctx.tuiSession.createCurrentCwd(host)
  assert.equal(selected.lastSeq, 3)
  assert.deepEqual(selected.projections, projections)
  assert.equal(selected.entries.length, 4)
})

test('listCurrentCwdSessions excludes subagent origins and mismatched cwd', async (t) => {
  const ctx = installed(t)
  const canonical = await canonicalCurrentCwd()
  const { host } = buildFakeHost({
    items: [
      { sessionId: asSessionId('session-a'), updatedAt: 1, running: false, blank: false, cwd: canonical },
      { sessionId: asSessionId('session-other'), updatedAt: 2, running: false, blank: false, cwd: tmpdir() },
      { sessionId: asSessionId('session-subagent'), updatedAt: 4, running: false, blank: false, cwd: canonical, origin: 'subagent' },
    ],
  })
  const options = await ctx.tuiSession.listCurrentCwdSessions(host)
  assert.equal(options.length, 1)
  assert.equal(options[0]?.sessionId, asSessionId('session-a'))
})

test('latestCurrentCwdSession skips blank Sessions', async (t) => {
  const ctx = installed(t)
  const canonical = await canonicalCurrentCwd()
  const { host } = buildFakeHost({
    items: [
      { sessionId: asSessionId('session-blank'), updatedAt: 30, running: false, blank: true, cwd: canonical },
    ],
  })
  assert.equal(await ctx.tuiSession.latestCurrentCwdSession(host), null)
})

test('resume accepts only a listed Session whose canonical cwd equals current cwd', async (t) => {
  const ctx = installed(t)
  const canonical = await canonicalCurrentCwd()
  const { host, calls } = buildFakeHost({
    items: [{ sessionId: asSessionId('session-a'), updatedAt: 1, running: false, blank: false, cwd: canonical }],
    historyRecords: [recordOf(0)],
  })
  const snapshot = await ctx.tuiSession.resume(host, 'session-a')
  assert.equal(snapshot.sessionId, asSessionId('session-a'))
  assert.deepEqual(calls.create[0], { sessionId: asSessionId('session-a'), cwd: canonical })
})

test('resume rejects an unknown Session without a replacement create', async (t) => {
  const ctx = installed(t)
  const { host, calls } = buildFakeHost({ items: [] })
  await assert.rejects(
    ctx.tuiSession.resume(host, 'missing-session'),
    (error: unknown) => error instanceof TuiSessionError && error.kind === 'resume-not-found',
  )
  assert.equal(calls.create.length, 0)
})

test('prompt mints a requestId and posts the typed queue content', async (t) => {
  const ctx = installed(t)
  const snapshot = await followSnapshot(0, [])
  const { host, calls } = buildFakeHost({ historyRecords: [], followFrames: [snapshot] })
  await ctx.tuiSession.createCurrentCwd(host)
  const result = await ctx.tuiSession.prompt('hello')
  assert.equal(result.ok, true)
  const payload = calls.prompt[0] as { sessionId: string; mode: string; content: readonly { readonly type: string; readonly text: string }[] }
  assert.equal(payload.sessionId, 'new-session')
  assert.equal(payload.mode, 'queue')
  assert.deepEqual(payload.content, [{ type: 'text', text: 'hello' }])
})

test('promptImage sends encoded image bytes with the canonical media type', async (t) => {
  const ctx = installed(t)
  const snapshot = await followSnapshot(0, [])
  const { host, calls } = buildFakeHost({ historyRecords: [], followFrames: [snapshot] })
  const root = await mkdtemp(join(tmpdir(), 'dsh-tui-image-'))
  const path = join(root, 'sample.PNG')
  await writeFile(path, Buffer.from([0, 1, 2, 255]))
  await ctx.tuiSession.createCurrentCwd(host)
  const result = await ctx.tuiSession.promptImage(path, 'inspect this')
  assert.equal(result.ok, true)
  const payload = calls.prompt[0] as { content: readonly { readonly type: string; readonly text?: string; readonly mediaType?: string; readonly data?: string; readonly name?: string }[] }
  assert.equal(payload.content[0]?.type, 'text')
  assert.equal(payload.content[1]?.type, 'image')
  assert.equal(payload.content[1]?.mediaType, 'image/png')
  assert.equal(payload.content[1]?.data, 'AAEC/w==')
  assert.equal(payload.content[1]?.name, 'sample.PNG')
})

test('promptImage rejects unsupported media before calling the Host', async (t) => {
  const ctx = installed(t)
  const snapshot = await followSnapshot(0, [])
  const { host, calls } = buildFakeHost({ historyRecords: [], followFrames: [snapshot] })
  const root = await mkdtemp(join(tmpdir(), 'dsh-tui-image-'))
  const path = join(root, 'sample.txt')
  await writeFile(path, 'not an image')
  await ctx.tuiSession.createCurrentCwd(host)
  await assert.rejects(ctx.tuiSession.promptImage(path), /supports png, /)
  assert.equal(calls.prompt.length, 0)
})

test('fork creates and selects the Host-provided child Session', async (t) => {
  const ctx = installed(t)
  const snapshot = await followSnapshot(0, [recordOf(0)])
  const { host, calls } = buildFakeHost({ historyRecords: [recordOf(0)], followFrames: [snapshot], createdSessionId: 'source-session' })
  await ctx.tuiSession.createCurrentCwd(host)
  const forked = await ctx.tuiSession.fork(0)
  assert.equal(forked.sessionId, asSessionId('forked-session'))
  assert.deepEqual(calls.fork[0], { sessionId: 'source-session', atSeq: 0 })
})

test('fork rejects an invalid anchor before calling the Host', async (t) => {
  const ctx = installed(t)
  const snapshot = await followSnapshot(0, [])
  const { host, calls } = buildFakeHost({ historyRecords: [], followFrames: [snapshot] })
  await ctx.tuiSession.createCurrentCwd(host)
  await assert.rejects(ctx.tuiSession.fork(-1), /atSeq must be a non-negative safe integer/)
  assert.equal(calls.fork.length, 0)
})



test('live follow frames append by seq and ignore duplicates', async (t) => {
  const ctx = installed(t)
  const snapshot = await followSnapshot(1, [recordOf(0), recordOf(1)])
  const live = (seq: number): SessionFollowFrame => ({ type: 'event', event: event('assistant/chunk', seq) })
  const { host } = buildFakeHost({
    historyRecords: [recordOf(0), recordOf(1)],
    followFrames: [snapshot, live(2), live(1), live(3)],
  })
  await ctx.tuiSession.createCurrentCwd(host)
  await waitFor(() => ctx.tuiSession.snapshot?.entries.length === 4)
  assert.equal(ctx.tuiSession.snapshot?.entries[3]?.event.seq, 3)
})

test('live sequence gaps are explicit errors, never silent fallback', async (t) => {
  const ctx = installed(t)
  const snapshot = await followSnapshot(1, [recordOf(0), recordOf(1)])
  const { host } = buildFakeHost({
    historyRecords: [recordOf(0), recordOf(1)],
    followFrames: [snapshot, { type: 'event', event: event('assistant/chunk', 3) }],
  })
  await ctx.tuiSession.createCurrentCwd(host)
  await waitFor(() => ctx.tuiSession.snapshot?.live === false && ctx.tuiSession.snapshot?.error !== undefined)
  assert.match(ctx.tuiSession.snapshot?.error ?? '', /live sequence gap/)
  assert.equal(ctx.tuiSession.snapshot?.entries.length, 2)
  assert.equal(ctx.tuiSession.snapshot?.live, false)
})

test('control queue and jobs frames update and freeze the selected Session queue and jobs', async (t) => {
  const ctx = installed(t)
  const snapshot = await followSnapshot(0, [])
  const queueItem = { id: 'queue-1' as never, placement: 'queued', message: { id: 'm' as never, content: [{ type: 'text', text: 'hi' }] } }
  const jobItem = { id: 'job-1' as never, kind: 'bash', label: 'printf OK', startedAt: 1, status: 'running' }
  const queueFrame = { type: 'queue', sessionId: asSessionId('new-session'), items: [queueItem] } as unknown as { type: 'queue'; sessionId: SessionId; items: readonly unknown[] }
  const jobsFrame = { type: 'jobs', sessionId: asSessionId('new-session'), jobs: [jobItem] } as unknown as { type: 'jobs'; sessionId: SessionId; jobs: readonly unknown[] }
  const { host } = buildFakeHost({
    historyRecords: [],
    followFrames: [snapshot],
    controlFrames: [queueFrame, jobsFrame] as unknown as SessionControlFrame[],
  })
  await ctx.tuiSession.createCurrentCwd(host)
  await waitFor(() => (ctx.tuiSession.snapshot?.queue.length ?? 0) > 0)
  await waitFor(() => (ctx.tuiSession.snapshot?.jobs.length ?? 0) > 0)
  assert.deepEqual(ctx.tuiSession.snapshot?.queue[0], queueItem)
  assert.deepEqual(ctx.tuiSession.snapshot?.jobs[0], jobItem)
})

test('control queue frames from another Session are ignored', async (t) => {
  const ctx = installed(t)
  const snapshot = await followSnapshot(0, [])
  const { host } = buildFakeHost({
    historyRecords: [],
    followFrames: [snapshot],
    controlFrames: [{ type: 'queue', sessionId: asSessionId('other-session'), items: [{ id: 'queue-1' as never, placement: 'queued', message: { id: 'm' as never, content: [{ type: 'text', text: 'stale' }] } }] } as SessionControlFrame],
    firstReady: { clientId: 'c-1' },
  })
  await ctx.tuiSession.createCurrentCwd(host)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(ctx.tuiSession.snapshot?.queue, [])
})

test('approval waterfall resolves via the typed events.respond path', async (t) => {
  const ctx = installed(t)
  const snapshot = await followSnapshot(0, [])
  const { host, calls } = buildFakeHost({
    historyRecords: [],
    followFrames: [snapshot],
    firstReady: { clientId: 'c-1' },
    eventsFrames: [
 { type: 'waterfall', event: 'approval/request', eventId: 'approval-1', agentId: 'agent-1', request: { approvalId: 'approval-1', toolName: 'bash' } },
 ],
  })
  await ctx.tuiSession.createCurrentCwd(host)
  await waitFor(() => (ctx.tuiSession.snapshot?.interactions.length ?? 0) > 0)
  const interaction = ctx.tuiSession.snapshot?.interactions[0]
  if (interaction?.kind !== 'approval') throw new Error('expected approval interaction')
  const receipt = await ctx.tuiSession.respondApproval(interaction.interactionId, true)
  assert.deepEqual(receipt, { accepted: true })
  assert.equal(calls.approveResponses.length, 1)
  assert.equal(calls.approveResponses[0]?.clientId, 'c-1')
  assert.equal(calls.approveResponses[0]?.eventId, 'approval-1')
  assert.equal(calls.approveResponses[0]?.outcome.kind, 'result')
})
