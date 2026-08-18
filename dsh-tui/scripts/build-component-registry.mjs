import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'generated/modules/component-registry')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p',
  'playground/experiments/component-registry/tsconfig.json'], { cwd: root, stdio: 'inherit' })
writeFileSync(resolve(root, 'component-registry.js'),
  "export * from './generated/modules/component-registry/playground/experiments/component-registry/src/component-registry.js'\n")
