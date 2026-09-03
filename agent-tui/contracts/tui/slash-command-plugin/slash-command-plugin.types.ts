export interface TuiCommandInput {
  readonly text: string
  readonly sourceRevision: number
}

export type TuiCommandRejectedCode =
  | 'empty'
  | 'not-command'
  | 'unknown'
  | 'malformed-argument'
  | 'stale'
  | 'disposed'

/** Commands explicitly admitted by the TUI-to-host control contract. */
export type TuiHostCommandKind =
  | 'plan'
  | 'permission'
  | 'model'
  | 'compact'
  | 'goal'
  | 'doctor'
  | 'rename'
  | 'thinking'
  | 'feedback'
  | 'export'
export type TuiInteractiveCommandKind = 'models' | 'provider' | 'permissions' | 'workspaces' | 'search' | 'subagents' | 'queue' | 'queue-remove' | 'queue-steer' | 'queue-edit' | 'jobs' | 'trajectory' | 'trajectory-more' | 'attach' | 'copy' | 'host-info' | 'skills' | 'skill' | 'open-path' | 'browse' | 'pick-directory' | 'workspace-create' | 'workspace-rename' | 'workspace-delete' | 'archive' | 'subagent-interrupt' | 'subagent-prompt' | 'goal-pause' | 'goal-resume' | 'goal-edit' | 'goal-clear' | 'goal-info' | 'settings' | 'settings-show' | 'settings-set' | 'settings-unset' | 'settings-open' | 'session-rename' | 'agent-presets' | 'agent-preset-read' | 'agent-preset-copy' | 'agent-preset-open' | 'agent-preset-delete' | 'history-more' | 'session-info'

export type TuiCommandIntent =
  | { readonly kind: 'help'; readonly sourceRevision: number }
  | { readonly kind: 'quit'; readonly sourceRevision: number }
  | { readonly kind: 'resume'; readonly sessionId: string | null; readonly sourceRevision: number }
  | { readonly kind: 'new'; readonly sourceRevision: number }
  | { readonly kind: 'interactive'; readonly command: TuiInteractiveCommandKind; readonly args: readonly string[]; readonly sourceRevision: number }
  | {
      readonly kind: 'host'
      readonly command: TuiHostCommandKind
      readonly args: readonly string[]
      readonly sourceRevision: number
    }
  | {
      readonly kind: 'rejected'
      readonly code: TuiCommandRejectedCode
      readonly message: string
      readonly sourceRevision: number
    }

export type TuiAcceptedCommandIntent = Exclude<
  TuiCommandIntent,
  { readonly kind: 'rejected' }
>

export interface TuiSlashCommandFace {
  readonly name: 'tuiSlashCommand'
  parse(value: unknown): TuiCommandIntent
  suggest(text: string): readonly TuiSlashCommandSuggestion[]
  subscribe(listener: (intent: TuiCommandIntent) => void): () => void
  dispose(): void
}

export interface TuiSlashCommandSuggestion {
  readonly command: string
  readonly description: string
}

export function assertTuiCommandInput(value: unknown): asserts value is TuiCommandInput {
  if (!value || typeof value !== 'object') {
    throw new TypeError('slash-command-plugin: input must be an object')
  }
  const record = value as Record<string, unknown>
  if (typeof record['text'] !== 'string') {
    throw new TypeError('slash-command-plugin: input.text must be a string')
  }
  if (typeof record['sourceRevision'] !== 'number' || !Number.isInteger(record['sourceRevision']) || record['sourceRevision'] < 0 || record['sourceRevision'] > Number.MAX_SAFE_INTEGER) {
    throw new TypeError('slash-command-plugin: input.sourceRevision must be a non-negative safe integer')
  }
  for (const key of Object.keys(record)) {
    if (key !== 'text' && key !== 'sourceRevision') {
      throw new TypeError(`slash-command-plugin: unexpected input field '${key}'`)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly tuiSlashCommand?: TuiSlashCommandFace
  }
}
