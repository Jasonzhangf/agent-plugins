import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const lib = resolve(root, 'lib')
rmSync(lib, { recursive: true, force: true })
mkdirSync(lib, { recursive: true })
execFileSync(
  process.execPath,
  [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'runtime.tsconfig.json'],
  { cwd: root, stdio: 'inherit' },
)

// Public package entrypoints map (lib/index.js, lib/startup.js, lib/plugin-startup.js)
// onto the emitted tree under lib/src and lib/playground.
writeFileSync(resolve(lib, 'index.js'), "export * from './src/index.js'\n")
writeFileSync(resolve(lib, 'index.d.ts'), "export * from './src/index.d.ts'\n")
writeFileSync(resolve(lib, 'startup.js'), "export * from './src/experiments/startup/src/startup.js'\n")
writeFileSync(resolve(lib, 'startup.d.ts'), "export * from './src/experiments/startup/src/startup.d.ts'\n")
writeFileSync(resolve(lib, 'plugin-startup.js'), "export * from './src/plugin-startup.js'\n")
writeFileSync(resolve(lib, 'plugin-startup.d.ts'), "export * from './src/plugin-startup.d.ts'\n")

writeFileSync(
  resolve(lib, 'cli.js'),
  "#!/usr/bin/env node\nimport { main } from './src/cli.js'\nmain(process.argv).then((code) => process.exit(code)).catch((err) => { console.error(err); process.exit(1) })\n",
)
chmodSync(resolve(lib, 'cli.js'), 0o755)

console.log('[build:runtime] ok ->', lib)
