/**
 * Design-only v4 app-container result contract. Phase 2 binds these faces to
 * one builder and one validator; Phase 1 must not activate a runtime path.
 */

import type { TuiTerminalRegionLeaves } from '../terminal-ui/terminal-region-leaves.types.ts'
import type { TuiAppChromeTerminalNodes } from './ordered-app-frame.types.ts'
import type { TuiAppContainerFrameV3 } from './ordered-app-frame.types.ts'

/**
 * Composition-side viewport type. app-container receives the validated pair
 * forwarded by app-shell from current_terminal_viewport and never re-validates,
 * re-constructs, or imports the app-event-bus canonical type. The structural
 * shape is enough to compose the frame layout; ownership stays with
 * app-event-bus via TuiValidatedTerminalViewport and app-shell via
 * current_terminal_viewport.
 */
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

export type { TuiAppChromeTerminalNodes } from './ordered-app-frame.types.ts'
