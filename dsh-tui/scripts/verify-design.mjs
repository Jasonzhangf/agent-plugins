import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import YAML from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const architectureDir = join(root, 'docs/architecture')
const yamlNames = [
  'resource-map.yaml',
  'module-registry.yaml',
  'function-map.yaml',
  'mainline-call-map.yaml',
  'verification-map.yaml',
  'lifecycle.yaml',
  'test-design.yaml',
  'protocol.yaml',
  'projection-window-budget.yaml',
  'capability-bindings.yaml',
]

function fail(message) {
  throw new Error(`design check: ${message}`)
}

function loadYaml(name) {
  const value = YAML.parse(readFileSync(join(architectureDir, name), 'utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must contain a mapping`)
  return value
}

function unique(values, label) {
  const set = new Set()
  for (const value of values) {
    if (set.has(value)) fail(`duplicate ${label}: ${value}`)
    set.add(value)
  }
  return set
}

function requireRelativeFile(base, path, label) {
  if (typeof path !== 'string' || isAbsolute(path)) fail(`${label} must be relative`)
  if (!existsSync(resolve(base, path))) fail(`${label} does not exist: ${path}`)
}

function globMatches(pattern, path) {
  if (pattern.endsWith('/**')) return path.startsWith(pattern.slice(0, -3))
  return pattern === path
}

function sourceFiles(dir, prefix = '') {
  if (!existsSync(dir)) return []
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...sourceFiles(join(dir, entry.name), path))
    else files.push(path)
  }
  return files
}

function markdownCapabilityIds(markdown) {
  const ids = []
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
    if (!cells.some(cell => ['bound', 'blocked', 'N/A'].includes(cell.replaceAll('*', '')))) continue
    if (/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(cells[0])) ids.push(cells[0])
  }
  return ids
}

function channelValidator(ajv, schema, definition) {
  return ajv.compile({ $schema: schema.$schema, $defs: schema.$defs, $ref: `#/$defs/${definition}` })
}

function expectValid(validate, sample, label) {
  if (!validate(sample)) fail(`${label} must validate: ${JSON.stringify(validate.errors)}`)
}

function expectInvalid(validate, sample, label) {
  if (validate(sample)) fail(`${label} must be rejected`)
}

const maps = Object.fromEntries(yamlNames.map(name => [name, loadYaml(name)]))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patch = YAML.parse(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'))
if (!Array.isArray(patch)) fail('cordis.patch.yml must contain a patch list')
const insert = patch.flatMap(row => row.insert ?? [])
for (const id of ['tui-startup', 'tui-runtime']) {
  if (!insert.some(row => row.id === id)) fail(`cordis.patch.yml is missing ${id}`)
}
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') fail('package manifest must export cordis.patch.yml as a DSH bundle')

const resources = maps['resource-map.yaml'].resources ?? []
const resourceIds = unique(resources.map(resource => resource.resource_id), 'resource_id')
for (const relation of [...(maps['resource-map.yaml'].relations ?? []), ...(maps['resource-map.yaml'].forbidden_relations ?? [])]) {
  if (!resourceIds.has(relation.from)) fail(`unknown relation source: ${relation.from}`)
  if (!resourceIds.has(relation.to)) fail(`unknown relation target: ${relation.to}`)
  if (relation.via !== undefined && !resourceIds.has(relation.via)) fail(`unknown relation mediator: ${relation.via}`)
}

const modules = maps['module-registry.yaml'].modules ?? []
const moduleIds = unique(modules.map(module => module.module_id), 'module_id')
const ownedPatterns = modules.flatMap(module => (module.owned_paths ?? []).map(path => ({ module: module.module_id, path })))
unique(ownedPatterns.map(item => item.path), 'owned path')
for (const edge of maps['module-registry.yaml'].declared_edges ?? []) {
  if (!moduleIds.has(edge.from) || !moduleIds.has(edge.to)) fail(`unknown module edge: ${edge.from} -> ${edge.to}`)
}

const nodes = maps['mainline-call-map.yaml'].nodes ?? []
const nodeIds = unique(nodes.map(node => node.node_id), 'mainline node')
for (const edge of maps['mainline-call-map.yaml'].edges ?? []) {
  if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) fail(`unresolved mainline edge: ${edge.edge_id}`)
}

const gateIds = unique((maps['verification-map.yaml'].gates ?? []).map(gate => gate.gate_id), 'gate_id')
for (const gateId of maps['lifecycle.yaml'].verification_gates ?? []) {
  if (!gateIds.has(gateId)) fail(`lifecycle references unknown gate: ${gateId}`)
}
for (const module of modules) {
  for (const gateId of module.verification_gates ?? []) {
    if (!gateIds.has(gateId)) fail(`${module.module_id} references unknown gate: ${gateId}`)
  }
}

for (const name of ['function-map.yaml', 'mainline-call-map.yaml', 'verification-map.yaml', 'lifecycle.yaml', 'test-design.yaml']) {
  for (const field of ['resource_map', 'function_map', 'mainline_call_map', 'module_registry', 'verification_map', 'test_design', 'lifecycle', 'projection_window_budget']) {
    const path = maps[name][field]
    if (path !== undefined) requireRelativeFile(architectureDir, path, `${name}.${field}`)
  }
}

for (const planned of maps['function-map.yaml'].planned_functions ?? []) {
  if (isAbsolute(planned.path)) fail(`${planned.symbol} must remain inside the plugin`)
  if (!ownedPatterns.some(owner => globMatches(owner.path, planned.path))) fail(`${planned.path} has no module owner`)
}

const actualSources = [
  ...sourceFiles(join(root, 'src')).map(path => `src/${path}`),
  ...sourceFiles(join(root, 'native/src')).map(path => `native/src/${path}`),
]
for (const source of actualSources) {
  const owners = ownedPatterns.filter(owner => globMatches(owner.path, source))
  if (owners.length !== 1) fail(`${source} must have exactly one module owner, found ${owners.length}`)
}

const capabilityRows = maps['capability-bindings.yaml'].bindings ?? []
const yamlIds = unique(capabilityRows.map(row => row.capability_id), 'capability_id')
const markdownIds = unique(markdownCapabilityIds(readFileSync(join(root, 'docs/capability-matrix.md'), 'utf8')), 'matrix capability_id')
for (const id of yamlIds) if (!markdownIds.has(id)) fail(`capability matrix is missing ${id}`)
for (const id of markdownIds) if (!yamlIds.has(id)) fail(`capability bindings are missing ${id}`)

const protocol = JSON.parse(readFileSync(join(architectureDir, 'protocol.schema.json'), 'utf8'))
const ajv = new Ajv2020({ strict: true })
const projection = channelValidator(ajv, protocol, 'channelBusinessProjection')
const action = channelValidator(ajv, protocol, 'channelBusinessAction')
const hostControl = channelValidator(ajv, protocol, 'channelHostControl')
const childControl = channelValidator(ajv, protocol, 'channelChildControl')
const samples = {
  projection: { protocolVersion: 1, type: 'projection_commit', publicationRevision: 1, totalWindows: 1 },
  action: { protocolVersion: 1, type: 'cancel', actionId: 'a1', sessionId: 's1' },
  hostControl: { protocolVersion: 1, type: 'delivery_ledger', channel: 'projection', sequence: 1, recordBytes: 12 },
  childControl: { protocolVersion: 1, type: 'delivery_ledger', channel: 'action', sequence: 1, recordBytes: 12 },
}
expectValid(projection, samples.projection, 'projection sample')
expectValid(action, samples.action, 'action sample')
expectValid(hostControl, samples.hostControl, 'host control sample')
expectValid(childControl, samples.childControl, 'child control sample')
expectInvalid(action, samples.projection, 'projection on action channel')
expectInvalid(projection, samples.action, 'action on projection channel')
expectInvalid(childControl, samples.hostControl, 'host ledger on child control channel')
expectInvalid(hostControl, samples.childControl, 'child ledger on host control channel')
expectInvalid(action, { ...samples.action, sequence: 1 }, 'control field in business action')
expectInvalid(projection, { ...samples.projection, snapshotRevision: 1 }, 'snapshot control term in business projection')

const protocolText = readFileSync(join(architectureDir, 'protocol.yaml'), 'utf8')
if (!protocolText.includes('protocol_version: 1')) fail('protocol version must remain 1')
if (protocolText.includes('full_snapshot') || protocolText.includes('snapshot_window')) fail('obsolete snapshot business terminology is forbidden')
const budget = maps['projection-window-budget.yaml'].limits ?? {}
for (const field of ['max_bytes_per_window', 'max_cells_per_window', 'max_windows_per_publication', 'max_staged_publication_bytes']) {
  if (!Number.isSafeInteger(budget[field]) || budget[field] <= 0) fail(`projection budget requires ${field}`)
}

const rootRelative = relative(resolve(root, '..'), root)
if (rootRelative.startsWith('..') || isAbsolute(rootRelative)) fail('plugin root must remain under the dsh-plugins repository')
console.log(`DESIGN_MAPS: PASS (${yamlIds.size} capabilities, ${actualSources.length} owned runtime sources)`)
console.log('RUNTIME_CONFIGURATION: READY')
