/**
 * Shared pure types of the concurrency-limit domain: the ONE home of the
 * session-event and projection-key declarations, free of host-side value
 * imports (cordis services, dsh-tools, dsh-llm). Both the host half and the
 * client half import this module, so a single declaration feeds both planes.
 *
 * @module agent-concurrency-limit/types
 */

import type {} from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/**
 * The durable per-session record of the concurrent-request cap. The last
 * `concurrency/request-cap` event wins; `null` restores the deployment
 * default. Log-only and non-surface: it changes only when model requests are
 * admitted, never what the model sees, so `ignorable: true` lets readers
 * that predate the event skip it safely.
 */
export interface ConcurrencyRequestCap {
  /** In-flight model-request cap in force, or `null` to inherit the deployment default. */
  maxConcurrentRequests: number | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's concurrent-request cap changed. Log-only, non-surface,
     * whole-value replace; the last one wins. Absence folds to the plugin
     * config default, and a resume/fork rebuilds the same cap from this log.
     */
    'concurrency/request-cap': ConcurrencyRequestCap
  }
}

/**
 * The `concurrencyLimits` projection value served to clients: the effective
 * cap after folding the session log over the deployment default. Capability
 * absence (plugin not composed) is the key's absence, never a value here.
 */
export interface ConcurrencyLimitsProjection {
  /**
   * Effective in-flight model-request cap for the session; `null` when the
   * deployment leaves it uncapped (no default, no override).
   */
  maxConcurrentRequests: number | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Per-session concurrent-request cap folded from `concurrency/request-cap`. */
    concurrencyLimits: ConcurrencyLimitsProjection
  }
}
