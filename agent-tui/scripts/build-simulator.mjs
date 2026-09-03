import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'generated/modules/simulator')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p',
  'src/experiments/simulator/tsconfig.json'], { cwd: root, stdio: 'inherit' })
copyFileSync(resolve(outDir, 'src/experiments/simulator/src/simulator.js'), resolve(root, 'simulator.js'))
const { loadBundle } = await import('../generated/modules/simulator/src/experiments/fixture-contract/src/fixture-contract.js')
const { renderSimulatorIndex } = await import('../generated/modules/simulator/src/experiments/simulator/src/simulator.js')
const reviewDir = resolve(root, 'generated/simulator')
mkdirSync(reviewDir, { recursive: true })
const bundle = loadBundle(resolve(root, 'contracts/tui/fixtures'))
const index = renderSimulatorIndex(bundle)
writeFileSync(resolve(reviewDir, 'index.html'), index.html, 'utf8')
writeFileSync(resolve(reviewDir, 'manifest.json'), `${JSON.stringify({
  bundleHash: bundle.bundleHash,
  deterministicHash: index.deterministicHash,
  fixtureIds: index.fixtureIds,
}, null, 2)}\n`, 'utf8')
