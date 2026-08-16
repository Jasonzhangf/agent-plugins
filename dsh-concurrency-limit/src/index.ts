/**
 * Per-session concurrency guard with live-adjustable model-request caps.
 *
 * One FIFO semaphore bounds in-flight `llm/stream` requests per session: the
 * deployment config value is the default, and each session's own logged
 * `concurrency/request-cap` event overrides it (last one wins, resumed from
 * the log on resume/fork). A second semaphore bounds tool bodies
 * process-wide from config only — the web UI stepper controls requests, per
 * the product decision. The client half (`/client`) reads the
 * `concurrencyLimits` projection and writes through the `/concurrency`
 * command.
 *
 * Every session in the process — the parent plus in-process subagent and
 * workflow children — funnels through the same `llm/stream` seam, so one
 * mount throttles the whole harness's model traffic per session. Unlike the
 * loop's `maxParallelToolCalls` (a per-step rolling-pool cap), this is a
 * global in-flight ceiling that also covers the auxiliary requests background
 * children keep issuing after their spawn call settled.
 *
 * Waiters are FIFO and abort-aware: a caller whose signal aborts while queued
 * is removed from the queue instead of hanging. A cap of `1` restores fully
 * serial model dispatch for that session.
 *
 * @module dsh-concurrency-limit
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED_BEFORE_DISPATCH, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-commands'
import type { Session } from '@deepseek-ai/dsh-session'
import { foldConcurrencyCap } from './cap.ts'
import type { ConcurrencyLimitsProjection } from './types.ts'
export type * from './types.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'concurrency-limit'

/**
 * Plugin config. Both caps default to the deployment values; a session may
 * override `maxConcurrentRequests` live from the UI. `maxConcurrentToolCalls`
 * stays config-only.
 */
export interface Config {
  /**
   * Maximum tool bodies running concurrently across the whole process (all
   * agents). `1` is fully serial. Omission leaves tool-call concurrency
   * uncapped.
   */
  maxConcurrentToolCalls?: number
  /**
   * Default maximum in-flight model requests (`llm/stream`) per session.
   * `1` is one request at a time. Omission leaves request concurrency
   * uncapped unless a session overrides it.
   */
  maxConcurrentRequests?: number
}

/** Runtime schema for {@link Config}. Missing keys resolve to undefined. */
export const Config: z<Config> = z.object({
  maxConcurrentToolCalls: z.natural().min(1),
  maxConcurrentRequests: z.natural().min(1),
})

/** Validate the mount contract fail-loud: every present cap is a positive integer. */
function validateConfig(config: Config): void {
  for (const [key, value] of [
    ['maxConcurrentToolCalls', config.maxConcurrentToolCalls],
    ['maxConcurrentRequests', config.maxConcurrentRequests],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new Error(`concurrency-limit: invalid ${key} ${value} — must be a positive integer`)
    }
  }
}

/**
 * FIFO semaphore with abort-aware queuing and a LIVE limit getter. The limit
 * is read at every acquire/release, so a cap change applies to the next
 * admission without rebuilding the semaphore. `acquire(signal)` resolves to a
 * release function once a slot is granted, or `undefined` when the caller's
 * signal aborts while queued (the waiter is removed from the queue so a
 * cancelled caller never blocks later work).
 */
export class Semaphore {
  private active = 0
  private waiters: {
    signal: AbortSignal | undefined
    resolve: (release: (() => void) | undefined) => void
    onAbort: () => void
  }[] = []

  constructor(private readonly limit: () => number) {}

  /** Acquire one slot, or resolve `undefined` if the signal aborts while queued. */
  acquire(signal?: AbortSignal): Promise<(() => void) | undefined> {
    if (signal?.aborted) return Promise.resolve(undefined)
    if (this.active < this.limit()) {
      this.active++
      return Promise.resolve(this.release)
    }
    return new Promise((resolve) => {
      const onAbort = (): void => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        resolve(undefined)
      }
      const waiter = { signal, resolve, onAbort }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.push(waiter)
      if (signal?.aborted) onAbort()
    })
  }

  /** Return one slot to the pool, granting it to the longest-waiting waiter while under the live limit. */
  private release = (): void => {
    this.active--
    while (this.active < this.limit() && this.waiters.length > 0) {
      const next = this.waiters.shift()
      if (next === undefined) break
      next.signal?.removeEventListener('abort', next.onAbort)
      this.active++
      next.resolve(this.release)
    }
  }
}

/** The canonical result the registry produces when cancellation prevents body invocation. */
function abortedBeforeDispatchResult(): ToolExecutionResult {
  return {
    content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
    isError: true,
    error: {
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The per-session concurrency controller mounted by this plugin. */
    concurrencyLimits: ConcurrencyLimitController
  }
}

/** Session key for the shared global cap used by session-less auxiliary requests. */
const GLOBAL_SESSION_KEY = '__concurrency_global__'

/**
 * The per-session cap controller: owns the deployment default, the live
 * per-session override mirror (kept current by the `session/event` listener),
 * and both semaphores. The durable truth is the session log; the mirror is
 * only the in-process fast path, rebuilt from the log for a cold session.
 */
export class ConcurrencyLimitController extends Service {
  static inject = ['sessions']

  private readonly defaultRequestCap: number | undefined
  private readonly toolSemaphore: Semaphore | undefined
  /** Session id → logged override (`null` = inherit default); absent = not yet seeded. */
  private readonly overrides = new Map<string, number | null>()
  private readonly requestSemaphores = new Map<string, Semaphore>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'concurrencyLimits')
    this.defaultRequestCap = config.maxConcurrentRequests
    this.toolSemaphore = config.maxConcurrentToolCalls === undefined
      ? undefined
      : new Semaphore(() => config.maxConcurrentToolCalls as number)
    // Keep the mirror current for every live session; a cold resume folds its
    // log lazily through `capFor` instead.
    ctx.on('session/event', (session: Session, event) => {
      if (event.type === 'concurrency/request-cap') {
        this.overrides.set(session.id, event.data.maxConcurrentRequests)
      }
    })
  }

  /**
   * The effective request cap for one session: logged override (live mirror,
   * else the session log) ?? deployment default. `undefined` = uncapped.
   * @param session - the owning session, or `undefined` for the shared global cap.
   * @returns the in-force cap, or `undefined` when uncapped.
   */
  capFor(session: Session | undefined): number | undefined {
    if (session === undefined) return this.defaultRequestCap
    const override = this.overrides.get(session.id)
    if (override !== undefined) return override === null ? this.defaultRequestCap : override
    const folded = foldConcurrencyCap(session.events)
    return folded === null ? this.defaultRequestCap : folded
  }

  /**
   * The request semaphore for one session (created lazily, live limit).
   * @param session - the owning session, or `undefined` for the shared global cap.
   */
  semaphoreFor(session: Session | undefined): Semaphore {
    const key = session === undefined ? GLOBAL_SESSION_KEY : session.id
    let semaphore = this.requestSemaphores.get(key)
    if (semaphore === undefined) {
      semaphore = new Semaphore(() => this.capFor(session) ?? Number.POSITIVE_INFINITY)
      this.requestSemaphores.set(key, semaphore)
    }
    return semaphore
  }

  /** The global tool-call semaphore, or undefined when uncapped. */
  toolCalls(): Semaphore | undefined {
    return this.toolSemaphore
  }
}

/** Projection unit state: the session's effective cap (`null` = uncapped). */
interface CapUnitState {
  cap: number | null
}

/** Zod schema validating the `concurrencyLimits` projection wire payload. */
const concurrencyLimitsSchema = zod.object({
  maxConcurrentRequests: zod.number().int().positive().nullable(),
})

/**
 * Install the wrappers, the projection unit, and the `/concurrency` command.
 * @param ctx - plugin context that owns the listeners, service, and command.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  ctx.plugin(ConcurrencyLimitController, config)
  const controller = ctx.concurrencyLimits
  const defaultCap = config.maxConcurrentRequests ?? null

  if (controller.toolCalls() !== undefined) {
    ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
      const release = await (controller.toolCalls() as Semaphore).acquire(exec.signal)
      if (release === undefined) return abortedBeforeDispatchResult()
      try {
        return await next()
      } finally {
        release()
      }
    })
  }

  ctx.on('llm/stream', (options, next): AsyncIterable<StreamChunk> => {
    // A session-less call (auxiliary request) shares the global default cap.
    const session = options.sessionId === undefined
      ? undefined
      : ctx.sessions.get(options.sessionId)
    const semaphore = controller.semaphoreFor(session)
    return (async function* (): AsyncIterable<StreamChunk> {
      const release = await semaphore.acquire(options.signal)
      if (release === undefined) {
        yield {
          type: 'finish',
          reason: { kind: 'aborted', failure: { message: 'model request aborted while queued', code: 'ABORTED' } },
        }
        return
      }
      try {
        yield* next()
      } finally {
        release()
      }
    })()
  })

  // The projection unit: pure fold over the session log serving the UI the
  // effective cap (override ?? default; null = uncapped). Registered only
  // when a projection registry is composed (headless stays unaffected).
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'concurrencyLimits', CapUnitState>({
      key: 'concurrencyLimits',
      schema: concurrencyLimitsSchema,
      init: () => ({ cap: defaultCap }),
      apply: (state, event) => {
        if (event.type !== 'concurrency/request-cap') return state
        return { cap: event.data.maxConcurrentRequests === null ? defaultCap : event.data.maxConcurrentRequests }
      },
      view: state => ({ maxConcurrentRequests: state.cap }) as ConcurrencyLimitsProjection,
      stateVersion: 1,
    })
  })

  // The command channel: /concurrency [set N|reset] — the UI's write path.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'concurrency',
      description: 'Show or set this session\'s concurrent model-request cap',
      input: { hint: '[set N|reset]' },
      handler: ({ agent, rawInput }) => {
        const input = rawInput.trim()
        if (input === '') {
          const current = controller.capFor(agent.session)
          return { kind: 'success', text: current === undefined ? 'uncapped' : String(current) }
        }
        const set = /^set\s+(\d+)$/u.exec(input)
        if (set !== null) {
          const next = Number(set[1])
          if (!Number.isInteger(next) || next < 1) {
            return { kind: 'error', text: 'usage: /concurrency set N (positive integer)' }
          }
          agent.session.append('concurrency/request-cap', { maxConcurrentRequests: next })
          return { kind: 'success', text: `set to ${String(next)}` }
        }
        if (input === 'reset') {
          agent.session.append('concurrency/request-cap', { maxConcurrentRequests: null })
          return { kind: 'success', text: 'reset to default' }
        }
        return { kind: 'error', text: 'usage: /concurrency [set N|reset]' }
      },
    })
  })
}
