import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const activeLib = resolve(root, 'active/lib')
rmSync(activeLib, { recursive: true, force: true })
mkdirSync(activeLib, { recursive: true })
execFileSync(
  process.execPath,
  [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'runtime.tsconfig.json'],
  { cwd: root, stdio: 'inherit' },
)

// Public package entrypoints are emitted inside Active and may reference only
// sibling compiled artifacts. The source tree is not the runtime surface.
writeFileSync(resolve(activeLib, 'index.js'), [
  "export * from './playground/experiments/startup/src/startup.js'",
  "export * from './playground/experiments/transport/src/transport.js'",
  "export * from './playground/experiments/logic-controls/src/logic-controls.js'",
  "export * from './playground/experiments/session/src/session.js'",
  "export * from './playground/experiments/presentation/src/presentation.js'",
  "export * from './playground/experiments/installer/src/installer.js'",
  '',
].join('\n'))
writeFileSync(resolve(activeLib, 'index.d.ts'), [
  "export * from './playground/experiments/startup/src/startup.d.ts'",
  "export * from './playground/experiments/transport/src/transport.d.ts'",
  "export * from './playground/experiments/logic-controls/src/logic-controls.d.ts'",
  "export * from './playground/experiments/session/src/session.d.ts'",
  "export * from './playground/experiments/presentation/src/presentation.d.ts'",
  "export * from './playground/experiments/installer/src/installer.d.ts'",
  '',
].join('\n'))
writeFileSync(resolve(activeLib, 'startup.js'), "export * from './playground/experiments/startup/src/startup.js'\n")
writeFileSync(resolve(activeLib, 'startup.d.ts'), "export * from './playground/experiments/startup/src/startup.d.ts'\n")
writeFileSync(resolve(activeLib, 'plugin-startup.js'), "export * from './src/plugin-startup.js'\n")
writeFileSync(resolve(activeLib, 'plugin-startup.d.ts'), "export * from './src/plugin-startup.d.ts'\n")

writeFileSync(
  resolve(activeLib, 'cli.js'),
  "#!/usr/bin/env node\nimport { main } from './src/cli.js'\nmain(process.argv).then((code) => process.exit(code)).catch((err) => { console.error(err); process.exit(1) })\n",
)
chmodSync(resolve(activeLib, 'cli.js'), 0o755)

console.log('[build:runtime] ok ->', activeLib)
