import assert from 'node:assert/strict'
import test from 'node:test'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { TuiInputIn02AppEvent } from '../../playground/experiments/app-event-bus/src/app-event-bus.ts'
import { apply as applyEventBus } from '../../playground/experiments/app-event-bus/src/app-event-bus.ts'
import {
  apply,
  createTuiRuntimeController,
  type TuiInputIn03BusinessAction,
  type TuiRuntimeTerminalEvent,
  type TuiShellPolicy,
} from '../../playground/experiments/app-shell/src/app-shell.ts'
import {
  installLogicControlComposition,
  wireLogicControlEvents,
} from '../../playground/experiments/startup/src/startup.ts'
import { exitCodeForTuiStartupOutcome, type TuiStartupOutcome } from '../../playground/experiments/startup/src/startup.ts'
import type {
  TuiTerminalCompositionResult,
  TuiTerminalComposerState,
  TuiTerminalLocalEchoState,
  TuiTerminalStatusState,
} from '../../contracts/tui/terminal-ui/terminal-shell.types.ts'
import { apply as applyTerminalLifecycle, type InkRenderFactory, type TuiTerminalLifecycle } from '../../playground/experiments/terminal-lifecycle/src/terminal-lifecycle.ts'
import { projectSlashCommand } from '../../playground/experiments/app-event-bus/src/app-event-bus.ts'

function appEvent(intent: TuiInputIn02AppEvent['intent']): TuiInputIn02AppEvent {
  return { eventId: 'event-1', acceptedAt: 1234, intent }
}

function shellContext(policy: Partial<TuiShellPolicy> = {}): {
  ctx: Context
  actions: TuiInputIn03BusinessAction[]
  commands: string[]
} {
  const ctx = new Context()
  const actions: TuiInputIn03BusinessAction[] = []
  const commands: string[] = []
  apply(ctx, {
    policy: {
      composerEmpty: true,
      sessionRunning: false,
      sessionSelected: true,
      ...policy,
    },
    dispatchBusiness(action) {
      actions.push(action)
    },
    dispatchControl(action) {
      commands.push(action.input)
    },
  })
  return { ctx, actions, commands }
}

function lifecycleFactory(): { factory: InkRenderFactory; calls: () => number; unmounts: () => number } {
  let calls = 0
  let unmounts = 0
  const instance = {
    rerender: () => undefined,
    unmount: () => { unmounts += 1 },
    waitUntilRenderFlush: async () => undefined,
    cleanup: () => undefined,
  }
  const factory: InkRenderFactory = () => {
    calls += 1
    return instance
  }
  return { factory, calls: () => calls, unmounts: () => unmounts }
}

function streams() {
  return {
    stdout: new PassThrough() as unknown as NodeJS.WriteStream,
    stdin: new PassThrough() as unknown as NodeJS.ReadStream,
    stderr: new PassThrough() as unknown as NodeJS.WriteStream,
  }
}

function fakeComposition(input: {
  model: { readonly publicationRevision: number }
  composer: TuiTerminalComposerState
  status: TuiTerminalStatusState
  width: number
  scrollOffset: number
  localEchoes: readonly TuiTerminalLocalEchoState[]
}): TuiTerminalCompositionResult {
  return {
    ok: true,
    value: {
      nodeId: 'tui.shell',
      kind: 'tui.shell',
      publicationRevision: input.model.publicationRevision,
      lifecycle: 'settled',
      descriptor: {
        contract: 'tui.terminal-shell.v1',
        width: input.width,
        scrollOffset: input.scrollOffset,
        transcript: [],
        localEchoes: input.localEchoes,
        composer: input.composer,
        status: input.status,
      },
    },
  }
}

test('submits a typed prompt action through the public shell policy', () => {
  const { ctx, actions } = shellContext()
  ctx.tuiShell.dispatch(appEvent({
    kind: 'terminal.submit',
    sourceId: 'composer.editor',
    text: 'hello',
  }))
  assert.equal(actions.length, 1)
  assert.deepEqual(actions[0], {
    kind: 'session.prompt',
    actionId: 'a1',
    text: 'hello',
  })
})

test('cancel maps to the current selected Session and never includes control fields', () => {
  const { ctx, actions } = shellContext({ sessionRunning: true })
  ctx.tuiShell.dispatch(appEvent({
    kind: 'terminal.cancel',
    sourceId: 'composer.editor',
  }))
  assert.equal(actions.length, 1)
  assert.deepEqual(actions[0], { kind: 'session.cancel', actionId: 'a1' })
})

test('rejects unknown intent families and control-smuggling fields', () => {
  const { ctx, actions } = shellContext()
  // rpcId is a forbidden control field nested in payload
  assert.throws(() => ctx.tuiShell.dispatch(appEvent({
    kind: 'interaction.approval',
    sourceId: 'interaction.approval',
    decision: true,
    payload: { rpcId: 'fake', endpoint: 'http://evil' },
  })), /forbidden/)
  assert.equal(actions.length, 0)
})

test('approval and question resolve to typed responder actions', () => {
  const { ctx, actions } = shellContext()
  ctx.tuiShell.dispatch(appEvent({
    kind: 'interaction.approval',
    sourceId: 'interaction.approval',
    decision: true,
    payload: { interactionId: 'approval:appr-1' },
  }))
  ctx.tuiShell.dispatch(appEvent({
    kind: 'interaction.question',
    sourceId: 'interaction.question',
    answer: 'yes',
    payload: { interactionId: 'question:q-1' },
  }))
  assert.deepEqual(actions, [
    { kind: 'interaction.approval.respond', actionId: 'a1', interactionId: 'approval:appr-1', decision: true },
    { kind: 'interaction.question.respond', actionId: 'a2', interactionId: 'question:q-1', answer: 'yes' },
  ])
})

test('resize is control state and never becomes a business action', () => {
  const { ctx, actions } = shellContext()
  assert.throws(() => ctx.tuiShell.dispatch(appEvent({
    kind: 'terminal.resize',
    sourceId: 'terminal-lifecycle',
    size: { columns: 80, rows: 24 },
  })), /terminal.resize|control/)
  assert.equal(actions.length, 0)
})

test('submit fails closed when no Session is selected', () => {
  const { ctx, actions } = shellContext({ sessionSelected: false })
  assert.throws(() => ctx.tuiShell.dispatch(appEvent({
    kind: 'terminal.submit',
    sourceId: 'composer.editor',
    text: 'hello',
  })), /no Session/)
  assert.equal(actions.length, 0)
})

test('cancel fails closed when Session is not running', () => {
  const { ctx, actions } = shellContext({ sessionRunning: false })
  assert.throws(() => ctx.tuiShell.dispatch(appEvent({
    kind: 'terminal.cancel',
    sourceId: 'composer.editor',
  })), /not running/)
  assert.equal(actions.length, 0)
})

test('Ctrl+D exit decision is policy-owned and remains control state', () => {
  const { ctx, actions } = shellContext()
  assert.equal(ctx.tuiShell.canExit({ empty: true, running: false }), true)
  assert.equal(ctx.tuiShell.canExit({ empty: false, running: false }), false)
  assert.equal(actions.length, 0)
})

test('slash commands remain on the control side-channel', () => {
  const { ctx, actions, commands } = shellContext()
  ctx.tuiShell.dispatch(appEvent({
    kind: 'terminal.command',
    sourceId: 'composer.editor',
    input: '/resume session-b',
  }))
  assert.deepEqual(commands, ['/resume session-b'])
  assert.deepEqual(actions, [])
})

test('app-shell accepts only the canonical AppEvent envelope', () => {
  const { ctx, actions } = shellContext()
  assert.throws(() => ctx.tuiShell.dispatch({
    eventId: 'event-1',
    acceptedAt: 1234,
    intent: {
      kind: 'terminal.submit',
      sourceId: 'composer.editor',
      text: 'hello',
    },
    endpoint: 'http://127.0.0.1:3080',
  } as never), /AppEvent|field/)
  assert.equal(actions.length, 0)
})

test('startup composition installs source-owned logic controls and projects typed state', () => {
  const ctx = new Context()
  const sources = installLogicControlComposition(ctx)
  assert.deepEqual(ctx.tuiLogicControls.list(), [
    'input', 'status', 'connection', 'execution', 'session', 'slash-command', 'logo',
  ])
  sources.input.dispatch({ control: 'input', action: 'submit', text: 'hello' })
  sources.session.dispatch({
    control: 'session',
    action: 'snapshot',
    selectedSessionId: 'session-a',
    availableSessionIds: ['session-a'],
    cwd: '/workspace',
    lifecycle: 'active',
  })
  sources.status.dispatch({
    control: 'status',
    action: 'set',
    sessionId: 'session-a',
    cwd: '/workspace',
    mode: 'idle',
  })
  assert.equal(ctx.tuiLogicControls.project('input').control, 'input')
  const sessionProjection = ctx.tuiLogicControls.project('session')
  const statusProjection = ctx.tuiLogicControls.project('status')
  assert.equal(sessionProjection.control, 'session')
  assert.equal(statusProjection.control, 'status')
  if (sessionProjection.control !== 'session' || statusProjection.control !== 'status') throw new Error('unexpected control projection')
  assert.equal(sessionProjection.selectedSessionId, 'session-a')
  assert.equal(statusProjection.cwd, '/workspace')
  assert.throws(() => sources.status.dispatch({ control: 'input', action: 'edit', text: 'x', cursor: 1 }), /not owned by source resource/)
})

test('startup keeps slash command parsing on the control side-channel', () => {
  assert.deepEqual(projectSlashCommand('/resume session-a'), {
    command: '/resume',
    args: ['session-a'],
  })
  assert.equal(projectSlashCommand('plain text'), null)
})

test('startup event wiring projects only accepted terminal commands after shell validation', () => {
  const ctx = new Context()
  const received: TuiInputIn03BusinessAction[] = []
  applyEventBus(ctx)
  apply(ctx, {
    policy: { composerEmpty: true, sessionRunning: false, sessionSelected: true },
    dispatchBusiness: action => received.push(action),
    dispatchControl: () => undefined,
  })
  const sources = installLogicControlComposition(ctx)
  const dispose = wireLogicControlEvents(ctx, sources)
  ctx.tuiEventBus.publish({ kind: 'terminal.submit', sourceId: 'composer.editor', text: 'hello' })
  ctx.tuiEventBus.publish({ kind: 'terminal.command', sourceId: 'composer.editor', input: '/resume session-a' })
  const acceptedProjection = ctx.tuiLogicControls.project('slash-command')
  ctx.tuiEventBus.publish({ kind: 'terminal.command', sourceId: 'composer.editor', input: '/unknown' })
  dispose()
  assert.deepEqual(received, [{ kind: 'session.prompt', actionId: 'a1', text: 'hello' }])
  assert.deepEqual(ctx.tuiLogicControls.project('input'), {
    control: 'input', stableKey: 'control.input', text: '', cursor: 0, mode: 'submitted', revision: 2,
  })
  assert.deepEqual(ctx.tuiLogicControls.project('slash-command'), {
    control: 'slash-command', stableKey: 'control.slash-command', input: '/resume session-a', command: '/resume', args: ['session-a'], accepted: true, revision: 3,
  })
  assert.deepEqual(ctx.tuiLogicControls.project('slash-command'), acceptedProjection)
})

function keyEvent(input: string, partial: Partial<Extract<TuiRuntimeTerminalEvent, { type: 'key' }>['key']> = {}): TuiRuntimeTerminalEvent {
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

test('runtime keeps q in the focused composer and reports async failures in status', () => {
  const { ctx } = shellContext()
  const exits: string[] = []
  const statuses: Array<{ mode: string; message?: string }> = []
  const controller = createTuiRuntimeController({
    getSnapshot: () => ({ sessionId: 'session-1', cwd: '/workspace', running: false }),
    getPresentation: () => ({ nodes: [], publicationRevision: 1 }),
    shell: ctx.tuiShell,
    ui: {
      composeInkTreeSafe(input) {
        statuses.push(input.status)
        return fakeComposition(input)
      },
    },
    lifecycle: {
      state: () => 'active',
      setInputHandler: () => undefined,
      renderWithCompose: compose => { compose() },
      enter: () => undefined,
      exit: reason => exits.push(reason.reason),
    },
    focus: {
      shouldExitOnCtrlD: () => false,
      shouldExitOnKey: () => false,
      pushView: () => () => undefined,
    },
    emitEvent: () => undefined,
  })

  controller.start()
  controller.handleTerminalEvent(keyEvent('q'))
  assert.deepEqual(exits, [])
  controller.reportError('prompt failed: offline')
  assert.equal(statuses.at(-1)?.mode, 'error')
  assert.equal(statuses.at(-1)?.message, 'prompt failed: offline')
})

test('runtime overlay owns keys, restores composer, and selects exactly one item', () => {
  const { ctx } = shellContext()
  const overlays: Array<{ view: string; selectedIndex: number } | undefined> = []
  const selected: number[] = []
  const focusTransitions: string[] = []
  const controller = createTuiRuntimeController({
    getSnapshot: () => ({ sessionId: 'session-1', cwd: '/workspace', running: false }),
    getPresentation: () => ({ nodes: [], publicationRevision: 1 }),
    shell: ctx.tuiShell,
    ui: {
      composeInkTreeSafe(input) {
        overlays.push(input.overlay)
        return fakeComposition(input)
      },
    },
    lifecycle: {
      state: () => 'active',
      setInputHandler: () => undefined,
      renderWithCompose: compose => { compose() },
      enter: () => undefined,
      exit: () => assert.fail('overlay q must not exit the TUI'),
    },
    focus: {
      shouldExitOnCtrlD: () => false,
      shouldExitOnKey: () => false,
      pushView(view) {
        focusTransitions.push(`open:${view}`)
        return () => focusTransitions.push(`close:${view}`)
      },
    },
    emitEvent: () => undefined,
  })

  controller.start()
  controller.openOverlay({
    view: 'selector.resume-current-cwd',
    title: 'Resume current cwd',
    items: ['session-a', 'session-b'],
  }, index => selected.push(index))
  controller.handleTerminalEvent(keyEvent('', { downArrow: true }))
  controller.handleTerminalEvent(keyEvent('x'))
  controller.handleTerminalEvent(keyEvent('', { return: true }))

  assert.equal(overlays.at(-2)?.selectedIndex, 1)
  assert.equal(overlays.at(-1), undefined)
  assert.deepEqual(selected, [1])
  assert.deepEqual(focusTransitions, [
    'open:selector.resume-current-cwd',
    'close:selector.resume-current-cwd',
  ])
})

test('runtime help overlay closes on q without exiting or submitting hidden input', () => {
  const { ctx } = shellContext()
  const emitted: unknown[] = []
  const controller = createTuiRuntimeController({
    getSnapshot: () => ({ sessionId: 'session-1', cwd: '/workspace', running: false }),
    getPresentation: () => ({ nodes: [], publicationRevision: 1 }),
    shell: ctx.tuiShell,
    ui: {
      composeInkTreeSafe(input) {
        return fakeComposition(input)
      },
    },
    lifecycle: {
      state: () => 'active',
      setInputHandler: () => undefined,
      renderWithCompose: compose => { compose() },
      enter: () => undefined,
      exit: () => assert.fail('help q must close only the overlay'),
    },
    focus: {
      shouldExitOnCtrlD: () => false,
      shouldExitOnKey: () => false,
      pushView: () => () => undefined,
    },
    emitEvent: event => emitted.push(event),
  })

  controller.start()
  controller.openOverlay({ view: 'overlay.help', title: 'Help', items: ['/quit', '/resume'] })
  controller.handleTerminalEvent(keyEvent('q'))
  controller.handleTerminalEvent(keyEvent('', { return: true }))
  assert.deepEqual(emitted, [])
})

test('runtime projects local echo pending, converges on newer official user event, and exposes failure', () => {
  const { ctx } = shellContext()
  let model = { nodes: [] as Array<{ nodeId: string; kind: string; publicationRevision: number; lifecycle: 'settled'; value: { text: string } }>, publicationRevision: 1 }
  const echoes: Array<readonly { text: string; state: string }[]> = []
  const controller = createTuiRuntimeController({
    getSnapshot: () => ({ sessionId: 'session-1', cwd: '/workspace', running: false }),
    getPresentation: () => model,
    shell: ctx.tuiShell,
    ui: {
      composeInkTreeSafe(input) {
        echoes.push(input.localEchoes)
        return fakeComposition(input)
      },
    },
    lifecycle: {
      state: () => 'active', setInputHandler: () => undefined, renderWithCompose: compose => { compose() },
      enter: () => undefined, exit: () => undefined,
    },
    focus: {
      shouldExitOnCtrlD: () => false, shouldExitOnKey: () => false,
      pushView: () => () => undefined,
    },
    emitEvent: () => undefined,
  })

  controller.start()
  controller.handleTerminalEvent(keyEvent('hello'))
  controller.handleTerminalEvent(keyEvent('', { return: true }))
  assert.deepEqual(echoes.at(-1)?.map(echo => ({ text: echo.text, state: echo.state })), [
    { text: 'hello', state: 'pending' },
  ])

  model = {
    publicationRevision: 2,
    nodes: [{ nodeId: 'official-user-2', kind: 'conversation.user', publicationRevision: 2, lifecycle: 'settled', value: { text: 'hello' } }],
  }
  controller.render()
  assert.deepEqual(echoes.at(-1), [])

  controller.handleTerminalEvent(keyEvent('will fail'))
  controller.handleTerminalEvent(keyEvent('', { return: true }))
  controller.reportSubmissionError('prompt failed: quota')
  assert.deepEqual(echoes.at(-1)?.map(echo => ({ text: echo.text, state: echo.state })), [
    { text: 'will fail', state: 'failed' },
  ])
})

test('runtime edits multiline input, resizes, scrolls, and routes running Ctrl+C to cancel', () => {
  const { ctx } = shellContext({ sessionRunning: true })
  const frames: Array<{ text: string; cursor: number; width: number; scrollOffset: number }> = []
  const emitted: unknown[] = []
  const exits: string[] = []
  const controller = createTuiRuntimeController({
    getSnapshot: () => ({ sessionId: 'session-1', cwd: '/workspace', running: true }),
    getPresentation: () => ({ nodes: [], publicationRevision: 1 }),
    shell: ctx.tuiShell,
    ui: {
      composeInkTreeSafe(input) {
        frames.push({ text: input.composer.text, cursor: input.composer.cursor, width: input.width, scrollOffset: input.scrollOffset })
        return fakeComposition(input)
      },
    },
    lifecycle: {
      state: () => 'active', setInputHandler: () => undefined, renderWithCompose: compose => { compose() },
      enter: () => undefined, exit: reason => exits.push(reason.reason),
    },
    focus: {
      shouldExitOnCtrlD: () => false, shouldExitOnKey: () => false,
      pushView: () => () => undefined,
    },
    emitEvent: event => emitted.push(event),
  })

  controller.start()
  controller.handleTerminalEvent(keyEvent('ab'))
  controller.handleTerminalEvent(keyEvent('', { leftArrow: true }))
  controller.handleTerminalEvent(keyEvent('X'))
  controller.handleTerminalEvent(keyEvent('', { return: true, shift: true }))
  controller.handleTerminalEvent(keyEvent('c'))
  controller.handleTerminalEvent({ type: 'resize', columns: 100, rows: 30 })
  controller.handleTerminalEvent(keyEvent('', { pageUp: true }))
  assert.deepEqual(frames.at(-1), { text: 'aX\ncb', cursor: 4, width: 100, scrollOffset: 5 })
  controller.handleTerminalEvent(keyEvent('', { pageDown: true }))
  controller.handleTerminalEvent(keyEvent('c', { ctrl: true }))
  assert.deepEqual(emitted.at(-1), { kind: 'terminal.cancel', sourceId: 'composer.editor' })
  assert.deepEqual(exits, [])
})

test('idle Ctrl+C exits without dispatching cancel', () => {
  const { ctx } = shellContext({ sessionRunning: false })
  const emitted: unknown[] = []
  const exits: string[] = []
  const controller = createTuiRuntimeController({
    getSnapshot: () => ({ sessionId: 'session-1', cwd: '/workspace', running: false }),
    getPresentation: () => ({ nodes: [], publicationRevision: 1 }),
    shell: ctx.tuiShell,
    ui: { composeInkTreeSafe: input => fakeComposition(input) },
    lifecycle: {
      state: () => 'active', setInputHandler: () => undefined, renderWithCompose: compose => { compose() },
      enter: () => undefined, exit: reason => exits.push(reason.reason),
    },
    focus: {
      shouldExitOnCtrlD: () => false, shouldExitOnKey: () => false,
      pushView: () => () => undefined,
    },
    emitEvent: event => emitted.push(event),
  })
  controller.start()
  controller.handleTerminalEvent(keyEvent('c', { ctrl: true }))
  assert.deepEqual(exits, ['ctrl-c'])
  assert.deepEqual(emitted, [])
})

test('runtime rejects malformed resize control before mutating viewport state', () => {
  const { ctx } = shellContext()
  const widths: number[] = []
  const controller = createTuiRuntimeController({
    getSnapshot: () => ({ sessionId: 'session-1', cwd: '/workspace', running: false }),
    getPresentation: () => ({ nodes: [], publicationRevision: 1 }),
    shell: ctx.tuiShell,
    ui: {
      composeInkTreeSafe(input) {
        widths.push(input.width)
        return fakeComposition(input)
      },
    },
    lifecycle: {
      state: () => 'active', setInputHandler: () => undefined, renderWithCompose: compose => { compose() },
      enter: () => undefined, exit: () => undefined,
    },
    focus: {
      shouldExitOnCtrlD: () => false, shouldExitOnKey: () => false,
      pushView: () => () => undefined,
    },
    emitEvent: () => undefined,
  })
  controller.start()

  assert.throws(
    () => controller.handleTerminalEvent({ type: 'resize', columns: 0, rows: 24 }),
    /positive integer columns and rows/,
  )
  assert.deepEqual(widths, [80])
})

test('composition failures preserve cause through terminal failure, startup outcome, and exit code', async () => {
  const ctx = new Context()
  const recording = lifecycleFactory()
  applyTerminalLifecycle(ctx, { factory: recording.factory })
  apply(ctx, {
    policy: { composerEmpty: true, sessionRunning: false, sessionSelected: true },
    dispatchBusiness() { return undefined },
    dispatchControl() { return undefined },
  })
  const lifecycle = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  lifecycle.enter(streams())
  let shouldFail = false

  let outcome!: TuiStartupOutcome
  const exited = new Promise<TuiStartupOutcome>(resolve => {
    lifecycle.subscribe(state => {
      if (state === 'failed') resolve({ state: 'failed', error: lifecycle.failure()! })
      if (state === 'exited') resolve({ state: 'exited' })
    })
  })
  const originalCause = new TypeError('canonical model contract')
  const controller = createTuiRuntimeController({
    getSnapshot: () => ({ sessionId: 'session-1', cwd: '/workspace', running: false }),
    getPresentation: () => ({ nodes: [], publicationRevision: 1 }),
    shell: ctx.tuiShell,
    ui: {
      composeInkTreeSafe: () => shouldFail ? ({
        ok: false as const,
        error: { code: 'invalid-model' as const, message: 'terminal-ui rejected the model', cause: originalCause },
      }) : fakeComposition({
        model: { publicationRevision: 1 },
        composer: { text: '', cursor: 0, lines: [''], cursorLine: 0, cursorColumn: 0, mode: 'idle' },
        status: { sessionId: 'session-1', cwd: '/workspace', mode: 'idle', publicationRevision: 1 },
        width: 80,
        scrollOffset: 0,
        localEchoes: [],
      }),
    },
    lifecycle,
    focus: { shouldExitOnCtrlD: () => false, shouldExitOnKey: () => false, pushView: () => () => undefined },
    emitEvent: () => undefined,
  })
  controller.start()
  assert.equal(recording.calls(), 1)
  shouldFail = true
  controller.render()
  outcome = await exited

  assert.equal(lifecycle.state(), 'failed')
  assert.equal(recording.unmounts(), 1)
  assert.equal(outcome.state, 'failed')
  if (outcome.state === 'failed') assert.equal(outcome.error.cause, originalCause)
  assert.equal(exitCodeForTuiStartupOutcome(outcome), 1)
})

test('successful composition remains mounted and maps normal exit to zero', async () => {
  const ctx = new Context()
  const recording = lifecycleFactory()
  applyTerminalLifecycle(ctx, { factory: recording.factory })
  apply(ctx, {
    policy: { composerEmpty: true, sessionRunning: false, sessionSelected: true },
    dispatchBusiness() { return undefined },
    dispatchControl() { return undefined },
  })
  const lifecycle = ctx['tuiTerminalLifecycle'] as TuiTerminalLifecycle
  lifecycle.enter(streams())

  let outcome!: TuiStartupOutcome
  const exited = new Promise<TuiStartupOutcome>(resolve => {
    lifecycle.subscribe(state => {
      if (state === 'failed') resolve({ state: 'failed', error: lifecycle.failure()! })
      if (state === 'exited') resolve({ state: 'exited' })
    })
  })
  const controller = createTuiRuntimeController({
    getSnapshot: () => ({ sessionId: 'session-1', cwd: '/workspace', running: false }),
    getPresentation: () => ({ nodes: [], publicationRevision: 1 }),
    shell: ctx.tuiShell,
    ui: {
      composeInkTreeSafe: input => ({
        ...fakeComposition(input),
      }),
    },
    lifecycle,
    focus: { shouldExitOnCtrlD: () => false, shouldExitOnKey: () => false, pushView: () => () => undefined },
    emitEvent: () => undefined,
  })
  controller.start()
  controller.render()
  assert.equal(lifecycle.state(), 'active')
  assert.equal(recording.calls(), 1)

  lifecycle.exit({ reason: 'normal-exit' })
  outcome = await exited
  assert.deepEqual(outcome, { state: 'exited' })
  assert.equal(exitCodeForTuiStartupOutcome(outcome), 0)
})
