import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..'); const outDir = resolve(root, 'generated/modules/execution-status-plugin')
rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'src/experiments/execution-status-plugin/tsconfig.json'], { cwd: root, stdio: 'inherit' })
copyFileSync(resolve(outDir, 'src/experiments/execution-status-plugin/src/execution-status-plugin.js'), resolve(root, 'execution-status-plugin.js'))
