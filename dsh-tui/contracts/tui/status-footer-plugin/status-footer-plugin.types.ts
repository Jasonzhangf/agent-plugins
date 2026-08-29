import type { TuiTerminalFooterLeaf } from '../terminal-ui/terminal-region-leaves.types.ts'
import type { TuiFocusViewId } from '../focus-manager/focus-manager.types.ts'

export type TuiStatusFooterConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'

export type TuiStatusFooterExecutionState =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'

export type TuiStatusFooterMode = 'idle' | 'streaming' | 'tool' | 'error'

export interface TuiStatusFooterConnectionProjection {
  readonly state: TuiStatusFooterConnectionState
  readonly revision: number
}

export interface TuiStatusFooterExecutionProjection {
  readonly state: TuiStatusFooterExecutionState
  readonly revision: number
}

export interface TuiStatusFooterStatusProjection {
  readonly mode: TuiStatusFooterMode
  readonly message?: string
  readonly revision: number
}

export interface TuiStatusFooterSessionIdentity {
  readonly sessionId: string | null
  readonly cwd: string | null
}

export interface TuiStatusFooterModelIdentity {
  readonly provider: string | null
  readonly model: string | null
  readonly thinkingEffort: string | null
}

export interface TuiStatusFooterPermission {
  readonly current: string | null
}

export type TuiStatusFooterGoalState = 'active' | 'paused' | 'blocked' | 'complete' | null

export interface TuiStatusFooterViewport {
  readonly class: 'compact' | 'regular'
  readonly columns: number
  readonly rows: number
}

export interface TuiStatusFooterFocus {
  readonly activeView: TuiFocusViewId
}

export interface TuiStatusFooterNotice {
  readonly message: string
}

export interface TuiStatusFooterError {
  readonly kind: 'fatal' | 'local'
  readonly message: string
}

export interface TuiStatusFooterInput {
  readonly connection: TuiStatusFooterConnectionProjection
  readonly execution: TuiStatusFooterExecutionProjection
  readonly status: TuiStatusFooterStatusProjection
  readonly selectedSession: TuiStatusFooterSessionIdentity
  readonly model: TuiStatusFooterModelIdentity
  readonly permission: TuiStatusFooterPermission
  readonly goal: TuiStatusFooterGoalState
  readonly viewport: TuiStatusFooterViewport
  readonly focus: TuiStatusFooterFocus
  readonly publicationRevision: number
  readonly error?: TuiStatusFooterError
  readonly notice?: TuiStatusFooterNotice
}

export interface TuiStatusFooterProjectionFailure {
  readonly stage: 'status-footer-projection'
  readonly code: 'invalid-status-footer-input'
  readonly message: string
  readonly cause: Error
}

export type TuiStatusFooterProjectionResult =
  | { readonly ok: true; readonly value: TuiTerminalFooterLeaf }
  | { readonly ok: false; readonly error: TuiStatusFooterProjectionFailure }

export interface TuiStatusFooterFace {
  readonly name: 'tuiStatusFooter'
  project(input: TuiStatusFooterInput): TuiTerminalFooterLeaf
  projectSafe(input: TuiStatusFooterInput): TuiStatusFooterProjectionResult
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiStatusFooter: TuiStatusFooterFace
  }
}
