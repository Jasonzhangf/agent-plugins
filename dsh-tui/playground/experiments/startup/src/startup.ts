/**
 * TUI startup composition.
 *
 * Wires the following modules into one runtime pipeline:
 *
 *   TuiSessionService  ──subscribe──▶  TuiPresentationService  ──subscribe──▶  TuiTerminalUiService
 *   TuiTerminalLifecycleService  ◀──render()──  TuiTerminalUiService
 *   TuiFocusManagerService
 *   TuiShellService  ◀──policy──  TuiRuntimeController
 *
 * Control chain (terminal input → business action → host mutation):
 *
 *   terminal intent  ──▶  TuiEventBusService  ──▶  TuiShellService  ──▶  TuiSessionService
 *
 * The startup composes a fresh Cordis Context, installs each service in the
 * correct order, subscribes the cross-service data flows, then returns a
 * controller that can start(), stop() and handleTerminalEvent().
 *
 * The transport, endpoint resolution, and host client are owned by
 * TuiSessionService.  Only the session service calls the DSH Host.
 */

import { Context } from '@deepseek-ai/cordis'
import { apply as applyEventBus } from '../../app-event-bus/src/app-event-bus.ts'
import { apply as applyDisplayControl } from '../../display-control/src/display-control.ts'
import { apply as applyAppContainer } from '../../app-container/src/app-container.ts'
import { apply as applyChromeSlotRegistry } from '../../chrome-slot-registry/src/chrome-slot-registry.ts'
import { tuiConnectionDisplayPlugin } from '../../tui-connection/src/tui-connection.ts'
import { tuiExecutionDisplayPlugin } from '../../tui-execution/src/tui-execution.ts'
import { tuiLogoDisplayPlugin } from '../../tui-logo/src/tui-logo.ts'
import { tuiSessionDisplayPlugin } from '../../tui-session/src/tui-session.ts'
import { tuiStatusDisplayPlugin } from '../../tui-status/src/tui-status.ts'
import { apply as applyComponentRegistry } from '../../component-registry/src/component-registry.ts'
import { apply as applyFocus } from '../../focus-manager/src/focus-manager.ts'
import {
  apply as applyLogicControls,
  applyConnection,
  applyExecution,
  applyInput,
  applyLogo,
  applySession as applySessionControl,
  applySlashCommand,
  applyStatus,
  type LogicControlSourceCapability,
} from '../../logic-controls/src/logic-controls.ts'
import { apply as applyPresentation } from '../../presentation/src/presentation.ts'
import { apply as applyComposerPlugin } from '../../composer-plugin/src/composer-plugin.ts'
import { apply as applyOverlayManagerPlugin } from '../../overlay-manager-plugin/src/overlay-manager-plugin.ts'
import { apply as applyRefreshOrchestrator } from '../../refresh-orchestrator/src/refresh-orchestrator.ts'
import { apply as applySessionSwitcherPlugin } from '../../session-switcher-plugin/src/session-switcher-plugin.ts'
import { apply as applySlashCommandPlugin } from '../../slash-command-plugin/src/slash-command-plugin.ts'
import { apply as applySession } from '../../session/src/session.ts'
import { apply as applyTerminalUi } from '../../terminal-ui/src/terminal-ui.ts'
import { apply as applyLifecycle } from '../../terminal-lifecycle/src/terminal-lifecycle.ts'
import { apply as applyStatusFooter } from '../../status-footer-plugin/src/status-footer-plugin.ts'
import {
  apply as applyShell,
  type TuiInputIn03BusinessAction,
  type TuiShellPolicy,
} from '../../app-shell/src/app-shell.ts'
import {
  type TuiSessionSnapshot,
} from '../../session/src/session.ts'
import { NodeApiClient, resolveEndpoint } from '../../transport/src/transport.ts'
import type { TuiPresentationModel } from '../../presentation/src/presentation.ts'
import {
  createTuiRuntimeController,
  installViewportSubscriptionBeforeEnter,
  type TuiRuntimeTerminalEvent,
} from '../../app-shell/src/app-shell.ts'
import type { TuiTerminalLifecycle } from '../../terminal-lifecycle/src/terminal-lifecycle.ts'
import type { TuiFocusManager } from '../../focus-manager/src/focus-manager.ts'
import type { TuiChromeDisplayPlugin } from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'
import type { TuiFocusViewId } from '../../../../contracts/tui/focus-manager/focus-manager.types.ts'

export interface TuiStartupOptions {
  endpoint?: string
  resumeSessionId?: string
  continueSession?: boolean
  cwd?: string
}

export interface TuiStartup {
  readonly controller: ReturnType<typeof createTuiRuntimeController>
  readonly exited: Promise<TuiStartupOutcome>
  readonly dispose: () => void
}

export type TuiStartupOutcome =
  | { readonly state: 'exited' }
  | { readonly state: 'failed'; readonly error: Error }

export function exitCodeForTuiStartupOutcome(outcome: TuiStartupOutcome): 0 | 1 {
  return outcome.state === 'failed' ? 1 : 0
}

export function projectTerminalFailureOutcome(
  lifecycle: TuiTerminalLifecycle,
): { readonly exited: Promise<TuiStartupOutcome>; readonly dispose: () => void } {
  let unsubscribe: (() => void) | null = null
  let disposed = false
  let resolveExited: ((outcome: TuiStartupOutcome) => void) | null = null
  const settle = (outcome: TuiStartupOutcome): void => {
    if (disposed) return
    disposed = true
    const release = unsubscribe
    const resolve = resolveExited
    unsubscribe = null
    resolveExited = null
    release?.()
    resolve?.(outcome)
  }
  const exited = new Promise<TuiStartupOutcome>(resolve => {
    resolveExited = resolve
    const disposer = lifecycle.subscribe(state => {
      if (state === 'exited') settle({ state: 'exited' })
      if (state === 'failed') {
        settle({
          state: 'failed',
          error: lifecycle.failure() ?? new Error('terminal lifecycle failed without an error'),
        })
      }
    })
    if (disposed) disposer()
    else unsubscribe = disposer
  })
  return {
    exited,
    dispose(): void {
      if (disposed) return
      disposed = true
      const release = unsubscribe
      const resolve = resolveExited
      unsubscribe = null
      resolveExited = null
      release?.()
      resolve?.({ state: 'exited' })
    },
  }
}

export interface TuiStartupLogicControlSources {
  readonly input: LogicControlSourceCapability
  readonly status: LogicControlSourceCapability
  readonly connection: LogicControlSourceCapability
  readonly execution: LogicControlSourceCapability
  readonly session: LogicControlSourceCapability
  readonly slashCommand: LogicControlSourceCapability
  readonly logo: LogicControlSourceCapability
}

const chromeDisplayPlugins: ReadonlyArray<TuiChromeDisplayPlugin> = Object.freeze([
  tuiLogoDisplayPlugin,
  tuiConnectionDisplayPlugin,
  tuiSessionDisplayPlugin,
  tuiStatusDisplayPlugin,
  tuiExecutionDisplayPlugin,
])

export function installLogicControlComposition(ctx: Context): TuiStartupLogicControlSources {
  applyLogicControls(ctx)
  applyInput(ctx)
  applyStatus(ctx)
  applyConnection(ctx)
  applyExecution(ctx)
  applySessionControl(ctx)
  applySlashCommand(ctx)
  applyLogo(ctx)
  const sources = Object.freeze({
    input: ctx.tuiLogicControls.bindSource(ctx, 'terminal_input_control'),
    status: ctx.tuiLogicControls.bindSource(ctx, 'tui_status_control'),
    connection: ctx.tuiLogicControls.bindSource(ctx, 'transport_control'),
    execution: ctx.tuiLogicControls.bindSource(ctx, 'tui_execution_control'),
    session: ctx.tuiLogicControls.bindSource(ctx, 'current_session_selection'),
    slashCommand: ctx.tuiLogicControls.bindSource(ctx, 'tui_app_event_bus'),
    logo: ctx.tuiLogicControls.bindSource(ctx, 'logic_control_registry'),
  })
  sources.logo.dispatch({ control: 'logo', action: 'set', variant: 'full', visible: true })
  return sources
}

export function wireLogicControlEvents(
  ctx: Context,
  sources: TuiStartupLogicControlSources,
): () => void {
  return ctx.tuiEventBus.subscribe(event => {
    switch (event.intent.kind) {
      case 'focus.activate':
        ctx.tuiFocusManager.activate(event.intent.target)
        break
      case 'terminal.resize':
        break
      default:
        ctx.tuiShell.dispatch(event)
    }
    if (event.intent.kind === 'terminal.submit' && event.intent.text.length > 0) {
      sources.input.dispatch({ control: 'input', action: 'submit', text: event.intent.text })
    }
  })
}

/** Wires all services and returns a started TuiRuntimeController. */
export async function startTui(options: TuiStartupOptions = {}): Promise<TuiStartup> {
  const cwd = options.cwd ?? process.cwd()
  const precedence: { cli?: string; env?: string } = {}
  if (options.endpoint !== undefined) precedence.cli = options.endpoint
  const envEndpoint = process.env['DSH_WEB_URL']
  if (envEndpoint !== undefined) precedence.env = envEndpoint
  const endpoint = resolveEndpoint(precedence)
  const apiClient = new NodeApiClient(endpoint)

  // Build the host interface expected by TuiSessionService.
  const host = {
    sessions: apiClient.sessions,
    events: apiClient.events,
    respond: apiClient.respond.bind(apiClient),
  }

  let lifecycle: TuiTerminalLifecycle | null = null
  let runtimeController: ReturnType<typeof createTuiRuntimeController> | null = null
  let reportRuntimeError = (message: string): void => {
    process.stderr.write(`error: ${message}\n`)
  }
  let reportSubmissionError = reportRuntimeError

  function reportAsyncFailure(prefix: string, error: unknown): void {
    reportRuntimeError(`${prefix}: ${error instanceof Error ? error.message : String(error)}`)
  }

  let commandSourceRevision = 0

  // Phase 1 — build a fresh Cordis context and install all services
  const ctx = new Context()
  applyEventBus(ctx)
  applyDisplayControl(ctx)
  const logicSources = installLogicControlComposition(ctx)
  applyRefreshOrchestrator(ctx)
  applySlashCommandPlugin(ctx)
  applySessionSwitcherPlugin(ctx, {
    currentCwd: cwd,
    fetcher: {
      async listForCurrentCwd(requestRevision) {
        const options = await ctx.tuiSession.listCurrentCwdSessions(host, cwd)
        return {
          summaries: options.map(option => ({
            ...option,
            title: null,
            lifecycle: option.running ? ('running' as const) : 'idle',
          })),
          filteredCount: 0,
          requestRevision,
        }
      },
    },
    selectionPublisher: {
      publish(intent) {
        if (intent.kind !== 'select') {
          reportRuntimeError(`session selector rejected: ${intent.message}`)
          return
        }
        void ctx.tuiSession.resume(host, intent.sessionId, intent.cwd).then(() => {
          runtimeController?.clearError()
        }).catch(error => {
          reportAsyncFailure('/resume failed', error)
        })
      },
    },
  })
  applyOverlayManagerPlugin(ctx, { refreshPublisher: ctx.tuiRefreshOrchestrator })
  applyComposerPlugin(ctx)
  applyComponentRegistry(ctx)
  applyFocus(ctx)
  applySession(ctx)
  applyPresentation(ctx)
  applyTerminalUi(ctx)
  applyChromeSlotRegistry(ctx)
  for (const plugin of chromeDisplayPlugins) await ctx.plugin(plugin)
  applyStatusFooter(ctx)
  applyAppContainer(ctx)
  applyLifecycle(ctx)
  applyShell(ctx, {
    policy: {
      composerEmpty: true,
      sessionRunning: false,
      sessionSelected: false,
    } as TuiShellPolicy,
    dispatchBusiness(action: TuiInputIn03BusinessAction) {
      // Dispatch routes BusinessAction → Session mutation.
      // This is the only place where app-shell actions become host calls.
      switch (action.kind) {
        case 'session.prompt': {
          void ctx.tuiSession.prompt(action.text).then(result => {
            if (!result.ok) reportSubmissionError(`prompt failed: ${result.error.message}`)
          }).catch(error => {
            reportSubmissionError(`prompt failed: ${error instanceof Error ? error.message : String(error)}`)
          })
          return
        }
        case 'session.cancel': {
          void ctx.tuiSession.cancel().then(result => {
            if (!result.ok) reportRuntimeError(`cancel failed: ${result.error.message}`)
          }).catch(error => {
            reportAsyncFailure('cancel failed', error)
          })
          return
        }
        case 'interaction.approval.respond': {
          void ctx.tuiSession.respondApproval(action.interactionId, action.decision).catch(error => {
            reportAsyncFailure('approval response failed', error)
          })
          return
        }
        case 'interaction.question.respond': {
          void ctx.tuiSession.respondQuestion(
            action.interactionId,
            action.answer as Parameters<typeof ctx.tuiSession.respondQuestion>[1],
          ).catch(error => {
            reportAsyncFailure('question response failed', error)
          })
          return
        }
      }
    },
    dispatchControl(action) {
      commandSourceRevision += 1
      const intent = ctx.tuiSlashCommand!.parse({
        text: action.input,
        sourceRevision: commandSourceRevision,
      })
      if (intent.kind === 'rejected') {
        reportRuntimeError(`slash command rejected: ${intent.message}`)
        return
      }
      logicSources.slashCommand.dispatch({
        control: 'slash-command',
        action: 'project',
        input: action.input,
        command: intent.kind === 'resume'
          ? `/resume`
          : `/${intent.kind}`,
        args: intent.kind === 'resume' && intent.sessionId !== null ? [intent.sessionId] : [],
        accepted: true,
      })
      if (intent.kind === 'help') {
        if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
        runtimeController.openOverlay({
          kind: 'overlay.help',
          key: `overlay-help-${String(intent.sourceRevision)}`,
          title: 'dsh-tui help - Esc closes',
          items: [
            '/resume - choose a Session from current cwd',
            '/resume <sessionId> - resume exact current-cwd Session',
            '/quit - restore terminal and exit',
            'Shift+Enter - newline',
            'Ctrl+C - cancel running turn; press twice within 3s to quit',
            'Up/Down or PageUp/PageDown - transcript scroll',
          ],
          closable: true,
          sourceRevision: intent.sourceRevision,
        })
        return
      }
      if (intent.kind === 'quit') {
        if (lifecycle === null) throw new Error('TUI terminal lifecycle is not ready')
        lifecycle.exit({ reason: 'slash-quit' })
        return
      }
      if (intent.sessionId !== null) {
        void ctx.tuiSession.resume(host, intent.sessionId, cwd).then(() => {
          runtimeController?.clearError()
        }).catch(error => {
          reportAsyncFailure('/resume failed', error)
        })
        return
      }
      ctx.tuiSessionSwitcher!.startListing(intent.sourceRevision)
    },
  })

  const eventDispose = wireLogicControlEvents(ctx, logicSources)

  // Phase 2 — subscribe session → presentation pipeline
  let latestSnapshot: TuiSessionSnapshot | null = null
  let latestModel: TuiPresentationModel | null = null
  let requestRender = (): void => undefined
  let refreshSourceRevision = 0
  let refreshDispose: (() => void) | null = null

  const presentationDispose = ctx.tuiPresentation.subscribe(model => {
    latestModel = model
    requestRender()
  })
  const sessionDispose = ctx.tuiSession.subscribe(snapshot => {
    latestSnapshot = snapshot
    logicSources.session.dispatch({
      control: 'session',
      action: 'snapshot',
      selectedSessionId: snapshot.sessionId,
      availableSessionIds: snapshot.availableSessionIds ?? [snapshot.sessionId],
      cwd: snapshot.cwd,
      lifecycle: 'active',
    })
    logicSources.status.dispatch({
      control: 'status',
      action: 'set',
      sessionId: snapshot.sessionId,
      cwd: snapshot.cwd,
      mode: snapshot.error ? 'error' : snapshot.running ? 'streaming' : 'idle',
    })
    logicSources.connection.dispatch({
      control: 'connection',
      action: 'set',
      state: snapshot.live ? 'connected' : 'disconnected',
    })
    logicSources.execution.dispatch({
      control: 'execution',
      action: 'set',
      state: snapshot.error ? 'failed' : snapshot.running ? 'running' : 'idle',
      turnId: null,
    })
    const displaySourceRevision = snapshot.lastSeq
    const executionLifecycle = ctx.tuiDisplayControl.get('tui.execution')
    const connectionLifecycle = ctx.tuiDisplayControl.get('tui.connection')
    const statusLifecycle = ctx.tuiDisplayControl.get('tui.status')
    const executionIsLive = snapshot.error || snapshot.running
    const connectionIsLive = snapshot.live
    const statusIsLive = snapshot.error || snapshot.running
    if (executionLifecycle) {
      if (executionIsLive) executionLifecycle.showLive(displaySourceRevision, 8000)
      else executionLifecycle.dismissLive()
    }
    if (connectionLifecycle) {
      if (connectionIsLive) connectionLifecycle.showLive(displaySourceRevision, 8000)
      else connectionLifecycle.dismissLive()
    }
    if (statusLifecycle) {
      if (statusIsLive) statusLifecycle.showLive(displaySourceRevision, 8000)
      else statusLifecycle.dismissLive()
    }
    // Presentation owns event-log projection. Startup only forwards the
    // hydrated/live session snapshot into that service.
    ctx.tuiPresentation.project({
      sessionId: snapshot.sessionId,
      lastSeq: snapshot.lastSeq,
      entries: snapshot.entries,
    })
  })

  // Phase 3 — create or resume the session
  let sessionDisposeChain: (() => void) | null = null

  if (options.resumeSessionId) {
    try {
      const snapshot = await ctx.tuiSession.resume(host, options.resumeSessionId, cwd)
      sessionDisposeChain = () => {
        sessionDispose()
        presentationDispose()
        eventDispose()
        viewportDispose()
        ctx.tuiSession.dispose()
      }
      void snapshot // consume to avoid unused warning
    } catch (err) {
      sessionDispose()
      presentationDispose()
      eventDispose()
      throw err
    }
  } else if (options.continueSession) {
    try {
      const latest = await ctx.tuiSession.latestCurrentCwdSession(host, cwd)
      const snapshot = latest === null
        ? await ctx.tuiSession.createCurrentCwd(host, cwd)
        : await ctx.tuiSession.resume(host, latest.sessionId, cwd)
      sessionDisposeChain = () => {
        sessionDispose()
        presentationDispose()
        eventDispose()
        viewportDispose()
        ctx.tuiSession.dispose()
      }
      void snapshot
    } catch (err) {
      sessionDispose()
      presentationDispose()
      eventDispose()
      throw err
    }
  } else {
    try {
      const snapshot = await ctx.tuiSession.createCurrentCwd(host, cwd)
      sessionDisposeChain = () => {
        sessionDispose()
        presentationDispose()
        eventDispose()
        viewportDispose()
        ctx.tuiSession.dispose()
      }
      void snapshot
    } catch (err) {
      sessionDispose()
      presentationDispose()
      eventDispose()
      throw err
    }
  }

  // Phase 4 — build the runtime controller
  lifecycle = ctx.tuiTerminalLifecycle as TuiTerminalLifecycle
  const focus = ctx.tuiFocusManager as TuiFocusManager

  const terminalLifecycle = lifecycle
  const startupOutcomeProjection = projectTerminalFailureOutcome(terminalLifecycle)
  const exited = startupOutcomeProjection.exited
  let projectedSelectorRevision = -1
  const selectorDispose = ctx.tuiSessionSwitcher!.subscribe(state => {
    if (state.requestRevision === 0 || state.kind === 'listing' || state.kind === 'selecting') return
    if (state.requestRevision === projectedSelectorRevision) return
    projectedSelectorRevision = state.requestRevision
    if (state.kind === 'failed') {
      reportRuntimeError(`/resume listing failed: ${state.errorMessage ?? 'unknown error'}`)
      return
    }
    if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
    if (state.list.length === 0) {
      reportRuntimeError('/resume found no Sessions in current cwd')
      return
    }
    if (state.kind !== 'idle') return
    runtimeController.openOverlay({
      kind: 'selector.resume-current-cwd',
      key: `session-selector-${String(state.requestRevision)}`,
      title: 'Resume current cwd - Enter selects, q/Esc closes',
      items: state.list.map(summary => ({
        key: summary.sessionId,
        label: `${summary.sessionId}${summary.running ? ' [running]' : ''}`,
      })),
      closable: true,
      selectedIndex: Math.max(0, state.selectedIndex),
      sourceRevision: state.requestRevision,
    }, itemKey => {
      const selectedSummary = state.list.find(summary => summary.sessionId === itemKey)
      if (selectedSummary === undefined) {
        reportRuntimeError('/resume selector returned an unknown session key')
        return
      }
      commandSourceRevision += 1
      const selectionIntent = ctx.tuiSessionSwitcher!.select(selectedSummary, commandSourceRevision)
      if (selectionIntent.kind === 'rejected') {
        reportRuntimeError(`session selection rejected: ${selectionIntent.message}`)
      }
    })
  })

  const controller = createTuiRuntimeController({
    getSnapshot: () => latestSnapshot,
    getPresentation: () => latestModel,
    refresh: ctx.tuiRefreshOrchestrator,
    shell: ctx.tuiShell,
    appContainer: ctx.tuiAppContainer,
    terminalUi: ctx.tuiTerminalUi,
    chrome: ctx.tuiChromeSlotRegistry,
    statusFooter: ctx.tuiStatusFooter,
    composer: ctx.tuiComposer!,
    overlayManager: ctx.tuiOverlayManager!,
    lifecycle: terminalLifecycle,
    focus: {
      pushView(view) {
        return ctx.tuiFocusManager.pushView(view)
      },
      activeView() {
        return ctx.tuiFocusManager.viewState().activeView as TuiFocusViewId
      },
    },
    emitEvent(event) {
      ctx.tuiEventBus.publish(event as never)
    },
  })
  runtimeController = controller
  reportRuntimeError = message => controller.reportError(message)
  reportSubmissionError = message => controller.reportSubmissionError(message)
  requestRender = () => {
    refreshSourceRevision += 1
    const result = ctx.tuiRefreshOrchestrator.request({
      sourceModuleId: 'presentation',
      reason: 'presentation',
      sourceRevision: refreshSourceRevision,
    })
    if (result.status === 'rejected') {
      throw new Error(`startup: refresh request rejected (${result.reason}): ${result.message}`)
    }
  }
  const viewportDispose = installViewportSubscriptionBeforeEnter(
    ctx.tuiEventBus,
    viewport => controller.storeViewport(viewport),
  )
  controller.installInputHandler()
  function subscribeAppRenderToRefresh(): () => void {
    return ctx.tuiRefreshOrchestrator.subscribe(() => controller.renderNow())
  }

  // Phase 5 — wire session live events into presentation
  // The session already publishes via its internal subscription.
  // We subscribe the presentation to the session snapshot.
  terminalLifecycle.enter({ stdout: process.stdout, stdin: process.stdin, stderr: process.stderr })
  refreshDispose = subscribeAppRenderToRefresh()
  controller.start()

  return {
  controller,
  dispose(): void {
    controller.stop('dispose')
    startupOutcomeProjection.dispose()
    selectorDispose()
    if (sessionDisposeChain) sessionDisposeChain()
    refreshDispose?.()
    refreshDispose = null
    for (const source of Object.values(logicSources)) source.dispose()
  },
  exited,
  }
}
