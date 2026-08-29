import type { Nodes, Root, RootContent } from 'mdast'
import { Service, type Context } from '@deepseek-ai/cordis'
import katex from 'katex'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import type { MarkdownMode, MarkdownSemanticToken, TuiMarkdownTextInput, TuiTextParserFace } from '../../../../contracts/tui/text-parser-plugin/text-parser-plugin.types.ts'
export type { MarkdownMode, MarkdownSemanticToken, TuiMarkdownTextInput, TuiTextParserFace } from '../../../../contracts/tui/text-parser-plugin/text-parser-plugin.types.ts'


const cjk = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u
const punctuation = /\p{P}/u
function parse(text: string, mode: MarkdownMode): Root {
  const source = mode === 'settled' ? normalizeMathCompatibilitySource(text) : text
  const root = fromMarkdown(source, {
    extensions: mode === 'settled' ? [gfm(), math()] : [gfm()],
    mdastExtensions: mode === 'settled' ? [gfmFromMarkdown(), mathFromMarkdown()] : [gfmFromMarkdown()],
  })
  resolveReferences(root); applyCjkStrong(root); return root
}
function resolveReferences(root: Root): void {
  const definitions = new Map<string, { readonly url: string; readonly title?: string | null | undefined }>()
  visitParents(root, node => { if (node.type === 'definition') definitions.set(node.identifier, node) })
  visitParents(root, parent => {
    if (!('children' in parent)) return
    const children = parent.children as Nodes[]
    for (let index = 0; index < children.length; index += 1) {
      const node = children[index]
      if (node?.type !== 'linkReference' && node?.type !== 'imageReference') continue
      const definition = definitions.get(node.identifier); if (!definition) continue
      children[index] = node.type === 'linkReference'
        ? { type: 'link', url: definition.url, title: definition.title ?? null, children: node.children }
        : { type: 'image', url: definition.url, title: definition.title ?? null, alt: node.alt }
    }
  })
}
function normalizeMathCompatibilitySource(source: string): string {
  const lines = source.match(/.*(?:\n|$)/gu) ?? []; let fence: '`' | '~' | null = null
  return lines.map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1]
    if (marker !== undefined) { const kind = marker.charAt(0) as '`' | '~'; if (fence === null) fence = kind; else if (fence === kind) fence = null; return line }
    if (fence !== null) return line
    const inline = line.replace(/\\\(([\s\S]*?)\\\)/gu, (_match, value: string) => `$${value}$`)
    const display = inline.replace(/\\\[([\s\S]*?)\\\]/gu, (_match, value: string) => `$$\n${value}\n$$`)
    return display.replace(/^ {0,3}\$\$(\S(?:.*\S)?)\$\$\s*(\n?)$/u, (_match, value: string, newline: string) => `$$\n${value}\n$$${newline}`)
  }).join('')
}
function applyCjkStrong(root: Root): void {
  visitParents(root, parent => {
    if (!('children' in parent)) return
    const children = parent.children as Nodes[]
    for (let index = 0; index < children.length; index += 1) {
      const node = children[index]; if (node?.type !== 'text') continue
      const match = node.value.match(/^\*\*([^\n*]*\p{P})\*\*(.+)$/u)
      if (!match || !punctuation.test(match[1] ?? '') || !cjk.test((match[2] ?? '').charAt(0))) continue
      children.splice(index, 1, { type: 'strong', children: [{ type: 'text', value: match[1] ?? '' }] }, { type: 'text', value: match[2] ?? '' }); index += 1
    }
  })
}
function visitParents(node: Nodes, visitor: (node: Nodes) => void): void { visitor(node); if ('children' in node) for (const child of node.children) visitParents(child, visitor) }
function clean(value: string): string { return value.replaceAll('\t', '    ').replaceAll('\r\n', '\n') }
function encode(kind: string, ...values: readonly unknown[]): MarkdownSemanticToken { return [kind, ...values.map(value => clean(String(value)))].join('\t') }
function safeDestination(url: string): string | null { return /^(https?:|mailto:)/iu.test(url) ? url : null }
function inlineTokens(nodes: readonly Nodes[]): MarkdownSemanticToken[] {
  const tokens: MarkdownSemanticToken[] = []
  for (const node of nodes) switch (node.type) {
    case 'text': tokens.push(encode('text', node.value)); break
    case 'strong': case 'emphasis': case 'delete': tokens.push(encode(`${node.type}:start`), ...inlineTokens(node.children), encode(`${node.type}:end`)); break
    case 'inlineCode': { const value = node.value.replace(/[\t\r\n ]+/gu, ' '); tokens.push(/^https?:\/\/\S+$/iu.test(value) ? encode('inline-code-link', value) : encode('inline-code', value)); break }
    case 'inlineMath': tokens.push(encode(validMath(node.value) ? 'math:inline' : 'math:error', node.value)); break
    case 'break': tokens.push(encode('break')); break
    case 'link': { const destination = safeDestination(node.url); if (destination === null) tokens.push(...inlineTokens(node.children)); else tokens.push(encode('link:start', destination), ...inlineTokens(node.children), encode('link:end')); break }
    case 'image': { const destination = safeDestination(node.url); tokens.push(destination === null ? encode('text', node.alt ?? '') : encode('image', destination, node.alt ?? '')); break }
    case 'linkReference': case 'imageReference': tokens.push(encode('reference', node.identifier, node.type === 'imageReference' ? node.alt ?? '' : '')); break
    case 'footnoteReference': tokens.push(encode('footnote:ref', node.identifier)); break
    case 'html': tokens.push(encode('raw-html', node.value)); break
    default: if ('children' in node) tokens.push(...inlineTokens(node.children))
  }
  return tokens
}
function blockTokens(nodes: readonly RootContent[], mode: MarkdownMode, depth = 0): MarkdownSemanticToken[] {
  const tokens: MarkdownSemanticToken[] = []
  for (const node of nodes) switch (node.type) {
    case 'heading': tokens.push(encode('heading:start', node.depth), ...inlineTokens(node.children), encode('heading:end', node.depth)); break
    case 'paragraph': tokens.push(encode('paragraph:start'), ...inlineTokens(node.children), encode('paragraph:end')); break
    case 'blockquote': tokens.push(encode('blockquote:start', depth), ...blockTokens(node.children, mode, depth + 1), encode('blockquote:end', depth)); break
    case 'list': tokens.push(encode('list:start', node.ordered ? 'ordered' : 'unordered', node.start ?? 1)); for (const item of node.children) { tokens.push(encode('list-item:start', item.checked ?? 'plain')); if (!node.spread && !item.spread && item.children.length === 1 && item.children[0]?.type === 'paragraph') tokens.push(...inlineTokens(item.children[0].children)); else tokens.push(...blockTokens(item.children, mode, depth + 1)); tokens.push(encode('list-item:end')) } tokens.push(encode('list:end')); break
    case 'code': tokens.push(mode === 'settled' && node.lang === 'math' ? encode(validMath(node.value) ? 'math:display' : 'math:error', node.value) : encode('code', mode === 'settled' ? node.lang ?? '' : '', node.value)); break
    case 'math': tokens.push(encode(validMath(node.value) ? 'math:display' : 'math:error', node.value)); break
    case 'thematicBreak': tokens.push(encode('thematic-break')); break
    case 'table': tokens.push(encode('table:start', ...(node.align ?? []).map(value => value ?? 'none'))); for (const [rowIndex, row] of node.children.entries()) { tokens.push(encode('table-row:start', rowIndex === 0 ? 'header' : 'body')); for (const [cellIndex, cell] of row.children.entries()) tokens.push(encode('table-cell:start', node.align?.[cellIndex] ?? 'none'), ...inlineTokens(cell.children), encode('table-cell:end')); tokens.push(encode('table-row:end')) } tokens.push(encode('table:end')); break
    case 'footnoteDefinition': tokens.push(encode('footnote:start', node.identifier), ...blockTokens(node.children, mode, depth + 1), encode('footnote:end', node.identifier)); break
    case 'definition': break
    case 'html': tokens.push(encode('raw-html', node.value)); break
    default: if ('children' in node) tokens.push(...blockTokens(node.children as RootContent[], mode, depth))
  }
  return tokens
}
function compactTextTokens(tokens: readonly MarkdownSemanticToken[]): MarkdownSemanticToken[] { const compacted: MarkdownSemanticToken[] = []; for (const token of tokens) { if (token.startsWith('text\t') && compacted.at(-1)?.startsWith('text\t')) compacted[compacted.length - 1] = `${compacted.at(-1)}${token.slice(4)}`; else compacted.push(token) } return compacted }
function validMath(value: string): boolean { try { katex.renderToString(value, { throwOnError: true, trust: false }); return true } catch { return false } }
export function tokenizeAssistantMarkdown(text: string, mode: MarkdownMode): readonly MarkdownSemanticToken[] { return Object.freeze(compactTextTokens(blockTokens(parse(text, mode).children, mode))) }
export class IncrementalMarkdownTokenizer {
  private previous = ''; private tailStart = 0; private frozen: MarkdownSemanticToken[] = []; private currentGeneration = 0; private cached: readonly MarkdownSemanticToken[] = Object.freeze([])
  get generation(): number { return this.currentGeneration }
  update(text: string): readonly MarkdownSemanticToken[] { if (text === this.previous) return this.cached; if (!text.startsWith(this.previous)) { this.currentGeneration += 1; this.tailStart = 0; this.frozen = [] }; this.previous = text; const base = this.tailStart; const root = parse(text.slice(base), 'streaming'); let firstUnstable = Math.max(0, root.children.length - 2); if (firstUnstable > 0) { const cut = root.children[firstUnstable - 1]?.position?.end.offset; if (cut === undefined) firstUnstable = 0; else { this.frozen.push(...blockTokens(root.children.slice(0, firstUnstable), 'streaming')); this.tailStart = base + cut } }; this.cached = Object.freeze(compactTextTokens([...this.frozen, ...blockTokens(root.children.slice(firstUnstable), 'streaming')])); return this.cached }
  settle(text: string): readonly MarkdownSemanticToken[] { this.previous = ''; this.tailStart = 0; this.frozen = []; this.cached = Object.freeze([]); return tokenizeAssistantMarkdown(text, 'settled') }
}
export class TuiTextParserService extends Service implements TuiTextParserFace {
  readonly name = 'tuiTextParser' as const
  private readonly tokenizer = new IncrementalMarkdownTokenizer(); private disposed = false
  constructor(ctx: Context) { super(ctx, 'tuiTextParser'); ctx.effect(() => () => this.dispose(), 'text-parser-plugin.dispose') }
  parse(input: TuiMarkdownTextInput): readonly MarkdownSemanticToken[] { if (this.disposed) throw new Error('text-parser-plugin: disposed'); if (typeof input.text !== 'string') throw new TypeError('text-parser-plugin: text must be a string'); return tokenizeAssistantMarkdown(input.text, input.mode) }
  parseIncremental(text: string): readonly MarkdownSemanticToken[] { if (this.disposed) throw new Error('text-parser-plugin: disposed'); return this.tokenizer.update(text) }
  dispose(): void { this.disposed = true }
}
export function apply(ctx: Context): void { ctx.tuiTextParser = new TuiTextParserService(ctx) }
