import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'generated/modules/app-container')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
 execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'src/experiments/app-container/tsconfig.json'], { cwd: root, stdio: 'inherit' })
copyFileSync(resolve(outDir, 'src/experiments/app-container/src/app-container.js'), resolve(root, 'app-container.js'))
