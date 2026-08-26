import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { resolveAttemptCredential } from '../src/credential.js'

function context(services: Record<string, unknown>): Context {
  return { get: (key: string) => services[key] } as unknown as Context
}

test('one selected reference resolves through the credential service', async () => {
  const ctx = context({ credentials: { resolve: async () => ({ value: 'secret-value' }) } })
  assert.equal(await resolveAttemptCredential(ctx, 'SERVICE_KEY'), 'secret-value')
})

test('launch environment is the explicit credential owner when service is absent', async () => {
  const launchEnvironment = createLaunchEnvironmentSnapshot([
    { source: 'process', values: { ENV_KEY: 'env-secret' } },
  ])
  assert.equal(await resolveAttemptCredential(context({ launchEnvironment }), 'ENV_KEY'), 'env-secret')
})

test('missing and malformed values fail without echoing a credential value', async () => {
  await assert.rejects(
    resolveAttemptCredential(context({ credentials: { resolve: async () => undefined } }), 'MISSING_KEY'),
    error => error instanceof LlmError && error.code === 'MISSING_CREDENTIAL' && !error.message.includes('secret'),
  )
  await assert.rejects(
    resolveAttemptCredential(context({ credentials: { resolve: async () => ({ value: 'bad\nsecret' }) } }), 'BAD_KEY'),
    error => error instanceof LlmError && error.code === 'INVALID_CREDENTIAL' && !error.message.includes('bad\nsecret'),
  )
})
