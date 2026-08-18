import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const result = spawnSync(process.execPath, ['.appsdk/verification/verify-design.mjs'], {
  cwd: root,
  encoding: 'utf8',
})
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout)
  process.exit(result.status ?? 1)
}
const output = resolve(root, 'generated/modules/governance-build')
mkdirSync(output, { recursive: true })
writeFileSync(resolve(output, 'verified.json'), `${JSON.stringify({ schema_version: 1, result: 'pass' }, null, 2)}\n`)
