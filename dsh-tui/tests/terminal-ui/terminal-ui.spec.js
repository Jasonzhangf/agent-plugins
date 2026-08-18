import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { renderToString } from 'ink';
import { apply as applyRegistry } from '../../playground/experiments/component-registry/src/component-registry.ts';
import { apply as applyTerminalUi } from '../../playground/experiments/terminal-ui/src/terminal-ui.ts';
import { composeInkElement } from '../../playground/experiments/terminal-lifecycle/src/terminal-lifecycle.ts';
function install() {
    const ctx = new Context();
    applyRegistry(ctx);
    applyTerminalUi(ctx);
    return { ctx, ui: ctx.tuiTerminalUi };
}
test('registers exact terminal renderers and resolves a user cell', () => {
    const { ctx, ui } = install();
    const output = ui.renderModel({
        nodes: [{
                nodeId: 'session-1:1:conversation.user',
                kind: 'conversation.user',
                publicationRevision: 1,
                lifecycle: 'settled',
                value: { text: 'hello' },
            }],
        publicationRevision: 1,
    });
    assert.match(output, /hello/);
    assert.equal(ctx.tuiComponentRegistry.resolve('conversation.cells', 'conversation.user').owner, 'dsh-tui.terminal-ui.conversation-user');
});
test('renders streaming assistant and reasoning as distinct cells', () => {
    const { ui } = install();
    const output = ui.renderModel({
        nodes: [
            {
                nodeId: 'a1', kind: 'conversation.assistant', publicationRevision: 2, lifecycle: 'streaming',
                value: { blocks: [{ kind: 'text', text: 'answer', tokens: [{ type: 'text', value: 'answer' }] }] },
            },
            { nodeId: 'r1', kind: 'conversation.reasoning', publicationRevision: 1, lifecycle: 'streaming', value: { text: 'thinking' } },
        ],
        publicationRevision: 2,
    });
    assert.match(output, /answer/);
    assert.match(output, /thinking/);
});
test('renders tool cards with lifecycle status and keeps node identity stable', () => {
    const { ui } = install();
    const model = {
        nodes: [{
                nodeId: 'tool-1', kind: 'tool.terminal', publicationRevision: 3, lifecycle: 'streaming',
                value: { callId: 'call-1', title: 'shell', status: 'running', input: '$ pwd' },
            }],
        publicationRevision: 3,
    };
    const first = ui.renderModel(model);
    const second = ui.renderModel({
        ...model,
        publicationRevision: 4,
        nodes: [{ ...model.nodes[0], publicationRevision: 4, value: { ...model.nodes[0].value, status: 'completed', output: '/tmp' } }],
    });
    assert.match(first, /running/);
    assert.match(second, /completed/);
    assert.match(second, /tool-1/);
});
test('rejects raw event-shaped models before rendering', () => {
    const { ui } = install();
    assert.throws(() => ui.renderModel({
        nodes: [{
                nodeId: 'bad', kind: 'conversation.user', publicationRevision: 1, lifecycle: 'settled',
                value: { event: { type: 'user/message', seq: 1 } },
            }],
        publicationRevision: 1,
    }), /forbidden|event|control/i);
});
test('unknown canonical kinds fail closed without family fallback', () => {
    const { ui } = install();
    assert.throws(() => ui.renderModel({
        nodes: [{ nodeId: 'unknown', kind: 'conversation.not-real', publicationRevision: 1, lifecycle: 'settled', value: {} }],
        publicationRevision: 1,
    }), /unknown component kind|not registered/);
});
test('renders empty model with stable shell markers', () => {
    const { ui } = install();
    const output = ui.renderModel({ nodes: [], publicationRevision: 0 });
    assert.match(output, /Transcript/);
    assert.match(output, /composer.editor/);
    assert.match(output, /Session/);
});
test('composes one real Ink tree for transcript, composer, and status zones', () => {
    const { ui } = install();
    const tree = ui.composeInkTree({
        model: {
            publicationRevision: 4,
            nodes: [{
                    nodeId: 'user-1',
                    kind: 'conversation.user',
                    publicationRevision: 4,
                    lifecycle: 'settled',
                    value: { text: 'hello Ink' },
                }],
        },
        composer: { text: 'draft', cursor: 5, lines: ['draft'], cursorLine: 0, cursorColumn: 5, mode: 'idle' },
        status: { sessionId: 'session-1', cwd: '/workspace', mode: 'idle', publicationRevision: 4 },
        width: 48,
    });
    assert.equal(tree.kind, 'tui.shell');
    assert.match(renderToString(composeInkElement(tree.descriptor)), /hello Ink/);
    assert.match(renderToString(composeInkElement(tree.descriptor)), /composer\.editor/);
    assert.match(renderToString(composeInkElement(tree.descriptor)), /session-1/);
});
