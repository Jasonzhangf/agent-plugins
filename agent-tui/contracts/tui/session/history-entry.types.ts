import type { SessionWireEvent, ToolCallView, ToolResultView } from '../../../src/experiments/transport/src/transport.ts'

export type TuiToolEventView =
  | { readonly for: 'call'; readonly view: ToolCallView }
  | { readonly for: 'result'; readonly view: ToolResultView }

/** TUI presentation input after the OpenCode adaptor normalizes a record. */
export interface TuiHistoryEntry {
  readonly event: SessionWireEvent
  readonly view?: TuiToolEventView
}
