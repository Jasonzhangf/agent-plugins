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
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { apply as applyEventBus } from '../../app-event-bus/src/app-event-bus.ts'
import { apply as applyDisplayControl } from '../../display-control/src/display-control.ts'
import { apply as applyAppContainer } from '../../app-container/src/app-container.ts'
import { apply as applyChromeSlotRegistry } from '../../chrome-slot-registry/src/chrome-slot-registry.ts'
import { tuiConnectionDisplayPlugin } from '../../tui-connection/src/tui-connection.ts'
import { tuiExecutionDisplayPlugin } from '../../tui-execution/src/tui-execution.ts'
import { projectLogoStableElement, tuiLogoDisplayPlugin } from '../../tui-logo/src/tui-logo.ts'
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
import {
  apply as applySessionSwitcherPlugin,
  resumeSessionLabel,
} from '../../session-switcher-plugin/src/session-switcher-plugin.ts'
import { apply as applySlashCommandPlugin } from '../../slash-command-plugin/src/slash-command-plugin.ts'
import { apply as applySession } from '../../session/src/session.ts'
import { apply as applyTerminalUi } from '../../terminal-ui/src/terminal-ui.ts'
import { apply as applyToolCardPlugin } from '../../tool-card-plugin/src/tool-card-plugin.ts'
import { apply as applyTextParserPlugin } from '../../text-parser-plugin/src/text-parser-plugin.ts'
import { apply as applyInteractiveWindowPlugin } from '../../interactive-window-plugin/src/interactive-window-plugin.ts'
import { apply as applyExecutionStatusPlugin } from '../../execution-status-plugin/src/execution-status-plugin.ts'
import { apply as applyTerminalRawBufferPlugin } from '../../terminal-raw-buffer-plugin/src/terminal-raw-buffer-plugin.ts'
import { apply as applyInterpreterPlugin } from '../../interpreter-plugin/src/interpreter-plugin.ts'
import { apply as applyDisplayBufferPlugin } from '../../display-buffer-plugin/src/display-buffer-plugin.ts'
import { apply as applyTerminalRenderPlugin } from '../../terminal-render-plugin/src/terminal-render-plugin.ts'
import { apply as applyTerminalOutputPlugin } from '../../terminal-output-plugin/src/terminal-output-plugin.ts'
import { apply as applyThemePlugin } from '../../theme-plugin/src/theme-plugin.ts'
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
  /** Test harness side-channel; writes only public presentation node identity. */
  projectionFile?: string
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
  sources.connection.dispatch({ control: 'connection', action: 'set', state: 'connecting' })
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
    command: apiClient.command.bind(apiClient),
    events: apiClient.events,
    respond: apiClient.respond.bind(apiClient),
  }

  let lifecycle: TuiTerminalLifecycle | null = null
  let runtimeController: ReturnType<typeof createTuiRuntimeController> | null = null
  let reportRuntimeError = (message: string): void => {
    process.stderr.write(`error: ${message}\n`)
  }
  let reportSubmissionError = reportRuntimeError

  function beginExecutionStatus(title: string): void {
    const execution = ctx.tuiExecutionStatus
    if (!execution || execution.project().state === 'running') return
    execution.start(title)
  }

  function reportAsyncFailure(prefix: string, error: unknown): void {
    // Preserve Host RPC error code and message verbatim
    if (error && typeof error === 'object') {
      const e = error as Record<string, unknown>
      if (typeof e['code'] === 'string' && typeof e['message'] === 'string') {
        reportRuntimeError(`${prefix}: [${e['code']}] ${e['message']}`)
        return
      }
      if (error instanceof Error && error['cause']) {
        const cause = (error as Error & {cause?: Record<string,unknown>})['cause']
        if (cause && typeof cause['code'] === 'string' && typeof cause['message'] === 'string') {
          reportRuntimeError(`${prefix}: [${cause['code']}] ${cause['message']}`)
          return
        }
      }
    }
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
          summaries: options.filter(option => !option.blank).map(option => ({
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
  applyInteractiveWindowPlugin(ctx)
  applyExecutionStatusPlugin(ctx)
  applyTerminalRawBufferPlugin(ctx)
  applyInterpreterPlugin(ctx)
  applyDisplayBufferPlugin(ctx)
  applyTerminalRenderPlugin(ctx)
  applyTerminalOutputPlugin(ctx)
  applyThemePlugin(ctx)
  applyComposerPlugin(ctx)
  applyComponentRegistry(ctx)
  applyTextParserPlugin(ctx)
  applyToolCardPlugin(ctx)
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
          beginExecutionStatus('Running')
          void ctx.tuiSession.prompt(action.text).then(result => {
            if (!result.ok) reportSubmissionError(`prompt failed: ${result.error.message}`)
          }).catch(error => {
            if (ctx.tuiExecutionStatus?.project().state === 'running' && ctx.tuiSession.snapshot?.running !== true) {
              ctx.tuiExecutionStatus.stop('failed')
            }
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
      // /new → create a new session for this cwd
      if (intent.kind === 'new') {
        logicSources.slashCommand.dispatch({
          control: 'slash-command',
          action: 'project',
          input: action.input,
          command: '/new',
          args: [],
          accepted: true,
        })
        void ctx.tuiSession.createCurrentCwd(host, cwd).then(snapshot => {
          runtimeController?.clearError()
        }).catch(error => {
          reportAsyncFailure('/new failed', error)
        })
        return
      }
      // Host commands → execute via sessions.prompt()
      if (intent.kind === 'host') {
        if (intent.command === 'thinking') {
          const current = ctx.tuiSession.snapshot
          const effort = intent.args[0]
          if (!current?.model || effort === undefined) {
            reportRuntimeError('/thinking: selected model is unavailable')
            return
          }
          logicSources.slashCommand.dispatch({
            control: 'slash-command',
            action: 'project',
            input: action.input,
            command: '/thinking',
            args: [effort],
            accepted: true,
          })
          beginExecutionStatus('Selecting thinking effort')
          void ctx.tuiSession.selectModel({
            provider: current.model.provider,
            model: current.model.model,
            reasoningEffort: effort,
          }).then(result => {
            if (!result.ok) reportRuntimeError(`/thinking: [${result.error.code}] ${result.error.message}`)
          }).catch(error => reportAsyncFailure('/thinking failed', error))
          return
        }
        if (intent.command === 'export') {
          const mode = intent.args[0] ?? 'all'
          if (mode !== 'all' && mode !== 'root-only') {
            reportRuntimeError('/export: argument must be all or root-only')
            return
          }
          const selected = ctx.tuiSession.snapshot
          if (!selected) {
            reportRuntimeError('/export: no Session is selected')
            return
          }
          beginExecutionStatus('Exporting Session')
          void apiClient.exportSessionLog(selected.sessionId, mode === 'all').then(bytes => {
            const output = join(cwd, `dsh-session-${selected.sessionId}.zip`)
            writeFileSync(output, bytes)
            reportRuntimeError(`Session export written to ${output}`)
          }).catch(error => reportAsyncFailure('/export failed', error))
          return
        }
        logicSources.slashCommand.dispatch({
          control: 'slash-command',
          action: 'project',
          input: action.input,
          command: `/${intent.command}`,
          args: [...intent.args],
          accepted: true,
        })
        beginExecutionStatus(`Running /${intent.command}`)
        const hostLine = `/${intent.command}${intent.args.length > 0 ? ` ${intent.args.join(' ')}` : ''}`
        void ctx.tuiSession.prompt(hostLine).then(result => {
          if (!result.ok) {
            if (ctx.tuiExecutionStatus?.project().state === 'running' && ctx.tuiSession.snapshot?.running !== true) {
              ctx.tuiExecutionStatus.stop('failed')
            }
            reportRuntimeError(`/${intent.command}: [${result.error.code}] ${result.error.message}`)
          }
        }).catch(error => {
          if (ctx.tuiExecutionStatus?.project().state === 'running' && ctx.tuiSession.snapshot?.running !== true) {
            ctx.tuiExecutionStatus.stop('failed')
          }
          reportAsyncFailure(`/${intent.command} failed`, error)
        })
        return
      }
      if (intent.kind === 'interactive') {
        const command = intent.command
        const openModels = async (providerFilter?: string): Promise<void> => {
          const selectedSession = ctx.tuiSession.snapshot
          if (!selectedSession) throw new Error('models selector requires a selected Session')
          const response = await host.sessions.models({ sessionId: selectedSession.sessionId })
          const result = response.result
          if (!result.ok) throw new Error(`models listing failed: ${result.error.message}`)
          const groups = providerFilter === undefined
            ? result.value.groups
            : result.value.groups.filter(group => group.id === providerFilter)
          const items = groups.flatMap(group => group.models.map(model => {
            const effort = model.reasoning?.defaultEffort
            const key = `${group.id}\u0000${model.id}\u0000${effort ?? ''}`
            return { key, label: `${group.name}/${model.name}${effort ? ` · ${effort}` : ''}` }
          }))
          if (items.length === 0) throw new Error(`no models available${providerFilter === undefined ? '' : ` for provider ${providerFilter}`}`)
          ctx.tuiInteractiveWindow!.open({
            kind: 'models',
            key: `interactive-models-${String(intent.sourceRevision)}`,
            title: providerFilter === undefined
              ? '/models  ·  ↑↓ choose  Enter apply  Esc close'
              : `/provider ${providerFilter}  ·  ↑↓ choose  Enter apply  Esc close`,
            items,
            selectedIndex: Math.max(0, items.findIndex(item => item.key.startsWith(`${result.value.current.provider}\u0000${result.value.current.model}\u0000`))),
            sourceRevision: intent.sourceRevision,
          }, itemKey => {
            const [provider, model, reasoningEffort] = itemKey.split('\u0000')
            if (provider === undefined || model === undefined) throw new Error('models selector returned an invalid item key')
            void ctx.tuiSession.selectModel({ provider, model, ...(reasoningEffort === undefined || reasoningEffort.length === 0 ? {} : { reasoningEffort }) }).then(result => {
              if (!result.ok) reportRuntimeError(`/models: [${result.error.code}] ${result.error.message}`)
            }).catch(error => reportAsyncFailure('/models failed', error))
          })
        }
        void (async () => {
          if (command === 'models') {
            await openModels()
            return
          }
          if (command === 'provider') {
            const response = await apiClient.llm.providers({})
            if (!response.result.ok) throw new Error(`provider listing failed: ${response.result.error.message}`)
            const items = response.result.value.providers.map(provider => ({
              key: provider.provider,
              label: `${provider.displayName} (${provider.provider})${provider.active ? '' : ' · inactive'}`,
            }))
            if (items.length === 0) throw new Error('no providers available')
            ctx.tuiInteractiveWindow!.open({
              kind: 'provider',
              key: `interactive-provider-${String(intent.sourceRevision)}`,
              title: '/provider  ·  ↑↓ choose  Enter open  Esc close',
              items,
              selectedIndex: Math.max(0, items.findIndex(item => item.key === ctx.tuiSession.snapshot?.model?.provider)),
              sourceRevision: intent.sourceRevision,
            }, itemKey => { void openModels(itemKey).catch(error => reportAsyncFailure('/provider failed', error)) })
            return
          }
          if (command === 'workspaces') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const response = await apiClient.workspace.list({})
            if (!response.result.ok) throw new Error(`workspace listing failed: ${response.result.error.message}`)
            const items = response.result.value.items.map(workspace => ({
              key: workspace.workspaceId,
              label: `${workspace.title} · ${workspace.path} · ${String(workspace.sessionIds.length)} sessions`,
            }))
            if (items.length === 0) throw new Error('no workspaces available')
            runtimeController.openOverlay({
              kind: 'selector.workspaces',
              key: `workspaces-${String(intent.sourceRevision)}`,
              title: '/workspaces  ·  ↑↓ inspect  Esc close',
              items,
              closable: true,
              sourceRevision: intent.sourceRevision,
            })
            return
          }
          if (command === 'search') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const query = intent.args.join(' ').trim()
            if (query.length === 0) throw new Error('/search requires a query')
            const response = await apiClient.sessions.search({ query }, new AbortController().signal)
            if (!response.result.ok) throw new Error(`session search failed: ${response.result.error.message}`)
            const items = response.result.value.items.map(item => ({
              key: item.sessionId,
              label: `${item.sessionId} · ${item.snippet}`,
            }))
            if (items.length === 0) throw new Error(`no Sessions matched ${query}`)
            runtimeController.openOverlay({
              kind: 'selector.session-search',
              key: `session-search-${String(intent.sourceRevision)}`,
              title: `/search ${query}  ·  ↑↓ choose  Enter resume  Esc close`,
              items,
              closable: true,
              sourceRevision: intent.sourceRevision,
            }, itemKey => {
              void ctx.tuiSession.resume(host, itemKey, cwd).then(() => runtimeController?.clearError()).catch(error => reportAsyncFailure('/search resume failed', error))
            })
            return
          }
          if (command === 'subagents') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('subagents selector requires a selected Session')
            const response = await apiClient.subagents.list({ parentSessionId: selected.sessionId })
            if (!response.result.ok) throw new Error(`subagent listing failed: ${response.result.error.message}`)
            const items = response.result.value.entries.map(entry => entry.kind === 'diagnostic'
              ? { key: entry.id, label: `${entry.id} · unavailable (${entry.reason})` }
              : { key: entry.id, label: `${entry.label ?? entry.id} · ${entry.activity}${entry.mode === 'continuable' ? ' · continuable' : ''}` })
            if (items.length === 0) throw new Error('no subagents available')
            runtimeController.openOverlay({
              kind: 'selector.subagents',
              key: `subagents-${String(intent.sourceRevision)}`,
              title: '/subagents  ·  ↑↓ inspect  Esc close',
              items,
              closable: true,
              sourceRevision: intent.sourceRevision,
            })
            return
          }
          const value = projectionValue(ctx.tuiSession.snapshot!, 'permissions')
          if (!value || typeof value !== 'object') throw new Error('permissions projection is unavailable')
          const permission = value as { readonly options?: readonly { readonly value: string; readonly name: string; readonly description?: string }[]; readonly currentValue?: string }
          const items = permission.options?.map(option => ({
            key: option.value,
            label: `${option.name}${option.description ? ` · ${option.description}` : ''}`,
          })) ?? []
          if (items.length === 0) throw new Error('no permissions available')
          ctx.tuiInteractiveWindow!.open({
            kind: 'permissions',
            key: `interactive-permissions-${String(intent.sourceRevision)}`,
            title: '/permissions  ·  ↑↓ choose  Enter apply  Esc close',
            items,
            selectedIndex: Math.max(0, items.findIndex(item => item.key === permission.currentValue)),
            sourceRevision: intent.sourceRevision,
          }, itemKey => {
          void ctx.tuiSession.command(`/permission ${itemKey}`).then(result => {
            if (!result.ok) reportRuntimeError(`/permissions: [${result.error.code}] ${result.error.message}`)
            else if (!result.value.matched) reportRuntimeError('/permissions: Host offers no /permission command')
          }).catch(error => reportAsyncFailure('/permissions failed', error))
          })
        })().catch(error => reportAsyncFailure(`/${command} failed`, error))
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
            '/new - create a new Session in current cwd',
            '/plan <message> or /plan off - set plan mode',
            '/permission <preset> - set permission level',
            '/model <model> - switch model',
            '/thinking <effort> - set thinking effort',
            '/compact - compact session history',
            '/goal <args> - run goal command',
            '/doctor - check configuration',
            '/rename <title> - rename session',
            '/fork [atSeq] - fork the current session',
            '/resume - choose a Session from current cwd',
            '/quit - restore terminal and exit',
            'Shift+Enter - newline',
            'Ctrl+C - cancel running turn; press twice within 3s to quit',
            'Terminal scrollback - review earlier history',
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
  let latestModel: TuiPresentationModel | null = Object.freeze({ nodes: Object.freeze([]), publicationRevision: 0 })
  let displayWidth = 80
  let latestDisplayElements: readonly import('../../../../contracts/tui/interpreter-plugin/interpreter-plugin.types.ts').TuiDisplayElement[] = []
  let displaySessionKey: string | null = null
  let modelHydrationSessionId: string | null = null
  let interactionWindowKey: string | null = null
  let requestRender = (): void => undefined
  let refreshSourceRevision = 0
  let renderTimer: ReturnType<typeof setTimeout> | null = null
  let refreshDispose: (() => void) | null = null

  function projectDisplayBuffer(model: TuiPresentationModel): void {
    const sessionKey = latestSnapshot?.sessionId
    if (sessionKey === undefined) throw new Error('startup: display projection requires a selected session')
    if (displaySessionKey !== sessionKey) {
      ctx.tuiDisplayBuffer!.reset()
      ctx.tuiTerminalOutput!.reset(sessionKey)
      displaySessionKey = sessionKey
    }
    const elements = model.nodes.map(node => ctx.tuiInterpreter!.interpret(node))
    latestDisplayElements = Object.freeze([projectLogoStableElement(displayWidth), ...elements])
    ctx.tuiDisplayBuffer!.reflow(latestDisplayElements, ctx.tuiAppContainer.projectTranscriptLayout(displayWidth))
  }

  function projectTerminalFrame(): import('../../../../contracts/tui/terminal-render-plugin/terminal-render-plugin.types.ts').TuiTerminalRenderFrame {
    const frame = ctx.tuiTerminalRender!.project(ctx.tuiDisplayBuffer!.read())
    ctx.tuiTerminalOutput!.apply(frame)
    return frame
  }

  function projectionValue(snapshot: TuiSessionSnapshot, key: 'permissions' | 'goal'): unknown {
    return (snapshot.projections?.values as Record<string, unknown> | undefined)?.[key]
  }

  function publicGoal(snapshot: TuiSessionSnapshot): TuiSessionSnapshot['goal'] {
    const value = projectionValue(snapshot, 'goal')
    if (value === null) return null
    if (!value || typeof value !== 'object') return undefined
    const goal = (value as Record<string, unknown>)['goal']
    if (!goal || typeof goal !== 'object') return undefined
    const phase = (goal as Record<string, unknown>)['phase']
    return phase === 'active' || phase === 'paused' || phase === 'blocked' || phase === 'complete' ? phase : undefined
  }

  function publicPermission(snapshot: TuiSessionSnapshot): string | undefined {
    const value = projectionValue(snapshot, 'permissions')
    if (!value || typeof value !== 'object') return undefined
    const current = (value as Record<string, unknown>)['currentValue']
    return typeof current === 'string' && current.length > 0 ? current : undefined
  }

  function syncExecutionStatus(snapshot: TuiSessionSnapshot): void {
    const execution = ctx.tuiExecutionStatus
    if (!execution) return
    const state = execution.project().state
    if (snapshot.running) {
      if (state === 'idle' || state === 'completed' || state === 'failed') execution.start('Running')
      return
    }
    if (state === 'running') execution.stop(snapshot.error ? 'failed' : 'completed')
  }

  function openPendingInteraction(snapshot: TuiSessionSnapshot): void {
    const interaction = snapshot.interactions[0]
    if (!interaction) {
      interactionWindowKey = null
      return
    }
    const key = interaction.interactionId
    if (interactionWindowKey === key) return
    interactionWindowKey = key
    if (interaction.kind === 'approval') {
      ctx.tuiInteractiveWindow!.open({
        kind: 'approval',
        key: `interaction-${key}`,
        title: `${interaction.toolName}${interaction.reason ? ` · ${interaction.reason}` : ''}  ·  ↑↓ choose  Enter apply  Esc close`,
        items: [
          { key: 'allow', label: 'Allow once' },
          { key: 'reject', label: 'Reject' },
        ],
        sourceRevision: snapshot.lastSeq,
      }, itemKey => {
        void ctx.tuiSession.respondApproval(key, itemKey === 'allow').catch(error => reportAsyncFailure('approval response failed', error))
      })
      return
    }
    const question = interaction.questions[0]
    if (!question || !question.options || question.options.length === 0 || question.multiSelect) {
      throw new Error('ask interaction has no supported single-select options')
    }
    ctx.tuiInteractiveWindow!.open({
      kind: 'ask',
      key: `interaction-${key}`,
      title: `${question.header ?? 'Question'}  ·  ${question.question}  ·  ↑↓ choose  Enter apply  Esc close`,
      items: question.options.map((option, index) => ({ key: `${String(index)}`, label: option.description ? `${option.label} · ${option.description}` : option.label })),
      sourceRevision: snapshot.lastSeq,
    }, itemKey => {
      const index = Number(itemKey)
      const option = question.options?.[index]
      if (!option) throw new Error('ask interaction returned an unknown option')
      void ctx.tuiSession.respondQuestion(key, {
        answers: [{ id: question.id, selected: [option.label] }],
      }).catch(error => reportAsyncFailure('question response failed', error))
    })
  }

  const presentationDispose = ctx.tuiPresentation.subscribe(model => {
    latestModel = model
    projectDisplayBuffer(model)
    if (latestSnapshot?.running === true && ctx.tuiExecutionStatus?.project().state === 'running') {
      const latestTool = [...model.nodes].reverse().find(node => node.kind.startsWith('tool.') && node.lifecycle === 'streaming')
      if (latestTool) {
        const value = latestTool.value as { readonly name?: unknown; readonly callRenderIntent?: unknown }
        const intent = value.callRenderIntent && typeof value.callRenderIntent === 'object' ? value.callRenderIntent as Record<string, unknown> : undefined
        const title = typeof intent?.['title'] === 'string' && intent['title'].length > 0
          ? intent['title']
          : typeof value.name === 'string' && value.name.length > 0 ? value.name : 'Working'
        ctx.tuiExecutionStatus?.setTitle(title)
      }
    }
    if (options.projectionFile !== undefined) {
      writeFileSync(options.projectionFile, JSON.stringify({
        publicationRevision: model.publicationRevision,
        nodes: model.nodes.map(node => ({ nodeId: node.nodeId, kind: node.kind, lifecycle: node.lifecycle })),
      }) + '\n', 'utf8')
    }
    requestRender()
  })
  const sessionDispose = ctx.tuiSession.subscribe(snapshot => {
    const permission = publicPermission(snapshot)
    const goal = publicGoal(snapshot)
    const previous = latestSnapshot?.sessionId === snapshot.sessionId ? latestSnapshot : null
    latestSnapshot = Object.freeze({
      ...snapshot,
      ...(snapshot.model === undefined && previous?.model !== undefined ? { model: previous.model } : {}),
      ...(permission === undefined ? {} : { permission }),
      ...(permission === undefined && previous?.permission !== undefined ? { permission: previous.permission } : {}),
      ...(goal === undefined ? {} : { goal }),
      ...(goal === undefined && previous?.goal !== undefined ? { goal: previous.goal } : {}),
    })
    syncExecutionStatus(latestSnapshot)
    openPendingInteraction(latestSnapshot)
    const sessionForModel = snapshot.sessionId
    if (modelHydrationSessionId !== sessionForModel) {
      modelHydrationSessionId = sessionForModel
      void host.sessions.models({ sessionId: snapshot.sessionId }).then(response => {
        const result = response.result
        if (!result.ok || latestSnapshot?.sessionId !== sessionForModel) return
        latestSnapshot = Object.freeze({ ...latestSnapshot, model: result.value.current })
        requestRender()
      }).catch(() => undefined)
    }
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
    const previousRaw = ctx.tuiTerminalRawBuffer!.read()
    const previousOldest = previousRaw[0]?.event.seq
    const nextOldest = snapshot.entries[0]?.event.seq
    if (displaySessionKey === snapshot.sessionId && previousOldest !== undefined && nextOldest !== undefined && nextOldest < previousOldest) {
      ctx.tuiTerminalRawBuffer!.prepend(snapshot.entries.filter(entry => entry.event.seq < previousOldest))
    } else {
      ctx.tuiTerminalRawBuffer!.hydrate(snapshot.entries)
    }
    const rawHistory = ctx.tuiTerminalRawBuffer!.read()
    // Presentation is the sole raw-event parser. Startup only wires the
    // official Session history buffer into its canonical semantic projection.
    ctx.tuiPresentation.project({
      sessionId: snapshot.sessionId,
      lastSeq: snapshot.lastSeq,
      entries: rawHistory,
    })
  })

  // Phase 3 — create or resume the session. Selection and history hydration run
  // after the terminal has painted its empty shell, so a slow history RPC cannot
  // present as a blank terminal.
  let sessionDisposeChain: (() => void) | null = null
  const selectInitialSession = async (): Promise<void> => {
    if (options.resumeSessionId) {
      await ctx.tuiSession.resume(host, options.resumeSessionId, cwd)
    } else if (options.continueSession) {
      const latest = await ctx.tuiSession.latestCurrentCwdSession(host, cwd)
      if (latest === null) await ctx.tuiSession.createCurrentCwd(host, cwd)
      else await ctx.tuiSession.resume(host, latest.sessionId, cwd)
    } else {
      await ctx.tuiSession.createCurrentCwd(host, cwd)
    }
    sessionDisposeChain = () => {
      sessionDispose()
      presentationDispose()
      eventDispose()
      viewportDispose()
      ctx.tuiSession.dispose()
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
        label: resumeSessionLabel(summary, summary.sessionId === latestSnapshot?.sessionId),
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
    forkSession: atSeq => {
      void ctx.tuiSession.fork(atSeq).then(() => runtimeController?.clearError()).catch(error => reportAsyncFailure('/fork failed', error))
    },
    ...(ctx.tuiExecutionStatus === undefined ? {} : { executionStatus: ctx.tuiExecutionStatus }),
    slashCommandSuggestions: text => ctx.tuiSlashCommand!.suggest(text),
    displayFrame: projectTerminalFrame,
    setDisplayViewport: viewport => {
      displayWidth = viewport.columns
      const current = ctx.tuiDisplayBuffer!.read().viewport
      const logo = projectLogoStableElement(displayWidth)
      const withoutLogo = latestDisplayElements.filter(element => element.elementId !== 'stable.logo')
      latestDisplayElements = Object.freeze([logo, ...withoutLogo])
      ctx.tuiDisplayBuffer!.reflow(latestDisplayElements, ctx.tuiAppContainer.projectTranscriptLayout(displayWidth))
      ctx.tuiDisplayBuffer!.setViewport({
        topRow: current.topRow,
        height: viewport.rows,
        followTail: current.followTail,
      })
    },
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
    if (renderTimer !== null) return
    renderTimer = setTimeout(() => {
      renderTimer = null
      const result = ctx.tuiRefreshOrchestrator.request({
        sourceModuleId: 'presentation',
        reason: 'presentation',
        sourceRevision: refreshSourceRevision,
      })
      if (result.status === 'rejected') {
        throw new Error(`startup: refresh request rejected (${result.reason}): ${result.message}`)
      }
    }, 100)
  }
  // Resume/create hydration can notify before the refresh subscriber exists.
  // Consume the already-projected model once through the live refresh path.
  if (latestModel !== null) requestRender()
  const executionStatusDispose = ctx.tuiExecutionStatus?.subscribe(projection => {
    if (projection.revision > 0) requestRender()
  })
  const composerDispose = ctx.tuiComposer!.subscribe(() => requestRender())
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
  void selectInitialSession().catch(error => {
    const failure = error instanceof Error ? error : new Error(String(error))
    lifecycle?.fail(failure, 'session-selection')
  })

  return {
  controller,
  dispose(): void {
    if (renderTimer !== null) clearTimeout(renderTimer)
    renderTimer = null
    controller.stop('dispose')
    startupOutcomeProjection.dispose()
    selectorDispose()
    if (sessionDisposeChain) sessionDisposeChain()
    refreshDispose?.()
    refreshDispose = null
    executionStatusDispose?.()
    composerDispose()
    for (const source of Object.values(logicSources)) source.dispose()
  },
  exited,
  }
}
