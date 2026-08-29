import { Service, type Context } from '@deepseek-ai/cordis'
import type { TuiOverlayManagerFace } from '../../../../contracts/tui/overlay-manager-plugin/overlay-manager-plugin.types.ts'
import type { TuiInteractiveResult, TuiInteractiveWindowFace, TuiInteractiveWindowInput } from '../../../../contracts/tui/interactive-window-plugin/interactive-window-plugin.types.ts'

export const tuiInteractiveWindowName = 'tuiInteractiveWindow' as const
const overlayKind = (kind: TuiInteractiveWindowInput['kind']): 'approval-question' | 'selector.model' | 'selector.provider' | 'selector.permission' => kind === 'approval' || kind === 'ask' ? 'approval-question' : kind === 'models' ? 'selector.model' : kind === 'provider' ? 'selector.provider' : 'selector.permission'
function assertInput(input: TuiInteractiveWindowInput): void {
  if (!input || typeof input !== 'object' || !['approval', 'ask', 'models', 'provider', 'permissions'].includes(input.kind) || !input.key || !input.title || !Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 0 || !Array.isArray(input.items) || input.items.length === 0) throw new TypeError('interactive-window-plugin: invalid closed input')
  if (input.selectedIndex !== undefined && (!Number.isSafeInteger(input.selectedIndex) || input.selectedIndex < 0 || input.selectedIndex >= input.items.length)) throw new TypeError('interactive-window-plugin: selectedIndex is out of bounds')
  for (const item of input.items) if (!item || typeof item.key !== 'string' || item.key.length === 0 || typeof item.label !== 'string' || item.label.length === 0) throw new TypeError('interactive-window-plugin: invalid item')
}
export class TuiInteractiveWindowService extends Service implements TuiInteractiveWindowFace {
  readonly name = tuiInteractiveWindowName
  private current: { readonly input: TuiInteractiveWindowInput; readonly close: () => void } | undefined
  private lastResult: TuiInteractiveResult | undefined
  private overlayDispose: (() => void) | undefined
  private disposed = false
  constructor(private readonly contextRef: Context) {
    super(contextRef, tuiInteractiveWindowName)
    const overlay = contextRef.tuiOverlayManager
    this.overlayDispose = overlay?.subscribe(state => {
      if (this.current === undefined || this.lastResult !== undefined) return
      if (state.kind !== 'view' || state.view.key !== this.current.input.key) {
        const selection = contextRef.tuiOverlayManager?.selectionIntent()
        if (selection?.viewKey === this.current.input.key
          && selection.sourceRevision === this.current.input.sourceRevision) return
        this.current = undefined
      }
    })
    contextRef.effect(() => () => this.dispose(), 'interactive-window-plugin.dispose')
  }
  open(input: TuiInteractiveWindowInput, onSelect?: (itemKey: string) => void): () => void {
    if (this.disposed) throw new Error('interactive-window-plugin: disposed')
    assertInput(input); const overlay = this.contextRef.tuiOverlayManager as TuiOverlayManagerFace | undefined
    if (!overlay) throw new Error('interactive-window-plugin: overlay manager is unavailable')
    this.current?.close()
    const close = overlay.open({ kind: overlayKind(input.kind), key: input.key, title: input.title, items: input.items, ...(input.selectedIndex === undefined ? {} : { selectedIndex: input.selectedIndex }), closable: true, sourceRevision: input.sourceRevision }, itemKey => {
      this.lastResult = Object.freeze({ kind: input.kind, key: input.key, itemKey, sourceRevision: input.sourceRevision })
      // overlay.select() has already removed this view before invoking the
      // callback. Keep the typed result available to submit(), but make a
      // subsequent window replacement a no-op close instead of closing the
      // consumed overlay a second time.
      if (this.current?.input.key === input.key) this.current = { input, close: () => undefined }
      onSelect?.(itemKey)
    })
    this.current = { input, close }; return () => { if (this.current?.input.key === input.key) { close(); this.current = undefined } }
  }
  submit(): TuiInteractiveResult {
    const current = this.current; if (!current) throw new Error('interactive-window-plugin: no active window')
    const result = this.lastResult; if (!result || result.key !== current.input.key) throw new Error('interactive-window-plugin: no selection result')
    this.current = undefined; this.lastResult = undefined; return result
  }
  cancel(): void { if (!this.current) throw new Error('interactive-window-plugin: no active window'); this.current.close(); this.current = undefined; this.lastResult = undefined }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.overlayDispose?.()
    this.overlayDispose = undefined
    this.current?.close()
    this.current = undefined
    this.lastResult = undefined
  }
}
export function apply(ctx: Context): void { ctx.tuiInteractiveWindow = new TuiInteractiveWindowService(ctx) }
