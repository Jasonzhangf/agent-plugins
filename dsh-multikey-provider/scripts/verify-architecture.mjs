import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const root = new URL('..', import.meta.url).pathname
const docs = {
  composition: 'docs/architecture/composition-manifest.json',
  resources: 'docs/architecture/resource-registry.json',
  modules: 'docs/architecture/module-registry.json',
  functions: 'docs/architecture/function-map.json',
  calls: 'docs/architecture/mainline-call-map.json',
  verification: 'docs/architecture/verification-map.json',
  lifecycle: 'docs/architecture/lifecycle.json',
  upstream: 'docs/architecture/upstream-delta.json',
}

async function json(path) {
  const value = JSON.parse(await readFile(join(root, path), 'utf8'))
  if (value.status !== 'active') throw new Error(`registry-gate: ${path} is not active`)
  return value
}

async function filesUnder(path) {
  const result = []
  const skip = new Set(['node_modules', '.git', 'test-dist', 'lib', '.DS_Store'])
  const queue = [path]
  while (queue.length > 0) {
    const current = queue.shift()
    let entries
    try {
      entries = await readdir(current)
    } catch (error) {
      throw new Error(`registry-gate: cannot enumerate ${relative(root, current)}: ${error.message}`)
    }
    for (const entry of entries) {
      if (skip.has(entry)) continue
      const full = join(current, entry)
      let s
      try {
        s = await stat(full)
      } catch (error) {
        throw new Error(`registry-gate: cannot inspect ${relative(root, full)}: ${error.message}`)
      }
      if (s.isDirectory()) queue.push(full)
      else result.push(relative(root, full))
    }
  }
  return result
}

function owns(pattern, path) {
  return pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -3)) : pattern === path
}

function moduleOf(registry, path) {
  return registry.modules.filter(module => module.owned_paths.some(pattern => owns(pattern, path)))
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function localImports(source, path) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const imports = []
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text.startsWith('.')) {
      imports.push(node.moduleSpecifier.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return imports
}

async function resolveLocalImport(path, specifier) {
  const raw = resolve(root, dirname(path), specifier)
  const stem = raw.replace(/\.(?:js|mjs|cjs)$/u, '')
  for (const candidate of [raw, `${stem}.ts`, `${stem}.tsx`, join(stem, 'index.ts'), join(stem, 'index.tsx')]) {
    if (await exists(candidate)) return relative(root, candidate)
  }
  throw new Error(`registry-gate: unresolved local import ${path} -> ${specifier}`)
}

function declaredSymbols(source, path) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const symbols = new Set()
  const visit = (node, owner) => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
      || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name !== undefined) {
      symbols.add(node.name.text)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) symbols.add(node.name.text)
    const nextOwner = ts.isClassDeclaration(node) && node.name !== undefined ? node.name.text : owner
    if (nextOwner !== undefined && (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node))
      && node.name !== undefined && ts.isIdentifier(node.name)) {
      symbols.add(`${nextOwner}.${node.name.text}`)
    }
    ts.forEachChild(node, child => visit(child, nextOwner))
  }
  visit(file, undefined)
  return symbols
}

function bindsPseudoSymbol(path, symbol, source) {
  if (path === 'cordis.patch.yml') {
    const required = {
      'plugin additive insert': [
        'id: multikey-provider',
        'name: dsh-multikey-provider',
      ],
    }[symbol]
    return required !== undefined && required.every(marker => source.includes(marker))
  }
  if (path === 'docs/architecture/rust-migration-plan.md') {
    const required = {
      'staged rust migration plan': [
        '# Rust Migration Plan',
        'rust-target',
        'replacement.rust-migration',
      ],
    }[symbol]
    return required !== undefined && required.every(marker => source.includes(marker))
  }
  if (path === 'scripts/verify-architecture.mjs' && symbol === 'registry gate') {
    return source.includes('const auditedFiles =')
      && source.includes('REGISTRY_GATE: PASS')
  }
  return false
}

async function bindsSymbol(path, symbol) {
  const source = await readFile(join(root, path), 'utf8')
  if (bindsPseudoSymbol(path, symbol, source)) return true
  return declaredSymbols(source, path).has(symbol)
}

const [composition, resources, modules, functions, calls, verification, lifecycle] = await Promise.all([
  json(docs.composition),
  json(docs.resources),
  json(docs.modules),
  json(docs.functions),
  json(docs.calls),
  json(docs.verification),
  json(docs.lifecycle),
  json(docs.upstream),
])

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (packageJson.name !== composition.package || packageJson.name !== verification.active_gate_contract.package_name) {
  throw new Error('registry-gate: package identity does not match the active composition')
}
const buildConfig = await readFile(join(root, 'tsdown.config.ts'), 'utf8')
if (!buildConfig.includes("readFileSync(new URL('./package.json', import.meta.url)")
  || !buildConfig.includes('const ID = packageMetadata.name')) {
  throw new Error('registry-gate: client loader id must come from package.json')
}
if (packageJson.scripts?.prebuild !== 'pnpm run verify:architecture') {
  throw new Error('registry-gate: prebuild does not run architecture verification')
}
for (const script of ['verify:architecture', 'typecheck', 'lint', 'test:coverage', 'build', 'verify:pack']) {
  if (typeof packageJson.scripts?.[script] !== 'string') {
    throw new Error(`registry-gate: package script ${script} is missing`)
  }
  if (script !== 'verify:architecture' && !packageJson.scripts.check.includes(`pnpm run ${script}`)) {
    throw new Error(`registry-gate: check does not run ${script}`)
  }
}

for (const path of verification.active_gate_contract.forbidden_legacy_paths) {
  try {
    await stat(join(root, path))
  } catch (error) {
    if (error?.code === 'ENOENT') continue
    throw error
  }
  throw new Error(`registry-gate: forbidden legacy path remains: ${path}`)
}

const auditedFiles = (await filesUnder(join(root, '.'))).filter(path => {
  if (/^(?:lib|node_modules|test-dist|coverage)\//u.test(path)) return false
  return /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(path)
})
for (const path of auditedFiles) {
  const owners = moduleOf(modules, path)
  if (owners.length !== 1) throw new Error(`registry-gate: ${path} has ${String(owners.length)} module owners`)
}

// Active modules own present runtime paths. Design modules describe future paths and
// are checked for registry consistency without pretending their implementation exists.
async function pathExists(p) { try { await stat(p); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error } }
for (const mod of modules.modules) {
  if (mod.status === 'design') continue
  for (const p of mod.owned_paths ?? []) {
    if (p.endsWith('/**')) {
      const dir = p.slice(0, -3)
      if (!(await pathExists(join(root, dir)))) throw new Error(`registry-gate: module ${mod.module_id} owns missing path ${p}`)
    } else if (!(await pathExists(join(root, p)))) {
      throw new Error(`registry-gate: module ${mod.module_id} owns missing path ${p}`)
    }
  }
  // forbidden_paths are declarative: they describe resources outside this module's
  // ownership. The hard rule they enforce is on imports (see allowed_import_modules
  // and allowed_import_edges), not on filesystem existence.
}
for (const feat of functions.features) {
  const mod = modules.modules.find(m => m.module_id === feat.owner)
  if (mod === undefined) throw new Error(`registry-gate: feature ${feat.feature_id} owner ${feat.owner} is not a known module`)
  if (JSON.stringify(mod.allowed_paths) !== JSON.stringify(feat.allowed_paths)) {
    throw new Error(`registry-gate: feature ${feat.feature_id} allowed_paths drift from module ${mod.module_id}`)
  }
  if (JSON.stringify(mod.forbidden_paths) !== JSON.stringify(feat.forbidden_paths)) {
    throw new Error(`registry-gate: feature ${feat.feature_id} forbidden_paths drift from module ${mod.module_id}`)
  }
}
// forbidden_paths must not include any path this module itself owns (a module cannot
// forbid what it owns); cross-module duplications are the single-owner rule's
// concern, not this gate's.
// CI workflow files referenced by any module must be owned by the ci module.
for (const mod of modules.modules) {
  for (const p of mod.owned_paths ?? []) {
    if (/\.github\/workflows\//.test(p)) {
      const ci = modules.modules.find(m => m.module_id === 'ci')
      if (ci === undefined || !(ci.owned_paths ?? []).includes(p)) {
        throw new Error(`registry-gate: ${p} is owned by ${mod.module_id} but ci module does not own it`)
      }
    }
  }
}
const ciModule = modules.modules.find(m => m.module_id === 'ci')
if (ciModule === undefined || (ciModule.owned_paths ?? []).length === 0) {
  throw new Error('registry-gate: ci module must own at least one .github/workflows file')
}

const featureIds = new Set(functions.features.map(feature => feature.feature_id))
if (featureIds.size !== Object.keys(verification.features).length
  || [...featureIds].some(id => verification.features[id] === undefined)) {
  throw new Error('registry-gate: function and verification feature ids differ')
}
for (const feature of functions.features) {
  for (const resourceId of [...feature.resource_ids, ...feature.related_resource_ids]) {
    if (!resources.resources.some(resource => resource.resource_id === resourceId)) {
      throw new Error(`registry-gate: missing resource ${resourceId}`)
    }
  }
  if (feature.status === 'design') continue
  for (const entry of feature.entry_symbols) {
    if (entry.status !== 'active') throw new Error(`registry-gate: inactive symbol ${entry.path}#${entry.symbol}`)
    if (!await bindsSymbol(entry.path, entry.symbol)) {
      throw new Error(`registry-gate: missing symbol ${entry.path}#${entry.symbol}`)
    }
  }
}

const allowedEdges = new Set(modules.allowed_import_edges.map(edge => edge.join('->')))
for (const path of auditedFiles) {
  const owner = moduleOf(modules, path)[0]
  const source = await readFile(join(root, path), 'utf8')
  for (const specifier of localImports(source, path)) {
    const targetPath = await resolveLocalImport(path, specifier)
    const targetOwners = moduleOf(modules, targetPath)
    if (targetOwners.length !== 1) {
      throw new Error(`registry-gate: imported ${targetPath} has ${String(targetOwners.length)} module owners`)
    }
    const targetOwner = targetOwners[0]
    if (targetOwner.module_id === owner.module_id) continue
    if (!allowedEdges.has(`${owner.module_id}->${targetOwner.module_id}`)) {
      throw new Error(`registry-gate: undeclared import edge ${owner.module_id}->${targetOwner.module_id} (${path} -> ${targetPath})`)
    }
  }
}

const gateIds = new Set(verification.gates.map(gate => gate.gate_id))
for (const feature of functions.features) {
  const mapped = verification.features[feature.feature_id]
  if (JSON.stringify(feature.required_gates) !== JSON.stringify(mapped)) {
    throw new Error(`registry-gate: verification mapping differs for ${feature.feature_id}`)
  }
  for (const gateId of feature.required_gates) {
    if (!gateIds.has(gateId)) throw new Error(`registry-gate: missing required gate ${gateId}`)
  }
}
const lifecycleGateIds = new Set(lifecycle.verification_gates)
for (const gate of verification.gates) {
  if (gate.status === 'active' && !lifecycleGateIds.has(gate.gate_id)) {
    throw new Error(`registry-gate: active gate ${gate.gate_id} is missing from lifecycle.verification_gates`)
  }
}
for (const gate of verification.gates) {
  if (!featureIds.has(gate.feature_id)) throw new Error(`registry-gate: gate ${gate.gate_id} has unknown feature`)
  if (gate.phase === 'implementation' && gate.status !== 'active') {
    throw new Error(`registry-gate: implementation gate ${gate.gate_id} is not active`)
  }
  for (const resourceId of gate.resource_ids) {
    if (!resources.resources.some(resource => resource.resource_id === resourceId)) {
      throw new Error(`registry-gate: gate ${gate.gate_id} has unknown resource ${resourceId}`)
    }
  }
  for (const target of gate.test_targets) {
    if (!await exists(join(root, target))) throw new Error(`registry-gate: gate target is missing: ${target}`)
  }
}

for (const edge of calls.edges) {
  if (!lifecycle.nodes.includes(edge.node_id)) throw new Error(`registry-gate: missing lifecycle node ${edge.node_id}`)
  for (const endpoint of [edge.caller, edge.callee]) {
    if (endpoint.status !== 'active') throw new Error(`registry-gate: inactive call endpoint ${endpoint.path}#${endpoint.symbol}`)
    if (!await bindsSymbol(endpoint.path, endpoint.symbol)) {
      throw new Error(`registry-gate: missing call-map symbol ${endpoint.path}#${endpoint.symbol}`)
    }
  }
}

const lifecycleNodes = [...lifecycle.nodes].sort()
const lifecycleEdgeNodes = [...new Set(lifecycle.edges.flat())].sort()
const callMapNodes = calls.edges.map(edge => edge.node_id).sort()
if (lifecycle.graph_semantics.call_map_binding
    !== 'each lifecycle node id binds exactly one internal implementation edge with the same node_id'
  || lifecycle.graph_semantics.layering
    !== 'lifecycle stage transitions and call-map implementation edges are distinct graph layers'
  || JSON.stringify(lifecycleNodes) !== JSON.stringify(lifecycleEdgeNodes)
  || JSON.stringify(lifecycleNodes) !== JSON.stringify(callMapNodes)
  || new Set(lifecycle.nodes).size !== lifecycle.nodes.length
  || new Set(callMapNodes).size !== callMapNodes.length
  || !lifecycle.nodes.includes(lifecycle.entrypoint)
  || !lifecycle.nodes.includes(lifecycle.return_path)) {
  throw new Error('registry-gate: lifecycle stage graph and call-map node bindings differ')
}

const runtimeSourceFiles = auditedFiles.filter(path => path.startsWith('src/'))
const allSource = await Promise.all(runtimeSourceFiles.map(path => readFile(join(root, path), 'utf8')))
const joinedSource = allSource.join('\n')
for (const marker of ['multikey/', "settingsNamespace('llm-pi-ai')", '/multikey/api']) {
  if (joinedSource.includes(marker)) throw new Error(`registry-gate: forbidden legacy semantic ${marker}`)
}
if (/options\.request\.(?:metadata|key|health|retry|providerSelection)\s*=/u.test(joinedSource)) {
  throw new Error('payload-isolation: control assignment into request')
}
for (const marker of ['business.metadata', 'multikey.key.selected', 'credential.value']) {
  if (joinedSource.includes(marker)) throw new Error(`payload-isolation: forbidden marker ${marker}`)
}
for (const path of ['src/provider.ts', 'src/context.ts', 'src/stream.ts', 'src/replay.ts', 'src/discovery.ts']) {
  if (runtimeSourceFiles.includes(path)) throw new Error(`official-entrypoint-gate: copied official source ${path}`)
}
for (const official of ['@deepseek-ai/dsh-llm-pi-ai', '@deepseek-ai/dsh-client-ui-settings-models']) {
  if (joinedSource.includes("from '" + official)) {
    throw new Error(`source-independence-gate: runtime source imports official package ${official}`)
  }
}
if (!joinedSource.includes('@earendil-works/pi-ai')) {
  throw new Error('source-independence-gate: runtime provider must use @earendil-works/pi-ai')
}

const control = await readFile(join(root, verification.active_gate_contract.control_owner_path), 'utf8')
const secretControlPath = verification.active_gate_contract.secret_control_owner_path
if (!control.includes('MultiKeyControl')) {
  throw new Error('control-gate: typed control owners are missing')
}
if (/GenerateOptions|StreamChunk|session\.event|business\.llm-(?:request|response)/u.test(control)) {
  throw new Error('control-gate: control owner references a business payload type')
}
if (typeof secretControlPath === 'string') {
  const secretControl = await readFile(join(root, secretControlPath), 'utf8')
  if (!secretControl.includes('MultiKeySecretControl')) {
    throw new Error('control-gate: typed control owners are missing')
  }
  if (/GenerateOptions|StreamChunk|session\.event|business\.llm-(?:request|response)/u.test(secretControl)) {
    throw new Error('control-gate: control owner references a business payload type')
  }
}

console.log('REGISTRY_GATE: PASS')
