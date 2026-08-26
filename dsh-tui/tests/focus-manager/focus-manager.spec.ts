import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  type TuiFocusManager,
} from '../../playground/experiments/focus-manager/src/focus-manager.ts'

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

test('q does not exit while an editor owns focus and only exits from command/help surfaces', () => {
  const { focus } = install()
  assert.equal(focus.shouldExitOnKey('q'), false)
  focus.activate('composer.command-picker')
  assert.equal(focus.shouldExitOnKey('q'), true)
  focus.pushView('interaction.approval')
  assert.equal(focus.shouldExitOnKey('q'), false)
  focus.pushView('overlay.help')
  assert.equal(focus.shouldExitOnKey('q'), true)
})

test('Ctrl+D exits only when composer is empty and idle', () => {
  const { focus } = install()
  assert.equal(focus.shouldExitOnCtrlD({ empty: true, running: false }), true)
  assert.equal(focus.shouldExitOnCtrlD({ empty: false, running: false }), false)
  assert.equal(focus.shouldExitOnCtrlD({ empty: true, running: true }), false)
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
