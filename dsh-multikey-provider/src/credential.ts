import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'

/** Resolve exactly one named credential for one outbound attempt. */
export async function resolveAttemptCredential(ctx: Context, ref: string): Promise<string> {
  const branded = credentialRef(ref)
  const credentials = ctx.get('credentials')
  const hit = credentials === undefined
    ? launchEnvironmentOf(ctx).get(ref)?.value
    : (await credentials.resolve(branded))?.value
  if (hit === undefined || hit.length === 0) {
    throw new LlmError(`multikey-provider: credential reference "${ref}" is not configured`, 'MISSING_CREDENTIAL')
  }
  return assertUsableApiKey(hit, 'multikey-provider', ref)
}

/**
 * Typed control owner for one attempt-local credential.
 * Control/data plane boundary lives here: control resources never carry
 * any business payload shape.
 */
export type MultiKeySecretControl = {
  readonly owner: 'dsh-multikey-provider/credential'
  readonly attemptId: string
  readonly credentialRef: string
  readonly status: 'resolved' | 'missing' | 'invalid' | 'unusable'
}

export function describeMultiKeySecretControl(attemptId: string, credentialRef: string, status: MultiKeySecretControl['status']): MultiKeySecretControl {
  return { owner: 'dsh-multikey-provider/credential', attemptId, credentialRef, status }
}

export const sentinelMultiKeySecretControl: MultiKeySecretControl = describeMultiKeySecretControl('sentinel', 'sentinel', 'resolved')
