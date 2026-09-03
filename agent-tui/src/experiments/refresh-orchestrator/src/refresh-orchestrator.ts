import { Service, type Context } from '@deepseek-ai/cordis'
import {
  assertTuiRefreshIntent,
  type TuiRefreshIntent,
  type TuiRefreshOrchestratorFace,
  type TuiRefreshPublication,
  type TuiRefreshRequestResult,
} from '../../../../contracts/tui/refresh-orchestrator/refresh-orchestrator.types.ts'

export const tuiRefreshOrchestratorName = 'tuiRefreshOrchestrator' as const

function causeKey(intent: TuiRefreshIntent): string {
  return `${intent.sourceModuleId}\u0000${intent.reason}\u0000${String(intent.sourceRevision)}`
}

function sameCause(left: TuiRefreshIntent, right: TuiRefreshIntent): boolean {
  return left.sourceModuleId === right.sourceModuleId
    && left.reason === right.reason
    && left.sourceRevision === right.sourceRevision
}

export class TuiRefreshOrchestratorService extends Service implements TuiRefreshOrchestratorFace {
  readonly name = tuiRefreshOrchestratorName

  private readonly latestRevisions = new Map<TuiRefreshIntent['sourceModuleId'], number>()
  private readonly pendingCauses: TuiRefreshIntent[] = []
  private readonly seenCauses = new Set<string>()
  private readonly listeners = new Set<(publication: TuiRefreshPublication) => void>()
  private flushQueued = false
  private disposed = false
  private nextPublicationRevision = 1

  constructor(private readonly context: Context) {
    super(context, tuiRefreshOrchestratorName)
    context.effect(() => () => this.dispose(), 'refresh-orchestrator.dispose')
  }

  request(value: unknown): TuiRefreshRequestResult {
    if (this.disposed) {
      return { status: 'rejected', reason: 'disposed', message: 'refresh-orchestrator: disposed' }
    }
    assertTuiRefreshIntent(value)
    const intent = Object.freeze({ ...value })
    const key = causeKey(intent)
    if (this.seenCauses.has(key)) return { status: 'coalesced' }
    const latest = this.latestRevisions.get(intent.sourceModuleId)
    if (latest !== undefined && intent.sourceRevision < latest) {
      return {
        status: 'rejected',
        reason: 'stale',
        message: `refresh-orchestrator: stale sourceRevision ${String(intent.sourceRevision)} for ${intent.sourceModuleId}; latest is ${String(latest)}`,
      }
    }
    this.latestRevisions.set(intent.sourceModuleId, intent.sourceRevision)
    this.seenCauses.add(key)
    if (this.pendingCauses.some(cause => sameCause(cause, intent))) return { status: 'coalesced' }
    this.pendingCauses.push(intent)
    if (!this.flushQueued) {
      this.flushQueued = true
      queueMicrotask(() => this.publish())
    }
    return { status: 'queued' }
  }

  subscribe(listener: (publication: TuiRefreshPublication) => void): () => void {
    if (this.disposed) throw new Error('refresh-orchestrator: cannot subscribe after disposed state')
    if (typeof listener !== 'function') throw new TypeError('refresh-orchestrator: listener must be a function')
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  private publish(): void {
    this.flushQueued = false
    if (this.disposed || this.pendingCauses.length === 0 || this.listeners.size === 0) {
      this.pendingCauses.length = 0
      return
    }
    const causes = Object.freeze(this.pendingCauses.splice(0))
    const publication = Object.freeze({
      publicationRevision: this.nextPublicationRevision,
      causes,
    })
    this.nextPublicationRevision += 1
    for (const listener of [...this.listeners]) listener(publication)
  }

  dispose(): void {
    this.disposed = true
    this.flushQueued = false
    this.pendingCauses.length = 0
    this.listeners.clear()
  }
}

export function apply(ctx: Context): void {
  ctx.tuiRefreshOrchestrator = new TuiRefreshOrchestratorService(ctx)
}
