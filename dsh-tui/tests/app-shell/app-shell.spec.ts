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

function deps(options: {
  shellCtx: ReturnType<typeof shell>['ctx']
  lifecycle: ReturnType<typeof lifecycleMock>['lifecycle']
  projectResult?: any
  composeResult?: any
  realizeResult?: any
  layout?: 'default' | 'compact'
  running?: boolean
  emit?: (event: TuiInputIn01TerminalIntent) => void
}): TuiRuntimeDeps {
  return {
    getSnapshot: () => ({ sessionId: 'session-1', cwd: '/workspace', running: options.running ?? false }),
    getPresentation: () => ({ nodes: [], publicationRevision: 1 }),
    refresh: options.shellCtx.tuiRefreshOrchestrator,
    shell: options.shellCtx.tuiShell,
    appContainer: {
      layout: options.layout ?? 'default',
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
    lifecycle: options.lifecycle,
    focus: {
      shouldExitOnCtrlD: () => false,
      shouldExitOnKey: () => false,
      pushView: () => () => undefined,
    },
    emitEvent: options.emit ?? (() => undefined),
  }
}

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

test('input handler submits prompts and ctrl-c exits only when idle', () => {
  const emitted: TuiInputIn01TerminalIntent[] = []
  const shellCtx = shell({ sessionRunning: true }).ctx
  const mock = lifecycleMock()
  const controller = createTuiRuntimeController(deps({
    shellCtx,
    lifecycle: mock.lifecycle,
    running: true,
    emit: event => emitted.push(event),
  }))
  controller.installInputHandler()
  controller.storeViewport(Object.freeze({ columns: 80, rows: 24 }))
  const handler = mock.lifecycle.handler()
  handler(keyEvent('h'))
  handler(keyEvent('', { return: true }))
  assert.equal(emitted.at(-1)?.kind, 'terminal.submit')
  handler(keyEvent('c', { ctrl: true }))
  assert.deepEqual(mock.exits, [])
  assert.equal(mock.calls.at(-1), 'render')
})
