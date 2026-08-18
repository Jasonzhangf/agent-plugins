import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { getPath } from '@deepseek-ai/dsh-client-schema-form'
import { IconPlusOutline16, IconRefreshOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { persistPool, poolDraftOf, probeAlternateKey, viewPoolHealth } from './pool-control.ts'
import type { ApiKeyPoolDraft, KeyHealthView } from './pool-control.ts'
import {
  AlternateKeyCredentialPendingError,
  commitAlternateKey,
  planAddAlternateKey,
  retryAlternateKeyCredential,
  type AlternateKeyAddDraft,
} from './add-alternate-key.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

export interface AlternateKeyPoolEditorProps {
  provider: string
  namespace: SettingsNamespaceView
  settingsPath: readonly string[]
  api: Pick<IApiClient, 'settings' | 'credentials'>
  t: (key: keyof typeof en) => string
  disabled: boolean
  onNamespaceChange: (namespace: SettingsNamespaceView) => void
}

/** One newly added key whose profile reference committed before its credential. */
interface PendingKeyCredential {
  keyId: string
  credentialRef: string
  value: string
}

export function AlternateKeyPoolEditor(props: AlternateKeyPoolEditorProps): ReactNode {
  const { provider, namespace, settingsPath, api, t } = props
  const initial = useMemo(() => poolDraftOf(namespace, settingsPath), [namespace, settingsPath])
  const [activeNamespace, setActiveNamespace] = useState(namespace)
  const [pool, setPool] = useState<ApiKeyPoolDraft>(initial)
  const [keyId, setKeyId] = useState('')
  const [credentialRef, setCredentialRef] = useState('')
  const [credentialValue, setCredentialValue] = useState('')
  const [priority, setPriority] = useState('10')
  const [weight, setWeight] = useState('1')
  const [health, setHealth] = useState<Record<string, KeyHealthView>>({})
  const [pendingCredential, setPendingCredential] = useState<PendingKeyCredential | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    setActiveNamespace(namespace)
    setPool(initial)
  }, [initial, namespace])
  useEffect(() => {
    let stale = false
    void viewPoolHealth(provider).then(
      value => { if (!stale) setHealth(value) },
      error => { if (!stale) setFailure(error instanceof Error ? error.message : String(error)) },
    )
    return () => { stale = true }
  }, [provider])

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      await action()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const save = (): void => {
    void run(async () => {
      if (pendingCredential !== undefined) {
        await retryAlternateKeyCredential(api, {
          keyId: pendingCredential.keyId,
          credentialRef: pendingCredential.credentialRef,
          credentialValue: pendingCredential.value,
        })
        setPendingCredential(undefined)
        return
      }
      const updated = await persistPool(api, activeNamespace, settingsPath, pool)
      setActiveNamespace(updated)
      setPool(poolDraftOf(updated, settingsPath))
      props.onNamespaceChange(updated)
    })
  }

  const add = (): void => {
    void run(async () => {
      if (pendingCredential !== undefined) {
        await retryAlternateKeyCredential(api, {
          keyId: pendingCredential.keyId,
          credentialRef: pendingCredential.credentialRef,
          credentialValue: pendingCredential.value,
        })
        setPendingCredential(undefined)
        return
      }
      const draft: AlternateKeyAddDraft = {
        id: keyId,
        credentialRef,
        credentialValue,
        priority: Number(priority),
        weight: Number(weight),
      }
      const primaryRef = getPath(activeNamespace.value, [...settingsPath, 'apiKeyEnv'])
      const plan = planAddAlternateKey(
        pool,
        draft,
        typeof primaryRef === 'string' ? primaryRef : undefined,
      )
      // Commit ordering mirrors the single-key ProviderEditor pattern:
      // settings.mutate first, then credentials.set on success. Pending
      // state survives only a credential failure so retry only writes the
      // credential half and never re-runs the settings mutation.
      try {
        const updated = await commitAlternateKey(api, activeNamespace, settingsPath, plan)
        setActiveNamespace(updated)
        setPool(poolDraftOf(updated, settingsPath))
        props.onNamespaceChange(updated)
      } catch (error) {
        if (error instanceof AlternateKeyCredentialPendingError) {
          setPendingCredential({ keyId: error.keyId, credentialRef: error.credentialRef, value: error.credentialValue })
          return
        }
        throw error
      }
      setKeyId('')
      setCredentialRef('')
      setCredentialValue('')
    })
  }

  const remove = (id: string): void => {
    void run(async () => {
      const next: ApiKeyPoolDraft = { ...pool, keys: pool.keys.filter(key => key.id !== id) }
      next.maxAttempts = Math.min(Math.max(1, next.maxAttempts), next.keys.length + 1)
      await persistPool(api, activeNamespace, settingsPath, next)
      setPool(next)
    })
  }

  const probe = (id: string): void => {
    void run(async () => {
      const result = await probeAlternateKey(provider, id)
      const next = await viewPoolHealth(provider)
      setHealth(next)
      if (result.status === 'error') throw new Error(result.errorCode ?? t('poolProbeFailed'))
    })
  }

  const disabled = props.disabled || busy
  const maxEnabled = pool.keys.filter(key => key.enabled).length + (pool.primaryEnabled ? 1 : 0)
  const updateKey = (id: string, patch: Partial<ApiKeyPoolDraft['keys'][number]>): void => {
    if (pendingCredential !== undefined) return
    setPool(current => {
      const next = { ...current, keys: current.keys.map(key => key.id === id ? { ...key, ...patch } : key) }
      next.maxAttempts = Math.min(Math.max(1, next.maxAttempts), next.keys.length + 1)
      return next
    })
  }
  return (
    <section className={styles['poolBlock']} aria-label={t('poolTitle')}>
      <h3 className={styles['poolTitle']}>{t('poolTitle')}</h3>
      <div className={styles['poolPolicyGrid']}>
        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('poolMode')}</span>
          <select className={`${styles['input']} ${styles['selectInput']}`} value={pool.mode} disabled={disabled} onChange={(event) => { setPool(current => ({ ...current, mode: event.target.value === 'weighted' ? 'weighted' : 'priority' })) }}>
            <option value="priority">{t('poolPriority')}</option>
            <option value="weighted">{t('poolWeighted')}</option>
          </select>
        </label>
        <label className={styles['poolToggle']}>
          <input type="checkbox" checked={pool.primaryEnabled} disabled={disabled} onChange={event => { setPool(current => ({ ...current, primaryEnabled: event.target.checked })) }} />
          <span>{t('poolPrimaryEnabled')}</span>
        </label>
        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{pool.mode === 'weighted' ? t('poolWeight') : t('poolPriorityField')}</span>
          <input className={styles['input']} type="number" min={pool.mode === 'weighted' ? 1 : 0} value={pool.mode === 'weighted' ? pool.primaryWeight : pool.primaryPriority} disabled={disabled} onChange={event => { const value = Number(event.target.value); setPool(current => pool.mode === 'weighted' ? { ...current, primaryWeight: value } : { ...current, primaryPriority: value }) }} />
        </label>
        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('poolMaxAttempts')}</span>
          <input className={styles['input']} type="number" min={1} max={maxEnabled} value={pool.maxAttempts} disabled={disabled} onChange={(event) => { setPool(current => ({ ...current, maxAttempts: Number(event.target.value) })) }} />
        </label>
        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('poolFailureThreshold')}</span>
          <input className={styles['input']} type="number" min={1} value={pool.failureThreshold} disabled={disabled} onChange={(event) => { setPool(current => ({ ...current, failureThreshold: Number(event.target.value) })) }} />
        </label>
        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('poolOpenCircuitMs')}</span>
          <input className={styles['input']} type="number" min={1} value={pool.openCircuitMs} disabled={disabled} onChange={(event) => { setPool(current => ({ ...current, openCircuitMs: Number(event.target.value) })) }} />
        </label>
      </div>
      <button className={styles['secondaryButton']} type="button" disabled={disabled || pool.keys.length === 0} onClick={save}>{t('poolSavePolicy')}</button>
      <div className={styles['poolKeys']}>
        {pool.keys.map(key => (
          <div className={styles['poolKeyRow']} key={key.id}>
          <span className={styles['poolKeyIdentity']}>
            <strong>{key.id}</strong>
            <span>{key.credentialRef}</span>
            <span>{pendingCredential?.keyId === key.id
              ? t('poolKeyCredentialPending')
              : t(health[key.id]?.probeRequired === true ? 'poolProbeRequired' : health[key.id]?.state === 'healthy' ? 'poolHealthy' : health[key.id]?.state === 'open' ? 'poolOpen' : health[key.id]?.state === 'trial' ? 'poolTrial' : 'poolUnknown')}</span>
            </span>
            <label className={styles['poolToggle']}>
              <input type="checkbox" checked={key.enabled} disabled={disabled} onChange={event => { updateKey(key.id, { enabled: event.target.checked }) }} />
              <span>{t('poolEnabled')}</span>
            </label>
            <label className={styles['poolInlineField']}>
              <span>{pool.mode === 'weighted' ? t('poolWeight') : t('poolPriorityField')}</span>
              <input className={styles['input']} type="number" min={pool.mode === 'weighted' ? 1 : 0} value={pool.mode === 'weighted' ? key.weight : key.priority} disabled={disabled} onChange={event => { updateKey(key.id, pool.mode === 'weighted' ? { weight: Number(event.target.value) } : { priority: Number(event.target.value) }) }} />
            </label>
            <span className={styles['poolKeyActions']}>
              <button className={styles['iconButton']} type="button" title={t('poolProbe')} aria-label={t('poolProbe')} disabled={disabled} onClick={() => { probe(key.id) }}><IconRefreshOutline16 size={14} /></button>
              <button className={`${styles['iconButton']} ${styles['iconButtonDanger']}`} type="button" title={t('poolRemove')} aria-label={t('poolRemove')} disabled={disabled} onClick={() => { remove(key.id) }}><IconTrashOutline16 size={14} /></button>
            </span>
          </div>
        ))}
      </div>
      <div className={styles['poolAddGrid']}>
        <label className={styles['field']}><span className={styles['fieldLabel']}>{t('poolKeyId')}</span><input className={styles['input']} value={keyId} disabled={disabled} onChange={event => { setKeyId(event.target.value) }} /></label>
        <label className={styles['field']}><span className={styles['fieldLabel']}>{t('poolCredentialRef')}</span><input className={styles['input']} value={credentialRef} disabled={disabled || pendingCredential !== undefined} onChange={event => { setCredentialRef(event.target.value) }} /></label>
        <label className={styles['field']}><span className={styles['fieldLabel']}>{t('poolApiKey')}</span><input className={styles['input']} type="password" autoComplete="off" value={credentialValue} disabled={disabled || pendingCredential !== undefined} onChange={event => { setCredentialValue(event.target.value) }} /></label>
        <label className={styles['field']}><span className={styles['fieldLabel']}>{t('poolPriorityField')}</span><input className={styles['input']} type="number" min={0} value={priority} disabled={disabled || pendingCredential !== undefined} onChange={event => { setPriority(event.target.value) }} /></label>
        <label className={styles['field']}><span className={styles['fieldLabel']}>{t('poolWeight')}</span><input className={styles['input']} type="number" min={1} value={weight} disabled={disabled || pendingCredential !== undefined} onChange={event => { setWeight(event.target.value) }} /></label>
      </div>
      <button className={styles['secondaryButton']} type="button" disabled={disabled} onClick={add}>
        <IconPlusOutline16 size={14} />
        {pendingCredential === undefined ? t('poolAddKey') : t('retry')}
      </button>
      {pendingCredential === undefined ? null
        : <p className={styles['error']}>{t('poolKeyStoredPending')}</p>}
      {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}
    </section>
  )
}
