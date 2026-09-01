import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { TuiInputIn02AppEvent, TuiInputIn01TerminalIntent } from '../../playground/experiments/app-event-bus/src/app-event-bus.ts'
import type { TuiValidatedTerminalViewport } from '../../contracts/tui/app-event-bus/validated-terminal-viewport.types.ts'
import type {
  TuiAppContainerCompositionResult,
  TuiAppContainerFrameInput,
} from '../../contracts/tui/app-container/ordered-app-frame-result.types.ts'
import type { TuiRealizedTerminalPrimitiveTree } from '../../contracts/tui/terminal-ui/terminal-frame-pipeline-result.types.ts'
import type { TuiTerminalCarrierResult } from '../../contracts/tui/terminal-lifecycle/terminal-carrier-result.types.ts'
import { apply as applyRefreshOrchestrator } from '../../playground/experiments/refresh-orchestrator/src/refresh-orchestrator.ts'
import { apply as applyComposer } from '../../playground/experiments/composer-plugin/src/composer-plugin.ts'
import { apply as applyOverlayManager } from '../../playground/experiments/overlay-manager-plugin/src/overlay-manager-plugin.ts'
import { apply as applyStatusFooter } from '../../playground/experiments/status-footer-plugin/src/status-footer-plugin.ts'
import { apply as applyAppContainer } from '../../playground/experiments/app-container/src/app-container.ts'
import { apply as applyChromeSlotRegistry } from '../../playground/experiments/chrome-slot-registry/src/chrome-slot-registry.ts'
import {
  TuiDisplayControlService,
  type TuiDisplayControlScheduler,
} from '../../playground/experiments/display-control/src/display-control.ts'
import {
  apply as applyLogicControls,
  applyConnection,
  applyExecution,
  applyLogo,
  applySession,
  applyStatus,
} from '../../playground/experiments/logic-controls/src/logic-controls.ts'
import { tuiConnectionDisplayPlugin } from '../../playground/experiments/tui-connection/src/tui-connection.ts'
import { tuiExecutionDisplayPlugin } from '../../playground/experiments/tui-execution/src/tui-execution.ts'
import { tuiLogoDisplayPlugin } from '../../playground/experiments/tui-logo/src/tui-logo.ts'
import { tuiSessionDisplayPlugin } from '../../playground/experiments/tui-session/src/tui-session.ts'
import { tuiStatusDisplayPlugin } from '../../playground/experiments/tui-status/src/tui-status.ts'
import {
  apply,
  createTuiRuntimeController,
  type TuiInputIn03BusinessAction,
  type TuiRuntimeDeps,
  type TuiRuntimeLifecycleLike,
  type TuiRuntimeTerminalEvent,
  type TuiShellPolicy,
} from '../../playground/experiments/app-shell/src/app-shell.ts'

function appEvent(intent: TuiInputIn02AppEvent['intent']): TuiInputIn02AppEvent {
  return { eventId: `event-${Math.random()}`, acceptedAt: 1, intent }
}

function shell(policy: Partial<TuiShellPolicy> = {}) {
  const ctx = new Context()
  const actions: TuiInputIn03BusinessAction[] = []
  const commands: string[] = []
  apply(ctx, {
    policy: { composerEmpty: true, sessionRunning: false, sessionSelected: true, ...policy },
    dispatchBusiness: action => actions.push(action),
    dispatchControl: action => commands.push(action.input),
  })
  applyRefreshOrchestrator(ctx)
  return { ctx, actions, commands }
}

function keyEvent(input: string, partial: Record<string, boolean> = {}): TuiRuntimeTerminalEvent {
  return {
    type: 'key',
    input,
    key: {
      ctrl: false,
      return: false,
      shift: false,
      backspace: false,
      delete: false,
      leftArrow: false,
      rightArrow: false,
      upArrow: false,
      downArrow: false,
      pageUp: false,
      pageDown: false,
      home: false,
      end: false,
      tab: false,
      escape: false,
      ...partial,
    },
  }
}

const region = Object.freeze({
  contract: 'tui.terminal-region-leaves.v1',
  publicationRevision: 1,
  transcript: Object.freeze({ kind: 'box', key: 'leaf.transcript', style: Object.freeze({ flexDirection: 'column' }), children: Object.freeze([]) }),
  composer: Object.freeze({ kind: 'box', key: 'leaf.composer', style: Object.freeze({ flexDirection: 'column' }), children: Object.freeze([]) }),
  footer: Object.freeze({ kind: 'box', key: 'leaf.footer', style: Object.freeze({ flexDirection: 'column' }), children: Object.freeze([]) }),
}) as any

const frame = Object.freeze({ contract: 'tui.terminal-frame-tree.v1', publicationRevision: 1, root: Object.freeze({ kind: 'box', key: 'frame.root', style: Object.freeze({ flexDirection: 'column' }), children: Object.freeze([]) }) }) as any
const realized = Object.freeze({ contract: 'tui.realized-terminal-primitive-tree.v1', root: frame.root }) as any

function lifecycleMock() {
  const calls: string[] = []
  const failures: Array<{ error: Error; source: string }> = []
  const rendered: TuiRealizedTerminalPrimitiveTree[] = []
  let handlers: Array<(event: TuiRuntimeTerminalEvent) => void> = []
  const exits: string[] = []
  const lifecycle: TuiRuntimeLifecycleLike & { handler(): any } = {
    state: () => 'active',
    setInputHandler(handler) {
      if (handler === null) handlers = []
      else handlers.push(handler)
    },
    fail(error, source = 'lifecycle.fail') {
      calls.push(`fail:${source}`)
      failures.push({ error, source })
    },
    render(tree) {
      calls.push('render')
      rendered.push(tree)
      return { ok: true } as TuiTerminalCarrierResult
    },
    enter() {
      calls.push('enter')
    },
    exit(reason) {
      calls.push(`exit:${reason.reason}`)
      exits.push(reason.reason)
    },
    handler: () => handlers[0],
  }
  return { lifecycle, calls, failures, rendered, exits }
}

function displayScheduler(): TuiDisplayControlScheduler & { runTimers(): void } {
  let now = 1000
  let nextHandle = 1
  const timers = new Map<number, () => void>()
  return {
    setTimeout(callback) {
      const handle = nextHandle++
      timers.set(handle, callback)
      return handle
    },
    clearTimeout(handle) {
      timers.delete(handle as number)
    },
    now: () => now,
    runTimers() {
      const callbacks = [...timers.values()]
      timers.clear()
      now += 100
      for (const callback of callbacks) callback()
    },
  }
}

function deps(options: {
  shellCtx: ReturnType<typeof shell>['ctx']
  lifecycle: ReturnType<typeof lifecycleMock>['lifecycle']
  projectResult?: any
  composeResult?: any
  realizeResult?: any
  layout?: 'default' | 'compact'
  running?: boolean
  suggestions?: (text: string) => ReadonlyArray<{ readonly command: string; readonly description: string }>
  emit?: (event: TuiInputIn01TerminalIntent) => void
}): TuiRuntimeDeps {
  const ctx = new Context()
  applyStatusFooter(ctx)
  applyComposer(ctx)
  applyOverlayManager(ctx)
  return {
    getSnapshot: () => ({ sessionId: 'session-1', cwd: '/workspace', running: options.running ?? false }),
    getPresentation: () => ({ nodes: [], publicationRevision: 1 }),
    refresh: options.shellCtx.tuiRefreshOrchestrator,
    shell: options.shellCtx.tuiShell,
    appContainer: {
      layout: options.layout ?? 'default',
      resetRevision() {},
      composeFrameSafe(input: TuiAppContainerFrameInput): TuiAppContainerCompositionResult {
        if (options.composeResult) return options.composeResult(input)
        assert.ok(Object.isFrozen(input.viewport))
        assert.deepEqual(Object.keys(input.viewport).sort(), ['columns', 'rows'])
        assert.equal(input.regionLeaves, region)
        return { ok: true, value: frame }
      },
    },
    terminalUi: {
      projectSafe: () => options.projectResult ?? { ok: true, value: region },
      realizeSafe: () => options.realizeResult ?? { ok: true, value: realized },
    },
    chrome: {
      projectState: () => Object.freeze({
        logoVariant: 'full',
        logoVisible: true,
        connectionState: 'connected',
        executionState: 'idle',
        headerSession: '/tmp/work',
        headerStatus: 'idle',
      }),
    },
    statusFooter: ctx.tuiStatusFooter,
    composer: ctx.tuiComposer!,
    overlayManager: ctx.tuiOverlayManager!,
    lifecycle: options.lifecycle,
    focus: {
      pushView: () => () => undefined,
      activeView: () => 'composer.editor',
    },
    emitEvent: options.emit ?? (() => undefined),
    ...(options.suggestions === undefined ? {} : { slashCommandSuggestions: options.suggestions }),
  }
}

test('Tab completes the first matching slash command without submitting', () => {
  const shellCtx = shell()
  const mock = lifecycleMock()
  const runtimeDeps = deps({
    shellCtx: shellCtx.ctx,
    lifecycle: mock.lifecycle,
    suggestions: text => text === '/mo' ? [{ command: '/models', description: 'choose a model' }] : [],
  })
  const controller = createTuiRuntimeController(runtimeDeps)
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  controller.start()
  const handler = mock.lifecycle.handler()
  handler(keyEvent('/', {}))
  handler(keyEvent('m'))
  handler(keyEvent('o'))
  handler(keyEvent('', { tab: true }))
  assert.equal(runtimeDeps.composer.projectState().text, '/models')
  assert.deepEqual(shellCtx.commands, [])
})

test('shell maps submit, cancel, and command into adjacent typed chains', () => {
  const runningShell = shell({ sessionRunning: true })
  runningShell.ctx.tuiShell.dispatch(appEvent({ kind: 'terminal.submit', sourceId: 'composer.editor', text: 'hello' }))
  runningShell.ctx.tuiShell.dispatch(appEvent({ kind: 'terminal.cancel', sourceId: 'composer.editor' }))
  runningShell.ctx.tuiShell.dispatch(appEvent({ kind: 'terminal.command', sourceId: 'composer.editor', input: '/help' }))
  assert.deepEqual(runningShell.actions, [
    { kind: 'session.prompt', actionId: 'a1', text: 'hello' },
    { kind: 'session.cancel', actionId: 'a2' },
  ])
  assert.deepEqual(runningShell.commands, ['/help'])

  const idleShell = shell()
  assert.throws(() => idleShell.ctx.tuiShell.dispatch(appEvent({
    kind: 'terminal.resize',
    sourceId: 'terminal-lifecycle',
    size: Object.freeze({ columns: 80, rows: 24 }),
  })), /control/)
})

test('runtime executes project then compose then realize then carrier render', () => {
  const shellCtx = shell().ctx
  const mock = lifecycleMock()
  const calls: string[] = []
  const controller = createTuiRuntimeController(deps({
    shellCtx,
    lifecycle: {
      ...mock.lifecycle,
      fail(error, source) {
        calls.push(`fail:${source}`)
        mock.lifecycle.fail(error, source)
      },
      render(tree) {
        calls.push('render')
        return mock.lifecycle.render(tree)
      },
    },
  }))
  controller.storeViewport(Object.freeze({ columns: 91, rows: 33 }))
  controller.start()
  assert.deepEqual(calls, ['render'])
  assert.equal(mock.rendered[0], realized)
  assert.equal(mock.failures.length, 0)
})

test('start fails closed before first composition when viewport is absent', () => {
  const shellCtx = shell().ctx
  const mock = lifecycleMock()
  const controller = createTuiRuntimeController(deps({ shellCtx, lifecycle: mock.lifecycle }))
  controller.start()
  assert.deepEqual(mock.calls, ['fail:viewport-bootstrap'])
  assert.equal(mock.rendered.length, 0)
  assert.match(mock.failures[0]?.error.message ?? '', /validated terminal viewport/)
})

test('each pipeline stage routes its typed failure to the terminal error chain', () => {
  const causes = [new Error('projection'), new Error('composition'), new Error('realization')]
  const expectedSources = ['region-projection', 'app-container-composition', 'primitive-realization']
  for (const [index, source] of expectedSources.entries()) {
    const shellCtx = shell().ctx
    const mock = lifecycleMock()
    const options = {
      shellCtx,
      lifecycle: mock.lifecycle,
      ...(index === 0 ? { projectResult: { ok: false, error: { stage: 'region-projection', code: 'invalid-terminal-region-leaves', message: 'bad model', cause: causes[0] } } } : {}),
      ...(index === 1 ? { composeResult: () => ({ ok: false, error: { stage: 'validate', code: 'invalid-app-container-frame', message: 'bad frame', cause: causes[1] } }) } : {}),
      ...(index === 2 ? { realizeResult: { ok: false, error: { stage: 'primitive-realization', code: 'invalid-terminal-primitive-tree', message: 'bad primitive', cause: causes[2] } } } : {}),
    }
    const controller = createTuiRuntimeController(deps(options))
    controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
    controller.start()
    assert.equal(mock.rendered.length, 0)
    assert.equal(mock.failures[0]?.source, source)
    assert.equal(mock.failures[0]?.error.cause, causes[index])
  }
})

test('viewport stored after start advances the refresh revision once per change', async () => {
  const shellCtx = shell().ctx
  const mock = lifecycleMock()
  let renders = 0
  const controller = createTuiRuntimeController(deps({
    shellCtx,
    lifecycle: {
      ...mock.lifecycle,
      render(tree) {
        renders += 1
        return mock.lifecycle.render(tree)
      },
    },
  }))
  controller.storeViewport(Object.freeze({ columns: 90, rows: 24 }))
  controller.start()
  renders = 0
  const unsubscribe = shellCtx.tuiRefreshOrchestrator!.subscribe(() => controller.renderNow())
  controller.storeViewport(Object.freeze({ columns: 100, rows: 30 } as TuiValidatedTerminalViewport))
  await new Promise<void>(resolve => queueMicrotask(() => resolve()))
  unsubscribe()
  assert.equal(renders, 1)
})

test('one refresh publication drives exactly one composition tail', async () => {
  const shellCtx = shell().ctx
  const mock = lifecycleMock()
  let renders = 0
  const controller = createTuiRuntimeController(deps({
    shellCtx,
    lifecycle: {
      ...mock.lifecycle,
      render(tree) {
        renders += 1
        return mock.lifecycle.render(tree)
      },
    },
  }))
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  const unsubscribe = shellCtx.tuiRefreshOrchestrator!.subscribe(() => controller.renderNow())
  controller.start()
  renders = 0
  shellCtx.tuiRefreshOrchestrator!.request({
    sourceModuleId: 'presentation',
    reason: 'presentation',
    sourceRevision: 1,
  })
  await new Promise<void>(resolve => queueMicrotask(() => resolve()))
  unsubscribe()
  assert.equal(renders, 1)
})

test('input handler clears non-empty composer on ctrl-c and exits only after two empty presses', () => {
  const emitted: TuiInputIn01TerminalIntent[] = []
  const shellCtx = shell().ctx
  const mock = lifecycleMock()
  const runtimeDeps = deps({
    shellCtx,
    lifecycle: mock.lifecycle,
    running: false,
    emit: event => emitted.push(event),
  })
  const controller = createTuiRuntimeController(runtimeDeps)
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  const handler = mock.lifecycle.handler()
  handler(keyEvent('h'))
  handler(keyEvent('c', { ctrl: true }))
  assert.equal(runtimeDeps.composer.projectState().text, '')
  assert.deepEqual(mock.exits, [])
  // First empty Ctrl+C announces exit but does not exit.
  handler(keyEvent('c', { ctrl: true }))
  assert.deepEqual(mock.exits, [])
  // Second empty Ctrl+C confirms exit.
  handler(keyEvent('c', { ctrl: true }))
  assert.deepEqual(mock.exits, ['ctrl-c-confirm'])
})

test('running ctrl-c cancels the active turn instead of announcing exit', () => {
  const emitted: TuiInputIn01TerminalIntent[] = []
  const shellCtx = shell()
  const mock = lifecycleMock()
  const controller = createTuiRuntimeController(deps({
    shellCtx: shellCtx.ctx,
    lifecycle: mock.lifecycle,
    running: true,
    emit: event => emitted.push(event),
  }))
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  const handler = mock.lifecycle.handler()
  handler(keyEvent('c', { ctrl: true }))
  assert.equal(emitted.at(-1)?.kind, 'terminal.cancel')
  assert.deepEqual(mock.exits, [])
})

test('history keys select submitted prompts at the start and move within multiline input', () => {
  const shellCtx = shell().ctx
  const mock = lifecycleMock()
  const runtimeDeps = deps({ shellCtx, lifecycle: mock.lifecycle })
  const controller = createTuiRuntimeController(runtimeDeps)
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  controller.start()
  const initialRenderCount = mock.rendered.length
  const handler = mock.lifecycle.handler()
  for (const character of 'one') handler(keyEvent(character))
  handler(keyEvent('', { return: true }))
  for (const character of 'two') handler(keyEvent(character))
  handler(keyEvent('', { return: true }))
  assert.equal(runtimeDeps.composer.projectState().text, '')

  handler(keyEvent('', { upArrow: true }))
  assert.equal(runtimeDeps.composer.projectState().text, 'two')
  handler(keyEvent('', { downArrow: true }))
  assert.equal(runtimeDeps.composer.projectState().text, '')

  for (const character of 'ab') handler(keyEvent(character))
  handler(keyEvent('', { shift: true, return: true }))
  for (const character of 'cd') handler(keyEvent(character))
  handler(keyEvent('', { upArrow: true }))
  assert.equal(runtimeDeps.composer.projectState().cursor, 2)
  handler(keyEvent('', { downArrow: true }))
  assert.equal(runtimeDeps.composer.projectState().cursor, 5)

  handler(keyEvent('', { pageUp: true }))
  handler(keyEvent('', { pageDown: true }))
  assert.ok(mock.rendered.length > initialRenderCount)
})

test('idle ctrl-c confirm window expires after 3s and does not exit', async () => {
  const shellCtx = shell()
  const mock = lifecycleMock()
  const controller = createTuiRuntimeController(deps({
    shellCtx: shellCtx.ctx,
    lifecycle: mock.lifecycle,
    running: false,
  }))
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  const handler = mock.lifecycle.handler()
  const originalNow = Date.now
  let fakeNow = 1_000_000
  Date.now = () => fakeNow
  try {
    handler(keyEvent('c', { ctrl: true }))
    assert.deepEqual(mock.exits, [])
    fakeNow += 3_500
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    // After the timer fires, a new Ctrl+C starts a fresh window, not an exit.
    handler(keyEvent('c', { ctrl: true }))
    assert.deepEqual(mock.exits, [])
  } finally {
    Date.now = originalNow
  }
})

test('display lifecycle projects live chrome and expires back to persistent chrome', async () => {
  const ctx = new Context()
  const scheduler = displayScheduler()
  applyLogicControls(ctx)
  applyLogo(ctx)
  applyConnection(ctx)
  applySession(ctx)
  applyStatus(ctx)
  applyExecution(ctx)
  ctx.tuiDisplayControl = new TuiDisplayControlService(ctx, scheduler)
  applyChromeSlotRegistry(ctx)
  const fibers = []
  for (const plugin of [
    tuiLogoDisplayPlugin,
    tuiConnectionDisplayPlugin,
    tuiSessionDisplayPlugin,
    tuiStatusDisplayPlugin,
    tuiExecutionDisplayPlugin,
  ]) fibers.push(await ctx.plugin(plugin))
  applyAppContainer(ctx)

  const lifecycle = ctx.tuiDisplayControl.get('tui.execution')!
  lifecycle.setPersistent(1)
  lifecycle.showLive(2, 8000)
  assert.equal(ctx.tuiChromeSlotRegistry.projectState({ publicationRevision: 2 }).executionDisplayMode, 'live')

  scheduler.runTimers()
  assert.equal(lifecycle.state.mode, 'persistent')
  assert.equal(ctx.tuiChromeSlotRegistry.projectState({ publicationRevision: 3 }).executionDisplayMode, 'persistent')
  await Promise.all(fibers.map(fiber => fiber.dispose()))
})

test('session identity change resets the app-container revision epoch before composing and input keeps rendering', () => {
  let lastSeen = -1
  const seenRevisions: number[] = []
  let resetCount = 0
  const shellCtx = shell().ctx
  const mock = lifecycleMock()
  let sessionId = 'session-a'
  let presentationRevision = 38
  const customDeps: TuiRuntimeDeps = {
    ...deps({ shellCtx, lifecycle: mock.lifecycle }),
    getSnapshot: () => ({ sessionId, cwd: '/workspace', running: false }),
    getPresentation: () => ({ nodes: [], publicationRevision: presentationRevision }),
    appContainer: {
      layout: 'default',
      resetRevision() {
        resetCount += 1
        lastSeen = -1
      },
      composeFrameSafe(input: TuiAppContainerFrameInput): TuiAppContainerCompositionResult {
        seenRevisions.push(input.publicationRevision)
        if (input.publicationRevision < lastSeen) {
          return {
            ok: false,
            error: {
              stage: 'build',
              code: 'invalid-app-container-frame',
              message: `stale revision ${input.publicationRevision} < ${lastSeen}`,
              cause: new Error('stale frame'),
            },
          }
        }
        lastSeen = input.publicationRevision
        return { ok: true, value: frame }
      },
    },
  }
  const controller = createTuiRuntimeController(customDeps)
  controller.storeViewport(Object.freeze({ columns: 91, rows: 33 }))
  controller.start()
  sessionId = 'session-b'
  presentationRevision = 2
  controller.renderNow()
  controller.handleTerminalEvent(keyEvent('x'))
  assert.equal(resetCount, 1)
  assert.deepEqual(seenRevisions, [38, 2, 2])
  assert.equal(mock.rendered.length, 3)
  assert.equal(mock.failures.length, 0)
})

test('same-session back-stepping revision is not reset and enters the composition failure chain', () => {
  let lastSeen = -1
  const seenRevisions: number[] = []
  let resetCount = 0
  const shellCtx = shell().ctx
  const mock = lifecycleMock()
  let presentationRevision = 38
  const customDeps: TuiRuntimeDeps = {
    ...deps({ shellCtx, lifecycle: mock.lifecycle }),
    getSnapshot: () => ({ sessionId: 'session-a', cwd: '/workspace', running: false }),
    getPresentation: () => ({ nodes: [], publicationRevision: presentationRevision }),
    appContainer: {
      layout: 'default',
      resetRevision() {
        resetCount += 1
        lastSeen = -1
      },
      composeFrameSafe(input: TuiAppContainerFrameInput): TuiAppContainerCompositionResult {
        seenRevisions.push(input.publicationRevision)
        if (input.publicationRevision < lastSeen) {
          return {
            ok: false,
            error: {
              stage: 'build',
              code: 'invalid-app-container-frame',
              message: `stale revision ${input.publicationRevision} < ${lastSeen}`,
              cause: new Error('stale frame'),
            },
          }
        }
        lastSeen = input.publicationRevision
        return { ok: true, value: frame }
      },
    },
  }
  const c = createTuiRuntimeController(customDeps)
  c.storeViewport(Object.freeze({ columns: 91, rows: 33 }))
  c.start()
  presentationRevision = 2
  c.renderNow()
  assert.equal(resetCount, 0)
  assert.deepEqual(seenRevisions, [38, 2])
  assert.equal(mock.failures.length, 1)
  assert.equal(mock.failures[0]?.source, 'app-container-composition')
  assert.match(mock.failures[0]?.error.message ?? '', /stale revision 2 < 38/)
})
