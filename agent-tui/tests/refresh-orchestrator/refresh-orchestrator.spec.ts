import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../../src/experiments/refresh-orchestrator/src/refresh-orchestrator.ts'
import { tuiRefreshOrchestratorName } from '../../src/experiments/refresh-orchestrator/src/refresh-orchestrator.ts'
import type { TuiRefreshIntent, TuiRefreshPublication } from '../../contracts/tui/refresh-orchestrator/refresh-orchestrator.types.ts'

function intent(sourceModuleId: TuiRefreshIntent['sourceModuleId'], sourceRevision = 1, reason: TuiRefreshIntent['reason'] = 'presentation'): TuiRefreshIntent {
  return Object.freeze({ sourceModuleId, reason, sourceRevision })
}

async function flushMicrotasks(times = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) await new Promise<void>(resolve => queueMicrotask(resolve))
}

test('apply installs one Cordis effect-owned orchestrator', async () => {
  const ctx = new Context()
  apply(ctx)
  assert.equal(ctx.tuiRefreshOrchestrator?.name, tuiRefreshOrchestratorName)
  assert.ok(ctx.fiber.getEffects().some(effect => effect.label === 'refresh-orchestrator.dispose'))
  ctx.tuiRefreshOrchestrator.dispose()
  assert.deepEqual(ctx.tuiRefreshOrchestrator.request(intent('app-shell', 1)), {
    status: 'rejected',
    reason: 'disposed',
    message: 'refresh-orchestrator: disposed',
  })
})

test('a fresh intent publishes exactly one immutable revision with its cause', async () => {
  const ctx = new Context()
  apply(ctx)
  const publications: TuiRefreshPublication[] = []
  ctx.tuiRefreshOrchestrator.subscribe(publication => publications.push(publication))
  assert.deepEqual(ctx.tuiRefreshOrchestrator.request(intent('composer-plugin', 4, 'composer')), { status: 'queued' })
  await flushMicrotasks()
  assert.equal(publications.length, 1)
  assert.equal(publications[0]!.publicationRevision, 1)
  assert.deepEqual(publications[0]!.causes, [intent('composer-plugin', 4, 'composer')])
  for (const cause of publications[0]!.causes) assert.equal(Object.isFrozen(cause), true)
  assert.equal(Object.isFrozen(publications[0]), true)
})

test('different causes in one microtask coalesce into one publication', async () => {
  const ctx = new Context()
  apply(ctx)
  const publications: TuiRefreshPublication[] = []
  ctx.tuiRefreshOrchestrator.subscribe(publication => publications.push(publication))
  assert.equal(ctx.tuiRefreshOrchestrator.request(intent('presentation', 3, 'presentation')).status, 'queued')
  assert.equal(ctx.tuiRefreshOrchestrator.request(intent('composer-plugin', 7, 'composer')).status, 'queued')
  assert.equal(ctx.tuiRefreshOrchestrator.request(intent('app-container', 2, 'viewport')).status, 'queued')
  await flushMicrotasks()
  assert.equal(publications.length, 1)
  assert.equal(publications[0]!.publicationRevision, 1)
  assert.equal(publications[0]!.causes.length, 3)
  assert.deepEqual(publications[0]!.causes.map(cause => cause.sourceModuleId), ['presentation', 'composer-plugin', 'app-container'])
})

test('the same source revision and reason is idempotent across pending and published state', async () => {
  const ctx = new Context()
  apply(ctx)
  const publications: TuiRefreshPublication[] = []
  ctx.tuiRefreshOrchestrator.subscribe(publication => publications.push(publication))
  assert.equal(ctx.tuiRefreshOrchestrator.request(intent('overlay-manager-plugin', 5, 'overlay')).status, 'queued')
  assert.equal(ctx.tuiRefreshOrchestrator.request(intent('overlay-manager-plugin', 5, 'overlay')).status, 'coalesced')
  await flushMicrotasks()
  assert.equal(ctx.tuiRefreshOrchestrator.request(intent('overlay-manager-plugin', 5, 'overlay')).status, 'coalesced')
  await flushMicrotasks()
  assert.equal(publications.length, 1)
})

test('an older source revision is stale and cannot regress publication state', async () => {
  const ctx = new Context()
  apply(ctx)
  const publications: TuiRefreshPublication[] = []
  ctx.tuiRefreshOrchestrator.subscribe(publication => publications.push(publication))
  assert.equal(ctx.tuiRefreshOrchestrator.request(intent('app-shell', 9, 'error')).status, 'queued')
  await flushMicrotasks()
  const before = publications.length
  assert.deepEqual(
    ctx.tuiRefreshOrchestrator.request(intent('app-shell', 8, 'error')),
    { status: 'rejected', reason: 'stale', message: 'refresh-orchestrator: stale sourceRevision 8 for app-shell; latest is 9' },
  )
  await flushMicrotasks()
  assert.equal(publications.length, before)
  assert.equal(ctx.tuiRefreshOrchestrator.request(intent('app-shell', 10, 'error')).status, 'queued')
  await flushMicrotasks()
  assert.equal(publications.length, before + 1)
  assert.equal(publications.at(-1)!.publicationRevision, 2)
})

test('subscriptions receive every publication in order until explicitly unsubscribed', async () => {
  const ctx = new Context()
  apply(ctx)
  const first: number[] = []
  const second: number[] = []
  const unsubscribe = ctx.tuiRefreshOrchestrator.subscribe(publication => first.push(publication.publicationRevision))
  ctx.tuiRefreshOrchestrator.subscribe(publication => second.push(publication.publicationRevision))
  ctx.tuiRefreshOrchestrator.request(intent('chrome-slot-registry', 1, 'chrome-slot'))
  await flushMicrotasks()
  unsubscribe()
  unsubscribe()
  ctx.tuiRefreshOrchestrator.request(intent('chrome-slot-registry', 2, 'chrome-slot'))
  await flushMicrotasks()
  assert.deepEqual(first, [1])
  assert.deepEqual(second, [1, 2])
})

test('malformed closed intents fail without publishing or changing revisions', async () => {
  const ctx = new Context()
  apply(ctx)
  const publications: TuiRefreshPublication[] = []
  ctx.tuiRefreshOrchestrator.subscribe(publication => publications.push(publication))
  const cases = [
    null,
    {},
    { ...intent('app-shell', 1), metadata: {} },
    { ...intent('app-shell', 1), sourceModuleId: 'unknown' },
    { ...intent('app-shell', 1), reason: 'unknown' },
    { ...intent('app-shell', 1), sourceRevision: -1 },
    { ...intent('app-shell', 1), sourceRevision: 1.5 },
  ] as Array<unknown>
  for (const value of cases) {
    assert.throws(() => ctx.tuiRefreshOrchestrator.request(value as TuiRefreshIntent), /refresh-orchestrator:/)
  }
  await flushMicrotasks()
  assert.equal(publications.length, 0)
})

test('dispose clears pending work and rejects later requests and subscriptions', async () => {
  const ctx = new Context()
  apply(ctx)
  const publications: TuiRefreshPublication[] = []
  ctx.tuiRefreshOrchestrator.subscribe(publication => publications.push(publication))
  ctx.tuiRefreshOrchestrator.request(intent('session-switcher-plugin', 1, 'overlay'))
  ctx.tuiRefreshOrchestrator.dispose()
  ctx.tuiRefreshOrchestrator.dispose()
  assert.deepEqual(
    ctx.tuiRefreshOrchestrator.request(intent('session-switcher-plugin', 2, 'overlay')),
    { status: 'rejected', reason: 'disposed', message: 'refresh-orchestrator: disposed' },
  )
  assert.throws(() => ctx.tuiRefreshOrchestrator.subscribe(() => undefined), /disposed/)
  await flushMicrotasks()
  assert.equal(publications.length, 0)
})

test('publications carry only refresh control facts and no business payload fields', async () => {
  const ctx = new Context()
  apply(ctx)
  let publication: TuiRefreshPublication | undefined
  ctx.tuiRefreshOrchestrator.subscribe(value => { publication = value })
  ctx.tuiRefreshOrchestrator.request({ sourceModuleId: 'status-footer-plugin', reason: 'logic-control', sourceRevision: 12 })
  await flushMicrotasks()
  assert.deepEqual(Object.keys(publication!), ['publicationRevision', 'causes'])
  assert.deepEqual(Object.keys(publication!.causes[0]!), ['sourceModuleId', 'reason', 'sourceRevision'])
  assert.equal('metadata' in publication!, false)
  assert.equal('payload' in publication!, false)
  assert.equal('transportFrame' in publication!, false)
})
