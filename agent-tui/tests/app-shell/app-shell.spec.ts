import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { TuiInputIn02AppEvent, TuiInputIn01TerminalIntent } from '../../src/experiments/app-event-bus/src/app-event-bus.ts'
import type { TuiValidatedTerminalViewport } from '../../contracts/tui/app-event-bus/validated-terminal-viewport.types.ts'
import type {
  TuiAppContainerCompositionResult,
  TuiAppContainerFrameInput,
} from '../../contracts/tui/app-container/ordered-app-frame-result.types.ts'
import type { TuiRealizedTerminalPrimitiveTree } from '../../contracts/tui/terminal-ui/terminal-frame-pipeline-result.types.ts'
import type { TuiTerminalCarrierResult } from '../../contracts/tui/terminal-lifecycle/terminal-carrier-result.types.ts'
import type { TuiTerminalNodeLifecycle } from '../../contracts/tui/terminal-ui/terminal-shell.types.ts'
import { apply as applyRefreshOrchestrator } from '../../src/experiments/refresh-orchestrator/src/refresh-orchestrator.ts'
import { apply as applyComposer } from '../../src/experiments/composer-plugin/src/composer-plugin.ts'
import { apply as applyOverlayManager } from '../../src/experiments/overlay-manager-plugin/src/overlay-manager-plugin.ts'
import { apply as applyStatusFooter } from '../../src/experiments/status-footer-plugin/src/status-footer-plugin.ts'
import { apply as applyAppContainer } from '../../src/experiments/app-container/src/app-container.ts'
import { apply as applyChromeSlotRegistry } from '../../src/experiments/chrome-slot-registry/src/chrome-slot-registry.ts'
import {
  TuiDisplayControlService,
  type TuiDisplayControlScheduler,
} from '../../src/experiments/display-control/src/display-control.ts'
import {
  apply as applyLogicControls,
  applyConnection,
  applyExecution,
  applyLogo,
  applySession,
  applyStatus,
} from '../../src/experiments/logic-controls/src/logic-controls.ts'
import { tuiConnectionDisplayPlugin } from '../../src/experiments/tui-connection/src/tui-connection.ts'
import { tuiExecutionDisplayPlugin } from '../../src/experiments/tui-execution/src/tui-execution.ts'
import { tuiLogoDisplayPlugin } from '../../src/experiments/tui-logo/src/tui-logo.ts'
import { tuiSessionDisplayPlugin } from '../../src/experiments/tui-session/src/tui-session.ts'
import { tuiStatusDisplayPlugin } from '../../src/experiments/tui-status/src/tui-status.ts'
import {
  apply,
  createTuiRuntimeController,
  type TuiInputIn03BusinessAction,
  type TuiRuntimeDeps,
  type TuiRuntimeLifecycleLike,
  type TuiRuntimeSnapshotLike,
  type TuiRuntimeTerminalEvent,
  type TuiShellPolicy,
} from '../../src/experiments/app-shell/src/app-shell.ts'

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

function submittedTexts(events: readonly TuiInputIn01TerminalIntent[]): string[] {
  return events.flatMap(event => event.kind === 'terminal.submit' ? [event.text] : [])
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
  sessionSelected?: () => boolean
  executionStatus?: TuiRuntimeDeps['executionStatus']
  suggestions?: (text: string) => ReadonlyArray<{ readonly command: string; readonly description: string }>
  emit?: (event: TuiInputIn01TerminalIntent) => void
  forkSession?: (atSeq: number) => void
  loadOlder?: () => Promise<void>
  presentationNodes?: ReadonlyArray<{ readonly nodeId: string; readonly kind: string; readonly publicationRevision: number; readonly lifecycle: TuiTerminalNodeLifecycle; readonly value: Readonly<Record<string, unknown>> }>
}): TuiRuntimeDeps {
  const ctx = new Context()
  applyStatusFooter(ctx)
  applyComposer(ctx)
  applyOverlayManager(ctx)
  return {
    getSnapshot: (): TuiRuntimeSnapshotLike | null => options.sessionSelected?.() === false
      ? null
      : ({ sessionId: 'session-1', cwd: '/workspace', running: options.running ?? false }),
    getPresentation: () => ({ nodes: options.presentationNodes ?? [], publicationRevision: 1 }),
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
    ...(options.forkSession === undefined ? {} : { forkSession: options.forkSession }),
    ...(options.loadOlder === undefined ? {} : { loadOlder: options.loadOlder }),
    ...(options.executionStatus === undefined ? {} : { executionStatus: options.executionStatus }),
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

test('running composer uses Tab to queue and Enter to add the next turn', () => {
  const shellCtx = shell()
  const mock = lifecycleMock()
  const emitted: TuiInputIn01TerminalIntent[] = []
  const runtimeDeps = deps({
    shellCtx: shellCtx.ctx,
    lifecycle: mock.lifecycle,
    running: true,
    emit: event => emitted.push(event),
  })
  const controller = createTuiRuntimeController(runtimeDeps)
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  controller.start()
  const handler = mock.lifecycle.handler()

  for (const character of 'queued') handler(keyEvent(character))
  handler(keyEvent('', { tab: true }))
  for (const character of 'next-turn') handler(keyEvent(character))
  handler(keyEvent('', { return: true }))

  assert.deepEqual(emitted.filter(event => event.kind === 'terminal.submit').map(event => event.text), ['queued', 'next-turn'])
  assert.equal(runtimeDeps.composer.projectState().text, '')
})

test('idle empty composer Tab does not submit or insert a literal tab', () => {
  const shellCtx = shell()
  const mock = lifecycleMock()
  const emitted: TuiInputIn01TerminalIntent[] = []
  const runtimeDeps = deps({
    shellCtx: shellCtx.ctx,
    lifecycle: mock.lifecycle,
    emit: event => emitted.push(event),
  })
  const controller = createTuiRuntimeController(runtimeDeps)
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  controller.start()

  mock.lifecycle.handler()(keyEvent('', { tab: true }))

  assert.deepEqual(emitted, [])
  assert.equal(runtimeDeps.composer.projectState().text, '')
})

test('Escape interrupts a selected locally-running turn before the remote running snapshot arrives', () => {
  const shellCtx = shell()
  const mock = lifecycleMock()
  let interrupts = 0
  const runtimeDeps = deps({
    shellCtx: shellCtx.ctx,
    lifecycle: mock.lifecycle,
    running: false,
    executionStatus: {
      project: () => ({ state: 'running', line: 'Running ·▸ 0:00 · Esc interrupt' }),
      interrupt: () => { interrupts += 1 },
    },
  })
  const controller = createTuiRuntimeController(runtimeDeps)
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  controller.start()

  mock.lifecycle.handler()(keyEvent('', { escape: true }))

  assert.equal(interrupts, 1)
})

test('Escape does not interrupt startup execution while no Session is selected', () => {
  const shellCtx = shell({ sessionSelected: false })
  const mock = lifecycleMock()
  let interrupts = 0
  const runtimeDeps = deps({
    shellCtx: shellCtx.ctx,
    lifecycle: mock.lifecycle,
    sessionSelected: () => false,
    executionStatus: {
      project: () => ({ state: 'running', line: 'Creating session ·▸ 0:00 · Esc interrupt' }),
      interrupt: () => { interrupts += 1 },
    },
  })
  const controller = createTuiRuntimeController(runtimeDeps)
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  controller.start()

  mock.lifecycle.handler()(keyEvent('', { escape: true }))

  assert.equal(interrupts, 0)
})

test('startup submit is retained and flushed exactly once after Session selection', async () => {
  let sessionSelected = false
  const shellCtx = shell({ sessionSelected: false })
  const mock = lifecycleMock()
  const emitted: TuiInputIn01TerminalIntent[] = []
  const runtimeDeps = deps({
    shellCtx: shellCtx.ctx,
    lifecycle: mock.lifecycle,
    sessionSelected: () => sessionSelected,
    emit: event => emitted.push(event),
  })
  const controller = createTuiRuntimeController(runtimeDeps)
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  controller.start()
  const handler = mock.lifecycle.handler()

  for (const character of 'startup-input') handler(keyEvent(character))
  handler(keyEvent('', { return: true }))

  assert.equal(runtimeDeps.composer.projectState().text, 'startup-input')
  assert.deepEqual(emitted, [])
  assert.deepEqual(mock.failures, [])

  sessionSelected = true
  controller.renderNow()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(submittedTexts(emitted), ['startup-input'])
  assert.equal(runtimeDeps.composer.projectState().text, '')

  controller.renderNow()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(submittedTexts(emitted), ['startup-input'])
})

test('repeated Enter before Session selection does not create duplicate submission or visible failure', async () => {
  let sessionSelected = false
  const shellCtx = shell({ sessionSelected: false })
  const mock = lifecycleMock()
  const emitted: TuiInputIn01TerminalIntent[] = []
  const runtimeDeps = deps({
    shellCtx: shellCtx.ctx,
    lifecycle: mock.lifecycle,
    sessionSelected: () => sessionSelected,
    emit: event => emitted.push(event),
  })
  const controller = createTuiRuntimeController(runtimeDeps)
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  controller.start()
  const handler = mock.lifecycle.handler()

  for (const character of 'not-ready') handler(keyEvent(character))
  handler(keyEvent('', { return: true }))
  handler(keyEvent('', { return: true }))
  assert.equal(runtimeDeps.composer.projectState().text, 'not-ready')
  assert.deepEqual(emitted, [])
  assert.deepEqual(mock.failures, [])

  sessionSelected = true
  controller.renderNow()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(submittedTexts(emitted), ['not-ready'])
})

test('PageUp loads older history only when the idle composer is empty', async () => {
  const shellCtx = shell()
  const mock = lifecycleMock()
  let loads = 0
  const runtimeDeps = deps({
    shellCtx: shellCtx.ctx,
    lifecycle: mock.lifecycle,
    loadOlder: async () => { loads += 1 },
  })
  const controller = createTuiRuntimeController(runtimeDeps)
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  controller.start()
  const handler = mock.lifecycle.handler()

  handler(keyEvent('', { pageUp: true }))
  await new Promise<void>(resolve => queueMicrotask(resolve))
  assert.equal(loads, 1)

  handler(keyEvent('x'))
  handler(keyEvent('', { pageUp: true }))
  assert.equal(loads, 1)
})

test('double Escape opens fork history and Enter forks from the selected user message', () => {
  const shellCtx = shell()
  const mock = lifecycleMock()
  const forked: number[] = []
  const runtimeDeps = deps({
    shellCtx: shellCtx.ctx,
    lifecycle: mock.lifecycle,
    forkSession: atSeq => forked.push(atSeq),
    presentationNodes: [
      { nodeId: 'user-1', kind: 'conversation.user', publicationRevision: 11, lifecycle: 'settled', value: { text: 'first request' } },
      { nodeId: 'user-2', kind: 'conversation.user', publicationRevision: 24, lifecycle: 'settled', value: { text: 'second request' } },
    ],
  })
  const controller = createTuiRuntimeController(runtimeDeps)
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  controller.start()

  controller.handleTerminalEvent(keyEvent('', { escape: true }))
  controller.handleTerminalEvent(keyEvent('', { escape: true }))
  const forkOverlay = runtimeDeps.overlayManager.projectState()
  assert.equal(forkOverlay.kind, 'view')
  if (forkOverlay.kind === 'view') assert.equal(forkOverlay.view.kind, 'selector.fork-history')

  controller.handleTerminalEvent(keyEvent('', { upArrow: true }))
  controller.handleTerminalEvent(keyEvent('', { return: true }))
  assert.deepEqual(forked, [11])
})

test('double Escape does not enter fork history while composing input', () => {
  const shellCtx = shell()
  const mock = lifecycleMock()
  const runtimeDeps = deps({
    shellCtx: shellCtx.ctx,
    lifecycle: mock.lifecycle,
    presentationNodes: [
      { nodeId: 'user-1', kind: 'conversation.user', publicationRevision: 11, lifecycle: 'settled', value: { text: 'first request' } },
    ],
  })
  const controller = createTuiRuntimeController(runtimeDeps)
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  controller.start()

  controller.handleTerminalEvent(keyEvent('draft'))
  controller.handleTerminalEvent(keyEvent('', { escape: true }))
  controller.handleTerminalEvent(keyEvent('', { escape: true }))

  const overlay = runtimeDeps.overlayManager.projectState()
  assert.notEqual(overlay.kind, 'view')
  if (overlay.kind === 'view') assert.notEqual(overlay.view.kind, 'selector.fork-history')
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

  const unselectedShell = shell({ sessionSelected: false })
  unselectedShell.ctx.tuiShell.dispatch(appEvent({ kind: 'terminal.command', sourceId: 'composer.editor', input: '/quit' }))
  assert.deepEqual(unselectedShell.commands, ['/quit'])

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

test('Ctrl+C exits the UI without clearing input or cancelling the agent', () => {
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
  assert.equal(runtimeDeps.composer.projectState().text, 'h')
  assert.deepEqual(emitted, [])
  assert.deepEqual(mock.exits, ['ctrl-c'])
})

test('running Ctrl+C exits the UI without cancelling the active turn', () => {
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
  assert.deepEqual(emitted, [])
  assert.deepEqual(mock.exits, ['ctrl-c'])
})

test('history keys select submitted prompts at the start and move within multiline input', async () => {
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
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.ok(mock.rendered.length > initialRenderCount)
})

test('installed input handler returns before its render work completes', async () => {
  const shellCtx = shell().ctx
  const mock = lifecycleMock()
  const runtimeDeps = deps({ shellCtx, lifecycle: mock.lifecycle })
  const controller = createTuiRuntimeController(runtimeDeps)
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  controller.start()
  const initialRenderCount = mock.rendered.length
  const handler = mock.lifecycle.handler()

  handler(keyEvent('first'))
  handler(keyEvent('second'))

  assert.equal(runtimeDeps.composer.projectState().text, 'firstsecond')
  assert.equal(mock.rendered.length, initialRenderCount)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(mock.rendered.length, initialRenderCount + 1)
})

test('Ctrl+C exits immediately while idle', () => {
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
  handler(keyEvent('c', { ctrl: true }))
  assert.deepEqual(mock.exits, ['ctrl-c'])
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
