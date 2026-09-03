import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  type TuiFocusManager,
} from '../../src/experiments/focus-manager/src/focus-manager.ts'
import { TUI_FOCUS_VIEWS } from '../../contracts/tui/focus-manager/focus-manager.types.ts'

function install(): { ctx: Context; focus: TuiFocusManager } {
  const ctx = new Context()
  apply(ctx)
  return { ctx, focus: ctx.tuiFocusManager }
}

test('defaults to composer.editor with focused cursor', () => {
  const { focus } = install()
  const view = focus.viewState()
  assert.equal(view.activeView, 'composer.editor')
  assert.equal(view.focusOwner, 'composer.editor')
  assert.equal(view.priority, 'composer')
})

test('push/pop restores previous focus owner', () => {
  const { focus } = install()
  const first = focus.pushView('composer.queue')
  assert.equal(focus.viewState().activeView, 'composer.queue')
  const second = focus.pushView('interaction.approval')
  assert.equal(focus.viewState().activeView, 'interaction.approval')
  second()
  assert.equal(focus.viewState().activeView, 'composer.queue')
  first()
  assert.equal(focus.viewState().activeView, 'composer.editor')
})

test('hidden views never receive keys', () => {
  const { focus } = install()
  focus.pushView('composer.queue')
  const handler = focus.activeKeyHandler()
  assert.equal(handler, 'queue')
  focus.pushView('overlay.plan')
  assert.equal(focus.activeKeyHandler(), 'fatal')
})

test('unknown views fail fast', () => {
  const { focus } = install()
  assert.throws(() => focus.pushView('does-not-exist' as never), /unknown view/)
})

test('explicit focus activate routes to a registered view', () => {
  const { focus } = install()
  focus.pushView('composer.queue')
  const result = focus.activate('composer.command-picker')
  assert.equal(result.activeView, 'composer.command-picker')
})

test('fatal notice is higher priority than approval/question', () => {
  const { focus } = install()
  const fatal = focus.pushView('overlay.help')
  const approval = focus.pushView('interaction.approval')
  const question = focus.pushView('interaction.question')
  assert.equal(focus.viewState().activeView, 'interaction.question')
  question()
  approval()
  fatal()
})

test('view state cannot smuggle business payload', () => {
  const { focus } = install()
  const state = focus.viewState()
  assert.deepEqual(Object.keys(state).sort(), ['activeView', 'focusOwner', 'priority', 'stack'])
})

test('pushView accepts every canonical focus view id', () => {
  const { focus } = install()
  for (const view of TUI_FOCUS_VIEWS) {
    const dispose = focus.pushView(view)
    assert.equal(focus.viewState().activeView, view)
    dispose()
  }
  assert.equal(focus.viewState().activeView, 'composer.editor')
})

test('activate moves an existing view to the top of the stack', () => {
  const { focus } = install()
  focus.pushView('composer.queue')
  focus.pushView('overlay.help')
  const state = focus.activate('composer.queue')
  assert.equal(state.activeView, 'composer.queue')
  assert.deepEqual(state.stack, ['composer.editor', 'overlay.help', 'composer.queue'])
})
