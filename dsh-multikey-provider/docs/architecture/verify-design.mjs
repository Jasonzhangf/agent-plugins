import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const architecture = dirname(fileURLToPath(import.meta.url))
const root = join(architecture, '..', '..')
const packageDir = root

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
  if (registry.status !== 'design') throw new Error('design-gate: every design registry must have status=design')
}

const expectedPatches = [
  { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', disabled: true },
  { id: 'ui-settings-models', name: '@deepseek-ai/dsh-client-ui-settings-models', disabled: true },
  { insert: [{ id: 'llm-pi-ai-multikey', name: 'dsh-llm-pi-ai-multikey' }] },
]
if (JSON.stringify(composition.patches) !== JSON.stringify(expectedPatches)) {
  throw new Error('design-gate: composition patches must use the exact Cordis disable-plus-insert structure')
}
if (composition.restore.hot_reload_is_sufficient !== false) {
  throw new Error('design-gate: restore must require bundle removal plus restart')
}
if (composition.package !== 'dsh-llm-pi-ai-multikey'
  || composition.authoring_surface.directory !== 'dsh-multikey-provider'
  || composition.authoring_surface.package_identity_source !== 'package.json name') {
  throw new Error('design-gate: authoring directory and target package identity are not explicit')
}
const modelsExtension = composition.models_client_extension
if (modelsExtension?.owner_module !== 'client'
  || modelsExtension.entry_symbol !== 'src/client/index.ts#apply'
  || modelsExtension.registration_id !== 'settings.section:models'
  || modelsExtension.official_behavior_source
    !== 'installed official rc.6 wire contracts and package provenance; official client apply is not runtime-composable because the disabled client row is absent from the browser module graph'
  || modelsExtension.replacement_behavior
    !== 'official Models section behavior reimplemented on public settings/credentials/llm wire contracts plus alternate-key controls in the same section') {
  throw new Error('design-gate: Models client extension owner or registration contract is missing')
}
if (JSON.stringify(modelsExtension.forbidden_surfaces) !== JSON.stringify([
  'second Models section',
  'Plugins-only alternate-key editor',
  'private official source import',
])) {
  throw new Error('design-gate: Models client extension forbidden surfaces are not locked')
}
const baseline = composition.upstream_baseline
const baselineExpectations = {
  provider: {
    package: '@deepseek-ai/dsh-llm-pi-ai',
    version: '0.1.0-rc.6',
    artifact_sha256: 'a29d1a1aaaa513524315ee39b6a940d76082759d55bdee6a5b691f16cc620902',
    installed_artifacts: {
      'package.json': '81abcbc323881abff0f565be1aa749446c04731c748499cf98ede8d3cdc8f4dc',
      'lib/index.js': '61e0164ccb648cea986a869aa42a81fab2ce6b56538d8e187597084fc23c9d3a',
    },
    runtime_strategy: 'public entrypoint composition in replacement package',
  },
  models_client: {
    package: '@deepseek-ai/dsh-client-ui-settings-models',
    version: '0.1.0-rc.6',
    artifact_sha256: '43648b0891f71d9df32f05bee54c40d4c543f88d84a63e8cf4595519ad72d52a',
    installed_artifacts: {
      'package.json': 'f954c2aa977f9f588ca7e9fc8e6753784293f21da65907cb4c361905480f9553',
      'lib/client.js': '203a45293da9403be449e7452a155cba07d66a719c0b32d500f66cf0ba528f1d',
    },
    runtime_strategy: 'replacement client reimplementation over installed public wire contracts',
  },
}
const hashFile = async path => createHash('sha256').update(await readFile(path)).digest('hex')
for (const [key, expected] of Object.entries(baselineExpectations)) {
  const entry = baseline?.[key]
  if (entry?.package !== expected.package
    || entry.version !== expected.version
    || entry.artifact_sha256 !== expected.artifact_sha256
    || JSON.stringify(entry.installed_artifacts) !== JSON.stringify(expected.installed_artifacts)
    || entry.published_source !== 'compiled-only'
    || entry.runtime_strategy !== expected.runtime_strategy) {
    throw new Error(`design-gate: upstream baseline ${key} provenance is not locked`)
  }
  const installedPackage = JSON.parse(
    await readFile(join(packageDir, 'node_modules', expected.package, 'package.json'), 'utf8'),
  )
  if (installedPackage.version !== expected.version) {
    throw new Error(`design-gate: installed ${expected.package} version differs from baseline`)
  }
  for (const [relativePath, expectedHash] of Object.entries(expected.installed_artifacts ?? {})) {
    const actualHash = await hashFile(join(packageDir, 'node_modules', expected.package, relativePath))
    if (actualHash !== expectedHash) {
      throw new Error(`design-gate: installed artifact ${expected.package}/${relativePath} hash differs from baseline`)
    }
  }
}
if (JSON.stringify(baseline?.required_evidence) !== JSON.stringify([
  'official provider and Models packages pinned at exact rc.6 versions by package.json and committed pnpm-lockfile',
  'official Models package stays installed by profile composition and its installed package.json plus compiled client artifact hashes are machine-checked',
  'host imports only the @deepseek-ai/dsh-llm-pi-ai public entrypoint',
  'client uses only public wire contracts and imports no official client bundle or private source',
  'no official src/private file is imported or copied',
])) {
  throw new Error('design-gate: upstream baseline evidence contract is incomplete')
}

const lockfileRaw = await readFile(join(packageDir, 'pnpm-lock.yaml'), 'utf8')
for (const specifier of [
  '@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.6',
  '@deepseek-ai/dsh-client-ui-settings-models@0.1.0-rc.6',
]) {
  if (!lockfileRaw.includes(`'${specifier}':`)) {
    throw new Error(`design-gate: pnpm-lock.yaml does not pin ${specifier}`)
  }
}
const profileGates = composition.profile_gates
if (profileGates?.install?.dump_config_fixture
    !== 'docs/architecture/fixtures/installed-profile.dump-config.json'
  || profileGates?.restore?.dump_config_fixture
    !== 'docs/architecture/fixtures/restored-profile.dump-config.json'
  || profileGates.restore.hot_reload_is_evidence !== false) {
  throw new Error('design-gate: install/restore dump-config fixtures or restart requirement is missing')
}
const expectedOwnerCounts = {
  provider_routes: 1,
  'settings_namespace:llm-pi-ai': 1,
  'settings_section:models': 1,
}
if (JSON.stringify(profileGates.install.unique_owners) !== JSON.stringify(expectedOwnerCounts)
  || JSON.stringify(profileGates.restore.unique_owners) !== JSON.stringify(expectedOwnerCounts)) {
  throw new Error('design-gate: install/restore route, namespace, and Models owner counts are not exactly one')
}
const loadFixture = async fixture => JSON.parse(await readFile(join(root, fixture), 'utf8'))
const [installedFixture, restoredFixture] = await Promise.all([
  loadFixture(profileGates.install.dump_config_fixture),
  loadFixture(profileGates.restore.dump_config_fixture),
])
if (installedFixture.status !== 'design-fixture'
  || restoredFixture.status !== 'design-fixture') {
  throw new Error('design-gate: install/restore fixtures must have status=design-fixture')
}
if (JSON.stringify(installedFixture.unique_owner_counts) !== JSON.stringify(expectedOwnerCounts)
  || JSON.stringify(restoredFixture.unique_owner_counts) !== JSON.stringify(expectedOwnerCounts)) {
  throw new Error('design-gate: install/restore fixture route, namespace, and Models owner counts are not exactly one')
}
if (JSON.stringify(profileGates.install.required_entries)
    !== JSON.stringify(installedFixture.required_entries)
  || JSON.stringify(profileGates.restore.required_entries)
    !== JSON.stringify(restoredFixture.required_entries)
  || JSON.stringify(profileGates.restore.absent_entries)
    !== JSON.stringify(restoredFixture.absent_entries)) {
  throw new Error('design-gate: manifest install/restore entries drift from dump-config fixtures')
}
const entryTuple = entry => `${entry.id}|${entry.name}|${String(entry.disabled)}`
const installedEntries = new Map(installedFixture.required_entries.map(entry => [entry.id, entry]))
const restoredEntries = new Map(restoredFixture.required_entries.map(entry => [entry.id, entry]))
const expectedInstalledEntries = new Map([
  ['llm-pi-ai', { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', disabled: true }],
  ['ui-settings-models', { id: 'ui-settings-models', name: '@deepseek-ai/dsh-client-ui-settings-models', disabled: true }],
  ['llm-pi-ai-multikey', { id: 'llm-pi-ai-multikey', name: 'dsh-llm-pi-ai-multikey', disabled: false }],
])
for (const [id, expected] of expectedInstalledEntries) {
  if (entryTuple(installedEntries.get(id) ?? {}) !== entryTuple(expected)) {
    throw new Error(`design-gate: install fixture entry ${id} differs from exact expected tuple`)
  }
}
const expectedRestoredEntries = new Map([
  ['llm-pi-ai', { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', disabled: false }],
  ['ui-settings-models', { id: 'ui-settings-models', name: '@deepseek-ai/dsh-client-ui-settings-models', disabled: false }],
])
for (const [id, expected] of expectedRestoredEntries) {
  if (entryTuple(restoredEntries.get(id) ?? {}) !== entryTuple(expected)) {
    throw new Error(`design-gate: restore fixture entry ${id} differs from exact expected tuple`)
  }
}
if (restoredFixture.absent_entries.length !== 1
  || entryTuple(restoredFixture.absent_entries[0]) !== 'llm-pi-ai-multikey|dsh-llm-pi-ai-multikey|undefined') {
  throw new Error('design-gate: restore fixture replacement absence tuple is not exact')
}

const cordisPatchPath = join(packageDir, 'cordis.patch.yml')
const cordisPatchRaw = await readFile(cordisPatchPath, 'utf8')
const cordisPatchLines = cordisPatchRaw.split('\n').map(line => line.replace(/#.*$/u, '').replace(/\s+$/u, '')).filter(line => line.trim().length > 0)

function parseCordisPatches(lines) {
  const patches = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.startsWith('- ')) throw new Error(`design-gate: cordis.patch.yml has unrecognized top-level line: ${line}`)
    const inline = line.slice(2).trim()
    if (inline.startsWith('insert:')) {
      i += 1
      const entries = []
      while (i < lines.length && /^- id:/u.test(lines[i].trim())) {
        const firstInline = lines[i].trim()
        const record = { id: firstInline.match(/^-\s*id:\s*(\S+)/u)?.[1] }
        i += 1
        while (i < lines.length && lines[i].startsWith('  ') && !/^- id:/u.test(lines[i].trim())) {
          const part = lines[i].trim()
          const nameMatch = part.match(/^name:\s*['"]?([^'"]+)['"]?$/u)
          if (nameMatch) record.name = nameMatch[1]
          i += 1
        }
        entries.push(record)
      }
      patches.push({ insert: entries })
      continue
    }
    if (inline.startsWith('id:')) {
      const record = { id: inline.match(/^id:\s*(\S+)/u)?.[1] }
      i += 1
      while (i < lines.length && (lines[i].startsWith('  ') && !lines[i].startsWith('- '))) {
        const part = lines[i].trim()
        if (part.startsWith('name:')) record.name = part.match(/^name:\s*['"]?([^'"]+)['"]?$/u)?.[1]
        else if (part.startsWith('disabled:')) record.disabled = part.endsWith('true')
        else break
        i += 1
      }
      patches.push(record)
      continue
    }
    throw new Error(`design-gate: cordis.patch.yml has unrecognized patch entry: ${inline}`)
  }
  return patches
}

const cordisParsed = parseCordisPatches(cordisPatchLines)
if (JSON.stringify(cordisParsed) !== JSON.stringify(expectedPatches)) {
  throw new Error('design-gate: cordis.patch.yml parsed shape does not match composition patches')
}
const forbiddenCordisMarkers = [
  'id: multikey-provider',
  'name: dsh-multikey-provider',
  'pools: []',
]
for (const marker of forbiddenCordisMarkers) {
  if (cordisPatchRaw.includes(marker)) {
    throw new Error(`design-gate: cordis.patch.yml still encodes forbidden legacy marker "${marker}"`)
  }
}

const packageJsonPath = join(packageDir, 'package.json')
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
if (packageJson.name !== composition.package) {
  throw new Error(`design-gate: package.json#name=${packageJson.name} does not match composition.package=${composition.package}`)
}
for (const required of ['@deepseek-ai/dsh-llm-pi-ai', '@deepseek-ai/dsh-client-ui-settings-models']) {
  if (!packageJson.dependencies?.[required] || !packageJson.peerDependencies?.[required] || !packageJson.devDependencies?.[required]) {
    throw new Error(`design-gate: package.json does not declare ${required} in dependencies, peerDependencies, and devDependencies`)
  }
}
const requiredScripts = verification.active_gate_contract.check_chain.split(',').map(s => s.trim())
for (const script of requiredScripts) {
  if (typeof packageJson.scripts?.[script] !== 'string') {
    throw new Error(`design-gate: package.json#scripts.${script} is missing`)
  }
}
if (!packageJson.scripts.check.includes('pnpm run lint') || !packageJson.scripts.check.includes('pnpm run test:coverage')) {
  throw new Error('design-gate: package.json#scripts.check does not invoke lint and test:coverage')
}

const expectedLegacyReplacement = {
  authoring_directory: 'dsh-multikey-provider',
  target_package_name: 'dsh-llm-pi-ai-multikey',
  status: 'physical-replacement-pending',
  replace_paths: [
    'src/adapter.ts',
    'src/client/index.ts',
    'src/client/locales.ts',
    'src/client/slots.ts',
    'src/index.ts',
    'src/invariant.ts',
  ],
  delete_paths: [
    'src/admin.ts',
    'src/catalog.ts',
    'src/client/MultiKeySettings.tsx',
    'src/compiler.ts',
    'src/health.ts',
    'src/probe.ts',
    'src/rpc.ts',
    'src/scheduler.ts',
    'README.md',
    '.github/workflows/ci.yml',
  ],
}
const legacy = modules.legacy_replacement_plan
for (const field of ['authoring_directory', 'target_package_name', 'status']) {
  if (legacy[field] !== expectedLegacyReplacement[field]) {
    throw new Error(`design-gate: legacy replacement ${field} differs from the approved transition`)
  }
}
for (const field of ['replace_paths', 'delete_paths']) {
  if (JSON.stringify(legacy[field]) !== JSON.stringify(expectedLegacyReplacement[field])) {
    throw new Error(`design-gate: legacy replacement ${field} is incomplete`)
  }
}
const transitionPaths = [...legacy.replace_paths, ...legacy.delete_paths]
if (new Set(transitionPaths).size !== transitionPaths.length) {
  throw new Error('design-gate: a legacy path has more than one transition action')
}
for (const path of legacy.replace_paths) {
  const owners = modules.modules.filter(module => module.owned_paths.some(pattern => (
    pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -3)) : pattern === path
  )))
  if (owners.length !== 1) throw new Error(`design-gate: replacement path ${path} has ${owners.length} target owners`)
}
if (legacy.source_fork_paths !== undefined) {
  throw new Error('design-gate: source-fork paths are forbidden by the public-entrypoint composition')
}
if (!legacy.activation_requirements.some(requirement => requirement.includes('public provider entrypoint'))) {
  throw new Error('design-gate: activation requirements do not lock public-provider/client-wire composition')
}

const activeContract = verification.active_gate_contract
if (activeContract.package_name !== composition.package
  || activeContract.check_chain !== 'verify:architecture, typecheck, lint, test:coverage, build'
  || activeContract.control_owner_path !== 'src/control.ts'
  || activeContract.secret_control_owner_path !== 'src/secret-control.ts') {
  throw new Error('design-gate: active gate contract does not match target package/control owners')
}
if (activeContract.official_extension_contract
    !== 'host composes only the public @deepseek-ai/dsh-llm-pi-ai entrypoint; client uses only public wire contracts; private src imports and copied official source are rejected') {
  throw new Error('design-gate: official public-entrypoint boundary is not locked')
}
if (JSON.stringify(activeContract.forbidden_legacy_paths) !== JSON.stringify(legacy.delete_paths)) {
  throw new Error('design-gate: active gate does not forbid every legacy delete path')
}
if (verification.build_entrypoints.design_ci !== '.github/workflows/dsh-multikey-provider-design.yml') {
  throw new Error('design-gate: design CI entrypoint is not declared')
}

const owns = (pattern, path) => pattern.endsWith('/**')
  ? path.startsWith(pattern.slice(0, -3))
  : pattern === path
const moduleOf = path => modules.modules.filter(module => module.owned_paths.some(pattern => owns(pattern, path)))
const sourceEdges = new Set(modules.allowed_import_edges.map(edge => edge.join('->')))
const mountEdges = new Set(modules.allowed_mount_edges.map(edge => edge.join('->')))
const controlEdges = new Set(modules.allowed_control_edges.map(edge => edge.join('->')))

const resourceIds = new Set(resources.resources.map(resource => resource.resource_id))
for (const resourceId of Object.keys(expectedOwnerCounts)) {
  if (!resourceIds.has(resourceId)) {
    throw new Error(`design-gate: owner-count resource ${resourceId} is missing from resource-registry`)
  }
}
const featureIds = new Set(functions.features.map(feature => feature.feature_id))
const verificationIds = new Set(Object.keys(verification.features))
if (featureIds.size !== verificationIds.size || [...featureIds].some(id => !verificationIds.has(id))) {
  throw new Error('design-gate: function and verification feature ids differ')
}

const symbolKeys = new Set()
for (const feature of functions.features) {
  for (const resourceId of feature.resource_ids) {
    if (!resourceIds.has(resourceId)) throw new Error(`design-gate: missing resource ${resourceId}`)
  }
  for (const entry of feature.entry_symbols) {
    if (entry.status !== 'binding-pending') throw new Error(`design-gate: ${entry.path}#${entry.symbol} must be binding-pending`)
    const key = `${entry.path}#${entry.symbol}`
    if (symbolKeys.has(key)) throw new Error(`design-gate: duplicate symbol owner ${key}`)
    symbolKeys.add(key)
    const owners = modules.modules.filter(module => module.owned_paths.some(pattern => owns(pattern, entry.path)))
    if (owners.length !== 1) {
      throw new Error(`design-gate: entry symbol ${entry.path}#${entry.symbol} has ${owners.length} module owners`)
    }
    const ownerModulesByFeature = {
      'replacement.composition': ['composition'],
      'replacement.official-baseline': ['entry', 'official-provider'],
      'replacement.key-pool': ['config', 'key-pool'],
      'replacement.credentials': ['credential'],
      'replacement.adapter': ['adapter'],
      'replacement.control': ['control'],
      'replacement.secret-control': ['secret-control'],
      'replacement.models-client': ['client'],
      'replacement.restore': ['operations'],
    }
    const ownerModules = ownerModulesByFeature[feature.feature_id]
    if (ownerModules === undefined || !ownerModules.includes(owners[0].module_id)) {
      throw new Error(`design-gate: feature ${feature.feature_id} does not own ${entry.path}#${entry.symbol}`)
    }
  }
}
for (const resourceId of Object.keys(expectedOwnerCounts)) {
  if (!functions.features.some(feature => feature.resource_ids.includes(resourceId))) {
    throw new Error(`design-gate: owner-count resource ${resourceId} is not bound to a feature`)
  }
}

for (const edge of calls.edges) {
  if (!featureIds.has(edge.feature_id)) throw new Error(`design-gate: unknown feature ${edge.feature_id}`)
  for (const endpoint of [edge.caller, edge.callee]) {
    if (endpoint.status !== 'binding-pending') throw new Error(`design-gate: ${edge.node_id} endpoint must be binding-pending`)
    if (!symbolKeys.has(`${endpoint.path}#${endpoint.symbol}`)) {
      throw new Error(`design-gate: unbound call-map symbol ${endpoint.path}#${endpoint.symbol}`)
    }
    const owners = moduleOf(endpoint.path)
    if (owners.length !== 1) throw new Error(`design-gate: ${endpoint.path} has ${owners.length} module owners`)
  }
  const from = moduleOf(edge.caller.path)[0].module_id
  const to = moduleOf(edge.callee.path)[0].module_id
  if (from === to) continue
  if (edge.edge_kind === 'source-call' && !sourceEdges.has(`${from}->${to}`)) {
    throw new Error(`design-gate: undeclared source edge ${from}->${to}`)
  }
  if (edge.edge_kind === 'composition-mount' && !mountEdges.has(`${from}->${to}`)) {
    throw new Error(`design-gate: undeclared mount edge ${from}->${to}`)
  }
  if (edge.edge_kind === 'control-side-channel' && !controlEdges.has(`${from}->${to}`)) {
    throw new Error(`design-gate: undeclared control edge ${from}->${to}`)
  }
  if (!['source-call', 'composition-mount', 'control-side-channel', 'operations-sequence'].includes(edge.edge_kind)) {
    throw new Error(`design-gate: invalid edge kind ${edge.edge_kind}`)
  }
}

const lifecycleNodes = [...lifecycle.nodes].sort()
const edgeNodes = [...new Set(lifecycle.edges.flat())].sort()
const callNodes = calls.edges.map(edge => edge.node_id).sort()
if (lifecycle.graph_semantics.call_map_binding
    !== 'each lifecycle node id binds exactly one internal implementation edge with the same node_id'
  || lifecycle.graph_semantics.layering
    !== 'lifecycle stage transitions and call-map implementation edges are distinct graph layers') {
  throw new Error('design-gate: lifecycle and call-map graph layering is not explicit')
}
if (JSON.stringify(lifecycleNodes) !== JSON.stringify(edgeNodes)
  || JSON.stringify(lifecycleNodes) !== JSON.stringify(callNodes)) {
  throw new Error('design-gate: lifecycle nodes, lifecycle edges, and call-map nodes differ')
}
if (JSON.stringify(composition.restore.steps) !== JSON.stringify([
  'RestoreIn01RemoveBundle',
  'RestoreIn02RestartDsh',
  'RestoreOut01VerifyOfficialOwners',
  'RestoreOut02ReplayOfficialPaths',
])) {
  throw new Error('design-gate: composition restore steps differ from the restore lifecycle')
}

for (const document of new Set([...composition.canonical_docs, ...lifecycle.canonical_docs])) {
  const resolved = normalize(join(root, document))
  if (relative(root, resolved).startsWith('..')) throw new Error(`design-gate: document escapes package root: ${document}`)
  await readFile(resolved)
}

const designWorkflow = await readFile(join(root, '..', verification.build_entrypoints.design_ci), 'utf8')
if (!designWorkflow.includes('node dsh-multikey-provider/docs/architecture/verify-design.mjs')) {
  throw new Error('design-gate: design workflow does not execute the design gate')
}
if (!designWorkflow.includes("'dsh-multikey-provider/cordis.patch.yml'")
  || !designWorkflow.includes("'dsh-multikey-provider/package.json'")) {
  throw new Error('design-gate: design workflow does not retrigger on patch or package changes')
}
const mainWorkflow = await readFile(join(root, '..', '.github/workflows/dsh-multikey-provider.yml'), 'utf8')
if (!mainWorkflow.includes('node dsh-multikey-provider/docs/architecture/verify-design.mjs')) {
  throw new Error('design-gate: main CI workflow does not execute the design gate at a valid repo-root path')
}
if (!mainWorkflow.includes('dsh-multikey-provider/docs/architecture/composition-manifest.json')) {
  throw new Error('design-gate: main CI workflow does not reference composition-manifest.json at a valid repo-root path')
}
const activeGate = await readFile(join(root, 'scripts', 'verify-architecture.mjs'), 'utf8')
if (activeGate.includes("join(root, 'src/rpc.ts')")
  || !activeGate.includes('active_gate_contract.control_owner_path')
  || !activeGate.includes('active_gate_contract.secret_control_owner_path')
  || !activeGate.includes('official-entrypoint-gate')) {
  throw new Error('design-gate: active gate is not aligned to the target control owners')
}
const resourceReferences = new Map()
for (const feature of functions.features) {
  for (const resourceId of feature.resource_ids) {
    const owners = resourceReferences.get(resourceId) ?? []
    owners.push(feature.feature_id)
    resourceReferences.set(resourceId, owners)
  }
}
for (const resource of resources.resources) {
  if ((resourceReferences.get(resource.resource_id) ?? []).length === 0) {
    throw new Error(`design-gate: resource ${resource.resource_id} is orphaned from function-map`)
  }
}

console.log(`LEGACY_SOURCE_INVENTORY: replace=${legacy.replace_paths.join(',')} delete=${legacy.delete_paths.join(',')}`)
console.log('DESIGN_GATE: PASS')
