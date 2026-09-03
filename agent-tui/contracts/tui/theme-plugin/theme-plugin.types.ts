import type { Context } from '@deepseek-ai/cordis'

export type TuiSemanticColor = 'white' | 'tool' | 'thinking' | 'blue' | 'red' | 'green' | 'yellow'
export type TuiThemeColor = TuiSemanticColor | 'dim' | 'black' | 'gray' | 'dark-gray'

export interface TuiSemanticStyle {
  readonly color?: TuiSemanticColor
  readonly bold?: boolean
  readonly italic?: boolean
  readonly dimColor?: boolean
}

export interface TuiThemeFace {
  readonly name: 'tuiTheme'
  styleForSemanticKind(kind: string): TuiSemanticStyle
  resolveColor(color: TuiThemeColor): string
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { tuiTheme?: TuiThemeFace }
}
