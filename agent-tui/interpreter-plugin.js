import { Service } from '@deepseek-ai/cordis';
function textFromValue(node) {
    const value = node.value;
    const text = value.text ?? value.message ?? value.output ?? value.result ?? value.summary ?? value.command;
    if (typeof text !== 'string')
        throw new TypeError(`interpreter-plugin: ${node.kind} requires public text`);
    return text;
}
function line(text, style = 'white') {
    return Object.freeze({ spans: Object.freeze([Object.freeze({ text, style })]) });
}
function descriptorStyle(value) {
    if (value === 'tool' || value === 'thinking' || value === 'blue' || value === 'red' || value === 'green' || value === 'dim')
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
    const indented = lines.map((item, index) => {
        if (index === 0 || item.spans.length === 0)
            return item;
        const first = item.spans[0];
        return Object.freeze({ spans: Object.freeze([Object.freeze({ text: `  ${first.text}`, style: 'white' }), ...item.spans.slice(1)]) });
    });
    return Object.freeze([
        Object.freeze({ spans: Object.freeze([]) }),
        ...indented,
        Object.freeze({ spans: Object.freeze([]) }),
    ]);
}
function markdownLines(tokens, baseStyle) {
    const lines = [];
    let current = [];
    let emphasisDepth = 0;
    let linkDepth = 0;
    const pushLine = () => {
        lines.push(Object.freeze({ spans: Object.freeze(current) }));
        current = [];
    };
    const append = (text, style = baseStyle) => {
        for (const [index, part] of text.split('\n').entries()) {
            if (part.length > 0) {
                const effectiveStyle = baseStyle === 'thinking' ? 'thinking' : baseStyle === 'dim' ? 'dim' : linkDepth > 0 ? 'blue' : emphasisDepth > 0 ? 'dim' : style;
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
            append(fields.join('\t'), 'tool');
        else if (kind === 'code') {
            separateBlocks();
            append(fields.slice(1).join('\t'), 'tool');
            separateBlocks();
        }
        else if (kind === 'math:inline' || kind === 'math:error')
            append(fields.join('\t'), 'tool');
        else if (kind === 'math:display') {
            separateBlocks();
            append(fields.join('\t'), 'tool');
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
        else if (kind === 'heading:start') {
            const depth = Number(fields[0] ?? '1');
            if (Number.isSafeInteger(depth) && depth > 1)
                append('  ', 'white');
        }
        else if (kind === 'heading:end') {
            separateBlocks();
        }
        else if (kind === 'paragraph:end' || kind === 'blockquote:end' || kind === 'footnote:end')
            separateBlocks();
        else if (kind === 'blockquote:start')
            append('│ ', 'dim');
        else if (kind === 'list-item:start') {
            if (current.length > 0)
                pushLine();
            append('- ', 'white');
        }
        else if (kind === 'list-item:end') {
            if (current.length > 0)
                pushLine();
        }
        else if (kind === 'list:end') {
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
            Object.freeze({ text: `› ${firstSpan?.text ?? ''}`, style: firstSpan?.style ?? 'white', backgroundColor: 'gray' }),
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
    interpret(node) {
        if (this.disposed)
            throw new Error('interpreter-plugin: disposed');
        if (node.kind === 'conversation.context' || node.kind === 'conversation.steering') {
            return Object.freeze({ elementId: node.nodeId, sourceId: node.nodeId, semanticKind: node.kind, lifecycle: node.lifecycle === 'streaming' ? 'live' : 'stable', lines: Object.freeze([]) });
        }
        if (node.kind === 'conversation.turn-tail') {
            const value = node.value;
            const duration = typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)
                ? ` ${(value.durationMs / 1000).toFixed(1)}s`
                : '';
            const summary = duration.length > 0 ? `·${duration} ────────────────────────────────` : '────────────────────────────────';
            return Object.freeze({
                elementId: node.nodeId,
                sourceId: node.nodeId,
                semanticKind: node.kind,
                lifecycle: node.lifecycle === 'streaming' ? 'live' : 'stable',
                lines: Object.freeze([line(summary, 'dim')]),
            });
        }
        let lines;
        if (node.kind.startsWith('tool.')) {
            const toolCard = this.context.tuiToolCard;
            if (toolCard === undefined)
                throw new Error('interpreter-plugin: tool-card plugin is required for tool elements');
            lines = withCardWhitespace(descriptorLines(toolCard.project({ nodeId: node.nodeId, kind: node.kind, lifecycle: node.lifecycle, value: node.value })));
        }
        else if (node.kind === 'conversation.assistant') {
            const blocks = node.value.blocks;
            if (!Array.isArray(blocks))
                throw new TypeError('interpreter-plugin: conversation.assistant requires public text blocks');
            lines = this.assistantLines(blocks, node.lifecycle);
        }
        else {
            const parser = this.context.tuiTextParser;
            if (parser === undefined)
                throw new Error('interpreter-plugin: text parser plugin is required for text elements');
            const text = node.kind === 'conversation.compaction'
                ? (() => {
                    const summary = node.value['summary'];
                    return typeof summary === 'string' ? summary : 'session compacted';
                })()
                : textFromValue(node);
            const tokens = parser.parse({ text, mode: node.lifecycle === 'streaming' ? 'streaming' : 'settled' });
            const parsedLines = markdownLines(tokens, node.kind === 'conversation.reasoning' ? 'thinking' : 'white');
            lines = node.kind === 'conversation.user' ? decorateUserLines(parsedLines) : parsedLines;
        }
        return Object.freeze({ elementId: node.nodeId, sourceId: node.nodeId, semanticKind: node.kind, lifecycle: node.lifecycle === 'streaming' ? 'live' : 'stable', lines });
    }
    assistantLines(blocks, lifecycle) {
        const parser = this.context.tuiTextParser;
        if (parser === undefined)
            throw new Error('interpreter-plugin: text parser plugin is required for text elements');
        const lines = [];
        for (const block of blocks) {
            if (block.text.length === 0)
                continue;
            if (lines.length > 0 && lines.at(-1)?.spans.length !== 0) {
                lines.push(Object.freeze({ spans: Object.freeze([]) }));
            }
            const tokens = parser.parse({ text: block.text, mode: lifecycle === 'streaming' ? 'streaming' : 'settled' });
            lines.push(...markdownLines(tokens, block.kind === 'reasoning' ? 'thinking' : 'white'));
        }
        if (lines.length === 0)
            throw new TypeError('interpreter-plugin: conversation.assistant requires public text blocks');
        return Object.freeze(lines);
    }
    dispose() { this.disposed = true; }
}
export function apply(ctx) { ctx.tuiInterpreter = new TuiInterpreterService(ctx); }
