import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'generated/modules/text-parser-plugin')
rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'src/experiments/text-parser-plugin/tsconfig.json'], { cwd: root, stdio: 'inherit' })
copyFileSync(resolve(outDir, 'src/experiments/text-parser-plugin/src/text-parser-plugin.js'), resolve(root, 'text-parser-plugin.js'))
