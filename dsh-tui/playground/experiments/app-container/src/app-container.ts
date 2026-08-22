import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  TuiAppContainerFrame,
  TuiAppContainerInput,
  TuiAppRefreshInput,
  TuiAppLayoutDescriptor,
  TuiAppLayoutId,
  TuiAppSlotId,
  TuiAppPresentationModel,
  TuiAppViewModel,
  TuiAppTerminalUiComposer,
  TuiAppChromeState,
  TuiAppContainerComposeInput,
} from '../../../../contracts/tui/app-container/app-container.types.ts'
import {
  TUI_APP_LAYOUT_SLOTS,
  assertAppViewModel,
} from '../../../../contracts/tui/app-container/app-container.types.ts'
import type {
  TuiTerminalComposerState,
  TuiTerminalLocalEchoState,
  TuiTerminalOverlayState,
  TuiTerminalStatusState,
} from '../../../../contracts/tui/terminal-ui/terminal-shell.types.ts'
import type {
  TuiChromeProjectionState,
  TuiChromeSlotRegistryFace,
} from '../../../../contracts/tui/chrome-controls/chrome-controls.types.ts'
export const tuiAppContainerServiceName = 'tuiAppContainer' as const

export interface TuiAppContainer {
  readonly name: typeof tuiAppContainerServiceName
  readonly layout: TuiAppLayoutId
  setLayout(layout: TuiAppLayoutId): void
  compose(input: TuiAppContainerInput): TuiAppContainerFrame
  refresh(input: TuiAppRefreshInput): TuiAppContainerFrame
  composeInkTree(input: {
    readonly model: TuiAppPresentationModel
    readonly composer?: TuiTerminalComposerState
    readonly status?: TuiTerminalStatusState
    readonly width?: number
    readonly scrollOffset?: number
    readonly localEchoes?: readonly TuiTerminalLocalEchoState[]
    readonly overlay?: TuiTerminalOverlayState
  }): TuiAppContainerFrame
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiAppContainer: TuiAppContainer
  }
}

function assertLayout(layout: string): asserts layout is TuiAppLayoutId {
  if (!Object.hasOwn(TUI_APP_LAYOUT_SLOTS, layout)) throw new TypeError(`app-container: unknown layout ${layout}`)
}

function assertInput(input: TuiAppContainerInput): void {
  if (!Number.isSafeInteger(input.width) || input.width <= 0) throw new TypeError('app-container: width must be positive')
  if (!Number.isSafeInteger(input.scrollOffset) || input.scrollOffset < 0) throw new TypeError('app-container: invalid scrollOffset')
  assertAppViewModel(input.viewModel)
  if (input.viewModel.model.publicationRevision !== input.viewModel.publicationRevision) {
    throw new TypeError('app-container: view model and presentation model revisions must match')
  }
  if (typeof input.viewModel.chrome.headerSession !== 'string' || typeof input.viewModel.chrome.headerStatus !== 'string') {
    throw new TypeError('app-container: chrome header projections are required')
  }
}

export function composeAppContainer(
  terminalUi: TuiAppTerminalUiComposer,
  input: TuiAppContainerInput,
): TuiAppContainerFrame {
  assertInput(input)
  const layout = input.layout ?? 'default'
  assertLayout(layout)
  const shell = terminalUi.composeInkTree({
    model: input.viewModel.model,
    composer: input.viewModel.composer,
    status: input.viewModel.status,
    width: input.width,
    scrollOffset: input.scrollOffset,
    localEchoes: input.viewModel.localEchoes,
    ...(input.viewModel.overlay === undefined ? {} : { overlay: input.viewModel.overlay }),
  })
  const descriptor: TuiAppLayoutDescriptor = Object.freeze({
    ...shell.descriptor,
    appContainer: Object.freeze({
      contract: 'tui.app-container.v2',
      layout,
      slots: TUI_APP_LAYOUT_SLOTS[layout],
      logoVariant: input.viewModel.chrome.logoVariant,
      logoVisible: input.viewModel.chrome.logoVisible,
      connectionState: input.viewModel.chrome.connectionState,
      executionState: input.viewModel.chrome.executionState,
      headerSession: input.viewModel.chrome.headerSession,
      headerStatus: input.viewModel.chrome.headerStatus,
    }),
  })
  return Object.freeze({
    ...shell,
    descriptor,
  })
}

class TuiAppContainerService extends Service implements TuiAppContainer {
  readonly name = tuiAppContainerServiceName
  private currentLayout: TuiAppLayoutId = 'default'
  private disposed = false
  private lastRevision = -1

  constructor(private readonly context: Context) {
    super(context, tuiAppContainerServiceName)
    context.effect(() => () => this.dispose(), 'tui-app-container.dispose')
  }

  get layout(): TuiAppLayoutId {
    return this.currentLayout
  }

  setLayout(layout: TuiAppLayoutId): void {
    if (this.disposed) throw new Error('app-container: disposed')
    assertLayout(layout)
    this.currentLayout = layout
  }

  compose(input: TuiAppContainerInput): TuiAppContainerFrame {
    if (this.disposed) throw new Error('app-container: disposed')
    const frame = composeAppContainer(this.terminalUi(), { ...input, layout: input.layout ?? this.currentLayout })
    if (frame.publicationRevision < this.lastRevision) throw new Error(`app-container: stale frame revision ${String(frame.publicationRevision)} < ${String(this.lastRevision)}`)
    this.lastRevision = frame.publicationRevision
    return Object.freeze({ ...frame, publicationRevision: input.viewModel.publicationRevision })
  }

  refresh(input: TuiAppRefreshInput): TuiAppContainerFrame {
    return this.compose(input)
  }

  composeInkTree(input: TuiAppContainerComposeInput): TuiAppContainerFrame {
    const composer = input.composer ?? { text: '', cursor: 0, lines: [''], cursorLine: 0, cursorColumn: 0, mode: 'idle' as const }
    const status = input.status ?? { sessionId: null, cwd: null, mode: 'idle' as const, publicationRevision: input.model.publicationRevision }
    const viewModel: TuiAppViewModel = {
      publicationRevision: input.model.publicationRevision,
      model: input.model,
      chrome: this.chromeFromSlots(input.model.publicationRevision),
      composer,
      status,
      localEchoes: input.localEchoes ?? [],
      ...(input.overlay === undefined ? {} : { overlay: input.overlay }),
    }
    return this.compose({ viewModel, width: input.width ?? 80, scrollOffset: input.scrollOffset ?? 0 })
  }

  private terminalUi(): TuiAppTerminalUiComposer {
    return (this.context as Context & { readonly tuiTerminalUi: TuiAppTerminalUiComposer }).tuiTerminalUi
  }

  private chromeFromSlots(publicationRevision: number): TuiAppChromeState {
    const registry = (this.context as Context & { readonly tuiChromeSlotRegistry?: TuiChromeSlotRegistryFace }).tuiChromeSlotRegistry
    if (registry === undefined) throw new Error('app-container: tuiChromeSlotRegistry is not installed')
    return registry.projectState({
      publicationRevision,
    })
  }

  dispose(): void {
    this.disposed = true
  }
}

export function apply(ctx: Context): void {
  ctx.tuiAppContainer = new TuiAppContainerService(ctx)
}

export const _internal = { assertLayout, assertInput }
