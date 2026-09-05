import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../../src/experiments/interpreter-plugin/src/interpreter-plugin.ts'
import { apply as applyTextParser } from '../../src/experiments/text-parser-plugin/src/text-parser-plugin.ts'
import { apply as applyToolCard } from '../../src/experiments/tool-card-plugin/src/tool-card-plugin.ts'
import { apply as applyComponentRegistry } from '../../src/experiments/component-registry/src/component-registry.ts'

const input = (kind: string, value: Record<string, unknown>, lifecycle: 'streaming' | 'settled' = 'settled') => ({
  nodeId: 'source-1',
  publicationRevision: 1,
  kind,
  lifecycle,
  value: kind === 'conversation.assistant' && typeof value.text === 'string'
    ? { blocks: [{ kind: 'text', text: value.text, markdown: [] }] }
    : value,
}) as never

function context() {
  const ctx = new Context()
  applyComponentRegistry(ctx)
  applyTextParser(ctx)
  applyToolCard(ctx)
  apply(ctx)
  return ctx
}

test('interpreter produces structured multiline display elements', () => {
  const ctx = context()
  const element = ctx.tuiInterpreter?.interpret(input('conversation.assistant', { text: 'one\ntwo' }))
  assert.equal(element?.semanticKind, 'conversation.assistant')
  assert.deepEqual(element?.lines.map(line => line.spans[0]?.text), ['one', 'two'])
  assert.equal(element?.lifecycle, 'stable')
})

test('interpreter preserves Markdown inline code and block layout', () => {
  const ctx = context()
  const element = ctx.tuiInterpreter?.interpret(input('conversation.assistant', {
    text: 'The root `package.json` is named **dsh**.\n\n- Command: `printf OK`\n- Exit: `0`',
  }))
  assert.deepEqual(element?.lines.map(item => item.spans.map(span => span.text).join('')), [
    'The root package.json is named dsh.',
    '',
    '- Command: printf OK',
    '- Exit: 0',
  ])
  assert.deepEqual(
    element?.lines.flatMap(item => item.spans).filter(span => ['package.json', 'printf OK', '0'].includes(span.text)).map(span => span.style),
    ['tool', 'tool', 'tool'],
  )
})

test('interpreter renders headings without list markers and indents subheadings', () => {
  const ctx = context()
  const element = ctx.tuiInterpreter!.interpret(input('conversation.assistant', { text: '# Big\n\n## Small\n\n- item' }))
  const rows = element.lines.map(item => item.spans.map(span => span.text).join(''))
  assert.equal(rows.includes('Big'), true)
  assert.equal(rows.includes('  Small'), true)
  assert.equal(rows.includes('- item'), true)
  assert.equal(rows.includes('- Big'), false)
  assert.equal(rows.includes('- Small'), false)
})

test('interpreter does not synthesize list marker characters', () => {
  const ctx = context()
  const element = ctx.tuiInterpreter!.interpret(input('conversation.assistant', {
    text: '- first item\n- second item',
  }))
  assert.deepEqual(element.lines.map(item => item.spans.map(span => span.text).join('')), ['- first item', '- second item'])
})

test('interpreter indents tool body rows without indenting the leading status point', () => {
  const element = context().tuiInterpreter!.interpret(input('tool.terminal', { name: 'shell', arguments: '{"command":"printf OK\\nnext"}', result: 'ok', status: 'completed' }))
  assert.equal(element.lines[0]?.spans.length, 0)
  assert.equal(element.lines[1]?.spans[0]?.text, '● ')
  assert.equal(element.lines[1]?.spans[1]?.text, 'Ran ')
})

test('interpreter renders settled turn duration beside the dim summary divider', () => {
  const element = context().tuiInterpreter!.interpret(input('conversation.turn-tail', { text: '', durationMs: 2350 }))
  assert.equal(element.lines[0]?.spans[0]?.text.startsWith('· 2.4s '), true)
  assert.equal(element.lines[0]?.spans[0]?.style, 'dim')
})

test('interpreter maps read and shell semantics to style spans', () => {
  const ctx = context()
  const read = ctx.tuiInterpreter?.interpret(input('tool.read', { path: 'package.json', result: 'content', status: 'completed', name: 'read' }))
  const shell = ctx.tuiInterpreter?.interpret(input('tool.terminal', { arguments: 'pnpm test --watch', result: 'ok', status: 'completed', name: 'shell' }))
  const generic = ctx.tuiInterpreter?.interpret(input('tool.generic', { arguments: '{}', result: 'hidden', status: 'completed', name: 'inspect' }))
  assert.deepEqual(read?.lines.flatMap(item => item.spans.map(span => span.style)), ['green', 'blue'])
  const shellStyles = shell?.lines.flatMap(item => item.spans.map(span => span.style))
  assert.equal(shellStyles?.[0], 'green')
  assert.equal(shellStyles?.includes('red'), true)
  assert.equal(shell?.lines.flatMap(item => item.spans).some(span => span.text.includes('ok')), true)
  assert.equal(generic?.lines.flatMap(item => item.spans).some(span => span.style === 'tool'), true)
})

test('interpreter keeps body, settled thinking, and streaming thinking as distinct semantic styles', () => {
  const ctx = context()
  const body = ctx.tuiInterpreter!.interpret(input('conversation.assistant', { text: 'answer' }))
  const settled = ctx.tuiInterpreter!.interpret(input('conversation.reasoning', { text: 'reason' }))
  const streaming = ctx.tuiInterpreter!.interpret(input('conversation.reasoning', { text: 'partial' }, 'streaming'))
  assert.deepEqual(body.lines.flatMap(item => item.spans.map(span => span.style)), ['white'])
  assert.deepEqual(settled.lines.flatMap(item => item.spans.map(span => span.style)), ['thinking'])
  assert.deepEqual(streaming.lines.flatMap(item => item.spans.map(span => span.style)), ['thinking'])
  assert.equal(streaming.lifecycle, 'live')
})

test('interpreter separates adjacent assistant blocks with a blank display row', () => {
  const ctx = context()
  const element = ctx.tuiInterpreter!.interpret({
    nodeId: 'node-blocks',
    kind: 'conversation.assistant',
    publicationRevision: 1,
    lifecycle: 'settled',
    value: {
      blocks: [
        { kind: 'reasoning', text: 'thinking' },
        { kind: 'text', text: 'answer', markdown: [] },
      ],
    },
  } as never)
  assert.deepEqual(element.lines.map(item => item.spans.map(span => span.text).join('')), ['thinking', '', 'answer'])
})

test('interpreter owns tool-card vertical whitespace and preserves semantic status', () => {
  const ctx = context()
  const success = ctx.tuiInterpreter?.interpret(input('tool.terminal', {
    arguments: 'pnpm test --watch', result: 'ok', status: 'completed', name: 'shell',
  }))
  const failure = ctx.tuiInterpreter?.interpret(input('tool.terminal', {
    arguments: 'pnpm test --watch', result: 'failed', status: 'failed', name: 'shell',
  }))
  assert.equal(success?.lines[0]?.spans.length, 0)
  assert.equal(success?.lines.at(-1)?.spans.length, 0)
  assert.equal(success?.lines.some(item => item.spans.some(span => span.text.includes('Ran '))), true)
  assert.equal(success?.lines.flatMap(item => item.spans).some(span => span.style === 'green'), true)
  assert.equal(failure?.lines.flatMap(item => item.spans)[0]?.style, 'red')
})

test('interpreter rejects absent public text instead of dumping raw payload', () => {
  const ctx = context()
  assert.throws(() => ctx.tuiInterpreter?.interpret(input('conversation.assistant', { metadata: 'hidden' })), /requires public text/)
})

test('interpreter renders compaction summaries without requiring a text field', () => {
  const ctx = context()
  const element = ctx.tuiInterpreter?.interpret(input('conversation.compaction', { summary: 'Context compacted' }))
  assert.equal(element?.lines.flatMap(line => line.spans).map(span => span.text).join(''), 'Context compacted')
})

test('interpreter hides internal context and steering elements', () => {
  const ctx = context()
  assert.deepEqual(ctx.tuiInterpreter?.interpret(input('conversation.context', { text: 'internal context' })).lines, [])
  assert.deepEqual(ctx.tuiInterpreter?.interpret(input('conversation.steering', { text: 'internal steering' })).lines, [])
  assert.equal(ctx.tuiInterpreter?.interpret(input('conversation.turn-tail', { text: '' })).lines[0]?.spans[0]?.text, '────────────────────────────────')
})

test('interpreter separates user input with a prompt marker and vertical whitespace', () => {
  const ctx = context()
  const lines = ctx.tuiInterpreter?.interpret(input('conversation.user', { text: 'hello' })).lines ?? []
  assert.equal(lines.length, 3)
  assert.equal(lines[1]?.spans[0]?.text, '› hello')
  assert.equal(lines[1]?.spans[0]?.backgroundColor, 'gray')
  assert.equal(lines[0]?.spans.length, 0)
  assert.equal(lines[2]?.spans.length, 0)
})

test('interpreter consumes canonical presentation nodes without reconstructed raw payload records', () => {
  const ctx = context()
  const element = ctx.tuiInterpreter?.interpret({
    nodeId: 'node-assistant',
    kind: 'conversation.assistant',
    publicationRevision: 12,
    lifecycle: 'streaming',
    value: {
      blocks: [
        { kind: 'reasoning', text: 'Inspecting state' },
        { kind: 'text', text: 'Result is `ready`', markdown: [] },
      ],
    },
  } as never)
  assert.equal(element?.sourceId, 'node-assistant')
  assert.equal(element?.lifecycle, 'live')
  assert.equal(element?.lines[0]?.spans[0]?.style, 'thinking')
  assert.equal(element?.lines.flatMap(line => line.spans).some(span => span.text === 'ready' && span.style === 'tool'), true)
})
