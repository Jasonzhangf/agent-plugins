import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'generated/modules/focus-manager')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p',
  'playground/experiments/focus-manager/tsconfig.json'], { cwd: root, stdio: 'inherit' })
copyFileSync(resolve(outDir, 'playground/experiments/focus-manager/src/focus-manager.js'), resolve(root, 'focus-manager.js'))
