import assert from 'node:assert/strict'
import test from 'node:test'
import { createLatestAsyncTask } from '../../src/experiments/startup/src/startup.ts'

test('latest async task yields and coalesces pending snapshots', async () => {
  const seen: number[] = []
  const task = createLatestAsyncTask((value: number) => { seen.push(value) })
  task.enqueue(1)
  task.enqueue(2)
  assert.deepEqual(seen, [])
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(seen, [2])
  task.dispose()
})

test('disposed latest async task drops queued work', async () => {
  const seen: number[] = []
  const task = createLatestAsyncTask((value: number) => { seen.push(value) })
  task.enqueue(1)
  task.dispose()
  task.enqueue(2)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(seen, [])
})
