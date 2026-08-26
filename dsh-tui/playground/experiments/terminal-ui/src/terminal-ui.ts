import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  TuiComponentProps,
  TuiElementDescriptor,
  TuiRenderOutput,
} from '../../../../contracts/tui/component-registry/component-registry.types.ts'
import type { TuiComponentRegistry } from '../../../../contracts/tui/component-registry/terminal-ui.registry-face.ts'
import type {
  TuiComposerMode,
  TuiTerminalComposerState,
  TuiTerminalLocalEchoState,
  TuiTerminalNodeLifecycle,
  TuiTerminalNode,
  TuiTerminalModel,
  TuiTerminalOverlayState,
  TuiTerminalStatusState,
} from '../../../../contracts/tui/terminal-ui/terminal-shell.types.ts'
import type {
  TuiTerminalFrameTree,
  TuiTerminalPrimitiveNode,
  TuiTerminalTextNode,
} from '../../../../contracts/tui/terminal-ui/terminal-frame-tree.types.ts'
import type {
  TuiTerminalComposerLeaf,
  TuiTerminalFooterLeaf,
  TuiTerminalOverlayLeaf,
  TuiTerminalRegionLeaves,
  TuiTerminalTranscriptLeaf,
} from '../../../../contracts/tui/terminal-ui/terminal-region-leaves.types.ts'
import type {
  TuiRealizedTerminalPrimitiveTree,
  TuiTerminalPrimitiveRealizationFailure,
  TuiTerminalPrimitiveRealizationResult,
  TuiTerminalRegionProjectionInput,
  TuiTerminalRegionProjectionResult,
  TuiTerminalRegionProjectorFace,
  TuiTerminalPrimitiveRealizerFace,
} from '../../../../contracts/tui/terminal-ui/terminal-frame-pipeline-result.types.ts'

export const tuiTerminalUiServiceName = 'tuiTerminalUi' as const

export interface RenderTerminalUiOptions {
  readonly width?: number
}

export type {
  TuiComposerMode,
  TuiTerminalComposerState,
  TuiTerminalFooterLeaf,
  TuiTerminalLocalEchoState,
  TuiTerminalNodeLifecycle,
  TuiTerminalNode,
  TuiTerminalModel,
  TuiTerminalOverlayState,
  TuiTerminalStatusState,
}

export type { TuiTerminalFrameTree, TuiRealizedTerminalPrimitiveTree }

export interface TuiTerminalUi extends TuiTerminalRegionProjectorFace, TuiTerminalPrimitiveRealizerFace {
  renderModel(model: TuiTerminalModel, options?: RenderTerminalUiOptions): string
  composeShell(input: {
    model: TuiTerminalModel
    composer?: TuiTerminalComposerState
    status?: TuiTerminalStatusState
    width?: number
  }): string
  describeNode(node: TuiTerminalNode): TuiRenderOutput
  diff(prev: TuiTerminalModel | null, next: TuiTerminalModel): ReadonlyArray<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiTerminalUi: TuiTerminalUi
  }
}

const FORBIDDEN_PROP_KEYS: ReadonlySet<string> = new Set([
  'transport', 'frame', 'muxFrame', 'hostFrame', 'rpcFrame',
  'rpc', 'session_event', 'sessionEvent', 'event', 'seq', 'sequence',
  'endpoint', 'rpcId', 'envelope', 'metadata', 'health', 'snapshot',
  'revisionAck', 'control', 'debug', 'route', 'routing', 'switch',
  'switching', 'continuation', 'retry', 'attempt', 'backoff', 'provider',
  'stopless', 'servertool',
])

const TRANSCRIPT_BANNER = 'Transcript'
const STATUS_BANNER = 'Session'

function asPlainObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`terminal-ui: ${path} must be a plain object`)
  }
  return value as Record<string, unknown>
}

function assertClosedValue(value: unknown, path: string): void {
  if (value === null || value === undefined) return
  if (typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) assertClosedValue(value[i], `${path}[${i}]`)
    return
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_PROP_KEYS.has(key)) {
      throw new TypeError(`terminal-ui: forbidden prop '${key}' at ${path}; renderer must not consume transport/control/session-event fields`)
    }
    assertClosedValue((value as Record<string, unknown>)[key], `${path}.${key}`)
  }
}

function assertNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`terminal-ui: ${path} must be a non-negative integer`)
  }
  return value
}

function assertPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`terminal-ui: ${path} must be a positive integer`)
  }
  return value
}

function assertNonNegativeSafeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`terminal-ui: ${path} must be a non-negative safe integer`)
  }
  return value
}

function assertNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`terminal-ui: ${path} must be a non-empty string`)
  }
  return value
}

function assertLifecycle(value: unknown, path: string): TuiTerminalNode['lifecycle'] {
  if (value !== 'streaming' && value !== 'settled' && value !== 'interrupted' && value !== 'failed') {
    throw new TypeError(`terminal-ui: ${path} must be one of streaming|settled|interrupted|failed`)
  }
  return value
}

function assertNode(node: unknown, path: string): TuiTerminalNode {
  const obj = asPlainObject(node, path)
  const nodeId = assertNonEmptyString(obj['nodeId'], `${path}.nodeId`)
  const kind = assertNonEmptyString(obj['kind'], `${path}.kind`)
  const lifecycle = assertLifecycle(obj['lifecycle'], `${path}.lifecycle`)
  const publicationRevision = assertNonNegativeInteger(obj['publicationRevision'], `${path}.publicationRevision`)
  const rawValue = obj['value'] === undefined ? {} : obj['value']
  const value = asPlainObject(rawValue, `${path}.value`)
  assertClosedValue(value, `${path}.value`)
  return { nodeId, kind, publicationRevision, lifecycle, value }
}

function assertModel(model: unknown): TuiTerminalModel {
  const obj = asPlainObject(model, 'model')
  const nodesRaw = obj['nodes']
  if (!Array.isArray(nodesRaw)) {
    throw new TypeError('terminal-ui: model.nodes must be an array')
  }
  const nodes = nodesRaw.map((n, i) => assertNode(n, `model.nodes[${i}]`))
  const publicationRevision = assertNonNegativeInteger(obj['publicationRevision'], 'model.publicationRevision')
  return { nodes, publicationRevision }
}

function assertComposer(value: unknown): TuiTerminalComposerState {
  const obj = asPlainObject(value, 'composer')
  const text = typeof obj['text'] === 'string' ? obj['text'] : ''
  const cursor = assertNonNegativeInteger(obj['cursor'], 'composer.cursor')
  const linesRaw = obj['lines']
  if (!Array.isArray(linesRaw) || !linesRaw.every((l) => typeof l === 'string')) {
    throw new TypeError('terminal-ui: composer.lines must be string[]')
  }
  const cursorLine = assertNonNegativeInteger(obj['cursorLine'], 'composer.cursorLine')
  const cursorColumn = assertNonNegativeInteger(obj['cursorColumn'], 'composer.cursorColumn')
  const mode = obj['mode']
  if (mode !== 'idle' && mode !== 'streaming' && mode !== 'tool' && mode !== 'error') {
    throw new TypeError('terminal-ui: composer.mode must be closed')
  }
  return { text, cursor, lines: linesRaw as string[], cursorLine, cursorColumn, mode }
}

function assertStatus(value: unknown): TuiTerminalStatusState {
  const obj = asPlainObject(value, 'status')
  const sessionId = obj['sessionId']
  if (sessionId !== null && typeof sessionId !== 'string') {
    throw new TypeError('terminal-ui: status.sessionId must be string|null')
  }
  const cwd = obj['cwd']
  if (cwd !== null && typeof cwd !== 'string') {
    throw new TypeError('terminal-ui: status.cwd must be string|null')
  }
  const mode = obj['mode']
  if (mode !== 'idle' && mode !== 'streaming' && mode !== 'tool' && mode !== 'error') {
    throw new TypeError('terminal-ui: status.mode must be closed')
  }
  const publicationRevision = assertNonNegativeInteger(obj['publicationRevision'], 'status.publicationRevision')
  const message = obj['message']
  if (message !== undefined && typeof message !== 'string') {
    throw new TypeError('terminal-ui: status.message must be a string when present')
  }
  const out: TuiTerminalStatusState = { sessionId, cwd, mode, publicationRevision }
  if (message !== undefined) (out as { message?: string }).message = message
  return out
}

function assertOverlay(value: unknown): TuiTerminalOverlayState {
  const obj = asPlainObject(value, 'overlay')
  const view = obj['view']
  if (view !== 'overlay.help' && view !== 'selector.resume-current-cwd') {
    throw new TypeError('terminal-ui: overlay.view must be closed')
  }
  const title = obj['title']
  if (typeof title !== 'string' || title.length === 0) {
    throw new TypeError('terminal-ui: overlay.title must be non-empty')
  }
  const items = obj['items']
  if (!Array.isArray(items) || items.length === 0 || items.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError('terminal-ui: overlay.items must contain non-empty strings')
  }
  const selectedIndex = obj['selectedIndex']
  if (!Number.isSafeInteger(selectedIndex) || (selectedIndex as number) < 0 || (selectedIndex as number) >= items.length) {
    throw new TypeError('terminal-ui: overlay.selectedIndex is out of bounds')
  }
  return Object.freeze({ view, title, items: Object.freeze([...items]) as readonly string[], selectedIndex: selectedIndex as number })
}

function assertFooterLeaf(value: unknown): TuiTerminalFooterLeaf {
  const obj = asPlainObject(value, 'footer')
  const key = obj['key']
  const kind = obj['kind']
  const style = obj['style']
  const children = obj['children']
  if (key !== 'leaf.footer') throw new TypeError('terminal-ui: footer.key must be leaf.footer')
  if (kind !== 'box') throw new TypeError('terminal-ui: footer.kind must be box')
  if (style === null || typeof style !== 'object' || Array.isArray(style)
    || (style as Record<string, unknown>)['flexDirection'] !== 'column') {
    throw new TypeError('terminal-ui: footer.style must be a column box')
  }
  if (!Array.isArray(children) || children.length !== 2) {
    throw new TypeError('terminal-ui: footer.children must contain exactly two nodes')
  }
  const status = children[0]
  const marker = children[1]
  if (status === null || typeof status !== 'object' || Array.isArray(status)
    || marker === null || typeof marker !== 'object' || Array.isArray(marker)) {
    throw new TypeError('terminal-ui: footer children must be objects')
  }
  if (status['kind'] !== 'text' || status['key'] !== 'footer.status'
    || typeof status['text'] !== 'string' || status['text'].length === 0
    || status['style'] === null || typeof status['style'] !== 'object') {
    throw new TypeError('terminal-ui: footer.status must be a non-empty text node')
  }
  if (marker['kind'] !== 'text' || marker['key'] !== 'footer.marker'
    || typeof marker['text'] !== 'string' || marker['text'].length === 0
    || marker['style'] === null || typeof marker['style'] !== 'object') {
    throw new TypeError('terminal-ui: footer.marker must be a non-empty text node')
  }
  return Object.freeze({
    kind: 'box',
    key: 'leaf.footer',
    style: Object.freeze({ flexDirection: 'column' }),
    children: Object.freeze([status, marker] as const),
  }) as unknown as TuiTerminalFooterLeaf
}

function assertLocalEcho(value: unknown, index: number): TuiTerminalLocalEchoState {
  const obj = asPlainObject(value, `localEchoes[${String(index)}]`)
  const echoId = obj['echoId']
  const text = obj['text']
  const state = obj['state']
  if (typeof echoId !== 'string' || echoId.length === 0) throw new TypeError('terminal-ui: localEcho.echoId must be non-empty')
  if (typeof text !== 'string' || text.length === 0) throw new TypeError('terminal-ui: localEcho.text must be non-empty')
  if (state !== 'pending' && state !== 'failed') throw new TypeError('terminal-ui: localEcho.state must be closed')
  return Object.freeze({ echoId, text, state })
}

function wrap(text: string, width: number): string[] {
  if (width <= 0) return [text]
  if (text.length === 0) return ['']
  const lines: string[] = []
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width))
  return lines
}

function assistantBlocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const value = block as Record<string, unknown>
      const text = typeof value['text'] === 'string' ? value['text'] : ''
      return value['kind'] === 'reasoning' && text.length > 0 ? `· ${text}` : text
    })
    .filter(text => text.length > 0)
    .join('\n')
}

function toolText(value: Readonly<Record<string, unknown>>): string {
  const callIntent = value['callRenderIntent'] && typeof value['callRenderIntent'] === 'object'
    ? value['callRenderIntent'] as Readonly<Record<string, unknown>>
    : undefined
  const resultIntent = value['resultRenderIntent'] && typeof value['resultRenderIntent'] === 'object'
    ? value['resultRenderIntent'] as Readonly<Record<string, unknown>>
    : undefined
  const name = typeof resultIntent?.['title'] === 'string'
    ? resultIntent['title']
    : typeof callIntent?.['title'] === 'string'
      ? callIntent['title']
      : typeof value['name'] === 'string' ? value['name'] : 'tool'
  const status = typeof value['status'] === 'string' ? value['status'] : 'unknown'
  const rawInput = callIntent?.['rawInput']
  const args = typeof rawInput === 'string'
    ? rawInput
    : rawInput === undefined
      ? typeof value['arguments'] === 'string' ? value['arguments'] : ''
      : JSON.stringify(rawInput, null, 2)
  const result = typeof resultIntent?.['output'] === 'string'
    ? resultIntent['output']
    : typeof value['result'] === 'string' ? value['result'] : ''
  const error = typeof value['error'] === 'string' ? value['error'] : ''
  return `${name} [${status}]${args ? `\n  in: ${args}` : ''}${result ? `\n  out: ${result}` : ''}${error ? `\n  error: ${error}` : ''}`
}

function extractText(node: TuiTerminalNode): string {
  if (node.kind === 'conversation.user') {
    return typeof node.value['text'] === 'string' ? node.value['text'] : ''
  }
  if (node.kind === 'conversation.assistant') {
    return assistantBlocksText(node.value['blocks'])
  }
  if (node.kind === 'conversation.reasoning') {
    return typeof node.value['text'] === 'string' ? node.value['text'] : ''
  }
  if (node.kind === 'conversation.context' || node.kind === 'conversation.steering') {
    return typeof node.value['text'] === 'string' ? node.value['text'] : ''
  }
  if (node.kind === 'conversation.command') {
    const command = typeof node.value['command'] === 'string' ? node.value['command'] : 'command'
    const output = typeof node.value['output'] === 'string' ? node.value['output'] : ''
    const status = typeof node.value['status'] === 'string' ? node.value['status'] : 'pending'
    return `${command} [${status}]${output ? `\n  out: ${output}` : ''}`
  }
  if (node.kind === 'conversation.compaction') {
    return typeof node.value['summary'] === 'string' ? node.value['summary'] : 'session compacted'
  }
  if (node.kind === 'conversation.retry' || node.kind === 'conversation.turn-error' || node.kind === 'conversation.max-tokens') {
    return typeof node.value['message'] === 'string' ? node.value['message'] : node.kind
  }
  if (node.kind === 'conversation.turn-tail') {
    const reason = typeof node.value['reason'] === 'string' ? node.value['reason'] : 'completed'
    return `turn ${String(node.value['turn'] ?? '?')} ${reason}`
  }
  if (node.kind === 'conversation.unknown') {
    return `unclaimed event: ${String(node.value['type'] ?? 'unknown')}`
  }
  if (node.kind.startsWith('tool.')) {
    return toolText(node.value)
  }
  if (node.kind === 'error.terminal') {
    return `error: ${typeof node.value['message'] === 'string' ? node.value['message'] : ''}`
  }
  if (node.kind === 'status.terminal') {
    return `status: ${typeof node.value['message'] === 'string' ? node.value['message'] : ''}`
  }
  return `[${node.kind}]`
}

function resolveComponentForKind(kind: string): { groupId: string; registryKind: string } {
  if (kind.startsWith('conversation.')) {
    return { groupId: 'conversation.cells', registryKind: kind }
  }
  if (kind.startsWith('tool.')) return { groupId: 'tool.cards', registryKind: kind }
  if (kind === 'error.terminal') return { groupId: 'conversation.cells', registryKind: 'conversation.turn-error' }
  if (kind === 'status.terminal') return { groupId: 'status.items', registryKind: 'status.session' }
  throw new TypeError(`terminal-ui: unknown canonical kind '${kind}'; not registered`)
}

function propsForNode(node: TuiTerminalNode): TuiComponentProps {
  return {
    contract: 'tui.presentation-node.v1',
    node: {
      nodeId: node.nodeId,
      kind: node.kind,
      publicationRevision: node.publicationRevision,
      lifecycle: node.lifecycle,
      value: node.value,
    },
  }
}

function renderNodeToText(registry: TuiComponentRegistry, node: TuiTerminalNode): string {
  const component = resolveComponentForKind(node.kind)
  const output = registry.render(component.groupId, component.registryKind, propsForNode(node))
  if (output === null) return ''
  if (output.contract !== 'tui.element.v1') {
    throw new TypeError(`terminal-ui: renderer for ${node.kind} returned a typed intent in a transcript slot`)
  }
  return descriptorToText(output, node)
}

function descriptorToText(descriptor: TuiElementDescriptor | null, node: TuiTerminalNode): string {
  if (descriptor === null) return ''
  const props = descriptor.props ?? {}
  const fallback = extractText(node)
  switch (descriptor.elementType) {
    case 'conversation.user':
      return `› ${fallback}`
    case 'conversation.assistant':
      return `  ${fallback}`
    case 'conversation.reasoning':
      return `· ${fallback}`
    case 'conversation.context':
      return `· context: ${fallback}`
    case 'conversation.steering':
      return `· steering: ${fallback}`
    case 'conversation.command':
      return `⌁ ${fallback}`
    case 'conversation.compaction':
      return `· compaction: ${fallback}`
    case 'conversation.retry':
      return `↻ ${fallback}`
    case 'conversation.turn-error':
    case 'conversation.max-tokens':
      return `! ${fallback}`
    case 'conversation.turn-tail':
      return `· ${fallback}`
    case 'conversation.unknown':
      return `? ${fallback}`
    case 'tool.card':
      return `[tool:${node.nodeId}] ${fallback}`
    case 'error.terminal':
      return `! ${fallback}`
    case 'status.terminal':
      return `~ ${fallback}`
    default:
      throw new TypeError(`terminal-ui: unknown descriptor elementType '${descriptor.elementType}'; not registered`)
  }
}

function clonePlainData<T>(value: T, seen = new Map<unknown, unknown>()): T {
  if (value === null || typeof value !== 'object') return value
  const cached = seen.get(value)
  if (cached !== undefined) return cached as T
  const copy: unknown = Array.isArray(value) ? [] : {}
  seen.set(value, copy)
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    ;(copy as Record<string, unknown>)[key] = clonePlainData(child, seen)
  }
  return copy as T
}

function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  if (Array.isArray(value)) {
    for (const child of value) deepFreeze(child, seen)
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen)
  }
  return Object.freeze(value)
}

function renderNodeToDescriptor(registry: TuiComponentRegistry, node: TuiTerminalNode): TuiRenderOutput {
  const component = resolveComponentForKind(node.kind)
  return registry.render(component.groupId, component.registryKind, propsForNode(node))
}

function statusLine(status: TuiTerminalStatusState): string {
  const id = status.sessionId ?? 'no-session'
  const cwd = status.cwd ?? 'no-cwd'
  const message = status.message ? ` ${status.message}` : ''
  return `${STATUS_BANNER} ${id} @ ${cwd} [${status.mode}]${message}`
}

function composerLine(composer: TuiTerminalComposerState): string {
  return `${composer.lines.join('\n') || ' '}\n  cursor=${composer.cursor} mode=${composer.mode}`
}

function textNode<Key extends string>(key: Key, text: string, style: TuiTerminalTextNode['style'] = {}): TuiTerminalTextNode & { readonly key: Key } {
  return Object.freeze({ kind: 'text', key, text, style: Object.freeze(style) })
}

function transcriptLeaf(
  registry: TuiComponentRegistry,
  model: TuiTerminalModel,
  localEchoes: readonly TuiTerminalLocalEchoState[],
): TuiTerminalTranscriptLeaf {
  const cells = model.nodes.map(node => textNode(node.nodeId, renderNodeToText(registry, node)))
  const echoes = localEchoes.map(echo => textNode(
    echo.echoId,
    `› ${echo.text} [${echo.state === 'pending' ? 'sending' : 'failed'}]`,
    echo.state === 'failed' ? { color: 'red' } : { color: 'cyan' },
  ))
  return Object.freeze({
    kind: 'box',
    key: 'leaf.transcript',
    style: Object.freeze({ flexDirection: 'column' }),
    children: Object.freeze([...cells, ...echoes]),
  })
}

function composerLeaf(composer: TuiTerminalComposerState): TuiTerminalComposerLeaf {
  return Object.freeze({
    kind: 'box',
    key: 'leaf.composer',
    style: Object.freeze({ flexDirection: 'column' }),
    children: Object.freeze([textNode('composer.display', composerLine(composer), { color: 'green' })]),
  })
}

function overlayLeaf(overlay: TuiTerminalOverlayState): TuiTerminalOverlayLeaf {
  return Object.freeze({
    kind: 'box',
    key: 'leaf.overlay',
    style: Object.freeze({ borderStyle: 'round', flexDirection: 'column', paddingX: 1 }),
    children: Object.freeze([
      textNode(`overlay.title:${overlay.view}`, overlay.title, { bold: true }),
      ...overlay.items.map(item => textNode(
        `overlay.item:${overlay.view}:${item}`,
        `${overlay.items[overlay.selectedIndex] === item ? '›' : ' '} ${item}`,
        overlay.items[overlay.selectedIndex] === item ? { color: 'cyan' } : {},
      )),
    ]),
  })
}

function realizationFailure(cause: unknown): TuiTerminalPrimitiveRealizationFailure {
  const error = cause instanceof Error ? cause : new TypeError(String(cause))
  return Object.freeze({
    stage: 'primitive-realization',
    code: 'invalid-terminal-primitive-tree',
    message: error.message,
    cause: error,
  })
}

const TEXT_STYLE_KEYS = new Set(['bold', 'dimColor', 'inverse', 'color'])
const BOX_STYLE_KEYS = new Set(['flexDirection', 'width', 'borderStyle', 'paddingX'])
const TEXT_COLORS = new Set(['red', 'yellow', 'green', 'cyan'])

function assertExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  const keys = Object.keys(value)
  if (keys.length !== allowed.size || keys.some(key => !allowed.has(key))) {
    throw new TypeError(`terminal-ui: ${path} has an invalid closed field set`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`terminal-ui: ${path} must not contain symbols`)
  }
}

function assertClosedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  const keys = Object.keys(value)
  if (keys.some(key => !allowed.has(key))) {
    throw new TypeError(`terminal-ui: ${path} has an invalid closed field set`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`terminal-ui: ${path} must not contain symbols`)
  }
}

function validatePrimitive(
  node: unknown,
  path: string,
  seenKeys: Set<string>,
  visiting: Set<object>,
): asserts node is TuiTerminalPrimitiveNode {
  const record = asPlainObject(node, path)
  if (Object.getPrototypeOf(record) !== Object.prototype) {
    throw new TypeError(`terminal-ui: ${path} must be a plain object`)
  }
  if (!Object.isFrozen(record)) throw new TypeError(`terminal-ui: ${path} must be frozen`)
  if (visiting.has(record)) throw new TypeError(`terminal-ui: ${path} contains a cycle`)
  visiting.add(record)
  const kind = record['kind']
  if (kind === 'text') {
    assertExactKeys(record, new Set(['kind', 'key', 'text', 'style']), path)
    const key = record['key']
    const text = record['text']
    if (typeof key !== 'string' || key.length === 0 || seenKeys.has(key)) {
      throw new TypeError(`terminal-ui: ${path}.key must be a unique non-empty string`)
    }
    if (typeof text !== 'string') throw new TypeError(`terminal-ui: ${path}.text must be a string`)
    seenKeys.add(key)
    const style = record['style']
    if (!asPlainObject(style, `${path}.style`) || !Object.isFrozen(style)) {
      throw new TypeError(`terminal-ui: ${path}.style must be a frozen object`)
    }
    assertClosedKeys(style as Record<string, unknown>, TEXT_STYLE_KEYS, `${path}.style`)
    const styleRecord = style as Record<string, unknown>
    for (const field of ['bold', 'dimColor', 'inverse']) {
      if (styleRecord[field] !== undefined && typeof styleRecord[field] !== 'boolean') {
        throw new TypeError(`terminal-ui: ${path}.style.${field} must be boolean`)
      }
    }
    if (styleRecord['color'] !== undefined && !TEXT_COLORS.has(styleRecord['color'] as string)) {
      throw new TypeError(`terminal-ui: ${path}.style.color is not closed`)
    }
  } else if (kind === 'box') {
    assertExactKeys(record, new Set(['kind', 'key', 'style', 'children']), path)
    const key = record['key']
    if (typeof key !== 'string' || key.length === 0 || seenKeys.has(key)) {
      throw new TypeError(`terminal-ui: ${path}.key must be a unique non-empty string`)
    }
    seenKeys.add(key)
    const style = record['style']
    if (!asPlainObject(style, `${path}.style`) || !Object.isFrozen(style)) {
      throw new TypeError(`terminal-ui: ${path}.style must be a frozen object`)
    }
    assertClosedKeys(style as Record<string, unknown>, BOX_STYLE_KEYS, `${path}.style`)
    const styleRecord = style as Record<string, unknown>
    if (styleRecord['flexDirection'] !== 'row' && styleRecord['flexDirection'] !== 'column') {
      throw new TypeError(`terminal-ui: ${path}.style.flexDirection must be row or column`)
    }
    if (styleRecord['width'] !== undefined
      && (typeof styleRecord['width'] !== 'number' || !Number.isSafeInteger(styleRecord['width']) || styleRecord['width'] <= 0)) {
      throw new TypeError(`terminal-ui: ${path}.style.width must be a positive safe integer`)
    }
    if (styleRecord['borderStyle'] !== undefined && styleRecord['borderStyle'] !== 'round') {
      throw new TypeError(`terminal-ui: ${path}.style.borderStyle must be round`)
    }
    if (styleRecord['paddingX'] !== undefined
      && (typeof styleRecord['paddingX'] !== 'number' || !Number.isSafeInteger(styleRecord['paddingX']) || styleRecord['paddingX'] < 0)) {
      throw new TypeError(`terminal-ui: ${path}.style.paddingX must be a non-negative safe integer`)
    }
    const children = record['children']
    if (!Array.isArray(children) || !Object.isFrozen(children)) {
      throw new TypeError(`terminal-ui: ${path}.children must be a frozen array`)
    }
    children.forEach((child, index) => validatePrimitive(child, `${path}.children[${index}]`, seenKeys, visiting))
  } else {
    throw new TypeError(`terminal-ui: ${path}.kind must be box or text`)
  }
  visiting.delete(record)
}

export function validateTerminalFrameTree(value: unknown): asserts value is TuiTerminalFrameTree {
  const frame = asPlainObject(value, 'frame')
  if (Object.getPrototypeOf(frame) !== Object.prototype || !Object.isFrozen(frame)) {
    throw new TypeError('terminal-ui: frame must be a frozen plain object')
  }
  assertExactKeys(frame, new Set(['contract', 'publicationRevision', 'root']), 'frame')
  if (frame['contract'] !== 'tui.terminal-frame-tree.v1') {
    throw new TypeError('terminal-ui: frame contract is not tui.terminal-frame-tree.v1')
  }
  const revision = frame['publicationRevision']
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('terminal-ui: frame.publicationRevision must be a non-negative safe integer')
  }
  validatePrimitive(frame['root'], 'frame.root', new Set<string>(), new Set<object>())
}

export function validateTerminalRegionLeaves(value: unknown): asserts value is TuiTerminalRegionLeaves {
  const leaves = asPlainObject(value, 'leaves')
  if (Object.getPrototypeOf(leaves) !== Object.prototype || !Object.isFrozen(leaves)) {
    throw new TypeError('terminal-ui: region leaves must be a frozen plain object')
  }
  const requiredKeys = ['contract', 'publicationRevision', 'transcript', 'composer', 'footer']
  const expectedKeys = leaves['overlay'] === undefined ? requiredKeys : [...requiredKeys, 'overlay']
  assertExactKeys(leaves, new Set(expectedKeys), 'leaves')
  if (leaves['contract'] !== 'tui.terminal-region-leaves.v1') {
    throw new TypeError('terminal-ui: region leaves contract is not tui.terminal-region-leaves.v1')
  }
  const revision = leaves['publicationRevision']
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('terminal-ui: leaves.publicationRevision must be a non-negative safe integer')
  }
  const seenKeys = new Set<string>()
  validatePrimitive(leaves['transcript'], 'leaves.transcript', seenKeys, new Set<object>())
  validatePrimitive(leaves['composer'], 'leaves.composer', seenKeys, new Set<object>())
  validatePrimitive(leaves['footer'], 'leaves.footer', seenKeys, new Set<object>())
  if (leaves['overlay'] !== undefined) validatePrimitive(leaves['overlay'], 'leaves.overlay', seenKeys, new Set<object>())
}

export class TuiTerminalUiService extends Service implements TuiTerminalUi {
  name = tuiTerminalUiServiceName

  constructor(ctx: Context) {
    super(ctx, tuiTerminalUiServiceName)
  }

  renderModel(model: TuiTerminalModel, options: RenderTerminalUiOptions = {}): string {
    const m = assertModel(model)
    const width = assertPositiveInteger(options.width ?? 80, 'width')
    return this.composeShell({ model: m, width })
  }

  composeShell(input: {
    model: TuiTerminalModel
    composer?: TuiTerminalComposerState
    status?: TuiTerminalStatusState
    width?: number
  }): string {
    const m = assertModel(input.model)
    const width = assertPositiveInteger(input.width ?? 80, 'width')
    const composer = input.composer
      ? assertComposer(input.composer)
      : { text: '', cursor: 0, lines: [''], cursorLine: 0, cursorColumn: 0, mode: 'idle' } as TuiTerminalComposerState
    const status = input.status
      ? assertStatus(input.status)
      : { sessionId: null, cwd: null, mode: 'idle', publicationRevision: m.publicationRevision } as TuiTerminalStatusState
    const registry = this.ctx.tuiComponentRegistry
    const transcriptSections: string[] = [`== ${TRANSCRIPT_BANNER} ==`]
    for (const node of m.nodes) {
      const lines = wrap(renderNodeToText(registry, node), width)
      transcriptSections.push(lines.map((line) => `[${node.nodeId}] ${line}`).join('\n'))
    }
    const transcript = transcriptSections.length === 1
      ? transcriptSections.join('\n')
      : `${transcriptSections.join('\n')}`
    const composerBlock = `-- composer.editor --\n${composerLine(composer)}`
    const statusBlock = `-- ${STATUS_BANNER} --\n${statusLine(status)}`
    return `${transcript}\n${composerBlock}\n${statusBlock}`
  }

  private projectRegionLeavesInternal(input: TuiTerminalRegionProjectionInput): TuiTerminalRegionProjectionResult {
    try {
      const model = assertModel(input.model)
      const composer = assertComposer(input.composer)
      const status = assertStatus(input.status)
      const footer = assertFooterLeaf(input.footer)
      const overlay = input.overlay === undefined ? undefined : assertOverlay(input.overlay)
      const localEchoes = Object.freeze((input.localEchoes ?? []).map(assertLocalEcho))
      const leaves: TuiTerminalRegionLeaves = {
        contract: 'tui.terminal-region-leaves.v1',
        publicationRevision: model.publicationRevision,
        transcript: transcriptLeaf(this.ctx.tuiComponentRegistry, model, localEchoes),
        composer: composerLeaf(composer),
        footer,
        ...(overlay === undefined ? {} : { overlay: overlayLeaf(overlay) }),
      }
      return { ok: true, value: deepFreeze(leaves) }
    } catch (cause) {
      const error: Error = cause instanceof Error ? cause : new TypeError(String(cause))
      return { ok: false, error: Object.freeze({
        stage: 'region-projection',
        code: 'invalid-terminal-region-leaves',
        message: error.message,
        cause: error,
      }) }
    }
  }

  project(input: TuiTerminalRegionProjectionInput): TuiTerminalRegionLeaves {
    const result = this.projectRegionLeavesInternal(input)
    if (!result.ok) throw result.error.cause instanceof Error ? result.error.cause : new Error(result.error.message)
    return result.value
  }

  projectSafe(input: TuiTerminalRegionProjectionInput): TuiTerminalRegionProjectionResult {
    return this.projectRegionLeavesInternal(input)
  }

  private realizeInternal(frame: unknown): TuiTerminalPrimitiveRealizationResult {
    try {
      validateTerminalFrameTree(frame)
      const root = frame.root
      return { ok: true, value: Object.freeze({ contract: 'tui.realized-terminal-primitive-tree.v1', root }) }
    } catch (cause) {
      return { ok: false, error: realizationFailure(cause) }
    }
  }

  realize(frame: TuiTerminalFrameTree): TuiRealizedTerminalPrimitiveTree {
    const result = this.realizeInternal(frame)
    if (!result.ok) throw result.error.cause
    return result.value
  }

  realizeSafe(frame: TuiTerminalFrameTree): TuiTerminalPrimitiveRealizationResult {
    return this.realizeInternal(frame)
  }

  describeNode(node: TuiTerminalNode): TuiRenderOutput {
    const n = assertNode(node, 'node')
    const component = resolveComponentForKind(n.kind)
    return this.ctx.tuiComponentRegistry.render(component.groupId, component.registryKind, propsForNode(n))
  }

  diff(prev: TuiTerminalModel | null, next: TuiTerminalModel): ReadonlyArray<string> {
    const n = assertModel(next)
    if (prev === null) return n.nodes.map((node) => node.nodeId)
    const p = assertModel(prev)
    const added: string[] = []
    const changed: string[] = []
    for (const node of n.nodes) {
      const before = p.nodes.find((b) => b.nodeId === node.nodeId)
      if (!before) added.push(node.nodeId)
      else if (before.publicationRevision !== node.publicationRevision || before.lifecycle !== node.lifecycle) {
        changed.push(node.nodeId)
      }
    }
    const removed = p.nodes
      .filter((node) => !n.nodes.some((cur) => cur.nodeId === node.nodeId))
      .map((node) => node.nodeId)
    return [...added, ...changed, ...removed]
  }
}

export function apply(ctx: Context): void {
  ctx.tuiTerminalUi = new TuiTerminalUiService(ctx)
  installTerminalUiRenderers(ctx)
}

export const _internal = {
  resolveComponentForKind,
  extractText,
  wrap,
  renderNodeToText,
}

function conversationUser(props: TuiComponentProps): TuiElementDescriptor {
  if (props.contract !== 'tui.presentation-node.v1') throw new TypeError('conversation.user requires presentation-node props')
  const text = typeof props.node.value['text'] === 'string' ? props.node.value['text'] : ''
  return { contract: 'tui.element.v1', elementType: 'conversation.user', props: { nodeId: props.node.nodeId, text } }
}

function conversationAssistant(props: TuiComponentProps): TuiElementDescriptor {
  if (props.contract !== 'tui.presentation-node.v1') throw new TypeError('conversation.assistant requires presentation-node props')
  const text = assistantBlocksText(props.node.value['blocks'])
  return { contract: 'tui.element.v1', elementType: 'conversation.assistant', props: { nodeId: props.node.nodeId, text } }
}

function conversationReasoning(props: TuiComponentProps): TuiElementDescriptor {
  if (props.contract !== 'tui.presentation-node.v1') throw new TypeError('conversation.reasoning requires presentation-node props')
  const text = typeof props.node.value['text'] === 'string' ? props.node.value['text'] : ''
  return { contract: 'tui.element.v1', elementType: 'conversation.reasoning', props: { nodeId: props.node.nodeId, text } }
}

function conversationCell(elementType: string, props: TuiComponentProps): TuiElementDescriptor {
  if (props.contract !== 'tui.presentation-node.v1') throw new TypeError(`${elementType} requires presentation-node props`)
  return {
    contract: 'tui.element.v1',
    elementType,
    props: { nodeId: props.node.nodeId, value: props.node.value },
  }
}

function toolCard(props: TuiComponentProps): TuiElementDescriptor {
  if (props.contract !== 'tui.presentation-node.v1') throw new TypeError('tool card requires presentation-node props')
  return { contract: 'tui.element.v1', elementType: 'tool.card', props: { nodeId: props.node.nodeId, text: toolText(props.node.value) } }
}

function errorTerminal(props: TuiComponentProps): TuiElementDescriptor {
  if (props.contract !== 'tui.presentation-node.v1') throw new TypeError('error.terminal requires presentation-node props')
  return { contract: 'tui.element.v1', elementType: 'error.terminal', props: { nodeId: props.node.nodeId, value: props.node.value } }
}

function statusTerminal(props: TuiComponentProps): TuiElementDescriptor {
  if (props.contract !== 'tui.presentation-node.v1') throw new TypeError('status.terminal requires presentation-node props')
  return { contract: 'tui.element.v1', elementType: 'status.terminal', props: { nodeId: props.node.nodeId, value: props.node.value } }
}

function accept(props: TuiComponentProps): boolean {
  return props.contract === 'tui.presentation-node.v1'
}

export interface TerminalUiRegistration {
  readonly groupId: string
  readonly kind: string
  readonly owner: string
  readonly validateProps: (props: TuiComponentProps) => boolean
  readonly render: (props: TuiComponentProps) => TuiElementDescriptor
}

export const terminalUiRendererRegistrations: ReadonlyArray<TerminalUiRegistration> = [
  { groupId: 'conversation.cells', kind: 'conversation.user', owner: 'dsh-tui.terminal-ui.conversation-user', validateProps: accept, render: conversationUser },
  { groupId: 'conversation.cells', kind: 'conversation.context', owner: 'dsh-tui.terminal-ui.conversation-context', validateProps: accept, render: props => conversationCell('conversation.context', props) },
  { groupId: 'conversation.cells', kind: 'conversation.steering', owner: 'dsh-tui.terminal-ui.conversation-steering', validateProps: accept, render: props => conversationCell('conversation.steering', props) },
  { groupId: 'conversation.cells', kind: 'conversation.assistant', owner: 'dsh-tui.terminal-ui.conversation-assistant', validateProps: accept, render: conversationAssistant },
  { groupId: 'conversation.cells', kind: 'conversation.reasoning', owner: 'dsh-tui.terminal-ui.conversation-reasoning', validateProps: accept, render: conversationReasoning },
  { groupId: 'conversation.cells', kind: 'conversation.command', owner: 'dsh-tui.terminal-ui.conversation-command', validateProps: accept, render: props => conversationCell('conversation.command', props) },
  { groupId: 'conversation.cells', kind: 'conversation.compaction', owner: 'dsh-tui.terminal-ui.conversation-compaction', validateProps: accept, render: props => conversationCell('conversation.compaction', props) },
  { groupId: 'conversation.cells', kind: 'conversation.retry', owner: 'dsh-tui.terminal-ui.conversation-retry', validateProps: accept, render: props => conversationCell('conversation.retry', props) },
  { groupId: 'tool.cards', kind: 'tool.terminal', owner: 'dsh-tui.terminal-ui.tool-terminal', validateProps: accept, render: toolCard },
  { groupId: 'tool.cards', kind: 'tool.generic', owner: 'dsh-tui.terminal-ui.tool-generic', validateProps: accept, render: toolCard },
  { groupId: 'tool.cards', kind: 'tool.read', owner: 'dsh-tui.terminal-ui.tool-read', validateProps: accept, render: toolCard },
  { groupId: 'tool.cards', kind: 'tool.search', owner: 'dsh-tui.terminal-ui.tool-search', validateProps: accept, render: toolCard },
  { groupId: 'tool.cards', kind: 'tool.diff', owner: 'dsh-tui.terminal-ui.tool-diff', validateProps: accept, render: toolCard },
  { groupId: 'tool.cards', kind: 'tool.workflow', owner: 'dsh-tui.terminal-ui.tool-workflow', validateProps: accept, render: toolCard },
  { groupId: 'tool.cards', kind: 'tool.skill', owner: 'dsh-tui.terminal-ui.tool-skill', validateProps: accept, render: toolCard },
  { groupId: 'tool.cards', kind: 'tool.error', owner: 'dsh-tui.terminal-ui.tool-error', validateProps: accept, render: toolCard },
  { groupId: 'conversation.cells', kind: 'conversation.turn-error', owner: 'dsh-tui.terminal-ui.error-terminal', validateProps: accept, render: errorTerminal },
  { groupId: 'conversation.cells', kind: 'conversation.max-tokens', owner: 'dsh-tui.terminal-ui.max-tokens', validateProps: accept, render: errorTerminal },
  { groupId: 'conversation.cells', kind: 'conversation.turn-tail', owner: 'dsh-tui.terminal-ui.turn-tail', validateProps: accept, render: props => conversationCell('conversation.turn-tail', props) },
  { groupId: 'conversation.cells', kind: 'conversation.unknown', owner: 'dsh-tui.terminal-ui.unknown', validateProps: accept, render: props => conversationCell('conversation.unknown', props) },
  { groupId: 'status.items', kind: 'status.session', owner: 'dsh-tui.terminal-ui.status-terminal', validateProps: accept, render: statusTerminal },
]

export function installTerminalUiRenderers(ctx: Context): () => void {
  const disposers: Array<() => void> = []
  for (const registration of terminalUiRendererRegistrations) {
    const dispose = ctx.tuiComponentRegistry.register(ctx, registration) as () => void
    disposers.push(dispose)
  }
  return () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop()
      if (dispose) dispose()
    }
  }
}
