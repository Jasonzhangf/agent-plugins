import { Service, type Context } from '@deepseek-ai/cordis'
import type { TuiHistoryEntry as HistoryEntry } from '../../../../contracts/tui/session/history-entry.types.ts'
import type { TuiTerminalRawBufferFace } from '../../../../contracts/tui/terminal-raw-buffer-plugin/terminal-raw-buffer-plugin.types.ts'

const HISTORY_ENTRY_KEYS = new Set(['event', 'view'])

function validateRecord(record: HistoryEntry): void {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('terminal-raw-buffer-plugin: history entry is required')
  if (!record.event || typeof record.event !== 'object' || Array.isArray(record.event)) throw new TypeError('terminal-raw-buffer-plugin: event is required')
  for (const key of Object.keys(record)) if (!HISTORY_ENTRY_KEYS.has(key)) throw new Error(`terminal-raw-buffer-plugin: unsupported field ${key}`)
  if (!Number.isSafeInteger(record.event.seq) || record.event.seq < 0) throw new TypeError('terminal-raw-buffer-plugin: event sequence must be a non-negative safe integer')
  if (typeof record.event.type !== 'string' || record.event.type.length === 0) throw new TypeError('terminal-raw-buffer-plugin: event type is required')
  if (!Number.isFinite(record.event.time)) throw new TypeError('terminal-raw-buffer-plugin: event time must be finite')
  if (record.view !== undefined && (!record.view || typeof record.view !== 'object' || Array.isArray(record.view))) throw new TypeError('terminal-raw-buffer-plugin: view must be an object')
}

function cloneRecord(record: HistoryEntry): HistoryEntry {
  return Object.freeze({
    event: Object.freeze({ ...record.event }),
    ...(record.view === undefined ? {} : { view: Object.freeze({ ...record.view }) }),
  })
}

export class TuiTerminalRawBufferService extends Service implements TuiTerminalRawBufferFace {
  readonly name = 'tuiTerminalRawBuffer' as const
  private records: HistoryEntry[] = []
  private disposed = false

  constructor(ctx: Context) {
    super(ctx, 'tuiTerminalRawBuffer')
    ctx.effect(() => () => this.dispose(), 'terminal-raw-buffer-plugin.dispose')
  }

  hydrate(records: readonly HistoryEntry[]): void {
    this.assertOpen();
    if (!Array.isArray(records)) throw new TypeError('terminal-raw-buffer-plugin: records must be an array')
    this.records = []
    for (const record of records) this.append(record)
  }

  prepend(records: readonly HistoryEntry[]): void {
    this.assertOpen()
    if (!Array.isArray(records)) throw new TypeError('terminal-raw-buffer-plugin: records must be an array')
    const oldest = this.records[0]?.event.seq
    let previous: number | undefined
    const page: HistoryEntry[] = []
    for (const record of records) {
      validateRecord(record)
      if (previous !== undefined && record.event.seq <= previous) throw new Error('terminal-raw-buffer-plugin: prepend page must increase')
      if (oldest !== undefined && record.event.seq >= oldest) throw new Error('terminal-raw-buffer-plugin: prepend sequence must decrease')
      page.push(cloneRecord(record))
      previous = record.event.seq
    }
    this.records = [...page, ...this.records]
  }

  append(record: HistoryEntry): void {
    this.assertOpen(); validateRecord(record)
    const previous = this.records.at(-1)
    if (previous && record.event.seq <= previous.event.seq) throw new Error('terminal-raw-buffer-plugin: append sequence must increase')
    this.records.push(cloneRecord(record))
  }

  replace(record: HistoryEntry): void {
    this.assertOpen(); validateRecord(record)
    const index = this.records.findIndex(item => item.event.seq === record.event.seq)
    if (index < 0) throw new Error('terminal-raw-buffer-plugin: replace sequence not found')
    this.records[index] = cloneRecord(record)
  }

  read(): readonly HistoryEntry[] { this.assertOpen(); return Object.freeze([...this.records]) }
  dispose(): void { this.disposed = true; this.records = [] }
  private assertOpen(): void { if (this.disposed) throw new Error('terminal-raw-buffer-plugin: disposed') }
}

export function apply(ctx: Context): void { ctx.tuiTerminalRawBuffer = new TuiTerminalRawBufferService(ctx) }
