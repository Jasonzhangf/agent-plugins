import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import {
  CREDENTIAL_REF_PATTERN,
  persistPool,
  storeAlternateCredential,
  validatePoolDraft,
  KEY_ID_PATTERN,
  type ApiKeyPoolDraft,
} from './pool-control.ts'

export interface AlternateKeyAddDraft {
  id: string
  credentialRef: string
  credentialValue: string
  priority: number
  weight: number
}

export interface AlternateKeyAddPlan {
  pool: ApiKeyPoolDraft
  id: string
  credentialRef: string
  credentialValue: string
}

export class DuplicateAlternateKeyError extends Error {
  readonly duplicate = true
  constructor(readonly field: 'id' | 'credentialRef', readonly value: string) {
    super(`duplicate ${field} "${value}"`)
  }
}

export class AlternateKeyInputError extends Error {
  readonly input = true
  constructor(readonly field: 'id' | 'credentialRef' | 'value' | 'primary', message: string) {
    super(message)
  }
}

/**
 * Validate and project a pending alternate-key add into a final draft plus
 * the credential payload to write after settings success. Pure: no I/O, no
 * mutation of the input. Mirrors the local checks in the editor so the same
 * invariants can be tested without React.
 */
export function planAddAlternateKey(
  pool: ApiKeyPoolDraft,
  draft: AlternateKeyAddDraft,
  primaryCredentialRef: string | undefined,
): AlternateKeyAddPlan {
  const id = draft.id.trim()
  const ref = draft.credentialRef.trim()
  if (!KEY_ID_PATTERN.test(id) || id === 'primary') {
    throw new AlternateKeyInputError('id', `invalid alternate key id "${id}"`)
  }
  if (!CREDENTIAL_REF_PATTERN.test(ref)) {
    throw new AlternateKeyInputError('credentialRef', `invalid credential reference "${ref}"`)
  }
  if (draft.credentialValue.trim().length === 0) {
    throw new AlternateKeyInputError('value', 'credential value is required')
  }
  if (pool.keys.some(key => key.id === id)) {
    throw new DuplicateAlternateKeyError('id', id)
  }
  if (pool.keys.some(key => key.credentialRef === ref)) {
    throw new DuplicateAlternateKeyError('credentialRef', ref)
  }
  if (primaryCredentialRef !== undefined && ref === primaryCredentialRef) {
    throw new DuplicateAlternateKeyError('credentialRef', ref)
  }
  const next: ApiKeyPoolDraft = {
    ...pool,
    keys: [...pool.keys, {
      id,
      credentialRef: ref,
      enabled: true,
      priority: draft.priority,
      weight: draft.weight,
    }],
  }
  next.maxAttempts = Math.min(Math.max(1, next.maxAttempts), next.keys.length + 1)
  validatePoolDraft(next, primaryCredentialRef)
  return { pool: next, id, credentialRef: ref, credentialValue: draft.credentialValue.trim() }
}

export class AlternateKeyCredentialPendingError extends Error {
  readonly pending = true
  constructor(
    readonly keyId: string,
    readonly credentialRef: string,
    readonly credentialValue: string,
    readonly updated: SettingsNamespaceView,
    readonly cause: Error,
  ) {
    super(`credential for "${keyId}" not stored: ${cause.message}`)
  }
}

/**
 * Two-step commit for an alternate key. Mirrors the single-key
 * ProviderEditor pattern: settings.mutate first, then credentials.set on
 * success. A settings failure throws and writes no credential. A credential
 * failure throws `AlternateKeyCredentialPendingError` so the caller can
 * retry only the credential write without re-running the settings mutation.
 */
export async function commitAlternateKey(
  api: Pick<IApiClient, 'settings' | 'credentials'>,
  namespace: SettingsNamespaceView,
  settingsPath: readonly string[],
  plan: AlternateKeyAddPlan,
  schema: SettingsSchemaOperations,
): Promise<SettingsNamespaceView> {
  const updated = await persistPool(api, namespace, settingsPath, plan.pool, schema)
  try {
    await storeAlternateCredential(api, plan.credentialRef, plan.credentialValue)
  } catch (error) {
    throw new AlternateKeyCredentialPendingError(
      plan.id, plan.credentialRef, plan.credentialValue, updated,
      error instanceof Error ? error : new Error(String(error)),
    )
  }
  return updated
}

/**
 * Retry the credential half of a pending alternate-key add. Returns the
 * credential reference on success so the caller can clear pending state.
 */
export async function retryAlternateKeyCredential(
  api: Pick<IApiClient, 'credentials'>,
  pending: { keyId: string, credentialRef: string, credentialValue: string },
): Promise<void> {
  await storeAlternateCredential(api, pending.credentialRef, pending.credentialValue)
}
