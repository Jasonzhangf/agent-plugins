import { Service } from '@deepseek-ai/cordis';
export const tuiToolCardName = 'tuiToolCard';
function segment(text, color, style = {}) {
    return { contract: 'tui.element.v1', elementType: 'tool.segment', props: { text, color, ...style } };
}
function text(value) { return typeof value === 'string' ? value : ''; }
function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
function firstPath(value) {
    const locations = value?.['locations'];
    if (!Array.isArray(locations))
        return '';
    const path = object(locations[0])?.['path'];
    return typeof path === 'string' ? path : '';
}
function argumentPath(value) {
    if (!value.startsWith('{'))
        return value;
    try {
        const parsed = object(JSON.parse(value));
        for (const key of ['file_path', 'path']) {
            const path = parsed?.[key];
            if (typeof path === 'string' && path.length > 0)
                return path;
        }
    }
    catch {
        return '';
    }
    return '';
}
function codeReadPath(value) {
    const match = /\btools\.read(?:_image)?\s*\(\s*\{[\s\S]*?\bfile_path\s*:\s*["']([^"']+)["']/u.exec(value);
    return match?.[1] ?? '';
}
function codeShellCommand(value) {
    if (!/\btools\.[A-Za-z_$][\w$]*\s*\(/u.test(value))
        return '';
    return publicStringField(value, 'command') ?? '';
}
function publicStringField(value, field) {
    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = new RegExp(`(?:["']?${escapedField}["']?\\s*:\\s*)("(?:\\\\.|[^"\\\\])*")`, 'u').exec(value);
    if (!match?.[1])
        return undefined;
    try {
        const parsed = JSON.parse(match[1]);
        return typeof parsed === 'string' ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function codeEditDiff(value, result) {
    if (!/\btools\.(?:edit|str_replace_editor)\s*\(/u.test(value))
        return undefined;
    const oldText = publicStringField(result, 'before');
    const newText = publicStringField(result, 'after');
    if (oldText === undefined || newText === undefined)
        return undefined;
    const path = publicStringField(value, 'file_path') || publicStringField(result, 'path');
    if (!path)
        return undefined;
    return [{ path, oldText, newText }];
}
function directEditDiff(value, name) {
    if (name !== 'edit' && name !== 'str_replace_editor' && name !== 'write')
        return undefined;
    let parsed;
    try {
        parsed = object(JSON.parse(value));
    }
    catch {
        return undefined;
    }
    const path = text(parsed?.['file_path']) || text(parsed?.['path']);
    const oldText = text(parsed?.['old_string']) || text(parsed?.['oldText']) || text(parsed?.['before']);
    const newText = text(parsed?.['new_string']) || text(parsed?.['newText']) || text(parsed?.['after']) || text(parsed?.['content']);
    if (path.length === 0 || newText.length === 0 || (name !== 'write' && oldText.length === 0))
        return undefined;
    return [{ path, oldText, newText }];
}
function semanticCard(call, result, nodeKind) {
    const explicit = text(result?.['card']) || text(call?.['card']);
    if (explicit.length > 0 && explicit !== 'generic')
        return explicit;
    const callKind = text(call?.['kind']);
    const title = text(call?.['title']);
    const rawInput = text(call?.['rawInput']);
    if (callKind === 'read' || /^read\b/iu.test(title))
        return 'read';
    if (callKind === 'search' || /^(?:grep|glob|search)\b/iu.test(title))
        return 'search';
    if (nodeKind === 'tool.terminal' || callKind === 'execute' && (/^(?:run|execute|shell|bash|pwsh)\b/iu.test(title) || /\btools\.(?:bash|shell)\s*\(/u.test(rawInput)))
        return 'terminal';
    return '';
}
function contentText(value) {
    if (!Array.isArray(value))
        return '';
    return value
        .map(block => {
        const record = object(block);
        return record?.['type'] === 'text' ? text(record['text']) : '';
    })
        .filter(Boolean)
        .join('\n');
}
function searchJsonSegments(value) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        return undefined;
    }
    if (!Array.isArray(parsed))
        return undefined;
    const segments = [];
    for (const item of parsed) {
        const record = object(item);
        if (typeof record?.['path'] !== 'string' || typeof record['lineNumber'] !== 'number' || typeof record['line'] !== 'string')
            return undefined;
        segments.push(segment(`\n${record['path']}`, 'blue'));
        segments.push(segment(`\n  ${record['lineNumber']}: ${record['line']}`, 'white'));
    }
    return segments;
}
function searchQueryFromArguments(value) {
    if (!value.startsWith('{'))
        return value;
    try {
        const pattern = object(JSON.parse(value))?.['pattern'];
        return typeof pattern === 'string' ? pattern : '';
    }
    catch {
        return '';
    }
}
function backgroundControlLabel(name) {
    if (name === 'job_output')
        return 'Checked background output';
    if (name === 'job_list')
        return 'Checked background jobs';
    if (name === 'job_kill')
        return 'Stopped background job';
    return '';
}
function projectCard(input, parser) {
    const value = input.value;
    const status = text(value['status']);
    const failed = status === 'failed' || input.lifecycle === 'failed';
    const settled = status === 'completed' || input.lifecycle === 'settled';
    const call = value['callRenderIntent'] && typeof value['callRenderIntent'] === 'object' ? value['callRenderIntent'] : undefined;
    const result = value['resultRenderIntent'] && typeof value['resultRenderIntent'] === 'object' ? value['resultRenderIntent'] : undefined;
    const title = text(result?.['title']) || text(call?.['title']) || text(value['name']) || 'tool';
    const args = typeof call?.['rawInput'] === 'string' ? call['rawInput'] : text(value['arguments']);
    const outputText = text(value['result']);
    const inferredEditDiffs = directEditDiff(args, text(value['name'])) ?? codeEditDiff(args, outputText);
    const card = semanticCard(call, result, input.kind)
        || (input.kind === 'tool.read' || text(value['name']) === 'read' || text(value['name']) === 'read_file' ? 'read' : inferredEditDiffs === undefined ? '' : 'diff');
    const controlLabel = backgroundControlLabel(text(value['name']));
    const children = [segment('● ', failed ? 'red' : settled ? 'green' : 'white')];
    const readPath = text(result?.['path']) || firstPath(call) || codeReadPath(args) || argumentPath(args) || title.replace(/^Read\s+/u, '');
    if (controlLabel.length > 0) {
        children.push(segment(controlLabel, 'white'));
    }
    else if (card === 'read' || text(call?.['kind']) === 'read') {
        children.push(segment(readPath || title, 'blue'));
    }
    else if (card === 'search' || text(call?.['kind']) === 'search' || input.kind === 'tool.search') {
        const hasStructuredSearch = result?.['shape'] === 'paths' || result?.['shape'] === 'matches';
        const searchTitle = text(result?.['title']) || text(call?.['title'])
            || (hasStructuredSearch ? title : searchQueryFromArguments(args) || title);
        children.push(segment('Search ', 'white'), segment(searchTitle, 'blue'));
    }
    else if (card === 'terminal' || text(call?.['kind']) === 'shell' || input.kind === 'tool.terminal') {
        children.push(segment('Ran ', 'white'), ...commandSegments(commandFromArguments(args)));
    }
    else if (card === 'diff' || input.kind === 'tool.diff') {
        const diffs = Array.isArray(result?.['diffs'])
            ? result['diffs']
            : Array.isArray(call?.['diffs'])
                ? call['diffs']
                : inferredEditDiffs;
        const inferredPath = object(diffs?.[0])?.['path'];
        children.push(segment(typeof inferredPath === 'string' ? inferredPath : text(result?.['title']) || text(call?.['title']) || args || title, 'blue'), ...diffSegments(diffs ?? (text(result?.['output']) || outputText)));
    }
    else {
        children.push(segment('Called ', 'white'), segment(title, 'white'));
    }
    const outputValue = text(result?.['output']) || contentText(result?.['content']) || outputText;
    const output = card === 'terminal' ? terminalOutputText(outputValue) : outputValue;
    const searchJson = card === 'search' ? searchJsonSegments(output) : undefined;
    const error = text(value['error']);
    if (output && controlLabel.length === 0 && card !== 'diff' && card !== 'read' && input.kind !== 'tool.diff' && searchJson === undefined)
        children.push(...markdownSegments(output, parser));
    if (searchJson !== undefined)
        children.push(...searchJson);
    if (card === 'search' && result?.['shape'] === 'paths' && Array.isArray(result['paths'])) {
        for (const path of result['paths'])
            if (typeof path === 'string')
                children.push(segment(`\n${path}`, 'blue'));
    }
    if (card === 'search' && result?.['shape'] === 'matches' && Array.isArray(result['files'])) {
        for (const file of result['files']) {
            const record = object(file);
            if (typeof record?.['path'] !== 'string')
                continue;
            children.push(segment(`\n${record['path']}`, 'blue'));
            if (Array.isArray(record['matches']))
                for (const match of record['matches']) {
                    const item = object(match);
                    if (typeof item?.['lineNumber'] === 'number' && typeof item['line'] === 'string')
                        children.push(segment(`\n  ${item['lineNumber']}: ${item['line']}`, 'white'));
                }
        }
    }
    if (error)
        children.push(...markdownSegments(error, parser));
    return { contract: 'tui.element.v1', elementType: 'tool.card', props: { nodeId: input.nodeId }, children };
}
function markdownSegments(value, parser) {
    const result = [];
    let bold = false;
    let emphasis = false;
    let pendingBreak = true;
    for (const token of parser.parse({ text: value, mode: 'settled' })) {
        const [kind, ...fields] = token.split('\t');
        if (kind === 'text') {
            const text = fields.join('\t');
            if (text.length > 0) {
                result.push(segment(`${pendingBreak ? '\n' : ''}${text}`, 'white', { bold: bold || undefined, dimColor: emphasis || undefined }));
                pendingBreak = false;
            }
            continue;
        }
        if (kind === 'strong:start') {
            bold = true;
            continue;
        }
        if (kind === 'strong:end') {
            bold = false;
            continue;
        }
        if (kind === 'emphasis:start') {
            emphasis = true;
            continue;
        }
        if (kind === 'emphasis:end') {
            emphasis = false;
            continue;
        }
        if (kind === 'code') {
            result.push(segment(`${pendingBreak ? '\n' : ''}${fields.slice(1).join('\t')}`, 'white'));
            pendingBreak = false;
            continue;
        }
        if (kind === 'paragraph:end' || kind === 'heading:end' || kind === 'list-item:end' || kind === 'thematic-break') {
            pendingBreak = true;
        }
    }
    return result;
}
function diffSegments(diff) {
    if (Array.isArray(diff))
        return structuredDiffSegments(diff);
    if (typeof diff !== 'string')
        return [];
    const lines = diff.split('\n');
    let oldLine = 1;
    let newLine = 1;
    const parsed = lines.map(line => {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
        if (hunk) {
            oldLine = Number(hunk[1]);
            newLine = Number(hunk[2]);
            return { line, kind: 'header', number: null };
        }
        if (line.startsWith('+'))
            return { line, kind: 'add', number: newLine++ };
        if (line.startsWith('-'))
            return { line, kind: 'remove', number: oldLine++ };
        const number = newLine;
        oldLine += 1;
        newLine += 1;
        return { line, kind: 'context', number };
    });
    const changed = parsed.flatMap((entry, index) => entry.kind === 'add' || entry.kind === 'remove' ? [index] : []);
    const included = new Set();
    for (const index of changed) {
        for (let offset = -1; offset <= 1; offset += 1) {
            const candidate = index + offset;
            if (candidate >= 0 && candidate < parsed.length && parsed[candidate]?.kind !== 'header')
                included.add(candidate);
        }
    }
    return parsed
        .filter((entry, index) => entry.kind === 'header' || included.has(index))
        .map(entry => segment(`\n${String(entry.number ?? '').padStart(4, ' ')} │ ${entry.line}`, entry.kind === 'add' ? 'green' : entry.kind === 'remove' ? 'red' : 'white'));
}
function structuredDiffSegments(diffs) {
    const segments = [];
    for (const item of diffs) {
        const diff = object(item);
        const oldLines = (typeof diff?.['oldText'] === 'string' ? diff['oldText'] : '').split('\n');
        const newLines = (typeof diff?.['newText'] === 'string' ? diff['newText'] : '').split('\n');
        let prefix = 0;
        while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix])
            prefix += 1;
        let suffix = 0;
        while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
            && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1])
            suffix += 1;
        if (prefix > 0)
            segments.push(segment(`\n${String(prefix).padStart(4, ' ')} │  ${oldLines[prefix - 1]}`, 'white'));
        for (let index = prefix; index < oldLines.length - suffix; index += 1) {
            segments.push(segment(`\n${String(index + 1).padStart(4, ' ')} │ -${oldLines[index]}`, 'red'));
        }
        for (let index = prefix; index < newLines.length - suffix; index += 1) {
            segments.push(segment(`\n${String(index + 1).padStart(4, ' ')} │ +${newLines[index]}`, 'green'));
        }
        if (suffix > 0) {
            const index = newLines.length - suffix;
            segments.push(segment(`\n${String(index + 1).padStart(4, ' ')} │  ${newLines[index]}`, 'white'));
        }
    }
    return segments;
}
function commandSegments(command) {
    return command.split(/(\s+)/u).filter(Boolean).map(part => segment(part, /^\s+$/u.test(part) ? 'white' : 'red'));
}
function commandFromArguments(args) {
    if (!args.startsWith('{')) {
        const command = codeShellCommand(args);
        if (command.length > 0)
            return command;
        if (/\btools\.[A-Za-z_$][\w$]*\s*\(/u.test(args))
            throw new TypeError('tool-card-plugin: shell command is missing from public input');
        return args;
    }
    let parsed;
    try {
        parsed = JSON.parse(args);
    }
    catch (cause) {
        throw new TypeError(`tool-card-plugin: invalid terminal arguments: ${String(cause)}`);
    }
    if (parsed === null || typeof parsed !== 'object' || typeof parsed['command'] !== 'string') {
        throw new TypeError('tool-card-plugin: terminal arguments must contain a command');
    }
    return parsed['command'];
}
function terminalOutputText(value) {
    if (!value.startsWith('{'))
        return value;
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        return value;
    }
    const record = object(parsed);
    if (typeof record?.['stdout'] === 'string')
        return record['stdout'];
    if (typeof record?.['stderr'] === 'string' && record['stderr'].length > 0)
        return record['stderr'];
    return value;
}
function renderTool(props, parser) {
    if (props.contract !== 'tui.presentation-node.v1')
        throw new TypeError('tool-card-plugin: presentation node required');
    return projectCard({ nodeId: props.node.nodeId, kind: props.node.kind, lifecycle: props.node.lifecycle, value: props.node.value }, parser);
}
export class TuiToolCardService extends Service {
    parser;
    name = tuiToolCardName;
    disposed = false;
    constructor(ctx, parser) {
        super(ctx, tuiToolCardName);
        this.parser = parser;
        ctx.effect(() => () => this.dispose(), 'tool-card-plugin.dispose');
    }
    project(input) {
        if (this.disposed)
            throw new Error('tool-card-plugin: disposed');
        return projectCard(input, this.parser);
    }
    dispose() { this.disposed = true; }
}
const accept = (props) => props.contract === 'tui.presentation-node.v1';
function registrations(parser) {
    return ['tool.generic', 'tool.terminal', 'tool.read', 'tool.search', 'tool.diff', 'tool.workflow', 'tool.skill', 'tool.error'].map(kind => ({ groupId: 'tool.cards', kind, owner: `dsh-tui.tool-card-plugin.${kind}`, validateProps: accept, render: props => renderTool(props, parser) }));
}
export function apply(ctx) {
    const parser = ctx.tuiTextParser;
    if (!parser)
        throw new Error('tool-card-plugin: text parser plugin must be installed first');
    ctx.tuiToolCard = new TuiToolCardService(ctx, parser);
    const disposers = registrations(parser).map(registration => ctx.tuiComponentRegistry.register(ctx, registration));
    ctx.effect(() => () => { for (const dispose of disposers)
        dispose(); }, 'tool-card-plugin.registry');
}
export const _internal = { projectCard, commandSegments, commandFromArguments, diffSegments, markdownSegments };
