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
import { Context } from '@deepseek-ai/cordis';
import { apply as applyEventBus } from '../../app-event-bus/src/app-event-bus.ts';
import { apply as applyFocus } from '../../focus-manager/src/focus-manager.ts';
import { apply as applyTerminalUi } from '../../terminal-ui/src/terminal-ui.ts';
import { apply as applyLifecycle } from '../../terminal-lifecycle/src/terminal-lifecycle.ts';
import { apply as applyShell, } from '../../app-shell/src/app-shell.ts';
import { TuiSessionService, canonicalCurrentCwd, } from '../../session/src/session.ts';
import { NodeApiClient, resolveEndpoint } from '../../transport/src/transport.ts';
import { TuiPresentationService, projectSession, } from '../../presentation/src/presentation.ts';
import { createTuiRuntimeController, } from '../../app-shell/src/app-shell.ts';
/** Wires all services and returns a started TuiRuntimeController. */
export async function startTui(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const endpoint = resolveEndpoint(options.endpoint === undefined ? {} : { cli: options.endpoint });
    const apiClient = new NodeApiClient(endpoint);
    // Build the host interface expected by TuiSessionService.
    const host = {
        sessions: apiClient.sessions,
        events: apiClient.events,
    };
    // Phase 1 — build a fresh Cordis context and install all services
    const ctx = new Context();
    applyEventBus(ctx);
    applyFocus(ctx);
    applyTerminalUi(ctx);
    applyLifecycle(ctx);
    applyShell(ctx, {
        policy: {
            composerEmpty: true,
            sessionRunning: false,
            sessionSelected: false,
        },
        dispatch(action) {
            // Dispatch routes BusinessAction → Session mutation.
            // This is the only place where app-shell actions become host calls.
            switch (action.kind) {
                case 'session.prompt': {
                    void ctx.tuiSession.prompt(action.text ?? '').catch(err => {
                        console.error('[dsh-tui] prompt error:', err);
                    });
                    return;
                }
                case 'session.cancel': {
                    void ctx.tuiSession.cancel().catch(err => {
                        console.error('[dsh-tui] cancel error:', err);
                    });
                    return;
                }
                case 'command': {
                    // Slash commands are handled inside the controller via /resume, /quit.
                    // Any remaining commands are treated as prompts.
                    if (action.input) {
                        void ctx.tuiSession.prompt(action.input).catch(err => {
                            console.error('[dsh-tui] command error:', err);
                        });
                    }
                    return;
                }
                case 'interaction.respond':
                    // Approval / question responses are forwarded here when they become actionable.
                    // DSH approval API goes through session.host once subscribed.
                    return;
            }
        },
    });
    // Phase 2 — subscribe session → presentation pipeline
    let latestSnapshot = null;
    let latestModel = null;
    const sessionDispose = ctx.tuiSession.subscribe(snapshot => {
        latestSnapshot = snapshot;
        // Project the session entries into a canonical presentation model.
        latestModel = projectSession({
            sessionId: snapshot.sessionId,
            lastSeq: snapshot.lastSeq,
            entries: snapshot.entries,
        });
    });
    const presentationDispose = ctx.tuiPresentation.subscribe(model => {
        latestModel = model;
    });
    // Phase 3 — create or resume the session
    let sessionDisposeChain = null;
    if (options.resumeSessionId) {
        try {
            const canonical = await canonicalCurrentCwd(cwd);
            const snapshot = await ctx.tuiSession.resume(host, options.resumeSessionId, cwd);
            sessionDisposeChain = () => {
                sessionDispose();
                presentationDispose();
                ctx.tuiSession.dispose();
            };
            void snapshot; // consume to avoid unused warning
        }
        catch (err) {
            sessionDispose();
            presentationDispose();
            throw err;
        }
    }
    else {
        try {
            const snapshot = await ctx.tuiSession.createCurrentCwd(host, cwd);
            sessionDisposeChain = () => {
                sessionDispose();
                presentationDispose();
                ctx.tuiSession.dispose();
            };
            void snapshot;
        }
        catch (err) {
            sessionDispose();
            presentationDispose();
            throw err;
        }
    }
    // Phase 4 — build the runtime controller
    const lifecycle = ctx.tuiTerminalLifecycle;
    const ui = ctx.tuiTerminalUi;
    const focus = ctx.tuiFocusManager;
    let resolveExited;
    const exited = new Promise(resolve => {
        resolveExited = resolve;
    });
    const lifecycleDispose = lifecycle.subscribe(state => {
        if (state === 'exited' || state === 'failed')
            resolveExited();
    });
    const controller = createTuiRuntimeController({
        getSnapshot: () => latestSnapshot,
        getPresentation: () => latestModel,
        shell: ctx.tuiShell,
        ui,
        lifecycle,
        focus: {
            shouldExitOnCtrlD(state) {
                return ctx.tuiFocusManager.shouldExitOnCtrlD(state);
            },
            shouldExitOnKey(key) {
                return ctx.tuiFocusManager.shouldExitOnKey(key);
            },
        },
        emitEvent(event) {
            ctx.tuiEventBus.publish(event);
        },
        ...(options.width === undefined ? {} : { width: options.width }),
    });
    // Phase 5 — wire session live events into presentation
    // The session already publishes via its internal subscription.
    // We subscribe the presentation to the session snapshot.
    ctx.tuiSession.subscribe(snapshot => {
        latestSnapshot = snapshot;
        latestModel = projectSession({
            sessionId: snapshot.sessionId,
            lastSeq: snapshot.lastSeq,
            entries: snapshot.entries,
        });
        // Trigger a render via the controller's render method.
        // The controller reads latestSnapshot and latestModel directly.
        controller.render();
    });
    controller.start();
    return {
        controller,
        dispose() {
            controller.stop('dispose');
            lifecycleDispose();
            resolveExited();
            if (sessionDisposeChain)
                sessionDisposeChain();
        },
        exited,
    };
}
