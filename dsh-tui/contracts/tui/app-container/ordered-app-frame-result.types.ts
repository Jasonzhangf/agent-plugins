/**
 * Design-only v4 app-container result contract. Phase 2 binds these faces to
 * one builder and one validator; Phase 1 must not activate a runtime path.
 */

import type { TuiTerminalRegionLeaves } from '../terminal-ui/terminal-region-leaves.types.ts'
import type {
  TuiAppChromeTerminalNodes,
  TuiAppContainerFrameV3,
} from './ordered-app-frame.types.ts'

/** Composition receives the frozen pair stored by app-shell, not the pre-store validation type. */
export interface TuiAppCompositionViewport {
  readonly columns: number
  readonly rows: number
}

export interface TuiAppContainerFrameInput {
  readonly publicationRevision: number
  readonly layout: 'default' | 'compact'
  readonly regionLeaves: TuiTerminalRegionLeaves
  readonly viewport: TuiAppCompositionViewport
}

/** Owner-internal builder input assembled inside composeFrameSafe. */
export interface TuiAppContainerFrameBuildInput extends TuiAppContainerFrameInput {
  readonly chrome: TuiAppChromeTerminalNodes
}

export interface TuiAppContainerCompositionFailure {
  readonly stage: 'chrome-projection' | 'build' | 'validate'
  readonly code: 'invalid-app-container-frame'
  readonly message: string
  readonly cause: Error
}

export type TuiAppContainerCompositionResult =
  | { readonly ok: true; readonly value: TuiAppContainerFrameV3 }
  | { readonly ok: false; readonly error: TuiAppContainerCompositionFailure }

export type TuiAppChromeProjectionResult =
  | { readonly ok: true; readonly value: TuiAppChromeTerminalNodes }
  | { readonly ok: false; readonly error: TuiAppContainerCompositionFailure }

export interface TuiAppChromeProjectionInput {
  readonly publicationRevision: number
}

export interface TuiAppChromeTerminalNodeProjectorFace {
  projectChrome(input: TuiAppChromeProjectionInput): TuiAppChromeTerminalNodes
  projectChromeSafe(input: TuiAppChromeProjectionInput): TuiAppChromeProjectionResult
}

export interface TuiAppContainerFrameComposerFace {
  composeFrame(input: TuiAppContainerFrameInput): TuiAppContainerFrameV3
  composeFrameSafe(input: TuiAppContainerFrameInput): TuiAppContainerCompositionResult
}
