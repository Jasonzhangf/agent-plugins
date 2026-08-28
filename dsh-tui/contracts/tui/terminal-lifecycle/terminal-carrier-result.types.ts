/** Design-only v4 terminal/Ink carrier result contract. */

import type { TuiRealizedTerminalPrimitiveTree } from '../terminal-ui/terminal-frame-pipeline-result.types.ts'

export interface TuiTerminalCarrierFailure {
  readonly stage: 'mount' | 'rerender'
  readonly code: 'terminal-carrier-failed'
  readonly message: string
  readonly cause: Error
}

export interface TuiTerminalAsyncFlushFailure {
  readonly stage: 'flush'
  readonly code: 'terminal-flush-failed'
  readonly message: string
  readonly cause: Error
}

export type TuiTerminalCarrierFailureSource =
  | TuiTerminalCarrierFailure
  | TuiTerminalAsyncFlushFailure

export type TuiTerminalCarrierResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: TuiTerminalCarrierFailure }

export interface TuiTerminalCarrierFace {
  render(tree: TuiRealizedTerminalPrimitiveTree): TuiTerminalCarrierResult
}
