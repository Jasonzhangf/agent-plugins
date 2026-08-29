import type { Context } from '@deepseek-ai/cordis'
import type { TuiElementDescriptor } from '../component-registry/component-registry.types.ts'

export type TuiToolCardColor = 'white' | 'blue' | 'red' | 'green' | 'dim'

export interface TuiToolCardInput {
  readonly nodeId: string
  readonly kind: string
  readonly lifecycle: 'streaming' | 'settled' | 'interrupted' | 'failed'
  readonly value: Readonly<Record<string, unknown>>
}

export interface TuiToolCardFace {
  readonly name: 'tuiToolCard'
  project(input: TuiToolCardInput): TuiElementDescriptor
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiToolCard?: TuiToolCardFace
  }
}
