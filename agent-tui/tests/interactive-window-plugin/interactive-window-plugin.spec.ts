import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyOverlay } from '../../src/experiments/overlay-manager-plugin/src/overlay-manager-plugin.ts'
import { apply as applyInteractive } from '../../src/experiments/interactive-window-plugin/src/interactive-window-plugin.ts'

test('interactive window maps model selection to the overlay owner', () => {
  const ctx = new Context(); applyOverlay(ctx); applyInteractive(ctx)
  ctx.tuiInteractiveWindow!.open({ kind: 'models', key: 'models-1', title: 'Models', items: [{ key: 'm1', label: 'Model 1' }], sourceRevision: 1 })
  assert.equal(ctx.tuiOverlayManager!.projectState().kind, 'view')
  const state = ctx.tuiOverlayManager!.projectState()
  assert.equal(state.kind, 'view')
  if (state.kind === 'view') assert.equal(state.view.kind, 'selector.model')
  ctx.tuiOverlayManager!.select()
  assert.deepEqual(ctx.tuiInteractiveWindow!.submit(), { kind: 'models', key: 'models-1', itemKey: 'm1', sourceRevision: 1 })
})

test('interactive window forwards a typed selection callback', () => {
  const ctx = new Context(); applyOverlay(ctx); applyInteractive(ctx)
  let selected: string | undefined
  ctx.tuiInteractiveWindow!.open({
    kind: 'permissions', key: 'permissions-1', title: 'Permissions',
    items: [{ key: 'read-only', label: 'Read only' }], sourceRevision: 2,
  }, itemKey => { selected = itemKey })
  ctx.tuiOverlayManager!.select()
  assert.equal(selected, 'read-only')
})

test('selection callback may replace the consumed window without closing it twice', () => {
  const ctx = new Context(); applyOverlay(ctx); applyInteractive(ctx)
  ctx.tuiInteractiveWindow!.open({
    kind: 'provider', key: 'provider-1', title: 'Providers',
    items: [{ key: 'provider-a', label: 'Provider A' }], sourceRevision: 2,
  }, () => {
    assert.doesNotThrow(() => ctx.tuiInteractiveWindow!.open({
      kind: 'models', key: 'models-after-provider', title: 'Models',
      items: [{ key: 'model-a', label: 'Model A' }], sourceRevision: 3,
    }))
  })
  ctx.tuiOverlayManager!.select()
  const state = ctx.tuiOverlayManager!.projectState()
  assert.equal(state.kind, 'view')
  if (state.kind === 'view') assert.equal(state.view.key, 'models-after-provider')
})

test('interactive window forgets a view closed by the overlay owner before the next open', () => {
  const ctx = new Context(); applyOverlay(ctx); applyInteractive(ctx)
  ctx.tuiInteractiveWindow!.open({ kind: 'models', key: 'models-external', title: 'Models', items: [{ key: 'm1', label: 'Model 1' }], sourceRevision: 3 })
  ctx.tuiOverlayManager!.close('models-external')
  assert.doesNotThrow(() => {
    ctx.tuiInteractiveWindow!.open({ kind: 'provider', key: 'provider-after-close', title: 'Providers', items: [{ key: 'p1', label: 'Provider 1' }], sourceRevision: 4 })
  })
})
