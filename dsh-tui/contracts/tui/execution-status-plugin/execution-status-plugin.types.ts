import type { Context } from '@deepseek-ai/cordis'
export type TuiExecutionState = 'idle' | 'running' | 'completed' | 'failed' | 'interrupted'
export interface TuiExecutionStatusProjection { readonly state: TuiExecutionState; readonly elapsedMs: number; readonly title: string | null; readonly line: string | null; readonly revision: number }
export interface TuiExecutionStatusFace { readonly name: 'tuiExecutionStatus'; start(title?: string, now?: number): void; setTitle(title: string): void; tick(now?: number): TuiExecutionStatusProjection; stop(state: Exclude<TuiExecutionState, 'idle' | 'running'>): void; interrupt(): void; project(now?: number): TuiExecutionStatusProjection; subscribe(listener: (projection: TuiExecutionStatusProjection) => void): () => void; dispose(): void }
declare module '@deepseek-ai/cordis' { interface Context { tuiExecutionStatus?: TuiExecutionStatusFace } }
