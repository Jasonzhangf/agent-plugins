import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import test from 'node:test'

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
})

test('installed CLI help exits without connecting to DSH', async () => {
  const result = await runCli('--help')
  assert.equal(result.code, 0)
  assert.match(result.stdout, /dsh-tui/) 
  assert.equal(result.stderr, '')
})

test('CLI rejects malformed options before startup', async () => {
  const result = await runCli('--endpoint')
  assert.equal(result.code, 2)
  assert.match(result.stderr, /requires a URL/)
})
