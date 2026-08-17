import assert from 'node:assert/strict'
import { test } from 'node:test'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ApiKeyPool } from '../src/config.js'
import { compileKeyPool, KeyPoolRuntime } from '../src/key-pool.js'

function descriptor(input: ApiKeyPool) {
  const value = compileKeyPool('test', credentialRef('PRIMARY_KEY'), input)
  assert.ok(value)
  return value
}

test('priority mode selects the lowest eligible priority and reserves it', () => {
  const runtime = new KeyPoolRuntime(descriptor({
    primary: { priority: 5 },
    keys: [
      { id: 'second', credentialRef: 'SECOND_KEY', priority: 2 },
      { id: 'first', credentialRef: 'FIRST_KEY', priority: 0 },
    ],
  }))
  assert.equal(runtime.select()?.id, 'first')
  assert.equal(runtime.view().get('first')?.state, 'trial')
  assert.equal(runtime.select(new Set(['first']))?.id, 'second')
})

test('weighted mode maps deterministic random values to enabled keys', () => {
  const pool = descriptor({
    mode: 'weighted',
    primary: { enabled: false },
    keys: [
      { id: 'light', credentialRef: 'LIGHT_KEY', weight: 1 },
      { id: 'heavy', credentialRef: 'HEAVY_KEY', weight: 4 },
    ],
  })
  assert.equal(new KeyPoolRuntime(pool, { random: () => 0 }).select()?.id, 'light')
  assert.equal(new KeyPoolRuntime(pool, { random: () => 0.99 }).select()?.id, 'heavy')
})

test('failure threshold opens a key and circuit expiry permits a trial', () => {
  let now = 0
  const runtime = new KeyPoolRuntime(descriptor({
    primary: { enabled: false },
    keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY' }],
    health: { failureThreshold: 3, openCircuitMs: 1000 },
  }), { now: () => now })
  const key = runtime.select()
  assert.equal(key?.id, 'backup')
  runtime.recordAttemptFailure('backup', 'AUTH')
  assert.equal(runtime.view().get('backup')?.state, 'healthy')
  assert.equal(runtime.select()?.id, 'backup')
  runtime.recordAttemptFailure('backup', 'AUTH')
  assert.equal(runtime.view().get('backup')?.state, 'healthy')
  assert.equal(runtime.select()?.id, 'backup')
  runtime.recordAttemptFailure('backup', 'AUTH')
  assert.equal(runtime.view().get('backup')?.state, 'open')
  assert.equal(runtime.select(), undefined)
  now = 1001
  assert.equal(runtime.select()?.id, 'backup')
})

test('recoverable failures are session-local while auth failures are global', () => {
  const runtime = new KeyPoolRuntime(descriptor({
    keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY' }],
    health: { failureThreshold: 2, openCircuitMs: 1000 },
  }))
  assert.equal(runtime.select(new Set(), 'session-a')?.id, 'primary')
  runtime.recordAttemptFailure('primary', 'RATE_LIMIT', 'session-a')
  assert.equal(runtime.select(new Set(), 'session-a')?.id, 'primary')
  runtime.recordAttemptFailure('primary', 'RATE_LIMIT', 'session-a')
  assert.equal(runtime.select(new Set(), 'session-a')?.id, 'backup')
  assert.equal(runtime.select(new Set(), 'session-b')?.id, 'primary')

  runtime.recordAttemptFailure('backup', 'AUTH')
  runtime.recordAttemptFailure('backup', 'AUTH')
  assert.equal(runtime.select(new Set(['primary']), 'session-a'), undefined)
  assert.equal(runtime.select(new Set(['primary']), 'session-b'), undefined)
})

test('session-scoped failure without a session releases the global reservation', () => {
  const runtime = new KeyPoolRuntime(descriptor({
    keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY' }],
  }))
  assert.equal(runtime.select()?.id, 'primary')
  runtime.recordAttemptFailure('primary', 'QUOTA')
  assert.equal(runtime.select()?.id, 'primary')
})

test('release and success reset trial state without leaking descriptors', () => {
  const runtime = new KeyPoolRuntime(descriptor({ keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY' }] }))
  runtime.reserveExact('backup')
  runtime.release('backup')
  assert.equal(runtime.view().get('backup')?.state, 'healthy')
  runtime.reserveExact('backup')
  runtime.recordSuccess('backup')
  assert.deepEqual(runtime.view().get('backup'), { state: 'healthy', consecutiveFailures: 0 })
  assert.equal(JSON.stringify(runtime.view()).includes('BACKUP_KEY'), false)
})

test('a replacement runtime preserves health only for unchanged id and reference', () => {
  const first = new KeyPoolRuntime(descriptor({
    keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY' }],
    health: { failureThreshold: 1 },
  }))
  first.recordAttemptFailure('backup', 'AUTH')
  const same = new KeyPoolRuntime(descriptor({
    keys: [{ id: 'backup', credentialRef: 'BACKUP_KEY' }],
    health: { failureThreshold: 1 },
  }), { previous: first })
  assert.equal(same.view().get('backup')?.state, 'open')
  const changed = new KeyPoolRuntime(descriptor({ keys: [{ id: 'backup', credentialRef: 'NEW_KEY' }] }), { previous: first })
  assert.equal(changed.view().get('backup')?.state, 'healthy')
})
