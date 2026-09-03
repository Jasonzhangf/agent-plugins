import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../../src/experiments/subagent-status-plugin/src/subagent-status-plugin.ts'

test('keeps one independently updated bar per running agent and removes stopped agents', () => {
  const ctx = new Context()
  apply(ctx)
  ctx.tuiSubagentStatus!.update({ agentId: 'a', label: 'Agent A', latestToolSummary: 'Read src/a.ts', revision: 1 })
  ctx.tuiSubagentStatus!.update({ agentId: 'b', label: 'Agent B', latestToolSummary: 'Search TODO', revision: 2 })
  ctx.tuiSubagentStatus!.update({ agentId: 'a', label: 'Agent A', latestToolSummary: 'Ran pnpm test', revision: 3 })
  assert.deepEqual(ctx.tuiSubagentStatus!.project().map(item => item.props), [
    { text: 'Agent A: Ran pnpm test', agentId: 'a', revision: 3 },
    { text: 'Agent B: Search TODO', agentId: 'b', revision: 2 },
  ])
  ctx.tuiSubagentStatus!.remove('a')
  assert.equal(ctx.tuiSubagentStatus!.project().length, 1)
})

test('rejects stale updates', () => {
  const ctx = new Context()
  apply(ctx)
  ctx.tuiSubagentStatus!.update({ agentId: 'a', label: 'Agent A', latestToolSummary: 'new', revision: 2 })
  assert.throws(() => ctx.tuiSubagentStatus!.update({ agentId: 'a', label: 'Agent A', latestToolSummary: 'old', revision: 1 }))
})
