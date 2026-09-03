import { Service, type Context } from '@deepseek-ai/cordis'
import type { TuiDisplayElement, TuiDisplayLine, TuiDisplaySpan, TuiInterpreterFace } from '../../../../contracts/tui/interpreter-plugin/interpreter-plugin.types.ts'
import type { MarkdownSemanticToken } from '../../../../contracts/tui/text-parser-plugin/text-parser-plugin.types.ts'
import type { TuiElementDescriptor } from '../../../../contracts/tui/component-registry/component-registry.types.ts'
import type { TuiToolCardFace } from '../../../../contracts/tui/tool-card-plugin/tool-card-plugin.types.ts'
import type { TuiAssistantBlock, TuiViewNodeAny } from '../../../../contracts/tui/presentation/presentation.types.ts'

function textFromValue(node: TuiViewNodeAny): string {
  const value = node.value as Readonly<Record<string, unknown>>
  const text = value.text ?? value.message ?? value.output ?? value.result ?? value.summary ?? value.command
  if (typeof text !== 'string') throw new TypeError(`interpreter-plugin: ${node.kind} requires public text`)
  return text
}

function line(text: string, style: TuiDisplaySpan['style'] = 'white'): TuiDisplayLine {
  return Object.freeze({ spans: Object.freeze([Object.freeze({ text, style })]) })
}

function descriptorStyle(value: unknown): TuiDisplaySpan['style'] {
  if (value === 'tool' || value === 'thinking' || value === 'blue' || value === 'red' || value === 'green' || value === 'dim') return value
  return 'white'
}

function descriptorSpans(descriptor: TuiElementDescriptor, output: TuiDisplaySpan[]): void {
  const props = descriptor.props
  if (props && typeof props['text'] === 'string') {
    output.push(Object.freeze({
      text: props['text'],
      style: props['dimColor'] === true ? 'dim' : descriptorStyle(props['color']),
    }))
  }
  for (const child of descriptor.children ?? []) descriptorSpans(child, output)
}

function descriptorLines(descriptor: TuiElementDescriptor): readonly TuiDisplayLine[] {
  const spans: TuiDisplaySpan[] = []
  descriptorSpans(descriptor, spans)
  const lines: TuiDisplayLine[] = []
  let current: TuiDisplaySpan[] = []
  for (const span of spans) {
    const parts = span.text.split('\n')
    for (const [index, part] of parts.entries()) {
      if (part.length > 0) current.push(Object.freeze({ text: part, style: span.style }))
      if (index < parts.length - 1) {
        lines.push(Object.freeze({ spans: Object.freeze(current) }))
        current = []
      }
    }
  }
  if (current.length > 0 || lines.length === 0) lines.push(Object.freeze({ spans: Object.freeze(current) }))
  return Object.freeze(lines)
}

function withCardWhitespace(lines: readonly TuiDisplayLine[]): readonly TuiDisplayLine[] {
  const indented = lines.map((item, index) => {
    if (index === 0 || item.spans.length === 0) return item
    const first = item.spans[0]!
    return Object.freeze({ spans: Object.freeze([Object.freeze({ text: `  ${first.text}`, style: 'white' as const }), ...item.spans.slice(1)]) })
  })
  return Object.freeze([
    Object.freeze({ spans: Object.freeze([]) }),
    ...indented,
    Object.freeze({ spans: Object.freeze([]) }),
  ])
}

function markdownLines(tokens: readonly MarkdownSemanticToken[], baseStyle: TuiDisplaySpan['style']): readonly TuiDisplayLine[] {
  const lines: TuiDisplayLine[] = []
  let current: TuiDisplaySpan[] = []
  let emphasisDepth = 0
  let linkDepth = 0
  const pushLine = (): void => {
    lines.push(Object.freeze({ spans: Object.freeze(current) }))
    current = []
  }
  const append = (text: string, style = baseStyle): void => {
    for (const [index, part] of text.split('\n').entries()) {
      if (part.length > 0) {
        const effectiveStyle = baseStyle === 'thinking' ? 'thinking' : baseStyle === 'dim' ? 'dim' : linkDepth > 0 ? 'blue' : emphasisDepth > 0 ? 'dim' : style
        const previous = current.at(-1)
        if (previous?.style === effectiveStyle) current[current.length - 1] = Object.freeze({ text: previous.text + part, style: effectiveStyle })
        else current.push(Object.freeze({ text: part, style: effectiveStyle }))
      }
      if (index < text.split('\n').length - 1) pushLine()
    }
  }
  const separateBlocks = (): void => {
    if (current.length > 0) pushLine()
    if (lines.length > 0 && lines.at(-1)?.spans.length !== 0) pushLine()
  }

  for (const token of tokens) {
    const [kind, ...fields] = token.split('\t')
    if (kind === 'text') append(fields.join('\t'))
    else if (kind === 'inline-code' || kind === 'inline-code-link') append(fields.join('\t'), 'tool')
    else if (kind === 'code') {
      separateBlocks()
      append(fields.slice(1).join('\t'), 'tool')
      separateBlocks()
    } else if (kind === 'math:inline' || kind === 'math:error') append(fields.join('\t'), 'tool')
    else if (kind === 'math:display') {
      separateBlocks()
      append(fields.join('\t'), 'tool')
      separateBlocks()
    } else if (kind === 'link:start') linkDepth += 1
    else if (kind === 'link:end') linkDepth = Math.max(0, linkDepth - 1)
    else if (kind === 'emphasis:start' || kind === 'delete:start') emphasisDepth += 1
    else if (kind === 'emphasis:end' || kind === 'delete:end') emphasisDepth = Math.max(0, emphasisDepth - 1)
    else if (kind === 'break') pushLine()
    else if (kind === 'heading:start') {
      const depth = Number(fields[0] ?? '1')
      if (Number.isSafeInteger(depth) && depth > 1) append('  ', 'white')
    } else if (kind === 'heading:end') {
      separateBlocks()
    } else if (kind === 'paragraph:end' || kind === 'blockquote:end' || kind === 'footnote:end') separateBlocks()
    else if (kind === 'blockquote:start') append('│ ', 'dim')
    else if (kind === 'list-item:start') {
      if (current.length > 0) pushLine()
      append('- ', 'white')
    } else if (kind === 'list-item:end') {
      if (current.length > 0) pushLine()
    } else if (kind === 'list:end') {
      if (lines.length > 0 && lines.at(-1)?.spans.length !== 0) pushLine()
    } else if (kind === 'table-cell:start') {
      if (current.length > 0) append(' │ ', 'dim')
    } else if (kind === 'table-row:end') pushLine()
    else if (kind === 'thematic-break') {
      separateBlocks()
      append('────────────────────────────────', 'dim')
      separateBlocks()
    } else if (kind === 'image') append(fields[1] || fields[0] || '', 'blue')
    else if (kind === 'reference') append(fields[1] || fields[0] || '')
    else if (kind === 'footnote:ref') append(`[${fields[0] ?? ''}]`, 'blue')
    else if (kind === 'raw-html') append(fields.join('\t'), 'dim')
  }
  if (current.length > 0 || lines.length === 0) pushLine()
  while (lines.length > 1 && lines.at(-1)?.spans.length === 0) lines.pop()
  return Object.freeze(lines)
}

function decorateUserLines(lines: readonly TuiDisplayLine[]): readonly TuiDisplayLine[] {
  const first = lines[0] ?? line('', 'white')
  const firstSpan = first.spans[0]
  const decoratedFirst = Object.freeze({
    spans: Object.freeze([
      Object.freeze({ text: `› ${firstSpan?.text ?? ''}`, style: firstSpan?.style ?? 'white', backgroundColor: 'gray' as const }),
      ...(firstSpan === undefined ? [] : first.spans.slice(1)),
    ]),
  })
  return Object.freeze([
    Object.freeze({ spans: Object.freeze([]) }),
    decoratedFirst,
    ...lines.slice(1),
    Object.freeze({ spans: Object.freeze([]) }),
  ])
}

export class TuiInterpreterService extends Service implements TuiInterpreterFace {
  readonly name = 'tuiInterpreter' as const
  private disposed = false
  constructor(private readonly context: Context) { super(context, 'tuiInterpreter'); context.effect(() => () => this.dispose(), 'interpreter-plugin.dispose') }
  interpret(node: TuiViewNodeAny): TuiDisplayElement {
    if (this.disposed) throw new Error('interpreter-plugin: disposed')
    if (node.kind === 'conversation.context' || node.kind === 'conversation.steering') {
      return Object.freeze({ elementId: node.nodeId, sourceId: node.nodeId, semanticKind: node.kind, lifecycle: node.lifecycle === 'streaming' ? 'live' : 'stable', lines: Object.freeze([]) })
    }
    if (node.kind === 'conversation.turn-tail') {
      const value = node.value as { readonly durationMs?: number }
      const duration = typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)
        ? ` ${(value.durationMs / 1000).toFixed(1)}s`
        : ''
      const summary = duration.length > 0 ? `·${duration} ────────────────────────────────` : '────────────────────────────────'
      return Object.freeze({
        elementId: node.nodeId,
        sourceId: node.nodeId,
        semanticKind: node.kind,
        lifecycle: node.lifecycle === 'streaming' ? 'live' : 'stable',
        lines: Object.freeze([line(summary, 'dim')]),
      })
    }
    let lines: readonly TuiDisplayLine[]
    if (node.kind.startsWith('tool.')) {
      const toolCard: TuiToolCardFace | undefined = this.context.tuiToolCard
      if (toolCard === undefined) throw new Error('interpreter-plugin: tool-card plugin is required for tool elements')
      lines = withCardWhitespace(descriptorLines(toolCard.project({ nodeId: node.nodeId, kind: node.kind, lifecycle: node.lifecycle, value: node.value })))
    } else if (node.kind === 'conversation.assistant') {
      const blocks = (node.value as { readonly blocks?: readonly TuiAssistantBlock[] }).blocks
      if (!Array.isArray(blocks)) throw new TypeError('interpreter-plugin: conversation.assistant requires public text blocks')
      lines = this.assistantLines(blocks, node.lifecycle)
    } else {
      const parser = this.context.tuiTextParser
      if (parser === undefined) throw new Error('interpreter-plugin: text parser plugin is required for text elements')
      const tokens = parser.parse({ text: textFromValue(node), mode: node.lifecycle === 'streaming' ? 'streaming' : 'settled' })
      const parsedLines = markdownLines(tokens, node.kind === 'conversation.reasoning' ? 'thinking' : 'white')
      lines = node.kind === 'conversation.user' ? decorateUserLines(parsedLines) : parsedLines
    }
    return Object.freeze({ elementId: node.nodeId, sourceId: node.nodeId, semanticKind: node.kind, lifecycle: node.lifecycle === 'streaming' ? 'live' : 'stable', lines })
  }
  private assistantLines(blocks: readonly TuiAssistantBlock[], lifecycle: TuiViewNodeAny['lifecycle']): readonly TuiDisplayLine[] {
    const parser = this.context.tuiTextParser
    if (parser === undefined) throw new Error('interpreter-plugin: text parser plugin is required for text elements')
    const lines: TuiDisplayLine[] = []
    for (const block of blocks) {
      if (block.text.length === 0) continue
      if (lines.length > 0 && lines.at(-1)?.spans.length !== 0) {
        lines.push(Object.freeze({ spans: Object.freeze([]) }))
      }
      const tokens = parser.parse({ text: block.text, mode: lifecycle === 'streaming' ? 'streaming' : 'settled' })
      lines.push(...markdownLines(tokens, block.kind === 'reasoning' ? 'thinking' : 'white'))
    }
    if (lines.length === 0) throw new TypeError('interpreter-plugin: conversation.assistant requires public text blocks')
    return Object.freeze(lines)
  }
  dispose(): void { this.disposed = true }
}

export function apply(ctx: Context): void { ctx.tuiInterpreter = new TuiInterpreterService(ctx) }
