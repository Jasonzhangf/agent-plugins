import type { Context } from '@deepseek-ai/cordis'
import type { TuiViewNodeAny } from '../presentation/presentation.types.ts'

export type TuiDisplayStyle = 'white' | 'tool' | 'thinking' | 'blue' | 'red' | 'green' | 'dim'

export interface TuiDisplaySpan {
  readonly text: string
  readonly style: TuiDisplayStyle
  readonly backgroundColor?: 'gray'
}

export interface TuiDisplayLine {
  readonly spans: readonly TuiDisplaySpan[]
}

export interface TuiDisplayElement {
  readonly elementId: string
  readonly sourceId: string
  readonly semanticKind: string
  readonly lifecycle: 'stable' | 'live'
  readonly lines: readonly TuiDisplayLine[]
}

export interface TuiInterpreterFace {
  readonly name: 'tuiInterpreter'
  interpret(node: TuiViewNodeAny): TuiDisplayElement
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { tuiInterpreter?: TuiInterpreterFace }
}
