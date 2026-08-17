import { readFile, readdir, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, extname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const architecture = dirname(fileURLToPath(import.meta.url))
const root = join(architecture, '..', '..')
const repo = join(root, '..')

const load = async name => JSON.parse(await readFile(join(architecture, name), 'utf8'))

const filesUnder = async directory => {
  const files = []
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry)
    if ((await stat(path)).isDirectory()) files.push(...await filesUnder(path))
    else files.push(relative(root, path))
  }
  return files
}

const filesUnderIfPresent = async directory => await existingFile(directory)
  ? []
  : await stat(directory).then(value => value.isDirectory() ? filesUnder(directory) : []).catch(error => {
      if (error?.code === 'ENOENT') return []
      throw error
    })

const existingFile = async path => {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

const resolveRelativeImport = async (from, specifier) => {
  const raw = resolve(root, dirname(from), specifier)
  const withoutJs = raw.replace(/\.js$/u, '')
  for (const candidate of [raw, withoutJs, `${withoutJs}.ts`, `${withoutJs}.tsx`, `${withoutJs}.mjs`, join(withoutJs, 'index.ts'), join(withoutJs, 'index.tsx')]) {
    if (await existingFile(candidate)) return relative(root, candidate)
  }
  throw new Error(`design-gate: unresolved relative import ${from} -> ${specifier}`)
}
const sha256 = value => createHash('sha256').update(value).digest('hex')
const pngDimensions = async path => {
  const png = await readFile(path)
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error(`design-gate: invalid PNG header: ${path}`)
  }
  return `${String(png.readUInt32BE(16))}x${String(png.readUInt32BE(20))}`
}
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

for (const requiredDoc of [
  'docs/architecture/implementation-architecture.md',
  'docs/architecture/detailed-design.md',
]) {
  if (!await existingFile(join(root, requiredDoc))) {
    throw new Error(`design-gate: required design document is missing: ${requiredDoc}`)
  }
}
for (const doc of [...composition.canonical_docs ?? [], ...lifecycle.canonical_docs ?? []]) {
  if (!await existingFile(join(root, doc))) {
    throw new Error(`design-gate: canonical document does not exist: ${doc}`)
  }
}

const detailedDesign = await readFile(join(root, 'docs/architecture/detailed-design.md'), 'utf8')
const compositionManifest = JSON.parse(await readFile(join(root, 'docs/architecture/composition-manifest.json'), 'utf8'))
const mockupArtifacts = compositionManifest?.models_ui?.mockup_artifacts ?? {}
for (const [key, value] of Object.entries(mockupArtifacts)) {
  if (key.startsWith('viewport_')) continue
  if (typeof value !== 'string' || !await existingFile(join(root, value))) {
    throw new Error(`design-gate: mockup artifact missing: ${value}`)
  }
}
const mockupStates = compositionManifest?.models_ui?.mockup_states ?? []
if (!Array.isArray(mockupStates) || mockupStates.length !== 3) {
  throw new Error('design-gate: composition-manifest.models_ui.mockup_states must list exactly three states')
}
const mockupHtml = await readFile(join(root, 'docs/ui/multikey-ui-states.html'), 'utf8')
const scenarioSections = mockupHtml.match(/<section class="mk-scenario">[\s\S]*?<\/section>/gu) ?? []
if (scenarioSections.length !== mockupStates.length) {
  throw new Error(`design-gate: mockup states (${String(mockupStates.length)}) and scenario sections (${String(scenarioSections.length)}) differ`)
}
const viewportClaims = {
  desktop_png: 'viewport_desktop',
  mobile_png: 'viewport_mobile',
  dark_png: 'viewport_dark',
}
for (const [artifactKey, viewportKey] of Object.entries(viewportClaims)) {
  const artifactPath = join(root, mockupArtifacts[artifactKey])
  const actual = await pngDimensions(artifactPath)
  if (actual !== mockupArtifacts[viewportKey]) {
    throw new Error(`design-gate: ${artifactKey} is ${actual}, expected ${mockupArtifacts[viewportKey]}`)
  }
}
for (const state of mockupStates) {
  if (typeof state?.id !== 'string'
    || typeof state?.section_heading !== 'string'
    || typeof state?.scenario_summary !== 'string') {
    throw new Error('design-gate: each mockup state must carry id, section_heading, and scenario_summary')
  }
  const matchingSections = scenarioSections.filter(section => section.includes(`data-mockup-state="${state.id}"`))
  if (matchingSections.length !== 1) {
    throw new Error(`design-gate: mockup state id ${state.id} has no data-mockup-state marker in HTML`)
  }
  const section = matchingSections[0]
  if (!section.includes(`<strong>${state.section_heading}</strong>`)
    || !section.includes(`<span>${state.scenario_summary}</span>`)) {
    throw new Error(`design-gate: mockup state ${state.id} does not bind its heading and summary in one scenario section`)
  }
}
if (!detailedDesign.includes("export const name = 'llm-pi-ai-multikey'")
  || /export const name = 'llm-pi-ai'\s*$/mu.test(detailedDesign)) {
  throw new Error('design-gate: detailed design entry name does not bind llm-pi-ai-multikey')
}
if (!detailedDesign.includes('KeyPoolRuntime.recordAttemptFailure')
  || detailedDesign.includes('KeyPoolRuntime.recordFailure')) {
  throw new Error('design-gate: detailed design key-pool symbol drifts from function map')
}
if (!detailedDesign.includes('OfficialDerivedPiAiAdapter.stream')) {
  throw new Error('design-gate: detailed design adapter symbol drifts from function map')
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
if (packageJson.scripts?.['ui:render'] !== 'node scripts/ui/render-ui-states.mjs') {
  throw new Error('design-gate: package ui:render script is missing or differs')
}
const renderScript = join(root, 'scripts/ui/render-ui-states.mjs')
const renderSyntax = spawnSync(process.execPath, ['--check', renderScript], { encoding: 'utf8' })
if (renderSyntax.status !== 0) {
  throw new Error(`design-gate: render script syntax check failed: ${renderSyntax.stderr}`)
}
const renderSourceCheck = spawnSync(process.execPath, [renderScript, '--verify-source'], { encoding: 'utf8' })
if (renderSourceCheck.status !== 0) {
  throw new Error(`design-gate: standalone source binding failed: ${renderSourceCheck.stderr}`)
}
const designDiagrams = composition.design_diagrams
if (!designDiagrams?.manifest
  || !Array.isArray(designDiagrams.diagrams)
  || designDiagrams.diagrams.length !== 6
  || !await existingFile(join(root, designDiagrams.render_script))) {
  throw new Error('design-gate: design diagram contract is incomplete')
}
const diagramRenderScript = join(root, designDiagrams.render_script)
const diagramRenderSyntax = spawnSync(process.execPath, ['--check', diagramRenderScript], { encoding: 'utf8' })
if (diagramRenderSyntax.status !== 0) {
  throw new Error(`design-gate: diagram render script syntax check failed: ${diagramRenderSyntax.stderr}`)
}
const diagramVerifySource = spawnSync(process.execPath, [diagramRenderScript, '--verify-source'], { encoding: 'utf8' })
if (diagramVerifySource.status !== 0) {
  throw new Error(`design-gate: diagram source binding failed: ${diagramVerifySource.stderr}`)
}
const diagramManifest = JSON.parse(await readFile(join(root, designDiagrams.manifest), 'utf8'))
for (const diagram of designDiagrams.diagrams) {
  if (typeof diagram?.id !== 'string'
    || typeof diagram.source !== 'string'
    || typeof diagram.png !== 'string'
    || !await existingFile(join(root, diagram.source))
    || !await existingFile(join(root, diagram.png))) {
    throw new Error(`design-gate: diagram entry is incomplete or missing: ${diagram?.id ?? 'unknown'}`)
  }
  const rendered = diagramManifest.renders?.[diagram.id]
  const sourceHash = sha256(await readFile(join(root, diagram.source)))
  const pngHash = sha256(await readFile(join(root, diagram.png)))
  if (rendered?.source !== diagram.source
    || rendered?.png !== diagram.png
    || rendered.source_sha256 !== sourceHash
    || rendered.png_sha256 !== pngHash
    || rendered.dimensions !== await pngDimensions(join(root, diagram.png))) {
    throw new Error(`design-gate: diagram manifest does not bind the current ${diagram.id} artifacts`)
  }
}
const renderManifest = JSON.parse(await readFile(join(root, mockupArtifacts.render_manifest), 'utf8'))
const expectedRenderArtifacts = {
  source: mockupArtifacts.interactive,
  standalone: mockupArtifacts.standalone,
  desktop: mockupArtifacts.desktop_png,
  mobile: mockupArtifacts.mobile_png,
  dark: mockupArtifacts.dark_png,
}
if (renderManifest.schema_version !== 1
  || renderManifest.source.path !== expectedRenderArtifacts.source
  || renderManifest.source.sha256 !== sha256(await readFile(join(root, expectedRenderArtifacts.source)))
  || renderManifest.standalone.path !== expectedRenderArtifacts.standalone
  || renderManifest.standalone.sha256 !== sha256(await readFile(join(root, expectedRenderArtifacts.standalone)))) {
  throw new Error('design-gate: render manifest does not bind the current source and standalone artifacts')
}
for (const name of ['desktop', 'mobile', 'dark']) {
  const rendered = renderManifest.renders?.[name]
  const expectedPath = expectedRenderArtifacts[name]
  const expectedViewport = mockupArtifacts[`viewport_${name}`]
  if (rendered?.path !== expectedPath
    || `${String(rendered.width)}x${String(rendered.height)}` !== expectedViewport
    || rendered.sha256 !== sha256(await readFile(join(root, expectedPath)))) {
    throw new Error(`design-gate: render manifest does not bind the current ${name} PNG`)
  }
}
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
  'business.llm-request', 'business.llm-response', 'control.provider-snapshot',
  'control.key-pool-runtime', 'control.attempt-credential', 'runtime.provider-attempt',
  'secret.credential-value', 'projection.key-health', 'error.adapter-attempt',
  'error.key-state-transition', 'error.request-outcome',
]) {
  if (!resourceIds.has(required)) throw new Error(`design-gate: missing resource ${required}`)
}
for (const relation of resources.relations) {
  if (!resourceIds.has(relation.from) || !resourceIds.has(relation.to) || typeof relation.via !== 'string') {
    throw new Error('design-gate: resource relation is not bound to declared resources')
  }
}
for (const required of [
  ['runtime.provider-attempt', 'error.adapter-attempt'],
  ['error.adapter-attempt', 'error.key-state-transition'],
  ['error.key-state-transition', 'control.key-pool-runtime'],
  ['error.adapter-attempt', 'error.request-outcome'],
]) {
  if (!resources.relations.some(relation => relation.from === required[0] && relation.to === required[1])) {
    throw new Error(`design-gate: missing typed error relation ${required.join(' -> ')}`)
  }
}
for (const forbidden of [
  'control.provider-snapshot -> business.llm-request',
  'control.key-pool-runtime -> business.llm-request',
  'control.attempt-credential -> business.llm-request',
  'control.attempt-credential -> business.llm-response',
  'error.adapter-attempt -> business.llm-response',
  'error.key-state-transition -> business.llm-response',
  'secret.credential-value -> business.llm-response',
  'projection.key-health -> business.llm-response',
]) {
  if (!resources.forbidden_relations.includes(forbidden)) throw new Error(`design-gate: missing forbidden relation ${forbidden}`)
}

const moduleIds = new Set(modules.modules.map(module => module.module_id))
const deletePaths = new Set(modules.transition?.delete_after_approval ?? [])
for (const module of modules.modules) {
  if (module.status !== 'delete-after-design-approval') continue
  for (const path of module.owned_paths) {
    if (!deletePaths.has(path)) {
      throw new Error(`design-gate: delete-after-design-approval path is not covered: ${path}`)
    }
  }
}
if (!modules.transition?.activation_rule.includes('delete-after-design-approval module entries')
  || !modules.transition.activation_rule.includes('allowed edges')
  || !modules.transition.activation_rule.includes('call-map endpoints')
  || !modules.transition.activation_rule.includes('resource relations')
  || !modules.transition.activation_rule.includes('verification gate targets')) {
  throw new Error('design-gate: transition-delete activation rule does not require registry cleanup')
}
const owns = (pattern, path) => pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -3)) : pattern === path
const moduleOf = path => modules.modules.filter(module => module.owned_paths.some(pattern => owns(pattern, path)))
const executablePaths = [
  ...(await filesUnderIfPresent(join(root, 'src'))),
  ...(await filesUnderIfPresent(join(root, 'tests'))),
  ...(await filesUnderIfPresent(join(root, 'scripts'))),
  ...(await filesUnderIfPresent(join(root, 'docs/architecture'))),
  ...(await filesUnderIfPresent(join(root, 'docs/goals'))),
  ...(await filesUnderIfPresent(join(root, 'docs/ui'))),
  ...(await filesUnderIfPresent(join(root, 'docs/wiki'))),
  ...(await filesUnderIfPresent(join(root, 'docs/diagrams'))),
  ...(await filesUnderIfPresent(join(root, 'outputs'))),
  'docs/architecture/verify-design.mjs',
  'eslint.config.mjs',
  'tsdown.config.ts',
  'tsconfig.json',
  'tsconfig.test.json',
  'tsconfig.build.json',
  'package.json',
  'cordis.patch.yml',
  '../.github/workflows/dsh-multikey-provider-design.yml',
].filter(path => ['.ts', '.tsx', '.mjs', '.css', '.json', '.yml', '.yaml', '.html', '.md', '.png'].includes(extname(path)))
const presentExecutablePaths = []
for (const path of executablePaths) {
  if (await existingFile(join(root, path))) presentExecutablePaths.push(path)
}
for (const path of presentExecutablePaths) {
  const owners = moduleOf(path)
  if (owners.length !== 1) throw new Error(`design-gate: executable path ${path} has ${String(owners.length)} module owners`)
}
for (const module of modules.modules) {
  for (const imported of module.allowed_import_modules) {
    if (!moduleIds.has(imported)) throw new Error(`design-gate: module ${module.module_id} allows unknown module ${imported}`)
  }
}
const featureIds = new Set(functions.features.map(feature => feature.feature_id))
const verificationIds = new Set(Object.keys(verification.features))
if (featureIds.size !== verificationIds.size || [...featureIds].some(id => !verificationIds.has(id))) {
  throw new Error('design-gate: function and verification feature ids differ')
}
const symbolKeys = new Set()
const gateIds = new Set()
for (const gate of verification.gates ?? []) {
  if (gateIds.has(gate.gate_id)) throw new Error(`design-gate: duplicate gate ${gate.gate_id}`)
  gateIds.add(gate.gate_id)
  if (!featureIds.has(gate.feature_id)
    || !['design', 'implementation', 'live'].includes(gate.phase)
    || !['active', 'binding-pending'].includes(gate.status)
    || typeof gate.command !== 'string'
    || gate.command.length === 0
    || !Array.isArray(gate.test_targets)
    || gate.test_targets.length === 0
    || !Array.isArray(gate.positive)
    || gate.positive.length === 0
    || !Array.isArray(gate.negative)
    || gate.negative.length === 0
    || typeof gate.attachment !== 'string'
    || gate.attachment.length === 0) {
    throw new Error(`design-gate: gate ${gate.gate_id} is not executable or lacks paired coverage`)
  }
  for (const resourceId of gate.resource_ids) {
    if (!resourceIds.has(resourceId)) throw new Error(`design-gate: gate ${gate.gate_id} binds unknown resource ${resourceId}`)
  }
  for (const target of gate.test_targets) {
    if (deletePaths.has(target)) {
      throw new Error(`design-gate: gate ${gate.gate_id} binds a transition-delete path: ${target}`)
    }
    if (gate.status === 'active' && !await existingFile(join(root, target))) {
      throw new Error(`design-gate: active gate ${gate.gate_id} target does not exist: ${target}`)
    }
  }
}
for (const feature of functions.features) {
  if (!moduleIds.has(feature.owner)) throw new Error(`design-gate: feature ${feature.feature_id} has unknown owner ${feature.owner}`)
  for (const resourceId of [...feature.owned_resource_ids, ...feature.related_resource_ids]) {
    if (!resourceIds.has(resourceId)) throw new Error(`design-gate: missing resource binding ${resourceId}`)
  }
  for (const resourceId of feature.owned_resource_ids) {
    const resource = resources.resources.find(candidate => candidate.resource_id === resourceId)
    if (resource.owner !== feature.owner) {
      throw new Error(`design-gate: feature ${feature.feature_id} cannot own ${resourceId} declared for ${resource.owner}`)
    }
  }
  for (const entry of feature.entry_symbols) {
    if (entry.status !== 'binding-pending') throw new Error('design-gate: design symbols must be binding-pending')
    const entryOwners = moduleOf(entry.path)
    if (entryOwners.length !== 1) throw new Error(`design-gate: ${entry.path} must have one module owner`)
    if (entryOwners[0].module_id !== feature.owner) {
      throw new Error(`design-gate: feature ${feature.feature_id} cannot own ${entry.path} in ${entryOwners[0].module_id}`)
    }
    const key = `${entry.path}#${entry.symbol}`
    if (symbolKeys.has(key)) throw new Error(`design-gate: duplicate symbol owner ${key}`)
    symbolKeys.add(key)
  }
  const mappedGates = verification.features[feature.feature_id]
  if (JSON.stringify(mappedGates) !== JSON.stringify(feature.required_gates)) {
    throw new Error(`design-gate: function and verification gates differ for ${feature.feature_id}`)
  }
  for (const gateId of feature.required_gates) {
    const gate = verification.gates.find(candidate => candidate.gate_id === gateId)
    if (gate === undefined || gate.feature_id !== feature.feature_id) {
      throw new Error(`design-gate: unresolved required gate ${gateId}`)
    }
  }
}
const ownedResourceIds = functions.features.flatMap(feature => feature.owned_resource_ids)
if (new Set(ownedResourceIds).size !== ownedResourceIds.length) {
  throw new Error('design-gate: resource has more than one function-map owner')
}
if (verification.gates.some(gate => !functions.features.some(feature => feature.required_gates.includes(gate.gate_id)))) {
  throw new Error('design-gate: orphan verification gate')
}
const sourceEdges = new Set(modules.allowed_import_edges.map(edge => edge.join('->')))
const controlEdges = new Set(modules.allowed_control_edges.map(edge => edge.join('->')))
const errorEdges = new Set(modules.allowed_error_edges.map(edge => edge.join('->')))
const compositionEdges = new Set(modules.allowed_composition_edges.map(edge => edge.join('->')))
if (!compositionEdges.has('composition->models-client')) {
  throw new Error('design-gate: composition does not declare the replacement Models client mount')
}
if (!calls.edges.some(edge => edge.node_id === 'ComposeIn03MountModelsClient'
  && edge.edge_kind === 'composition-mount'
  && edge.feature_id === 'replacement.composition')) {
  throw new Error('design-gate: call map does not bind the replacement Models client composition mount')
}
for (const [from, to] of [...modules.allowed_import_edges, ...modules.allowed_control_edges, ...modules.allowed_error_edges, ...modules.allowed_composition_edges]) {
  if (!moduleIds.has(from) || !moduleIds.has(to)) throw new Error(`design-gate: module edge references unknown module ${from}->${to}`)
}
for (const [from, to] of modules.allowed_import_edges) {
  const declared = modules.modules.find(module => module.module_id === from)?.allowed_import_modules ?? []
  if (!declared.includes(to)) throw new Error(`design-gate: import edge ${from}->${to} is absent from module policy`)
}
for (const edge of calls.edges) {
  if (!featureIds.has(edge.feature_id)) throw new Error(`design-gate: unknown feature ${edge.feature_id}`)
  for (const endpoint of [edge.caller, edge.callee]) {
    if (!symbolKeys.has(`${endpoint.path}#${endpoint.symbol}`)) throw new Error(`design-gate: unbound call symbol ${endpoint.path}#${endpoint.symbol}`)
  }
  const from = moduleOf(edge.caller.path)[0].module_id
  const to = moduleOf(edge.callee.path)[0].module_id
  const featureOwner = functions.features.find(feature => feature.feature_id === edge.feature_id).owner
  if (featureOwner !== from && featureOwner !== to) {
    throw new Error(`design-gate: call node ${edge.node_id} does not traverse its feature owner ${featureOwner}`)
  }
  if (edge.edge_kind === 'source-call' && from !== to && !sourceEdges.has(`${from}->${to}`)) {
    throw new Error(`design-gate: undeclared import edge ${from}->${to}`)
  }
  if (edge.edge_kind === 'composition-mount' && from !== to && !compositionEdges.has(`${from}->${to}`)) {
    throw new Error(`design-gate: undeclared composition edge ${from}->${to}`)
  }
  if (edge.edge_kind === 'control-side-channel' && from !== to && !controlEdges.has(`${from}->${to}`)) {
    throw new Error(`design-gate: undeclared control edge ${from}->${to}`)
  }
  if (edge.edge_kind === 'error-chain' && !errorEdges.has(`${from}->${to}`)) {
    throw new Error(`design-gate: undeclared error edge ${from}->${to}`)
  }
  if (!['source-call', 'composition-mount', 'control-side-channel', 'error-chain', 'operations-sequence'].includes(edge.edge_kind)) {
    throw new Error(`design-gate: invalid edge kind ${edge.edge_kind}`)
  }
  if (!moduleIds.has(from) || !moduleIds.has(to)) throw new Error('design-gate: call edge references unknown module')
}
for (const path of presentExecutablePaths.filter(path => ['.ts', '.tsx', '.mjs'].includes(extname(path)))) {
  const source = await readFile(join(root, path), 'utf8')
  const owner = moduleOf(path)[0].module_id
  for (const match of source.matchAll(/(?:from\s+|import\s*\()['"](\.\.?\/[^'"]+)['"]/gu)) {
    const targetPath = await resolveRelativeImport(path, match[1])
    const targetOwners = moduleOf(targetPath)
    if (targetOwners.length !== 1) throw new Error(`design-gate: imported path ${targetPath} has ${String(targetOwners.length)} owners`)
    const target = targetOwners[0].module_id
    if (target !== owner && !sourceEdges.has(`${owner}->${target}`)) {
      throw new Error(`design-gate: actual import ${owner}->${target} is undeclared (${path})`)
    }
  }
}
const lifecycleNodes = new Set(lifecycle.nodes)
const callNodeIds = new Set(calls.edges.map(edge => edge.node_id))
if (calls.edges.length !== lifecycleNodes.size
  || callNodeIds.size !== lifecycleNodes.size
  || calls.edges.some(edge => !lifecycleNodes.has(edge.node_id))) {
  throw new Error('design-gate: lifecycle and call map node ids differ')
}
const resolvedGateIds = new Set(verification.gates.map(gate => gate.gate_id))
for (const gateId of lifecycle.verification_gates ?? []) {
  if (!resolvedGateIds.has(gateId)) {
    throw new Error(`design-gate: lifecycle references unresolved verification gate ${gateId}`)
  }
}
if (lifecycle.graph_semantics?.call_map_binding
    !== 'each lifecycle node id binds exactly one internal implementation edge with the same node_id'
  || lifecycle.graph_semantics.layering
    !== 'lifecycle stage transitions and call-map implementation edges are distinct graph layers') {
  throw new Error('design-gate: lifecycle graph semantics do not bind call-map node ids')
}
const activeGateContract = verification.active_gate_contract
if (!activeGateContract
  || activeGateContract.status !== 'pending-revision-after-design-approval'
  || activeGateContract.package_name !== composition.package
  || !activeGateContract.required_revision.includes('official-derived module graph')
  || !Array.isArray(activeGateContract.forbidden_legacy_paths)
  || [...deletePaths].some(path => !activeGateContract.forbidden_legacy_paths.includes(path))) {
  throw new Error('design-gate: active gate revision contract is not surfaced')
}
const lifecycleEdgeKeys = new Set(lifecycle.edges.map(edge => edge.join('->')))
for (const [from, to] of lifecycle.edges) {
  if (!lifecycleNodes.has(from) || !lifecycleNodes.has(to)) throw new Error('design-gate: lifecycle edge references unknown node')
}
const chainNodes = new Set()
const chainEdgeKeys = new Set()
for (const chain of Object.values(lifecycle.chains ?? {})) {
  if (!Array.isArray(chain) || chain.length < 2) throw new Error('design-gate: lifecycle chain must have at least two nodes')
  for (const node of chain) {
    if (!lifecycleNodes.has(node)) throw new Error(`design-gate: lifecycle chain references unknown node ${node}`)
    chainNodes.add(node)
  }
  for (let index = 1; index < chain.length; index += 1) chainEdgeKeys.add(`${chain[index - 1]}->${chain[index]}`)
}
if (chainNodes.size !== lifecycleNodes.size
  || [...lifecycleEdgeKeys].some(edge => !chainEdgeKeys.has(edge))
  || [...chainEdgeKeys].some(edge => !lifecycleEdgeKeys.has(edge))) {
  throw new Error('design-gate: lifecycle chains do not exactly bind the declared adjacent edges')
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
