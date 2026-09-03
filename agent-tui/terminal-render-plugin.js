import { Service } from '@deepseek-ai/cordis';
export class TuiTerminalRenderService extends Service {
    name = 'tuiTerminalRender';
    disposed = false;
    constructor(ctx) {
        super(ctx, 'tuiTerminalRender');
        ctx.effect(() => () => this.dispose(), 'terminal-render-plugin.dispose');
    }
    project(snapshot) {
        if (this.disposed)
            throw new Error('terminal-render-plugin: disposed');
        if (!snapshot || typeof snapshot !== 'object')
            throw new TypeError('terminal-render-plugin: snapshot is required');
        const { topRow, height } = snapshot.viewport;
        const allRows = [...snapshot.committedRows, ...snapshot.liveRows];
        const rows = allRows
            .filter(row => row.absoluteRow >= topRow && row.absoluteRow < topRow + height)
            .map(row => Object.freeze({ absoluteRow: row.absoluteRow, line: row.line }));
        return Object.freeze({
            revision: snapshot.revision,
            width: snapshot.width,
            paddingX: snapshot.paddingX,
            topRow,
            height,
            committedRows: Object.freeze(snapshot.committedRows.map(row => row.absoluteRow)),
            scrollbackRows: Object.freeze(snapshot.committedRows.map(row => Object.freeze({ absoluteRow: row.absoluteRow, line: row.line }))),
            rows: Object.freeze(rows),
        });
    }
    dispose() { this.disposed = true; }
}
export function apply(ctx) { ctx.tuiTerminalRender = new TuiTerminalRenderService(ctx); }
