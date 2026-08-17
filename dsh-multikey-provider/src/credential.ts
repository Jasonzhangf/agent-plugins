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
    throw new LlmError(`llm-pi-ai-multikey: credential reference "${ref}" is not configured`, 'MISSING_CREDENTIAL')
  }
  return assertUsableApiKey(hit, 'llm-pi-ai-multikey', ref)
}
