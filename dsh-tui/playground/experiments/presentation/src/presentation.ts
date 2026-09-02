import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools/presentation'
import type { TuiHistoryEntry as HistoryEntry, TuiToolEventView as ToolEventView } from '../../../../contracts/tui/session/history-entry.types.ts'
import { IncrementalMarkdownTokenizer, tokenizeAssistantMarkdown } from './markdown.ts'
import { createNode } from './model.ts'
import type {
  TuiAssistantBlock,
  TuiPresentationModel,
  TuiToolNodeValue,
  TuiViewNodeAny,
} from './model.ts'

export type {
  TuiAssistantBlock,
  TuiNodeLifecycle,
  TuiPresentationModel,
  TuiToolNodeValue,
  TuiViewNode,
  TuiViewNodeAny,
  TuiViewNodeKind,
  TuiViewNodeMap,
} from './model.ts'

export const tuiPresentationServiceName = 'tuiPresentation' as const

export interface TuiPresentationSessionInput {
  readonly sessionId: string
  readonly lastSeq: number
  readonly entries: readonly HistoryEntry[]
}


const KNOWN_EVENT_TYPES = new Set([
  'agent-preset/selected',
  'agent/inbox/spliced',
  'approval/asked',
  'approval/decided',
  'approval/policy',
  'assistant/chunk',
  'assistant/message',
  'command/done',
  'command/run',
  'compaction/end',
  'compaction/prune',
  'compaction/start',
  'compaction/summary',
  'feedback/record',
  'goal/change',
  'hook/invoked',
  'hook/result',
  'llm/retry',
  'llm/retry-started',
  'permission/preset',
  'plan/mode',
  'request/context',
  'request/header',
  'sandbox/mode',
  'schedule/change',
  'session/end-seed',
  'session/title',
  'session/title-llm-request',
  'step/end',
  'step/start',
  'subagent/descriptor',
  'todo/write',
  'tool-workflow/agent-end',
  'tool-workflow/agent-start',
  'tool-workflow/run-end',
  'tool-workflow/run-start',
  'tool/call',
  'tool/code-dispatch',
  'tool/code-dispatch-start',
  'tool/result',
  'turn/end',
  'turn/start',
  'user/message',
  'web/deepseek-search-llm-request',
])

interface AssistantStreamState {
  readonly nodeId: string
  readonly turnId: number
  readonly stepId: number
  readonly blocks: ReadonlyMap<number, TuiAssistantBlock>
  readonly markdown: ReadonlyMap<number, IncrementalMarkdownTokenizer>
  readonly lastSeq: number
}

interface ToolStreamState {
  readonly nodeId: string
  readonly turnId?: number
  readonly stepId?: number
  readonly name: string
  readonly arguments: string
  readonly status: 'pending' | 'running' | 'completed' | 'failed'
  readonly result?: string
  readonly error?: string
  readonly callRenderIntent?: ToolCallView
  readonly resultRenderIntent?: ToolResultView
  readonly lastSeq: number
}

type TuiToolKind = 'tool.generic' | 'tool.terminal' | 'tool.read' | 'tool.search' | 'tool.diff' | 'tool.skill'

function toolKind(callView?: ToolCallView, resultView?: ToolResultView, name?: string): TuiToolKind {
  const card = resultView?.card ?? callView?.card
  if (card === 'terminal') return 'tool.terminal'
  if (card === 'diff') return 'tool.diff'
  if (card === 'read') return 'tool.read'
  if (card === 'search') return 'tool.search'
  if (callView?.card === 'generic' && callView.kind === 'read') return 'tool.read'
  if (callView?.card === 'generic' && callView.kind === 'search') return 'tool.search'
  if (name === 'skill') return 'tool.skill'
  return 'tool.generic'
}

function toolKindForName(name: string): TuiToolKind {
  if (name === 'skill') return 'tool.skill'
  if (name === 'bash' || name === 'shell' || name === 'execute') return 'tool.terminal'
  if (name === 'read' || name === 'read_file') return 'tool.read'
  if (name === 'grep' || name === 'glob' || name === 'search') return 'tool.search'
  if (name === 'edit' || name === 'str_replace_editor' || name === 'write') return 'tool.diff'
  return 'tool.generic'
}

interface CompactionState {
  readonly nodeId: string
  readonly summary: string
  readonly lastSeq: number
}

interface TuiRawSessionEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: Record<string, any>
}

interface ProjectorState {
  readonly sessionId: string
  nodes: TuiViewNodeAny[]
  assistants: Map<string, AssistantStreamState>
  tools: Map<string, ToolStreamState>
  suppressedTools: Set<string>
  compaction: CompactionState | null
  turn: { readonly turn: number; readonly running: boolean; readonly lastSeq: number; readonly startedAt?: number } | null
  revision: number
}

function initialProjectorState(sessionId: string): ProjectorState {
  return {
    sessionId,
    nodes: [],
    assistants: new Map(),
    tools: new Map(),
    suppressedTools: new Set(),
    compaction: null,
    turn: null,
    revision: 0,
  }
}

function upsertNode(state: ProjectorState, candidate: TuiViewNodeAny): void {
  const index = state.nodes.findIndex(existing => existing.nodeId === candidate.nodeId)
  if (index === -1) {
    state.nodes.push(candidate)
    return
  }
  state.nodes[index] = candidate
}

function textFromContent(content: readonly { readonly type: string; readonly text?: string }[]): string {
  return content.map(block => {
    if (block.type === 'text' && typeof block.text === 'string') return block.text
    if (block.type === 'image') {
      const image = block as { readonly name?: unknown; readonly mediaType?: unknown }
      const name = typeof image.name === 'string' && image.name.length > 0 ? image.name : 'image'
      const mediaType = typeof image.mediaType === 'string' ? image.mediaType : 'image'
      return `[attachment: ${name} · ${mediaType}]`
    }
    return ''
  }).filter(text => text.length > 0).join('\n')
}

function toolResultTextFromContent(content: readonly unknown[]): string {
  const texts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object' || Array.isArray(block)) continue
    const record = block as { readonly type?: unknown; readonly text?: unknown; readonly content?: unknown }
    if (record.type === 'text' && typeof record.text === 'string') texts.push(record.text)
    if (record.type === 'tool-result' && Array.isArray(record.content)) {
      const nested = toolResultTextFromContent(record.content)
      if (nested.length > 0) texts.push(nested)
    }
  }
  return texts.join('\n')
}

function turnErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error
  if (error !== null && typeof error === 'object') {
    const record = error as { readonly message?: unknown; readonly failure?: unknown }
    if (typeof record.message === 'string' && record.message.length > 0) return record.message
    if (typeof record.failure === 'string' && record.failure.length > 0) return record.failure
    if (record.failure !== null && typeof record.failure === 'object') {
      const failure = record.failure as { readonly message?: unknown }
      if (typeof failure.message === 'string' && failure.message.length > 0) return failure.message
    }
  }
  return 'turn failed'
}

function assistantTextBlock(text: string, mode: 'streaming' | 'settled'): TuiAssistantBlock {
  return { kind: 'text', text, markdown: tokenizeAssistantMarkdown(text, mode) }
}

function blocksFromContent(content: readonly { readonly type: string; readonly text?: string }[]): TuiAssistantBlock[] {
  const blocks: TuiAssistantBlock[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      blocks.push(assistantTextBlock(block.text, 'settled'))
    } else if (block.type === 'reasoning' && typeof block.text === 'string') {
      blocks.push({ kind: 'reasoning', text: block.text })
    }
  }
  return blocks
}

function isToolOrchestrationText(value: string): boolean {
  return /\btools\.[A-Za-z_$][\w$]*\s*\(/u.test(value)
    || /(?:调用工具|执行用户指定的基础 shell 命令|工具调用)/u.test(value)
    || /\b(?:const|let|var)\s+\w+\s*=|\bJSON\.stringify\s*\(|\bconsole\.log\s*\(|^\s*await\b|\b(?:exitCode|timeoutMs|sandbox|stderr|stdout)\b/mu.test(value)
}

function visibleAssistantBlocks(blocks: readonly TuiAssistantBlock[]): TuiAssistantBlock[] {
  return blocks.filter(block => block.kind !== 'text' || !isToolOrchestrationText(block.text))
}

export function projectSession(input: TuiPresentationSessionInput): TuiPresentationModel {
  const state = initialProjectorState(input.sessionId)
  for (const entry of input.entries) {
    const event = entry.event
    state.revision = Math.max(state.revision, event.seq)
    projectEntry(state, entry)
  }
  return modelFromProjectorState(state, input.lastSeq)
}

function modelFromProjectorState(state: ProjectorState, publicationRevision: number): TuiPresentationModel {
  return Object.freeze({
    nodes: Object.freeze([...state.nodes]),
    publicationRevision,
  })
}

function projectEntry(state: ProjectorState, entry: HistoryEntry): void {
  projectRawEvent(state, entry.event as unknown as TuiRawSessionEvent, entry.view)
}

function projectRawEvent(state: ProjectorState, event: TuiRawSessionEvent, toolView?: ToolEventView): void {
  const seq = event.seq
  switch (event.type) {
    case 'user/message': {
      const source = event.data.source as { readonly kind?: unknown } | undefined
      const sourceKind = typeof source === 'object' && source !== null ? source.kind : undefined
      const kind = sourceKind === 'plugin'
        ? 'conversation.context'
        : sourceKind === 'user'
          ? 'conversation.user'
          : 'conversation.steering'
      state.nodes.push(createNode(state.sessionId, kind, seq, 'settled', {
        text: textFromContent(event.data.content as readonly { readonly type: string; readonly text?: string }[]),
      }, { timestamp: event.time }))
      return
    }
    case 'assistant/chunk': {
      const turn = event.data.turn as number
      const step = event.data.step as number
      const key = `${turn}:${step}`
      const existing = state.assistants.get(key)
      const current = existing ?? {
        nodeId: `${state.sessionId}:assistant:${turn}:${step}`,
        turnId: turn,
        stepId: step,
        blocks: new Map<number, TuiAssistantBlock>(),
        markdown: new Map<number, IncrementalMarkdownTokenizer>(),
        lastSeq: -1,
      }
      const chunk = event.data.chunk as {
        readonly type: string
        readonly index?: number
        readonly blockType?: string
        readonly text?: string
        readonly block?: { readonly type: string; readonly text?: string }
      }
      const blocks = new Map(current.blocks)
      const markdown = new Map(current.markdown)
      if (chunk.index !== undefined && chunk.type === 'block-start') {
        if (chunk.blockType === 'text') {
          const tokenizer = new IncrementalMarkdownTokenizer()
          markdown.set(chunk.index, tokenizer)
          blocks.set(chunk.index, { kind: 'text', text: '', markdown: tokenizer.update('') })
        }
        if (chunk.blockType === 'reasoning') blocks.set(chunk.index, { kind: 'reasoning', text: '' })
      }
      if (chunk.index !== undefined && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        const previous = blocks.get(chunk.index)
        const text = previous?.kind === 'text' ? previous.text + chunk.text : chunk.text
        const tokenizer = markdown.get(chunk.index) ?? new IncrementalMarkdownTokenizer()
        markdown.set(chunk.index, tokenizer)
        blocks.set(chunk.index, { kind: 'text', text, markdown: tokenizer.update(text) })
      }
      if (chunk.index !== undefined && chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
        const previous = blocks.get(chunk.index)
        blocks.set(chunk.index, { kind: 'reasoning', text: previous?.kind === 'reasoning' ? previous.text + chunk.text : chunk.text })
      }
      if (chunk.index !== undefined && chunk.type === 'block-end' && chunk.block?.type === 'text') {
        const text = chunk.block.text ?? ''
        const tokenizer = markdown.get(chunk.index) ?? new IncrementalMarkdownTokenizer()
        markdown.set(chunk.index, tokenizer)
        blocks.set(chunk.index, { kind: 'text', text, markdown: tokenizer.update(text) })
      }
      if (chunk.index !== undefined && chunk.type === 'block-end' && chunk.block?.type === 'reasoning') {
        blocks.set(chunk.index, { kind: 'reasoning', text: chunk.block.text ?? '' })
      }
      const updated: AssistantStreamState = { ...current, blocks, markdown, lastSeq: seq }
      state.assistants.set(key, updated)
      const visibleBlocks = visibleAssistantBlocks([...blocks.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, block]) => block)
        .filter(block => block.text.length > 0))
      if (visibleBlocks.length === 0) {
        state.nodes = state.nodes.filter(node => node.nodeId !== updated.nodeId)
        return
      }
      upsertNode(state, createNode(state.sessionId, 'conversation.assistant', seq, 'streaming', {
        blocks: visibleBlocks,
      }, { nodeId: updated.nodeId, turnId: updated.turnId, stepId: updated.stepId, timestamp: event.time }))
      return
    }
    case 'assistant/message': {
      const turn = event.data.turn as number
      const step = event.data.step as number
      const key = `${turn}:${step}`
      const streaming = state.assistants.get(key)
      const assistantNodeId = streaming?.nodeId ?? `${state.sessionId}:assistant:${turn}:${step}`
      if (streaming) state.assistants.delete(key)
      const blocks = visibleAssistantBlocks(blocksFromContent((event.data.message as { readonly content: readonly { readonly type: string; readonly text?: string }[] }).content))
      if (blocks.length === 0) {
        state.nodes = state.nodes.filter(node => node.nodeId !== assistantNodeId)
        return
      }
      upsertNode(state, createNode(state.sessionId, 'conversation.assistant', seq, 'settled', {
        blocks,
      }, { nodeId: assistantNodeId, turnId: turn, stepId: step, timestamp: event.time }))
      return
    }
    case 'tool/call': {
      const callId = event.data.callId as string
      const turn = event.data.turn as number
      const step = event.data.step as number
      const key = String(callId)
      if (state.suppressedTools.has(key)) return
      const callRenderIntent = toolView?.for === 'call' ? toolView.view : undefined
      const current: ToolStreamState = {
        nodeId: `${state.sessionId}:tool:${key}`,
        turnId: turn,
        stepId: step,
        name: event.data.name as string,
        arguments: event.data.arguments as string,
        status: 'pending',
        ...(callRenderIntent === undefined ? {} : { callRenderIntent }),
        lastSeq: seq,
      }
      state.tools.set(key, current)
      upsertNode(state, createNode(state.sessionId, toolKind(callRenderIntent, undefined, current.name), seq, 'streaming', {
        name: current.name,
        arguments: current.arguments,
        status: current.status,
        ...(callRenderIntent === undefined ? {} : { callRenderIntent }),
      }, { nodeId: current.nodeId, turnId: turn, stepId: step, timestamp: event.time }))
      return
    }
    case 'tool/result': {
      const callId = (event.data.message as { readonly source: { readonly callId: string } }).source.callId
      const turn = event.data.turn as number
      const step = event.data.step as number
      const key = String(callId)
      if (state.suppressedTools.has(key)) return
      const existing = state.tools.get(key)
      const resultRenderIntent = toolView?.for === 'result' ? toolView.view : undefined
      const current: ToolStreamState = existing ?? {
        nodeId: `${state.sessionId}:tool:${key}`,
        name: 'unknown',
        arguments: '',
        status: 'completed',
        lastSeq: seq,
      }
      const error = event.data.error as { readonly name: string } | undefined
      const isError = error !== undefined
      const updated: ToolStreamState = {
        ...current,
        turnId: current.turnId ?? turn,
        stepId: current.stepId ?? step,
        status: isError ? 'failed' : 'completed',
        result: toolResultTextFromContent((event.data.message as { readonly content: readonly unknown[] }).content),
        ...(isError && error ? { error: error.name } : {}),
        ...(resultRenderIntent === undefined ? {} : { resultRenderIntent }),
        lastSeq: seq,
      }
      state.tools.set(key, updated)
      const existingIndex = state.nodes.findIndex(candidate => candidate.nodeId === updated.nodeId)
      const meta: { nodeId?: string; turnId?: number; stepId?: number; timestamp?: number } = {
        nodeId: updated.nodeId,
        timestamp: event.time,
      }
      if (updated.turnId !== undefined) meta.turnId = updated.turnId
      if (updated.stepId !== undefined) meta.stepId = updated.stepId
      const candidate = createNode(state.sessionId, isError ? 'tool.error' : toolKind(updated.callRenderIntent, updated.resultRenderIntent, updated.name), seq, 'settled', {
        name: updated.name,
        arguments: updated.arguments,
        status: updated.status,
        ...(updated.result === undefined ? {} : { result: updated.result }),
        ...(updated.error === undefined ? {} : { error: updated.error }),
        ...(updated.callRenderIntent === undefined ? {} : { callRenderIntent: updated.callRenderIntent }),
        ...(updated.resultRenderIntent === undefined ? {} : { resultRenderIntent: updated.resultRenderIntent }),
      }, meta)
      if (existingIndex === -1) {
        state.nodes.push(candidate)
      } else {
        state.nodes[existingIndex] = candidate
      }
      return
    }
    case 'tool/code-dispatch-start': {
      const data = event.data
      const orchestrationIds = [data.rootCallId, data.parentCallId]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
      for (const orchestrationId of new Set(orchestrationIds)) {
        state.suppressedTools.add(orchestrationId)
        state.tools.delete(orchestrationId)
        state.nodes = state.nodes.filter(node => node.nodeId !== `${state.sessionId}:tool:${orchestrationId}`)
      }
      const subCallId = data.subCallId as string
      const name = data.name as string
      const argumentsValue = data.arguments
      if (typeof subCallId !== 'string' || subCallId.length === 0 || typeof name !== 'string' || name.length === 0) {
        throw new TypeError('presentation: invalid Code Mode dispatch start')
      }
      const current: ToolStreamState = {
        nodeId: `${state.sessionId}:tool:${subCallId}`,
        name,
        arguments: typeof argumentsValue === 'string' ? argumentsValue : JSON.stringify(argumentsValue),
        status: 'pending',
        lastSeq: seq,
      }
      state.tools.set(subCallId, current)
      upsertNode(state, createNode(state.sessionId, toolKindForName(name), seq, 'streaming', {
        name: current.name, arguments: current.arguments, status: current.status,
      }, { nodeId: current.nodeId, timestamp: event.time }))
      return
    }
    case 'tool/code-dispatch': {
      const data = event.data
      const subCallId = data.subCallId as string
      const name = data.name as string
      const argumentsValue = data.arguments
      const content = data.content
      const isError = data.isError
      if (typeof subCallId !== 'string' || subCallId.length === 0 || typeof name !== 'string' || name.length === 0
        || !Array.isArray(content) || typeof isError !== 'boolean') {
        throw new TypeError('presentation: invalid Code Mode dispatch result')
      }
      const previous = state.tools.get(subCallId)
      const updated: ToolStreamState = {
        nodeId: previous?.nodeId ?? `${state.sessionId}:tool:${subCallId}`,
        name,
        arguments: typeof argumentsValue === 'string' ? argumentsValue : JSON.stringify(argumentsValue),
        status: isError ? 'failed' : 'completed',
        result: toolResultTextFromContent(content),
        ...(isError ? { error: toolResultTextFromContent(content) } : {}),
        lastSeq: seq,
      }
      state.tools.set(subCallId, updated)
      const candidate = createNode(state.sessionId, isError ? 'tool.error' : toolKindForName(name), seq, 'settled', {
        name: updated.name, arguments: updated.arguments, status: updated.status,
        ...(updated.result === undefined ? {} : { result: updated.result }),
        ...(updated.error === undefined ? {} : { error: updated.error }),
      }, { nodeId: updated.nodeId, timestamp: event.time })
      const existingIndex = state.nodes.findIndex(node => node.nodeId === updated.nodeId)
      upsertNode(state, candidate)
      return
    }
    case 'turn/start': {
      state.turn = { turn: event.data.turn as number, running: true, lastSeq: seq, startedAt: event.time }
      return
    }
    case 'turn/end': {
      const reason = event.data.reason as {
        readonly kind: string
        readonly error?: unknown
      }
      const currentTurn = state.turn?.turn ?? (event.data.turn as number)
      const startedAt = state.turn?.startedAt
      state.turn = { turn: currentTurn, running: false, lastSeq: seq, ...(startedAt === undefined ? {} : { startedAt }) }
      state.nodes = state.nodes.filter(node => node.kind !== 'conversation.steering')
      if (reason.kind === 'error') {
        state.nodes.push(createNode(state.sessionId, 'conversation.turn-error', seq, 'failed', {
          message: turnErrorMessage(reason.error),
        }, { turnId: currentTurn, timestamp: event.time }))
      } else if (reason.kind === 'max-tokens') {
        state.nodes.push(createNode(state.sessionId, 'conversation.max-tokens', seq, 'interrupted', {
          message: 'reached the output token ceiling',
        }, { turnId: currentTurn, timestamp: event.time }))
      }
      if (reason.kind === 'completed' || reason.kind === 'end_turn' || reason.kind === 'stop') {
        state.nodes.push(createNode(state.sessionId, 'conversation.turn-tail', seq, 'settled', {
          turn: currentTurn,
          running: false,
          reason: reason.kind,
          ...(startedAt === undefined ? {} : { durationMs: Math.max(0, event.time - startedAt) }),
        }, { turnId: currentTurn, timestamp: event.time }))
      }
      return
    }
    case 'command/run': {
      const data = event.data as { readonly command?: string; readonly name?: string }
      state.nodes.push(createNode(state.sessionId, 'conversation.command', seq, 'streaming', {
        command: data.command ?? data.name ?? 'command',
        status: 'pending',
      }, { timestamp: event.time }))
      return
    }
    case 'command/done': {
      const data = event.data as { readonly command?: string; readonly name?: string; readonly ok?: boolean; readonly text?: string }
      const lastCommand = [...state.nodes].reverse().find(candidate => candidate.kind === 'conversation.command')
      if (lastCommand && lastCommand.kind === 'conversation.command') {
        const index = state.nodes.findIndex(candidate => candidate.nodeId === lastCommand.nodeId)
        state.nodes[index] = createNode(state.sessionId, 'conversation.command', seq, 'settled', {
          command: data.command ?? data.name ?? lastCommand.value.command,
          ...(data.text === undefined ? {} : { output: data.text }),
          status: data.ok === false ? 'error' : 'success',
        }, { nodeId: lastCommand.nodeId, timestamp: event.time })
      }
      return
    }
    case 'compaction/start':
    case 'compaction/summary': {
      const data = event.data as { readonly summary?: string; readonly reason?: string }
      state.compaction = {
        nodeId: `${state.sessionId}:compaction`,
        summary: data.summary ?? data.reason ?? 'session compacted',
        lastSeq: seq,
      }
      upsertNode(state, createNode(state.sessionId, 'conversation.compaction', seq, 'settled', {
        summary: state.compaction.summary,
      }, { nodeId: state.compaction.nodeId, timestamp: event.time }))
      return
    }
    case 'compaction/end':
    case 'compaction/prune':
      return
    default: {
      if (!KNOWN_EVENT_TYPES.has(event.type)) {
        state.nodes.push(createNode(state.sessionId, 'conversation.unknown', seq, 'settled', {
          type: event.type,
          seq,
        }, { timestamp: event.time }))
      }
    }
  }
}

export interface TuiPresentationServiceFace {
  readonly name: typeof tuiPresentationServiceName
  readonly model: TuiPresentationModel | null
  subscribe(listener: (model: TuiPresentationModel) => void): () => void
  project(input: TuiPresentationSessionInput): TuiPresentationModel
  projectAsync(input: TuiPresentationSessionInput): Promise<TuiPresentationModel>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiPresentation: TuiPresentationServiceFace
  }
}

export class TuiPresentationService extends Service implements TuiPresentationServiceFace {
  readonly name = tuiPresentationServiceName
  private current: TuiPresentationModel | null = null
  private projectedState: ProjectorState | null = null
  private projectedEntryCount = 0
  private projectedLastSeq = -1
  private listeners = new Set<(model: TuiPresentationModel) => void>()
  private asyncProjectionGeneration = 0

  constructor(ctx: Context) {
    super(ctx, tuiPresentationServiceName)
    ctx.effect(() => () => {
      this.current = null
      this.projectedState = null
      this.projectedEntryCount = 0
      this.projectedLastSeq = -1
      this.asyncProjectionGeneration += 1
      this.listeners.clear()
    }, 'tui-presentation.dispose')
  }

  get model(): TuiPresentationModel | null {
    return this.current
  }

  subscribe(listener: (model: TuiPresentationModel) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('subscribe requires a function listener')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  project(input: TuiPresentationSessionInput): TuiPresentationModel {
    const firstNewEntry = input.entries[this.projectedEntryCount]
    const canAppend = this.projectedState !== null
      && this.projectedState.sessionId === input.sessionId
      && input.entries.length > this.projectedEntryCount
      && firstNewEntry !== undefined
      && firstNewEntry.event.seq > this.projectedLastSeq
      && (this.projectedEntryCount === 0 || input.entries[this.projectedEntryCount - 1]?.event.seq === this.projectedLastSeq)
    if (canAppend) {
      const state = this.projectedState!
      for (let index = this.projectedEntryCount; index < input.entries.length; index += 1) {
        const entry = input.entries[index]!
        state.revision = Math.max(state.revision, entry.event.seq)
        projectEntry(state, entry)
      }
      this.projectedEntryCount = input.entries.length
      this.projectedLastSeq = input.entries.at(-1)?.event.seq ?? -1
      this.current = modelFromProjectorState(state, input.lastSeq)
    } else if (this.projectedState !== null
      && this.projectedState.sessionId === input.sessionId
      && input.entries.length === this.projectedEntryCount
      && input.lastSeq === this.projectedLastSeq
      && this.current !== null) {
      return this.current
    } else {
      const state = initialProjectorState(input.sessionId)
      for (const entry of input.entries) {
        state.revision = Math.max(state.revision, entry.event.seq)
        projectEntry(state, entry)
      }
      this.projectedState = state
      this.projectedEntryCount = input.entries.length
      this.projectedLastSeq = input.entries.at(-1)?.event.seq ?? -1
      this.current = modelFromProjectorState(state, input.lastSeq)
    }
    for (const listener of [...this.listeners]) listener(this.current)
    return this.current
  }

  async projectAsync(input: TuiPresentationSessionInput): Promise<TuiPresentationModel> {
    if (!Number.isSafeInteger(input.entries.length) || input.entries.length === 0) return this.project(input)
    const generation = ++this.asyncProjectionGeneration
    const chunkSize = 32
    let model = this.current ?? this.project({ ...input, entries: [] })
    for (let start = 0; start < input.entries.length; start += chunkSize) {
      await new Promise<void>(resolve => setImmediate(resolve))
      if (generation !== this.asyncProjectionGeneration) return this.current ?? model
      const end = Math.min(input.entries.length, start + chunkSize)
      model = this.project({
        ...input,
        entries: input.entries.slice(0, end),
        lastSeq: end === input.entries.length ? input.lastSeq : input.entries[end - 1]?.event.seq ?? input.lastSeq,
      })
    }
    return model
  }
}

export const name = 'presentation'

export function apply(ctx: Context): void {
  new TuiPresentationService(ctx)
}
