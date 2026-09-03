import { useEffect, useRef, useState } from 'react'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConcurrencyControlProps } from './slots.ts'
import css from './ConcurrencyControl.module.css'

/**
 * Per-session concurrent-request cap stepper in the composer tool row. Reads
 * the effective cap from the host projection (live) and writes through the
 * injected command channel — a switch here is what the next model request
 * observes, in this window only.
 */
export function ConcurrencyControl({ useProjection, set, reset, t }: ConcurrencyControlProps) {
  const projection = useProjection('concurrencyLimits')
  const cap = projection?.maxConcurrentRequests ?? null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const run = (operation: () => Promise<string | null>): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    void operation().then((failure) => {
      if (!aliveRef.current) return
      setBusy(false)
      setError(failure)
    }, (reason: unknown) => {
      if (!aliveRef.current) return
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const base = cap === null ? 1 : cap
  const label = cap === null
    ? t('uncapped')
    : t('current', { value: String(cap) })

  return (
    <span className={css.wrap} title={t('label')}>
      <button
        type="button"
        className={css.step}
        aria-label={t('decrease')}
        disabled={busy || cap === null}
        onClick={() => run(() => set(Math.max(1, base - 1)))}
      >−</button>
      <span className={css.value} role="status">{label}</span>
      <button
        type="button"
        className={css.step}
        aria-label={t('increase')}
        disabled={busy}
        onClick={() => run(() => set(base + 1))}
      >+</button>
      <button
        type="button"
        className={css.reset}
        aria-label={t('reset')}
        disabled={busy || cap === null}
        onClick={() => run(reset)}
      >↺</button>
      {error !== null && <span className={css.error} role="status" title={error}>{t('error')}</span>}
    </span>
  )
}