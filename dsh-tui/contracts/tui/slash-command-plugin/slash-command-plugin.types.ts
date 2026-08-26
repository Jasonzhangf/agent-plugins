export type TuiCommandName = 'help' | 'resume' | 'quit'

export const tuiCommandNames = Object.freeze([
  'help',
  'resume',
  'quit',
] as const satisfies ReadonlyArray<TuiCommandName>)

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

export type TuiCommandIntent =
  | { readonly kind: 'help'; readonly sourceRevision: number }
  | { readonly kind: 'quit'; readonly sourceRevision: number }
  | { readonly kind: 'resume'; readonly sessionId: string | null; readonly sourceRevision: number }
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
  subscribe(listener: (intent: TuiCommandIntent) => void): () => void
  dispose(): void
}

export function isTuiCommandName(value: unknown): value is TuiCommandName {
  return typeof value === 'string' && (tuiCommandNames as ReadonlyArray<string>).includes(value)
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
