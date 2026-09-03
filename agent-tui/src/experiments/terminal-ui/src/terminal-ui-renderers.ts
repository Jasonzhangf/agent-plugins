import type { Context } from '@deepseek-ai/cordis'
import type { TuiComponentProps, TuiElementDescriptor, TuiRenderOutput } from '../../../../contracts/tui/component-registry/component-registry.types.ts'

export interface TerminalUiRegistration {
  readonly groupId: string
  readonly kind: string
  readonly owner: string
  readonly validateProps: (props: TuiComponentProps) => boolean
  readonly render: (props: TuiComponentProps) => TuiRenderOutput
}

function markdownBlockDescriptors(block: { readonly text: string; readonly markdown?: readonly string[] }): TuiElementDescriptor[] {
  const tokens = Array.isArray(block.markdown) ? block.markdown : [`text\t${block.text}`]
  const children: TuiElementDescriptor[] = [{ contract: 'tui.element.v1', elementType: 'conversation.markdown.segment', props: { text: '  ', color: 'white' } }]
  let bold = false
  let emphasis = false
  let heading = false
  let link = false
  let pendingBreak = false
  for (const token of tokens) {
    const [kind, ...fields] = token.split('\t')
    if (kind === 'text') {
      const value = fields.join('\t')
      if (value.length > 0) {
        children.push({ contract: 'tui.element.v1', elementType: 'conversation.markdown.segment', props: { text: `${pendingBreak ? '\n  ' : ''}${value}`, color: link ? 'blue' : 'white', ...(bold || heading ? { bold: true } : {}), ...(emphasis ? { dimColor: true } : {}) } })
        pendingBreak = false
      }
    } else if (kind === 'heading:start') { heading = true; bold = true }
    else if (kind === 'heading:end') { heading = false; bold = false; pendingBreak = true }
    else if (kind === 'strong:start') bold = true
    else if (kind === 'strong:end') bold = false
    else if (kind === 'emphasis:start') emphasis = true
    else if (kind === 'emphasis:end') emphasis = false
    else if (kind === 'link:start') link = true
    else if (kind === 'link:end') link = false
    else if (kind === 'break') pendingBreak = true
    else if (kind === 'code') {
      const value = fields.slice(1).join('\t')
      children.push({ contract: 'tui.element.v1', elementType: 'conversation.markdown.segment', props: { text: `${pendingBreak ? '\n  ' : ''}${value}`, color: 'tool' } })
      pendingBreak = true
    }
    else if (kind === 'inline-code' || kind === 'inline-code-link') {
      children.push({ contract: 'tui.element.v1', elementType: 'conversation.markdown.segment', props: { text: `${pendingBreak ? '\n  ' : ''}${fields.join('\t')}`, color: 'tool' } })
      pendingBreak = false
    } else if (kind === 'list-item:end' || kind === 'paragraph:end' || kind === 'blockquote:end' || kind === 'table-row:end' || kind === 'thematic-break') pendingBreak = true
  }
  return children
}

function conversationUser(props: TuiComponentProps): TuiElementDescriptor {
  if (props.contract !== 'tui.presentation-node.v1') throw new TypeError('conversation.user requires presentation-node props')
  const text = typeof props.node.value['text'] === 'string' ? props.node.value['text'] : ''
  return { contract: 'tui.element.v1', elementType: 'conversation.user', props: { nodeId: props.node.nodeId, text } }
}

function conversationAssistant(props: TuiComponentProps): TuiElementDescriptor {
  if (props.contract !== 'tui.presentation-node.v1') throw new TypeError('conversation.assistant requires presentation-node props')
  const blocks = props.node.value['blocks']
  if (!Array.isArray(blocks)) throw new TypeError('conversation.assistant requires blocks')
  const textBlocks = blocks.filter((block): block is { readonly kind: 'text'; readonly text: string; readonly markdown?: readonly string[] } => (
    typeof block === 'object' && block !== null
    && (block as { readonly kind?: unknown }).kind === 'text'
    && typeof (block as { readonly text?: unknown }).text === 'string'
  ))
  return { contract: 'tui.element.v1', elementType: 'conversation.assistant', props: { nodeId: props.node.nodeId }, children: textBlocks.flatMap(markdownBlockDescriptors) }
}

function conversationReasoning(props: TuiComponentProps): TuiElementDescriptor {
  if (props.contract !== 'tui.presentation-node.v1') throw new TypeError('conversation.reasoning requires presentation-node props')
  const text = typeof props.node.value['text'] === 'string' ? props.node.value['text'] : ''
  return { contract: 'tui.element.v1', elementType: 'conversation.reasoning', props: { nodeId: props.node.nodeId, text }, collapsed: true }
}

function conversationCell(elementType: string, props: TuiComponentProps): TuiElementDescriptor {
  if (props.contract !== 'tui.presentation-node.v1') throw new TypeError(`${elementType} requires presentation-node props`)
  return { contract: 'tui.element.v1', elementType, props: { nodeId: props.node.nodeId, value: props.node.value } }
}

function errorTerminal(props: TuiComponentProps): TuiElementDescriptor {
  if (props.contract !== 'tui.presentation-node.v1') throw new TypeError('error.terminal requires presentation-node props')
  const message = typeof props.node.value['message'] === 'string' ? props.node.value['message'] : ''
  return { contract: 'tui.element.v1', elementType: 'error.terminal', props: { nodeId: props.node.nodeId, message } }
}

function statusTerminal(props: TuiComponentProps): TuiElementDescriptor {
  if (props.contract !== 'tui.presentation-node.v1') throw new TypeError('status.terminal requires presentation-node props')
  const message = typeof props.node.value['message'] === 'string' ? props.node.value['message'] : ''
  return { contract: 'tui.element.v1', elementType: 'status.terminal', props: { nodeId: props.node.nodeId, message } }
}

function accept(props: TuiComponentProps): boolean {
  return props.contract === 'tui.presentation-node.v1'
}

export const terminalUiRendererRegistrations: ReadonlyArray<TerminalUiRegistration> = [
  { groupId: 'conversation.cells', kind: 'conversation.user', owner: 'agent-tui.terminal-ui.conversation-user', validateProps: accept, render: conversationUser },
  { groupId: 'conversation.cells', kind: 'conversation.context', owner: 'agent-tui.terminal-ui.conversation-context', validateProps: accept, render: () => null },
  { groupId: 'conversation.cells', kind: 'conversation.steering', owner: 'agent-tui.terminal-ui.conversation-steering', validateProps: accept, render: props => conversationCell('conversation.steering', props) },
  { groupId: 'conversation.cells', kind: 'conversation.assistant', owner: 'agent-tui.terminal-ui.conversation-assistant', validateProps: accept, render: conversationAssistant },
  { groupId: 'conversation.cells', kind: 'conversation.reasoning', owner: 'agent-tui.terminal-ui.conversation-reasoning', validateProps: accept, render: conversationReasoning },
  { groupId: 'conversation.cells', kind: 'conversation.command', owner: 'agent-tui.terminal-ui.conversation-command', validateProps: accept, render: props => conversationCell('conversation.command', props) },
  { groupId: 'conversation.cells', kind: 'conversation.compaction', owner: 'agent-tui.terminal-ui.conversation-compaction', validateProps: accept, render: props => conversationCell('conversation.compaction', props) },
  { groupId: 'conversation.cells', kind: 'conversation.retry', owner: 'agent-tui.terminal-ui.conversation-retry', validateProps: accept, render: props => conversationCell('conversation.retry', props) },
  { groupId: 'conversation.cells', kind: 'conversation.turn-error', owner: 'agent-tui.terminal-ui.error-terminal', validateProps: accept, render: errorTerminal },
  { groupId: 'conversation.cells', kind: 'conversation.max-tokens', owner: 'agent-tui.terminal-ui.max-tokens', validateProps: accept, render: errorTerminal },
  { groupId: 'conversation.cells', kind: 'conversation.turn-tail', owner: 'agent-tui.terminal-ui.turn-tail', validateProps: accept, render: props => conversationCell('conversation.turn-tail', props) },
  { groupId: 'conversation.cells', kind: 'conversation.unknown', owner: 'agent-tui.terminal-ui.unknown', validateProps: accept, render: props => conversationCell('conversation.unknown', props) },
  { groupId: 'status.items', kind: 'status.session', owner: 'agent-tui.terminal-ui.status-terminal', validateProps: accept, render: statusTerminal },
]

export function installTerminalUiRenderers(ctx: Context): () => void {
  const disposers: Array<() => void> = []
  for (const registration of terminalUiRendererRegistrations) disposers.push(ctx.tuiComponentRegistry.register(ctx, registration) as () => void)
  return () => {
    while (disposers.length > 0) disposers.pop()?.()
  }
}
