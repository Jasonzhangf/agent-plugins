import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'generated/modules/terminal-render-plugin')
rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'src/experiments/terminal-render-plugin/tsconfig.json'], { cwd: root, stdio: 'inherit' })
copyFileSync(resolve(outDir, 'src/experiments/terminal-render-plugin/src/terminal-render-plugin.js'), resolve(root, 'terminal-render-plugin.js'))
