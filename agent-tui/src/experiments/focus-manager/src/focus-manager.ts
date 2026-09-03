import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { TUI_FOCUS_VIEWS } from '../../../../contracts/tui/focus-manager/focus-manager.types.ts'

export const focusManagerServiceName = 'tuiFocusManager' as const

export const KNOWN_VIEWS = new Set<string>(TUI_FOCUS_VIEWS)

export type TuiFocusView = string

export interface TuiFocusState {
  readonly activeView: TuiFocusView
  readonly focusOwner: TuiFocusView
  readonly priority: string
  readonly stack: readonly TuiFocusView[]
}

const PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  fatal: 6,
  approval: 5,
  question: 5,
  selector: 4,
  command: 3,
  queue: 2,
  composer: 1,
})

function priorityOf(view: string): string {
  if (view.startsWith('overlay.')) return 'fatal'
  if (view === 'interaction.approval' || view === 'interaction.question') return view.startsWith('interaction.approval') ? 'approval' : 'question'
  if (view.startsWith('selector.')) return 'selector'
  if (view === 'composer.command-picker') return 'command'
  if (view === 'composer.queue') return 'queue'
  return 'composer'
}

function assertKnownView(view: unknown): asserts view is TuiFocusView {
  if (typeof view !== 'string' || !KNOWN_VIEWS.has(view)) {
    throw new TypeError(`focus-manager: unknown view ${String(view)}`)
  }
}

function priorityRank(view: string): number {
  const key = priorityOf(view)
  return PRIORITY[key] ?? 0
}

export interface TuiFocusManager {
  readonly name: typeof focusManagerServiceName
  viewState(): TuiFocusState
  pushView(view: TuiFocusView): () => void
  activate(view: TuiFocusView): TuiFocusState
  activeKeyHandler(): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiFocusManager: TuiFocusManager
  }
}

export class TuiFocusManagerService extends Service implements TuiFocusManager {
  readonly name = focusManagerServiceName
  private readonly stack: TuiFocusView[] = ['composer.editor']
  private readonly keys: Set<string> = new Set()

  constructor(ctx: Context) {
    super(ctx, focusManagerServiceName)
    ctx.effect(() => () => {
      this.stack.length = 0
      this.keys.clear()
    }, 'focus-manager.dispose')
  }

  viewState(): TuiFocusState {
    const activeView = this.stack[this.stack.length - 1] ?? 'composer.editor'
    return Object.freeze({
      activeView,
      focusOwner: activeView,
      priority: priorityOf(activeView),
      stack: Object.freeze([...this.stack]),
    })
  }

  pushView(view: TuiFocusView): () => void {
    assertKnownView(view)
    this.stack.push(view)
    let active = true
    return () => {
      if (!active) return
      active = false
      const index = this.stack.lastIndexOf(view)
      if (index >= 0) {
        this.stack.splice(index, 1)
      }
    }
  }

  activate(view: TuiFocusView): TuiFocusState {
    assertKnownView(view)
    const index = this.stack.indexOf(view)
    if (index >= 0) {
      this.stack.splice(index, 1)
    }
    this.stack.push(view)
    return this.viewState()
  }

  activeKeyHandler(): string {
    return priorityOf(this.viewState().activeView)
  }
}

export const name = 'focus-manager'

export function apply(ctx: Context): void {
  new TuiFocusManagerService(ctx)
}
