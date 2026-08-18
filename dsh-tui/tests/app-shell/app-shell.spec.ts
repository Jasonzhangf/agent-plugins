import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  type BusinessAction,
  type TuiShellPolicy,
} from '../../playground/experiments/app-shell/src/app-shell.ts'

function shellContext(policy: Partial<TuiShellPolicy> = {}): { ctx: Context; actions: BusinessAction[] } {
  const ctx = new Context()
  const actions: BusinessAction[] = []
  apply(ctx, {
    policy: {
      composerEmpty: true,
      sessionRunning: false,
      sessionSelected: true,
      ...policy,
    },
    dispatch(action) {
      actions.push(action)
    },
  })
  return { ctx, actions }
}

test('submits a typed prompt action through the public shell policy', () => {
  const { ctx, actions } = shellContext()
  ctx.tuiShell.dispatch({
    kind: 'terminal.submit',
    sourceId: 'composer.editor',
    text: 'hello',
  })
  assert.equal(actions.length, 1)
  assert.deepEqual(actions[0], {
    kind: 'session.prompt',
    actionId: 'a1',
    text: 'hello',
  })
})

test('cancel maps to the current selected Session and never includes control fields', () => {
  const { ctx, actions } = shellContext({ sessionRunning: true })
  ctx.tuiShell.dispatch({
    kind: 'terminal.cancel',
    sourceId: 'composer.editor',
  })
  assert.equal(actions.length, 1)
  assert.deepEqual(actions[0], { kind: 'session.cancel', actionId: 'a1' })
})

test('rejects unknown intent families and control-smuggling fields', () => {
  const { ctx, actions } = shellContext()
  assert.throws(() => ctx.tuiShell.dispatch({
    kind: 'terminal.command',
    sourceId: 'composer.editor',
    input: '/resume',
  }), /terminal.command|pending/)
  assert.equal(actions.length, 0)
})

test('approval and question resolve to typed responder actions', () => {
  const { ctx, actions } = shellContext()
  ctx.tuiShell.dispatch({
    kind: 'interaction.approval',
    sourceId: 'interaction.approval',
    decision: true,
    payload: { approvalId: 'appr-1' },
  })
  ctx.tuiShell.dispatch({
    kind: 'interaction.question',
    sourceId: 'interaction.question',
    answer: 'yes',
    payload: { questionId: 'q-1' },
  })
  assert.deepEqual(actions, [
    { kind: 'interaction.respond', actionId: 'a1', decision: true, payload: { approvalId: 'appr-1' } },
    { kind: 'interaction.respond', actionId: 'a2', answer: 'yes', payload: { questionId: 'q-1' } },
  ])
})

test('resize is control state and never becomes a business action', () => {
  const { ctx, actions } = shellContext()
  assert.throws(() => ctx.tuiShell.dispatch({
    kind: 'terminal.resize',
    sourceId: 'terminal-lifecycle',
    size: { columns: 80, rows: 24 },
  }), /terminal.resize|control/)
  assert.equal(actions.length, 0)
})

test('submit fails closed when no Session is selected', () => {
  const { ctx, actions } = shellContext({ sessionSelected: false })
  assert.throws(() => ctx.tuiShell.dispatch({
    kind: 'terminal.submit',
    sourceId: 'composer.editor',
    text: 'hello',
  }), /no Session/)
  assert.equal(actions.length, 0)
})

test('cancel fails closed when Session is not running', () => {
  const { ctx, actions } = shellContext({ sessionRunning: false })
  assert.throws(() => ctx.tuiShell.dispatch({
    kind: 'terminal.cancel',
    sourceId: 'composer.editor',
  }), /not running/)
  assert.equal(actions.length, 0)
})

test('Ctrl+D exit decision is policy-owned and remains control state', () => {
  const { ctx, actions } = shellContext()
  assert.equal(ctx.tuiShell.canExit({ empty: true, running: false }), true)
  assert.equal(ctx.tuiShell.canExit({ empty: false, running: false }), false)
  assert.equal(actions.length, 0)
})
