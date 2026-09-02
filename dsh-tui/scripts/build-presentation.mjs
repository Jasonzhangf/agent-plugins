import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'generated/modules/presentation')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p',
  'src/experiments/presentation/tsconfig.json'], { cwd: root, stdio: 'inherit' })
for (const artifact of ['markdown.js', 'model.js', 'presentation.js']) {
  copyFileSync(resolve(outDir, 'playground/experiments/presentation/src', artifact), resolve(root, artifact))
}
