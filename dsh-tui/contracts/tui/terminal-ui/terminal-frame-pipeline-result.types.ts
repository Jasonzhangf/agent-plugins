/**
 * Design-only v4 terminal-ui pipeline results. Region projection and generic
 * primitive realization are independent stages and independent error sources.
 */

import type { TuiTerminalFrameTree, TuiTerminalPrimitiveNode } from './terminal-frame-tree.types.ts'
import type { TuiTerminalFooterLeaf, TuiTerminalRegionLeaves } from './terminal-region-leaves.types.ts'
import type {
  TuiTerminalComposerState,
  TuiTerminalLocalEchoState,
  TuiTerminalModel,
  TuiTerminalOverlayState,
  TuiTerminalStatusState,
} from './terminal-shell.types.ts'
import type { TuiTerminalRenderFrame } from '../terminal-render-plugin/terminal-render-plugin.types.ts'

export interface TuiTerminalRegionProjectionInput {
  readonly model: TuiTerminalModel
  readonly localEchoes: readonly TuiTerminalLocalEchoState[]
  readonly composer: TuiTerminalComposerState
  readonly status: TuiTerminalStatusState
  readonly footer: TuiTerminalFooterLeaf
  readonly subagentStatusBar?: import('./terminal-frame-tree.types.ts').TuiTerminalBoxNode
  readonly overlay?: TuiTerminalOverlayState
  readonly executionStatus?: { readonly line: string | null }
  readonly commandSuggestions?: ReadonlyArray<{ readonly command: string; readonly description: string }>
  readonly displayFrame: TuiTerminalRenderFrame
}

export interface TuiTerminalRegionProjectionFailure {
  readonly stage: 'region-projection'
  readonly code: 'invalid-terminal-region-leaves'
  readonly message: string
  readonly cause: Error
}

export type TuiTerminalRegionProjectionResult =
  | { readonly ok: true; readonly value: TuiTerminalRegionLeaves }
  | { readonly ok: false; readonly error: TuiTerminalRegionProjectionFailure }

export interface TuiTerminalRegionProjectorFace {
  project(input: TuiTerminalRegionProjectionInput): TuiTerminalRegionLeaves
  projectSafe(input: TuiTerminalRegionProjectionInput): TuiTerminalRegionProjectionResult
}

export interface TuiRealizedTerminalPrimitiveTree {
  readonly contract: 'tui.realized-terminal-primitive-tree.v1'
  readonly root: TuiTerminalPrimitiveNode
}

export interface TuiTerminalPrimitiveRealizationFailure {
  readonly stage: 'primitive-realization'
  readonly code: 'invalid-terminal-primitive-tree'
  readonly message: string
  readonly cause: Error
}

export type TuiTerminalPrimitiveRealizationResult =
  | { readonly ok: true; readonly value: TuiRealizedTerminalPrimitiveTree }
  | { readonly ok: false; readonly error: TuiTerminalPrimitiveRealizationFailure }

export interface TuiTerminalPrimitiveRealizerFace {
  realize(frame: TuiTerminalFrameTree): TuiRealizedTerminalPrimitiveTree
  realizeSafe(frame: TuiTerminalFrameTree): TuiTerminalPrimitiveRealizationResult
}
