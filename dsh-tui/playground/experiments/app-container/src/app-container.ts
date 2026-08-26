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
  TuiAppTranscriptRegion,
  TuiAppExecutionRegion,
  TuiAppComposerRegion,
  TuiAppOverlayRegion,
  TuiAppFooterRegion,
  TuiAppRootRegionNode,
} from '../../../../contracts/tui/app-container/ordered-app-frame.types.ts'
import type { TuiTerminalRegionLeaves } from '../../../../contracts/tui/terminal-ui/terminal-region-leaves.types.ts'
import {
  validateTerminalFrameTree,
  validateTerminalRegionLeaves,
} from '../../terminal-ui/src/terminal-ui.ts'
export const tuiAppContainerServiceName = 'tuiAppContainer' as const

export interface TuiAppContainer extends TuiAppChromeTerminalNodeProjectorFace {
  readonly name: typeof tuiAppContainerServiceName
  readonly layout: TuiAppLayoutId
  setLayout(layout: TuiAppLayoutId): void
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

function connectionLabel(state: TuiAppChromeState['connectionState']): string {
  return `[${state}]`
}

function sessionLabel(value: string): string {
  const prefix = 'Session '
  const id = value.startsWith(prefix) ? value.slice(prefix.length) : value
  return `${prefix}${id.length > 12 ? `${id.slice(0, 8)}...` : id}`
}

function executionLabel(state: TuiAppChromeState['executionState']): string {
  if (state === 'running') return '[> running]'
  if (state === 'completed') return '[ok completed]'
  if (state === 'failed') return '[! failed]'
  return '[idle]'
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

  private projectChromeInternal(publicationRevision: number): TuiAppChromeTerminalNodes | TuiAppContainerCompositionFailure {
    const registry = (this.context as Context & { readonly tuiChromeSlotRegistry?: TuiChromeSlotRegistryFace }).tuiChromeSlotRegistry
    if (registry === undefined) return { stage: 'chrome-projection', code: 'invalid-app-container-frame', message: 'tuiChromeSlotRegistry is not installed', cause: new Error('missing registry') }
    const state: TuiAppChromeState = registry.projectState({ publicationRevision })
    const connectionStyle = state.connectionState === 'connected'
      ? Object.freeze({ color: 'green' as const, bold: true })
      : state.connectionState === 'connecting'
        ? Object.freeze({ color: 'yellow' as const, bold: false })
        : state.connectionState === 'failed'
          ? Object.freeze({ color: 'red' as const, bold: true })
          : Object.freeze({ bold: false })
    const executionStyle = state.executionState === 'running'
      ? Object.freeze({ color: 'cyan' as const, bold: true })
      : state.executionState === 'completed'
        ? Object.freeze({ color: 'green' as const, bold: true })
        : state.executionState === 'failed'
          ? Object.freeze({ color: 'red' as const, bold: true })
          : Object.freeze({ dimColor: true })
    const nodes: TuiAppChromeTerminalNodes = Object.freeze({
      contract: 'tui.app-container.chrome-terminal-nodes.v1',
      publicationRevision,
      logo: Object.freeze({ key: 'slot.header.logo', kind: 'text', text: state.logoVisible ? `[${state.logoVariant === 'full' ? 'DSH' : 'D'}]` : '', style: Object.freeze({ bold: state.logoVisible, color: 'cyan' as const }) }),
      connection: Object.freeze({ key: 'slot.header.connection', kind: 'text', text: ` ${connectionLabel(state.connectionState)}`, style: connectionStyle }),
      session: Object.freeze({ key: 'slot.header.session', kind: 'text', text: ` ${sessionLabel(state.headerSession)}`, style: Object.freeze({}) }),
      status: Object.freeze({ key: 'slot.header.status', kind: 'text', text: ` ${state.headerStatus}`, style: Object.freeze({ inverse: true, color: 'yellow' as const }) }),
      execution: Object.freeze({ key: 'slot.execution', kind: 'text', text: executionLabel(state.executionState), style: executionStyle }),
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
    const composerNode = input.regionLeaves.composer.children[0]
    const composerLines = composerNode?.kind === 'text' ? composerNode.text.split('\n').length : 1
    const localEchoRows = transcriptChildren.filter(child => child.key.startsWith('local-')).length
    const overlayRows = input.regionLeaves.overlay === undefined ? 0 : input.regionLeaves.overlay.children.length + 1
    const capacity = Math.max(1, input.viewport.rows - composerLines - localEchoRows - overlayRows - 6)
    const overflowMarkerRows = transcriptChildren.length > capacity ? 1 : 0
    const retainedCount = Math.max(0, capacity - overflowMarkerRows)
    const hiddenCount = Math.max(0, transcriptChildren.length - retainedCount)
    const visibleTranscriptChildren = transcriptChildren.slice(-retainedCount)
    if (hiddenCount > 0) {
      visibleTranscriptChildren.unshift(Object.freeze({
        kind: 'text',
        key: 'transcript.older',
        text: `... ${hiddenCount} earlier cells`,
        style: Object.freeze({ dimColor: true }),
      }))
    }
    const transcriptLeaf: TuiTerminalRegionLeaves['transcript'] = Object.freeze({
      ...input.regionLeaves.transcript,
      children: Object.freeze(visibleTranscriptChildren),
    })
    const headerChildren = Object.freeze([
      input.chrome.logo,
      input.chrome.connection,
      input.chrome.session,
      input.chrome.status,
    ] as const)
    const header: TuiAppHeaderRegion = Object.freeze({
      kind: 'box', key: 'region.header', style: Object.freeze({ flexDirection: 'row', borderStyle: 'round', paddingX: 1 }), children: headerChildren,
    })
    const transcript: TuiAppTranscriptRegion = Object.freeze({
      kind: 'box', key: 'region.transcript', style: Object.freeze({ flexDirection: 'column', borderStyle: 'round', paddingX: 1 }), children: Object.freeze([transcriptLeaf] as const),
    })
    const execution: TuiAppExecutionRegion = Object.freeze({
      kind: 'box', key: 'region.execution', style: Object.freeze({ flexDirection: 'column', borderStyle: 'round', paddingX: 1 }), children: Object.freeze([input.chrome.execution] as const),
    })
    const composer: TuiAppComposerRegion = Object.freeze({
      kind: 'box', key: 'region.composer', style: Object.freeze({ flexDirection: 'column', paddingX: 1 }), children: Object.freeze([input.regionLeaves.composer] as const),
    })
    const footer: TuiAppFooterRegion = Object.freeze({
      kind: 'box', key: 'region.footer', style: Object.freeze({ flexDirection: 'column', borderStyle: 'round', paddingX: 1 }), children: Object.freeze([input.regionLeaves.footer] as const),
    })
    const children: Array<TuiAppRootRegionNode> = [header, transcript, execution, composer, footer]
    if (input.regionLeaves.overlay !== undefined) {
      const overlay: TuiAppOverlayRegion = Object.freeze({
        kind: 'box', key: 'region.overlay', style: Object.freeze({ flexDirection: 'column' }), children: Object.freeze([input.regionLeaves.overlay] as const),
      })
      children.push(overlay)
    }
    if (input.layout === 'compact') {
      const overlayRegion = children.find(child => child.key === 'region.overlay') as TuiAppOverlayRegion | undefined
      children.splice(0, children.length, transcript, execution, ...(overlayRegion ? [overlayRegion] : []), composer, header, footer)
    }
    const root = Object.freeze({
      contract: 'tui.terminal-frame-tree.v1',
      publicationRevision: input.publicationRevision,
      root: Object.freeze({
        kind: 'box', key: 'frame.root', style: Object.freeze({ flexDirection: 'column', width: input.viewport.columns }), children: Object.freeze(children),
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
