import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'generated/modules/composer-plugin')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'src/experiments/composer-plugin/tsconfig.json'], { cwd: root, stdio: 'inherit' })
copyFileSync(resolve(outDir, 'src/experiments/composer-plugin/src/composer-plugin.js'), resolve(root, 'composer-plugin.js'))
