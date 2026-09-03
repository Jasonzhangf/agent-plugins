/**
 * Design-only v4 viewport truth. Phase 2 replaces the runtime-local
 * ViewportSize declaration with this app-event-bus-owned contract.
 */

export interface TuiValidatedTerminalViewport {
  readonly columns: number
  readonly rows: number
}
