import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyStatusFooter } from '../../src/experiments/status-footer-plugin/src/status-footer-plugin.ts'
import type {
  TuiStatusFooterInput,
  TuiStatusFooterProjectionResult,
} from '../../contracts/tui/status-footer-plugin/status-footer-plugin.types.ts'

function install() {
  const ctx = new Context()
  applyStatusFooter(ctx)
  return { ctx, footer: ctx.tuiStatusFooter }
}

function input(overrides: Partial<TuiStatusFooterInput> = {}): TuiStatusFooterInput {
  return {
    connection: { state: 'connected', revision: 1 },
    execution: { state: 'idle', revision: 1 },
    status: { mode: 'idle', revision: 1 },
    selectedSession: { sessionId: 'session-1', cwd: '/workspace' },
    model: { provider: 'deepseek', model: 'deepseek-chat', thinkingEffort: 'high' },
    permission: { current: 'read-only' },
    goal: null,
    viewport: { class: 'regular', columns: 80, rows: 24 },
    focus: { activeView: 'composer.editor' },
    publicationRevision: 1,
    ...overrides,
  }
}

function isFrozenDeep(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true
  if (!Object.isFrozen(value)) return false
  seen.add(value)
  return Object.values(value).every(child => isFrozenDeep(child, seen))
}

test('projects one frozen footer leaf from closed control projections', () => {
  const { footer } = install()
  const leaf = footer.project(input())
  assert.equal(leaf.kind, 'box')
  assert.equal(leaf.key, 'leaf.footer')
  assert.equal(leaf.children[0].key, 'footer.status')
  assert.equal(leaf.children[0].text, 'deepseek/deepseek-chat · thinking high · permission read-only')
  assert.doesNotMatch(leaf.children[0].text, /connected|Session|session-1|\/workspace|\[idle\]/)
  const marker = leaf.children.at(-1)
  if (!marker || marker.key !== 'footer.marker') throw new Error('expected marker node')
  assert.match(marker.text, /Enter submit/)
  assert.doesNotMatch(marker.text, /Up\/Down scroll|PgUp\/PgDn page/)
  assert.match(marker.text, /Ctrl\+C×2 quit/)
  assert.match(marker.text, /goal: none/)
  assert.equal(isFrozenDeep(leaf), true)
})

test('status mode and fatal error drive footer priority and color', () => {
  const { footer } = install()
  const error = footer.project(input({ status: { mode: 'error', message: 'turn failed', revision: 2 } }))
  assert.equal(error.children[0].style.color, 'red')
  assert.match(error.children[0].text, /turn failed/)

  const fatal = footer.project(input({
    status: { mode: 'idle', revision: 2 },
    error: { kind: 'fatal', message: 'fatal failure' },
  }))
  assert.equal(fatal.children[0].style.color, 'red')
  assert.match(fatal.children[0].text, /fatal failure/)

  const running = footer.project(input({
    execution: { state: 'running', revision: 2 },
    status: { mode: 'streaming', revision: 2 },
  }))
  assert.equal(running.children[0].style.color, 'white')
  assert.equal(running.children[0].style.bold, true)
})

test('no session projection adds no technical identity placeholders', () => {
  const { footer } = install()
  const leaf = footer.project(input({ selectedSession: { sessionId: null, cwd: null } }))
  assert.equal(leaf.children[0].text, 'deepseek/deepseek-chat · thinking high · permission read-only')
  assert.doesNotMatch(leaf.children[0].text, /session|cwd|workspace/i)
})

test('connection state remains validated but is not duplicated in footer copy', () => {
  const { footer } = install()
  const disconnected = footer.project(input({ connection: { state: 'disconnected', revision: 2 } }))
  const failed = footer.project(input({ connection: { state: 'failed', revision: 3 } }))
  assert.equal(disconnected.children[0].text, 'deepseek/deepseek-chat · thinking high · permission read-only')
  assert.equal(failed.children[0].text, 'deepseek/deepseek-chat · thinking high · permission read-only')
})

test('projectSafe reports typed failures instead of throwing', () => {
  const { footer } = install()
  const result = footer.projectSafe(input({ publicationRevision: -1 })) as Extract<TuiStatusFooterProjectionResult, { ok: false }>
  assert.equal(result.ok, false)
  assert.equal(result.error.stage, 'status-footer-projection')
  assert.equal(result.error.code, 'invalid-status-footer-input')
  assert.match(result.error.message, /publicationRevision/)
  assert.ok(result.error.cause instanceof TypeError)
})

test('rejects closed-contract violations', () => {
  const { footer } = install()
  assert.throws(() => footer.project({ ...input(), unknown: true } as never), /closed contract/)
  assert.throws(() => footer.project(input({ connection: { state: 'bogus', revision: 1 } } as never)), /connection\.state/)
  assert.throws(() => footer.project(input({ viewport: { class: 'wide', columns: 80, rows: 24 } } as never)), /viewport\.class/)
})

test('service rejects projection after disposal', () => {
  const { footer } = install()
  footer.dispose()
  assert.throws(() => footer.project(input()), /disposed/)
  const result = footer.projectSafe(input()) as Extract<TuiStatusFooterProjectionResult, { ok: false }>
  assert.equal(result.ok, false)
  assert.match(result.error.message, /disposed/)
})

test('projection is deterministic for the same closed input', () => {
  const { footer } = install()
  assert.deepEqual(footer.project(input()), footer.project(input()))
})
