export type TuiOverlayViewKind =
  | 'fatal'
  | 'approval-question'
  | 'selector.resume-current-cwd'
  | 'command'
  | 'queue'
  | 'overlay.jobs'
  | 'overlay.trajectory'
  | 'overlay.help'
  | 'selector.model'
  | 'selector.provider'
  | 'selector.permission'
  | 'selector.fork-history'
  | 'selector.workspaces'
  | 'selector.subagents'
  | 'selector.session-search'

export interface TuiOverlayItem {
  readonly key: string
  readonly label: string
}

export interface TuiOverlayViewInput {
  readonly kind: TuiOverlayViewKind
  readonly key: string
  readonly title: string
  readonly items: ReadonlyArray<TuiOverlayItem>
  readonly closable: boolean
  readonly selectedIndex?: number
  readonly sourceRevision: number
}

export type TuiOverlayView = {
  readonly [K in keyof TuiOverlayViewInput]: TuiOverlayViewInput[K]
} & { readonly selectedIndex: number }

export type TuiTopOverlayState =
  | { readonly kind: 'composer' }
  | { readonly kind: 'view'; readonly view: TuiOverlayView }

export interface TuiOverlaySelectionIntent {
  readonly kind: 'select'
  readonly viewKey: string
  readonly itemKey: string
  readonly selectedIndex: number
  readonly sourceRevision: number
}

import type { TuiRefreshOrchestratorFace } from '../refresh-orchestrator/refresh-orchestrator.types.ts'

export interface TuiOverlaySelectionPublisher {
  publish(intent: TuiOverlaySelectionIntent): void
}

export type TuiRefreshOverlayPublisher = Pick<TuiRefreshOrchestratorFace, 'request'>

export interface TuiOverlayManagerFace {
  readonly name: 'tuiOverlayManager'
  open(input: unknown, onSelect?: (itemKey: string) => void): () => void
  close(viewKey: unknown): void
  move(delta: number): void
  select(): void
  selectionIntent(): TuiOverlaySelectionIntent | undefined
  projectState(): TuiTopOverlayState
  topItems(): ReadonlyArray<{ readonly key: string; readonly label: string }>
  subscribe(listener: (state: TuiTopOverlayState) => void): () => void
  dispose(): void
}

export function isTuiOverlayViewKind(value: unknown): value is TuiOverlayViewKind {
  return typeof value === 'string'
    && (value === 'fatal'
      || value === 'approval-question'
      || value === 'selector.resume-current-cwd'
      || value === 'command'
      || value === 'queue'
      || value === 'overlay.help'
      || value === 'selector.model'
      || value === 'selector.provider'
      || value === 'selector.permission'
      || value === 'overlay.jobs'
      || value === 'overlay.trajectory'
      || value === 'selector.fork-history'
      || value === 'selector.workspaces'
      || value === 'selector.subagents'
      || value === 'selector.session-search')
}

function priorityRank(kind: TuiOverlayViewKind): number {
  switch (kind) {
    case 'fatal': return 6
    case 'approval-question': return 5
    case 'selector.resume-current-cwd': return 4
    case 'command': return 3
    case 'queue': return 2
    case 'overlay.jobs': return 2
    case 'overlay.trajectory': return 2
    case 'overlay.help': return 1
    case 'selector.model': return 3
    case 'selector.provider': return 3
    case 'selector.permission': return 3
    case 'selector.fork-history': return 4
    case 'selector.workspaces': return 3
    case 'selector.subagents': return 3
    case 'selector.session-search': return 3
    default: throw new TypeError(`overlay-manager-plugin: unknown overlay kind ${kind}`)
  }
}

export function overlayPriorityAtLeast(
  candidate: TuiOverlayViewKind,
  reference: TuiOverlayViewKind,
): boolean {
  return priorityRank(candidate) >= priorityRank(reference)
}

export function assertTuiOverlayInput(value: unknown): asserts value is TuiOverlayViewInput {
  if (!value || typeof value !== 'object') {
    throw new TypeError('overlay-manager-plugin: input must be an object')
  }
  const record = value as Record<string, unknown>
  const allowed = new Set([
    'kind', 'key', 'title', 'items', 'closable', 'selectedIndex', 'sourceRevision',
  ])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new TypeError(`overlay-manager-plugin: unexpected field '${key}'`)
  }
  if (!isTuiOverlayViewKind(record['kind'])) {
    throw new TypeError('overlay-manager-plugin: view kind must be a closed supported kind')
  }
  if (typeof record['key'] !== 'string' || record['key'].length === 0) {
    throw new TypeError('overlay-manager-plugin: view key must be a non-empty string')
  }
  if (typeof record['title'] !== 'string' || record['title'].length === 0) {
    throw new TypeError('overlay-manager-plugin: title must be a non-empty string')
  }
  if (typeof record['closable'] !== 'boolean') {
    throw new TypeError('overlay-manager-plugin: closable must be boolean')
  }
  if (!Array.isArray(record['items']) || record['items'].length === 0) {
    throw new TypeError('overlay-manager-plugin: items must be a non-empty array')
  }
  for (const item of record['items']) {
    if (!item || typeof item !== 'object') {
      throw new TypeError('overlay-manager-plugin: each item must be an object')
    }
    const itemRecord = item as Record<string, unknown>
    const keys = Object.keys(itemRecord)
    if (keys.length !== 2 || !keys.includes('key') || !keys.includes('label')) {
      throw new TypeError('overlay-manager-plugin: malformed overlay item fields')
    }
    if (typeof itemRecord['key'] !== 'string' || itemRecord['key'].length === 0
      || typeof itemRecord['label'] !== 'string' || itemRecord['label'].length === 0) {
      throw new TypeError('overlay-manager-plugin: item key and label must be non-empty strings')
    }
  }
  if (typeof record['sourceRevision'] !== 'number'
    || !Number.isSafeInteger(record['sourceRevision'])
    || record['sourceRevision'] < 0) {
    throw new TypeError('overlay-manager-plugin: sourceRevision must be a non-negative safe integer')
  }
  const selected = record['selectedIndex']
  if (selected !== undefined
    && (typeof selected !== 'number' || !Number.isSafeInteger(selected)
      || selected < 0 || selected >= (record['items'] as unknown[]).length)) {
    throw new TypeError('overlay-manager-plugin: selectedIndex is out of bounds')
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly tuiOverlayManager?: TuiOverlayManagerFace
  }
}
