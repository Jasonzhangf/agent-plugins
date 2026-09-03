import type { Context } from '@deepseek-ai/cordis'
export type MarkdownMode = 'streaming' | 'settled'
export type MarkdownSemanticToken = string
export interface TuiMarkdownTextInput { readonly text: string; readonly mode: MarkdownMode }
export interface TuiTextParserFace {
  readonly name: 'tuiTextParser'
  parse(input: TuiMarkdownTextInput): readonly MarkdownSemanticToken[]
  parseIncremental(text: string): readonly MarkdownSemanticToken[]
  dispose(): void
}
declare module '@deepseek-ai/cordis' { interface Context { tuiTextParser?: TuiTextParserFace } }
