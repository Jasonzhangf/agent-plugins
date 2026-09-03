import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'generated/modules/logic-controls')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p',
  'src/experiments/logic-controls/tsconfig.json'], { cwd: root, stdio: 'inherit' })
writeFileSync(resolve(root, 'logic-controls.js'),
  "export * from './generated/modules/logic-controls/src/experiments/logic-controls/src/logic-controls.js'\n")
