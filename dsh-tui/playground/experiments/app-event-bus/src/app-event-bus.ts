import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { TuiValidatedTerminalViewport } from '../../../../contracts/tui/app-event-bus/validated-terminal-viewport.types.ts'

export const appEventBusServiceName = 'tuiEventBus' as const
export type { TuiValidatedTerminalViewport }

export interface TerminalIntentBase {
  readonly sourceId: string
}

export interface SubmitIntent extends TerminalIntentBase {
  readonly kind: 'terminal.submit'
  readonly text: string
  readonly attachments?: readonly string[]
}

export interface CancelIntent extends TerminalIntentBase {
  readonly kind: 'terminal.cancel'
}

export interface CommandIntent extends TerminalIntentBase {
  readonly kind: 'terminal.command'
  readonly input: string
}

export interface FocusIntent extends TerminalIntentBase {
  readonly kind: 'focus.activate'
  readonly target: string
}

export interface ApprovalIntent extends TerminalIntentBase {
  readonly kind: 'interaction.approval'
  readonly decision: boolean
  readonly payload?: Readonly<Record<string, unknown>>
}

export interface QuestionIntent extends TerminalIntentBase {
  readonly kind: 'interaction.question'
  readonly answer: unknown
  readonly payload?: Readonly<Record<string, unknown>>
}

export interface ResizeIntent extends TerminalIntentBase {
  readonly kind: 'terminal.resize'
  readonly size: TuiValidatedTerminalViewport
}

export type TuiInputIn01TerminalIntent =
  | SubmitIntent
  | CancelIntent
  | CommandIntent
  | FocusIntent
  | ApprovalIntent
  | QuestionIntent
  | ResizeIntent

export interface TuiInputIn02AppEvent {
  readonly eventId: string
  readonly acceptedAt: number
  readonly intent: TuiInputIn01TerminalIntent
}

const intentKinds = new Set([
  'terminal.submit',
  'terminal.cancel',
  'terminal.command',
  'focus.activate',
  'interaction.approval',
  'interaction.question',
  'terminal.resize',
])

const fieldsByIntentKind: Readonly<Record<TuiInputIn01TerminalIntent['kind'], ReadonlySet<string>>> = Object.freeze({
  'terminal.submit': new Set(['kind', 'sourceId', 'text', 'attachments']),
  'terminal.cancel': new Set(['kind', 'sourceId']),
  'terminal.command': new Set(['kind', 'sourceId', 'input']),
  'focus.activate': new Set(['kind', 'sourceId', 'target']),
  'interaction.approval': new Set(['kind', 'sourceId', 'decision', 'payload']),
  'interaction.question': new Set(['kind', 'sourceId', 'answer', 'payload']),
  'terminal.resize': new Set(['kind', 'sourceId', 'size']),
})

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function validateViewportSize(value: unknown): asserts value is TuiValidatedTerminalViewport {
  if (!isPlainObject(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('terminal.resize requires positive integer columns and rows')
  }
  if (Reflect.ownKeys(value).length !== 2
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || (key !== 'columns' && key !== 'rows'))) {
    throw new TypeError('terminal.resize requires exactly columns and rows')
  }
  const columns = value['columns']
  const rows = value['rows']
  if (typeof columns !== 'number' || !Number.isSafeInteger(columns) || columns <= 0
    || typeof rows !== 'number' || !Number.isSafeInteger(rows) || rows <= 0) {
    throw new TypeError('terminal.resize requires positive integer columns and rows')
  }
  value = Object.freeze({ columns, rows })
}

export function validateTerminalIntent(value: unknown): asserts value is TuiInputIn01TerminalIntent {
  if (!isPlainObject(value)) {
    throw new TypeError('TuiInputIn01TerminalIntent must be a plain object')
  }
  const kind = value['kind']
  if (typeof kind !== 'string' || !intentKinds.has(kind)) {
    throw new TypeError(`TuiInputIn01TerminalIntent kind is not in the closed family: ${String(kind)}`)
  }
  if (typeof value['sourceId'] !== 'string' || value['sourceId'].length === 0) {
    throw new TypeError('TuiInputIn01TerminalIntent requires a non-empty sourceId')
  }
  const allowedFields = fieldsByIntentKind[kind as TuiInputIn01TerminalIntent['kind']]
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      throw new TypeError(`TuiInputIn01TerminalIntent ${kind} has unexpected field '${field}'`)
    }
  }
  switch (kind) {
    case 'terminal.submit': {
      if (typeof value['text'] !== 'string') throw new TypeError('terminal.submit requires text: string')
      if (value['attachments'] !== undefined
        && (!Array.isArray(value['attachments']) || !value['attachments'].every(item => typeof item === 'string'))) {
        throw new TypeError('terminal.submit attachments must be a string array when present')
      }
      return
    }
    case 'terminal.command': {
      if (typeof value['input'] !== 'string') throw new TypeError('terminal.command requires input: string')
      return
    }
    case 'focus.activate': {
      if (typeof value['target'] !== 'string' || value['target'].length === 0) {
        throw new TypeError('focus.activate requires a non-empty target')
      }
      return
    }
    case 'interaction.approval': {
      if (typeof value['decision'] !== 'boolean') {
        throw new TypeError('interaction.approval requires decision: boolean')
      }
      return
    }
    case 'interaction.question': {
      if (!Object.hasOwn(value, 'answer')) {
        throw new TypeError('interaction.question requires answer')
      }
      return
    }
    case 'terminal.resize': {
      const size = value['size']
      validateViewportSize(size)
      const canonicalPair = Object.freeze({ columns: size.columns, rows: size.rows })
      value = Object.freeze({ ...value, size: canonicalPair })
      return
    }
    default:
      return
  }
}

export interface TuiAppEventBus {
  readonly name: typeof appEventBusServiceName
  subscribe(listener: (event: TuiInputIn02AppEvent) => void): () => void
  publish(intent: TuiInputIn01TerminalIntent, eventId?: string, acceptedAt?: number): TuiInputIn02AppEvent
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiEventBus: TuiAppEventBus
  }
}

export class TuiAppEventBusService extends Service implements TuiAppEventBus {
  readonly name = appEventBusServiceName
  private listeners = new Set<(event: TuiInputIn02AppEvent) => void>()

  constructor(ctx: Context) {
    super(ctx, appEventBusServiceName)
    ctx.effect(() => () => this.listeners.clear(), 'app-event-bus.listeners')
  }

  subscribe(listener: (event: TuiInputIn02AppEvent) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('subscribe requires a function listener')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(
    intent: TuiInputIn01TerminalIntent,
    eventId = crypto.randomUUID(),
    acceptedAt = Date.now(),
  ): TuiInputIn02AppEvent {
    validateTerminalIntent(intent)
    const event: TuiInputIn02AppEvent = Object.freeze({ eventId, acceptedAt, intent })
    for (const listener of [...this.listeners]) listener(event)
    return event
  }
}

export const name = 'app-event-bus'

export function apply(ctx: Context): void {
  new TuiAppEventBusService(ctx)
}
