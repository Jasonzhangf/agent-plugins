#!/usr/bin/env node
// Run the corresponding build / test script for one of the 13 admitted TUI
// modules. Falls back to running every matching spec via node --test when no
// dedicated script is registered. Errors here are real build/test failures,
// not admission refusal.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const cmd = process.argv[2]
if (!cmd) {
  console.error('[agent-tui] pending-module requires a command name (typecheck|build:<m>|test:<m>)')
  process.exit(2)
}

const scriptMap = {
  'build:app-event-bus': ['node', ['--import', 'tsx', resolve(root, 'src/experiments/app-event-bus/src/app-event-bus.ts'), '--probe']],
  'build:transport': ['node', ['--import', 'tsx', resolve(root, 'src/experiments/transport/src/transport.ts'), '--probe']],
  'build:session': ['node', ['--import', 'tsx', resolve(root, 'src/experiments/session/src/session.ts'), '--probe']],
  'build:presentation': ['node', ['--import', 'tsx', resolve(root, 'src/experiments/presentation/src/presentation.ts'), '--probe']],
  'build:component-registry': ['node', ['--import', 'tsx', resolve(root, 'src/experiments/component-registry/src/component-registry.ts'), '--probe']],
  'build:focus-manager': ['node', ['--import', 'tsx', resolve(root, 'src/experiments/focus-manager/src/focus-manager.ts'), '--probe']],
  'build:terminal-lifecycle': ['node', ['--import', 'tsx', resolve(root, 'src/experiments/terminal-lifecycle/src/terminal-lifecycle.ts'), '--probe']],
  'build:terminal-ui': ['node', ['--import', 'tsx', resolve(root, 'src/experiments/terminal-ui/src/terminal-ui.ts'), '--probe']],
  'build:app-shell': ['node', ['--import', 'tsx', resolve(root, 'src/experiments/app-shell/src/app-shell.ts'), '--probe']],
  'build:fixture-contract': ['node', ['--import', 'tsx', resolve(root, 'src/experiments/fixture-contract/src/fixture-contract.ts'), '--probe']],
  'build:installer': ['node', ['--import', 'tsx', resolve(root, 'src/experiments/installer/src/installer.ts'), '--probe']],
  'build:simulator': ['node', ['--import', 'tsx', resolve(root, 'src/experiments/simulator/src/simulator.ts'), '--probe']],
}

const testMap = {
  'test:app-event-bus': resolve(root, 'tests/app-event-bus/app-event-bus.spec.ts'),
  'test:transport': resolve(root, 'tests/transport/transport.spec.ts'),
  'test:session': resolve(root, 'tests/session/session.spec.ts'),
  'test:presentation': resolve(root, 'tests/presentation/presentation.spec.ts'),
  'test:component-registry': resolve(root, 'tests/component-registry/component-registry.spec.ts'),
  'test:focus-manager': resolve(root, 'tests/focus-manager/focus-manager.spec.ts'),
  'test:terminal-lifecycle': resolve(root, 'tests/terminal-lifecycle/terminal-lifecycle.spec.ts'),
  'test:terminal-ui': resolve(root, 'tests/terminal-ui/terminal-ui.spec.ts'),
  'test:app-shell': resolve(root, 'tests/app-shell/app-shell.spec.ts'),
  'test:fixture-contract': resolve(root, 'tests/fixture-contract/fixture-contract.spec.ts'),
  'test:installer': resolve(root, 'tests/installer/installer.spec.ts'),
  'test:simulator': resolve(root, 'tests/simulator/simulator.spec.ts'),
  'test:runtime': resolve(root, 'tests/runtime/runtime.spec.ts'),
}

if (cmd === 'typecheck') {
  const r = spawnSync('npx', ['tsc', '--noEmit', '-p', resolve(root, 'tsconfig.json')], {
    cwd: root, stdio: 'inherit',
  })
  process.exit(r.status ?? 1)
}

if (cmd in scriptMap) {
  const [bin, args] = scriptMap[cmd]
  const r = spawnSync(bin, args, { cwd: root, stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

if (cmd in testMap) {
  const target = testMap[cmd]
  if (!existsSync(target)) {
  console.error(`[agent-tui] missing test target: ${target}`)
    process.exit(2)
  }
  const r = spawnSync('node', ['--import', 'tsx', '--test', target], { cwd: root, stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

console.error(`[agent-tui] unknown command: ${cmd}`)
process.exit(2)
