import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const architecture = dirname(fileURLToPath(import.meta.url))
const root = join(architecture, '..', '..')
const repo = join(root, '..')

const load = async name => JSON.parse(await readFile(join(architecture, name), 'utf8'))
const [composition, resources, modules, functions, calls, verification, lifecycle] = await Promise.all([
  load('composition-manifest.json'),
  load('resource-registry.json'),
  load('module-registry.json'),
  load('function-map.json'),
  load('mainline-call-map.json'),
  load('verification-map.json'),
  load('lifecycle.json'),
])

for (const registry of [composition, resources, modules, functions, calls, verification, lifecycle]) {
  if (registry.status !== 'design') throw new Error('design-gate: every registry must have status=design')
}

const expectedPatches = [
  { id: 'ui-settings-models', name: '@deepseek-ai/dsh-client-ui-settings-models', disabled: true },
  { insert: [{ id: 'multikey-provider', name: 'dsh-multikey-provider' }] },
]
if (JSON.stringify(composition.patches) !== JSON.stringify(expectedPatches)) {
  throw new Error('design-gate: composition must only disable official Models and insert the plugin')
}
if (composition.unchanged_entries?.length !== 1
  || JSON.stringify(composition.unchanged_entries[0]) !== JSON.stringify({
    id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', disabled: false,
  })) {
  throw new Error('design-gate: official Provider must be explicitly unchanged and active')
}
if (composition.package !== 'dsh-multikey-provider'
  || composition.route_ownership?.official_routes?.mutation !== 'none'
  || composition.route_ownership?.pool_routes?.collision_policy !== 'fail') {
  throw new Error('design-gate: package identity or additive route ownership drifted')
}
if (composition.profile_gates?.restore?.requires_restart !== true) {
  throw new Error('design-gate: restore must require bundle removal and restart')
}

const patchRaw = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
for (const marker of [
  "id: ui-settings-models\n  name: '@deepseek-ai/dsh-client-ui-settings-models'\n  disabled: true",
  'id: multikey-provider\n      name: dsh-multikey-provider',
]) {
  if (!patchRaw.includes(marker)) throw new Error(`design-gate: cordis.patch.yml misses ${marker}`)
}
for (const forbidden of ['id: llm-pi-ai\n', 'id: llm-pi-ai-multikey', 'name: dsh-llm-pi-ai-multikey']) {
  if (patchRaw.includes(forbidden)) throw new Error(`design-gate: forbidden Provider replacement marker ${forbidden}`)
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (packageJson.name !== composition.package) throw new Error('design-gate: package name differs from composition')
if (packageJson.dependencies?.['@deepseek-ai/dsh-llm-pi-ai'] !== undefined) {
  throw new Error('design-gate: official Provider must not be bundled as a dependency')
}
if (packageJson.peerDependencies?.['@deepseek-ai/dsh-llm-pi-ai'] !== '0.1.0-rc.6'
  || packageJson.devDependencies?.['@deepseek-ai/dsh-llm-pi-ai'] !== '0.1.0-rc.6') {
  throw new Error('design-gate: installed official Provider must be an exact rc.6 peer/dev contract')
}
if (packageJson.dependencies?.['@deepseek-ai/dsh-client-ui-settings-models'] !== undefined
  || packageJson.peerDependencies?.['@deepseek-ai/dsh-client-ui-settings-models'] !== undefined
  || packageJson.devDependencies?.['@deepseek-ai/dsh-client-ui-settings-models'] !== '0.1.0-rc.6') {
  throw new Error('design-gate: official Models package is a dev-only baseline, not a runtime dependency')
}
if (packageJson.scripts?.prebuild !== 'pnpm run verify:architecture'
  || !packageJson.scripts?.check?.includes('pnpm run verify:architecture')) {
  throw new Error('design-gate: architecture gate is not wired into build/check')
}

const hashFile = async path => createHash('sha256').update(await readFile(path)).digest('hex')
for (const baseline of Object.values(composition.upstream_baseline)) {
  const installed = JSON.parse(await readFile(join(root, 'node_modules', baseline.package, 'package.json'), 'utf8'))
  if (installed.version !== baseline.version) throw new Error(`design-gate: ${baseline.package} version drift`)
  for (const [path, expected] of Object.entries(baseline.installed_artifacts)) {
    if (await hashFile(join(root, 'node_modules', baseline.package, path)) !== expected) {
      throw new Error(`design-gate: ${baseline.package}/${path} hash drift`)
    }
  }
}

const resourceIds = new Set(resources.resources.map(resource => resource.resource_id))
if (resourceIds.size !== resources.resources.length) throw new Error('design-gate: duplicate resource id')
const featureIds = new Set(functions.features.map(feature => feature.feature_id))
if (featureIds.size !== functions.features.length
  || JSON.stringify([...featureIds].sort()) !== JSON.stringify(Object.keys(verification.features).sort())) {
  throw new Error('design-gate: function and verification feature ids differ')
}
for (const feature of functions.features) {
  for (const resourceId of feature.resource_ids) {
    if (!resourceIds.has(resourceId)) throw new Error(`design-gate: feature references missing resource ${resourceId}`)
  }
  for (const entry of feature.entry_symbols) {
    if (entry.status !== 'design' && entry.status !== 'binding-pending') {
      throw new Error(`design-gate: invalid design symbol status ${entry.status}`)
    }
  }
}

const callNodeIds = calls.edges.map(edge => edge.node_id)
if (new Set(callNodeIds).size !== callNodeIds.length) throw new Error('design-gate: duplicate call-map node id')
if (JSON.stringify([...callNodeIds].sort()) !== JSON.stringify([...lifecycle.nodes].sort())) {
  throw new Error('design-gate: lifecycle and call-map node ids differ')
}
for (const edge of calls.edges) {
  if (!featureIds.has(edge.feature_id)) throw new Error(`design-gate: call edge has unknown feature ${edge.feature_id}`)
  for (const endpoint of [edge.caller, edge.callee]) {
    if (endpoint.status !== 'design' && endpoint.status !== 'binding-pending') {
      throw new Error(`design-gate: invalid call endpoint status ${endpoint.status}`)
    }
  }
}
const lifecycleEdgeNodes = new Set(lifecycle.edges.flat())
if (lifecycle.nodes.some(node => !lifecycleEdgeNodes.has(node))) {
  throw new Error('design-gate: lifecycle contains a disconnected node')
}

const fixture = async path => JSON.parse(await readFile(join(root, path), 'utf8'))
const installedFixture = await fixture(composition.profile_gates.install.fixture)
const restoredFixture = await fixture(composition.profile_gates.restore.fixture)
if (installedFixture.status !== 'design-fixture' || restoredFixture.status !== 'design-fixture') {
  throw new Error('design-gate: install/restore fixtures must remain design evidence only')
}
if (JSON.stringify(installedFixture.required_entries) !== JSON.stringify(composition.profile_gates.install.required_entries)
  || JSON.stringify(restoredFixture.required_entries) !== JSON.stringify(composition.profile_gates.restore.required_entries)
  || JSON.stringify(restoredFixture.absent_entries) !== JSON.stringify(composition.profile_gates.restore.absent_entries)) {
  throw new Error('design-gate: profile fixtures drift from composition manifest')
}

for (const path of composition.canonical_docs) await stat(join(root, path))
for (const module of modules.modules) {
  if (!Array.isArray(module.owned_paths) || module.owned_paths.length === 0) {
    throw new Error(`design-gate: module ${module.module_id} has no owned paths`)
  }
}

async function sourceFiles(path) {
  const result = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) result.push(...await sourceFiles(full))
    else if (/\.[cm]?[jt]sx?$/u.test(entry.name)) result.push(full)
  }
  return result
}
const sources = await sourceFiles(join(root, 'src'))
const joinedSource = (await Promise.all(sources.map(path => readFile(path, 'utf8')))).join('\n')
for (const marker of [
  '@deepseek-ai/dsh-llm-pi-ai/src/',
  '@deepseek-ai/dsh-client-ui-settings-models/src/',
  "from '@deepseek-ai/dsh-client-ui-settings-models/client'",
]) {
  if (joinedSource.includes(marker)) throw new Error(`design-gate: private/runtime client import ${marker}`)
}

const workflow = await readFile(join(repo, '.github/workflows/dsh-multikey-provider-design.yml'), 'utf8')
if (!workflow.includes('pnpm install --frozen-lockfile')
  || !workflow.includes('node dsh-multikey-provider/docs/architecture/verify-design.mjs')) {
  throw new Error('design-gate: design CI is not wired to install and execute the gate')
}

console.log(`DESIGN_GATE: PASS (${relative(repo, root)})`)
