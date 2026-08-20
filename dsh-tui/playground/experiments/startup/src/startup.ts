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
import { apply as applyComponentRegistry } from '../../component-registry/src/component-registry.ts'
import { apply as applyFocus } from '../../focus-manager/src/focus-manager.ts'
import { apply as applyPresentation } from '../../presentation/src/presentation.ts'
import { apply as applySession } from '../../session/src/session.ts'
import { apply as applyTerminalUi } from '../../terminal-ui/src/terminal-ui.ts'
import { apply as applyLifecycle } from '../../terminal-lifecycle/src/terminal-lifecycle.ts'
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
  type TuiRuntimeTerminalEvent,
} from '../../app-shell/src/app-shell.ts'
import type { TuiTerminalUi } from '../../terminal-ui/src/terminal-ui.ts'
import type { TuiTerminalLifecycle } from '../../terminal-lifecycle/src/terminal-lifecycle.ts'
import type { TuiFocusManager } from '../../focus-manager/src/focus-manager.ts'

export interface TuiStartupOptions {
  endpoint?: string
  resumeSessionId?: string
  cwd?: string
  width?: number
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

  // Phase 1 — build a fresh Cordis context and install all services
  const ctx = new Context()
  applyEventBus(ctx)
  applyComponentRegistry(ctx)
  applyFocus(ctx)
  applySession(ctx)
  applyPresentation(ctx)
  applyTerminalUi(ctx)
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
      const raw = action.input.trim()
      if (raw === '/quit' || raw === '/exit') {
        if (lifecycle === null) throw new Error('TUI terminal lifecycle is not ready')
        lifecycle.exit({ reason: 'slash-quit' })
        return
      }
      if (raw === '/help') {
        if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
        runtimeController.openOverlay({
          view: 'overlay.help',
          title: 'dsh-tui help — q/Esc closes',
          items: [
            '/resume — choose a Session from current cwd',
            '/resume <sessionId> — resume exact current-cwd Session',
            '/quit — restore terminal and exit',
            'Shift+Enter — newline; Ctrl+C — cancel running turn',
            'Up/Down or PageUp/PageDown — transcript scroll',
          ],
        })
        return
      }
      if (raw === '/resume') {
        void ctx.tuiSession.listCurrentCwdSessions(host, cwd).then(options => {
          if (options.length === 0) {
            reportRuntimeError('/resume found no Sessions in current cwd')
            return
          }
          if (runtimeController === null) throw new Error('TUI runtime controller is not ready')
          runtimeController.openOverlay({
            view: 'selector.resume-current-cwd',
            title: 'Resume current cwd — Enter selects, q/Esc closes',
            items: options.map(option => `${option.sessionId}${option.running ? ' [running]' : ''}`),
          }, selectedIndex => {
            const selected = options[selectedIndex]
            if (selected === undefined) {
              reportRuntimeError('/resume selector returned an invalid index')
              return
            }
            void ctx.tuiSession.resume(host, selected.sessionId, cwd).then(() => {
              runtimeController?.clearError()
            }).catch(error => {
              reportAsyncFailure('/resume failed', error)
            })
          })
        }).catch(error => {
          reportAsyncFailure('/resume list failed', error)
        })
        return
      }
      if (raw.startsWith('/resume ')) {
        const id = raw.slice('/resume '.length).trim()
        if (id.length === 0) {
          reportRuntimeError('/resume requires a session id')
          return
        }
        void ctx.tuiSession.resume(host, id, cwd).then(() => {
          runtimeController?.clearError()
        }).catch(error => {
          reportAsyncFailure('/resume failed', error)
        })
        return
      }
      reportRuntimeError(`unknown command: ${raw}`)
    },
  })

  const eventDispose = ctx.tuiEventBus.subscribe(event => {
    switch (event.intent.kind) {
      case 'focus.activate':
        ctx.tuiFocusManager.activate(event.intent.target)
        return
      case 'terminal.resize':
        return
      default:
        ctx.tuiShell.dispatch(event)
    }
  })

  // Phase 2 — subscribe session → presentation pipeline
  let latestSnapshot: TuiSessionSnapshot | null = null
  let latestModel: TuiPresentationModel | null = null
  let requestRender = (): void => undefined

  const presentationDispose = ctx.tuiPresentation.subscribe(model => {
    latestModel = model
    requestRender()
  })
  const sessionDispose = ctx.tuiSession.subscribe(snapshot => {
    latestSnapshot = snapshot
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
        ctx.tuiSession.dispose()
      }
      void snapshot // consume to avoid unused warning
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
  const ui = ctx.tuiTerminalUi as TuiTerminalUi
  const focus = ctx.tuiFocusManager as TuiFocusManager

  let resolveExited!: (outcome: TuiStartupOutcome) => void
  const exited = new Promise<TuiStartupOutcome>(resolve => {
    resolveExited = resolve
  })
  const terminalLifecycle = lifecycle
  const lifecycleDispose = terminalLifecycle.subscribe(state => {
    if (state === 'exited') resolveExited({ state: 'exited' })
    if (state === 'failed') {
      resolveExited({
        state: 'failed',
        error: terminalLifecycle.failure() ?? new Error('terminal lifecycle failed without an error'),
      })
    }
  })

  const controller = createTuiRuntimeController({
    getSnapshot: () => latestSnapshot,
    getPresentation: () => latestModel,
    shell: ctx.tuiShell,
    ui,
    lifecycle: terminalLifecycle,
    focus: {
      shouldExitOnCtrlD(state: { empty: boolean; running: boolean }): boolean {
        return ctx.tuiFocusManager.shouldExitOnCtrlD(state)
      },
      shouldExitOnKey(key: string): boolean {
        return ctx.tuiFocusManager.shouldExitOnKey(key)
      },
      pushView(view) {
        return ctx.tuiFocusManager.pushView(view)
      },
    },
    emitEvent(event) {
      ctx.tuiEventBus.publish(event as never)
    },
    ...(options.width === undefined ? {} : { width: options.width }),
  })
  runtimeController = controller
  reportRuntimeError = message => controller.reportError(message)
  reportSubmissionError = message => controller.reportSubmissionError(message)

  // Phase 5 — wire session live events into presentation
  // The session already publishes via its internal subscription.
  // We subscribe the presentation to the session snapshot.
  terminalLifecycle.enter({ stdout: process.stdout, stdin: process.stdin, stderr: process.stderr })
  requestRender = () => controller.render()
  controller.start()

  return {
    controller,
    dispose(): void {
      controller.stop('dispose')
      lifecycleDispose()
      resolveExited({ state: 'exited' })
      if (sessionDisposeChain) sessionDisposeChain()
    },
    exited,
  }
}
