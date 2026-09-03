import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'generated/modules/terminal-raw-buffer-plugin')
rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'src/experiments/terminal-raw-buffer-plugin/tsconfig.json'], { cwd: root, stdio: 'inherit' })
copyFileSync(resolve(outDir, 'src/experiments/terminal-raw-buffer-plugin/src/terminal-raw-buffer-plugin.js'), resolve(root, 'terminal-raw-buffer-plugin.js'))
