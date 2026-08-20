import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

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

function pathPatternMatches(pattern, relativePath) {
  if (pattern.endsWith('/**')) return relativePath.startsWith(pattern.slice(0, -2))
  return pattern === relativePath
}

function assertUniquePathOwner(relativePath) {
  const owners = moduleRegistry.modules.filter(module =>
    [...module.owned_paths, ...(module.repository_owned_paths ?? [])]
      .some(pattern => pathPatternMatches(pattern, relativePath)))
  invariant(owners.length === 1,
    `module owner coverage for ${relativePath}: expected 1, got ${owners.length} (${owners.map(row => row.module_id).join(',')})`)
  return owners[0]
}

function portablePath(value) {
  return value.split(sep).join('/')
}

function walkFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) walkFiles(path, files)
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function discoverOwnershipSurface() {
  const surface = moduleRegistry.ownership_surface
  invariant(surface && typeof surface === 'object', 'module registry ownership_surface is required')
  const paths = []
  for (const pattern of surface.roots ?? []) {
    invariant(typeof pattern === 'string' && pattern.endsWith('/**'), `ownership root must be a machine glob ending /**: ${String(pattern)}`)
    const relativeRoot = pattern.slice(0, -3)
    const absoluteRoot = resolve(root, relativeRoot)
    invariant(existsSync(absoluteRoot), `ownership root does not exist: ${relativeRoot}`)
    for (const file of walkFiles(absoluteRoot)) paths.push(portablePath(relative(root, file)))
  }
  for (const path of surface.root_files ?? []) {
    invariant(typeof path === 'string' && existsSync(resolve(root, path)), `ownership root file does not exist: ${String(path)}`)
    paths.push(path)
  }
  for (const path of surface.repository_files ?? []) {
    invariant(typeof path === 'string' && existsSync(resolve(root, path)), `ownership repository file does not exist: ${String(path)}`)
    paths.push(path)
  }
  return [...new Set(paths)].sort()
}

function importSpecifiers(path) {
  const source = readText(path)
  const kind = path.endsWith('.ts') || path.endsWith('.mts')
    ? ts.ScriptKind.TS
    : path.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.JS
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind)
  const specifiers = []
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return specifiers
}

function resolveRelativeImport(sourcePath, specifier, surfacePaths) {
  if (!specifier.startsWith('.')) return null
  const absoluteBase = resolve(root, dirname(sourcePath), specifier)
  const extension = extname(absoluteBase)
  const candidates = [absoluteBase]
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    const stem = absoluteBase.slice(0, -extension.length)
    candidates.push(`${stem}.ts`, `${stem}.mts`, `${stem}.cts`)
  } else if (extension.length === 0) {
    candidates.push(`${absoluteBase}.ts`, `${absoluteBase}.mts`, `${absoluteBase}.js`, resolve(absoluteBase, 'index.ts'))
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const relativePath = portablePath(relative(root, candidate))
    if (surfacePaths.has(relativePath)) return relativePath
  }
  return null
}

function assertSourceOwnershipAndImportEdges() {
  const paths = discoverOwnershipSurface()
  const owners = new Map()
  for (const path of paths) owners.set(path, assertUniquePathOwner(path).module_id)
  const surfacePaths = new Set(paths)
  const importEdges = unique(
    (moduleRegistry.import_edges ?? []).map(edge => `${edge.from}->${edge.to}`),
    'module import edges',
  )
  for (const edge of moduleRegistry.import_edges ?? []) {
    invariant(projectIds.has(edge.from) && projectIds.has(edge.to),
      `module import edge references unknown module: ${edge.from}->${edge.to}`)
  }
  const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'])
  for (const sourcePath of paths.filter(path => sourceExtensions.has(extname(path)))) {
    const sourceModule = owners.get(sourcePath)
    invariant(sourceModule !== undefined, `source owner missing after coverage: ${sourcePath}`)
    for (const specifier of importSpecifiers(sourcePath)) {
      const targetPath = resolveRelativeImport(sourcePath, specifier, surfacePaths)
      if (targetPath === null) continue
      const targetModule = owners.get(targetPath)
      invariant(targetModule !== undefined, `target owner missing after coverage: ${targetPath}`)
      if (targetModule === sourceModule) continue
      invariant(importEdges.has(`${sourceModule}->${targetModule}`),
        `undeclared module edge ${sourceModule} -> ${targetModule}: ${sourcePath} imports ${targetPath}`)
    }
  }
  return paths
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
const componentContract = readJson('contracts/tui/component-registry/manifest.json')
const testDesign = readJson('.appsdk/architecture/test-design.json')
const transportContract = readText('.appsdk/architecture/transport-contract.md')
const markdownContract = readText('.appsdk/architecture/markdown-conformance.md')
const gitignore = readText('.gitignore')
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
const ownedSourcePaths = assertSourceOwnershipAndImportEdges()
invariant(ownedSourcePaths.length > 0, 'module ownership surface cannot be empty')
const componentRegistryModule = moduleRegistry.modules.find(row => row.module_id === 'component-registry')
for (const requiredPath of [
  'playground/experiments/component-registry/src/component-registry.ts',
  'tests/component-registry/component-registry.spec.ts',
  'contracts/tui/component-registry/manifest.json',
  'scripts/build-component-registry.mjs',
]) {
  invariant(componentRegistryModule.owned_paths.some(pattern => pathPatternMatches(pattern, requiredPath)),
    `component-registry owned path coverage missing: ${requiredPath}`)
}
const governanceBuildModule = moduleRegistry.modules.find(row => row.module_id === 'governance-build')
invariant(governanceBuildModule?.status === 'implemented', 'governance-build module must be implemented')
for (const requiredPath of [
  'package.json',
  '.gitignore',
  '.appsdk/project.json',
  '.appsdk/maps/function-map.json',
  '.appsdk/maps/mainline-call-map.json',
  '.appsdk/maps/module-registry.json',
  '.appsdk/maps/resource-map.json',
  '.appsdk/maps/verification-map.json',
  '.appsdk/verification/verify-design.mjs',
  '.appsdk/verification/verify-design.spec.mjs',
  'scripts/build-governance.mjs',
  '../.github/workflows/dsh-tui.yml',
]) {
  invariant(assertUniquePathOwner(requiredPath)?.module_id === 'governance-build',
    `governance-build must own ${requiredPath}`)
}
for (const requiredPath of [
  'playground/experiments/component-registry/src/component-registry.ts',
  'tests/component-registry/component-registry.spec.ts',
  'contracts/tui/component-registry/manifest.json',
  'scripts/build-component-registry.mjs',
]) {
  assertUniquePathOwner(requiredPath)
}

const mainlineIds = unique(mainline.nodes, 'mainline node ids')
const lifecycleIds = unique(lifecycle.nodes.map(row => row.node_id), 'lifecycle node ids')
sameSet(mainlineIds, lifecycleIds, 'mainline <-> lifecycle node coverage')
invariant(lifecycle.entrypoint === mainline.nodes[0], 'lifecycle entrypoint mismatch')
invariant(lifecycle.return_path === `${mainline.nodes.at(-1)}->${mainline.nodes[0]}`, 'lifecycle return path mismatch')
for (const edge of [...mainline.edges, ...mainline.forbidden_edges, ...mainline.return_paths]) {
  invariant(mainlineIds.has(edge.from) && mainlineIds.has(edge.to), `mainline edge references unknown node: ${edge.from}->${edge.to}`)
}
const mainlineErrorChains = mainline.error_chains ?? []
const lifecycleErrorChains = lifecycle.error_chains ?? []
const mainlineErrorChainIds = unique(mainlineErrorChains.map(chain => chain.chain_id), 'mainline error chain ids')
const lifecycleErrorChainIds = unique(lifecycleErrorChains.map(chain => chain.chain_id), 'lifecycle error chain ids')
sameSet(mainlineErrorChainIds, lifecycleErrorChainIds, 'mainline <-> lifecycle error chain coverage')
for (const chain of mainlineErrorChains) {
  invariant(chain.nodes.length >= 2, `error chain ${chain.chain_id}: at least two nodes required`)
  invariant(chain.nodes.every(node => /^TuiError(?:In|Out)\d{2}[A-Z][A-Za-z0-9]*$/.test(node)),
    `error chain ${chain.chain_id}: node naming contract violated`)
  invariant(chain.edges.length === chain.nodes.length - 1, `error chain ${chain.chain_id}: every adjacent node requires one edge`)
  for (let index = 0; index < chain.edges.length; index += 1) {
    const edge = chain.edges[index]
    invariant(edge.from === chain.nodes[index] && edge.to === chain.nodes[index + 1],
      `error chain ${chain.chain_id}: only adjacent edges are allowed`)
    requireStrings(edge, ['from', 'to', 'status', 'owner', 'semantic_io'], `error chain ${chain.chain_id} edge ${index}`)
    invariant(edge.status === 'implemented', `error chain ${chain.chain_id}: binding must be implemented`)
  }
  const lifecycleChain = lifecycleErrorChains.find(candidate => candidate.chain_id === chain.chain_id)
  invariant(lifecycleChain !== undefined, `error chain ${chain.chain_id}: lifecycle binding missing`)
  invariant(JSON.stringify(lifecycleChain.nodes.map(node => node.node_id)) === JSON.stringify(chain.nodes),
    `error chain ${chain.chain_id}: mainline and lifecycle node order must match`)
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
invariant(
  packageManifest.scripts?.check === 'pnpm run check:design && pnpm run test:design && pnpm run typecheck && pnpm run check:runtime-boundaries',
  'package check must run design, red, type and runtime boundary gates',
)
for (const token of [
  'appsdk/releases/download/v0.1.3/appsdk-0.1.3-macos-arm64',
  'e3c36ae25c94d0c01c81cfe084fac7de8dc577f5ba3b8f91ae18b9d0587631a5',
  'pnpm install --frozen-lockfile',
]) {
  invariant(ciWorkflow.includes(token), `CI design gate wiring missing required clause: ${token}`)
}
invariant(ciWorkflow.split('\n').some(line => line.trim() === '- run: pnpm run check'), 'CI design gate wiring missing aggregate pnpm run check step')
invariant(ciWorkflow.includes('pnpm run test:component-registry && pnpm run build:component-registry'),
  'CI component-registry gate wiring missing test/build command')
invariant(ciWorkflow.includes('pnpm run build:governance'), 'CI governance-build gate wiring missing build command')
for (const ignoredEvidence of [
  '/docs/evidence/pty/*.log',
  '/docs/evidence/simulator/*.png',
  '/docs/evidence/simulator/report.json',
]) {
  invariant(gitignore.split('\n').includes(ignoredEvidence), `generated evidence ignore missing: ${ignoredEvidence}`)
}
for (const command of [
  'pnpm run test:fixture-contract && pnpm run build:fixture-contract',
  'pnpm run test:terminal-ui && pnpm run build:terminal-ui',
  'pnpm run test:installer && pnpm run build:installer',
  'pnpm run test:simulator && pnpm run build:simulator',
  'pnpm run test:runtime && pnpm run build:runtime',
  'pnpm run check:public-exports',
  'pnpm run check:clean-install',
]) {
  invariant(ciWorkflow.includes(command), `CI implementation gate wiring missing required command: ${command}`)
}

const resourceIds = unique(resourceMap.resources.map(row => row.resource_id), 'resource ids')
for (const fn of functionMap.functions) {
  for (const resource of fn.resource_ids) invariant(resourceIds.has(resource), `function ${fn.function_id}: unknown resource ${resource}`)
}
for (const relation of [...resourceMap.required_relations, ...resourceMap.forbidden_relations]) {
  invariant(resourceIds.has(relation.from), `resource relation has unknown source: ${relation.from}`)
  invariant(resourceIds.has(relation.to), `resource relation has unknown target: ${relation.to}`)
}
const componentKinds = unique(components.groups.flatMap(group => group.members), 'component kind ids')
const contractKinds = unique(componentContract.groups.flatMap(group => group.members), 'component contract kind ids')
invariant(componentContract.schema_version === 1, 'component contract schema_version must be 1')
invariant(JSON.stringify(componentContract.groups) === JSON.stringify(components.groups),
  'component architecture registry and runtime contract manifest must match exactly')
sameSet(componentKinds, contractKinds, 'component architecture <-> runtime contract kind coverage')
invariant(components.registry_rules.duplicate_policy === 'fail_fast', 'component duplicate policy must fail fast')
invariant(components.status === 'implemented', 'component registry architecture must be implemented after mainline binding')
const componentMainlineBindingGate = verification.gates.find(row => row.gate_id === 'component_registry_mainline_binding')
invariant(componentMainlineBindingGate?.status === 'active' && componentMainlineBindingGate.command.includes('test:terminal-ui'),
  'component registry mainline binding must run the terminal-ui contract')
invariant(components.registry_rules.renderer_input === 'closed typed TUI component contracts only',
  'component registry renderer input must be a closed typed contract')
invariant(components.registry_rules.renderer_output === 'terminal-neutral TuiElementDescriptor or typed TuiIntent only',
  'component registry renderer output must be terminal-neutral and closed')
invariant(!testDesign.known_gaps?.some(gap => gap.includes('No runtime source')),
  'test design must not claim runtime source is absent after implementation begins')

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
invariant(publicExportsManifest.status === 'verified_clean_registry', 'public exports manifest must record verified_clean_registry after the clean install probe')
invariant(publicExportsManifest.required?.length > 0, 'public exports manifest must declare required exports')
for (const entry of publicExportsManifest.required) {
  requireStrings(entry, ['package', 'export'], `public export ${entry.package}${entry.export}`)
  invariant(Array.isArray(entry.symbols) && entry.symbols.length > 0, `public export ${entry.package}${entry.export}: symbols required`)
}
console.log(`APPSDK_BOOTSTRAP: PASS (project=${appsdkResult.project_id}; stage=${appsdkResult.stage})`)
console.log(`DESIGN_CONTRACTS: PASS (${bindingIds.size} capabilities; ${projectIds.size} modules; ${mainlineIds.size} mainline nodes; ${componentKinds.size} component kinds)`)
const deliveryStages = new Set(['release', 'promotion', 'freeze'])
const pendingDeliveryGates = verification.gates
  .filter(gate => gate.required_for.some(stage => deliveryStages.has(stage)) && gate.status !== 'active')
  .map(gate => gate.gate_id)
console.log(pendingDeliveryGates.length === 0
  ? 'DELIVERY_ADMISSION: PASS'
  : `DELIVERY_ADMISSION: BLOCKED (${pendingDeliveryGates.join(', ')})`)
invariant(publicExportsManifest.npm_tags?.next !== undefined, 'public exports manifest must record available npm tags')
invariant(['latest', 'next'].includes(publicExportsManifest.selected_tag), 'public exports selected_tag must be latest or next')
const selectedPublicVersion = publicExportsManifest.npm_tags[publicExportsManifest.selected_tag]
invariant(publicExportsManifest.selected_version === selectedPublicVersion,
  'public exports selected_version must equal the recorded selected tag version')
for (const packageName of new Set(publicExportsManifest.required.map(entry => entry.package))) {
  invariant(packageManifest.dependencies?.[packageName] === selectedPublicVersion,
    `public package dependency must exactly match selected version: ${packageName}`)
}
for (const token of [
  'DSH_TUI_CLEAN_INSTALL_ROOT',
  'PUBLIC_EXPORTS: PASS',
  'PUBLIC_EXPORTS_REGISTRY: PASS',
  'spec.types',
]) {
  invariant(readText('scripts/verify-public-exports.mjs').includes(token), `public-export probe missing required clause: ${token}`)
}
