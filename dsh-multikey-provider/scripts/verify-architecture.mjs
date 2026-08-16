import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import ts from 'typescript'

const root = new URL('..', import.meta.url).pathname
const documentPaths = {
  composition: 'docs/architecture/composition-manifest.json',
  resources: 'docs/architecture/resource-registry.json',
  modules: 'docs/architecture/module-registry.json',
  functions: 'docs/architecture/function-map.json',
  calls: 'docs/architecture/mainline-call-map.json',
  verification: 'docs/architecture/verification-map.json',
  lifecycle: 'docs/architecture/lifecycle.json',
}

async function load(path) {
  const value = JSON.parse(await readFile(join(root, path), 'utf8'))
  if (value.status !== 'active') throw new Error(`registry-gate: ${path} is not active`)
  return value
}

async function filesUnder(path) {
  const result = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) result.push(...await filesUnder(full))
    else result.push(relative(root, full))
  }
  return result
}

function owns(pattern, path) {
  return pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -3)) : pattern === path
}

function ownersOf(registry, path) {
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

function bindsPatchSymbol(symbol, source) {
  const markers = {
    'official provider absent from patch': ["name: '@deepseek-ai/dsh-client-ui-settings-models'", 'name: dsh-multikey-provider'],
    'official Models exact-name disable': [
      'id: ui-settings-models',
      "name: '@deepseek-ai/dsh-client-ui-settings-models'",
      'disabled: true',
    ],
    'multikey provider insert': ['id: multikey-provider', 'name: dsh-multikey-provider'],
  }[symbol]
  if (markers === undefined || !markers.every(marker => source.includes(marker))) return false
  return symbol !== 'official provider absent from patch' || !source.includes('id: llm-pi-ai\n')
}

async function bindsSymbol(path, symbol) {
  const source = await readFile(join(root, path), 'utf8')
  if (path === 'cordis.patch.yml') return bindsPatchSymbol(symbol, source)
  return declaredSymbols(source, path).has(symbol)
}

const [composition, resources, modules, functions, calls, verification, lifecycle] = await Promise.all([
  load(documentPaths.composition),
  load(documentPaths.resources),
  load(documentPaths.modules),
  load(documentPaths.functions),
  load(documentPaths.calls),
  load(documentPaths.verification),
  load(documentPaths.lifecycle),
])

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (packageJson.name !== 'dsh-multikey-provider'
  || packageJson.name !== composition.package
  || packageJson.name !== verification.active_gate_contract.package_name) {
  throw new Error('registry-gate: package identity differs from active composition')
}
if (packageJson.scripts?.prebuild !== 'pnpm run verify:architecture'
  || !packageJson.scripts?.check?.includes('pnpm run verify:architecture')) {
  throw new Error('registry-gate: architecture gate is not wired into build/check')
}

const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
if (patch.includes('id: llm-pi-ai\n')
  || !bindsPatchSymbol('official Models exact-name disable', patch)
  || !bindsPatchSymbol('multikey provider insert', patch)) {
  throw new Error('composition-gate: patch does not preserve official Provider and mount the additive plugin')
}

const sourceFiles = (await filesUnder(join(root, 'src'))).filter(path => /\.tsx?$/u.test(path))
for (const path of sourceFiles) {
  const owners = ownersOf(modules, path)
  if (owners.length !== 1) throw new Error(`registry-gate: ${path} has ${String(owners.length)} module owners`)
}

const resourceIds = new Set(resources.resources.map(resource => resource.resource_id))
const featureIds = new Set(functions.features.map(feature => feature.feature_id))
if (JSON.stringify([...featureIds].sort()) !== JSON.stringify(Object.keys(verification.features).sort())) {
  throw new Error('registry-gate: function and verification feature ids differ')
}
for (const feature of functions.features) {
  for (const resourceId of feature.resource_ids) {
    if (!resourceIds.has(resourceId)) throw new Error(`registry-gate: missing resource ${resourceId}`)
  }
  for (const entry of feature.entry_symbols) {
    if (entry.status !== 'active' || !await bindsSymbol(entry.path, entry.symbol)) {
      throw new Error(`registry-gate: inactive or missing symbol ${entry.path}#${entry.symbol}`)
    }
  }
}

const allowedEdges = new Set(modules.allowed_import_edges.map(edge => edge.join('->')))
for (const path of sourceFiles) {
  const owner = ownersOf(modules, path)[0]
  const source = await readFile(join(root, path), 'utf8')
  for (const node of ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true).statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue
    const specifier = node.moduleSpecifier.text
    if (!specifier.startsWith('.')) continue
    const target = new URL(specifier, `file://${join(root, path)}`).pathname.replace(/\.js$/u, '.ts')
    const targetPath = relative(root, target)
    const targetOwner = ownersOf(modules, targetPath)[0]
    if (targetOwner === undefined || targetOwner.module_id === owner.module_id) continue
    if (!allowedEdges.has(`${owner.module_id}->${targetOwner.module_id}`)) {
      throw new Error(`registry-gate: undeclared import edge ${owner.module_id}->${targetOwner.module_id} (${path})`)
    }
  }
}

for (const edge of calls.edges) {
  if (!lifecycle.nodes.includes(edge.node_id)) throw new Error(`registry-gate: missing lifecycle node ${edge.node_id}`)
  for (const endpoint of [edge.caller, edge.callee]) {
    if (endpoint.status !== 'active' || !await bindsSymbol(endpoint.path, endpoint.symbol)) {
      throw new Error(`registry-gate: inactive or missing call symbol ${endpoint.path}#${endpoint.symbol}`)
    }
  }
}
if (JSON.stringify(calls.edges.map(edge => edge.node_id).sort()) !== JSON.stringify([...lifecycle.nodes].sort())) {
  throw new Error('registry-gate: lifecycle and call-map node ids differ')
}

const sources = await Promise.all(sourceFiles.map(path => readFile(join(root, path), 'utf8')))
const joinedSource = sources.join('\n')
for (const marker of [
  '@deepseek-ai/dsh-llm-pi-ai/src/',
  '@deepseek-ai/dsh-client-ui-settings-models/src/',
  "from '@deepseek-ai/dsh-client-ui-settings-models/client'",
  'dsh-llm-pi-ai-multikey',
  'ReplacementPiAiAdapter',
  'applyReplacementProvider',
]) {
  if (joinedSource.includes(marker)) throw new Error(`runtime-boundary-gate: forbidden marker ${marker}`)
}
if (!joinedSource.includes("from '@deepseek-ai/dsh-llm-pi-ai'")) {
  throw new Error('runtime-boundary-gate: installed public official entrypoint is not composed')
}
if ((joinedSource.match(/settingsNamespace\('multikey-provider'\)/gu) ?? []).length !== 1
  || joinedSource.includes("settingsNamespace('llm-pi-ai')")) {
  throw new Error('namespace-gate: plugin must own only one multikey-provider namespace')
}
if (!joinedSource.includes('sourceProvider') || !joinedSource.includes('MultiKeyProviderAdapter')) {
  throw new Error('runtime-boundary-gate: additive backend mapping symbols are missing')
}
for (const marker of [
  'business.metadata',
  'multikey.key.selected',
  'credential.value',
  'options.metadata.key',
  'options.metadata.health',
  'options.metadata.retry',
]) {
  if (joinedSource.includes(marker)) throw new Error(`payload-isolation: forbidden marker ${marker}`)
}

const control = await readFile(join(root, 'src/control.ts'), 'utf8')
const secretControl = await readFile(join(root, 'src/secret-control.ts'), 'utf8')
if (!control.includes('MultiKeyControl') || !secretControl.includes('MultiKeySecretControl')) {
  throw new Error('control-gate: typed control owners are missing')
}
for (const source of [control, secretControl]) {
  if (/GenerateOptions|StreamChunk|session\.event|business\.(?:request|response)/u.test(source)) {
    throw new Error('control-gate: control owner references business payload types')
  }
}

console.log('REGISTRY_GATE: PASS')
