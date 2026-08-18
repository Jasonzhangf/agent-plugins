import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'))
}

function readText(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function unique(values, label) {
  const result = new Set(values)
  invariant(result.size === values.length, `${label}: duplicate value`)
  return result
}

function sameSet(left, right, label) {
  const onlyLeft = [...left].filter(value => !right.has(value))
  const onlyRight = [...right].filter(value => !left.has(value))
  invariant(onlyLeft.length === 0 && onlyRight.length === 0,
    `${label}: left-only=${JSON.stringify(onlyLeft)} right-only=${JSON.stringify(onlyRight)}`)
}

function requireStrings(record, fields, label) {
  for (const field of fields) {
    invariant(typeof record[field] === 'string' && record[field].length > 0, `${label}.${field}: required string`)
  }
}

const appsdk = spawnSync('appsdk', ['verify', '.'], { cwd: root, encoding: 'utf8' })
invariant(appsdk.status === 0, `appsdk bootstrap validation failed: ${appsdk.stderr || appsdk.stdout}`)
const appsdkResult = JSON.parse(appsdk.stdout)
invariant(appsdkResult.ok === true && appsdkResult.project_id === 'dsh-tui', 'appsdk bootstrap result mismatch')

const project = readJson('.appsdk/project.json')
const packageManifest = readJson('package.json')
const moduleRegistry = readJson('.appsdk/maps/module-registry.json')
const functionMap = readJson('.appsdk/maps/function-map.json')
const resourceMap = readJson('.appsdk/maps/resource-map.json')
const mainline = readJson('.appsdk/maps/mainline-call-map.json')
const verification = readJson('.appsdk/maps/verification-map.json')
const lifecycle = readJson('contracts/tui/architecture/lifecycle.manifest.json')
const codexAudit = readJson('.appsdk/architecture/codex-tui-selection-audit.json')
const audit = readJson('.appsdk/architecture/official-webui-capability-audit.json')
const bindings = readJson('.appsdk/architecture/capability-bindings.json')
const components = readJson('.appsdk/architecture/component-registry.json')
const testDesign = readJson('.appsdk/architecture/test-design.json')
const transportContract = readText('.appsdk/architecture/transport-contract.md')
const markdownContract = readText('.appsdk/architecture/markdown-conformance.md')
const ciWorkflow = readText('../.github/workflows/dsh-tui.yml')
const fixtureManifestSchema = readJson('contracts/tui/fixtures/fixture-manifest.schema.json')
const canonicalNodeSchema = readJson('contracts/tui/fixtures/canonical-node.schema.json')
const markdownProvenanceSchema = readJson('contracts/tui/fixtures/markdown/provenance.schema.json')
const markdownProvenance = readJson('contracts/tui/fixtures/markdown/provenance.json')
const markdownInputs = readJson('contracts/tui/fixtures/markdown/inputs.json')
const markdownSemanticTokens = readJson('contracts/tui/fixtures/markdown/semantic-tokens.json')
const publicExportsManifest = readJson('.appsdk/architecture/public-exports.manifest.json')

for (const [label, value] of Object.entries({ project, moduleRegistry, functionMap, resourceMap, mainline, verification, lifecycle, codexAudit, audit, bindings, components, testDesign })) {
  invariant(Number.isInteger(value.schema_version), `${label}.schema_version: required integer`)
}

const auditIds = unique(audit.domains.map(row => row.capability_id), 'official audit capability ids')
const bindingIds = unique(bindings.capabilities.map(row => row.capability_id), 'binding capability ids')
sameSet(auditIds, bindingIds, 'official audit <-> capability binding coverage')
invariant(codexAudit.audit_status === 'source_verified', 'Codex TUI audit status must be source_verified')
invariant(codexAudit.audited_source?.commit === '9a6668f674d74b35418fa534b3b6285a315d0765', 'Codex TUI audit commit pin mismatch')
invariant(codexAudit.reference_components?.length >= 9, 'Codex TUI audit requires at least 9 reference components')
invariant(audit.audit_status === 'source_verified', 'official audit status must be source_verified')
invariant(audit.audited_source?.commit === '47f943859bef60e4160492346772ded9b24f765a', 'official audit DSH commit pin mismatch')
invariant(bindings.audited_dsh_commit === audit.audited_source.commit, 'audit <-> binding DSH commit pin mismatch')

const statusCounts = { source_verified: 0, tui_owned: 0, approved_n_a: 0, blocked: 0 }
const bindingById = new Map(bindings.capabilities.map(row => [row.capability_id, row]))
for (const row of bindings.capabilities) {
  requireStrings(row, ['capability_id', 'design_status', 'release_status', 'owner', 'public_face', 'method_path', 'io', 'mutation'], `binding ${row.capability_id}`)
  invariant(Object.hasOwn(statusCounts, row.design_status), `binding ${row.capability_id}: invalid design_status`)
  statusCounts[row.design_status] += 1
}
for (const row of audit.domains) {
  requireStrings(row, ['capability_id', 'web_owner', 'public_input', 'tui_disposition'], `audit ${row.capability_id}`)
  const binding = bindingById.get(row.capability_id)
  const dispositionStatus = {
    v1: 'source_verified',
    v1_compact_overlay: 'source_verified',
    tui_owned: 'tui_owned',
    approved_n_a: 'approved_n_a',
    blocked: 'blocked',
  }
  const expected = dispositionStatus[row.tui_disposition]
  invariant(expected !== undefined, `audit ${row.capability_id}: unknown tui_disposition ${row.tui_disposition}`)
  invariant(binding.design_status === expected, `audit ${row.capability_id}: disposition/status mismatch`)
}
invariant(JSON.stringify(statusCounts) === JSON.stringify(audit.conclusion.derived_counts), 'derived capability counts mismatch')
const blockedIds = bindings.capabilities.filter(row => row.design_status === 'blocked').map(row => row.capability_id)
invariant(JSON.stringify(blockedIds) === JSON.stringify(bindings.blocked_capabilities), 'blocked_capabilities is not derived from bindings')

const projectIds = unique(project.modules.map(row => row.module_id), 'project module ids')
const registryIds = unique(moduleRegistry.modules.map(row => row.module_id), 'module registry ids')
sameSet(projectIds, registryIds, 'project.json <-> module-registry module coverage')
for (const module of project.modules) {
  requireStrings(module, ['module_id', 'stage', 'source_owner', 'active_artifact'], `project module ${module.module_id}`)
  invariant(module.artifact_paths.length > 0, `project module ${module.module_id}: artifact_paths required`)
  invariant(module.build?.program === 'pnpm' && module.build.args.length > 0, `project module ${module.module_id}: build command required`)
  invariant(module.regression?.required_before_freeze === true, `project module ${module.module_id}: regression required`)
  invariant(module.regression.minimum_test_count > 0 && module.regression.allow_skipped === false, `project module ${module.module_id}: regression strength invalid`)
  const scripts = packageManifest.scripts ?? {}
  for (const scriptName of [module.build.args.at(-1), module.regression.command.args.at(-1)]) {
    invariant(typeof packageManifest.scripts?.[scriptName] === 'string', `module ${module.module_id}: package script ${scriptName} required`)
  }
  for (const dependency of module.dependency_modules) invariant(projectIds.has(dependency), `project module ${module.module_id}: unknown dependency ${dependency}`)
  const registry = moduleRegistry.modules.find(row => row.module_id === module.module_id)
  invariant(registry.owner === `dsh-tui::${module.source_owner}`, `module ${module.module_id}: owner mismatch`)
  sameSet(new Set(module.owned_paths), new Set(registry.owned_paths), `module ${module.module_id}: project.json <-> module-registry owned_paths`)
}

const mainlineIds = unique(mainline.nodes, 'mainline node ids')
const lifecycleIds = unique(lifecycle.nodes.map(row => row.node_id), 'lifecycle node ids')
sameSet(mainlineIds, lifecycleIds, 'mainline <-> lifecycle node coverage')
invariant(lifecycle.entrypoint === mainline.nodes[0], 'lifecycle entrypoint mismatch')
invariant(lifecycle.return_path === `${mainline.nodes.at(-1)}->${mainline.nodes[0]}`, 'lifecycle return path mismatch')
for (const edge of [...mainline.edges, ...mainline.forbidden_edges, ...mainline.return_paths]) {
  invariant(mainlineIds.has(edge.from) && mainlineIds.has(edge.to), `mainline edge references unknown node: ${edge.from}->${edge.to}`)
}

const gateIds = unique(verification.gates.map(row => row.gate_id), 'verification gate ids')
const gateReferences = [
  ...moduleRegistry.modules.flatMap(row => row.verification_gates),
  ...functionMap.functions.flatMap(row => row.required_gates),
  ...lifecycle.verification_gates,
  ...testDesign.suites.flatMap(row => row.gates),
]
for (const gate of gateReferences) invariant(gateIds.has(gate), `unknown gate reference: ${gate}`)
for (const gate of verification.gates.filter(row => row.status === 'active')) {
  invariant(gate.command !== 'pending' && gate.command.length > 0, `active gate ${gate.gate_id}: executable command required`)
}
invariant(packageManifest.scripts?.check === 'pnpm run check:design && pnpm run test:design', 'package check must run both design gates')
for (const token of [
  'appsdk/releases/download/v0.1.3/appsdk-0.1.3-macos-arm64',
  'e3c36ae25c94d0c01c81cfe084fac7de8dc577f5ba3b8f91ae18b9d0587631a5',
  'pnpm install --frozen-lockfile',
]) {
  invariant(ciWorkflow.includes(token), `CI design gate wiring missing required clause: ${token}`)
}
invariant(ciWorkflow.split('\n').some(line => line.trim() === '- run: pnpm run check'), 'CI design gate wiring missing aggregate pnpm run check step')

const resourceIds = unique(resourceMap.resources.map(row => row.resource_id), 'resource ids')
for (const fn of functionMap.functions) {
  for (const resource of fn.resource_ids) invariant(resourceIds.has(resource), `function ${fn.function_id}: unknown resource ${resource}`)
}
const componentKinds = unique(components.groups.flatMap(group => group.members), 'component kind ids')
invariant(components.registry_rules.duplicate_policy === 'fail_fast', 'component duplicate policy must fail fast')

for (const token of [
  'CLI `--endpoint <origin>`',
  'environment variable `DSH_WEB_URL`',
  '`http://127.0.0.1:3080`',
  '`NodeApiClient` is the sole HTTP/WebSocket ApiProxy carrier',
  'extends AbstractApiClient',
  'does not mount `@deepseek-ai/dsh-api-remotes/client`',
  '`SessionSummary.cwd` is present',
  'absence is therefore an explicit rejection',
]) {
  invariant(transportContract.includes(token), `transport contract missing required clause: ${token}`)
}

for (const token of [
  '47f943859bef60e4160492346772ded9b24f765a',
  'markdown-dom-parity.client.spec.tsx',
  'markdown-incremental.client.spec.tsx',
  'fixtures/markdown-dom/*.settled.txt',
  'fixtures/markdown-dom/*.streaming.txt',
  'normalized semantic tokens',
  'source paths and hashes',
  'User, context and steering messages remain literal text',
]) {
  invariant(markdownContract.includes(token), `Markdown corpus contract missing required clause: ${token}`)
}

invariant(fixtureManifestSchema.$id?.includes('fixture-manifest'), 'fixture manifest schema must declare its identity')
invariant(fixtureManifestSchema.required?.includes('fixtures'), 'fixture manifest schema must require fixtures')
invariant(canonicalNodeSchema.required?.includes('nodeId') && canonicalNodeSchema.required?.includes('value'), 'canonical node schema must require nodeId and value')
invariant(markdownProvenanceSchema.required?.includes('source') && markdownProvenanceSchema.required?.includes('files'), 'markdown provenance schema must require source and files')
invariant(markdownProvenance.source?.commit === '47f943859bef60e4160492346772ded9b24f765a', 'markdown provenance commit pin mismatch')
invariant(markdownProvenance.status === 'admitted', 'markdown provenance must be admitted with pinned source hashes')
invariant(markdownProvenance.files.length >= 46, 'markdown provenance must pin the full official fixture corpus')
const markdownHash = createHash('sha256')
for (const entry of markdownProvenance.files) {
  requireStrings(entry, ['path', 'sha256'], 'markdown provenance file')
  const path = entry.path
  let candidate
  if (path.startsWith('packages/client/ui-primitives/tests/fixtures/markdown-dom/')) {
    candidate = resolve(root, `contracts/tui/fixtures/markdown/official/${path.split('/').at(-1)}`)
  } else if (path.startsWith('contracts/tui/fixtures/markdown/official/')) {
    candidate = resolve(root, path)
  } else if (!path.startsWith('packages/client/ui-primitives/')) {
    invariant(false, `markdown provenance path is outside the allowed source surface: ${path}`)
  }
  if (candidate) {
    const hash = createHash('sha256').update(readFileSync(candidate)).digest('hex')
    invariant(hash === entry.sha256, `markdown provenance hash mismatch: ${path}`)
  }
  markdownHash.update(`${path}\0${entry.sha256}\0`)
}
invariant(markdownProvenance.bundleHash === markdownHash.digest('hex'), 'markdown provenance bundleHash mismatch')
invariant(markdownSemanticTokens.status === 'admitted', 'markdown semantic-token contract must be admitted')
const markdownInputIds = unique(markdownInputs.fixtures.map(row => row.id), 'markdown input fixture ids')
const markdownTokenIds = unique(Object.keys(markdownSemanticTokens.fixtures), 'markdown semantic-token fixture ids')
sameSet(markdownInputIds, markdownTokenIds, 'markdown input <-> semantic-token fixture coverage')
for (const [id, fixture] of Object.entries(markdownSemanticTokens.fixtures)) {
  invariant(Array.isArray(fixture.settled), `markdown fixture ${id}: settled tokens required`)
  invariant(Array.isArray(fixture.streaming), `markdown fixture ${id}: streaming tokens required`)
  if (id !== 'definition-only') {
    invariant(fixture.settled.length > 0, `markdown fixture ${id}: settled tokens cannot be empty`)
    invariant(fixture.streaming.length > 0, `markdown fixture ${id}: streaming tokens cannot be empty`)
  }
}
invariant(publicExportsManifest.status === 'pending_clean_registry', 'public exports manifest must be pending_clean_registry until clean install probe')
invariant(publicExportsManifest.required?.length > 0, 'public exports manifest must declare required exports')
for (const entry of publicExportsManifest.required) {
  requireStrings(entry, ['package', 'export'], `public export ${entry.package}${entry.export}`)
  invariant(Array.isArray(entry.symbols) && entry.symbols.length > 0, `public export ${entry.package}${entry.export}: symbols required`)
}
console.log(`APPSDK_BOOTSTRAP: PASS (project=${appsdkResult.project_id}; stage=${appsdkResult.stage})`)
console.log(`DESIGN_CONTRACTS: PASS (${bindingIds.size} capabilities; ${projectIds.size} modules; ${mainlineIds.size} mainline nodes; ${componentKinds.size} component kinds)`)
console.log('IMPLEMENTATION_ADMISSION: BLOCKED (clean-registry exports, fixture corpus, Markdown differential gate, runtime import-edge gates)')
invariant(publicExportsManifest.npm_tags?.next !== undefined, 'public exports manifest must record available npm tags')
invariant(['latest', 'next'].includes(publicExportsManifest.selected_tag), 'public exports selected_tag must be latest or next')
for (const token of [
  'DSH_TUI_CLEAN_INSTALL_ROOT',
  'PUBLIC_EXPORTS: PASS',
  'PUBLIC_EXPORTS_REGISTRY: PASS',
  'spec.types',
]) {
  invariant(readText('scripts/verify-public-exports.mjs').includes(token), `public-export probe missing required clause: ${token}`)
}
