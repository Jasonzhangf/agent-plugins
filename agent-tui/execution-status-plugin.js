import { Service } from '@deepseek-ai/cordis';
export const tuiExecutionStatusName = 'tuiExecutionStatus';
function elapsed(startedAt, now) { return Math.max(0, now - startedAt); }
function formatElapsed(ms) { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
const ACTIVITY_FRAMES = ['·   ', '·▸  ', '·▸▸ ', '·▸▸▸', '·▸▸▸▸'];
function activityFrame(ms) { return ACTIVITY_FRAMES[Math.floor(ms / 180) % ACTIVITY_FRAMES.length] ?? ACTIVITY_FRAMES[0]; }
export class TuiExecutionStatusService extends Service {
    contextRef;
    name = tuiExecutionStatusName;
    disposed = false;
    state = 'idle';
    startedAt = 0;
    title = null;
    revision = 0;
    timer;
    listeners = new Set();
    constructor(contextRef) {
        super(contextRef, tuiExecutionStatusName);
        this.contextRef = contextRef;
        contextRef.effect(() => () => this.dispose(), 'execution-status-plugin.dispose');
    }
    start(title = 'working', now = Date.now()) { if (this.disposed)
        throw new Error('execution-status-plugin: disposed'); if (this.state === 'running')
        throw new Error('execution-status-plugin: execution already running'); this.state = 'running'; this.startedAt = now; this.title = title; this.revision += 1; this.timer = setInterval(() => this.publish(), 180); this.publish(); }
    setTitle(title) { if (this.disposed)
        throw new Error('execution-status-plugin: disposed'); if (typeof title !== 'string' || title.length === 0)
        throw new TypeError('execution-status-plugin: title must be non-empty'); if (this.state !== 'running' || this.title === title)
        return; this.title = title; this.revision += 1; this.publish(); }
    tick(now = Date.now()) { return this.project(now); }
    stop(state) { if (this.disposed)
        throw new Error('execution-status-plugin: disposed'); if (this.state !== 'running')
        throw new Error('execution-status-plugin: no running execution'); this.clearTimer(); this.state = state; this.revision += 1; this.publish(); }
    interrupt() { if (this.state !== 'running')
        throw new Error('execution-status-plugin: no running execution'); this.contextRef.tuiEventBus.publish({ kind: 'terminal.cancel', sourceId: 'execution-status-plugin' }); this.stop('interrupted'); }
    project(now = Date.now()) { const elapsedMs = this.state === 'idle' ? 0 : elapsed(this.startedAt, now); const line = this.state === 'running' ? `${this.title ?? 'working'} ${activityFrame(elapsedMs)} ${formatElapsed(elapsedMs)} · Esc interrupt` : null; return Object.freeze({ state: this.state, elapsedMs, title: this.title, line, revision: this.revision }); }
    subscribe(listener) { if (this.disposed)
        throw new Error('execution-status-plugin: disposed'); this.listeners.add(listener); listener(this.project()); return () => this.listeners.delete(listener); }
    dispose() { if (this.disposed)
        return; this.clearTimer(); this.disposed = true; this.state = 'idle'; this.title = null; this.listeners.clear(); }
    publish() { const projection = this.project(); for (const listener of [...this.listeners])
        listener(projection); }
    clearTimer() { if (this.timer === undefined)
        return; clearInterval(this.timer); this.timer = undefined; }
}
export function apply(ctx) { ctx.tuiExecutionStatus = new TuiExecutionStatusService(ctx); }
