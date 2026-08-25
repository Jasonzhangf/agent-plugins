import { Service, type Context } from '@deepseek-ai/cordis'
import {
  assertTuiCommandInput,
  isTuiCommandName,
  type TuiCommandIntent,
  type TuiSlashCommandFace,
} from '../../../../contracts/tui/slash-command-plugin/slash-command-plugin.types.ts'

export const tuiSlashCommandName = 'tuiSlashCommand' as const

const RESERVED_NAMES: ReadonlySet<string> = new Set(['help', 'resume', 'quit'])

function tokenize(text: string): string[] {
  return text.split(/\s+/u).filter(token => token.length > 0)
}

function parseName(token: string | undefined): { ok: true; name: 'help' | 'resume' | 'quit' } | { ok: false; code: 'not-command' | 'unknown' } {
  if (token === undefined || token.length === 0) return { ok: false, code: 'not-command' }
  if (!token.startsWith('/')) return { ok: false, code: 'not-command' }
  const name = token.slice(1)
  if (!isTuiCommandName(name)) return { ok: false, code: 'unknown' }
  return { ok: true, name }
}

export class TuiSlashCommandService extends Service implements TuiSlashCommandFace {
  readonly name = tuiSlashCommandName
  private readonly listeners = new Set<(intent: TuiCommandIntent) => void>()
  private disposed = false
  private latestRevision = 0

  constructor(private readonly context: Context) {
    super(context, tuiSlashCommandName)
    context.effect(() => () => this.dispose(), 'slash-command-plugin.dispose')
  }

  parse(value: unknown): TuiCommandIntent {
    if (this.disposed) {
      throw new Error('slash-command-plugin: cannot parse after disposed state')
    }
    assertTuiCommandInput(value)
    const intent = this.evaluateIntent(value.text, value.sourceRevision)
    for (const listener of [...this.listeners]) listener(intent)
    return intent
  }

  subscribe(listener: (intent: TuiCommandIntent) => void): () => void {
    if (this.disposed) throw new Error('slash-command-plugin: cannot subscribe after disposed state')
    if (typeof listener !== 'function') throw new TypeError('slash-command-plugin: listener must be a function')
    this.listeners.add(listener)
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
    this.listeners.clear()
    void this.context
  }

  private evaluateIntent(text: string, sourceRevision: number): TuiCommandIntent {
    if (typeof text !== 'string') {
      return Object.freeze({ kind: 'rejected', code: 'empty', message: 'slash-command-plugin: composer text must be a string', sourceRevision })
    }
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      return Object.freeze({ kind: 'rejected', code: 'empty', message: 'slash-command-plugin: composer text is empty', sourceRevision })
    }
    const tokens = tokenize(trimmed)
    const head = tokens[0]
    const parsed = parseName(head)
    if (!parsed.ok) {
      return Object.freeze({
        kind: 'rejected',
        code: parsed.code,
        message: `slash-command-plugin: ${parsed.code === 'not-command' ? 'composer text is not a slash command' : 'unknown slash command'}`,
        sourceRevision,
      })
    }
    if (sourceRevision < this.latestRevision) {
      return Object.freeze({
        kind: 'rejected',
        code: 'stale',
        message: `slash-command-plugin: stale sourceRevision ${String(sourceRevision)}; latest is ${String(this.latestRevision)}`,
        sourceRevision,
      })
    }
    this.latestRevision = sourceRevision
    const args = tokens.slice(1)
    if (parsed.name === 'resume') {
      if (args.length === 0) {
        return Object.freeze({
          kind: 'resume',
          sessionId: null,
          sourceRevision,
        })
      }
      if (args.length > 1) {
        return Object.freeze({
          kind: 'rejected',
          code: 'malformed-argument',
          message: 'slash-command-plugin: /resume requires at most one argument',
          sourceRevision,
        })
      }
      const [sessionId] = args
      if (typeof sessionId !== 'string' || sessionId.length === 0 || /\s/u.test(sessionId)) {
        return Object.freeze({
          kind: 'rejected',
          code: 'malformed-argument',
          message: 'slash-command-plugin: /resume argument must be a non-empty token without whitespace',
          sourceRevision,
        })
      }
      return Object.freeze({ kind: 'resume', sessionId, sourceRevision })
    }
    return Object.freeze({ kind: parsed.name, sourceRevision })
  }
}

export function apply(ctx: Context): void {
  ;(ctx as { tuiSlashCommand?: typeof ctx.tuiSlashCommand }).tuiSlashCommand = new TuiSlashCommandService(ctx)
}

export const reservedSlashCommandNames = Object.freeze([...RESERVED_NAMES] as const)
