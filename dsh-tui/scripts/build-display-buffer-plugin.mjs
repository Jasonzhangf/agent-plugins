import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'generated/modules/display-buffer-plugin')
rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'src/experiments/display-buffer-plugin/tsconfig.json'], { cwd: root, stdio: 'inherit' })
copyFileSync(resolve(outDir, 'src/experiments/display-buffer-plugin/src/display-buffer-plugin.js'), resolve(root, 'display-buffer-plugin.js'))
