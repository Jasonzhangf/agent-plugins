import { Service } from '@deepseek-ai/cordis';
const FORBIDDEN_PAYLOAD_KEYS = new Set(['metadata', 'debug', 'provider', 'routing', 'retry', 'control', 'rpcId']);
function validateRecord(record) {
    if (!record || typeof record.sourceId !== 'string' || record.sourceId.length === 0)
        throw new TypeError('terminal-raw-buffer-plugin: sourceId is required');
    if (!Number.isSafeInteger(record.revision) || record.revision < 0)
        throw new TypeError('terminal-raw-buffer-plugin: revision must be a non-negative safe integer');
    if (typeof record.sessionId !== 'string' || record.sessionId.length === 0)
        throw new TypeError('terminal-raw-buffer-plugin: sessionId is required');
    if (typeof record.kind !== 'string' || record.kind.length === 0)
        throw new TypeError('terminal-raw-buffer-plugin: kind is required');
    if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload))
        throw new TypeError('terminal-raw-buffer-plugin: payload must be an object');
    for (const key of Object.keys(record.payload))
        if (FORBIDDEN_PAYLOAD_KEYS.has(key))
            throw new Error(`terminal-raw-buffer-plugin: forbidden control field ${key}`);
}
export class TuiTerminalRawBufferService extends Service {
    name = 'tuiTerminalRawBuffer';
    records = [];
    disposed = false;
    constructor(ctx) {
        super(ctx, 'tuiTerminalRawBuffer');
        ctx.effect(() => () => this.dispose(), 'terminal-raw-buffer-plugin.dispose');
    }
    hydrate(records) {
        this.assertOpen();
        if (!Array.isArray(records))
            throw new TypeError('terminal-raw-buffer-plugin: records must be an array');
        this.records = [];
        for (const record of records)
            this.append(record);
    }
    append(record) {
        this.assertOpen();
        validateRecord(record);
        const previous = this.records.at(-1);
        if (previous && record.revision <= previous.revision)
            throw new Error('terminal-raw-buffer-plugin: append revision must increase');
        this.records.push(Object.freeze({ ...record, payload: Object.freeze({ ...record.payload }) }));
    }
    replace(record) {
        this.assertOpen();
        validateRecord(record);
        const index = this.records.findIndex(item => item.sourceId === record.sourceId);
        if (index < 0)
            throw new Error('terminal-raw-buffer-plugin: replace sourceId not found');
        const previous = this.records[index - 1];
        const next = this.records[index + 1];
        if (previous && record.revision <= previous.revision)
            throw new Error('terminal-raw-buffer-plugin: replacement revision is not ordered');
        if (next && record.revision >= next.revision)
            throw new Error('terminal-raw-buffer-plugin: replacement revision crosses next record');
        this.records[index] = Object.freeze({ ...record, payload: Object.freeze({ ...record.payload }) });
    }
    read() { this.assertOpen(); return this.records; }
    dispose() { this.disposed = true; this.records = []; }
    assertOpen() { if (this.disposed)
        throw new Error('terminal-raw-buffer-plugin: disposed'); }
}
export function apply(ctx) { ctx.tuiTerminalRawBuffer = new TuiTerminalRawBufferService(ctx); }
