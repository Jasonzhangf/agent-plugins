import type { TuiChromeProjectionState } from '../chrome-slot-registry/chrome-slot-registry.types.ts'
import type {
  TuiTerminalComposerState,
  TuiTerminalLocalEchoState,
  TuiTerminalModel,
  TuiTerminalOverlayState,
  TuiTerminalStatusState,
} from '../terminal-ui/terminal-shell.types.ts'
import type { TuiTerminalFrameTree } from '../terminal-ui/terminal-frame-tree.types.ts'

export type TuiAppLayoutId = 'default' | 'compact'

export type TuiAppSlotId =
  | 'header.logo'
  | 'header.connection'
  | 'header.session'
  | 'header.status'
  | 'transcript'
  | 'execution'
  | 'composer'
  | 'overlay'
  | 'footer'

export type TuiAppPresentationModel = TuiTerminalModel

export interface TuiAppViewModel {
  readonly publicationRevision: number
  readonly model: TuiAppPresentationModel
  readonly chrome: TuiAppChromeState
  readonly composer: TuiTerminalComposerState
  readonly status: TuiTerminalStatusState
  readonly localEchoes: readonly TuiTerminalLocalEchoState[]
  readonly overlay?: TuiTerminalOverlayState
}

export type TuiAppChromeState = TuiChromeProjectionState

export interface TuiAppContainerInput {
  readonly viewModel: TuiAppViewModel
  readonly width: number
  readonly scrollOffset: number
  readonly layout?: TuiAppLayoutId
}

export type TuiAppRefreshInput = TuiAppContainerInput
export type TuiAppContainerFrame = TuiTerminalFrameTree

export interface TuiAppContainerCompositionFace {
  composeFrame(input: import('./ordered-app-frame-result.types.ts').TuiAppContainerFrameInput): TuiAppContainerFrame
  composeFrameSafe(input: import('./ordered-app-frame-result.types.ts').TuiAppContainerFrameInput): import('./ordered-app-frame-result.types.ts').TuiAppContainerCompositionResult
}

export const TUI_APP_LAYOUT_SLOTS: Readonly<Record<TuiAppLayoutId, readonly TuiAppSlotId[]>> = Object.freeze({
  default: Object.freeze([
    'header.logo', 'header.connection', 'header.session', 'header.status',
    'transcript', 'execution', 'composer', 'overlay', 'footer',
  ] as readonly TuiAppSlotId[]),
  compact: Object.freeze([
    'transcript', 'execution', 'overlay', 'composer', 'header.logo', 'header.connection', 'header.session', 'header.status', 'footer',
  ] as readonly TuiAppSlotId[]),
})

export function assertAppViewModel(value: TuiAppViewModel): TuiAppViewModel {
  if (!Number.isSafeInteger(value.publicationRevision) || value.publicationRevision < 0) {
    throw new TypeError('app-container: publicationRevision must be a non-negative integer')
  }
  return value
}

export type TuiAppContainerErrorCode =
  | 'invalid-view-model'
  | 'invalid-layout'
  | 'invalid-width'
  | 'invalid-scroll-offset'
  | 'stale-frame'
  | 'invalid-slot'
  | 'disposed'

export type {
  TuiComposerMode,
  TuiTerminalNodeLifecycle,
} from '../terminal-ui/terminal-shell.types.ts'
