import type { Context } from '@deepseek-ai/cordis'
import type { TuiHistoryEntry as HistoryEntry } from '../session/history-entry.types.ts'

export interface TuiTerminalRawBufferFace {
  readonly name: 'tuiTerminalRawBuffer'
  hydrate(records: readonly HistoryEntry[]): void
  prepend(records: readonly HistoryEntry[]): void
  append(record: HistoryEntry): void
  replace(record: HistoryEntry): void
  read(): readonly HistoryEntry[]
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { tuiTerminalRawBuffer?: TuiTerminalRawBufferFace }
}
