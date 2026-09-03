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
 * The OpenCode adaptor, endpoint resolution, and host client are owned by
 * the transport boundary. Only the session service calls the host.
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
import { apply as applySubagentStatus } from '../../subagent-status-plugin/src/subagent-status-plugin.ts'
import {
  apply as applyShell,
  type TuiInputIn03BusinessAction,
  type TuiShellPolicy,
} from '../../app-shell/src/app-shell.ts'
import {
  type TuiSessionSnapshot,
  type TuiSessionHost,
} from '../../session/src/session.ts'
import { OpenCodeServeClient, resolveOpenCodeEndpoint } from '../../transport/src/opencode-serve.ts'
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

export interface LatestAsyncTask<T> {
  enqueue(value: T): void
  dispose(): void
}

export function createLatestAsyncTask<T>(run: (value: T) => void): LatestAsyncTask<T> {
  let pending: T | undefined
  let scheduled: NodeJS.Immediate | null = null
  let disposed = false
  const schedule = (): void => {
    if (scheduled !== null || disposed) return
    scheduled = setImmediate(() => {
      scheduled = null
      if (disposed || pending === undefined) return
      const value = pending
      pending = undefined
      run(value)
      if (pending !== undefined) schedule()
    })
  }
  return {
    enqueue(value) {
      if (disposed) return
      pending = value
      schedule()
    },
    dispose() {
      if (disposed) return
      disposed = true
      pending = undefined
      if (scheduled !== null) clearImmediate(scheduled)
      scheduled = null
    },
  }
}

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
  const endpoint = resolveOpenCodeEndpoint(options.endpoint ?? process.env['OPENCODE_URL'])
  const host: TuiSessionHost = new OpenCodeServeClient({ endpoint: endpoint.toString(), directory: cwd })

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
  applySubagentStatus(ctx)
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
          void host.exportSessionLog(selected.sessionId, mode === 'all').then(bytes => {
            const output = join(cwd, `dsh-session-${selected.sessionId}.zip`)
            writeFileSync(output, bytes)
            reportRuntimeError(`Session export written to ${output}`)
          }).catch(error => reportAsyncFailure('/export failed', error))
          return
        }
        if (intent.command === 'feedback') {
          const selected = ctx.tuiSession.snapshot
          if (!selected) {
            reportRuntimeError('/feedback requires a selected Session')
            return
          }
          logicSources.slashCommand.dispatch({
            control: 'slash-command',
            action: 'project',
            input: action.input,
            command: '/feedback',
            args: [...intent.args],
            accepted: true,
          })
          const hostLine = `/feedback ${intent.args.join(' ')}`
          void ctx.tuiSession.command(hostLine).then(result => {
            if (!result.ok) {
              reportRuntimeError(`/feedback: [${result.error.code}] ${result.error.message}`)
              return
            }
            if (!result.value.matched) reportRuntimeError('/feedback: Host did not recognize the command')
            else runtimeController?.clearError()
          }).catch(error => reportAsyncFailure('/feedback failed', error))
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
            const response = await host.remote.session.modelCatalog()
            if (!response.ok) throw new Error(`models listing failed: ${response.error.message}`)
            const catalog = response.value as { readonly default: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }; readonly groups: readonly { readonly id: string; readonly name: string; readonly models: readonly { readonly id: string; readonly name: string; readonly description?: string; readonly reasoning?: { readonly efforts: readonly { readonly id: string; readonly name: string; readonly description?: string }[] } }[] }[] }
            const groups = providerFilter === undefined
              ? catalog.groups
              : catalog.groups.filter(group => group.id === providerFilter)
          const items = groups.flatMap(group => group.models.flatMap(model => {
            const efforts = model.reasoning?.efforts ?? []
            if (efforts.length === 0) return [{ key: `${group.id}\u0000${model.id}\u0000`, label: `${group.name}/${model.name}` }]
            return efforts.map(effort => ({
              key: `${group.id}\u0000${model.id}\u0000${effort.id}`,
              label: `${group.name}/${model.name} · ${effort.name}${effort.description ? ` · ${effort.description}` : ''}`,
            }))
          }))
          if (items.length === 0) throw new Error(`no models available${providerFilter === undefined ? '' : ` for provider ${providerFilter}`}`)
          ctx.tuiInteractiveWindow!.open({
            kind: 'models',
            key: `interactive-models-${String(intent.sourceRevision)}`,
            title: providerFilter === undefined
              ? '/models  ·  ↑↓ choose  Enter apply  Esc close'
              : `/provider ${providerFilter}  ·  ↑↓ choose  Enter apply  Esc close`,
            items,
            selectedIndex: Math.max(0, items.findIndex(item => item.key.startsWith(`${catalog.default.provider}\u0000${catalog.default.model}\u0000`))),
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
            const response = await host.remote.llm.listProviders()
            if (!response.ok) throw new Error(`provider listing failed: ${response.error.message}`)
            const providers = response.value as { readonly providers: readonly { readonly id: string; readonly name?: string; readonly displayName?: string; readonly provider?: string }[] }
            const items = providers.providers.map((provider: { readonly id: string; readonly name?: string; readonly displayName?: string }) => ({
              key: provider.id,
              label: `${provider.displayName ?? provider.name ?? provider.id} (${provider.id})`,
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
            const response = await host.remote.workspace.list()
            if (!response.ok) throw new Error(`workspace listing failed: ${response.error.message}`)
            const wsList = (response.value as { readonly items: readonly { readonly workspaceId: string; readonly title: string; readonly path: string; readonly sessionIds: readonly string[] }[] }).items
            const workspaces = new Map(wsList.map(workspace => [String(workspace.workspaceId), workspace] as const))
            const items = wsList.map(workspace => ({
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
            }, itemKey => {
              const workspace = workspaces.get(itemKey)
              if (workspace === undefined) {
                reportRuntimeError(`/workspaces: unknown workspace ${itemKey}`)
                return
              }
              const existingSessionId = workspace.sessionIds[0]
              const switchTo = existingSessionId === undefined
                ? host.remote.session.create({ workspaceId: workspace.workspaceId as never }).then(created => {
                  if (!created.ok) throw new Error(`workspace session create failed: ${created.error.message}`)
                  return (created.value as { readonly sessionId: string }).sessionId
                })
                : Promise.resolve(existingSessionId)
              void switchTo.then(sessionId => ctx.tuiSession.resume(host, sessionId, workspace.path))
                .then(() => runtimeController?.clearError())
                .catch(error => reportAsyncFailure('/workspaces select failed', error))
            })
            return
          }
          if (command === 'search') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const query = intent.args.join(' ').trim()
            if (query.length === 0) throw new Error('/search requires a query')
            const response = await host.remote.session.search({ query }, new AbortController().signal)
            if (!response.ok) throw new Error(`session search failed: ${response.error.message}`)
            const items = (response.value as { readonly items: readonly { readonly sessionId: string; readonly snippet: string }[] }).items.map(item => ({
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
          if (command === 'workspace-create') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const path = intent.args.join(' ').trim()
            if (path.length === 0) throw new Error('/workspace-create requires a path')
            const response = await host.remote.workspace.create({ path })
            if (!response.ok) throw new Error(`workspace create failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'workspace-rename') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [workspaceId, ...titleParts] = intent.args
            const title = titleParts.join(' ').trim()
            if (!workspaceId || title.length === 0) throw new Error('/workspace-rename requires an id and title')
            const response = await host.remote.workspace.rename({ workspaceId: workspaceId as never, title })
            if (!response.ok) throw new Error(`workspace rename failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'workspace-delete') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [workspaceId, ...extra] = intent.args
            if (!workspaceId || extra.length > 0) throw new Error('/workspace-delete requires exactly one workspace id')
            const response = await host.remote.workspace.delete({ workspaceId: workspaceId as never })
            if (!response.ok) throw new Error(`workspace delete failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'archive') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [sessionId, ...extra] = intent.args
            if (sessionId !== undefined || extra.length > 0) throw new Error('/archive does not accept arguments')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('/archive requires a selected Session')
            const response = await host.remote.workspace.archiveSession({ sessionId: selected.sessionId })
            if (!response.ok) throw new Error(`session archive failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'subagent-interrupt') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [childSessionId, ...extra] = intent.args
            if (!childSessionId || extra.length > 0) throw new Error('/subagent-interrupt requires exactly one child Session id')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('/subagent-interrupt requires a selected parent Session')
            const catalog = await host.remote.subagents.list(selected.sessionId)
            if (!catalog.ok) throw new Error(`subagent listing failed: ${catalog.error.message}`)
            const child = (catalog.value as { readonly entries: readonly { readonly id: string; readonly kind: string; readonly mode: 'one-shot' | 'continuable' }[] }).entries
              .filter((entry: { readonly kind: string }) => entry.kind === 'child')
              .find((entry: { readonly id: string }) => String(entry.id) === childSessionId)
            if (child === undefined) throw new Error(`/subagent-interrupt: unknown child Session ${childSessionId}`)
            if (child.mode !== 'continuable') throw new Error(`/subagent-interrupt: child Session ${childSessionId} is one-shot`)
            const response = await host.remote.subagents.interruptByParent(child.id, selected.sessionId, 'continuable')
            if (!response.ok) throw new Error(`subagent interrupt failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'subagent-prompt') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [childSessionId, ...promptParts] = intent.args
            const prompt = promptParts.join(' ').trim()
            if (!childSessionId || prompt.length === 0) throw new Error('/subagent-prompt requires a child Session id and prompt')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('/subagent-prompt requires a selected parent Session')
            const catalog = await host.remote.subagents.list(selected.sessionId)
            if (!catalog.ok) throw new Error(`subagent listing failed: ${catalog.error.message}`)
            const child = (catalog.value as { readonly entries: readonly { readonly id: string; readonly kind: string; readonly mode: 'one-shot' | 'continuable' }[] }).entries
              .filter((entry: { readonly kind: string }) => entry.kind === 'child')
              .find((entry: { readonly id: string }) => String(entry.id) === childSessionId)
            if (child === undefined) throw new Error(`/subagent-prompt: unknown child Session ${childSessionId}`)
            if (child.mode !== 'continuable') throw new Error(`/subagent-prompt: child Session ${childSessionId} is one-shot`)
            const response = await host.remote.subagents.prompt({
              parentSessionId: selected.sessionId,
              childSessionId: child.id,
              mode: 'continuable',
              content: [{ type: 'text', text: prompt }],
            }, new AbortController().signal)
            if (!response.ok) throw new Error(`subagent prompt failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'goal-pause' || command === 'goal-resume' || command === 'goal-edit' || command === 'goal-clear') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error(`/${command} requires a selected Session`)
            const value = projectionValue(selected, 'goal')
            const goal = value && typeof value === 'object' ? (value as Record<string, unknown>)['goal'] : undefined
            if (!goal || typeof goal !== 'object') throw new Error(`/${command} requires an active goal`)
            const goalRecord = goal as Record<string, unknown>
            const id = goalRecord['id']
            const revision = goalRecord['revision']
            if (typeof id !== 'string' || id.length === 0 || typeof revision !== 'number' || !Number.isSafeInteger(revision)) {
              throw new Error(`/${command}: goal projection has no valid CAS reference`)
            }
            const ref = { id: id as never, revision }
            let response
            if (command === 'goal-pause') response = await host.remote.goals.pause(selected.sessionId, ref)
            else if (command === 'goal-resume') response = await host.remote.goals.resume(selected.sessionId, ref)
            else if (command === 'goal-clear') response = await host.remote.goals.clear(selected.sessionId, ref)
            else {
              const objective = intent.args.join(' ').trim()
              if (objective.length === 0) throw new Error('/goal-edit requires an objective')
              response = await host.remote.goals.edit(selected.sessionId, ref, { objective })
            }
            if (!response.ok) throw new Error(`/${command} failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'goal-info') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 0) throw new Error('/goal-info does not accept arguments')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('/goal-info requires a selected Session')
            const value = projectionValue(selected, 'goal')
            const goal = value && typeof value === 'object' ? (value as Record<string, unknown>)['goal'] : undefined
            if (!goal || typeof goal !== 'object') throw new Error('/goal-info requires an active goal')
            const projection = value as Record<string, unknown>
            const record = goal as Record<string, unknown>
            const blockedReason = record['blockedReason']
            const reason = blockedReason && typeof blockedReason === 'object' ? (blockedReason as Record<string, unknown>)['message'] : undefined
            const items = [
              `Objective: ${String(record['objective'] ?? '')}`,
              `Phase: ${String(record['phase'] ?? 'unknown')} · revision ${String(record['revision'] ?? 'unknown')}`,
              `Rounds: ${String(projection['roundsStarted'] ?? 0)} / ${String(record['maxGoalRounds'] ?? 'unlimited')}`,
              ...(typeof reason === 'string' && reason.length > 0 ? [`Blocked: ${reason}`] : []),
            ]
            runtimeController.openOverlay({
              kind: 'command',
              key: `goal-info-${String(intent.sourceRevision)}`,
              title: '/goal-info  ·  Esc close',
              items: items.map((label, index) => ({ key: `goal-info:${String(index)}`, label })),
              closable: true,
              sourceRevision: intent.sourceRevision,
            })
            return
          }
          if (command === 'settings') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 0) throw new Error('/settings does not accept arguments')
            const response = await host.remote.settings.describe()
            if (!response.ok) throw new Error(`settings description failed: ${response.error.message}`)
            const settingsView = response.value as { readonly namespaces: readonly { readonly ns: string; readonly applies: string; readonly value: unknown; readonly revision: number; readonly secrets: readonly { readonly path: readonly string[]; readonly set: boolean }[]; readonly schema: unknown }[]; readonly writable: boolean }
            const items = settingsView.namespaces.map(namespace => ({
              key: namespace.ns,
              label: `${namespace.ns} · ${namespace.applies} · ${JSON.stringify(namespace.value)}`,
            }))
            if (items.length === 0) throw new Error('no settings namespaces available')
            runtimeController.openOverlay({
              kind: 'command',
              key: `settings-${String(intent.sourceRevision)}`,
              title: `/settings  ·  ${settingsView.writable ? 'writable' : 'read-only'}  ·  Esc close`,
              items,
              closable: true,
              sourceRevision: intent.sourceRevision,
            })
            return
          }
          if (command === 'settings-set') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [ns, pathText, ...valueParts] = intent.args
            if (!ns || !pathText || valueParts.length === 0) throw new Error('/settings-set requires namespace, dot path, and JSON value')
            const value = JSON.parse(valueParts.join(' ')) as unknown
            const path = pathText.split('.').filter(Boolean)
            if (path.length === 0) throw new Error('/settings-set requires a non-empty dot path')
            const response = await host.remote.settings.mutate(ns, [{ op: 'set', path, value }], undefined)
            if (!response.ok) throw new Error(`settings mutation failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'settings-show') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [ns, ...extra] = intent.args
            if (!ns || extra.length > 0) throw new Error('/settings-show requires exactly one namespace')
            const response = await host.remote.settings.describe()
            if (!response.ok) throw new Error(`settings description failed: ${response.error.message}`)
            const namespace = (response.value as { readonly namespaces: readonly { readonly ns: string; readonly applies: string; readonly value: unknown; readonly revision: number; readonly secrets: readonly { readonly path: readonly string[]; readonly set: boolean }[]; readonly schema: unknown; readonly user?: unknown }[] }).namespaces.find(item => item.ns === ns)
            if (!namespace) throw new Error(`/settings-show: unknown namespace ${ns}`)
            const items = [
              `Namespace: ${namespace.ns}`,
              `Applies: ${namespace.applies} · revision ${String(namespace.revision)}`,
              `Value: ${JSON.stringify(namespace.value)}`,
              `User overrides: ${JSON.stringify(namespace.user ?? {})}`,
              `Secrets: ${namespace.secrets.length === 0 ? 'none' : namespace.secrets.map(secret => `${secret.path.join('.')}=${secret.set ? 'set' : 'unset'}`).join(', ')}`,
              `Schema: ${JSON.stringify(namespace.schema)}`,
            ]
            runtimeController.openOverlay({ kind: 'command', key: `settings-show-${String(intent.sourceRevision)}`, title: `/settings-show ${ns}  ·  Esc close`, items: items.map((label, index) => ({ key: `settings-show:${String(index)}`, label })), closable: true, sourceRevision: intent.sourceRevision })
            return
          }
          if (command === 'settings-unset') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [ns, pathText, ...extra] = intent.args
            if (!ns || !pathText || extra.length > 0) throw new Error('/settings-unset requires namespace and dot path')
            const path = pathText.split('.').filter(Boolean)
            if (path.length === 0) throw new Error('/settings-unset requires a non-empty dot path')
            const response = await host.remote.settings.mutate(ns, [{ op: 'unset', path }], undefined)
            if (!response.ok) throw new Error(`settings mutation failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'history-more') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 0) throw new Error('/history-more does not accept arguments')
            const snapshot = ctx.tuiSession.snapshot
            if (!snapshot) throw new Error('/history-more requires a selected Session')
            if (!snapshot.hasMoreBefore) throw new Error('/history-more: no older history is available')
            await ctx.tuiSession.loadOlder()
            runtimeController.clearError()
            return
          }
          if (command === 'session-info') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 0) throw new Error('/session-info does not accept arguments')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('/session-info requires a selected Session')
            const stats = (selected.projections?.values as Record<string, unknown> | undefined)?.['sessionStats']
            const statsRecord = stats && typeof stats === 'object' ? stats as Record<string, unknown> : undefined
            const stat = (key: string): string => typeof statsRecord?.[key] === 'number' ? String(statsRecord[key]) : 'unavailable'
            const info = [
              `Session: ${selected.sessionId}`,
              `Workspace: ${selected.cwd}`,
              `State: ${selected.running ? 'running' : 'idle'} · ${selected.live ? 'live' : 'cold'}`,
              `Model: ${selected.model ? `${selected.model.provider}/${selected.model.model}${selected.model.reasoningEffort ? ` (${selected.model.reasoningEffort})` : ''}` : 'unavailable'}`,
              `Permission: ${selected.permission ?? 'unavailable'}`,
              `Goal: ${selected.goal ?? 'none'}`,
              `History: ${String(selected.entries.length)} loaded${selected.hasMoreBefore ? ' · older available' : ''}`,
              `Work: ${stat('turns')} turns · ${stat('steps')} steps · ${stat('decodeTokens')} output tokens`,
              `Time: ${stat('llmMs')}ms model · ${stat('toolMs')}ms tools · ${stat('ttftMs')}ms first token`,
            ]
            runtimeController.openOverlay({
              kind: 'command',
              key: `session-info-${String(intent.sourceRevision)}`,
              title: '/session-info  ·  Esc close',
              items: info.map((line, index) => ({ key: `session-info:${String(index)}`, label: line })),
              closable: true,
              sourceRevision: intent.sourceRevision,
            })
            return
          }
          if (command === 'queue') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 0) throw new Error('/queue does not accept arguments')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('/queue requires a selected Session')
            const items = selected.queue.map(item => {
              const content = (item.message.content as readonly unknown[])
                .filter((part): part is { readonly type: string; readonly text: string } => Boolean(part && typeof part === 'object' && (part as Record<string, unknown>)['type'] === 'text' && typeof (part as Record<string, unknown>)['text'] === 'string'))
                .map((part): string => part.text)
                .join(' ')
                .trim()
              const summary = content.length > 80 ? `${content.slice(0, 77)}...` : content
              return { key: String(item.id), label: `${item.placement} · ${summary || '(non-text content)'}` }
            })
            runtimeController.openOverlay({
              kind: 'queue',
              key: `queue-${String(intent.sourceRevision)}`,
              title: `/queue  ·  ${String(items.length)} pending  ·  Esc close`,
              items: items.length > 0 ? items : [{ key: 'empty', label: 'no pending input' }],
              closable: true,
              sourceRevision: intent.sourceRevision,
            })
            return
          }
          if (command === 'jobs') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 0) throw new Error('/jobs does not accept arguments')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('/jobs requires a selected Session')
            const items = selected.jobs.map(job => ({
              key: String(job.id),
              label: `${job.status} · ${job.kind} · ${job.label}${job.detail ? ` · ${job.detail}` : ''}`,
            }))
            runtimeController.openOverlay({
              kind: 'overlay.jobs',
              key: `jobs-${String(intent.sourceRevision)}`,
              title: `/jobs  ·  ${String(items.length)} total  ·  Esc close`,
              items: items.length > 0 ? items : [{ key: 'empty', label: 'no background jobs' }],
              closable: true,
              sourceRevision: intent.sourceRevision,
            })
            return
          }
          if (command === 'trajectory') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 0) throw new Error('/trajectory does not accept arguments')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('/trajectory requires a selected Session')
            const items = selected.entries.map(entry => {
              const event = entry.event
              const detail = event.type === 'user/message' || event.type === 'assistant/message'
                ? String((event.data as { readonly message?: { readonly content?: readonly { readonly type?: string; readonly text?: string }[] } } | undefined)?.message?.content
                  ?.filter(part => part.type === 'text').map(part => part.text ?? '').join(' ').trim() ?? '')
                : ''
              const summary = detail.length > 72 ? `${detail.slice(0, 69)}...` : detail
              return { key: `trajectory:${String(event.seq)}`, label: `${String(event.seq)} · ${event.type}${summary ? ` · ${summary}` : ''}` }
            })
            runtimeController.openOverlay({
              kind: 'overlay.trajectory',
              key: `trajectory-${String(intent.sourceRevision)}`,
              title: `/trajectory  ·  ${String(items.length)} events  ·  Esc close`,
              items: items.length > 0 ? items : [{ key: 'empty', label: 'no loaded events' }],
              closable: true,
              sourceRevision: intent.sourceRevision,
            })
            return
          }
          if (command === 'trajectory-more') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 0) throw new Error('/trajectory-more does not accept arguments')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('/trajectory-more requires a selected Session')
            if (!selected.hasMoreBefore) throw new Error('/trajectory-more: no older events are available')
            await ctx.tuiSession.loadOlder()
            const refreshed = ctx.tuiSession.snapshot
            const items = (refreshed?.entries ?? []).map(entry => {
              const event = entry.event
              const detail = event.type === 'user/message' || event.type === 'assistant/message'
                ? String((event.data as { readonly message?: { readonly content?: readonly { readonly type?: string; readonly text?: string }[] } } | undefined)?.message?.content
                  ?.filter(part => part.type === 'text').map(part => part.text ?? '').join(' ').trim() ?? '')
                : ''
              const summary = detail.length > 72 ? `${detail.slice(0, 69)}...` : detail
              return { key: `trajectory:${String(event.seq)}`, label: `${String(event.seq)} · ${event.type}${summary ? ` · ${summary}` : ''}` }
            })
            runtimeController.openOverlay({
              kind: 'overlay.trajectory',
              key: `trajectory-more-${String(intent.sourceRevision)}`,
              title: `/trajectory  ·  ${String(items.length)} events  ·  Esc close`,
              items: items.length > 0 ? items : [{ key: 'empty', label: 'no loaded events' }],
              closable: true,
              sourceRevision: intent.sourceRevision,
            })
            return
          }
          if (command === 'copy') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 1) throw new Error('/copy accepts at most one assistant message revision')
            const revision = intent.args.length === 1 ? Number(intent.args[0]) : undefined
            if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) throw new Error('/copy requires a non-negative message revision')
            const node = latestModel?.nodes.find(item => item.kind === 'conversation.assistant'
              && (revision === undefined || item.publicationRevision === revision))
            if (!node || node.kind !== 'conversation.assistant') throw new Error(revision === undefined
              ? '/copy: no assistant message is available'
              : `/copy: assistant message revision ${String(revision)} was not found`)
            const text = node.value.blocks.map(block => block.kind === 'text' ? block.text : '').filter(Boolean).join('\n')
            if (text.length === 0) throw new Error(`/copy: assistant message revision ${String(revision)} has no copyable text`)
            process.stdout.write(`\u001b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\u0007`)
            runtimeController.clearError()
            return
          }
          if (command === 'attach') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [path, ...textParts] = intent.args
            if (!path) throw new Error('/attach requires an image path and optional text')
            const result = await ctx.tuiSession.promptImage(path, textParts.join(' ').trim())
            if (!result.ok) throw new Error(`/attach failed: ${result.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'host-info') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 0) throw new Error('/host-info does not accept arguments')
            const model = latestSnapshot?.model
            runtimeController.openOverlay({
              kind: 'command',
              key: `host-info-${String(intent.sourceRevision)}`,
              title: '/host-info  ·  Esc close',
              items: [
                `Default model: ${model ? `${model.provider}/${model.model}` : 'unavailable'}`,
                `Endpoint: ${host.origin}`,
              ].map((label, index) => ({ key: `host-info:${String(index)}`, label })),
              closable: true,
              sourceRevision: intent.sourceRevision,
            })
            return
          }
          if (command === 'skills') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 0) throw new Error('/skills does not accept arguments')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('/skills requires a selected Session')
            const response = await host.remote.skills.list({ sessionId: selected.sessionId })
            if (!response.ok) throw new Error(`skills listing failed: ${response.error.message}`)
            const items = (response.value as { readonly skills: readonly { readonly name: string; readonly description: string; readonly modelInvocable: boolean }[] }).skills.map(skill => ({
              key: skill.name,
              label: `/${skill.name} · ${skill.description}${skill.modelInvocable ? '' : ' · user-only'}`,
            }))
            runtimeController.openOverlay({
              kind: 'command',
              key: `skills-${String(intent.sourceRevision)}`,
              title: `/skills  ·  ${String(items.length)} available  ·  Esc close`,
              items: items.length > 0 ? items : [{ key: 'empty', label: 'no project skills available' }],
              closable: true,
              sourceRevision: intent.sourceRevision,
            })
            return
          }
          if (command === 'skill') {
            const [name, ...skillArgs] = intent.args
            if (!name) throw new Error('/skill requires a skill name')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('/skill requires a selected Session')
            const catalog = await host.remote.skills.list({ sessionId: selected.sessionId })
            if (!catalog.ok) throw new Error(`skills listing failed: ${catalog.error.message}`)
            if (!(catalog.value as { readonly skills: readonly { readonly name: string }[] }).skills.some((skill: { readonly name: string }) => skill.name === name)) throw new Error(`/skill: unknown project skill ${name}`)
            const result = await ctx.tuiSession.prompt(`/${name}${skillArgs.length > 0 ? ` ${skillArgs.join(' ')}` : ''}`)
            if (!result.ok) throw new Error(`/skill ${name} failed: ${result.error.message}`)
            runtimeController?.clearError()
            return
          }
          if (command === 'open-path') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [path, ...extra] = intent.args
            if (!path || extra.length > 0) throw new Error('/open-path requires exactly one path')
            const response = await host.remote.session.openWorkspacePath({ path })
            if (!response.ok) throw new Error(`path open failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'browse') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [path, ...extra] = intent.args
            if (extra.length > 0) throw new Error('/browse accepts at most one directory path')
            const openBrowse = async (requestedPath: string | undefined): Promise<void> => {
              const response = await host.remote.directoryPicker.list(requestedPath, new AbortController().signal)
              if (!response.ok) throw new Error(`directory listing failed: ${response.error.message}`)
              const listing = response.value as { readonly path: string; readonly crumbs: readonly { readonly path: string; readonly name: string }[]; readonly entries: readonly { readonly path: string; readonly name: string; readonly hidden: boolean }[] }
              const items = [
                ...listing.crumbs.map(crumb => ({ key: `crumb:${crumb.path}`, label: `↳ ${crumb.name}` })),
                ...listing.entries.map(entry => ({ key: `dir:${entry.path}`, label: `${entry.hidden ? '·' : ' '} ${entry.name}/` })),
              ]
              runtimeController?.openOverlay({
                kind: 'command',
                key: `browse-${String(intent.sourceRevision)}-${listing.path}`,
                title: `/browse  ${listing.path}  ·  ↑↓ enter  Esc close`,
                items: items.length > 0 ? items : [{ key: 'empty', label: 'empty directory' }],
                closable: true,
                sourceRevision: intent.sourceRevision,
              }, itemKey => {
                const nextPath = itemKey.startsWith('dir:') || itemKey.startsWith('crumb:')
                  ? itemKey.slice(itemKey.indexOf(':') + 1)
                  : undefined
                if (nextPath === undefined) return
                void openBrowse(nextPath).catch(error => reportAsyncFailure('/browse failed', error))
              })
            }
            await openBrowse(path)
            return
          }
          if (command === 'pick-directory') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 0) throw new Error('/pick-directory does not accept arguments')
            const picked = await host.remote.directoryPicker.pick(new AbortController().signal)
            if (!picked.ok) throw new Error(`directory picker failed: ${picked.error.message}`)
            if (picked.value === null) {
              runtimeController.clearError()
              return
            }
            const created = await host.remote.workspace.create({ path: picked.value ?? '' })
            if (!created.ok) throw new Error(`workspace create failed: ${created.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'queue-remove' || command === 'queue-steer' || command === 'queue-edit') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [itemId, ...contentParts] = intent.args
            if (!itemId || (command === 'queue-edit' && contentParts.join(' ').trim().length === 0) || (command !== 'queue-edit' && contentParts.length > 0)) {
              throw new Error(`/${command} requires ${command === 'queue-edit' ? 'an item id and replacement text' : 'exactly one item id'}`)
            }
            const action = command === 'queue-remove'
              ? { kind: 'remove' as const }
              : command === 'queue-steer'
                ? { kind: 'steer' as const }
                : { kind: 'edit' as const, content: [{ type: 'text' as const, text: contentParts.join(' ').trim() }] }
            const result = await ctx.tuiSession.updateQueue(itemId, action)
            if (!result.ok) throw new Error(`/${command} failed: ${result.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'settings-open') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 0) throw new Error('/settings-open does not accept arguments')
            const response = await host.remote.settings.openSettingsDocument()
            if (!response.ok) throw new Error(`settings document open failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'session-rename') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const title = intent.args.join(' ').trim()
            if (title.length === 0) throw new Error('/session-rename requires a title')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('/session-rename requires a selected Session')
            const response = await host.remote.session.rename({ sessionId: selected.sessionId, title })
            if (!response.ok) throw new Error(`session rename failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'agent-presets') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            if (intent.args.length > 0) throw new Error('/agent-presets does not accept arguments')
            const response = await host.remote.agentPresets.list()
            if (!response.ok) throw new Error(`agent preset listing failed: ${response.error.message}`)
            const presetList = response.value as { readonly presets: readonly { readonly id: string; readonly name: string; readonly description?: string }[]; readonly authorable: boolean }
            const items = presetList.presets.map(preset => ({
              key: preset.id,
              label: preset.name ?? preset.id,
            }))
            if (items.length === 0) throw new Error('no agent presets available')
            runtimeController.openOverlay({
              kind: 'command',
              key: `agent-presets-${String(intent.sourceRevision)}`,
              title: `/agent-presets  ·  ${presetList.authorable ? 'authorable' : 'read-only'}  ·  Esc close`,
              items,
              closable: true,
              sourceRevision: intent.sourceRevision,
            }, itemKey => {
              const selected = ctx.tuiSession.snapshot
              if (!selected) {
                reportRuntimeError('/agent-presets select requires a selected Session')
                return
              }
              void host.remote.agentPresets.select(selected.sessionId, itemKey).then((result: any) => {
                if (!result.ok) throw new Error(`agent preset selection failed: ${result.error.message}`)
                runtimeController?.clearError()
              }).catch((error: unknown) => reportAsyncFailure('/agent-presets select failed', error))
            })
            return
          }
          if (command === 'agent-preset-read') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [agentPreset, ...extra] = intent.args
            if (!agentPreset || extra.length > 0) throw new Error('/agent-preset-read requires exactly one preset id')
            const response = await host.remote.agentPresets.read(agentPreset)
            if (!response.ok) throw new Error(`agent preset read failed: ${response.error.message}`)
            const preset = response.value as { readonly trust: string; readonly content: string }
            runtimeController.openOverlay({
              kind: 'command',
              key: `agent-preset-read-${agentPreset}-${String(intent.sourceRevision)}`,
              title: `/agent-preset-read ${agentPreset}  ·  ${preset.trust}  ·  Esc close`,
              items: preset.content.split('\n').map((line: string, index: number) => ({ key: `${agentPreset}:${String(index)}`, label: line })),
              closable: true,
              sourceRevision: intent.sourceRevision,
            })
            return
          }
          if (command === 'agent-preset-copy') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [from, agentPreset, ...nameParts] = intent.args
            if (!from || !agentPreset || nameParts.length > 0 && nameParts.join(' ').trim().length === 0) throw new Error('/agent-preset-copy requires source id, target id, and optional name')
            const name = nameParts.join(' ').trim()
            const response = await host.remote.agentPresets.copy(from, agentPreset, ...(name.length === 0 ? [] : [name]))
            if (!response.ok) throw new Error(`agent preset copy failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'agent-preset-open') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [agentPreset, ...extra] = intent.args
            if (!agentPreset || extra.length > 0) throw new Error('/agent-preset-open requires exactly one preset id')
            const response = await host.remote.agentPresets.read(agentPreset)
            if (!response.ok) throw new Error(`agent preset open failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'agent-preset-delete') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const [agentPreset, ...extra] = intent.args
            if (!agentPreset || extra.length > 0) throw new Error('/agent-preset-delete requires exactly one preset id')
            const response = await host.remote.agentPresets.deletePreset(agentPreset)
            if (!response.ok) throw new Error(`agent preset delete failed: ${response.error.message}`)
            runtimeController.clearError()
            return
          }
          if (command === 'subagents') {
            if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
            const selected = ctx.tuiSession.snapshot
            if (!selected) throw new Error('subagents selector requires a selected Session')
            const response = await host.remote.subagents.list(selected.sessionId)
            if (!response.ok) throw new Error(`subagent listing failed: ${response.error.message}`)
            const subagentEntries = (response.value as { readonly entries: readonly { readonly id: string; readonly kind: string; readonly mode: 'one-shot' | 'continuable'; readonly label?: string; readonly activity?: string; readonly reason?: string }[] }).entries
            const childModes = new Map<string, 'one-shot' | 'continuable'>(subagentEntries
              .filter((entry: { readonly kind: string }) => entry.kind === 'child')
              .map((entry: { readonly id: string; readonly mode: 'one-shot' | 'continuable' }) => [String(entry.id), entry.mode]))
            const items = subagentEntries.map(entry => entry.kind === 'diagnostic'
              ? { key: entry.id, label: `${entry.id} · unavailable (${(entry as { readonly reason?: string }).reason ?? 'unknown'})` }
              : { key: entry.id, label: `${(entry as { readonly label?: string }).label ?? entry.id} · ${(entry as { readonly activity?: string }).activity ?? ''}${entry.mode === 'continuable' ? ' · continuable' : ''}` })
            if (items.length === 0) throw new Error('no subagents available')
            runtimeController.openOverlay({
              kind: 'selector.subagents',
              key: `subagents-${String(intent.sourceRevision)}`,
              title: '/subagents  ·  ↑↓ inspect  Esc close',
              items,
              closable: true,
              sourceRevision: intent.sourceRevision,
            }, itemKey => {
              const mode = childModes.get(itemKey)
              if (mode === undefined) throw new Error(`subagent selector returned an invalid child id: ${itemKey}`)
              void (async () => {
                const iterator = host.remote.session.follow({
                  address: { kind: 'subagent', parentSessionId: selected.sessionId, childSessionId: itemKey as never, mode },
                  maxMessages: 100,
                }, new AbortController().signal)
                const historyItems: Array<{ readonly key: string; readonly label: string }> = []
                for await (const frame of iterator) {
                  if (frame.type !== 'snapshot') continue
                  const records = frame.records as readonly { readonly type: string; readonly event?: { readonly seq: number; readonly type: string; readonly data: Record<string, unknown> } }[]
                  for (const record of records) {
                    if (record.type !== 'event' || !record.event) continue
                    const data = record.event.data as Record<string, unknown>
                    const content = data['content'] ?? (data['message'] as Record<string, unknown> | undefined)?.['content']
                    const text = Array.isArray(content)
                      ? content
                        .filter((part): part is { readonly type: string; readonly text: string } => Boolean(part && typeof part === 'object' && (part as Record<string, unknown>)['type'] === 'text' && typeof (part as Record<string, unknown>)['text'] === 'string'))
                        .map(part => part.text)
                        .join(' ')
                        .trim()
                      : ''
                    const summary = text.length > 80 ? `${text.slice(0, 77)}...` : text
                    historyItems.push({
                      key: `${itemKey}:${String(record.event.seq)}`,
                      label: `${String(record.event.seq)} · ${record.event.type}${summary.length > 0 ? ` · ${summary}` : ''}`,
                    })
                  }
                  break
                }
                  runtimeController?.openOverlay({
                  kind: 'command',
                  key: `subagent-history-${itemKey}-${String(intent.sourceRevision)}`,
                  title: `/subagents ${itemKey}  ·  ${String(historyItems.length)} events  Esc close`,
                  items: historyItems.length > 0 ? historyItems : [{ key: 'empty', label: 'no history events' }],
                  closable: true,
                  sourceRevision: intent.sourceRevision,
                })
              })().catch(error => reportAsyncFailure('/subagents history failed', error))
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
          title: 'agent-tui help - Esc closes',
          items: [
            '/new - create a new Session in current cwd',
            '/plan <message> or /plan off - set plan mode',
            '/permission <preset> - set permission level',
            '/model <model> - switch model',
            '/thinking <effort> - set thinking effort',
            '/compact - compact session history',
            '/goal <args> - run goal command',
            '/doctor - check configuration',
            '/rename <title> - run the Host session rename command',
            '/session-rename <title> - rename the current Session directly',
            'Esc Esc - enter fork history; Up/Down choose a user message; Enter forks',
            '/resume - choose a Session from current cwd',
            '/search <query> - search Session history',
            '/history-more - load an older page of Session history',
            '/workspaces - list and switch Workspaces',
            '/workspace-create <path> - register a Workspace',
            '/workspace-rename <id> <title> - rename a Workspace',
            '/workspace-delete <id> - remove a Workspace registration',
            '/archive - archive the current Session',
            '/subagents - list child Agents; select one for history',
            '/subagent-prompt <id> <text> - prompt a continuable child Agent',
            '/subagent-interrupt <id> - interrupt a continuable child Agent',
            '/agent-presets - list and select Agent Presets',
            '/agent-preset-read <id> - read a Preset composition',
            '/agent-preset-copy <from> <to> [name] - copy a Preset',
            '/agent-preset-open <id> - open a user Preset directory',
            '/agent-preset-delete <id> - delete a user Preset',
            '/settings - list settings namespaces',
            '/settings-set <namespace> <path> <json> - update a setting',
            '/settings-show <namespace> - show settings details',
            '/settings-unset <namespace> <path> - remove a setting override',
            '/settings-open - open the settings document',
            '/session-info - show current Session state',
            '/queue - show pending Session input',
            '/queue-remove <id> - remove pending input',
            '/queue-steer <id> - steer pending input',
            '/queue-edit <id> <text> - edit pending input',
            '/jobs - show background jobs',
            '/trajectory - show loaded Session events',
            '/trajectory-more - load older Session events',
            '/attach <image-path> [text] - send an image with optional text',
            '/copy [assistant-revision] - copy an assistant message to the terminal clipboard',
            '/host-info - show Host version and connection state',
            '/skills - show available project skills',
            '/skill <name> [args] - invoke a project skill',
            '/open-path <path> - open a file or directory with the OS',
            '/browse [path] - browse Host directories',
            '/pick-directory - pick and register a Workspace directory',
            '/goal-pause|/goal-resume|/goal-edit|/goal-clear - manage Goal',
            '/goal-info - show current Goal details',
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
    const subagentBars = ctx.tuiSubagentStatus?.project().map((descriptor, index) => Object.freeze({
      elementId: `subagent-status:${String(index)}`,
      sourceId: `subagent-status:${String(index)}`,
      semanticKind: descriptor.elementType,
      lifecycle: 'live' as const,
      lines: Object.freeze([Object.freeze({ spans: Object.freeze([Object.freeze({
        text: typeof descriptor.props?.['text'] === 'string' ? descriptor.props['text'] : 'Working',
        style: 'tool' as const,
      })]) })]),
    })) ?? []
    latestDisplayElements = Object.freeze([projectLogoStableElement(displayWidth), ...subagentBars, ...elements])
    ctx.tuiDisplayBuffer!.reflow(latestDisplayElements, ctx.tuiAppContainer.projectTranscriptLayout(displayWidth))
  }

  function projectTerminalFrame(): import('../../../../contracts/tui/terminal-render-plugin/terminal-render-plugin.types.ts').TuiTerminalRenderFrame {
    const frame = ctx.tuiTerminalRender!.project(ctx.tuiDisplayBuffer!.read())
    ctx.tuiTerminalOutput!.apply(frame)
    return frame
  }

  const sessionProjectionTask = createLatestAsyncTask((next: TuiSessionSnapshot): void => {
      if (latestSnapshot?.sessionId !== next.sessionId) return
      const previousRaw = ctx.tuiTerminalRawBuffer!.read()
      const previousOldest = previousRaw[0]?.event.seq
      const nextOldest = next.entries[0]?.event.seq
      if (displaySessionKey === next.sessionId && previousOldest !== undefined && nextOldest !== undefined && nextOldest < previousOldest) {
        ctx.tuiTerminalRawBuffer!.prepend(next.entries.filter(entry => entry.event.seq < previousOldest))
      } else {
        ctx.tuiTerminalRawBuffer!.hydrate(next.entries)
      }
      const rawHistory = ctx.tuiTerminalRawBuffer!.read()
      // Keep history parsing outside the Session notification stack. A slow
      // page or large summary must yield to Ink, the activity timer, and stdin.
      ctx.tuiPresentation.project({
        sessionId: next.sessionId,
        lastSeq: next.lastSeq,
        entries: rawHistory,
      })
  })

  function scheduleSessionProjection(snapshot: TuiSessionSnapshot): void {
    sessionProjectionTask.enqueue(snapshot)
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
  const subagentDispose = ctx.tuiSession.subscribeSubagent(event => {
    if (event.type === 'stopped') ctx.tuiSubagentStatus?.remove(String(event.agentId))
    if (event.type === 'started') ctx.tuiSubagentStatus?.update({ agentId: String(event.agentId), label: `Agent ${String(event.agentId).slice(0, 8)}`, latestToolSummary: 'Working', revision: refreshSourceRevision + 1 })
    if (event.type === 'event' && event.event?.type === 'tool/call') {
      const data = event.event.data as Record<string, unknown>
      const name = typeof data['name'] === 'string' ? data['name'] : 'tool'
      const args = typeof data['arguments'] === 'string' ? data['arguments'] : ''
      const summary = ctx.tuiToolCard?.project({ nodeId: `${String(event.agentId)}:${String(event.event.seq)}`, kind: 'tool.generic', lifecycle: 'streaming', value: { name, arguments: args, status: 'pending', ...(event.view?.for === 'call' ? { callRenderIntent: event.view.view } : {}) } })
      const text = typeof summary?.props?.['text'] === 'string' ? summary.props['text'] : name
      ctx.tuiSubagentStatus?.update({ agentId: String(event.agentId), label: `Agent ${String(event.agentId).slice(0, 8)}`, latestToolSummary: text, revision: event.event.seq })
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
      void host.remote.session.modelCatalog().then(response => {
        if (!response.ok || latestSnapshot?.sessionId !== sessionForModel) return
        const catalog = response.value as { readonly default: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } }
        latestSnapshot = Object.freeze({ ...latestSnapshot, model: catalog.default })
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
    const displaySourceRevision = Math.max(0, snapshot.lastSeq)
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
    scheduleSessionProjection(snapshot)
  })

  // Phase 3 — create or resume the session. Selection and history hydration run
  // after the terminal has painted its empty shell, so a slow history RPC cannot
  // present as a blank terminal.
  let sessionDisposeChain: (() => void) | null = null
  const selectInitialSession = async (): Promise<void> => {
    beginExecutionStatus(options.continueSession || options.resumeSessionId ? 'Loading sessions' : 'Creating session')
    requestRender()
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
      subagentDispose()
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
    ...(ctx.tuiSubagentStatus === undefined ? {} : { subagentStatus: ctx.tuiSubagentStatus }),
    composer: ctx.tuiComposer!,
    overlayManager: ctx.tuiOverlayManager!,
    forkSession: atSeq => {
      void ctx.tuiSession.fork(atSeq).then(() => runtimeController?.clearError()).catch(error => reportAsyncFailure('/fork failed', error))
    },
    loadOlder: async () => {
      await ctx.tuiSession.loadOlder()
      runtimeController?.clearError()
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
    sessionProjectionTask.dispose()
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
