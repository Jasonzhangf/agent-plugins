import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../../src/experiments/composer-plugin/src/composer-plugin.ts'

function context() {
  const ctx = new Context()
  apply(ctx)
  return ctx
}

function eligibility(sourceRevision = 1) {
  return { sessionSelected: true, sourceRevision }
}

test('multiline editing updates text and cursor atomically', () => {
  const composer = context().tuiComposer!
  composer.insertText('ab')
  composer.newline()
  composer.insertText('cd')
  assert.deepEqual([...composer.projectState().lines], ['ab', 'cd'])
  assert.equal(composer.projectState().cursorLine, 1)
  assert.equal(composer.projectState().cursorColumn, 2)
  composer.moveLeft()
  composer.backspace()
  assert.equal(composer.projectState().text, 'ab\nd')
})

test('history navigation restores the draft and multiline arrows preserve the column', () => {
  const composer = context().tuiComposer!
  composer.insertText('first')
  composer.submit(eligibility(1))
  composer.insertText('second')
  composer.submit(eligibility(2))
  composer.insertText('draft')
  composer.historyPrevious()
  assert.equal(composer.projectState().text, 'second')
  assert.equal(composer.historyNavigating(), true)
  composer.historyPrevious()
  assert.equal(composer.projectState().text, 'first')
  composer.historyNext()
  assert.equal(composer.projectState().text, 'second')
  composer.historyNext()
  assert.equal(composer.projectState().text, 'draft')
  assert.equal(composer.historyNavigating(), false)

  composer.clearText()
  composer.insertText('abcd\nef')
  assert.equal(composer.projectState().cursorColumn, 2)
  composer.moveUp()
  assert.equal(composer.projectState().cursor, 2)
  composer.moveDown()
  assert.equal(composer.projectState().cursor, 7)
})

test('submit emits one prompt intent and one pending echo; failed submit stays failed', () => {
  const composer = context().tuiComposer!
  composer.setLatestPresentationRevision(3)
  composer.insertText('hello')
  const intent = composer.submit(eligibility(4))
  assert.equal(intent.kind, 'prompt')
  if (intent.kind !== 'prompt') throw new Error('unreachable')
  assert.equal(composer.pendingEchoes().length, 1)
  composer.markSubmissionFailed(intent.localEchoId, 'host rejected')
  assert.equal(composer.failedEchoes().length, 1)
  assert.equal(composer.pendingEchoes().length, 0)
})

test('submit queues selected prompts while a turn is running or has an error', () => {
  const composer = context().tuiComposer!
  composer.insertText('while-running')
  const running = composer.submit({ sessionSelected: true, sourceRevision: 1 })
  assert.equal(running.kind, 'prompt')
  assert.equal(composer.pendingEchoes().length, 1)

  composer.insertText('after-error')
  const afterError = composer.submit({ sessionSelected: true, sourceRevision: 2 })
  assert.equal(afterError.kind, 'prompt')
  assert.equal(composer.pendingEchoes().length, 2)
})

test('official echo convergence removes only newer matching pending local echo', () => {
  const composer = context().tuiComposer!
  composer.setLatestPresentationRevision(10)
  composer.insertText('same')
  composer.submit(eligibility(11))
  assert.equal(composer.attachOfficialEcho({ nodeId: 'n1', text: 'same', publicationRevision: 12 }), true)
  assert.equal(composer.pendingEchoes().length, 0)
  composer.insertText('other')
  composer.submit(eligibility(13))
  assert.equal(composer.attachOfficialEcho({ nodeId: 'n2', text: 'different', publicationRevision: 14 }), false)
  assert.equal(composer.pendingEchoes().length, 1)
  assert.equal(composer.attachOfficialEcho({ nodeId: 'n3', text: 'same', publicationRevision: 15 }), false)
})

test('official echo convergence accepts the first live event at revision zero', () => {
  const composer = context().tuiComposer!
  composer.setLatestPresentationRevision(0)
  composer.insertText('first')
  const intent = composer.submit(eligibility(1))
  if (intent.kind !== 'prompt') throw new Error('expected prompt')
  assert.equal(composer.attachOfficialEcho({ nodeId: 'first-user', text: 'first', publicationRevision: 0 }), true)
  assert.equal(composer.pendingEchoes().length, 0)
})

test('cancel only cancels running turns; idle presses announce exit instead of exiting', () => {
  const composer = context().tuiComposer!
  // Running turn: Ctrl+C cancels.
  assert.deepEqual(composer.cancel({ key: 'ctrl-c', running: true, sourceRevision: 2 }), { kind: 'cancel', sourceRevision: 2 })
  // Idle Ctrl+C never exits: app-shell owns the double-press policy.
  composer.insertText('x')
  assert.deepEqual(composer.cancel({ key: 'ctrl-c', running: false, sourceRevision: 3 }), {
    kind: 'rejected',
    code: 'idle',
    message: 'composer-plugin: nothing to cancel while idle',
    sourceRevision: 3,
  })
  composer.clearText()
  assert.deepEqual(composer.cancel({ key: 'ctrl-c', running: false, sourceRevision: 4 }), {
    kind: 'rejected',
    code: 'idle',
    sourceRevision: 4,
    message: 'composer-plugin: nothing to cancel while idle',
  })
  // Ctrl+D still exits only on empty composer (reserved for /quit forwarding).
  composer.insertText('x')
  assert.deepEqual(composer.cancel({ key: 'ctrl-d', sourceRevision: 5 }), {
    kind: 'rejected',
    code: 'non-empty',
    message: 'composer-plugin: Ctrl+D requires empty composer',
    sourceRevision: 5,
  })
  composer.clearText()
  assert.deepEqual(composer.cancel({ key: 'ctrl-d', sourceRevision: 6 }), { kind: 'exit', sourceRevision: 6 })
  assert.throws(() => composer.cancel({ key: 'ctrl-d', running: true, sourceRevision: 7 } as never), /malformed cancel input/)
})

test('same composer state does not recursively notify render subscribers', () => {
  const composer = context().tuiComposer!
  let notifications = 0
  composer.subscribe(() => { notifications += 1 })
  composer.setMode('idle')
  composer.clearText()
  assert.equal(notifications, 1)
})

test('stale submit, malformed cursor state, duplicate mark, and disposal fail explicitly', () => {
  const composer = context().tuiComposer!
  composer.insertText('a')
  composer.submit(eligibility(5))
  const stale = composer.submit(eligibility(4))
  assert.equal(stale.kind, 'rejected')
  if (stale.kind === 'rejected') assert.equal(stale.code, 'stale')
  composer.clearText()
  composer.insertText('b')
  const first = composer.submit(eligibility(6))
  if (first.kind !== 'prompt') throw new Error('expected prompt')
  composer.markSubmitted(first.localEchoId)
  assert.throws(() => composer.markSubmitted(first.localEchoId), /duplicate or unknown/)
  composer.dispose()
  assert.throws(() => composer.insertText('b'), /disposed/)
  assert.throws(() => composer.submit(eligibility(7)), /disposed/)
})

test('command submit does not create a business local echo or fake success', () => {
  const composer = context().tuiComposer!
  composer.insertText('/help')
  const intent = composer.submit(eligibility())
  assert.equal(intent.kind, 'command')
  assert.equal(composer.pendingEchoes().length, 0)
  assert.equal(composer.failedEchoes().length, 0)
  assert.equal(composer.projectState().text, '')
})

test('command submit remains available before a Session is selected', () => {
  const composer = context().tuiComposer!
  composer.insertText('/quit')
  const intent = composer.submit({ ...eligibility(), sessionSelected: false })
  assert.deepEqual(intent.kind, 'command')
  assert.equal(composer.projectState().text, '')
})
