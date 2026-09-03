import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../../src/experiments/terminal-output-plugin/src/terminal-output-plugin.ts'
import type { TuiTerminalRenderFrame } from '../../contracts/tui/terminal-render-plugin/terminal-render-plugin.types.ts'

const frame = (
  revision: number,
  topRow: number,
  rows: number[],
  committedRows = rows,
  layout: { readonly width: number; readonly paddingX: number } = { width: 20, paddingX: 1 },
): TuiTerminalRenderFrame => ({ revision, ...layout, topRow, height: 2, committedRows, scrollbackRows: committedRows.map(absoluteRow => ({ absoluteRow, line: { spans: [{ text: String(absoluteRow), style: 'white' }] } })), rows: rows.map(absoluteRow => ({ absoluteRow, line: { spans: [{ text: String(absoluteRow), style: 'white' }] } })) })

test('terminal output commits stable rows once and replaces live rows', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiTerminalOutput!
  service.apply(frame(1, 0, [0, 1], [0])); service.apply(frame(2, 1, [1, 2], [0, 1])); service.apply(frame(3, 2, [2, 3], [0, 1, 2]))
  assert.deepEqual(service.read().scrollbackRows, [0, 1, 2])
  assert.deepEqual(service.read().stableRows.map(row => row.absoluteRow), [0, 1, 2])
  assert.equal(service.read().stableRows[0]!.line.spans[0]!.text, '0')
  assert.deepEqual(service.read().liveRows, [2, 3])
  assert.equal(service.read().width, 20)
  assert.equal(service.read().paddingX, 1)
})

test('terminal output reset isolates stable history between sessions', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiTerminalOutput!
  service.reset('session-one')
  service.apply(frame(1, 0, [0], [0]))
  service.reset('session-two')
  assert.equal(service.read().sessionKey, 'session-two')
  assert.deepEqual(service.read().scrollbackRows, [])
  assert.deepEqual(service.read().stableRows, [])
  service.apply(frame(1, 0, [0], [0]))
  assert.deepEqual(service.read().stableRows.map(row => row.absoluteRow), [0])
})

test('terminal output rejects stale and unordered frames', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiTerminalOutput!
  service.apply(frame(2, 0, [0]))
  assert.throws(() => service.apply(frame(1, 0, [0])), /stale/)
  assert.throws(() => service.apply(frame(3, 0, [2, 1])), /ordered/)
  assert.throws(() => service.apply(frame(3, 0, [0], [0], { width: 0, paddingX: 0 })), /invalid frame width/)
})

test('terminal output exposes visible rows and only changed dirty rows', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiTerminalOutput!
  service.apply(frame(1, 0, [0, 1], [0, 1]))
  assert.deepEqual(service.read().dirtyRows, [0, 1])
  service.apply(frame(2, 0, [0, 1], [0, 1]))
  assert.deepEqual(service.read().dirtyRows, [])
  assert.deepEqual(service.read().visibleRows.map(row => row.absoluteRow), [0, 1])
})

test('terminal output marks old live rows dirty when the live tail shrinks', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiTerminalOutput!
  service.apply(frame(1, 0, [0, 1], [0]))
  service.apply(frame(2, 0, [0], [0]))
  assert.deepEqual(service.read().dirtyRows, [1])
})

test('terminal output mirrors a sliding retained window and exposes only newly committed stable rows', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiTerminalOutput!
  service.apply(frame(1, 998, [998, 999], Array.from({ length: 1000 }, (_, index) => index)))
  const shifted = service.apply(frame(2, 999, [999, 1000], Array.from({ length: 1000 }, (_, index) => index + 1)))
  assert.equal(shifted.scrollbackRows.length, 1000)
  assert.equal(shifted.scrollbackRows[0], 1)
  assert.equal(shifted.scrollbackRows.at(-1), 1000)
  assert.equal(shifted.stableRows.length, 1000)
  assert.equal(shifted.stableRows[0]?.absoluteRow, 1)
  assert.equal(shifted.stableRows.at(-1)?.absoluteRow, 1000)
  assert.deepEqual(shifted.pendingStableRows.map(row => row.absoluteRow), [1000])
})

test('terminal output replays the retained stable window only when terminal layout changes', () => {
  const ctx = new Context(); apply(ctx)
  const service = ctx.tuiTerminalOutput!
  service.apply(frame(1, 0, [0, 1], [0, 1]))
  const sameLayout = service.apply(frame(2, 1, [1, 2], [0, 1, 2]))
  assert.deepEqual(sameLayout.pendingStableRows.map(row => row.absoluteRow), [2])

  const resized = service.apply(frame(3, 0, [0, 1], [0, 1, 2], { width: 30, paddingX: 1 }))
  assert.equal(resized.width, 30)
  assert.deepEqual(resized.pendingStableRows.map(row => row.absoluteRow), [0, 1, 2])
})
