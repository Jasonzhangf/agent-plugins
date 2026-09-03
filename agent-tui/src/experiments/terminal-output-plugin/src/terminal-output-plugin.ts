import { Service, type Context } from '@deepseek-ai/cordis'
import type { TuiTerminalOutputFace, TuiTerminalOutputSnapshot } from '../../../../contracts/tui/terminal-output-plugin/terminal-output-plugin.types.ts'
import type { TuiTerminalRenderFrame, TuiTerminalVisibleRow } from '../../../../contracts/tui/terminal-render-plugin/terminal-render-plugin.types.ts'

function validateFrame(frame: TuiTerminalRenderFrame): void {
  if (!frame || !Number.isSafeInteger(frame.revision) || frame.revision < 0) throw new TypeError('terminal-output-plugin: invalid frame')
  if (!Number.isSafeInteger(frame.width) || frame.width < 1) throw new TypeError('terminal-output-plugin: invalid frame width')
  if (!Number.isSafeInteger(frame.paddingX) || frame.paddingX < 0) throw new TypeError('terminal-output-plugin: invalid horizontal padding')
  if (!Array.isArray(frame.rows)) throw new TypeError('terminal-output-plugin: frame rows are required')
  for (let index = 1; index < frame.rows.length; index += 1) {
    if (frame.rows[index - 1]!.absoluteRow >= frame.rows[index]!.absoluteRow) throw new Error('terminal-output-plugin: rows must be ordered')
  }
}

export class TuiTerminalOutputService extends Service implements TuiTerminalOutputFace {
  readonly name = 'tuiTerminalOutput' as const
  private disposed = false
  private snapshot: TuiTerminalOutputSnapshot = Object.freeze({ sessionKey: null, revision: 0, width: 0, paddingX: 0, scrollbackRows: Object.freeze([]), stableRows: Object.freeze([]), pendingStableRows: Object.freeze([]), liveRows: Object.freeze([]), visibleRows: Object.freeze([]), dirtyRows: Object.freeze([]) })

  constructor(ctx: Context) {
    super(ctx, 'tuiTerminalOutput')
    ctx.effect(() => () => this.dispose(), 'terminal-output-plugin.dispose')
  }

  reset(sessionKey: string): void {
    if (this.disposed) throw new Error('terminal-output-plugin: disposed')
    if (typeof sessionKey !== 'string' || sessionKey.length === 0) throw new TypeError('terminal-output-plugin: session key must be non-empty')
    if (this.snapshot.sessionKey === sessionKey) return
    this.snapshot = Object.freeze({ sessionKey, revision: 0, width: 0, paddingX: 0, scrollbackRows: Object.freeze([]), stableRows: Object.freeze([]), pendingStableRows: Object.freeze([]), liveRows: Object.freeze([]), visibleRows: Object.freeze([]), dirtyRows: Object.freeze([]) })
  }

  apply(frame: TuiTerminalRenderFrame): TuiTerminalOutputSnapshot {
    if (this.disposed) throw new Error('terminal-output-plugin: disposed')
    validateFrame(frame)
    if (frame.revision < this.snapshot.revision) throw new Error('terminal-output-plugin: stale frame')
    const nextLive = frame.rows.map(row => row.absoluteRow)
    const layoutChanged = this.snapshot.width !== frame.width || this.snapshot.paddingX !== frame.paddingX
    const known = layoutChanged ? new Set<number>() : new Set(this.snapshot.scrollbackRows)
    const pendingStableRows = Object.freeze(frame.scrollbackRows.filter(row => !known.has(row.absoluteRow)).map(cloneRow))
    const scrollbackRows = Object.freeze(frame.scrollbackRows.map(row => row.absoluteRow))
    const stableRows = Object.freeze(frame.scrollbackRows.map(cloneRow))
    const previousRows = new Map(this.snapshot.visibleRows.map(row => [row.absoluteRow, row]))
    const nextRows = new Map(frame.rows.map(row => [row.absoluteRow, row]))
    const dirty = new Set<number>()
    for (const [absoluteRow, previous] of previousRows) {
      const next = nextRows.get(absoluteRow)
      if (next === undefined || rowSignature(previous) !== rowSignature(next)) dirty.add(absoluteRow)
    }
    for (const [absoluteRow, next] of nextRows) {
      const previous = previousRows.get(absoluteRow)
      if (previous === undefined || rowSignature(previous) !== rowSignature(next)) dirty.add(absoluteRow)
    }
    const dirtyRows = Object.freeze([...dirty].sort((left, right) => left - right))
    const visibleRows = Object.freeze(frame.rows.map(cloneRow))
    this.snapshot = Object.freeze({ sessionKey: this.snapshot.sessionKey, revision: frame.revision, width: frame.width, paddingX: frame.paddingX, scrollbackRows, stableRows, pendingStableRows, liveRows: Object.freeze(nextLive), visibleRows, dirtyRows })
    return this.snapshot
  }

  read(): TuiTerminalOutputSnapshot { if (this.disposed) throw new Error('terminal-output-plugin: disposed'); return this.snapshot }
  dispose(): void { this.disposed = true }
}

function rowSignature(row: TuiTerminalVisibleRow): string {
  return row.line.spans.map(span => `${span.style}:${span.backgroundColor ?? ''}:${span.text}`).join('|')
}

function cloneRow(row: TuiTerminalVisibleRow): TuiTerminalVisibleRow {
  return Object.freeze({ ...row, line: Object.freeze({ spans: Object.freeze(row.line.spans.map(span => Object.freeze({ ...span }))) }) })
}

export function apply(ctx: Context): void { ctx.tuiTerminalOutput = new TuiTerminalOutputService(ctx) }
