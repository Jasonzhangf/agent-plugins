import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply, tuiOverlayManagerName } from '../../src/experiments/overlay-manager-plugin/src/overlay-manager-plugin.ts'
import type { TuiOverlayViewInput } from '../../contracts/tui/overlay-manager-plugin/overlay-manager-plugin.types.ts'

function input(overrides: Partial<TuiOverlayViewInput> = {}): TuiOverlayViewInput {
  return {
    kind: 'overlay.help',
    key: 'help-1',
    title: 'Help',
    items: [{ key: 'item-a', label: 'A' }, { key: 'item-b', label: 'B' }],
    closable: true,
    sourceRevision: 1,
    ...overrides,
  }
}

function context(options?: Parameters<typeof apply>[1]) {
  const ctx = new Context()
  apply(ctx, options)
  return ctx
}

test('open pushes one immutable top view and close restores composer with one callback', () => {
  const ctx = context()
  const manager = ctx.tuiOverlayManager!
  let selected = ''
  const states: string[] = []
  const unsubscribe = manager.subscribe(state => states.push(state.kind))
  const close = manager.open(input(), itemKey => { selected = itemKey })
  assert.equal(manager.projectState().kind, 'view')
  assert.deepEqual(states, ['composer', 'view'])
  assert.equal(close(), undefined)
  assert.equal(selected, '')
  assert.equal(manager.projectState().kind, 'composer')
  unsubscribe()
})

test('only top view moves and selects; hidden stale index fails', () => {
  const ctx = context()
  const manager = ctx.tuiOverlayManager!
  const selectedKeys: string[] = []
  manager.open(input({ key: 'bottom' }))
  manager.open(input({ key: 'top', selectedIndex: 0 }), key => selectedKeys.push(key))
  assert.throws(() => (manager as any).replaceTop(input({ key: 'bottom', selectedIndex: 1 })), /stale index/)
  manager.move(-1)
  manager.move(-1)
  manager.select()
  assert.equal(selectedKeys.at(-1), 'item-a')
  assert.equal(manager.projectState().kind, 'view')
})

test('duplicate close and disposed manager fail explicitly', () => {
  const ctx = context()
  const manager = ctx.tuiOverlayManager!
  const close = manager.open(input())
  close()
  assert.throws(() => close(), /duplicate or unknown close/)
  manager.dispose()
  assert.throws(() => manager.open(input()), /disposed/)
})

test('malformed input and lower-priority replacement fail closed', () => {
  const ctx = context()
  const manager = ctx.tuiOverlayManager!
  assert.throws(() => manager.open({ ...input(), extra: true }), /unexpected field/)
  assert.throws(() => manager.open({ ...input(), items: [] }), /non-empty array/)
  assert.throws(() => manager.open({ ...input(), selectedIndex: 9 }), /out of bounds/)
  manager.open(input({ kind: 'approval-question', key: 'approval-1', closable: false }))
  assert.throws(() => manager.open(input()), /lower-priority/)
})

test('fatal view rejects movement and generic close', () => {
  const ctx = context()
  const manager = ctx.tuiOverlayManager!
  manager.open(input({ kind: 'approval-question', closable: false }))
  assert.throws(() => manager.move(1), /fatal view/)
  assert.throws(() => manager.select(), /fatal view/)
  const closeContext = context()
  const closeManager = closeContext.tuiOverlayManager!
  closeManager.open(input({ kind: 'approval-question', key: 'approval-1', closable: false }))
  assert.throws(() => closeManager.close('approval-1'), /fatal view/)
})

test('closed kinds obey the planned priority ladder', () => {
  const ctx = context()
  const manager = ctx.tuiOverlayManager!
  manager.open(input())
  manager.open(input({ kind: 'queue', key: 'queue-1' }))
  manager.open(input({ kind: 'command', key: 'command-1' }))
  manager.open(input({ kind: 'selector.resume-current-cwd', key: 'selector-1' }))
  manager.open(input({ kind: 'approval-question', key: 'approval-top' }))
  manager.open(input({ kind: 'fatal', key: 'fatal-1' }))
  assert.equal(manager.projectState().kind, 'view')
})

test('overlay transitions publish one refresh per top-view mutation', () => {
  const requests: Array<{ reason: string; sourceRevision: number }> = []
  const manager = context({
    refreshPublisher: {
      request(intent) {
        requests.push({ reason: intent.reason, sourceRevision: intent.sourceRevision })
        return { status: 'queued' }
      },
    },
  }).tuiOverlayManager!
  const close = manager.open(input())
  manager.move(1)
  close()
  const closeHidden = manager.open(input({ key: 'hidden-bottom' }))
  manager.open(input({ key: 'visible-top' }))
  const requestCountBeforeHiddenClose = requests.length
  closeHidden()
  assert.equal(requests.length, requestCountBeforeHiddenClose)
  assert.deepEqual(requests.map(request => request.sourceRevision), [1, 2, 3, 4, 5])
  assert.ok(requests.every(request => request.reason === 'overlay'))
})

test('selection emits one typed intent before callback', () => {
  let published: { kind: string; itemKey: string } | undefined
  let selected = ''
  const manager = context({
    selectionPublisher: {
      publish(intent) {
        published = { kind: intent.kind, itemKey: intent.itemKey }
      },
    },
  }).tuiOverlayManager!
  manager.open(input(), itemKey => { selected = itemKey })
  manager.select()
  assert.deepEqual(published, { kind: 'select', itemKey: 'item-a' })
  assert.equal(selected, 'item-a')
})
