import { Service, type Context } from '@deepseek-ai/cordis'
import {
  assertTuiOverlayInput,
  overlayPriorityAtLeast,
  type TuiOverlayManagerFace,
  type TuiOverlaySelectionPublisher,
  type TuiOverlaySelectionIntent,
  type TuiOverlayView,
  type TuiOverlayViewInput,
  type TuiRefreshOverlayPublisher,
  type TuiTopOverlayState,
} from '../../../../contracts/tui/overlay-manager-plugin/overlay-manager-plugin.types.ts'

export const tuiOverlayManagerName = 'tuiOverlayManager' as const

const COMPOSER_STATE: TuiTopOverlayState = Object.freeze({ kind: 'composer' })
const MAX_STACK_DEPTH = 32

function freezeView(input: TuiOverlayViewInput): TuiOverlayView {
  return Object.freeze({
    ...input,
    items: Object.freeze([...input.items]),
    selectedIndex: input.selectedIndex ?? 0,
  })
}

export class TuiOverlayManagerService extends Service implements TuiOverlayManagerFace {
  readonly name = tuiOverlayManagerName
  private stack: ReadonlyArray<TuiOverlayView> = Object.freeze([])
  private readonly callbacks = new Map<string, { onSelect?: (itemKey: string) => void }>()
  private readonly listeners = new Set<(state: TuiTopOverlayState) => void>()
  private disposed = false
  private nextRevision = 1
  private readonly refreshPublisher: TuiRefreshOverlayPublisher | undefined
  private readonly selectionPublisher: TuiOverlaySelectionPublisher | undefined
  private lastSelectionIntent: TuiOverlaySelectionIntent | undefined

  constructor(private contextRef: Context, options?: {
    refreshPublisher?: TuiRefreshOverlayPublisher
    selectionPublisher?: TuiOverlaySelectionPublisher
  }) {
    super(contextRef, tuiOverlayManagerName)
    this.refreshPublisher = options?.refreshPublisher
    this.selectionPublisher = options?.selectionPublisher
    contextRef.effect(() => () => this.dispose(), 'overlay-manager-plugin.dispose')
  }

  open(value: unknown, onSelect?: (itemKey: string) => void): () => void {
    if (this.disposed) throw new Error('overlay-manager-plugin: cannot open after disposed state')
    if (this.stack.length >= MAX_STACK_DEPTH) {
      throw new Error(`overlay-manager-plugin: overlay stack limit ${String(MAX_STACK_DEPTH)} reached`)
    }
    assertTuiOverlayInput(value)
    const view = freezeView(value)
    const top = this.stack[this.stack.length - 1]
    if (top !== undefined && !overlayPriorityAtLeast(view.kind, top.kind)) {
      throw new Error('overlay-manager-plugin: lower-priority view cannot replace active higher-priority view')
    }
    this.callbacks.set(view.key, { ...(onSelect === undefined ? {} : { onSelect }) })
    this.stack = Object.freeze([...this.stack, view])
    this.nextRevision += 1
    this.requestRefresh()
    this.publish()
    return () => {
      this.close(view.key)
    }
  }

  close(viewKey: unknown): void {
    if (typeof viewKey !== 'string' || viewKey.length === 0) {
      throw new TypeError('overlay-manager-plugin: close key must be a non-empty string')
    }
    if (this.disposed) throw new Error('overlay-manager-plugin: cannot close after disposed state')
    const index = this.stack.findIndex(view => view.key === viewKey)
    if (index < 0) {
      throw new Error(`overlay-manager-plugin: duplicate or unknown close for ${viewKey}`)
    }
    const view = this.stack[index]
    if (view && !view.closable) {
      throw new Error(`overlay-manager-plugin: fatal view cannot be closed by generic close: ${view.key}`)
    }
    const callback = this.callbacks.get(viewKey)
    const wasTop = index === this.stack.length - 1
    this.stack = Object.freeze([...this.stack.slice(0, index), ...this.stack.slice(index + 1)])
    this.callbacks.delete(viewKey)
    this.nextRevision += 1
    if (!wasTop) {
      // Closing a non-top hidden view must not trigger a refresh.
      this.publish(false)
      return
    }
    this.requestRefresh()
    this.publish()
    void callback
  }

  move(delta: number): void {
    if (typeof delta !== 'number' || !Number.isSafeInteger(delta) || delta === 0) {
      throw new TypeError('overlay-manager-plugin: delta must be a non-zero safe integer')
    }
    const top = this.top()
    if (!top) throw new Error('overlay-manager-plugin: no overlay is active')
    if (!top.closable) throw new Error('overlay-manager-plugin: fatal view does not accept selector movement')
    const selectedIndex = Math.max(0, Math.min(top.items.length - 1, top.selectedIndex + delta))
    this.replaceTop({ ...top, selectedIndex })
  }

  select(): void {
    const top = this.top()
    if (!top) throw new Error('overlay-manager-plugin: no overlay is active')
    if (!top.closable) throw new Error('overlay-manager-plugin: fatal view requires its own explicit action')
    const item = top.items[top.selectedIndex]
    if (!item) throw new Error('overlay-manager-plugin: stale selected index')
    const callback = this.callbacks.get(top.key)?.onSelect
    const intent: TuiOverlaySelectionIntent = Object.freeze({
      kind: 'select',
      viewKey: top.key,
      itemKey: item.key,
      selectedIndex: top.selectedIndex,
      sourceRevision: this.currentRevision(),
    })
    this.lastSelectionIntent = intent
    this.close(top.key)
    this.selectionPublisher?.publish(intent)
    callback?.(item.key)
  }

  selectionIntent(): TuiOverlaySelectionIntent | undefined {
    return this.lastSelectionIntent
  }

  projectState(): TuiTopOverlayState {
    const top = this.stack[this.stack.length - 1]
    return top ? Object.freeze({ kind: 'view', view: top }) : COMPOSER_STATE
  }

  topItems() {
    const top = this.top()
    return top ? Object.freeze([...top.items]) : Object.freeze([])
  }

  subscribe(listener: (state: TuiTopOverlayState) => void): () => void {
    if (this.disposed) throw new Error('overlay-manager-plugin: cannot subscribe after disposed state')
    if (typeof listener !== 'function') throw new TypeError('overlay-manager-plugin: listener must be a function')
    this.listeners.add(listener)
    listener(this.projectState())
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stack = Object.freeze([])
    this.callbacks.clear()
    this.listeners.clear()
    this.lastSelectionIntent = undefined
    void this.contextRef
  }

  private currentRevision(): number {
    return this.nextRevision - 1
  }

  private top(): TuiOverlayView | undefined {
    return this.stack[this.stack.length - 1]
  }

  private replaceTop(nextView: TuiOverlayView): void {
    if (this.disposed) throw new Error('overlay-manager-plugin: disposed')
    const index = this.stack.findIndex(view => view.key === nextView.key)
    if (index < 0 || index !== this.stack.length - 1) {
      throw new Error('overlay-manager-plugin: stale index; only the top view can mutate')
    }
    this.stack = Object.freeze([...this.stack.slice(0, index), freezeView(nextView)])
    this.nextRevision += 1
    this.requestRefresh()
    this.publish()
  }

  private requestRefresh(): void {
    if (!this.refreshPublisher) return
    const result = this.refreshPublisher.request({
      sourceModuleId: 'overlay-manager-plugin',
      reason: 'overlay',
      sourceRevision: Math.max(0, this.nextRevision - 1),
    })
    if (result.status === 'rejected') {
      throw new Error(`overlay-manager-plugin: refresh rejected (${result.reason}): ${result.message}`)
    }
  }

  private publish(force = true): void {
    if (!force) return
    const state = this.projectState()
    for (const listener of [...this.listeners]) listener(state)
  }
}

export function apply(ctx: Context, options?: {
  refreshPublisher?: TuiRefreshOverlayPublisher
  selectionPublisher?: TuiOverlaySelectionPublisher
}): void {
  ;(ctx as { tuiOverlayManager?: typeof ctx.tuiOverlayManager }).tuiOverlayManager =
    new TuiOverlayManagerService(ctx, options)
}
