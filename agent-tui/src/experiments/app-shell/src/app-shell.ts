import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {
  TuiAppEventBus,
  TuiInputIn01TerminalIntent,
  TuiInputIn02AppEvent,
} from '../../app-event-bus/src/app-event-bus.ts'
import type { TuiValidatedTerminalViewport } from '../../../../contracts/tui/app-event-bus/validated-terminal-viewport.types.ts'
import type {
  TuiTerminalComposerState,
  TuiTerminalLocalEchoState,
  TuiTerminalNodeLifecycle,
  TuiTerminalOverlayState,
  TuiTerminalStatusState,
} from '../../../../contracts/tui/terminal-ui/terminal-shell.types.ts'
import type {
  TuiTerminalPrimitiveRealizationResult,
  TuiTerminalRegionProjectionResult,
} from '../../../../contracts/tui/terminal-ui/terminal-frame-pipeline-result.types.ts'
import type { TuiTerminalFooterLeaf } from '../../../../contracts/tui/terminal-ui/terminal-region-leaves.types.ts'
import type { TuiAppContainerCompositionResult, TuiAppContainerFrameInput } from '../../../../contracts/tui/app-container/ordered-app-frame-result.types.ts'
import type { TuiRealizedTerminalPrimitiveTree } from '../../../../contracts/tui/terminal-ui/terminal-frame-pipeline-result.types.ts'
import type { TuiTerminalCarrierResult } from '../../../../contracts/tui/terminal-lifecycle/terminal-carrier-result.types.ts'
import type { TuiTerminalRenderFrame } from '../../../../contracts/tui/terminal-render-plugin/terminal-render-plugin.types.ts'
import type { TuiRefreshOrchestratorFace } from '../../../../contracts/tui/refresh-orchestrator/refresh-orchestrator.types.ts'
import type { TuiComposerFace } from '../../../../contracts/tui/composer-plugin/composer-plugin.types.ts'
import type { TuiFocusViewId } from '../../../../contracts/tui/focus-manager/focus-manager.types.ts'
import type {
  TuiStatusFooterFace,
  TuiStatusFooterInput,
  TuiStatusFooterProjectionFailure,
} from '../../../../contracts/tui/status-footer-plugin/status-footer-plugin.types.ts'
import type { TuiOverlayManagerFace } from '../../../../contracts/tui/overlay-manager-plugin/overlay-manager-plugin.types.ts'
import type { TuiOverlayItem, TuiOverlayViewInput } from '../../../../contracts/tui/overlay-manager-plugin/overlay-manager-plugin.types.ts'
import type { TuiExecutionStatusProjection } from '../../../../contracts/tui/execution-status-plugin/execution-status-plugin.types.ts'

export const appShellServiceName = 'tuiShell' as const

export type TuiInputIn03BusinessAction =
  | {
      readonly kind: 'session.prompt'
      readonly actionId: string
      readonly text: string
      readonly attachments?: readonly string[]
    }
  | {
      readonly kind: 'session.cancel'
      readonly actionId: string
    }
  | {
      readonly kind: 'interaction.approval.respond'
      readonly actionId: string
      readonly interactionId: string
      readonly decision: boolean
    }
  | {
      readonly kind: 'interaction.question.respond'
      readonly actionId: string
      readonly interactionId: string
      readonly answer: unknown
    }

export interface TuiShellControlAction {
  readonly kind: 'command'
  readonly input: string
}

export interface TuiShellPolicy {
  readonly composerEmpty: boolean
  readonly sessionRunning: boolean
  readonly sessionSelected: boolean
}

export interface TuiShell {
  readonly name: typeof appShellServiceName
  dispatch(event: TuiInputIn02AppEvent): void
  canExit(state: { empty: boolean; running: boolean }): boolean
  updatePolicy(partial: Partial<TuiShellPolicy>): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiShell: TuiShell
  }
}

const EVENT_KEYS = new Set(['eventId', 'acceptedAt', 'intent'])
const FORBIDDEN_INTENT_KEYS = new Set(['transport', 'frame', 'rpcId', 'endpoint', 'sequence', 'metadata', 'control', 'retry', 'ack'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function assertNoForbiddenKeys(value: Record<string, unknown>, path: string): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_INTENT_KEYS.has(key)) {
      throw new TypeError(`app-shell: forbidden control key '${key}' at ${path}`)
    }
    const child = value[key]
    if (child !== null && typeof child === 'object') {
      assertNoForbiddenKeys(child as Record<string, unknown>, `${path}.${key}`)
    }
  }
}

function assertAppEvent(value: unknown): asserts value is TuiInputIn02AppEvent {
  if (!isPlainObject(value)) {
    throw new TypeError('app-shell: TuiInputIn02AppEvent must be a plain object')
  }
  for (const key of Object.keys(value)) {
    if (!EVENT_KEYS.has(key)) throw new TypeError(`app-shell: unexpected AppEvent field '${key}'`)
  }
  if (typeof value['eventId'] !== 'string' || value['eventId'].length === 0) {
    throw new TypeError('app-shell: AppEvent requires a non-empty eventId')
  }
  if (typeof value['acceptedAt'] !== 'number' || !Number.isFinite(value['acceptedAt'])) {
    throw new TypeError('app-shell: AppEvent requires a finite acceptedAt')
  }
  if (!isPlainObject(value['intent'])) {
    throw new TypeError('app-shell: AppEvent requires a typed intent')
  }
  assertNoForbiddenKeys(value['intent'], 'event.intent')
}

function nextActionId(seq: number): string {
  return `a${String(seq)}`
}

export class TuiShellService extends Service implements TuiShell {
  readonly name = appShellServiceName
  private readonly policy: TuiShellPolicy
  private readonly dispatchBusinessAction: (action: TuiInputIn03BusinessAction) => void
  private readonly dispatchControlAction: (action: TuiShellControlAction) => void
  private sequence = 0

  constructor(ctx: Context, options: {
    policy: TuiShellPolicy
    dispatchBusiness: (action: TuiInputIn03BusinessAction) => void
    dispatchControl: (action: TuiShellControlAction) => void
  }) {
    super(ctx, appShellServiceName)
    this.policy = options.policy
    this.dispatchBusinessAction = options.dispatchBusiness
    this.dispatchControlAction = options.dispatchControl
    ctx.effect(() => () => {
      this.sequence = 0
    }, 'app-shell.dispose')
  }

  dispatch(event: TuiInputIn02AppEvent): void {
    assertAppEvent(event)
    const intent = event.intent
    const kind = intent.kind
    switch (kind) {
      case 'terminal.submit':
        this.assertSessionSelected()
        this.dispatchBusinessAction(this.action({
          kind: 'session.prompt',
          text: intent.text,
          ...(intent.attachments?.length ? { attachments: intent.attachments } : {}),
        }))
        return
      case 'terminal.cancel':
        this.assertSessionRunning()
        this.dispatchBusinessAction(this.action({ kind: 'session.cancel' }))
        return
      case 'terminal.command':
        this.dispatchControlAction({
          kind: 'command',
          input: intent.input,
        })
        return
      case 'interaction.approval':
        if (!intent.payload || typeof intent.payload['interactionId'] !== 'string') {
          throw new TypeError('app-shell: approval response requires interactionId')
        }
        this.dispatchBusinessAction(this.action({
          kind: 'interaction.approval.respond',
          interactionId: intent.payload['interactionId'],
          decision: intent.decision,
        }))
        return
      case 'interaction.question':
        if (!intent.payload || typeof intent.payload['interactionId'] !== 'string') {
          throw new TypeError('app-shell: question response requires interactionId')
        }
        this.dispatchBusinessAction(this.action({
          kind: 'interaction.question.respond',
          interactionId: intent.payload['interactionId'],
          answer: intent.answer,
        }))
        return
      case 'terminal.resize':
        throw new TypeError('app-shell: terminal.resize is control state; it must never become a business action')
      default:
        throw new TypeError(`app-shell: unknown event kind ${String(kind)}`)
    }
  }

  canExit(state: { empty: boolean; running: boolean }): boolean {
    return state.empty && !state.running
  }

  updatePolicy(partial: Partial<TuiShellPolicy>): void {
    if (!partial || typeof partial !== 'object') {
      throw new TypeError('app-shell: policy update must be an object')
    }
    Object.assign(this.policy, partial)
  }

  private assertSessionSelected(): void {
    if (!this.policy.sessionSelected) {
      throw new Error('app-shell: no Session is selected; submit fails closed')
    }
  }

  private assertSessionRunning(): void {
    if (!this.policy.sessionRunning) {
      throw new Error('app-shell: Session is not running; cancel fails closed')
    }
  }

  private action<T extends Omit<TuiInputIn03BusinessAction, 'actionId'>>(partial: T): T & { readonly actionId: string } {
    this.sequence += 1
    return Object.freeze({ ...partial, actionId: nextActionId(this.sequence) })
  }
}

export const name = 'app-shell'

export function apply(ctx: Context, options: {
  policy: TuiShellPolicy
  dispatchBusiness: (action: TuiInputIn03BusinessAction) => void
  dispatchControl: (action: TuiShellControlAction) => void
}): void {
  new TuiShellService(ctx, options)
}

// ---------- Runtime controller ----------

export interface TuiRuntimeSnapshotLike {
  readonly sessionId: string
  readonly cwd: string
  readonly running: boolean
  readonly error?: string
  readonly model?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
  readonly permission?: string
  readonly goal?: 'active' | 'paused' | 'blocked' | 'complete' | null
}

export interface TuiRuntimePresentationLike {
  readonly nodes: ReadonlyArray<
    { readonly nodeId: string; readonly kind: string;
      readonly publicationRevision: number; readonly lifecycle: TuiTerminalNodeLifecycle }
    & { readonly value: Readonly<Record<string, unknown>> }
  >
  readonly publicationRevision: number
}

export interface TuiRuntimeTerminalUiLike {
  projectSafe(input: {
    model: TuiRuntimePresentationLike
    composer: TuiTerminalComposerState
    status: TuiTerminalStatusState
    footer: TuiTerminalFooterLeaf
    localEchoes: readonly TuiTerminalLocalEchoState[]
    overlay?: TuiTerminalOverlayState
    executionStatus?: { readonly line: string | null }
    commandSuggestions?: ReadonlyArray<{ readonly command: string; readonly description: string }>
    displayFrame?: TuiTerminalRenderFrame
  }): TuiTerminalRegionProjectionResult
  realizeSafe(frame: {
    contract: 'tui.terminal-frame-tree.v1'
    publicationRevision: number
    root: unknown
  }): TuiTerminalPrimitiveRealizationResult
}

export interface TuiRuntimeLifecycleLike {
  state(): string
  setInputHandler(handler: ((event: TuiRuntimeTerminalEvent) => void) | null): void
  fail(error: Error, source?: string): void
  render(tree: TuiRealizedTerminalPrimitiveTree): TuiTerminalCarrierResult
  enter(streams: {
    readonly stdout: NodeJS.WriteStream
    readonly stdin: NodeJS.ReadStream
    readonly stderr: NodeJS.WriteStream
  }): void
  exit(reason: { readonly reason: string }): void
}

export interface TuiRuntimeKeyState {
  readonly ctrl: boolean
  readonly return: boolean
  readonly shift: boolean
  readonly backspace: boolean
  readonly delete: boolean
  readonly leftArrow: boolean
  readonly rightArrow: boolean
  readonly upArrow: boolean
  readonly downArrow: boolean
  readonly pageUp: boolean
  readonly pageDown: boolean
  readonly home: boolean
  readonly end: boolean
  readonly tab: boolean
  readonly escape: boolean
}

export type TuiRuntimeTerminalEvent =
  | {
      readonly type: 'key'
      readonly input: string
      readonly key: TuiRuntimeKeyState
    }

export interface TuiRuntimeDeps {
  readonly getSnapshot: () => TuiRuntimeSnapshotLike | null
  readonly getPresentation: () => TuiRuntimePresentationLike | null
  readonly refresh: Pick<TuiRefreshOrchestratorFace, 'request'>
  readonly shell: TuiShell
  readonly appContainer: {
    readonly layout: 'default' | 'compact'
    resetRevision(): void
    composeFrameSafe(input: TuiAppContainerFrameInput): TuiAppContainerCompositionResult
  }
  readonly terminalUi: TuiRuntimeTerminalUiLike
  readonly chrome: {
    projectState(input: { readonly publicationRevision: number }): {
      readonly connectionState: 'connecting' | 'connected' | 'disconnected' | 'failed'
      readonly executionState: 'idle' | 'running' | 'completed' | 'failed'
    }
  }
  readonly statusFooter: TuiStatusFooterFace
  readonly subagentStatus?: { projectTerminalBar(): import('../../../../contracts/tui/terminal-ui/terminal-frame-tree.types.ts').TuiTerminalBoxNode | undefined }
  readonly lifecycle: TuiRuntimeLifecycleLike
  readonly focus: {
    pushView(view: TuiTerminalOverlayState['view']): () => void
    activeView(): TuiFocusViewId
  }
  readonly emitEvent: (event: TuiInputIn01TerminalIntent) => void
  readonly composer: TuiComposerFace
  readonly overlayManager: TuiOverlayManagerFace
  readonly forkSession?: (atSeq: number) => void
  readonly loadOlder?: () => Promise<void>
  readonly executionStatus?: { readonly project: (now?: number) => Pick<TuiExecutionStatusProjection, 'state' | 'line'>; readonly interrupt?: () => void }
  readonly slashCommandSuggestions?: (text: string) => ReadonlyArray<{ readonly command: string; readonly description: string }>
  readonly displayFrame?: () => TuiTerminalRenderFrame | null
  readonly setDisplayViewport?: (viewport: TuiValidatedTerminalViewport) => void
}

export interface TuiRuntimeController {
  start(): void
  installInputHandler(): void
  storeViewport(viewport: TuiValidatedTerminalViewport): void
  stop(reason?: string): void
  render(): void
  reportError(message: string): void
  reportSubmissionError(message: string): void
  clearError(): void
  handleTerminalEvent(event: TuiRuntimeTerminalEvent): void
  openOverlay(
    overlay: Omit<TuiOverlayViewInput, 'items'> & {
      readonly items: ReadonlyArray<string | TuiOverlayItem>
    },
    onSelect?: (itemKey: string) => void,
  ): void
  closeOverlay(): void
  renderNow(): void
}

export function createTuiRuntimeController(deps: TuiRuntimeDeps): TuiRuntimeController {
  let currentViewport: TuiValidatedTerminalViewport | null = null
  let started = false
  let fatalMessage: string | undefined
  let activeOverlayKey: string | null = null
  let overlayFocusDispose: (() => void) | undefined
  let viewportRevision = 0
  let interactionRevision = 0
  let lastCompositionSessionId: string | null | undefined
  let commandSuggestionsSuppressed = false
  let escapePressedAt: number | null = null
  let deferInputRender = false
  let deferredInputRender: NodeJS.Immediate | null = null
  let pendingSubmit = false
  let pendingSubmitFlush: NodeJS.Immediate | null = null

  const snapshot = (): TuiRuntimeSnapshotLike | null => deps.getSnapshot()
  const presentation = (): TuiRuntimePresentationLike | null => deps.getPresentation()
  const selected = (): boolean => snapshot() !== null
  const running = (): boolean => {
    if (snapshot()?.running === true) return true
    // The local execution state starts before OpenCode emits session.status busy.
    // A selected Session may therefore be interruptible while its remote snapshot
    // still reports idle; startup remains non-interruptible until selection exists.
    return selected() && deps.executionStatus?.project().state === 'running'
  }

  function status(): TuiTerminalStatusState {
    return {
      sessionId: snapshot()?.sessionId ?? null,
      cwd: snapshot()?.cwd ?? null,
      mode: fatalMessage || snapshot()?.error ? 'error' : running() ? 'streaming' : 'idle',
      publicationRevision: presentation()?.publicationRevision ?? 0,
      ...(fatalMessage ? { message: fatalMessage } : snapshot()?.error ? { message: snapshot()!.error } : {}),
    }
  }

  function composer(): TuiTerminalComposerState {
    return deps.composer.projectState()
  }

  function overlay(): TuiTerminalOverlayState | undefined {
    const state = deps.overlayManager.projectState()
    if (state.kind === 'composer') return undefined
    const kind = state.view.kind
    if (!['fatal', 'approval-question', 'selector.resume-current-cwd', 'command', 'queue', 'overlay.jobs', 'overlay.trajectory', 'overlay.help', 'interaction.approval', 'interaction.question', 'selector.model', 'selector.provider', 'selector.permission', 'selector.fork-history', 'selector.workspaces', 'selector.subagents', 'selector.session-search'].includes(String(kind))) {
      throw new TypeError(`runtime overlay view is not supported: ${String(kind)}`)
    }
    return Object.freeze({
      view: kind,
      title: state.view.title,
      items: Object.freeze(state.view.items.map(item => item.label)),
      selectedIndex: state.view.selectedIndex,
    })
  }

  function localEchoes(): ReadonlyArray<TuiTerminalLocalEchoState> {
    return [...deps.composer.pendingEchoes(), ...deps.composer.failedEchoes()]
  }

  function nextInteractionRevision(): number {
    interactionRevision += 1
    return interactionRevision
  }

  function convergeOfficialEchoes(model: TuiRuntimePresentationLike): void {
    deps.composer.setLatestPresentationRevision(model.publicationRevision)
    for (const node of model.nodes) {
      if (node.kind !== 'conversation.user') continue
      const text = node.value['text']
      if (typeof text !== 'string') continue
      deps.composer.attachOfficialEcho({
        nodeId: node.nodeId,
        text,
        publicationRevision: node.publicationRevision,
      })
    }
  }

  function routeStatusFooterFailureToTerminalFailure(
    error: TuiStatusFooterProjectionFailure,
  ): void {
    const cause = error.cause
    deps.lifecycle.fail(new Error(`status footer projection failed: ${error.code}: ${error.message}`, { cause }), 'status-footer-projection')
  }

  function publishEvent(event: TuiInputIn01TerminalIntent): void {
    deps.emitEvent(event)
  }

  function renderNow(): void {
    deps.shell.updatePolicy({
      composerEmpty: composer().text.length === 0,
      sessionRunning: running(),
      sessionSelected: selected(),
    })
    const model = presentation()
    if (!model || deps.lifecycle.state() !== 'active') return
    schedulePendingSubmitFlush()
    const currentSessionId = snapshot()?.sessionId ?? null
    if (lastCompositionSessionId !== undefined && currentSessionId !== lastCompositionSessionId) {
      deps.appContainer.resetRevision()
    }
    lastCompositionSessionId = currentSessionId
    convergeOfficialEchoes(model)
    deps.composer.setMode(
      running() ? 'streaming' : fatalMessage || snapshot()?.error ? 'error' : 'idle',
    )
    if (currentViewport === null) {
      routeFirstComposeFailure()
      return
    }
    const chromeState = deps.chrome.projectState({ publicationRevision: model.publicationRevision })
    const statusFooterInput: TuiStatusFooterInput = {
      connection: {
        state: chromeState.connectionState,
        revision: model.publicationRevision,
      },
      execution: {
        state: chromeState.executionState,
        revision: model.publicationRevision,
      },
      status: {
        mode: status().mode,
        ...(status().message ? { message: status().message } : {}),
        revision: model.publicationRevision,
      },
      selectedSession: {
        sessionId: status().sessionId,
        cwd: status().cwd,
      },
      model: {
        provider: snapshot()?.model?.provider ?? null,
        model: snapshot()?.model?.model ?? null,
        thinkingEffort: snapshot()?.model?.reasoningEffort ?? null,
      },
      permission: { current: snapshot()?.permission ?? null },
      goal: snapshot()?.goal ?? null,
      viewport: {
        class: deps.appContainer.layout === 'compact' ? 'compact' : 'regular',
        columns: currentViewport.columns,
        rows: currentViewport.rows,
      },
      focus: { activeView: deps.focus.activeView() },
      publicationRevision: model.publicationRevision,
      ...(fatalMessage ? { error: { kind: 'fatal', message: fatalMessage } } : {}),
    }
    const statusFooter = deps.statusFooter.projectSafe(statusFooterInput)
    if (!statusFooter.ok) {
      routeStatusFooterFailureToTerminalFailure(statusFooter.error)
      return
    }
    const currentOverlay = overlay()
    const displayFrame = deps.displayFrame?.() ?? null
    const projected = deps.terminalUi.projectSafe({
      model,
      composer: composer(),
      status: status(),
      footer: statusFooter.value,
      ...(deps.subagentStatus?.projectTerminalBar() === undefined ? {} : { subagentStatusBar: deps.subagentStatus.projectTerminalBar() }),
      localEchoes: localEchoes(),
      ...(currentOverlay === undefined ? {} : { overlay: currentOverlay }),
      ...(deps.executionStatus === undefined ? {} : { executionStatus: deps.executionStatus.project() }),
      ...(deps.slashCommandSuggestions === undefined ? {} : {
        commandSuggestions: commandSuggestionsSuppressed ? [] : deps.slashCommandSuggestions(composer().text),
      }),
      ...(displayFrame === null ? {} : { displayFrame }),
    })
    if (!projected.ok) {
      routeRegionProjectionFailureToTerminalFailure(projected.error)
      return
    }
    const composed = deps.appContainer.composeFrameSafe({
      publicationRevision: model.publicationRevision,
      layout: deps.appContainer.layout,
      regionLeaves: projected.value,
      viewport: currentViewport,
    })
    if (!composed.ok) {
      routeCompositionFailureToTerminalFailure(composed.error)
      return
    }
    const realized = deps.terminalUi.realizeSafe(composed.value)
    if (!realized.ok) {
      routeGenericRealizationFailureToTerminalFailure(realized.error)
      return
    }
    deps.lifecycle.render(realized.value)
  }

  function routeRegionProjectionFailureToTerminalFailure(
    error: Extract<TuiTerminalRegionProjectionResult, { ok: false }>['error'],
  ): void {
    const cause = error.cause
    deps.lifecycle.fail(new Error(`region projection failed: ${error.code}: ${error.message}`, { cause }), 'region-projection')
  }

  function routeCompositionFailureToTerminalFailure(
    error: Extract<TuiAppContainerCompositionResult, { ok: false }>['error'],
  ): void {
    const cause = error.cause
    deps.lifecycle.fail(new Error(`app composition failed: ${error.stage}: ${error.message}`, { cause }), 'app-container-composition')
  }

  function routeGenericRealizationFailureToTerminalFailure(
    error: Extract<TuiTerminalPrimitiveRealizationResult, { ok: false }>['error'],
  ): void {
    const cause = error.cause
    deps.lifecycle.fail(new Error(`primitive realization failed: ${error.code}: ${error.message}`, { cause }), 'primitive-realization')
  }

  function routeFirstComposeFailure(): void {
    deps.lifecycle.fail(new Error('app-shell: first compose requires a validated terminal viewport'), 'viewport-bootstrap')
  }

  function render(): void {
    if (deferInputRender) {
      if (deferredInputRender !== null) return
      deferredInputRender = setImmediate(() => {
        deferredInputRender = null
        if (deps.lifecycle.state() === 'active') renderNow()
      })
      return
    }
    renderNow()
  }

  function handleInputEvent(event: TuiRuntimeTerminalEvent): void {
    deferInputRender = true
    try {
      handleKey(event)
    } finally {
      deferInputRender = false
    }
  }

  function storeViewport(viewport: TuiValidatedTerminalViewport): void {
    if (!Object.isFrozen(viewport)) throw new TypeError('current viewport must be frozen')
    currentViewport = viewport
    deps.setDisplayViewport?.(viewport)
    if (!started) return
    viewportRevision += 1
    const result = deps.refresh.request({
      sourceModuleId: 'app-container',
      reason: 'viewport',
      sourceRevision: viewportRevision,
    })
    if (result.status === 'rejected') {
      throw new Error(`app-shell: refresh request rejected (${result.reason}): ${result.message}`)
    }
  }

  function submitOrCommand(): void {
    commandSuggestionsSuppressed = false
    const text = deps.composer.projectState().text.trim()
    if (!selected() && text.length > 0 && !text.startsWith('/')) {
      pendingSubmit = true
      render()
      return
    }
    pendingSubmit = false
    const intent = deps.composer.submit({
      sessionSelected: selected(),
      sourceRevision: nextInteractionRevision(),
    })
    if (intent.kind === 'rejected') {
      if (intent.code !== 'empty') fatalMessage = intent.message
      render()
      return
    }
    fatalMessage = undefined
    if (intent.kind === 'command') {
      publishEvent({ kind: 'terminal.command', sourceId: 'composer.editor', input: intent.text })
    }
    if (intent.kind === 'prompt') {
      try {
        publishEvent({ kind: 'terminal.submit', sourceId: 'composer.editor', text: intent.text })
      } catch (error) {
        deps.composer.markSubmissionFailed(
          intent.localEchoId,
          error instanceof Error ? error.message : String(error),
        )
        fatalMessage = error instanceof Error ? error.message : String(error)
      }
    }
    render()
  }

  function schedulePendingSubmitFlush(): void {
    if (!pendingSubmit || !selected() || pendingSubmitFlush !== null) return
    pendingSubmitFlush = setImmediate(() => {
      pendingSubmitFlush = null
      if (!pendingSubmit || !selected() || deps.lifecycle.state() !== 'active') return
      pendingSubmit = false
      submitOrCommand()
    })
  }

  function routeCancelIntent(runningSession: boolean): void {
    const sourceRevision = nextInteractionRevision()
    const intent = deps.composer.cancel({ key: 'ctrl-c', running: runningSession, sourceRevision })
    if (intent.kind === 'cancel') publishEvent({ kind: 'terminal.cancel', sourceId: 'composer.editor' })
    // Idle Ctrl+C is handled by the app-shell confirmation policy.
    if (intent.kind === 'rejected') fatalMessage = intent.message
    render()
  }

  function handleCtrlC(): void {
    if (deps.lifecycle.state() === 'exited' || deps.lifecycle.state() === 'failed') return
    deps.lifecycle.exit({ reason: 'ctrl-c' })
  }

  function handleKey(event: Extract<TuiRuntimeTerminalEvent, { type: 'key' }>): void {
    const { input, key } = event
    if (key.escape && running() && deps.executionStatus?.interrupt) {
      deps.executionStatus.interrupt()
      return
    }
    if (overlay() !== undefined) {
      if (key.escape || input === 'q') {
        closeOverlay()
        return
      }
      if (key.upArrow || key.pageUp || key.downArrow || key.pageDown) {
        deps.overlayManager.move(key.upArrow || key.pageUp ? -1 : 1)
        return
      }
      if (key.return) {
        deps.overlayManager.select()
        syncClosedOverlay()
      }
      return
    }
    if (key.escape && !running() && deps.composer.projectState().text.startsWith('/') && deps.slashCommandSuggestions !== undefined && escapePressedAt === null) {
      escapePressedAt = Date.now()
      commandSuggestionsSuppressed = true
      render()
      return
    }
    if (key.escape && !running() && deps.composer.projectState().text.length === 0) {
      const now = Date.now()
      if (escapePressedAt !== null && now - escapePressedAt <= 1000) {
        escapePressedAt = null
        const entries = (presentation()?.nodes ?? [])
          .filter(node => node.kind === 'conversation.user')
          .map(node => ({
            key: String(node.publicationRevision),
            label: typeof node.value.text === 'string' && node.value.text.length > 72 ? `${node.value.text.slice(0, 69)}...` : String(node.value.text ?? ''),
            seq: node.publicationRevision,
          }))
          .filter(item => Number.isSafeInteger(item.seq) && item.seq >= 0)
        if (entries.length === 0) {
          fatalMessage = 'fork history is empty'
          render()
          return
        }
        deps.overlayManager.open({
          kind: 'selector.fork-history',
          key: `fork-history-${String(now)}`,
          title: 'Fork from user message - Up/Down choose  Enter fork  Esc close',
          items: entries.map(item => ({ key: item.key, label: item.label })),
          selectedIndex: entries.length - 1,
          closable: true,
          sourceRevision: nextInteractionRevision(),
        }, itemKey => {
          const selected = entries.find(item => item.key === itemKey)
          if (selected === undefined || deps.forkSession === undefined) return
          deps.forkSession(selected.seq)
        })
        render()
        return
      }
      escapePressedAt = now
      return
    }
    if (key.ctrl && input.toLowerCase() === 'c') {
      handleCtrlC()
      return
    }
    commandSuggestionsSuppressed = false
    if (key.ctrl) return
    if (key.tab) {
      const text = deps.composer.projectState().text
      const suggestion = deps.slashCommandSuggestions?.(text)[0]
      if (suggestion !== undefined) {
        deps.composer.clearText()
        deps.composer.insertText(suggestion.command)
        render()
        return
      }
      if (!running()) return
      submitOrCommand()
      return
    }
    if (key.pageUp && !running() && deps.loadOlder !== undefined && deps.composer.projectState().text.length === 0) {
      void deps.loadOlder().catch(error => deps.lifecycle.fail(error instanceof Error ? error : new Error(String(error)), 'app-shell:load-older'))
      return
    }
    if (key.return) {
      if (key.shift) deps.composer.newline()
      else submitOrCommand()
      return
    }
    if (key.upArrow || key.downArrow) {
      const composerState = deps.composer.projectState()
      if (composerState.cursor === 0 || deps.composer.historyNavigating()) {
        if (key.upArrow) deps.composer.historyPrevious()
        else deps.composer.historyNext()
      } else {
        if (key.upArrow) deps.composer.moveUp()
        else deps.composer.moveDown()
      }
      render()
      return
    }
    if (key.backspace) deps.composer.backspace()
    else if (key.delete) deps.composer.delete()
    else if (key.leftArrow) deps.composer.moveLeft()
    else if (key.rightArrow) deps.composer.moveRight()
    else if (key.home) deps.composer.home()
    else if (key.end) deps.composer.end()
    else if (input.length > 0) deps.composer.insertText(input)
    else return
    render()
  }

  function closeOverlay(): void {
    const key = activeOverlayKey ?? (() => {
      const state = deps.overlayManager.projectState()
      return state.kind === 'view' && state.view.closable ? state.view.key : null
    })()
    if (key === null) return
    deps.overlayManager.close(key)
    clearOverlayFocus()
    render()
  }

  function clearOverlayFocus(): void {
    activeOverlayKey = null
    overlayFocusDispose?.()
    overlayFocusDispose = undefined
  }

  function syncClosedOverlay(): void {
    if (activeOverlayKey !== null && deps.overlayManager.projectState().kind === 'composer') {
      clearOverlayFocus()
    }
  }

  const controller: TuiRuntimeController = {
    installInputHandler() {
      deps.lifecycle.setInputHandler(event => {
        handleInputEvent(event)
      })
    },
    storeViewport,
    start() {
      this.installInputHandler()
      if (currentViewport === null) {
        routeFirstComposeFailure()
        return
      }
      started = true
      render()
    },
    stop(reason = 'explicit') {
      if (pendingSubmitFlush !== null) {
        clearImmediate(pendingSubmitFlush)
        pendingSubmitFlush = null
      }
      pendingSubmit = false
      closeOverlay()
      deps.lifecycle.setInputHandler(null)
      if (deps.lifecycle.state() === 'exited') return
      deps.lifecycle.exit({ reason })
    },
    render: renderNow,
    reportError(message) {
      if (typeof message !== 'string' || message.length === 0) {
        throw new TypeError('runtime error message must be non-empty')
      }
      fatalMessage = message
      render()
    },
    reportSubmissionError(message) {
      if (typeof message !== 'string' || message.length === 0) {
        throw new TypeError('runtime submission error message must be non-empty')
      }
      fatalMessage = message
      const pending = [...deps.composer.pendingEchoes()].at(-1)
      if (pending !== undefined) deps.composer.markSubmissionFailed(pending.echoId, message)
      render()
    },
    clearError() {
      fatalMessage = undefined
      render()
    },
    handleTerminalEvent(event) {
      handleKey(event)
    },
    openOverlay(input: Omit<TuiOverlayViewInput, 'items'> & {
      readonly items: ReadonlyArray<string | TuiOverlayViewInput['items'][number]>
    }, onSelect?: (itemKey: string) => void) {
    if (!['fatal', 'approval-question', 'selector.resume-current-cwd', 'command', 'queue', 'overlay.jobs', 'overlay.trajectory', 'overlay.help', 'interaction.approval', 'interaction.question', 'selector.model', 'selector.provider', 'selector.permission', 'selector.fork-history', 'selector.workspaces', 'selector.subagents', 'selector.session-search'].includes(String(input.kind))) {
        throw new TypeError(`runtime overlay view is not supported: ${String(input.kind)}`)
      }
      if (typeof input.title !== 'string' || input.title.length === 0) {
        throw new TypeError('runtime overlay title must be non-empty')
      }
      const normalizedItems = input.items.map(item => typeof item === 'string'
        ? Object.freeze({ key: item, label: item })
        : item)
      if (normalizedItems.length === 0 || normalizedItems.some(item => item.key.length === 0 || item.label.length === 0)) {
        throw new TypeError('runtime overlay items must contain non-empty strings')
      }
      const selectedIndex = input.selectedIndex ?? 0
      if (!Number.isSafeInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= normalizedItems.length) {
        throw new TypeError('runtime overlay selectedIndex is out of bounds')
      }
      closeOverlay()
      const removeFocus = deps.focus.pushView(input.kind)
      deps.overlayManager.open({
        ...input,
        items: normalizedItems,
        selectedIndex,
      }, onSelect)
      activeOverlayKey = input.key
      overlayFocusDispose = () => {
        removeFocus()
      }
      render()
    },
    closeOverlay,
    renderNow,
  }
  return controller
}

export function installViewportSubscriptionBeforeEnter(
  bus: Pick<TuiAppEventBus, 'subscribe'>,
  storeViewport: (viewport: TuiValidatedTerminalViewport) => void,
): () => void {
  return bus.subscribe((event: TuiInputIn02AppEvent) => {
    if (event.intent.kind === 'terminal.resize') storeViewport(event.intent.size)
  })
}

export type { TuiTerminalComposerState, TuiTerminalStatusState }
