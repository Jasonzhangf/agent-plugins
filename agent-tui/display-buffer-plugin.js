import { Service } from '@deepseek-ai/cordis';
const DEFAULT_MAX_RETAINED_ROWS = 1000;
function validateLayout(layout) {
    if (!layout || typeof layout !== 'object')
        throw new TypeError('display-buffer-plugin: layout is required');
    if (!Number.isSafeInteger(layout.width) || layout.width < 1)
        throw new TypeError('display-buffer-plugin: width must be a positive safe integer');
    if (!Number.isSafeInteger(layout.paddingX) || layout.paddingX < 0)
        throw new TypeError('display-buffer-plugin: paddingX must be a non-negative safe integer');
    const contentWidth = layout.width - layout.paddingX * 2;
    if (contentWidth < 1)
        throw new TypeError('display-buffer-plugin: content width must be positive');
    return contentWidth;
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
            if (previous?.style === span.style && previous.backgroundColor === span.backgroundColor) {
                current[current.length - 1] = Object.freeze({ ...previous, text: previous.text + character });
            }
            else {
                current.push(Object.freeze({ text: character, style: span.style, ...(span.backgroundColor === undefined ? {} : { backgroundColor: span.backgroundColor }) }));
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
function retainedFirst(rows) { return rows[0]?.absoluteRow ?? 0; }
function retainedMaxTop(rows, height) {
    const first = retainedFirst(rows);
    const last = rows.at(-1)?.absoluteRow;
    return last === undefined ? 0 : Math.max(first, last - height + 1);
}
function rowSignature(row) {
    // lifecycle is a projection state, not committed row content. A streaming
    // element may settle at the same absolute row without rewriting its text.
    return `${row.elementId}:${row.sourceId}:${row.lineIndex}:${row.line.spans.map(span => `${span.style}:${span.backgroundColor ?? ''}:${span.text}`).join('|')}`;
}
function rowKey(row) {
    return `${row.elementId}:${row.sourceId}:${row.lineIndex}`;
}
function preserveAbsoluteRows(rows, previous) {
    const previousByKey = new Map(previous.map(row => [rowKey(row), row.absoluteRow]));
    const assigned = rows.map(row => previousByKey.get(rowKey(row)));
    let index = 0;
    while (index < assigned.length) {
        if (assigned[index] !== undefined) {
            index += 1;
            continue;
        }
        const start = index;
        while (index < assigned.length && assigned[index] === undefined)
            index += 1;
        const right = assigned[index];
        const left = start > 0 ? assigned[start - 1] : undefined;
        const first = right === undefined
            ? (left === undefined ? 0 : left + 1)
            : right - (index - start);
        for (let offset = 0; offset < index - start; offset += 1)
            assigned[start + offset] = first + offset;
    }
    return rows.map((row, rowIndex) => Object.freeze({ ...row, absoluteRow: assigned[rowIndex] }));
}
export class TuiDisplayBufferService extends Service {
    name = 'tuiDisplayBuffer';
    snapshot = Object.freeze({ revision: 0, width: 1, paddingX: 0, committedRows: Object.freeze([]), liveRows: Object.freeze([]), viewport: Object.freeze({ topRow: 0, height: 0, followTail: true }) });
    disposed = false;
    constructor(ctx) { super(ctx, 'tuiDisplayBuffer'); ctx.effect(() => () => this.dispose(), 'display-buffer-plugin.dispose'); }
    reset() {
        this.assertOpen();
        this.snapshot = Object.freeze({
            revision: this.snapshot.revision + 1,
            width: this.snapshot.width,
            paddingX: this.snapshot.paddingX,
            committedRows: Object.freeze([]),
            liveRows: Object.freeze([]),
            viewport: Object.freeze({ topRow: 0, height: this.snapshot.viewport.height, followTail: true }),
        });
        return this.snapshot;
    }
    reflow(elements, layout) {
        this.assertOpen();
        const contentWidth = validateLayout(layout);
        if (!Array.isArray(elements))
            throw new TypeError('display-buffer-plugin: elements must be an array');
        const rawRows = rowsFor(elements, contentWidth);
        const layoutChanged = this.snapshot.width !== layout.width || this.snapshot.paddingX !== layout.paddingX;
        const previousRows = [...this.snapshot.committedRows, ...this.snapshot.liveRows];
        const rows = layoutChanged ? rawRows : preserveAbsoluteRows(rawRows, previousRows);
        const stableRows = rows.filter(row => row.lifecycle === 'stable');
        if (this.snapshot.width === layout.width && this.snapshot.paddingX === layout.paddingX) {
            const stableByAbsoluteRow = new Map(stableRows.map(row => [row.absoluteRow, row]));
            if (this.snapshot.committedRows.some(row => {
                const next = stableByAbsoluteRow.get(row.absoluteRow);
                return next === undefined || rowSignature(row) !== rowSignature(next);
            })) {
                throw new Error('display-buffer-plugin: committed rows are append-only within a layout width');
            }
        }
        const retainedRows = rows.slice(-DEFAULT_MAX_RETAINED_ROWS);
        const split = retainedRows.findIndex(row => row.lifecycle === 'live');
        const committedRows = Object.freeze(split < 0 ? retainedRows : retainedRows.slice(0, split));
        const liveRows = Object.freeze(split < 0 ? [] : retainedRows.slice(split));
        const allRetainedRows = [...committedRows, ...liveRows];
        const previous = this.snapshot.viewport;
        const first = retainedFirst(allRetainedRows);
        const maxTop = retainedMaxTop(allRetainedRows, previous.height);
        const topRow = previous.followTail ? maxTop : Math.max(first, Math.min(previous.topRow, maxTop));
        this.snapshot = Object.freeze({ revision: this.snapshot.revision + 1, width: layout.width, paddingX: layout.paddingX, committedRows, liveRows, viewport: Object.freeze({ topRow, height: previous.height, followTail: previous.followTail }) });
        return this.snapshot;
    }
    setViewport(viewport) {
        this.assertOpen();
        if (!Number.isSafeInteger(viewport.topRow) || viewport.topRow < 0 || !Number.isSafeInteger(viewport.height) || viewport.height < 0 || typeof viewport.followTail !== 'boolean')
            throw new TypeError('display-buffer-plugin: invalid viewport');
        const rows = [...this.snapshot.committedRows, ...this.snapshot.liveRows];
        const first = retainedFirst(rows);
        const maxTop = retainedMaxTop(rows, viewport.height);
        const topRow = Math.max(first, Math.min(viewport.topRow, maxTop));
        this.snapshot = Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, viewport: Object.freeze({ ...viewport, topRow, followTail: topRow === maxTop ? viewport.followTail : false }) });
        return this.snapshot;
    }
    read() { this.assertOpen(); return this.snapshot; }
    dispose() { this.disposed = true; }
    assertOpen() { if (this.disposed)
        throw new Error('display-buffer-plugin: disposed'); }
}
export function apply(ctx) { ctx.tuiDisplayBuffer = new TuiDisplayBufferService(ctx); }
