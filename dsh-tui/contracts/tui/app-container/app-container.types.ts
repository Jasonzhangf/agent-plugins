import type { LogicControlProjection } from '../logic-controls/logic-controls.types.ts'
import type {
  TuiComposerMode,
  TuiInkTreeComposed,
  TuiTerminalComposerState,
  TuiTerminalLocalEchoState,
  TuiTerminalNodeLifecycle,
  TuiTerminalOverlayState,
  TuiTerminalStatusState,
  TuiTerminalShellDescriptor,
  TuiTerminalModel,
  TuiTerminalUiCompositionFace,
} from '../terminal-ui/terminal-shell.types.ts'

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
  readonly controls: readonly LogicControlProjection[]
  readonly chrome: TuiAppChromeState
  readonly composer: TuiTerminalComposerState
  readonly status: TuiTerminalStatusState
  readonly localEchoes: readonly TuiTerminalLocalEchoState[]
  readonly overlay?: TuiTerminalOverlayState
}

export interface TuiAppChromeState {
  readonly logoVariant: 'full' | 'compact'
  readonly logoVisible: boolean
  readonly connectionState: 'connecting' | 'connected' | 'disconnected' | 'failed'
  readonly executionState: 'idle' | 'running' | 'completed' | 'failed'
}

export type TuiAppTerminalUiComposer = Pick<TuiTerminalUiCompositionFace, 'composeInkTree'>

export interface TuiAppContainerInput {
  readonly viewModel: TuiAppViewModel
  readonly width: number
  readonly scrollOffset: number
  readonly layout?: TuiAppLayoutId
}

export interface TuiAppContainerComposeInput {
  readonly model: TuiAppPresentationModel
  readonly composer?: TuiTerminalComposerState
  readonly status?: TuiTerminalStatusState
  readonly width?: number
  readonly scrollOffset?: number
  readonly localEchoes?: readonly TuiTerminalLocalEchoState[]
  readonly overlay?: TuiTerminalOverlayState
}

export interface TuiAppRefreshInput extends TuiAppContainerInput {
  readonly reason: 'model' | 'resize' | 'focus' | 'overlay' | 'layout'
}

export interface TuiAppContainerMetadata {
  readonly contract: 'tui.app-container.v1'
  readonly layout: TuiAppLayoutId
  readonly slots: readonly TuiAppSlotId[]
  readonly logoVariant: 'full' | 'compact'
  readonly logoVisible: boolean
  readonly connectionState: 'connecting' | 'connected' | 'disconnected' | 'failed'
  readonly executionState: 'idle' | 'running' | 'completed' | 'failed'
}

export interface TuiAppLayoutDescriptor extends TuiTerminalShellDescriptor {
  readonly appContainer: TuiAppContainerMetadata
}

export interface TuiAppContainerFrame extends TuiInkTreeComposed {
  readonly descriptor: TuiAppLayoutDescriptor
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
  const keys = new Set(value.controls.map(control => control.stableKey))
  if (keys.size !== value.controls.length) throw new TypeError('app-container: duplicate control projection key')
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

export type { TuiComposerMode, TuiTerminalNodeLifecycle }
