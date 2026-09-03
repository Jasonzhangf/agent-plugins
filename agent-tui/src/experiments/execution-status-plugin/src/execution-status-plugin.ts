import { Service, type Context } from '@deepseek-ai/cordis'
import type { TuiExecutionStatusFace, TuiExecutionStatusProjection, TuiExecutionState } from '../../../../contracts/tui/execution-status-plugin/execution-status-plugin.types.ts'

export const tuiExecutionStatusName = 'tuiExecutionStatus' as const
function elapsed(startedAt: number, now: number): number { return Math.max(0, now - startedAt) }
function formatElapsed(ms: number): string { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
const ACTIVITY_FRAMES = ['·   ', '·▸  ', '·▸▸ ', '·▸▸▸', '·▸▸▸▸'] as const
function activityFrame(ms: number): string { return ACTIVITY_FRAMES[Math.floor(ms / 180) % ACTIVITY_FRAMES.length] ?? ACTIVITY_FRAMES[0] }
export class TuiExecutionStatusService extends Service implements TuiExecutionStatusFace {
  readonly name = tuiExecutionStatusName
  private disposed = false; private state: TuiExecutionState = 'idle'; private startedAt = 0; private title: string | null = null; private revision = 0; private timer: ReturnType<typeof setInterval> | undefined; private readonly listeners = new Set<(projection: TuiExecutionStatusProjection) => void>()
  constructor(private readonly contextRef: Context) { super(contextRef, tuiExecutionStatusName); contextRef.effect(() => () => this.dispose(), 'execution-status-plugin.dispose') }
  start(title = 'working', now = Date.now()): void { if (this.disposed) throw new Error('execution-status-plugin: disposed'); if (this.state === 'running') throw new Error('execution-status-plugin: execution already running'); this.state = 'running'; this.startedAt = now; this.title = title; this.revision += 1; this.timer = setInterval(() => this.publish(), 180); this.publish() }
  setTitle(title: string): void { if (this.disposed) throw new Error('execution-status-plugin: disposed'); if (typeof title !== 'string' || title.length === 0) throw new TypeError('execution-status-plugin: title must be non-empty'); if (this.state !== 'running' || this.title === title) return; this.title = title; this.revision += 1; this.publish() }
  tick(now = Date.now()): TuiExecutionStatusProjection { return this.project(now) }
  stop(state: Exclude<TuiExecutionState, 'idle' | 'running'>): void { if (this.disposed) throw new Error('execution-status-plugin: disposed'); if (this.state !== 'running') throw new Error('execution-status-plugin: no running execution'); this.clearTimer(); this.state = state; this.revision += 1; this.publish() }
  interrupt(): void { if (this.state !== 'running') throw new Error('execution-status-plugin: no running execution'); (this.contextRef as Context & { tuiEventBus: { publish(intent: { readonly kind: 'terminal.cancel'; readonly sourceId: string }): unknown } }).tuiEventBus.publish({ kind: 'terminal.cancel', sourceId: 'execution-status-plugin' }); this.stop('interrupted') }
  project(now = Date.now()): TuiExecutionStatusProjection { const elapsedMs = this.state === 'idle' ? 0 : elapsed(this.startedAt, now); const line = this.state === 'running' ? `${this.title ?? 'working'} ${activityFrame(elapsedMs)} ${formatElapsed(elapsedMs)} · Esc interrupt` : null; return Object.freeze({ state: this.state, elapsedMs, title: this.title, line, revision: this.revision }) }
  subscribe(listener: (projection: TuiExecutionStatusProjection) => void): () => void { if (this.disposed) throw new Error('execution-status-plugin: disposed'); this.listeners.add(listener); listener(this.project()); return () => this.listeners.delete(listener) }
  dispose(): void { if (this.disposed) return; this.clearTimer(); this.disposed = true; this.state = 'idle'; this.title = null; this.listeners.clear() }
  private publish(): void { const projection = this.project(); for (const listener of [...this.listeners]) listener(projection) }
  private clearTimer(): void { if (this.timer === undefined) return; clearInterval(this.timer); this.timer = undefined }
}
export function apply(ctx: Context): void { ctx.tuiExecutionStatus = new TuiExecutionStatusService(ctx) }
