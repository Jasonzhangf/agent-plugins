import type { TuiElementDescriptor } from '../component-registry/component-registry.types.ts'
import type { TuiTerminalBoxNode } from '../terminal-ui/terminal-frame-tree.types.ts'

export interface TuiSubagentStatus {
  readonly agentId: string
  readonly label: string
  readonly latestToolSummary: string
  readonly revision: number
}

export interface TuiSubagentStatusFace {
  readonly name: 'tuiSubagentStatus'
  update(status: TuiSubagentStatus): void
  remove(agentId: string): void
  project(): readonly TuiElementDescriptor[]
  projectTerminalBar(): TuiTerminalBoxNode | undefined
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiSubagentStatus?: TuiSubagentStatusFace
  }
}
