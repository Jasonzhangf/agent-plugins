export type TuiNodeLifecycle = 'streaming' | 'settled' | 'interrupted' | 'failed'

export type TuiAssistantBlock =
  | { readonly kind: 'text'; readonly text: string; readonly markdown: readonly string[] }
  | { readonly kind: 'reasoning'; readonly text: string }

export interface TuiToolNodeValue {
  readonly name: string
  readonly arguments: string
  readonly status: 'pending' | 'running' | 'completed' | 'failed'
  readonly result?: string
  readonly error?: string
}

export interface TuiViewNodeMap {
  'conversation.user': { readonly text: string }
  'conversation.context': { readonly text: string }
  'conversation.steering': { readonly text: string }
  'conversation.assistant': { readonly blocks: readonly TuiAssistantBlock[] }
  'conversation.reasoning': { readonly text: string }
  'conversation.command': {
    readonly command: string
    readonly output?: string
    readonly status: 'pending' | 'success' | 'error'
  }
  'conversation.compaction': { readonly summary: string }
  'conversation.retry': { readonly message: string }
  'conversation.turn-error': { readonly message: string }
  'conversation.max-tokens': { readonly message: string }
  'conversation.turn-tail': {
    readonly turn: number
    readonly step?: number
    readonly running: boolean
    readonly reason?: string
  }
  'conversation.unknown': { readonly type: string; readonly seq: number }
  'tool.generic': TuiToolNodeValue
  'tool.terminal': TuiToolNodeValue
  'tool.read': TuiToolNodeValue
  'tool.search': TuiToolNodeValue
  'tool.diff': TuiToolNodeValue
  'tool.workflow': TuiToolNodeValue
  'tool.skill': TuiToolNodeValue
  'tool.error': TuiToolNodeValue
}

export type TuiViewNodeKind = keyof TuiViewNodeMap

export type TuiViewNode<K extends TuiViewNodeKind = TuiViewNodeKind> = {
  readonly nodeId: string
  readonly kind: K
  readonly publicationRevision: number
  readonly lifecycle: TuiNodeLifecycle
  readonly turnId?: number
  readonly stepId?: number
  readonly timestamp?: number
  readonly value: TuiViewNodeMap[K]
}

export type TuiViewNodeAny = {
  [K in TuiViewNodeKind]: TuiViewNode<K>
}[TuiViewNodeKind]

export interface TuiPresentationModel {
  readonly nodes: readonly TuiViewNodeAny[]
  readonly publicationRevision: number
}

export function createNode<K extends TuiViewNodeKind>(
  sessionId: string,
  kind: K,
  seq: number,
  lifecycle: TuiNodeLifecycle,
  value: TuiViewNodeMap[K],
  meta: { nodeId?: string; turnId?: number; stepId?: number; timestamp?: number } = {},
): TuiViewNode<K> {
  return Object.freeze({
    nodeId: meta.nodeId ?? `${sessionId}:${seq}:${kind}`,
    kind,
    publicationRevision: seq,
    lifecycle,
    ...(meta.turnId === undefined ? {} : { turnId: meta.turnId }),
    ...(meta.stepId === undefined ? {} : { stepId: meta.stepId }),
    ...(meta.timestamp === undefined ? {} : { timestamp: meta.timestamp }),
    value: freezeValue(value),
  })
}

function freezeValue<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) freezeValue(item)
  } else {
    for (const item of Object.values(value)) freezeValue(item)
  }
  return Object.freeze(value)
}
