import { readFile } from 'node:fs/promises'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const architecture = dirname(fileURLToPath(import.meta.url))
const root = join(architecture, '..', '..')
const repo = join(root, '..')

const load = async name => JSON.parse(await readFile(join(architecture, name), 'utf8'))
const [composition, resources, modules, functions, calls, verification, lifecycle, upstreamDelta] = await Promise.all([
  load('composition-manifest.json'),
  load('resource-registry.json'),
  load('module-registry.json'),
  load('function-map.json'),
  load('mainline-call-map.json'),
  load('verification-map.json'),
  load('lifecycle.json'),
  load('upstream-delta.json'),
])

for (const registry of [composition, resources, modules, functions, calls, verification, lifecycle, upstreamDelta]) {
  if (registry.status !== 'design') throw new Error('design-gate: every architecture registry must have status=design')
}

const expectedPatches = [
  { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', disabled: true },
  { id: 'ui-settings-models', name: '@deepseek-ai/dsh-client-ui-settings-models', disabled: true },
  { insert: [{ id: 'llm-pi-ai-multikey', name: 'dsh-llm-pi-ai-multikey' }] },
]
if (JSON.stringify(composition.patches) !== JSON.stringify(expectedPatches)) {
  throw new Error('design-gate: composition must use exact-name disable plus independent insert')
}

const decision = composition.decision
if (decision?.preferred !== 'insert only into official provider and Models extension seams'
  || decision.preferred_result !== 'rejected by installed rc.6 capability audit'
  || !decision.provider_evidence.includes('no adapter or credential resolver injection seam')
  || !decision.models_evidence.includes('no provider-editor child slot')
  || decision.selected !== 'disable the two official entries by exact name and insert one official-derived replacement entry') {
  throw new Error('design-gate: additive-first decision and seam evidence are incomplete')
}

const scaffold = composition.upstream_baseline?.source_scaffold
if (scaffold?.repository !== 'https://github.com/deepseek-ai/deepseek-harness.git'
  || scaffold.commit !== '47f943859bef60e4160492346772ded9b24f765a'
  || scaffold.version !== '0.1.0-rc.5') {
  throw new Error('design-gate: official source scaffold is not pinned')
}
const runtimeAuthority = composition.upstream_baseline?.runtime_authority
const expectedRuntime = [
  ['@deepseek-ai/dsh-llm-pi-ai', '0.1.0-rc.6', 'sha512-5RvzkpVCYLg9A3IGdm04px7XOaF/xikuMLe2toBY4A0qtJraXiZtUN1QBOL9i6u7DTOLG9oHP/USsbWRpyI+1Q==', 'a29d1a1aaaa513524315ee39b6a940d76082759d55bdee6a5b691f16cc620902'],
  ['@deepseek-ai/dsh-client-ui-settings-models', '0.1.0-rc.6', 'sha512-cgY7Em1QNwVK+ou2hI6i/vQj8MZK44US/u84wA6zuqvtDTP45jgNfYZBy1BCWnnUh6HslXVLj/1WzawEZn3YLw==', '43648b0891f71d9df32f05bee54c40d4c543f88d84a63e8cf4595519ad72d52a'],
]
if (!Array.isArray(runtimeAuthority) || runtimeAuthority.length !== expectedRuntime.length) {
  throw new Error('design-gate: runtime authority inventory is incomplete')
}
for (const [index, expected] of expectedRuntime.entries()) {
  const actual = runtimeAuthority[index]
  if (actual.package !== expected[0] || actual.version !== expected[1]
    || actual.integrity !== expected[2] || actual.artifact_sha256 !== expected[3]) {
    throw new Error(`design-gate: runtime authority ${expected[0]} is not pinned`)
  }
}
if (!composition.upstream_baseline.contract.includes('single-key behavior and UI parity tests')
  || !composition.upstream_baseline.contract.includes('runtime never reads a Harness checkout')) {
  throw new Error('design-gate: source-scaffold/runtime-authority contract is incomplete')
}

if (upstreamDelta.baseline?.commit !== scaffold.commit
  || upstreamDelta.runtime_authority?.length !== expectedRuntime.length
  || !upstreamDelta.provider?.allowed_deltas?.some(delta => delta.startsWith('adapter:'))
  || !upstreamDelta.provider?.forbidden_deltas?.includes('llm/stream middleware')
  || !upstreamDelta.models_client?.preserve_files?.includes('ModelsSection.tsx')
  || !upstreamDelta.models_client?.preserve_files?.includes('ProviderEditor.tsx')
  || !upstreamDelta.models_client?.allowed_deltas?.some(delta => delta.startsWith('ProviderEditor:'))
  || !upstreamDelta.models_client?.forbidden_deltas?.includes('configured row for an unconfigured provider')
  || upstreamDelta.reconciliation?.unknown_or_unmatched_rc6_behavior
    !== 'fail activation; do not approximate or add a compatibility fallback') {
  throw new Error('design-gate: official baseline delta inventory is incomplete')
}

const expectedOwners = new Map([
  ['provider_routes', ['dsh-llm-pi-ai-multikey', '@deepseek-ai/dsh-llm-pi-ai']],
  ['settings_namespace:llm-pi-ai', ['dsh-llm-pi-ai-multikey', '@deepseek-ai/dsh-llm-pi-ai']],
  ['settings_section:models', ['dsh-llm-pi-ai-multikey/client', '@deepseek-ai/dsh-client-ui-settings-models/client']],
])
for (const owner of composition.exclusive_owners ?? []) {
  const expected = expectedOwners.get(owner.resource)
  if (expected === undefined || owner.installed_owner !== expected[0] || owner.restored_owner !== expected[1]) {
    throw new Error(`design-gate: invalid exclusive owner contract ${owner.resource}`)
  }
  expectedOwners.delete(owner.resource)
}
if (expectedOwners.size > 0) throw new Error('design-gate: exclusive owner contracts are incomplete')

if (composition.configuration?.namespace !== 'llm-pi-ai'
  || composition.configuration.primary_field !== 'providers.<provider>.apiKeyEnv'
  || composition.configuration.extension_field !== 'providers.<provider>.apiKeyPool') {
  throw new Error('design-gate: single configuration path is not locked')
}
for (const forbidden of ['second namespace', 'second provider route', 'multikey/* route', 'llm/stream hook', 'control data in GenerateOptions or metadata']) {
  if (!composition.configuration.forbidden.includes(forbidden)) {
    throw new Error(`design-gate: missing forbidden configuration surface ${forbidden}`)
  }
}

const models = composition.models_ui
if (models?.source_owner !== 'official Models source scaffold'
  || models.section_id !== 'models'
  || !models.layout_rule.includes('retain official ModelsSection')
  || !models.exposure_rule.includes('unconfigured provider is absent from configured rows')
  || !models.exposure_rule.includes('only in the official Add provider selector')
  || !models.exposure_rule.includes('only after that provider is selected')
  || !models.delta.includes('inside the existing ProviderEditor')
  || !models.delta.includes('no new page, card, navigation item, or standalone editor')) {
  throw new Error('design-gate: official Models layout and exposure contract is incomplete')
}

if (composition.restore?.hot_reload_is_sufficient !== false
  || !composition.restore.sequence.includes('restart DSH by exact service or PID')
  || !composition.restore.sequence.includes('prove replacement entry absent')) {
  throw new Error('design-gate: restore must be removal plus restart and owner replay')
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (packageJson.name !== composition.package) throw new Error('design-gate: package identity differs from composition')
for (const [pkg, version] of expectedRuntime.map(entry => [entry[0], entry[1]])) {
  if (packageJson.devDependencies?.[pkg] !== version || packageJson.peerDependencies?.[pkg] !== version) {
    throw new Error(`design-gate: ${pkg} must be exact-pinned as peer/dev parity authority`)
  }
}

const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
for (const marker of [
  "- id: llm-pi-ai\n  name: '@deepseek-ai/dsh-llm-pi-ai'\n  disabled: true",
  "- id: ui-settings-models\n  name: '@deepseek-ai/dsh-client-ui-settings-models'\n  disabled: true",
  '- insert:\n    - id: llm-pi-ai-multikey\n      name: dsh-llm-pi-ai-multikey',
]) {
  if (!patch.includes(marker)) throw new Error('design-gate: cordis.patch.yml differs from the exact patch contract')
}

const [installedFixture, restoredFixture] = await Promise.all([
  load('fixtures/installed-profile.dump-config.json'),
  load('fixtures/restored-profile.dump-config.json'),
])
const expectedOwnerCounts = {
  provider_routes: 1,
  'settings_namespace:llm-pi-ai': 1,
  'settings_section:models': 1,
}
if (installedFixture.status !== 'design-fixture'
  || restoredFixture.status !== 'design-fixture'
  || JSON.stringify(installedFixture.unique_owner_counts) !== JSON.stringify(expectedOwnerCounts)
  || JSON.stringify(restoredFixture.unique_owner_counts) !== JSON.stringify(expectedOwnerCounts)
  || JSON.stringify(installedFixture.required_entries) !== JSON.stringify([
    ...expectedPatches.slice(0, 2),
    { id: 'llm-pi-ai-multikey', name: 'dsh-llm-pi-ai-multikey', disabled: false },
  ])
  || !restoredFixture.required_entries.some(entry => entry.id === 'llm-pi-ai' && entry.disabled === false)
  || !restoredFixture.required_entries.some(entry => entry.id === 'ui-settings-models' && entry.disabled === false)
  || !restoredFixture.absent_entries.some(entry => entry.id === 'llm-pi-ai-multikey')) {
  throw new Error('design-gate: install or restore fixture differs from the owner contract')
}

const resourceIds = new Set(resources.resources.map(resource => resource.resource_id))
for (const required of [
  'provider_routes', 'settings_namespace:llm-pi-ai', 'settings_section:models',
  'business.llm-request', 'business.llm-response', 'control.key-pool-runtime',
  'secret.credential-value', 'projection.key-health',
]) {
  if (!resourceIds.has(required)) throw new Error(`design-gate: missing resource ${required}`)
}
for (const forbidden of [
  'control.key-pool-runtime -> business.llm-request',
  'secret.credential-value -> business.llm-response',
  'projection.key-health -> business.llm-response',
]) {
  if (!resources.forbidden_relations.includes(forbidden)) throw new Error(`design-gate: missing forbidden relation ${forbidden}`)
}

const moduleIds = new Set(modules.modules.map(module => module.module_id))
const owns = (pattern, path) => pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -3)) : pattern === path
const moduleOf = path => modules.modules.filter(module => module.owned_paths.some(pattern => owns(pattern, path)))
const featureIds = new Set(functions.features.map(feature => feature.feature_id))
const verificationIds = new Set(Object.keys(verification.features))
if (featureIds.size !== verificationIds.size || [...featureIds].some(id => !verificationIds.has(id))) {
  throw new Error('design-gate: function and verification feature ids differ')
}
const symbolKeys = new Set()
for (const feature of functions.features) {
  for (const resourceId of feature.resource_ids) {
    if (!resourceIds.has(resourceId)) throw new Error(`design-gate: missing resource binding ${resourceId}`)
  }
  for (const entry of feature.entry_symbols) {
    if (entry.status !== 'binding-pending') throw new Error('design-gate: design symbols must be binding-pending')
    if (moduleOf(entry.path).length !== 1) throw new Error(`design-gate: ${entry.path} must have one module owner`)
    const key = `${entry.path}#${entry.symbol}`
    if (symbolKeys.has(key)) throw new Error(`design-gate: duplicate symbol owner ${key}`)
    symbolKeys.add(key)
  }
}
const sourceEdges = new Set(modules.allowed_import_edges.map(edge => edge.join('->')))
for (const edge of calls.edges) {
  if (!featureIds.has(edge.feature_id)) throw new Error(`design-gate: unknown feature ${edge.feature_id}`)
  for (const endpoint of [edge.caller, edge.callee]) {
    if (!symbolKeys.has(`${endpoint.path}#${endpoint.symbol}`)) throw new Error(`design-gate: unbound call symbol ${endpoint.path}#${endpoint.symbol}`)
  }
  const from = moduleOf(edge.caller.path)[0].module_id
  const to = moduleOf(edge.callee.path)[0].module_id
  if (edge.edge_kind === 'source-call' && from !== to && !sourceEdges.has(`${from}->${to}`)) {
    throw new Error(`design-gate: undeclared import edge ${from}->${to}`)
  }
  if (!['source-call', 'composition-mount', 'control-side-channel', 'operations-sequence'].includes(edge.edge_kind)) {
    throw new Error(`design-gate: invalid edge kind ${edge.edge_kind}`)
  }
  if (!moduleIds.has(from) || !moduleIds.has(to)) throw new Error('design-gate: call edge references unknown module')
}
const lifecycleNodes = new Set(lifecycle.nodes)
if (calls.edges.length !== lifecycleNodes.size || calls.edges.some(edge => !lifecycleNodes.has(edge.node_id))) {
  throw new Error('design-gate: lifecycle and call map node ids differ')
}
for (const [from, to] of lifecycle.edges) {
  if (!lifecycleNodes.has(from) || !lifecycleNodes.has(to)) throw new Error('design-gate: lifecycle edge references unknown node')
}

for (const document of new Set([...composition.canonical_docs, ...lifecycle.canonical_docs])) {
  const resolved = normalize(join(root, document))
  if (relative(root, resolved).startsWith('..')) throw new Error(`design-gate: document escapes package root: ${document}`)
  await readFile(resolved)
}
const designWorkflow = await readFile(join(repo, '.github/workflows/dsh-multikey-provider-design.yml'), 'utf8')
if (!designWorkflow.includes('node dsh-multikey-provider/docs/architecture/verify-design.mjs')) {
  throw new Error('design-gate: design CI does not run the design gate')
}

console.log('DESIGN_DECISION: official insertion seams unavailable; minimal official-derived whole-entry replacement')
console.log('DESIGN_GATE: PASS')
