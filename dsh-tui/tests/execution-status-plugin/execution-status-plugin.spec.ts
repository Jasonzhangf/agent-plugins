import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyBus } from '../../playground/experiments/app-event-bus/src/app-event-bus.ts'
import { apply } from '../../playground/experiments/execution-status-plugin/src/execution-status-plugin.ts'

test('execution status projects timer and Esc interrupt without a ticker leak', () => {
  const ctx = new Context(); applyBus(ctx); apply(ctx)
  ctx.tuiExecutionStatus!.start('Ran command', 1000)
  assert.equal(ctx.tuiExecutionStatus!.project(112345).line, 'Ran command · 1:51 · Esc interrupt')
  ctx.tuiExecutionStatus!.stop('completed')
  assert.equal(ctx.tuiExecutionStatus!.project(113000).line, null)
})

test('interrupt publishes the typed cancel intent', () => {
  const ctx = new Context(); applyBus(ctx); apply(ctx)
  const events: unknown[] = []; ctx.tuiEventBus.subscribe(event => events.push(event))
  ctx.tuiExecutionStatus!.start('working', 0); ctx.tuiExecutionStatus!.interrupt()
  assert.equal(events.length, 1)
  assert.equal((events[0] as { intent: { kind: string } }).intent.kind, 'terminal.cancel')
})
