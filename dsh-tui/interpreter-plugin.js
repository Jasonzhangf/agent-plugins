import { Service } from '@deepseek-ai/cordis';
function textFromPayload(record) {
    const value = record.payload.text ?? record.payload.message ?? record.payload.output ?? record.payload.result;
    if (typeof value !== 'string')
        throw new TypeError(`interpreter-plugin: ${record.kind} requires public text`);
    return value;
}
function line(text, style = 'white') {
    return Object.freeze({ spans: Object.freeze([Object.freeze({ text, style })]) });
}
function descriptorStyle(value) {
    if (value === 'blue' || value === 'red' || value === 'green' || value === 'dim')
        return value;
    return 'white';
}
function descriptorSpans(descriptor, output) {
    const props = descriptor.props;
    if (props && typeof props['text'] === 'string') {
        output.push(Object.freeze({
            text: props['text'],
            style: props['dimColor'] === true ? 'dim' : descriptorStyle(props['color']),
        }));
    }
    for (const child of descriptor.children ?? [])
        descriptorSpans(child, output);
}
function descriptorLines(descriptor) {
    const spans = [];
    descriptorSpans(descriptor, spans);
    const lines = [];
    let current = [];
    for (const span of spans) {
        const parts = span.text.split('\n');
        for (const [index, part] of parts.entries()) {
            if (part.length > 0)
                current.push(Object.freeze({ text: part, style: span.style }));
            if (index < parts.length - 1) {
                lines.push(Object.freeze({ spans: Object.freeze(current) }));
                current = [];
            }
        }
    }
    if (current.length > 0 || lines.length === 0)
        lines.push(Object.freeze({ spans: Object.freeze(current) }));
    return Object.freeze(lines);
}
function withCardWhitespace(lines) {
    return Object.freeze([
        Object.freeze({ spans: Object.freeze([]) }),
        ...lines,
        Object.freeze({ spans: Object.freeze([]) }),
    ]);
}
function markdownLines(tokens, baseStyle) {
    const lines = [];
    let current = [];
    let emphasisDepth = 0;
    let linkDepth = 0;
    const lists = [];
    const pushLine = () => {
        lines.push(Object.freeze({ spans: Object.freeze(current) }));
        current = [];
    };
    const append = (text, style = baseStyle) => {
        for (const [index, part] of text.split('\n').entries()) {
            if (part.length > 0) {
                const effectiveStyle = baseStyle === 'dim' ? 'dim' : linkDepth > 0 ? 'blue' : emphasisDepth > 0 ? 'dim' : style;
                const previous = current.at(-1);
                if (previous?.style === effectiveStyle)
                    current[current.length - 1] = Object.freeze({ text: previous.text + part, style: effectiveStyle });
                else
                    current.push(Object.freeze({ text: part, style: effectiveStyle }));
            }
            if (index < text.split('\n').length - 1)
                pushLine();
        }
    };
    const separateBlocks = () => {
        if (current.length > 0)
            pushLine();
        if (lines.length > 0 && lines.at(-1)?.spans.length !== 0)
            pushLine();
    };
    for (const token of tokens) {
        const [kind, ...fields] = token.split('\t');
        if (kind === 'text')
            append(fields.join('\t'));
        else if (kind === 'inline-code' || kind === 'inline-code-link')
            append(fields.join('\t'), 'red');
        else if (kind === 'code') {
            separateBlocks();
            append(fields.slice(1).join('\t'), 'red');
            separateBlocks();
        }
        else if (kind === 'math:inline' || kind === 'math:error')
            append(fields.join('\t'), 'red');
        else if (kind === 'math:display') {
            separateBlocks();
            append(fields.join('\t'), 'red');
            separateBlocks();
        }
        else if (kind === 'link:start')
            linkDepth += 1;
        else if (kind === 'link:end')
            linkDepth = Math.max(0, linkDepth - 1);
        else if (kind === 'emphasis:start' || kind === 'delete:start')
            emphasisDepth += 1;
        else if (kind === 'emphasis:end' || kind === 'delete:end')
            emphasisDepth = Math.max(0, emphasisDepth - 1);
        else if (kind === 'break')
            pushLine();
        else if (kind === 'paragraph:end' || kind === 'heading:end' || kind === 'blockquote:end' || kind === 'footnote:end')
            separateBlocks();
        else if (kind === 'blockquote:start')
            append('│ ', 'dim');
        else if (kind === 'list:start')
            lists.push({ ordered: fields[0] === 'ordered', next: Number(fields[1] ?? '1') });
        else if (kind === 'list-item:start') {
            const list = lists.at(-1);
            append(list?.ordered === true ? `${String(list.next++)}. ` : '• ');
        }
        else if (kind === 'list-item:end') {
            if (current.length > 0)
                pushLine();
        }
        else if (kind === 'list:end') {
            lists.pop();
            if (lines.length > 0 && lines.at(-1)?.spans.length !== 0)
                pushLine();
        }
        else if (kind === 'table-cell:start') {
            if (current.length > 0)
                append(' │ ', 'dim');
        }
        else if (kind === 'table-row:end')
            pushLine();
        else if (kind === 'thematic-break') {
            separateBlocks();
            append('────────────────────────────────', 'dim');
            separateBlocks();
        }
        else if (kind === 'image')
            append(fields[1] || fields[0] || '', 'blue');
        else if (kind === 'reference')
            append(fields[1] || fields[0] || '');
        else if (kind === 'footnote:ref')
            append(`[${fields[0] ?? ''}]`, 'blue');
        else if (kind === 'raw-html')
            append(fields.join('\t'), 'dim');
    }
    if (current.length > 0 || lines.length === 0)
        pushLine();
    while (lines.length > 1 && lines.at(-1)?.spans.length === 0)
        lines.pop();
    return Object.freeze(lines);
}
function decorateUserLines(lines) {
    const first = lines[0] ?? line('', 'white');
    const firstSpan = first.spans[0];
    const decoratedFirst = Object.freeze({
        spans: Object.freeze([
            Object.freeze({ text: `› ${firstSpan?.text ?? ''}`, style: firstSpan?.style ?? 'white' }),
            ...(firstSpan === undefined ? [] : first.spans.slice(1)),
        ]),
    });
    return Object.freeze([
        Object.freeze({ spans: Object.freeze([]) }),
        decoratedFirst,
        ...lines.slice(1),
        Object.freeze({ spans: Object.freeze([]) }),
    ]);
}
export class TuiInterpreterService extends Service {
    context;
    name = 'tuiInterpreter';
    disposed = false;
    constructor(context) {
        super(context, 'tuiInterpreter');
        this.context = context;
        context.effect(() => () => this.dispose(), 'interpreter-plugin.dispose');
    }
    interpret(record) {
        if (this.disposed)
            throw new Error('interpreter-plugin: disposed');
        if (record.kind === 'conversation.context' || record.kind === 'conversation.steering') {
            return Object.freeze({ elementId: record.sourceId, sourceId: record.sourceId, semanticKind: record.kind, lifecycle: record.lifecycle === 'streaming' ? 'live' : 'stable', lines: Object.freeze([]) });
        }
        if (record.kind === 'conversation.turn-tail') {
            return Object.freeze({
                elementId: record.sourceId,
                sourceId: record.sourceId,
                semanticKind: record.kind,
                lifecycle: record.lifecycle === 'streaming' ? 'live' : 'stable',
                lines: Object.freeze([line('────────────────────────────────', 'dim')]),
            });
        }
        const text = textFromPayload(record);
        let lines;
        if (record.kind.startsWith('tool.')) {
            const toolCard = this.context.tuiToolCard;
            if (toolCard === undefined)
                throw new Error('interpreter-plugin: tool-card plugin is required for tool elements');
            lines = withCardWhitespace(descriptorLines(toolCard.project({ nodeId: record.sourceId, kind: record.kind, lifecycle: record.lifecycle, value: record.payload })));
        }
        else {
            const parser = this.context.tuiTextParser;
            if (parser === undefined)
                throw new Error('interpreter-plugin: text parser plugin is required for text elements');
            const tokens = parser.parse({ text, mode: record.lifecycle === 'streaming' ? 'streaming' : 'settled' });
            const parsedLines = markdownLines(tokens, record.kind === 'conversation.reasoning' ? 'dim' : 'white');
            lines = record.kind === 'conversation.user' ? decorateUserLines(parsedLines) : parsedLines;
        }
        return Object.freeze({ elementId: record.sourceId, sourceId: record.sourceId, semanticKind: record.kind, lifecycle: record.lifecycle === 'streaming' ? 'live' : 'stable', lines });
    }
    dispose() { this.disposed = true; }
}
export function apply(ctx) { ctx.tuiInterpreter = new TuiInterpreterService(ctx); }
