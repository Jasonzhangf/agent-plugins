import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleControlRequest, MultiKeyControl } from '../src/control.js'
import type { OfficialDerivedPiAiAdapter } from '../src/adapter.js'

test('control exposes redacted health and probe projections only', async () => {
  const adapter = {
    getPools: () => new Map([['test', { view: () => new Map([['backup', { state: 'healthy', consecutiveFailures: 0 }]]) }]]),
    probeKey: async () => ({ route: 'test', keyId: 'backup', status: 'ok', latencyMs: 2 }),
  } as unknown as OfficialDerivedPiAiAdapter
  const control = new MultiKeyControl(() => adapter)
  const serialized = JSON.stringify({ view: await control.view(), probe: await control.probe('test', 'backup') })
  assert.match(serialized, /healthy/u)
  for (const marker of ['credentialRef', 'apiKey', 'secret']) assert.equal(serialized.includes(marker), false)
})

test('control rejects unknown endpoints and malformed probe payloads', async () => {
  const control = new MultiKeyControl(() => undefined)
  assert.deepEqual(await handleControlRequest(control, 'unknown', {}), {
    ok: false,
    error: { code: 'bad-request', message: 'unknown multikey control endpoint', details: { issues: [] } },
  })
  const malformed = await handleControlRequest(control, 'probe', { route: 'test' })
  assert.equal(malformed.ok, false)
  if (!malformed.ok) {
    assert.equal(malformed.error.code, 'bad-request')
    assert.match(malformed.error.message, /keyId/u)
  }
})
