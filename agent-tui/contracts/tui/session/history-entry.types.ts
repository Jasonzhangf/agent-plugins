import type { SessionWireEvent } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools/presentation'

export type TuiToolEventView =
  | { readonly for: 'call'; readonly view: ToolCallView }
  | { readonly for: 'result'; readonly view: ToolResultView }

/** TUI presentation input after the alpha4 journal adapter normalizes a record. */
export interface TuiHistoryEntry {
  readonly event: SessionWireEvent
  readonly view?: TuiToolEventView
}
