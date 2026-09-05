import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply as applySession } from '../../src/experiments/session/src/session.ts'
import type { TuiSessionHost } from '../../src/experiments/session/src/session.ts'
import type { SessionFollowFrame, SessionSummary } from '../../src/experiments/transport/src/transport.ts'

function hostFor(items: readonly SessionSummary[]): TuiSessionHost {
  return {
    origin: 'http://127.0.0.1:4096',
    remote: { session: { list: async () => ({ ok: true, value: { items } }) } },
  } as unknown as TuiSessionHost
}

function summary(sessionId: string, blank: boolean, updatedAt: number): SessionSummary {
  return {
    sessionId,
    cwd: process.cwd(),
    running: false,
    updatedAt,
    blank,
    origin: 'root',
  }
}

function promptHost(options: {
  readonly failText?: string
  readonly holdText?: string
  readonly onCancel?: (signal: AbortSignal) => void
} = {}): {
  readonly host: TuiSessionHost
  readonly prompts: string[]
  readonly promptSignals: AbortSignal[]
  readonly push: (frame: SessionFollowFrame) => void
  readonly releasePrompt: () => void
} {
  const prompts: string[] = []
  const promptSignals: AbortSignal[] = []
  const frames: SessionFollowFrame[] = []
  const waiters: Array<(frame: SessionFollowFrame | undefined) => void> = []
  let releaseHeldPrompt: (() => void) | null = null
  let followCalls = 0
  const initial: SessionFollowFrame = {
    type: 'snapshot',
    header: { sessionId: 'session-1' },
    cursor: -1,
    hasMore: false,
    records: [],
    projections: {},
  } as never
  const nextFrame = (signal: AbortSignal): Promise<SessionFollowFrame | undefined> => {
    if (signal.aborted) return Promise.resolve(undefined)
    const frame = frames.shift()
    if (frame !== undefined) return Promise.resolve(frame)
    return new Promise(resolve => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort)
        resolve(undefined)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      waiters.push(frameValue => {
        signal.removeEventListener('abort', onAbort)
        resolve(frameValue)
      })
    })
  }
  const host: TuiSessionHost = {
    origin: 'http://127.0.0.1:4096',
    remote: {
      session: {
        create: async () => ({ ok: true, value: { sessionId: 'session-1' } }),
        follow: async function* (_request: unknown, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
          followCalls += 1
          yield initial
          if (followCalls === 1) return
          while (!signal.aborted) {
            const frame = await nextFrame(signal)
            if (frame === undefined) return
            yield frame
          }
        },
        control: async function* (signal: AbortSignal): AsyncIterable<never> {
          await new Promise<void>(resolve => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', () => resolve(), { once: true })
          })
        },
        prompt: async (request: any, signal: AbortSignal) => {
          const text = request.content[0].text as string
          prompts.push(text)
          promptSignals.push(signal)
          if (text === options.failText) {
            return { ok: false, error: { code: 'prompt-failed', message: 'prompt failed' } }
          }
          if (text === options.holdText) {
            return await new Promise(resolve => {
              const onAbort = () => {
                signal.removeEventListener('abort', onAbort)
                resolve({ ok: false as const, error: { code: 'aborted', message: 'prompt aborted' } })
              }
              signal.addEventListener('abort', onAbort, { once: true })
              releaseHeldPrompt = () => {
                signal.removeEventListener('abort', onAbort)
                resolve({ ok: true as const, value: { accepted: true as const } })
              }
            })
          }
          return { ok: true, value: { accepted: true } }
        },
        cancel: async () => {
          const signal = promptSignals.at(-1)
          if (signal !== undefined) options.onCancel?.(signal)
          return { ok: true, value: { accepted: true } }
        },
      },
      events: {
        follow: async function* (signal: AbortSignal): AsyncIterable<never> {
          await new Promise<void>(resolve => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', () => resolve(), { once: true })
          })
        },
      },
    },
    exportSessionLog: async () => new Uint8Array(),
  } as unknown as TuiSessionHost
  return {
    host,
    prompts,
    promptSignals,
    push(frame) {
      const waiter = waiters.shift()
      if (waiter) waiter(frame)
      else frames.push(frame)
    },
    releasePrompt() {
      releaseHeldPrompt?.()
      releaseHeldPrompt = null
    },
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  assert.equal(predicate(), true)
}

function turnStart(seq: number): SessionFollowFrame {
  return { type: 'event', event: { type: 'turn/start', seq, time: seq, data: { turn: 1, status: 'running' } } } as never
}

function turnEnd(seq: number, reason: 'completed' | 'error' = 'completed'): SessionFollowFrame {
  return { type: 'event', event: { type: 'turn/end', seq, time: seq, data: { turn: 1, reason: { kind: reason } } } } as never
}

test('latest current-cwd session trusts the adaptor non-blank contract', async () => {
  const ctx = new Context()
  applySession(ctx)
  const latest = await ctx.tuiSession.latestCurrentCwdSession(hostFor([
    summary('empty', true, 20),
    summary('content', false, 10),
  ]), process.cwd())
  assert.equal(latest?.sessionId, 'content')
  ctx.tuiSession.dispose()
})

test('latest current-cwd session does not select an empty session', async () => {
  const ctx = new Context()
  applySession(ctx)
  const latest = await ctx.tuiSession.latestCurrentCwdSession(hostFor([
    summary('empty', true, 20),
  ]), process.cwd())
  assert.equal(latest, null)
  ctx.tuiSession.dispose()
})

test('running prompt submissions are FIFO and only the completed turn drains the next item', async () => {
  const ctx = new Context()
  applySession(ctx)
  const fixture = promptHost()
  await ctx.tuiSession.createCurrentCwd(fixture.host, process.cwd())

  assert.equal((await ctx.tuiSession.prompt('first')).ok, true)
  assert.equal((await ctx.tuiSession.prompt('second')).ok, true)
  assert.deepEqual(fixture.prompts, ['first'])
  assert.equal(fixture.promptSignals[0]?.aborted, false)
  assert.equal(ctx.tuiSession.snapshot?.queue.length, 1)

  fixture.push(turnStart(0))
  fixture.push(turnEnd(1))
  await waitFor(() => fixture.prompts.length === 2)
  assert.deepEqual(fixture.prompts, ['first', 'second'])
  assert.equal(ctx.tuiSession.snapshot?.queue.length, 0)

  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.prompts, ['first', 'second'])
  ctx.tuiSession.dispose()
})

test('cancel reaches the Host before aborting the active prompt transport', async () => {
  const ctx = new Context()
  applySession(ctx)
  const cancelObserved: boolean[] = []
  const fixture = promptHost({ holdText: 'first', onCancel: signal => cancelObserved.push(signal.aborted) })
  await ctx.tuiSession.createCurrentCwd(fixture.host, process.cwd())

  const prompt = ctx.tuiSession.prompt('first')
  await waitFor(() => fixture.prompts.length === 1)
  const cancel = ctx.tuiSession.cancel()
  await new Promise<void>(resolve => setImmediate(resolve))

  assert.deepEqual(cancelObserved, [])
  fixture.releasePrompt()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(cancelObserved, [])
  fixture.push(turnStart(0))
  const cancelled = await cancel

  assert.equal(cancelled.ok, true)
  assert.deepEqual(cancelObserved, [false])
  assert.equal(fixture.promptSignals[0]?.aborted, false)
  assert.equal((await prompt).ok, true)
  fixture.releasePrompt()
  ctx.tuiSession.dispose()
})

test('a duplicate terminal event cannot drain a second queued prompt concurrently', async () => {
  const ctx = new Context()
  applySession(ctx)
  const fixture = promptHost()
  await ctx.tuiSession.createCurrentCwd(fixture.host, process.cwd())

  await ctx.tuiSession.prompt('first')
  await ctx.tuiSession.prompt('second')
  await ctx.tuiSession.prompt('third')
  fixture.push(turnStart(0))
  fixture.push(turnEnd(1))
  await waitFor(() => fixture.prompts.length === 2)
  fixture.push(turnEnd(1))
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.prompts, ['first', 'second'])

  fixture.push(turnStart(2))
  fixture.push(turnEnd(3))
  await waitFor(() => fixture.prompts.length === 3)
  assert.deepEqual(fixture.prompts, ['first', 'second', 'third'])
  ctx.tuiSession.dispose()
})

test('a failed turn does not silently execute the pending queue', async () => {
  const ctx = new Context()
  applySession(ctx)
  const fixture = promptHost()
  await ctx.tuiSession.createCurrentCwd(fixture.host, process.cwd())

  await ctx.tuiSession.prompt('first')
  await ctx.tuiSession.prompt('second')
  fixture.push(turnStart(0))
  fixture.push(turnEnd(1, 'error'))
  await new Promise<void>(resolve => setImmediate(resolve))

  assert.deepEqual(fixture.prompts, ['first'])
  assert.equal(ctx.tuiSession.snapshot?.queue.length, 1)
  assert.match(ctx.tuiSession.snapshot?.error ?? '', /turn ended/i)
  ctx.tuiSession.dispose()
})

test('a prompt transport failure keeps the failed queue item visible and does not retry', async () => {
  const ctx = new Context()
  applySession(ctx)
  const fixture = promptHost({ failText: 'second' })
  await ctx.tuiSession.createCurrentCwd(fixture.host, process.cwd())

  await ctx.tuiSession.prompt('first')
  await ctx.tuiSession.prompt('second')
  fixture.push(turnStart(0))
  fixture.push(turnEnd(1))
  await waitFor(() => fixture.prompts.length === 2)
  await new Promise<void>(resolve => setImmediate(resolve))

  assert.deepEqual(fixture.prompts, ['first', 'second'])
  assert.equal(ctx.tuiSession.snapshot?.queue.length, 1)
  assert.match(ctx.tuiSession.snapshot?.error ?? '', /prompt failed/i)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.prompts, ['first', 'second'])
  ctx.tuiSession.dispose()
})
