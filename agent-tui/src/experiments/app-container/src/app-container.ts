import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  TuiAppContainerFrame,
  TuiAppContainerInput,
  TuiAppLayoutId,
  TuiAppPresentationModel,
  TuiAppViewModel,
  TuiAppChromeState,
} from '../../../../contracts/tui/app-container/app-container.types.ts'
import {
  TUI_APP_LAYOUT_SLOTS,
  assertAppViewModel,
} from '../../../../contracts/tui/app-container/app-container.types.ts'
import type {
  TuiChromeSlotRegistryFace,
} from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'
import type {
  TuiAppChromeTerminalNodeProjectorFace,
  TuiAppChromeProjectionInput,
  TuiAppChromeTerminalNodes,
  TuiAppContainerFrameComposerFace,
  TuiAppContainerFrameInput,
  TuiAppContainerFrameBuildInput,
  TuiAppContainerCompositionResult,
  TuiAppContainerCompositionFailure,
} from '../../../../contracts/tui/app-container/ordered-app-frame-result.types.ts'
import type { TuiAppContainerFrameV3 } from '../../../../contracts/tui/app-container/ordered-app-frame.types.ts'
import type {
  TuiAppHeaderRegion,
  TuiAppFooterWorkspaceRegion,
  TuiAppTranscriptRegionStyle,
  TuiAppTranscriptRegion,
  TuiAppExecutionRegion,
  TuiAppComposerRegion,
  TuiAppOverlayRegion,
  TuiAppFooterRegion,
  TuiAppRootRegionNode,
} from '../../../../contracts/tui/app-container/ordered-app-frame.types.ts'
import type { TuiTerminalRegionLeaves } from '../../../../contracts/tui/terminal-ui/terminal-region-leaves.types.ts'
import type { TuiTerminalPrimitiveNode, TuiTerminalTextColor } from '../../../../contracts/tui/terminal-ui/terminal-frame-tree.types.ts'
import type { TuiDisplayLayout } from '../../../../contracts/tui/display-buffer-plugin/display-buffer-plugin.types.ts'
import {
  validateTerminalFrameTree,
  validateTerminalRegionLeaves,
} from '../../terminal-ui/src/terminal-ui.ts'
export const tuiAppContainerServiceName = 'tuiAppContainer' as const

const FULL_LOGO = '  ╭────────────────────╮\n  │      AGENT TUI     │\n  ╰────────────────────╯'

export interface TuiAppContainer extends TuiAppChromeTerminalNodeProjectorFace {
  readonly name: typeof tuiAppContainerServiceName
  readonly layout: TuiAppLayoutId
  setLayout(layout: TuiAppLayoutId): void
  projectTranscriptLayout(width: number): TuiDisplayLayout
  resetRevision(): void
  composeFrame(input: TuiAppContainerFrameInput): TuiAppContainerFrameV3
  composeFrameSafe(input: TuiAppContainerFrameInput): TuiAppContainerCompositionResult
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

function assertCompositionViewport(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || !Object.isFrozen(value)) {
    throw new TypeError('app-container: viewport must be a frozen validated pair')
  }
  const record = value as Record<string, unknown>
  if (Reflect.ownKeys(value).length !== 2
    || Reflect.ownKeys(value).some(key => key !== 'columns' && key !== 'rows')) {
    throw new TypeError('app-container: viewport requires exactly columns and rows')
  }
  const columns = record['columns']
  const rows = record['rows']
  if (typeof columns !== 'number' || !Number.isSafeInteger(columns) || columns <= 0
    || typeof rows !== 'number' || !Number.isSafeInteger(rows) || rows <= 0) {
    throw new TypeError('app-container: viewport columns and rows must be positive safe integers')
  }
}

function compositionFailure(stage: TuiAppContainerCompositionFailure['stage'], cause: unknown): TuiAppContainerCompositionFailure {
  const error = cause instanceof Error ? cause : new TypeError(String(cause))
  return Object.freeze({ stage, code: 'invalid-app-container-frame', message: error.message, cause: error })
}

function logoLabel(state: Pick<TuiAppChromeState, 'logoVariant' | 'logoVisible'>): string {
  if (!state.logoVisible) return ''
  return state.logoVariant === 'full' ? FULL_LOGO : '[A]'
}

function connectionLabel(state: TuiAppChromeState['connectionState']): string {
  if (state === 'connected') return '●  '
  if (state === 'connecting') return '●  '
  if (state === 'disconnected') return '○  '
  return '×  '
}

function connectionColor(state: TuiAppChromeState['connectionState']): TuiTerminalTextColor {
  if (state === 'connected') return 'green'
  if (state === 'connecting') return 'red'
  return 'red'
}

function liveTextStyle(mode: 'persistent' | 'live'): { readonly inverse?: true } {
  return mode === 'live' ? Object.freeze({ inverse: true }) : Object.freeze({})
}

function connectionPulseStyle(mode: 'persistent' | 'live'): { readonly dimColor?: true } {
  return mode === 'live' ? Object.freeze({}) : Object.freeze({ dimColor: true })
}

function primitiveRows(node: TuiTerminalPrimitiveNode): number {
  if (node.kind === 'text') return node.text.split('\n').length
  if (node.style.height !== undefined) return node.style.height
  const childRows = node.children.map(primitiveRows)
  return node.style.flexDirection === 'row'
    ? Math.max(0, ...childRows)
    : childRows.reduce((total, rows) => total + rows, 0)
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

  projectTranscriptLayout(width: number): TuiDisplayLayout {
    if (this.disposed) throw new Error('app-container: disposed')
    if (!Number.isSafeInteger(width) || width < 3) throw new TypeError('app-container: transcript width must leave room for horizontal gutters')
    return Object.freeze({ width, paddingX: 1 })
  }

  resetRevision(): void {
    if (this.disposed) throw new Error('app-container: disposed')
    this.lastRevision = -1
  }

  private projectChromeInternal(publicationRevision: number): TuiAppChromeTerminalNodes | TuiAppContainerCompositionFailure {
    const registry = (this.context as Context & { readonly tuiChromeSlotRegistry?: TuiChromeSlotRegistryFace }).tuiChromeSlotRegistry
    if (registry === undefined) return { stage: 'chrome-projection', code: 'invalid-app-container-frame', message: 'tuiChromeSlotRegistry is not installed', cause: new Error('missing registry') }
    const state: TuiAppChromeState = registry.projectState({ publicationRevision })
    const nodes: TuiAppChromeTerminalNodes = Object.freeze({
      contract: 'tui.app-container.chrome-terminal-nodes.v1',
      publicationRevision,
      logo: Object.freeze({ key: 'slot.header.logo', kind: 'text', text: logoLabel(state), style: Object.freeze({ bold: state.logoVisible, color: 'white' as const, backgroundColor: 'black' as const, ...liveTextStyle(state.logoDisplayMode) }) }),
      connection: Object.freeze({ key: 'slot.header.connection', kind: 'text', text: connectionLabel(state.connectionState), style: Object.freeze({ color: connectionColor(state.connectionState), ...connectionPulseStyle(state.connectionDisplayMode) }) }),
      session: Object.freeze({ key: 'slot.header.session', kind: 'text', text: state.headerSession, style: Object.freeze({ color: 'white' as const }) }),
      status: Object.freeze({ key: 'slot.header.status', kind: 'text', text: '', style: Object.freeze({ color: 'white' as const, dimColor: true }) }),
    })
    return nodes
  }

  projectChrome(input: TuiAppChromeProjectionInput): TuiAppChromeTerminalNodes {
    if (this.disposed) throw new Error('app-container: disposed')
    const result = this.projectChromeInternal(input.publicationRevision)
    if ('stage' in result) throw new Error(result.message)
    return result
  }

  projectChromeSafe(input: TuiAppChromeProjectionInput): import('../../../../contracts/tui/app-container/ordered-app-frame-result.types.ts').TuiAppChromeProjectionResult {
    if (this.disposed) return { ok: false, error: { stage: 'chrome-projection', code: 'invalid-app-container-frame', message: 'app-container: disposed', cause: new Error('disposed') } }
    const result = this.projectChromeInternal(input.publicationRevision)
    if ('stage' in result) return { ok: false, error: result }
    return { ok: true, value: result }
  }

  private buildFrame(input: TuiAppContainerFrameBuildInput): TuiAppContainerFrameV3 | TuiAppContainerCompositionFailure {
    if (this.disposed) return { stage: 'build', code: 'invalid-app-container-frame', message: 'app-container: disposed', cause: new Error('disposed') }
    if (input.publicationRevision < this.lastRevision) {
      return { stage: 'build', code: 'invalid-app-container-frame', message: `stale revision ${input.publicationRevision} < ${this.lastRevision}`, cause: new Error('stale frame') }
    }
    try {
      assertCompositionViewport(input.viewport)
      assertLayout(input.layout)
      validateTerminalRegionLeaves(input.regionLeaves)
      if (input.regionLeaves.publicationRevision !== input.publicationRevision) {
        throw new TypeError('app-container: region leaves and frame revisions must match')
      }
    } catch (cause) {
      return compositionFailure('validate', cause)
    }
    this.lastRevision = input.publicationRevision
    const transcriptChildren = [...input.regionLeaves.transcript.children]
    const transcriptStyle: TuiAppTranscriptRegionStyle = Object.freeze({
      flexDirection: 'column',
      flexGrow: 1,
      flexShrink: 1,
      overflow: 'hidden',
      backgroundColor: 'black' as const,
    })
    const transcriptLeaf: TuiTerminalRegionLeaves['transcript'] = Object.freeze({
      ...input.regionLeaves.transcript,
      children: Object.freeze(transcriptChildren),
    })
    const headerRows = 0
    const footerWorkspace: TuiAppFooterWorkspaceRegion = Object.freeze({
      kind: 'box',
      key: 'region.footer.workspace',
      style: Object.freeze({ flexDirection: 'row' }),
      children: Object.freeze([
        input.chrome.connection,
        input.chrome.session,
        input.chrome.status,
      ] as const),
    })
    const header: TuiAppHeaderRegion = Object.freeze({
      kind: 'box', key: 'region.header', style: Object.freeze({ flexDirection: 'column', flexShrink: 0, backgroundColor: 'black' }), children: Object.freeze([] as const),
    })
    const transcript: TuiAppTranscriptRegion = Object.freeze({
      kind: 'box', key: 'region.transcript', style: transcriptStyle, children: Object.freeze([transcriptLeaf] as const),
    })
    const execution: TuiAppExecutionRegion | undefined = input.regionLeaves.execution === undefined
      ? undefined
      : Object.freeze({
          kind: 'box', key: 'region.execution', style: Object.freeze({ flexDirection: 'column', flexShrink: 0 }), children: Object.freeze([input.regionLeaves.execution] as const),
        })
    const composer: TuiAppComposerRegion = Object.freeze({
      kind: 'box', key: 'region.composer', style: Object.freeze({ flexDirection: 'column', flexShrink: 0, backgroundColor: 'gray' }), children: Object.freeze([input.regionLeaves.composer] as const),
    })
    const subagentStatus: import('../../../../contracts/tui/app-container/ordered-app-frame.types.ts').TuiAppSubagentStatusRegion | undefined = input.regionLeaves.subagentStatusBar === undefined ? undefined : Object.freeze({
      kind: 'box' as const, key: 'region.subagent-status', style: Object.freeze({ flexDirection: 'column' as const, flexShrink: 0 }),
      children: Object.freeze([input.regionLeaves.subagentStatusBar] as const),
    })
    const footer: TuiAppFooterRegion = Object.freeze({
      kind: 'box', key: 'region.footer', style: Object.freeze({ flexDirection: 'column', flexShrink: 0, backgroundColor: 'dark-gray', paddingX: 1 }), children: Object.freeze([footerWorkspace, input.regionLeaves.footer] as const),
    })
    const children: Array<TuiAppRootRegionNode> = [header, transcript, ...(execution === undefined ? [] : [execution]), ...(subagentStatus === undefined ? [] : [subagentStatus]), composer, footer]
    if (input.regionLeaves.overlay !== undefined) {
      const overlayHeight = Math.max(1, input.viewport.rows - headerRows - 3 - 4)
      const overlayChildren = input.regionLeaves.overlay.children.map(child => child.kind === 'box'
        ? Object.freeze({
            ...child,
            style: Object.freeze({ ...child.style, width: Math.max(1, input.viewport.columns - 2) }),
          })
        : child)
      const overlayLeaf = Object.freeze({
        ...input.regionLeaves.overlay,
        children: Object.freeze(overlayChildren),
        style: Object.freeze({ ...input.regionLeaves.overlay.style, width: input.viewport.columns, height: overlayHeight, flexGrow: 1, overflow: 'hidden' as const }),
      })
      const overlay: TuiAppOverlayRegion = Object.freeze({
        kind: 'box', key: 'region.overlay', style: Object.freeze({ flexDirection: 'column', width: input.viewport.columns, height: overlayHeight, flexGrow: 1, flexShrink: 0, overflow: 'hidden' }), children: Object.freeze([overlayLeaf] as const),
      })
      children.splice(execution === undefined ? 2 : 3, 0, overlay)
    }
    const minimumRows = Math.min(input.viewport.rows, Math.max(
      1,
      primitiveRows(header)
        + (execution === undefined ? 0 : primitiveRows(execution))
        + primitiveRows(composer)
        + primitiveRows(footer)
        + (input.regionLeaves.overlay === undefined ? 0 : primitiveRows(children.find(child => child.key === 'region.overlay')!))
        + (transcriptLeaf.children.length === 0 ? 0 : 1),
    ))
    const root = Object.freeze({
      contract: 'tui.terminal-frame-tree.v1',
      publicationRevision: input.publicationRevision,
      root: Object.freeze({
        kind: 'box', key: 'frame.root', style: Object.freeze({ flexDirection: 'column', width: input.viewport.columns, height: input.viewport.rows, minHeight: minimumRows }), children: Object.freeze(children),
      }),
    }) satisfies TuiAppContainerFrameV3
    try {
      validateTerminalFrameTree(root)
    } catch (cause) {
      return compositionFailure('validate', cause)
    }
    return root
  }

  composeFrame(input: TuiAppContainerFrameInput): TuiAppContainerFrameV3 {
    if (this.disposed) throw new Error('app-container: disposed')
    const chrome = this.projectChromeInternal(input.publicationRevision)
    if ('stage' in chrome) throw new Error(chrome.message)
    const buildInput: TuiAppContainerFrameBuildInput = Object.freeze({ ...input, chrome })
    const frame = this.buildFrame(buildInput)
    if ('stage' in frame) throw new Error(frame.message)
    return frame
  }

  composeFrameSafe(input: TuiAppContainerFrameInput): TuiAppContainerCompositionResult {
    if (this.disposed) return { ok: false, error: { stage: 'chrome-projection', code: 'invalid-app-container-frame', message: 'app-container: disposed', cause: new Error('disposed') } }
    let chrome: TuiAppChromeTerminalNodes
    try {
      const projected = this.projectChromeInternal(input.publicationRevision)
      if ('stage' in projected) return { ok: false, error: projected }
      chrome = projected
    } catch (cause) {
      return { ok: false, error: { stage: 'chrome-projection', code: 'invalid-app-container-frame', message: cause instanceof Error ? cause.message : String(cause), cause: cause instanceof Error ? cause : new Error(String(cause)) } }
    }
    try {
      const buildInput: TuiAppContainerFrameBuildInput = Object.freeze({ ...input, chrome })
      const frame = this.buildFrame(buildInput)
      if ('stage' in frame) return { ok: false, error: frame }
      return { ok: true, value: frame }
    } catch (cause) {
      return { ok: false, error: compositionFailure('build', cause) }
    }
  }

  dispose(): void {
    this.disposed = true
  }
}

export function apply(ctx: Context): void {
  ctx.tuiAppContainer = new TuiAppContainerService(ctx)
}
