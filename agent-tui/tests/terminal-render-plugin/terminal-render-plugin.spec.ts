import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyBuffer } from '../../src/experiments/display-buffer-plugin/src/display-buffer-plugin.ts'
import { apply } from '../../src/experiments/terminal-render-plugin/src/terminal-render-plugin.ts'
import type { TuiDisplayElement } from '../../contracts/tui/interpreter-plugin/interpreter-plugin.types.ts'

const element = (id: string, text: string, lifecycle: 'stable' | 'live'): TuiDisplayElement => ({ elementId: id, sourceId: id, semanticKind: 'text', lifecycle, lines: [{ spans: [{ text, style: 'white' }] }] })

test('terminal render projects only viewport rows and preserves absolute row numbers', () => {
  const ctx = new Context(); applyBuffer(ctx); apply(ctx)
  const snapshot = ctx.tuiDisplayBuffer!.reflow([element('one', 'one', 'stable'), element('two', 'two', 'stable')], { width: 20, paddingX: 1 })
  ctx.tuiDisplayBuffer!.setViewport({ topRow: 1, height: 1, followTail: false })
  const frame = ctx.tuiTerminalRender!.project(ctx.tuiDisplayBuffer!.read())
  assert.deepEqual(frame.rows.map(row => row.absoluteRow), [1])
  assert.deepEqual(frame.committedRows, [0, 1])
  assert.deepEqual(frame.scrollbackRows.map(row => row.absoluteRow), [0, 1])
  assert.equal(frame.scrollbackRows[0]!.line.spans[0]!.text, 'one')
  assert.equal(frame.rows[0]!.line.spans[0]!.text, 'two')
  assert.equal(frame.paddingX, 1)
  assert.equal(snapshot.committedRows.length, 2)
})

test('terminal render rejects disposed service', () => {
  const ctx = new Context(); apply(ctx); ctx.tuiTerminalRender!.dispose()
  assert.throws(() => ctx.tuiTerminalRender!.project({} as never), /disposed/)
})
