import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../../src/experiments/theme-plugin/src/theme-plugin.ts'

test('maps semantic roles after parsing to the approved theme', () => {
  const ctx = new Context()
  apply(ctx)
  assert.deepEqual(ctx.tuiTheme?.styleForSemanticKind('conversation.reasoning'), { color: 'thinking', italic: true })
  assert.equal(ctx.tuiTheme?.resolveColor('blue'), '#61AFEF')
  assert.equal(ctx.tuiTheme?.resolveColor('tool'), '#56B6C2')
  assert.equal(ctx.tuiTheme?.resolveColor('red'), '#E06C75')
})

test('unknown semantic kinds do not inherit an accent', () => {
  const ctx = new Context()
  apply(ctx)
  assert.deepEqual(ctx.tuiTheme?.styleForSemanticKind('unknown.semantic-kind'), {})
})
