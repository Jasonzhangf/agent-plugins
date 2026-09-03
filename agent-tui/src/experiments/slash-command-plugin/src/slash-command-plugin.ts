import { Service, type Context } from '@deepseek-ai/cordis'
import {
  assertTuiCommandInput,
  type TuiCommandIntent,
  type TuiSlashCommandFace,
  type TuiSlashCommandSuggestion,
  type TuiHostCommandKind,
  type TuiInteractiveCommandKind,
} from '../../../../contracts/tui/slash-command-plugin/slash-command-plugin.types.ts'

export const tuiSlashCommandName = 'tuiSlashCommand' as const

// TUI-owned commands: handled entirely within startup.ts dispatchControl
const TUI_OWNED_NAMES: ReadonlySet<string> = new Set(['help', 'resume', 'quit', 'new'])
const INTERACTIVE_NAMES: ReadonlySet<string> = new Set(['models', 'provider', 'permissions', 'workspaces', 'subagents', 'search', 'queue', 'queue-remove', 'queue-steer', 'queue-edit', 'jobs', 'trajectory', 'trajectory-more', 'attach', 'copy', 'host-info', 'skills', 'skill', 'open-path', 'browse', 'pick-directory', 'workspace-create', 'workspace-rename', 'workspace-delete', 'archive', 'subagent-interrupt', 'subagent-prompt', 'goal-pause', 'goal-resume', 'goal-edit', 'goal-clear', 'goal-info', 'settings', 'settings-show', 'settings-set', 'settings-unset', 'settings-open', 'session-rename', 'agent-presets', 'agent-preset-read', 'agent-preset-copy', 'agent-preset-open', 'agent-preset-delete', 'history-more', 'session-info'])
const HOST_COMMANDS: Readonly<Record<TuiHostCommandKind, { readonly minArgs: number; readonly maxArgs: number }>> = Object.freeze({
  plan: { minArgs: 0, maxArgs: Number.MAX_SAFE_INTEGER },
  permission: { minArgs: 1, maxArgs: 1 },
  model: { minArgs: 1, maxArgs: 1 },
  compact: { minArgs: 0, maxArgs: 0 },
  goal: { minArgs: 0, maxArgs: Number.MAX_SAFE_INTEGER },
  doctor: { minArgs: 0, maxArgs: 0 },
  rename: { minArgs: 1, maxArgs: Number.MAX_SAFE_INTEGER },
  thinking: { minArgs: 1, maxArgs: 1 },
  feedback: { minArgs: 1, maxArgs: Number.MAX_SAFE_INTEGER },
  export: { minArgs: 0, maxArgs: 1 },
})
const COMMAND_SUGGESTIONS: ReadonlyArray<TuiSlashCommandSuggestion> = Object.freeze([
  { command: '/help', description: 'show available commands' },
  { command: '/new', description: 'create a new Session in the current cwd' },
  { command: '/resume', description: 'choose a Session from the current cwd' },
  { command: '/models', description: 'choose a model and thinking effort' },
  { command: '/provider', description: 'choose a provider and model' },
  { command: '/thinking', description: 'choose thinking effort' },
  { command: '/feedback', description: 'record feedback about this Session' },
  { command: '/export', description: 'export the current Session log' },
  { command: '/permissions', description: 'choose the current approval permission' },
  { command: '/workspaces', description: 'show registered workspaces' },
  { command: '/subagents', description: 'show subagent activity' },
  { command: '/search', description: 'search session history' },
  { command: '/workspace-create', description: 'register a workspace path' },
  { command: '/workspace-rename', description: 'rename a registered workspace' },
  { command: '/workspace-delete', description: 'remove a workspace registration' },
  { command: '/archive', description: 'archive the current Session' },
  { command: '/subagent-interrupt', description: 'interrupt a continuable subagent' },
  { command: '/subagent-prompt', description: 'send a prompt to a continuable subagent' },
  { command: '/goal-pause', description: 'pause the current goal' },
  { command: '/goal-resume', description: 'resume the current goal' },
  { command: '/goal-edit', description: 'edit the current goal objective' },
  { command: '/goal-clear', description: 'clear the current goal' },
  { command: '/goal-info', description: 'show current goal details' },
  { command: '/settings', description: 'show available settings namespaces' },
  { command: '/settings-show', description: 'show one settings namespace in detail' },
  { command: '/settings-set', description: 'set a JSON settings field' },
  { command: '/settings-unset', description: 'remove a settings field override' },
  { command: '/settings-open', description: 'open the settings document' },
  { command: '/session-rename', description: 'rename the current Session directly' },
  { command: '/agent-presets', description: 'show available agent presets' },
  { command: '/agent-preset-read', description: 'read an agent preset composition' },
  { command: '/agent-preset-copy', description: 'copy an agent preset' },
  { command: '/agent-preset-open', description: 'open an agent preset for editing' },
  { command: '/agent-preset-delete', description: 'delete a user agent preset' },
  { command: '/history-more', description: 'load an older page of Session history' },
  { command: '/session-info', description: 'show current Session state' },
  { command: '/queue', description: 'show pending Session input' },
  { command: '/queue-remove', description: 'remove one pending Session input' },
  { command: '/queue-steer', description: 'steer one pending Session input' },
  { command: '/queue-edit', description: 'edit one pending Session input' },
  { command: '/jobs', description: 'show background jobs for this Session' },
  { command: '/trajectory', description: 'show the Session event trajectory' },
  { command: '/trajectory-more', description: 'load older events into the trajectory' },
  { command: '/attach', description: 'send an image file with optional text' },
  { command: '/copy', description: 'copy an assistant message to the terminal clipboard' },
  { command: '/host-info', description: 'show Host version and connection state' },
  { command: '/skills', description: 'show available project skills' },
  { command: '/skill', description: 'invoke a project skill' },
  { command: '/open-path', description: 'open a file or directory with the OS' },
  { command: '/browse', description: 'browse Host directories' },
  { command: '/pick-directory', description: 'pick and register a Workspace directory' },
  { command: '/plan', description: 'set plan mode' },
  { command: '/permission', description: 'set a permission preset' },
  { command: '/model', description: 'switch model' },
  { command: '/compact', description: 'compact session history' },
  { command: '/goal', description: 'run a goal command' },
  { command: '/doctor', description: 'check configuration' },
  { command: '/rename', description: 'rename the current Session' },
  { command: '/quit', description: 'restore the terminal and exit' },
])

function tokenize(text: string): string[] {
  return text.split(/\s+/u).filter(token => token.length > 0)
}

function parseName(token: string | undefined): {
  ok: true
  name: 'help' | 'resume' | 'quit' | 'new' | TuiHostCommandKind
} | { ok: false; code: 'not-command' | 'unknown' } {
  if (token === undefined || token.length === 0) return { ok: false, code: 'not-command' }
  if (!token.startsWith('/')) return { ok: false, code: 'not-command' }
  const name = token.slice(1)
  if (!/^[a-z][a-z0-9_-]*$/u.test(name)) return { ok: false, code: 'unknown' }
  return { ok: true, name: name as 'help' | 'resume' | 'quit' | 'new' | TuiHostCommandKind }
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

  suggest(text: string): readonly TuiSlashCommandSuggestion[] {
    if (this.disposed) throw new Error('slash-command-plugin: cannot suggest after disposed state')
    if (typeof text !== 'string' || !text.startsWith('/') || /\s/u.test(text)) return Object.freeze([])
    const query = text.toLowerCase()
    return Object.freeze(COMMAND_SUGGESTIONS.filter(item => item.command.startsWith(query)))
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
        message: parsed.code === 'not-command'
          ? 'slash-command-plugin: composer text is not a slash command'
          : 'slash-command-plugin: unknown slash command: ' + tokens[0],
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

    // Host commands → typed host intent; the Host owns registry resolution.
    if (INTERACTIVE_NAMES.has(parsed.name)) {
      return Object.freeze({ kind: 'interactive', command: parsed.name as TuiInteractiveCommandKind, args: Object.freeze([...args]), sourceRevision })
    }
    if (!TUI_OWNED_NAMES.has(parsed.name)) {
      if (!Object.hasOwn(HOST_COMMANDS, parsed.name)) {
        return Object.freeze({
          kind: 'rejected',
          code: 'unknown',
          message: 'slash-command-plugin: unknown slash command: ' + tokens[0],
          sourceRevision,
        })
      }
      const schema = HOST_COMMANDS[parsed.name as TuiHostCommandKind]
      if (args.length < schema.minArgs || args.length > schema.maxArgs) {
        return Object.freeze({
          kind: 'rejected',
          code: 'malformed-argument',
          message: `slash-command-plugin: /${parsed.name} argument count is outside the admitted schema`,
          sourceRevision,
        })
      }
      return Object.freeze({
        kind: 'host',
        command: parsed.name as TuiHostCommandKind,
        args: Object.freeze([...args]),
        sourceRevision,
      })
    }

    // /new → create a new session (TUI-owned, handled in startup.ts)
    if (parsed.name === 'new') {
      return Object.freeze({ kind: 'new', sourceRevision })
    }

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

    // /help and /quit
    return Object.freeze({ kind: parsed.name as 'help' | 'quit', sourceRevision })
  }
}

export function apply(ctx: Context): void {
  ;(ctx as { tuiSlashCommand?: typeof ctx.tuiSlashCommand }).tuiSlashCommand = new TuiSlashCommandService(ctx)
}

// Keep for backwards compatibility
export const reservedSlashCommandNames = Object.freeze([...TUI_OWNED_NAMES] as const)
