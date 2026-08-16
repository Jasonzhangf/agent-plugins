import { readFile } from 'node:fs/promises'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const architecture = dirname(fileURLToPath(import.meta.url))
const root = join(architecture, '..', '..')

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

const resourceIds = new Set(resources.resources.map(resource => resource.resource_id))
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
  }
}

const owns = (pattern, path) => pattern.endsWith('/**')
  ? path.startsWith(pattern.slice(0, -3))
  : pattern === path
const moduleOf = path => modules.modules.filter(module => module.owned_paths.some(pattern => owns(pattern, path)))
const sourceEdges = new Set(modules.allowed_import_edges.map(edge => edge.join('->')))
const mountEdges = new Set(modules.allowed_mount_edges.map(edge => edge.join('->')))
const controlEdges = new Set(modules.allowed_control_edges.map(edge => edge.join('->')))

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

console.log('DESIGN_GATE: PASS')
