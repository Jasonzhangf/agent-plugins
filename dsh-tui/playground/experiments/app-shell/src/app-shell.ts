import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

export const appShellServiceName = 'tuiShell' as const

export type BusinessActionKind =
  | 'session.prompt'
  | 'session.cancel'
  | 'interaction.respond'
  | 'command'

export interface BusinessAction {
  readonly kind: BusinessActionKind
  readonly actionId: string
  readonly text?: string
  readonly decision?: boolean
  readonly answer?: unknown
  readonly payload?: Readonly<Record<string, unknown>>
  readonly input?: string
}

export type AppEvent =
  | {
      readonly kind: 'terminal.submit'
      readonly sourceId: string
      readonly text: string
      readonly attachments?: readonly string[]
    }
  | {
      readonly kind: 'terminal.cancel'
      readonly sourceId: string
    }
  | {
      readonly kind: 'terminal.command'
      readonly sourceId: string
      readonly input: string
    }
  | {
      readonly kind: 'interaction.approval'
      readonly sourceId: string
      readonly decision: boolean
      readonly payload?: Readonly<Record<string, unknown>>
    }
  | {
      readonly kind: 'interaction.question'
      readonly sourceId: string
      readonly answer: unknown
      readonly payload?: Readonly<Record<string, unknown>>
    }
  | {
      readonly kind: 'terminal.resize'
      readonly sourceId: string
      readonly size: { readonly columns: number; readonly rows: number }
    }

export interface TuiShellPolicy {
  readonly composerEmpty: boolean
  readonly sessionRunning: boolean
  readonly sessionSelected: boolean
}

export interface TuiShell {
  readonly name: typeof appShellServiceName
  dispatch(event: AppEvent): void
  canExit(state: { empty: boolean; running: boolean }): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiShell: TuiShell
  }
}

const FORBIDDEN_EVENT_KEYS = new Set(['eventId', 'acceptedAt', 'transport', 'frame', 'rpcId', 'endpoint', 'sequence', 'metadata', 'control', 'retry', 'ack'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function assertNoForbiddenKeys(value: Record<string, unknown>, path: string): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_EVENT_KEYS.has(key)) {
      throw new TypeError(`app-shell: forbidden control key '${key}' at ${path}`)
    }
    const child = value[key]
    if (child !== null && typeof child === 'object') {
      assertNoForbiddenKeys(child as Record<string, unknown>, `${path}.${key}`)
    }
  }
}

function nextActionId(seq: number): string {
  return `a${String(seq)}`
}

export class TuiShellService extends Service implements TuiShell {
  readonly name = appShellServiceName
  private readonly policy: TuiShellPolicy
  private readonly dispatchAction: (action: BusinessAction) => void
  private sequence = 0

  constructor(ctx: Context, options: {
    policy: TuiShellPolicy
    dispatch: (action: BusinessAction) => void
  }) {
    super(ctx, appShellServiceName)
    this.policy = options.policy
    this.dispatchAction = options.dispatch
    ctx.effect(() => () => {
      this.sequence = 0
    }, 'app-shell.dispose')
  }

  dispatch(event: AppEvent): void {
    if (!isPlainObject(event)) {
      throw new TypeError('app-shell: event must be a plain object')
    }
    assertNoForbiddenKeys(event, 'event')
    const kind = event['kind']
    switch (kind) {
      case 'terminal.submit':
        this.assertSessionSelected()
        this.dispatchAction(this.action({
          kind: 'session.prompt',
          text: event.text,
          ...(event.attachments?.length ? { payload: { attachments: event.attachments } } : {}),
        }))
        return
      case 'terminal.cancel':
        this.assertSessionRunning()
        this.dispatchAction(this.action({ kind: 'session.cancel' }))
        return
      case 'terminal.command':
        throw new TypeError('app-shell: terminal.command is not admitted until the command resolver is bound')
      case 'interaction.approval':
        this.dispatchAction(this.action({
          kind: 'interaction.respond',
          decision: event.decision,
          ...(event.payload ? { payload: event.payload } : {}),
        }))
        return
      case 'interaction.question':
        this.dispatchAction(this.action({
          kind: 'interaction.respond',
          answer: event.answer,
          ...(event.payload ? { payload: event.payload } : {}),
        }))
        return
      case 'terminal.resize':
        throw new TypeError('app-shell: terminal.resize is control state; it must never become a business action')
      default:
        throw new TypeError(`app-shell: unknown event kind ${String(kind)}`)
    }
  }

  canExit(state: { empty: boolean; running: boolean }): boolean {
    return state.empty && !state.running
  }

  private assertSessionSelected(): void {
    if (!this.policy.sessionSelected) {
      throw new Error('app-shell: no Session is selected; submit fails closed')
    }
  }

  private assertSessionRunning(): void {
    if (!this.policy.sessionRunning) {
      throw new Error('app-shell: Session is not running; cancel fails closed')
    }
  }

  private action(partial: Omit<BusinessAction, 'kind' | 'actionId'> & { kind: BusinessActionKind }): BusinessAction {
    this.sequence += 1
    return Object.freeze({ ...partial, actionId: nextActionId(this.sequence) })
  }
}

export const name = 'app-shell'

export function apply(ctx: Context, options: {
  policy: TuiShellPolicy
  dispatch: (action: BusinessAction) => void
}): void {
  new TuiShellService(ctx, options)
}

