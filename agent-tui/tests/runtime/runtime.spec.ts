import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { TuiHistoryEntry as HistoryEntry } from '../../contracts/tui/session/history-entry.types.ts'
import { exitCodeForTuiStartupOutcome } from '../../src/experiments/startup/src/startup.ts'
import { apply as applyRawBuffer } from '../../src/experiments/terminal-raw-buffer-plugin/src/terminal-raw-buffer-plugin.ts'
import { apply as applyPresentation } from '../../src/experiments/presentation/src/presentation.ts'
import { apply as applyComponentRegistry } from '../../src/experiments/component-registry/src/component-registry.ts'
import { apply as applyTextParser } from '../../src/experiments/text-parser-plugin/src/text-parser-plugin.ts'
import { apply as applyToolCard } from '../../src/experiments/tool-card-plugin/src/tool-card-plugin.ts'
import { apply as applyInterpreter } from '../../src/experiments/interpreter-plugin/src/interpreter-plugin.ts'

const root = resolve(import.meta.dirname, '../..')

async function runCli(...args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'lib/cli.js'), ...args], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => resolvePromise({ code, stdout, stderr }))
  })
}

test('built package exposes only the declared runtime entrypoints', async () => {
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>
  }
  assert.deepEqual(Object.keys(packageJson.exports).sort(), ['.', './cli', './package.json', './plugin-startup', './startup'])
  for (const file of ['lib/index.js', 'lib/cli.js', 'lib/plugin-startup.js', 'lib/startup.js']) {
    await access(resolve(root, file))
  }
  const cli = await readFile(resolve(root, 'lib/cli.js'), 'utf8')
  assert.match(cli, /^#!\/usr\/bin\/env node\n/u)
})

test('Cordis patch binds the agent-tui startup entrypoint', async () => {
  const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id: agent-tui-startup/u)
  assert.match(patch, /name: ['"]agent-tui\/plugin-startup['"]/u)
  assert.doesNotMatch(patch, /dsh-tui/u)
})

test('installed CLI help exits without connecting to OpenCode', async () => {
  const result = await runCli('--help')
  assert.equal(result.code, 0)
  assert.match(result.stdout, /agent-tui/)
  assert.equal(result.stderr, '')
})

test('CLI rejects malformed options before startup', async () => {
  const result = await runCli('--endpoint')
  assert.equal(result.code, 2)
  assert.match(result.stderr, /requires a URL/)
})

test('terminal lifecycle failure cannot be projected as a successful process exit', () => {
  assert.equal(exitCodeForTuiStartupOutcome({ state: 'exited' }), 0)
  assert.equal(exitCodeForTuiStartupOutcome({ state: 'failed', error: new Error('terminal failed') }), 1)
})

test('official Session history crosses raw, presentation, and interpreter owners in order', () => {
  const ctx = new Context()
  applyRawBuffer(ctx)
  applyPresentation(ctx)
  applyComponentRegistry(ctx)
  applyTextParser(ctx)
  applyToolCard(ctx)
  applyInterpreter(ctx)
  const entries: HistoryEntry[] = [
    { event: { type: 'user/message', seq: 0, time: 1000, data: { id: 'user-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] } } as HistoryEntry['event'] },
    { event: { type: 'assistant/message', seq: 1, time: 1001, data: { turn: 1, step: 1, message: { id: 'assistant-1', role: 'assistant', source: { kind: 'model', provider: 'rcc', model: 'test' }, content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'answer' }] } } } as HistoryEntry['event'] },
  ]
  ctx.tuiTerminalRawBuffer!.hydrate(entries)
  const model = ctx.tuiPresentation.project({ sessionId: 'session-1', lastSeq: 1, entries: ctx.tuiTerminalRawBuffer!.read() })
  const elements = model.nodes.map(node => ctx.tuiInterpreter!.interpret(node))
  assert.deepEqual(elements.map(element => element.semanticKind), ['conversation.user', 'conversation.assistant'])
  assert.equal(elements[1]?.lines[0]?.spans[0]?.style, 'thinking')
  assert.equal(elements[1]?.lines.flatMap(line => line.spans).some(span => span.text === 'answer'), true)
})
