/**
 * Session-log fold helper for the per-session concurrent-request cap.
 * @module dsh-concurrency-limit/cap
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Loads the `concurrency/request-cap` SessionEventMap merge into this unit.
import type {} from './types.ts'

/**
 * Fold a session log's `concurrency/request-cap` events (last one wins) into
 * the durable override. Absence folds to `null` — "no override" — which the
 * controller resolves against the deployment default.
 * @param events - the session log or any prefix of it.
 * @returns the logged override, or `null` when none exists.
 */
export function foldConcurrencyCap(events: readonly SessionEvent[]): number | null {
  let cap: number | null = null
  for (const event of events) {
    if (event.type === 'concurrency/request-cap') cap = event.data.maxConcurrentRequests
  }
  return cap
}