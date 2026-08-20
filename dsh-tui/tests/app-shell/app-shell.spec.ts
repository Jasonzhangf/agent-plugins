import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { TuiInputIn02AppEvent } from '../../playground/experiments/app-event-bus/src/app-event-bus.ts'
import {
  apply,
  createTuiRuntimeController,
  type TuiInputIn03BusinessAction,
  type TuiRuntimeTerminalEvent,
  type TuiShellPolicy,
} from '../../playground/experiments/app-shell/src/app-shell.ts'

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
      composeInkTree(input) {
        statuses.push(input.status)
        return { publicationRevision: input.model.publicationRevision, descriptor: {} }
      },
    },
    lifecycle: {
      state: () => 'active',
      setInputHandler: () => undefined,
      render: () => undefined,
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
      composeInkTree(input) {
        overlays.push(input.overlay)
        return { publicationRevision: input.model.publicationRevision, descriptor: {} }
      },
    },
    lifecycle: {
      state: () => 'active',
      setInputHandler: () => undefined,
      render: () => undefined,
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
      composeInkTree(input) {
        return { publicationRevision: input.model.publicationRevision, descriptor: input.overlay ?? {} }
      },
    },
    lifecycle: {
      state: () => 'active',
      setInputHandler: () => undefined,
      render: () => undefined,
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
      composeInkTree(input) {
        echoes.push(input.localEchoes)
        return { publicationRevision: input.model.publicationRevision, descriptor: {} }
      },
    },
    lifecycle: {
      state: () => 'active', setInputHandler: () => undefined, render: () => undefined,
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
      composeInkTree(input) {
        frames.push({ text: input.composer.text, cursor: input.composer.cursor, width: input.width, scrollOffset: input.scrollOffset })
        return { publicationRevision: input.model.publicationRevision, descriptor: {} }
      },
    },
    lifecycle: {
      state: () => 'active', setInputHandler: () => undefined, render: () => undefined,
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
    ui: { composeInkTree: input => ({ publicationRevision: input.model.publicationRevision, descriptor: {} }) },
    lifecycle: {
      state: () => 'active', setInputHandler: () => undefined, render: () => undefined,
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
      composeInkTree(input) {
        widths.push(input.width)
        return { publicationRevision: input.model.publicationRevision, descriptor: {} }
      },
    },
    lifecycle: {
      state: () => 'active', setInputHandler: () => undefined, render: () => undefined,
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
