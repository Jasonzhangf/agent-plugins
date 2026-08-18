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
  type BusinessAction,
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
  readonly exited: Promise<void>
  readonly dispose: () => void
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
    dispatch(action: BusinessAction) {
      // Dispatch routes BusinessAction → Session mutation.
      // This is the only place where app-shell actions become host calls.
      switch (action.kind) {
        case 'command': {
          const raw = (action.input ?? '').trim()
          if (raw === '/quit' || raw === '/exit') {
            lifecycle.exit({ reason: 'slash-quit' })
            return
          }
          if (raw.startsWith('/resume')) {
            const id = raw.split(/\s+/)[1] ?? ''
            if (id.length === 0) {
              process.stderr.write('error: /resume requires a session id\n')
              return
            }
            void ctx.tuiSession.resume(host, id, cwd).catch(err => {
              process.stderr.write(`error: /resume failed: ${err instanceof Error ? err.message : String(err)}\n`)
            })
            return
          }
          if (action.input) {
            void ctx.tuiSession.prompt(action.input).catch(err => {
              console.error('[dsh-tui] command error:', err)
            })
          }
          return
        }
        case 'session.prompt': {
          void ctx.tuiSession.prompt(action.text ?? '').catch(err => {
            console.error('[dsh-tui] prompt error:', err)
          })
          return
        }
        case 'session.cancel': {
          void ctx.tuiSession.cancel().catch(err => {
            console.error('[dsh-tui] cancel error:', err)
          })
          return
        }
        case 'command': {
          // Slash commands are handled inside the controller via /resume, /quit.
          // Any remaining commands are treated as prompts.
          if (action.input) {
            void ctx.tuiSession.prompt(action.input).catch(err => {
              console.error('[dsh-tui] command error:', err)
            })
          }
          return
        }
        case 'interaction.respond':
          // Approval / question responses are forwarded here when they become actionable.
          // DSH approval API goes through session.host once subscribed.
          return
      }
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
        ctx.tuiShell.dispatch(event.intent)
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
  const lifecycle = ctx.tuiTerminalLifecycle as TuiTerminalLifecycle
  const ui = ctx.tuiTerminalUi as TuiTerminalUi
  const focus = ctx.tuiFocusManager as TuiFocusManager

  let resolveExited!: () => void
  const exited = new Promise<void>(resolve => {
    resolveExited = resolve
  })
  const lifecycleDispose = lifecycle.subscribe(state => {
    if (state === 'exited' || state === 'failed') resolveExited()
  })

  const controller = createTuiRuntimeController({
    getSnapshot: () => latestSnapshot,
    getPresentation: () => latestModel,
    shell: ctx.tuiShell,
    ui,
    lifecycle,
    focus: {
      shouldExitOnCtrlD(state: { empty: boolean; running: boolean }): boolean {
        return ctx.tuiFocusManager.shouldExitOnCtrlD(state)
      },
      shouldExitOnKey(key: string): boolean {
        return ctx.tuiFocusManager.shouldExitOnKey(key)
      },
    },
    emitEvent(event) {
      ctx.tuiEventBus.publish(event as never)
    },
    ...(options.width === undefined ? {} : { width: options.width }),
  })

  // Phase 5 — wire session live events into presentation
  // The session already publishes via its internal subscription.
  // We subscribe the presentation to the session snapshot.
  lifecycle.enter({ stdout: process.stdout, stdin: process.stdin, stderr: process.stderr })
  requestRender = () => controller.render()
  controller.start()

  return {
    controller,
    dispose(): void {
      controller.stop('dispose')
      lifecycleDispose()
      resolveExited()
      if (sessionDisposeChain) sessionDisposeChain()
    },
    exited,
  }
}
