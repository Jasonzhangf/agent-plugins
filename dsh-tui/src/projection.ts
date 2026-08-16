/**
 * Terminal-neutral projection: derive the canonical transcript from a live
 * Agent and Session, parse Markdown in the Node host, and emit projection
 * windows over the four-channel bridge. Rust never parses Markdown.
 * @module dsh-tui/projection
 */

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import type {
  AssistantMessage, Message, TextBlock, ToolCallBlock, ToolResultBlock, ReasoningBlock,
} from '@deepseek-ai/dsh-llm'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { Cell, HostProjectionRecord, Line, View } from './protocol.js'

export interface AgentProjection {
  readonly status: AgentStatus
  readonly model: string
  readonly provider: string
  readonly sessionId: string
}

export interface ProjectionSnapshot {
  readonly agent: AgentProjection
  readonly cells: readonly Cell[]
}

/** Convert plain text into terminal display lines. */
function plainLines(text: string, style?: Line['style']): Line[] {
  const out: Line[] = []
  for (const part of text.split('\n')) out.push({ text: part, style })
  return out
}

/** Render the supported GFM block nodes into terminal-neutral lines. */
function mdastLines(markdown: string): Line[] {
  if (markdown.trim() === '') return []
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  } as never)
  const lines: Line[] = []
  const walk = (node: any, indent: number): void => {
    switch (node.type) {
      case 'heading': {
        lines.push({ text: '#'.repeat(node.depth ?? 1) + ' ' + mdastText(node), style: 'bold' })
        break
      }
      case 'paragraph': {
        lines.push({ text: ' '.repeat(indent) + mdastText(node) })
        break
      }
      case 'code': {
        for (const part of String(node.value ?? '').split('\n')) lines.push({ text: '  ' + part, style: 'code' })
        break
      }
      case 'list': {
        const ordered = node.ordered === true
        const items = (node.children as any[]) ?? []
        items.forEach((item, index) => {
          if (item.type !== 'listItem') throw new Error(`unsupported Markdown list child: ${String(item.type)}`)
          const marker = ordered ? `${index + 1}. ` : '- '
          const children = (item.children as any[]) ?? []
          const first = children.shift()
          if (first?.type !== 'paragraph') throw new Error(`unsupported Markdown list item: ${String(first?.type)}`)
          lines.push({ text: ' '.repeat(indent) + marker + mdastText(first), style: 'dim' })
          for (const child of children) walk(child, indent + 2)
        })
        break
      }
      case 'blockquote': {
        for (const child of (node.children as any[]) ?? []) {
          const before = lines.length
          walk(child, indent)
          for (let index = before; index < lines.length; index += 1) {
            lines[index] = { ...lines[index], text: `> ${lines[index].text}`, style: 'dim' }
          }
        }
        break
      }
      case 'table': {
        for (const row of (node.children as any[]) ?? []) {
          if (row.type !== 'tableRow') throw new Error(`unsupported Markdown table child: ${String(row.type)}`)
          const cells = ((row.children as any[]) ?? []).map(cell => {
            if (cell.type !== 'tableCell') throw new Error(`unsupported Markdown table cell: ${String(cell.type)}`)
            return mdastText(cell)
          })
          lines.push({ text: cells.join(' | '), style: 'dim' })
        }
        break
      }
      case 'thematicBreak': {
        lines.push({ text: '---', style: 'dim' })
        break
      }
      case 'html': {
        lines.push({ text: String(node.value ?? ''), style: 'code' })
        break
      }
      default:
        throw new Error(`unsupported Markdown block: ${String(node.type)}`)
    }
  }
  for (const child of (tree as unknown as { children: any[] }).children) walk(child, 0)
  return lines
}

function mdastText(node: any): string {
  switch (node?.type) {
    case 'text':
    case 'inlineCode':
    case 'html':
      return String(node.value ?? '')
    case 'break':
      return '\n'
    case 'image':
    case 'imageReference':
      return String(node.alt ?? '')
    case 'paragraph':
    case 'heading':
    case 'emphasis':
    case 'strong':
    case 'delete':
    case 'link':
    case 'linkReference':
    case 'tableCell':
      if (!Array.isArray(node.children)) throw new Error(`Markdown ${String(node.type)} requires children`)
      return node.children.map((child: any) => mdastText(child)).join('')
    default:
      throw new Error(`unsupported Markdown inline node: ${String(node?.type)}`)
  }
}

/** Project a single message into cells. */
function cellsForMessage(message: Message): Cell[] {
  const id = String(message.id)
  if (message.role === 'user') {
    return [{ id, kind: 'user', lines: plainLines(extractText(message), 'bold') }]
  }
  const assistant = message as AssistantMessage
  const cells: Cell[] = []
  let textIndex = 0
  let reasonIndex = 0
  for (const block of assistant.content) {
    switch (block.type) {
      case 'text': {
        const tb = block as TextBlock
        if (tb.text === '') continue
        cells.push({ id: `${id}:text:${textIndex++}`, kind: 'assistant_text', lines: mdastLines(tb.text) })
        break
      }
      case 'reasoning': {
        const rb = block as ReasoningBlock
        if (rb.text === '') continue
        cells.push({ id: `${id}:reason:${reasonIndex++}`, kind: 'assistant_reasoning', lines: plainLines(rb.text, 'dim') })
        break
      }
      case 'tool-call': {
        const tc = block as ToolCallBlock
        cells.push({
          id: `${id}:tool:${tc.id}`,
          kind: 'tool_call',
          lines: [
            { text: `tool ${tc.name}`, style: 'accent' },
            ...mdastLines(`\`\`\`json\n${tc.arguments}\n\`\`\``),
          ],
        })
        break
      }
      case 'tool-result': {
        const tr = block as ToolResultBlock
        const resultText = tr.content.map(resultBlock => {
          if (resultBlock.type !== 'text') {
            throw new Error(`unsupported tool result block: ${String((resultBlock as { type?: unknown }).type)}`)
          }
          return (resultBlock as TextBlock).text
        }).join('\n')
        cells.push({
          id: `${id}:result:${tr.toolCallId}`,
          kind: 'tool_result',
          lines: mdastLines(resultText),
        })
        break
      }
      default:
        throw new Error(`unsupported assistant content block: ${String((block as { type?: unknown }).type)}`)
    }
  }
  return cells
}

function extractText(message: Message): string {
  return message.content.map(block => {
    if (block.type === 'text') return (block as TextBlock).text
    throw new Error(`unsupported user content block: ${String((block as { type?: unknown }).type)}`)
  }).join('\n')
}

/** Build a stable projection snapshot from one Agent and its Session. */
export function projectSession(agent: Agent): ProjectionSnapshot {
  const session: Session = agent.session
  const messages: Message[] = session.deriveMessages()
  const cells: Cell[] = []
  for (const message of messages) cells.push(...cellsForMessage(message))
  const liveText = liveTextDelta(session)
  if (liveText !== '') {
    cells.push({ id: 'live:chunk', kind: 'assistant_text', lines: plainLines(liveText, 'dim') })
  }
  const model = (agent.options as { provider?: string; model?: string })
  if (model.provider === undefined || model.model === undefined) {
    throw new Error('agent projection requires provider and model')
  }
  const projection: AgentProjection = {
    status: agent.status,
    provider: model.provider,
    model: model.model,
    sessionId: String(agent.id),
  }
  return { agent: projection, cells }
}

function liveTextDelta(session: Session): string {
  let start = 0
  for (const event of session.events) {
    if (event.type === 'assistant/message') start = event.seq + 1
  }
  const parts: string[] = []
  for (const event of session.events) {
    if (event.seq < start) continue
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') parts.push(event.data.chunk.text)
  }
  return parts.join('')
}

/** Build a single-window record carrying the canonical snapshot. */
export function buildProjectionWindow(seed: number, snapshot: ProjectionSnapshot, index: number): HostProjectionRecord {
  return {
    protocolVersion: 1,
    type: 'projection_window',
    publicationRevision: seed,
    index,
    cells: [...snapshot.cells],
    views: [{ id: 'agent_status', payload: snapshot.agent as unknown as Record<string, unknown> }],
  }
}

/** Coalesce projection changes into a single publication sequence. */
export function publishPublication(snapshot: ProjectionSnapshot): readonly HostProjectionRecord[] {
  const seed = nextPublicationRevision()
  const window = buildProjectionWindow(seed, snapshot, 0)
  const commit: HostProjectionRecord = {
    protocolVersion: 1,
    type: 'projection_commit',
    publicationRevision: seed,
    totalWindows: 1,
  }
  return [window, commit]
}

let currentPublicationRevision = 0
function nextPublicationRevision(): number {
  if (currentPublicationRevision === Number.MAX_SAFE_INTEGER) throw new Error('publication revision exhausted')
  currentPublicationRevision += 1
  return currentPublicationRevision
}

export { mdastLines as markdownLines }
