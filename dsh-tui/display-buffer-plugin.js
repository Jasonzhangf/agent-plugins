import { Service } from '@deepseek-ai/cordis';
function validateWidth(width) {
    if (!Number.isSafeInteger(width) || width < 1)
        throw new TypeError('display-buffer-plugin: width must be a positive safe integer');
}
function isCombiningMark(codePoint) {
    return (codePoint >= 0x0300 && codePoint <= 0x036f)
        || (codePoint >= 0x1ab0 && codePoint <= 0x1aff)
        || (codePoint >= 0x1dc0 && codePoint <= 0x1dff)
        || (codePoint >= 0x20d0 && codePoint <= 0x20ff)
        || (codePoint >= 0xfe20 && codePoint <= 0xfe2f);
}
function terminalCellWidth(character) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0))
        return 0;
    if (isCombiningMark(codePoint))
        return 0;
    if ((codePoint >= 0x1100 && codePoint <= 0x115f)
        || (codePoint >= 0x2329 && codePoint <= 0x232a)
        || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
        || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
        || (codePoint >= 0xf900 && codePoint <= 0xfaff)
        || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
        || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
        || (codePoint >= 0xff00 && codePoint <= 0xff60)
        || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
        || (codePoint >= 0x1f300 && codePoint <= 0x1faff))
        return 2;
    return 1;
}
function splitLine(line, width) {
    const output = [];
    let current = [];
    let remaining = width;
    const pushCurrent = () => { output.push(Object.freeze({ spans: Object.freeze(current) })); current = []; remaining = width; };
    for (const span of line.spans) {
        if (typeof span.text !== 'string' || span.text.length === 0)
            continue;
        for (const character of span.text) {
            const characterWidth = terminalCellWidth(character);
            if (characterWidth === 0) {
                const previous = current.at(-1);
                if (previous) {
                    current[current.length - 1] = Object.freeze({ ...previous, text: previous.text + character });
                }
                continue;
            }
            if (characterWidth > remaining)
                pushCurrent();
            const previous = current.at(-1);
            if (previous?.style === span.style) {
                current[current.length - 1] = Object.freeze({ ...previous, text: previous.text + character });
            }
            else {
                current.push(Object.freeze({ text: character, style: span.style }));
            }
            remaining -= characterWidth;
            if (remaining === 0)
                pushCurrent();
        }
    }
    if (current.length > 0 || output.length === 0)
        pushCurrent();
    return output;
}
function rowsFor(elements, width) {
    const rows = [];
    let sawLive = false;
    for (const element of elements) {
        if (element.lifecycle === 'live')
            sawLive = true;
        if (sawLive && element.lifecycle === 'stable') {
            throw new Error('display-buffer-plugin: stable element cannot follow live tail');
        }
        let lineIndex = 0;
        for (const sourceLine of element.lines) {
            for (const line of splitLine(sourceLine, width)) {
                rows.push(Object.freeze({ absoluteRow: rows.length, elementId: element.elementId, sourceId: element.sourceId, lineIndex, lifecycle: element.lifecycle, line }));
                lineIndex += 1;
            }
        }
    }
    return rows;
}
function maxTop(totalRows, height) { return Math.max(0, totalRows - height); }
function rowSignature(row) {
    return `${row.elementId}:${row.sourceId}:${row.lineIndex}:${row.lifecycle}:${row.line.spans.map(span => `${span.style}:${span.text}`).join('|')}`;
}
export class TuiDisplayBufferService extends Service {
    name = 'tuiDisplayBuffer';
    snapshot = Object.freeze({ revision: 0, width: 1, committedRows: Object.freeze([]), liveRows: Object.freeze([]), viewport: Object.freeze({ topRow: 0, height: 0, followTail: true }) });
    disposed = false;
    constructor(ctx) { super(ctx, 'tuiDisplayBuffer'); ctx.effect(() => () => this.dispose(), 'display-buffer-plugin.dispose'); }
    reset() {
        this.assertOpen();
        this.snapshot = Object.freeze({
            revision: this.snapshot.revision + 1,
            width: this.snapshot.width,
            committedRows: Object.freeze([]),
            liveRows: Object.freeze([]),
            viewport: Object.freeze({ topRow: 0, height: this.snapshot.viewport.height, followTail: true }),
        });
        return this.snapshot;
    }
    reflow(elements, width) {
        this.assertOpen();
        validateWidth(width);
        if (!Array.isArray(elements))
            throw new TypeError('display-buffer-plugin: elements must be an array');
        const rows = rowsFor(elements, width);
        const split = rows.findIndex(row => row.lifecycle === 'live');
        const committedRows = Object.freeze((split < 0 ? rows : rows.slice(0, split)).map((row, index) => Object.freeze({ ...row, absoluteRow: index })));
        const liveRows = Object.freeze((split < 0 ? [] : rows.slice(split)).map((row, index) => Object.freeze({ ...row, absoluteRow: committedRows.length + index })));
        if (this.snapshot.width === width) {
            const previousCommitted = this.snapshot.committedRows;
            if (committedRows.length < previousCommitted.length
                || previousCommitted.some((row, index) => rowSignature(row) !== rowSignature(committedRows[index]))) {
                throw new Error('display-buffer-plugin: committed rows are append-only within a layout width');
            }
        }
        const total = committedRows.length + liveRows.length;
        const previous = this.snapshot.viewport;
        const topRow = previous.followTail ? maxTop(total, previous.height) : Math.min(previous.topRow, maxTop(total, previous.height));
        this.snapshot = Object.freeze({ revision: this.snapshot.revision + 1, width, committedRows, liveRows, viewport: Object.freeze({ topRow, height: previous.height, followTail: previous.followTail }) });
        return this.snapshot;
    }
    setViewport(viewport) {
        this.assertOpen();
        if (!Number.isSafeInteger(viewport.topRow) || viewport.topRow < 0 || !Number.isSafeInteger(viewport.height) || viewport.height < 0 || typeof viewport.followTail !== 'boolean')
            throw new TypeError('display-buffer-plugin: invalid viewport');
        const total = this.snapshot.committedRows.length + this.snapshot.liveRows.length;
        const topRow = Math.min(viewport.topRow, maxTop(total, viewport.height));
        this.snapshot = Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, viewport: Object.freeze({ ...viewport, topRow, followTail: topRow === maxTop(total, viewport.height) ? viewport.followTail : false }) });
        return this.snapshot;
    }
    read() { this.assertOpen(); return this.snapshot; }
    dispose() { this.disposed = true; }
    assertOpen() { if (this.disposed)
        throw new Error('display-buffer-plugin: disposed'); }
}
export function apply(ctx) { ctx.tuiDisplayBuffer = new TuiDisplayBufferService(ctx); }
