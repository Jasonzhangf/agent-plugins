import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply, resumeSessionLabel, tuiSessionSwitcherName } from '../../src/experiments/session-switcher-plugin/src/session-switcher-plugin.ts'
import type { TuiSessionListResult, TuiSessionSummary } from '../../contracts/tui/session-switcher-plugin/session-switcher-plugin.types.ts'

function summary(overrides: Partial<TuiSessionSummary> = {}): TuiSessionSummary {
  return Object.freeze({
    sessionId: 'sess-1',
    cwd: '/work',
    running: false,
    updatedAt: Date.UTC(2026, 7, 30, 10, 15),
    title: null,
    lifecycle: 'idle',
    ...overrides,
  })
}

test('resume labels expose user-readable recency and state without Session IDs', () => {
  const current = resumeSessionLabel(summary({ sessionId: 'session-internal-id' }), true)
  const recent = resumeSessionLabel(summary({
    sessionId: 'session-second-internal-id',
    title: 'Fix terminal history',
    running: true,
    lifecycle: 'running',
  }), false)
  assert.equal(current, 'Current · Updated 2026-08-30 10:15 UTC')
  assert.equal(recent, 'Recent · Fix terminal history · running')
  assert.doesNotMatch(`${current}\n${recent}`, /session-(?:internal|second)/u)
})

function setup(fetcher: { listForCurrentCwd(requestRevision: number): Promise<TuiSessionListResult> }) {
  const ctx = new Context()
  apply(ctx, { fetcher, currentCwd: '/work' })
  return ctx
}

async function flush() {
  await new Promise<void>(resolve => setImmediate(resolve))
  await new Promise<void>(resolve => setImmediate(resolve))
}

test('apply installs one Cordis effect-owned selector', () => {
  const fetcher = { listForCurrentCwd: async () => ({ summaries: [], filteredCount: 0, requestRevision: 1 }) }
  const ctx = setup(fetcher)
  assert.equal(ctx.tuiSessionSwitcher?.name, tuiSessionSwitcherName)
  assert.ok(ctx.fiber.getEffects().some(effect => effect.label === 'session-switcher-plugin.dispose'))
  ctx.tuiSessionSwitcher!.dispose()
})

test('startListing resolves summaries filtered by current cwd and active lifecycle', async () => {
  const summaries: TuiSessionSummary[] = [
    summary({ sessionId: 'a' }),
    summary({ sessionId: 'b', cwd: '/other' }),
    summary({ sessionId: 'c', lifecycle: 'terminated' }),
    summary({ sessionId: 'd', running: true }),
  ]
  const fetcher = { listForCurrentCwd: async (requestRevision: number) => ({ summaries, filteredCount: 0, requestRevision }) }
  const ctx = setup(fetcher)
  ctx.tuiSessionSwitcher!.startListing(1)
  await flush()
  const state = ctx.tuiSessionSwitcher!.projectState()
  assert.equal(state.kind, 'idle')
  assert.equal(state.filteredCount, 2)
  assert.deepEqual(state.list.map(s => s.sessionId), ['a', 'd'])
  ctx.tuiSessionSwitcher!.dispose()
})

test('startListing failure preserves old selection and reports the error message', async () => {
  const fetcher = {
    listForCurrentCwd: async () => {
      throw new Error('host-unreachable')
    },
  }
  const ctx = setup(fetcher)
  ctx.tuiSessionSwitcher!.startListing(1)
  await flush()
  const state = ctx.tuiSessionSwitcher!.projectState()
  assert.equal(state.kind, 'failed')
  assert.equal(state.errorMessage, 'host-unreachable')
  assert.equal(state.selectedSessionId, null)
  ctx.tuiSessionSwitcher!.dispose()
})

test('select rejects empty list and throws on invalid summary', async () => {
  const fetcher = { listForCurrentCwd: async (requestRevision: number) => ({ summaries: [], filteredCount: 0, requestRevision }) }
  const ctx = setup(fetcher)
  ctx.tuiSessionSwitcher!.startListing(1)
  await flush()
  const intent = ctx.tuiSessionSwitcher!.select(summary(), 1)
  assert.equal(intent.kind, 'rejected')
  assert.equal(intent.code, 'empty-list')
  assert.throws(() => ctx.tuiSessionSwitcher!.select({ sessionId: 'x', cwd: 'a', running: true, title: null, lifecycle: 'bogus' } as unknown as TuiSessionSummary, 1), /summary/i)
  ctx.tuiSessionSwitcher!.dispose()
})

test('select emits one selection intent and reports the chosen Session id', async () => {
  const summaries = [summary({ sessionId: 's-a' }), summary({ sessionId: 's-b', cwd: '/work', running: true })]
  const fetcher = { listForCurrentCwd: async (requestRevision: number) => ({ summaries, filteredCount: 0, requestRevision }) }
  const ctx = setup(fetcher)
  ctx.tuiSessionSwitcher!.startListing(1)
  await flush()
  const intent = ctx.tuiSessionSwitcher!.select(summary({ sessionId: 's-b' }), 1)
  assert.equal(intent.kind, 'select')
  assert.equal(intent.sessionId, 's-b')
  const state = ctx.tuiSessionSwitcher!.projectState()
  assert.equal(state.kind, 'succeeded')
  assert.equal(state.selectedSessionId, 's-b')
  ctx.tuiSessionSwitcher!.dispose()
})

test('select rejects mismatched cwd summaries', async () => {
  const summaries = [summary({ sessionId: 's-a', cwd: '/other' })]
  const fetcher = { listForCurrentCwd: async (requestRevision: number) => ({ summaries, filteredCount: 0, requestRevision }) }
  const ctx = setup(fetcher)
  ctx.tuiSessionSwitcher!.startListing(1)
  await flush()
  const state = ctx.tuiSessionSwitcher!.projectState()
  assert.equal(state.list.length, 0)
  ctx.tuiSessionSwitcher!.dispose()
})

test('stale async resolution is dropped and last-issued revision wins', async () => {
  let firstResolver: (value: TuiSessionListResult) => void = () => undefined
  const first = new Promise<TuiSessionListResult>(resolve => { firstResolver = resolve })
  let calls = 0
  const fetcher = { listForCurrentCwd: async (requestRevision: number) => { calls += 1; if (calls === 1) return first; return { summaries: [summary({ sessionId: 'new' })], filteredCount: 0, requestRevision } } }
  const ctx = setup(fetcher)
  ctx.tuiSessionSwitcher!.startListing(1)
  ctx.tuiSessionSwitcher!.startListing(2)
  await flush()
  firstResolver({ summaries: [summary({ sessionId: 'old' })], filteredCount: 0, requestRevision: 1 })
  await flush()
  const state = ctx.tuiSessionSwitcher!.projectState()
  assert.equal(state.requestRevision, 2)
  assert.deepEqual(state.list.map(s => s.sessionId), ['new'])
  ctx.tuiSessionSwitcher!.dispose()
})

test('disposed service rejects select and subscribe', async () => {
  const fetcher = { listForCurrentCwd: async (requestRevision: number) => ({ summaries: [], filteredCount: 0, requestRevision }) }
  const ctx = setup(fetcher)
  ctx.tuiSessionSwitcher!.dispose()
  const intent = ctx.tuiSessionSwitcher!.select(summary(), 1)
  assert.equal(intent.kind, 'rejected')
  assert.equal(intent.code, 'disposed')
  assert.throws(() => ctx.tuiSessionSwitcher!.subscribe(() => undefined), /disposed/)
})
