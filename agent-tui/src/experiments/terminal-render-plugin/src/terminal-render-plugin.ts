import { Service, type Context } from '@deepseek-ai/cordis'
import type { TuiDisplayBufferSnapshot } from '../../../../contracts/tui/display-buffer-plugin/display-buffer-plugin.types.ts'
import type { TuiTerminalRenderFace, TuiTerminalRenderFrame, TuiTerminalVisibleRow } from '../../../../contracts/tui/terminal-render-plugin/terminal-render-plugin.types.ts'

export class TuiTerminalRenderService extends Service implements TuiTerminalRenderFace {
  readonly name = 'tuiTerminalRender' as const
  private disposed = false

  constructor(ctx: Context) {
    super(ctx, 'tuiTerminalRender')
    ctx.effect(() => () => this.dispose(), 'terminal-render-plugin.dispose')
  }

  project(snapshot: TuiDisplayBufferSnapshot): TuiTerminalRenderFrame {
    if (this.disposed) throw new Error('terminal-render-plugin: disposed')
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('terminal-render-plugin: snapshot is required')
    const { topRow, height } = snapshot.viewport
    const allRows = [...snapshot.committedRows, ...snapshot.liveRows]
    const rows: TuiTerminalVisibleRow[] = allRows
      .filter(row => row.absoluteRow >= topRow && row.absoluteRow < topRow + height)
      .map(row => Object.freeze({ absoluteRow: row.absoluteRow, line: row.line }))
    return Object.freeze({
      revision: snapshot.revision,
      width: snapshot.width,
      paddingX: snapshot.paddingX,
      topRow,
      height,
      committedRows: Object.freeze(snapshot.committedRows.map(row => row.absoluteRow)),
      scrollbackRows: Object.freeze(snapshot.committedRows.map(row => Object.freeze({ absoluteRow: row.absoluteRow, line: row.line }))),
      rows: Object.freeze(rows),
    })
  }

  dispose(): void { this.disposed = true }
}

export function apply(ctx: Context): void { ctx.tuiTerminalRender = new TuiTerminalRenderService(ctx) }
