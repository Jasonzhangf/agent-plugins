import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { TuiHistoryEntry as HistoryEntry } from '../../contracts/tui/session/history-entry.types.ts'
import { apply } from '../../src/experiments/terminal-raw-buffer-plugin/src/terminal-raw-buffer-plugin.ts'

const record = (seq: number): HistoryEntry => ({
  event: {
    type: 'user/message',
    seq,
    time: 1000 + seq,
    data: { turn: seq + 1, message: { content: [{ type: 'text', text: `round-${String(seq)}` }] } },
  } as HistoryEntry['event'],
})

test('raw buffer hydrates and appends ordered official Session history entries', () => {
  const ctx = new Context(); apply(ctx)
  ctx.tuiTerminalRawBuffer?.hydrate([record(1), record(2)])
  ctx.tuiTerminalRawBuffer?.append(record(3))
  assert.deepEqual(ctx.tuiTerminalRawBuffer?.read().map(item => item.event.seq), [1, 2, 3])
  assert.equal(Object.isFrozen(ctx.tuiTerminalRawBuffer?.read()[0]), true)
  assert.equal(Object.isFrozen(ctx.tuiTerminalRawBuffer?.read()[0]?.event), true)
})

test('raw buffer prepends an older page without rewriting the loaded tail', () => {
  const ctx = new Context(); apply(ctx)
  ctx.tuiTerminalRawBuffer?.hydrate([record(8), record(9)])
  ctx.tuiTerminalRawBuffer?.prepend([record(6), record(7)])
  assert.deepEqual(ctx.tuiTerminalRawBuffer?.read().map(item => item.event.seq), [6, 7, 8, 9])
  assert.throws(() => ctx.tuiTerminalRawBuffer?.prepend([record(7)]), /must decrease/)
})

test('raw buffer rejects presentation records and side-channel fields instead of reconstructing raw history', () => {
  const ctx = new Context(); apply(ctx)
  assert.throws(() => ctx.tuiTerminalRawBuffer?.append({ sourceId: 'node-1', revision: 1, kind: 'conversation.user', lifecycle: 'settled', payload: { text: 'x' } } as never), /event is required/)
  assert.throws(() => ctx.tuiTerminalRawBuffer?.append({ ...record(1), metadata: 'hidden' } as never), /unsupported field metadata/)
  ctx.tuiTerminalRawBuffer?.append(record(1))
  assert.throws(() => ctx.tuiTerminalRawBuffer?.append(record(1)), /must increase/)
  assert.throws(() => ctx.tuiTerminalRawBuffer?.append(record(0)), /must increase/)
})

test('raw buffer replaces only an existing official sequence', () => {
  const ctx = new Context(); apply(ctx)
  ctx.tuiTerminalRawBuffer?.hydrate([record(1), record(3)])
  assert.throws(() => ctx.tuiTerminalRawBuffer?.replace(record(2)), /sequence not found/)
  const replacement = { ...record(3), event: { ...record(3).event, time: 9999 } } as HistoryEntry
  ctx.tuiTerminalRawBuffer?.replace(replacement)
  assert.equal(ctx.tuiTerminalRawBuffer?.read()[1]?.event.time, 9999)
})

test('disposed raw buffer rejects reads', () => {
  const ctx = new Context(); apply(ctx); ctx.tuiTerminalRawBuffer?.dispose()
  assert.throws(() => ctx.tuiTerminalRawBuffer?.read(), /disposed/)
})
