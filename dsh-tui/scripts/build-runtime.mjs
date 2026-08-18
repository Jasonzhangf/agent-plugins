import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const lib = resolve(root, 'lib')
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
writeFileSync(resolve(lib, 'startup.js'), "export * from './playground/experiments/startup/src/startup.js'\n")
writeFileSync(resolve(lib, 'startup.d.ts'), "export * from './playground/experiments/startup/src/startup.d.ts'\n")
writeFileSync(resolve(lib, 'plugin-startup.js'), "export * from './src/plugin-startup.js'\n")
writeFileSync(resolve(lib, 'plugin-startup.d.ts'), "export * from './src/plugin-startup.d.ts'\n")

writeFileSync(resolve(lib, 'cli.js'), "import('./src/cli.js').catch((err) => { console.error(err); process.exit(1); })\n")
chmodSync(resolve(lib, 'cli.js'), 0o755)

console.log('[build:runtime] ok ->', lib)
