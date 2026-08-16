import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
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
}

async function json(path) {
  const value = JSON.parse(await readFile(join(root, path), 'utf8'))
  if (value.status !== 'active') throw new Error(`registry-gate: ${path} is not active`)
  return value
}

async function filesUnder(path) {
  const result = []
  for (const entry of await readdir(path)) {
    const full = join(path, entry)
    if ((await stat(full)).isDirectory()) result.push(...await filesUnder(full))
    else result.push(relative(root, full))
  }
  return result
}

function owns(pattern, path) {
  return pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -3)) : pattern === path
}

function moduleOf(registry, path) {
  return registry.modules.filter(module => module.owned_paths.some(pattern => owns(pattern, path)))
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
  if (path !== 'cordis.patch.yml') return false
  const required = {
    'official provider exact-name disable': [
      'id: llm-pi-ai',
      "name: '@deepseek-ai/dsh-llm-pi-ai'",
      'disabled: true',
    ],
    'official Models exact-name disable': [
      'id: ui-settings-models',
      "name: '@deepseek-ai/dsh-client-ui-settings-models'",
      'disabled: true',
    ],
    'replacement independent insert': [
      'id: llm-pi-ai-multikey',
      'name: dsh-llm-pi-ai-multikey',
    ],
  }[symbol]
  return required !== undefined && required.every(marker => source.includes(marker))
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
])

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (packageJson.name !== composition.package || packageJson.name !== verification.active_gate_contract.package_name) {
  throw new Error('registry-gate: package identity does not match the active composition')
}
if (packageJson.scripts?.prebuild !== 'pnpm run verify:architecture') {
  throw new Error('registry-gate: prebuild does not run architecture verification')
}
for (const script of ['verify:architecture', 'typecheck', 'lint', 'test:coverage', 'build']) {
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

const sourceFiles = (await filesUnder(join(root, 'src'))).filter(path => /\.tsx?$/u.test(path))
for (const path of sourceFiles) {
  const owners = moduleOf(modules, path)
  if (owners.length !== 1) throw new Error(`registry-gate: ${path} has ${String(owners.length)} module owners`)
}

const featureIds = new Set(functions.features.map(feature => feature.feature_id))
if (featureIds.size !== Object.keys(verification.features).length
  || [...featureIds].some(id => verification.features[id] === undefined)) {
  throw new Error('registry-gate: function and verification feature ids differ')
}
for (const feature of functions.features) {
  for (const resourceId of feature.resource_ids) {
    if (!resources.resources.some(resource => resource.resource_id === resourceId)) {
      throw new Error(`registry-gate: missing resource ${resourceId}`)
    }
  }
  for (const entry of feature.entry_symbols) {
    if (entry.status !== 'active') throw new Error(`registry-gate: inactive symbol ${entry.path}#${entry.symbol}`)
    if (!await bindsSymbol(entry.path, entry.symbol)) {
      throw new Error(`registry-gate: missing symbol ${entry.path}#${entry.symbol}`)
    }
  }
}

const allowedEdges = new Set(modules.allowed_import_edges.map(edge => edge.join('->')))
for (const path of sourceFiles) {
  const owner = moduleOf(modules, path)[0]
  const source = await readFile(join(root, path), 'utf8')
  for (const match of source.matchAll(/from ['"](\.\.?\/[^'"]+)['"]/gu)) {
    const target = new URL(match[1], `file://${join(root, path)}`).pathname
    const targetPath = relative(root, target)
    const targetOwner = moduleOf(modules, targetPath)[0]
    if (targetOwner === undefined || targetOwner.module_id === owner.module_id) continue
    if (!allowedEdges.has(`${owner.module_id}->${targetOwner.module_id}`)) {
      throw new Error(`registry-gate: undeclared import edge ${owner.module_id}->${targetOwner.module_id} (${path})`)
    }
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
  || JSON.stringify(lifecycleNodes) !== JSON.stringify(callMapNodes)) {
  throw new Error('registry-gate: lifecycle stage graph and call-map node bindings differ')
}

const allSource = await Promise.all(sourceFiles.map(path => readFile(join(root, path), 'utf8')))
const joinedSource = allSource.join('\n')
for (const marker of ['multikey/', "settingsNamespace('multikey-provider')", '/multikey/api']) {
  if (joinedSource.includes(marker)) throw new Error(`registry-gate: forbidden legacy semantic ${marker}`)
}
if (/options\.request\.(?:metadata|key|health|retry|providerSelection)\s*=/u.test(joinedSource)) {
  throw new Error('payload-isolation: control assignment into request')
}
for (const marker of ['business.metadata', 'multikey.key.selected', 'credential.value']) {
  if (joinedSource.includes(marker)) throw new Error(`payload-isolation: forbidden marker ${marker}`)
}
for (const marker of [
  '@deepseek-ai/dsh-llm-pi-ai/src/',
  '@deepseek-ai/dsh-client-ui-settings-models/src/',
]) {
  if (joinedSource.includes(marker)) throw new Error(`official-entrypoint-gate: runtime private import ${marker}`)
}
for (const path of ['src/provider.ts', 'src/context.ts', 'src/stream.ts', 'src/replay.ts', 'src/discovery.ts']) {
  if (sourceFiles.includes(path)) throw new Error(`official-entrypoint-gate: copied official source ${path}`)
}
if (!joinedSource.includes("from '@deepseek-ai/dsh-llm-pi-ai'")
  || !joinedSource.includes("from '@deepseek-ai/dsh-client-ui-settings-models/client'")) {
  throw new Error('official-entrypoint-gate: public host/client entrypoints are not both composed')
}

const control = await readFile(join(root, verification.active_gate_contract.control_owner_path), 'utf8')
const secretControl = await readFile(join(root, verification.active_gate_contract.secret_control_owner_path), 'utf8')
if (!control.includes('MultiKeyControl') || !secretControl.includes('MultiKeySecretControl')) {
  throw new Error('control-gate: typed control owners are missing')
}
for (const source of [control, secretControl]) {
  if (/GenerateOptions|StreamChunk|session\.event|business\.llm-(?:request|response)/u.test(source)) {
    throw new Error('control-gate: control owner references a business payload type')
  }
}

console.log('REGISTRY_GATE: PASS')
