import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../../src/experiments/display-buffer-plugin/src/display-buffer-plugin.ts'
import type { TuiDisplayElement } from '../../contracts/tui/interpreter-plugin/interpreter-plugin.types.ts'

const element = (id: string, text: string, lifecycle: 'stable' | 'live'): TuiDisplayElement => ({ elementId: id, sourceId: id, semanticKind: 'text', lifecycle, lines: [{ spans: [{ text, style: 'white' }] }] })
const layout = (width: number, paddingX = 0) => Object.freeze({ width, paddingX })

test('display buffer preserves user background while wrapping stable rows', () => {
  const ctx = new Context(); apply(ctx)
  const snapshot = ctx.tuiDisplayBuffer!.reflow([{
    elementId: 'user', sourceId: 'user', semanticKind: 'conversation.user', lifecycle: 'stable',
    lines: [{ spans: [{ text: 'abcd', style: 'white', backgroundColor: 'gray' }] }],
  }], layout(2))
  assert.deepEqual(snapshot.committedRows.map(row => row.line.spans[0]?.backgroundColor), ['gray', 'gray'])
})

test('display buffer separates committed rows from live rows with absolute numbering', () => {
  const ctx = new Context(); apply(ctx)
  const snapshot = ctx.tuiDisplayBuffer?.reflow([element('stable', '12345', 'stable'), element('live', 'abcdef', 'live')], layout(3))
  assert.deepEqual(snapshot?.committedRows.map(row => row.absoluteRow), [0, 1])
  assert.deepEqual(snapshot?.liveRows.map(row => row.absoluteRow), [2, 3])
})

test('display buffer keeps stable rows and replaces live tail on reflow', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiDisplayBuffer
  const first = service?.reflow([element('stable', 'stable', 'stable'), element('live', 'old', 'live')], layout(20))
  const second = service?.reflow([element('stable', 'stable', 'stable'), element('live', 'new', 'live')], layout(20))
  assert.equal(first?.committedRows[0]?.line.spans[0]?.text, second?.committedRows[0]?.line.spans[0]?.text)
  assert.equal(second?.liveRows[0]?.line.spans[0]?.text, 'new')
})

test('display buffer preserves loaded tail absolute rows when an older page is prepended', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiDisplayBuffer!
  service.reflow([element('tail-a', 'a', 'stable'), element('tail-b', 'b', 'stable')], layout(20))
  const older = service.reflow([
    element('old-a', 'old-a', 'stable'),
    element('old-b', 'old-b', 'stable'),
    element('tail-a', 'a', 'stable'),
    element('tail-b', 'b', 'stable'),
  ], layout(20))
  assert.deepEqual(older.committedRows.map(row => row.absoluteRow), [-2, -1, 0, 1])
  assert.equal(older.committedRows[2]?.line.spans[0]?.text, 'a')
  assert.equal(older.committedRows[3]?.line.spans[0]?.text, 'b')
})

test('display buffer keeps every active element in the replaceable tail', () => {
  const ctx = new Context(); apply(ctx)
  const snapshot = ctx.tuiDisplayBuffer?.reflow([
    element('stable', 'stable', 'stable'),
    element('live-one', 'one', 'live'),
    element('live-two', 'two', 'live'),
  ], layout(20))
  assert.deepEqual(snapshot?.committedRows.map(row => row.elementId), ['stable'])
  assert.deepEqual(snapshot?.liveRows.map(row => row.elementId), ['live-one', 'live-two'])
  assert.deepEqual(snapshot?.liveRows.map(row => row.absoluteRow), [1, 2])
})

test('display buffer rejects a stable element after the live tail', () => {
  const ctx = new Context(); apply(ctx)
  assert.throws(() => ctx.tuiDisplayBuffer?.reflow([
    element('live', 'live', 'live'),
    element('stable', 'stable', 'stable'),
  ], layout(20)), /stable element cannot follow live tail/)
})

test('display buffer promotes finalized live rows without rewriting the committed prefix', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiDisplayBuffer!
  service.reflow([element('stable', 'stable', 'stable'), element('live', 'draft', 'live')], layout(20))
  const finalized = service.reflow([element('stable', 'stable', 'stable'), element('live', 'draft', 'stable')], layout(20))
  assert.deepEqual(finalized.committedRows.map(row => row.line.spans[0]?.text), ['stable', 'draft'])
  assert.deepEqual(finalized.liveRows, [])
})

test('display buffer treats lifecycle settlement as content-preserving', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiDisplayBuffer!
  service.reflow([element('stable', 'prefix', 'stable'), element('live', 'draft', 'live')], layout(20))
  assert.doesNotThrow(() => service.reflow([element('stable', 'prefix', 'stable'), element('live', 'draft', 'stable')], layout(20)))
})

test('display buffer rejects same-width committed-row mutation', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiDisplayBuffer!
  service.reflow([element('stable', 'before', 'stable')], layout(20))
  assert.throws(() => service.reflow([element('stable', 'after', 'stable')], layout(20)), /append-only/)
})

test('display buffer resets committed and live rows at an explicit session boundary', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiDisplayBuffer!
  service.reflow([element('old-stable', 'old', 'stable'), element('old-live', 'draft', 'live')], layout(20, 1))
  service.setViewport({ topRow: 0, height: 8, followTail: true })
  const reset = service.reset()
  assert.deepEqual(reset.committedRows, [])
  assert.deepEqual(reset.liveRows, [])
  assert.deepEqual(reset.viewport, { topRow: 0, height: 8, followTail: true })
  assert.equal(reset.width, 20)
  assert.equal(reset.paddingX, 1)
  assert.doesNotThrow(() => service.reflow([element('new-stable', 'new', 'stable')], layout(20, 1)))
})

test('display buffer rejects invalid layout and viewport values', () => {
  const ctx = new Context(); apply(ctx)
  assert.throws(() => ctx.tuiDisplayBuffer?.reflow([], layout(0)), /positive safe integer/)
  assert.throws(() => ctx.tuiDisplayBuffer?.reflow([], layout(2, 1)), /content width must be positive/)
  assert.throws(() => ctx.tuiDisplayBuffer?.setViewport({ topRow: -1, height: 1, followTail: true }), /invalid viewport/)
})

test('display buffer wraps by terminal cell width, not JavaScript string length', () => {
  const ctx = new Context(); apply(ctx)
  const snapshot = ctx.tuiDisplayBuffer?.reflow([
    element('wide', '中a', 'stable'),
    element('combining', 'e\u0301x', 'stable'),
  ], layout(2))
  assert.deepEqual(snapshot?.committedRows.map(row => row.line.spans.map(span => span.text).join('')), ['中', 'a', 'éx'])
})

test('display buffer wraps within the layout-owned horizontal gutter', () => {
  const ctx = new Context(); apply(ctx)
  const snapshot = ctx.tuiDisplayBuffer!.reflow([element('gutter', '123456', 'stable')], layout(6, 1))
  assert.equal(snapshot.paddingX, 1)
  assert.deepEqual(snapshot.committedRows.map(row => row.line.spans.map(span => span.text).join('')), ['1234', '56'])
})

test('display buffer retains the newest 1000 physical rows without renumbering absolute history', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiDisplayBuffer!
  const first = service.reflow(Array.from({ length: 1001 }, (_, index) => element(`row-${String(index)}`, String(index), 'stable')), layout(20, 1))
  assert.equal(first.committedRows.length, 1000)
  assert.equal(first.committedRows[0]?.absoluteRow, 1)
  assert.equal(first.committedRows.at(-1)?.absoluteRow, 1000)
  const second = service.reflow(Array.from({ length: 1002 }, (_, index) => element(`row-${String(index)}`, String(index), 'stable')), layout(20, 1))
  assert.equal(second.committedRows.length, 1000)
  assert.equal(second.committedRows[0]?.absoluteRow, 2)
  assert.equal(second.committedRows.at(-1)?.absoluteRow, 1001)
})
