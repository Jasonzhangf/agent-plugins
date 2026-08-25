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

function assertRepositoryOwnerBindings() {
  const surface = moduleRegistry.ownership_surface
  const bindings = surface.repository_owner_bindings ?? []
  const repositoryFiles = surface.repository_files ?? []
  sameSet(new Set(bindings.map(binding => binding.path)), new Set(repositoryFiles),
    'ownership_surface repository_files <-> repository_owner_bindings')
  for (const binding of bindings) {
    invariant(typeof binding.path === 'string' && repositoryFiles.includes(binding.path),
      `repository owner binding path must be declared in repository_files: ${String(binding.path)}`)
    invariant(moduleRegistry.modules.some(module =>
      module.module_id === binding.module_id
      && [...module.owned_paths, ...(module.repository_owned_paths ?? [])]
        .some(pattern => pathPatternMatches(pattern, binding.path))),
      `repository owner binding does not match module owned paths: ${binding.path} -> ${binding.module_id}`)
  }
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

const sdkLock = readJson('.appsdk/sdk.lock')
const sdkVersionResult = spawnSync('appsdk', ['version'], { cwd: root, encoding: 'utf8' })
invariant(sdkVersionResult.status === 0,
  `pinned appsdk is unavailable: ${sdkVersionResult.stderr || sdkVersionResult.stdout}`)
const sdkVersionMatch = /^appsdk (\d+\.\d+\.\d+)/.exec(sdkVersionResult.stdout.trim())
invariant(sdkVersionMatch?.[1] === sdkLock.version,
  `pinned appsdk version mismatch: expected ${sdkLock.version}, got ${sdkVersionMatch?.[1] ?? 'unknown'}; pin AppSDK ${sdkLock.version} first on PATH`)

const project = readJson('.appsdk/project.json')
const packageManifest = readJson('package.json')
const moduleRegistry = readJson('.appsdk/maps/module-registry.json')
assertRepositoryOwnerBindings()
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
const rustGovernancePlan = readJson('.appsdk/architecture/rust-governance-migration-plan.json')
const executableFrameLifecycle = readJson('.appsdk/architecture/tui-v4-app-container-frame.manifest.json')
const viewportBootstrapContract = readJson('contracts/tui/app-shell/terminal-viewport-bootstrap.contract.json')
const validatedViewportContract = readJson('contracts/tui/app-event-bus/validated-terminal-viewport.contract.json')
const terminalFrameTreeContract = readJson('contracts/tui/terminal-ui/terminal-frame-tree.contract.json')
const terminalRegionLeavesContract = readJson('contracts/tui/terminal-ui/terminal-region-leaves.contract.json')
const terminalFramePipelineResultContract = readJson('contracts/tui/terminal-ui/terminal-frame-pipeline-result.contract.json')
const orderedAppFrameContract = readJson('contracts/tui/app-container/ordered-app-frame.contract.json')
const orderedAppFrameResultContract = readJson('contracts/tui/app-container/ordered-app-frame-result.contract.json')
const terminalCarrierResultContract = readJson('contracts/tui/terminal-lifecycle/terminal-carrier-result.contract.json')
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

for (const [label, value] of Object.entries({ project, moduleRegistry, functionMap, resourceMap, mainline, verification, lifecycle, codexAudit, audit, bindings, components, testDesign, rustGovernancePlan })) {
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
  const declaredImportTargets = new Set(
    moduleRegistry.import_edges
      .filter(edge => edge.from === module.module_id)
      .filter(edge => edge.edge_class === undefined || edge.edge_class === 'runtime_dependency')
      .map(edge => edge.to),
  )
  sameSet(new Set(module.dependency_modules), declaredImportTargets,
    `module ${module.module_id}: project.json dependency_modules <-> module-registry import_edges`)
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
  ...moduleRegistry.modules.flatMap(row => row.target_verification_gates ?? []),
  ...functionMap.functions.flatMap(row => row.required_gates),
  ...(functionMap.target_functions ?? []).flatMap(row => row.required_gates),
  ...(functionMap.target_function_updates ?? []).flatMap(row => row.required_gates),
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
  if (fn.declaration_bindings !== undefined) {
    invariant(Array.isArray(fn.declaration_bindings) && fn.declaration_bindings.length > 0,
      `function ${fn.function_id}: declaration_bindings must be a nonempty array`)
    const ownerModule = String(fn.owner).replace(/^dsh-tui::/, '')
    for (const binding of fn.declaration_bindings) {
      requireStrings(binding, ['symbol', 'path', 'qualified_name'], `function ${fn.function_id} declaration binding`)
      invariant(existsSync(resolve(root, binding.path)),
        `function ${fn.function_id}: declaration path does not exist: ${binding.path}`)
      invariant(assertUniquePathOwner(binding.path).module_id === ownerModule,
        `function ${fn.function_id}: declaration path is owned by another module: ${binding.path}`)
      invariant(sourceFacts(binding.path).identifiers.has(binding.symbol),
        `function ${fn.function_id}: symbol ${binding.symbol} is absent from ${binding.path}`)
      const qualifiedParts = binding.qualified_name.split('.')
      invariant(qualifiedParts.at(-1) === binding.symbol
        && (qualifiedParts.length === 1 || (qualifiedParts.length === 2 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(qualifiedParts[0]))),
        `function ${fn.function_id}: malformed qualified declaration name ${binding.qualified_name}`)
    }
  }
}
const targetFunctions = functionMap.target_functions ?? []
const targetFunctionIds = unique(targetFunctions.map(row => row.function_id), 'target function ids')
const targetFunctionUpdates = functionMap.target_function_updates ?? []
const targetFunctionUpdateIds = unique(targetFunctionUpdates.map(row => row.function_id), 'target function update ids')
const implementedFunctionIds = new Set(functionMap.functions.map(row => row.function_id))
for (const fn of targetFunctions) {
  requireStrings(fn, ['function_id', 'status', 'binding_status', 'owner'], `target function ${fn.function_id}`)
  invariant(!implementedFunctionIds.has(fn.function_id),
    `target function ${fn.function_id}: duplicates current function id`)
  const pendingBinding = fn.status === 'pending' && fn.binding_status === 'pending'
  const activeBinding = fn.status === 'implemented' && fn.binding_status === 'active'
  invariant(pendingBinding || activeBinding,
    `target function ${fn.function_id}: status/binding_status must be pending/pending or implemented/active`)
  invariant(Array.isArray(fn.entry_symbols)
    && (pendingBinding ? fn.entry_symbols.length === 0 : fn.entry_symbols.length > 0),
  `target function ${fn.function_id}: entry symbols must match its binding state`)
  invariant(Array.isArray(fn.semantic_roles) && fn.semantic_roles.length > 0,
    `target function ${fn.function_id}: semantic role required`)
  invariant(projectIds.has(fn.owner.replace(/^dsh-tui::/, '')),
    `target function ${fn.function_id}: unknown owner ${fn.owner}`)
  const ownerModule = moduleRegistry.modules.find(row =>
    row.module_id === fn.owner.replace(/^dsh-tui::/, ''))
  for (const gate of fn.required_gates) {
    invariant([
      ...(ownerModule?.verification_gates ?? []),
      ...(ownerModule?.target_verification_gates ?? []),
    ].includes(gate),
      `target function ${fn.function_id}: owner module missing target gate ${gate}`)
  }
  for (const resource of fn.resource_ids) {
    invariant(resourceIds.has(resource), `target function ${fn.function_id}: unknown resource ${resource}`)
  }
  if (pendingBinding) {
    invariant(fn.declaration_bindings === undefined,
      `target function ${fn.function_id}: pending binding cannot fabricate declarations`)
  } else {
    invariant(Array.isArray(fn.declaration_bindings) && fn.declaration_bindings.length > 0,
      `target function ${fn.function_id}: active binding requires declarations`)
    for (const binding of fn.declaration_bindings) {
      requireStrings(binding, ['symbol', 'path', 'qualified_name'],
        `target function ${fn.function_id} declaration binding`)
      invariant(existsSync(resolve(root, binding.path)),
        `target function ${fn.function_id}: declaration path does not exist: ${binding.path}`)
      invariant(assertUniquePathOwner(binding.path).module_id === ownerModule.module_id,
        `target function ${fn.function_id}: declaration path is owned by another module: ${binding.path}`)
      invariant(sourceFacts(binding.path).identifiers.has(binding.symbol),
        `target function ${fn.function_id}: symbol ${binding.symbol} is absent from ${binding.path}`)
    }
    for (const symbol of fn.entry_symbols) {
      invariant(fn.declaration_bindings.some(binding => binding.symbol === symbol),
        `target function ${fn.function_id}: entry symbol ${symbol} lacks an exact declaration binding`)
    }
  }
}
for (const update of targetFunctionUpdates) {
  requireStrings(update, ['function_id', 'status', 'binding_status', 'owner', 'mutation'],
    `target function update ${update.function_id}`)
  const current = functionMap.functions.find(row => row.function_id === update.function_id)
  invariant(current?.status === 'implemented' && current.owner === update.owner,
    `target function update ${update.function_id}: current implemented owner missing`)
  invariant((update.status === 'pending' && update.binding_status === 'pending')
    || (update.status === 'implemented' && update.binding_status === 'active'),
  `target function update ${update.function_id}: status/binding_status drift`)
  invariant(Array.isArray(update.target_resource_ids) && update.target_resource_ids.length > 0
    && update.target_resource_ids.every(resource => resourceIds.has(resource)),
  `target function update ${update.function_id}: unknown target resource`)
  const ownerModule = moduleRegistry.modules.find(row =>
    row.module_id === update.owner.replace(/^dsh-tui::/, ''))
  for (const gate of update.required_gates) {
    invariant([
      ...(ownerModule?.verification_gates ?? []),
      ...(ownerModule?.target_verification_gates ?? []),
    ].includes(gate),
    `target function update ${update.function_id}: owner module missing gate ${gate}`)
  }
}
for (const relation of [
  ...resourceMap.required_relations,
  ...(resourceMap.lifecycle_relations ?? []),
  ...resourceMap.forbidden_relations,
  ...(resourceMap.target_required_relations ?? []),
  ...(resourceMap.target_forbidden_relations ?? []),
]) {
  invariant(resourceIds.has(relation.from), `resource relation has unknown source: ${relation.from}`)
  invariant(resourceIds.has(relation.to), `resource relation has unknown target: ${relation.to}`)
}
const chromeProjection = functionMap.functions.find(row => row.function_id === 'project_chrome_slot_registry')
const logicProjection = functionMap.functions.find(row => row.function_id === 'project_logic_controls')
invariant(logicProjection?.owner === 'dsh-tui::logic-controls', 'logic projection function owner drift')
invariant(JSON.stringify(logicProjection.entry_symbols) === JSON.stringify(['TuiLogicControlRegistryService', 'project']),
  'logic projection entry symbols drift')
invariant(JSON.stringify(chromeProjection?.entry_symbols) === JSON.stringify([
  'TuiChromeSlotRegistry', 'apply', 'project', 'projectState',
]), 'chrome projection entry symbols drift')
const logicControlsContractGate = verification.gates.find(row => row.gate_id === 'logic_controls_contract')
invariant(logicControlsContractGate?.status === 'active'
  && logicControlsContractGate.command.includes('test:logic-controls')
  && logicControlsContractGate.command.includes('build:logic-controls')
  && logicControlsContractGate.command.includes('typecheck'),
  'logic-controls implemented contract must run test, build and type gates')
const logicSource = sourceFacts('playground/experiments/logic-controls/src/logic-controls.ts')
invariant(logicSource.identifiers.has('TuiLogicControlRegistryService'),
  'logic-control registry class is absent from its owned source')
invariant(logicSource.methods.get('project') !== undefined,
  'logic-control projection method is absent from its owned source')
function sourceFacts(relativePath) {
  const source = readText(relativePath)
  const ast = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const identifiers = new Set()
  const calls = new Set()
  const methods = new Map()
  const visit = node => {
    if (ts.isIdentifier(node)) identifiers.add(node.text)
    if (ts.isCallExpression(node)) calls.add(node.expression.getText(ast))
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) methods.set(node.name.text, node)
    node.forEachChild(visit)
  }
  ast.forEachChild(visit)
  return { identifiers, calls, methods, source, ast }
}

function namedTypeDeclaration(source, name) {
  return source.ast.statements.find(node =>
    (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
    && node.name.text === name)
}

function propertyNameText(member) {
  if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) return member.name.text
  return member.name?.getText(member.getSourceFile())
}

function interfacePropertyMap(source, name) {
  const declaration = namedTypeDeclaration(source, name)
  invariant(declaration !== undefined && ts.isInterfaceDeclaration(declaration),
    `interface declaration missing: ${name}`)
  const properties = new Map()
  for (const member of declaration.members) {
    invariant(ts.isPropertySignature(member), `${name}: only property signatures are allowed`)
    invariant(member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) === true,
      `${name}.${String(propertyNameText(member))}: must be readonly`)
    const propertyName = propertyNameText(member)
    invariant(typeof propertyName === 'string' && propertyName.length > 0,
      `${name}: unsupported property name`)
    invariant(!properties.has(propertyName), `${name}: duplicate property ${propertyName}`)
    properties.set(propertyName, member)
  }
  return properties
}

function assertInterfaceShape(source, name, required, optional = []) {
  const properties = interfacePropertyMap(source, name)
  sameSet(new Set(properties.keys()), new Set([...required, ...optional]), `${name} exact fields`)
  for (const field of required) {
    invariant(properties.get(field)?.questionToken === undefined, `${name}.${field}: must be required`)
  }
  for (const field of optional) {
    invariant(properties.get(field)?.questionToken !== undefined, `${name}.${field}: must be optional`)
  }
  return properties
}

function assertLiteralProperty(source, interfaceName, propertyName, literal) {
  const property = interfacePropertyMap(source, interfaceName).get(propertyName)
  invariant(property?.type !== undefined && ts.isLiteralTypeNode(property.type)
    && ts.isStringLiteral(property.type.literal) && property.type.literal.text === literal,
  `${interfaceName}.${propertyName}: expected literal ${literal}`)
}

function assertPropertyType(source, interfaceName, propertyName, expectedType) {
  const property = interfacePropertyMap(source, interfaceName).get(propertyName)
  invariant(property?.type !== undefined
    && normalizedNodeText(property.type, source) === expectedType.replace(/\s+/gu, ''),
  `${interfaceName}.${propertyName}: expected type ${expectedType}`)
}

function assertInterfaceMethodShape(
  source,
  interfaceName,
  methodName,
  parameterName,
  parameterType,
  returnType,
) {
  const method = interfaceMethod(source, interfaceName, methodName)
  invariant(method.parameters.length === 1
    && method.parameters[0].questionToken === undefined
    && method.parameters[0].name.getText(source.ast) === parameterName
    && normalizedNodeText(method.parameters[0].type, source) === parameterType.replace(/\s+/gu, '')
    && normalizedNodeText(method.type, source) === returnType.replace(/\s+/gu, ''),
  `${interfaceName}.${methodName}: exact method signature drift`)
}

function normalizedTypeText(source, name) {
  const declaration = namedTypeDeclaration(source, name)
  invariant(declaration !== undefined && ts.isTypeAliasDeclaration(declaration),
    `type alias declaration missing: ${name}`)
  return declaration.type.getText(source.ast).replace(/\s+/gu, '').replace(/^\|/u, '')
}

function declarationQualifiedNames(source, symbol) {
  const names = new Set()
  const visit = (node, scope) => {
    if ((ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node))
      && node.name?.text === symbol) {
      names.add([...scope, symbol].join('.'))
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === symbol) {
      names.add([...scope, symbol].join('.'))
    }
    if ((ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      for (const member of node.members) {
        if (member.name !== undefined && propertyNameText(member) === symbol) {
          names.add(`${node.name.text}.${symbol}`)
        }
      }
    }
    const childScope = ts.isFunctionDeclaration(node) && node.name
      ? [...scope, node.name.text]
      : scope
    node.forEachChild(child => visit(child, childScope))
  }
  source.ast.forEachChild(node => visit(node, []))
  return names
}

function interfaceMethod(source, interfaceName, methodName) {
  const declaration = source.ast.statements.find(node =>
    ts.isInterfaceDeclaration(node) && node.name.text === interfaceName)
  invariant(declaration !== undefined, `interface declaration missing: ${interfaceName}`)
  const method = declaration.members.find(member => ts.isMethodSignature(member)
    && propertyNameText(member) === methodName)
  invariant(method !== undefined, `${interfaceName}.${methodName}: method declaration missing`)
  return method
}

function normalizedNodeText(node, source) {
  return node.getText(source.ast).replace(/\s+/gu, '')
}

function importedSymbolNames(source) {
  const names = new Set()
  for (const statement of source.ast.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined) continue
    if (statement.importClause.name) names.add(statement.importClause.name.text)
    const bindings = statement.importClause.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) names.add(element.name.text)
    }
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text)
  }
  return names
}
function ownerSourcePaths(ownerId) {
  const [projectPrefix, moduleId] = ownerId.split('::')
  invariant(projectPrefix === 'dsh-tui' && moduleId !== undefined, `invalid owner id: ${ownerId}`)
  const moduleRow = moduleRegistry.modules.find(row => row.module_id === moduleId)
  invariant(moduleRow !== undefined, `error-chain owner is absent from module registry: ${ownerId}`)
  const paths = []
  for (const pattern of [...moduleRow.owned_paths, ...(moduleRow.repository_owned_paths ?? [])]) {
    if (pattern.endsWith('/**')) {
      const absoluteRoot = resolve(root, pattern.slice(0, -3))
      invariant(existsSync(absoluteRoot), `error-chain owner path does not exist: ${pattern}`)
      for (const path of walkFiles(absoluteRoot)) {
        if (path.endsWith('.ts')) paths.push(portablePath(relative(root, path)))
      }
    } else if (pattern.endsWith('.ts')) {
      invariant(existsSync(resolve(root, pattern)), `error-chain owner path does not exist: ${pattern}`)
      paths.push(pattern)
    }
  }
  invariant(paths.length > 0, `error-chain owner has no TypeScript source: ${ownerId}`)
  return [...new Set(paths)]
}
function assertImplementedErrorChainSymbols() {
  for (const chain of mainline.error_chains ?? []) {
    for (const edge of chain.edges) {
      if (edge.status !== 'implemented') continue
      invariant(Array.isArray(edge.entry_symbols) && edge.entry_symbols.length > 0,
        `implemented error chain ${chain.chain_id} edge ${edge.from}->${edge.to} has no entry symbols`)
      const sources = ownerSourcePaths(edge.owner).map(path => sourceFacts(path))
      for (const symbol of edge.entry_symbols) {
        invariant(sources.some(source => source.identifiers.has(symbol)),
          `error chain ${chain.chain_id} edge ${edge.from}->${edge.to}: symbol ${symbol} does not resolve in owner ${edge.owner}`)
      }
    }
  }
}
function declaredChromeSlotIds() {
  const contractPath = 'contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'
  const { ast } = sourceFacts(contractPath)
  let ids = null
  const visit = node => {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1) {
      const declaration = node.declarationList.declarations[0]
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'TUI_CHROME_SLOT_IDS'
        && declaration.initializer && ts.isCallExpression(declaration.initializer)
        && declaration.initializer.arguments.length === 1
        && ts.isAsExpression(declaration.initializer.arguments[0])
        && ts.isArrayLiteralExpression(declaration.initializer.arguments[0].expression)) {
        ids = declaration.initializer.arguments[0].expression.elements.map(element =>
          ts.isStringLiteral(element) ? element.text : null)
      }
    }
    node.forEachChild(visit)
  }
  ast.forEachChild(visit)
  invariant(ids?.every(id => typeof id === 'string'), 'canonical chrome slot tuple is not a closed string tuple')
  return ids
}
const chromeManifest = JSON.parse(readText('contracts/tui/chrome-slot-registry/manifest.json'))
sameSet(new Set(declaredChromeSlotIds()), new Set(chromeManifest.slot_ids),
  'canonical runtime <-> manifest chrome slot coverage')
invariant(JSON.stringify(declaredChromeSlotIds()) === JSON.stringify(chromeManifest.slot_ids),
  'canonical runtime <-> manifest chrome slot order')
invariant(Array.isArray(chromeManifest.plugins) && chromeManifest.plugins.length === declaredChromeSlotIds().length,
  'chrome manifest must declare one Cordis display plugin per slot')
invariant(JSON.stringify(chromeManifest.plugins.map(plugin => plugin.slot_id))
  === JSON.stringify(declaredChromeSlotIds()), 'chrome display plugin slot order drift')
invariant(JSON.stringify(chromeManifest.plugins.map(plugin => plugin.plugin)) === JSON.stringify([
  'tui.logo', 'tui.connection', 'tui.session', 'tui.status', 'tui.execution',
]), 'chrome display plugin identity drift')
sameSet(new Set(chromeManifest.plugins.map(plugin => plugin.module)), new Set([
  'dsh-tui::tui-logo', 'dsh-tui::tui-connection', 'dsh-tui::tui-session',
  'dsh-tui::tui-status', 'dsh-tui::tui-execution',
]), 'chrome display module ownership drift')
const appContainerSource = sourceFacts('playground/experiments/app-container/src/app-container.ts')
invariant(!appContainerSource.identifiers.has('tuiLogicControls'),
  'app-container cannot consume the logic-control registry directly')
invariant([...appContainerSource.calls].some(call => call.endsWith('.projectState')),
  'app-container must consume the closed chrome projectState edge')
const chromeSource = sourceFacts('playground/experiments/chrome-slot-registry/src/chrome-slot-registry.ts')
const chromeCallKinds = new Map()
const pluginSources = [
  'playground/experiments/tui-logo/src/tui-logo.ts',
  'playground/experiments/tui-connection/src/tui-connection.ts',
  'playground/experiments/tui-session/src/tui-session.ts',
  'playground/experiments/tui-status/src/tui-status.ts',
  'playground/experiments/tui-execution/src/tui-execution.ts',
].map(sourceFacts)
for (const pluginSource of pluginSources) {
  const visitPluginCalls = node => {
    if (ts.isCallExpression(node) && node.expression.getText(pluginSource.ast) === 'chromeControlProjection'
      && node.arguments.length === 2 && ts.isStringLiteral(node.arguments[1])) {
      chromeCallKinds.set(node.arguments[1].text, true)
    }
    node.forEachChild(visitPluginCalls)
  }
  pluginSource.ast.forEachChild(visitPluginCalls)
}
for (const expected of ['logo', 'connection', 'session', 'status', 'execution']) {
  invariant(chromeCallKinds.has(expected),
    `chrome producer must request adjacent logic-control projection for ${expected}`)
}
const projectStateMethod = chromeSource.methods.get('projectState')
invariant(projectStateMethod !== undefined, 'chrome registry must own projectState')
let projectStateCallsRegistry = false
const visitProjectState = node => {
  if (ts.isCallExpression(node) && node.expression.getText(chromeSource.ast) === 'this.project') {
    projectStateCallsRegistry = true
  }
  node.forEachChild(visitProjectState)
}
projectStateMethod.body?.forEachChild(visitProjectState)
invariant(projectStateCallsRegistry, 'chrome projectState must call its owned slot projector')
const chromeControlHelper = sourceFacts('contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts')
invariant([...chromeControlHelper.calls].some(call => call === 'input.logicControls.project'),
  'chrome contract helper must call the adjacent logic-control project method')
invariant(resourceMap.required_relations.some(relation =>
  relation.from === 'logic_control_registry'
  && relation.via === 'typed_chrome_projection_input'
  && relation.to === 'tui_chrome_slot_registry'), 'logic-control -> chrome-slot resource relation missing')
const auxEdges = mainline.auxiliary_edges ?? []
const appProjectionEdge = auxEdges.find(edge =>
  edge.from === 'tui_app_container_composition'
  && edge.to === 'tui_chrome_slot_registry.projectState')
const stateToSlotsEdge = auxEdges.find(edge =>
  edge.from === 'tui_chrome_slot_registry.projectState'
  && edge.to === 'tui_chrome_slot_registry.project')
const producerLogicEdges = auxEdges.filter(edge =>
  edge.from === 'chrome_slot_producer_project'
  && edge.to === 'chrome_control_helper.project')
const helperLogicEdge = auxEdges.find(edge =>
  edge.from === 'chrome_control_helper.project'
  && edge.to === 'logic_control_registry.project')
const displayLoaderEdge = auxEdges.find(edge =>
  edge.from === 'chrome_display_plugin_loader'
  && edge.to === 'chrome_display_plugin.apply')
const displayRegisterEdges = auxEdges.filter(edge =>
  edge.from === 'chrome_display_plugin.apply'
  && edge.to === 'tui_chrome_slot_registry.register')
invariant(appProjectionEdge?.owner === 'dsh-tui::app-container'
  && appProjectionEdge.caller === 'TuiAppContainerService.chromeFromSlots'
  && appProjectionEdge.callee === 'TuiChromeSlotRegistry.projectState',
  'app-container -> chrome state edge is not the parsed adjacent call edge')
invariant(stateToSlotsEdge?.owner === 'dsh-tui::chrome-slot-registry'
  && stateToSlotsEdge.caller === 'TuiChromeSlotRegistry.projectState'
  && stateToSlotsEdge.callee === 'TuiChromeSlotRegistry.project',
  'projectState -> project edge is not the parsed adjacent call edge')
invariant(producerLogicEdges.length === 5
  && JSON.stringify(producerLogicEdges.map(edge => edge.owner)) === JSON.stringify([
    'dsh-tui::tui-logo', 'dsh-tui::tui-connection', 'dsh-tui::tui-session',
    'dsh-tui::tui-status', 'dsh-tui::tui-execution',
  ])
  && producerLogicEdges.every(edge =>
    edge.caller === 'TuiChromeSlotProducer.project' && edge.callee === 'chromeControlProjection'),
  'five producer -> helper edges are not the parsed adjacent owner-bound calls')
invariant(helperLogicEdge?.owner === 'dsh-tui::chrome-slot-registry'
  && helperLogicEdge.caller === 'chromeControlProjection'
  && helperLogicEdge.callee === 'TuiLogicControlRegistryService.project',
  'helper -> logic-control edge is not the parsed runtime implementation edge')
invariant(displayLoaderEdge?.owner === 'dsh-tui::app-shell'
  && displayLoaderEdge.caller === 'startTui'
  && displayLoaderEdge.callee === 'ctx.plugin',
  'startup -> chrome display plugin edge is not the parsed adjacent loader edge')
invariant(displayRegisterEdges.length === 5
  && JSON.stringify(displayRegisterEdges.map(edge => edge.owner)) === JSON.stringify([
    'dsh-tui::tui-logo', 'dsh-tui::tui-connection', 'dsh-tui::tui-session',
    'dsh-tui::tui-status', 'dsh-tui::tui-execution',
  ])
  && JSON.stringify(displayRegisterEdges.map(edge => edge.caller)) === JSON.stringify([
    'tuiLogoDisplayPlugin.apply', 'tuiConnectionDisplayPlugin.apply', 'tuiSessionDisplayPlugin.apply',
    'tuiStatusDisplayPlugin.apply', 'tuiExecutionDisplayPlugin.apply',
  ])
  && displayRegisterEdges.every(edge => edge.callee === 'TuiChromeSlotRegistry.register'),
  'five display plugins do not bind five effect-owned registration edges')
invariant((resourceMap.lifecycle_relations ?? []).some(relation =>
  relation.from === 'tui_startup_outcome'
  && relation.via === 'startTui_installs_canonical_display_plugins'
  && relation.to === 'tui_chrome_display_plugin_lifecycle'), 'startup -> chrome display lifecycle machine relation missing')
invariant((resourceMap.lifecycle_relations ?? []).some(relation =>
  relation.from === 'tui_chrome_display_plugin_lifecycle'
  && relation.via === 'effect_owned_slot_registration'
  && relation.to === 'tui_chrome_slot_registry'), 'chrome display lifecycle -> registry machine relation missing')
const logicControlsSource = sourceFacts('playground/experiments/logic-controls/src/logic-controls.ts')
invariant(logicControlsSource.identifiers.has('TuiLogicControlRegistryService')
  && logicControlsSource.methods.has('project'),
  'chrome helper must bind to the registered logic-control service implementation')
const chromeTestSource = sourceFacts('tests/chrome-slot-registry/chrome-slot-registry.spec.ts')
invariant(chromeTestSource.identifiers.has('applyLogicControls')
  && [...chromeTestSource.calls].some(call => call === 'applyLogicControls'),
  'chrome contract must bind the concrete logic-control owner in tests')
invariant([...chromeTestSource.calls].some(call => call.endsWith('.projectState')),
  'chrome contract must exercise the public projectState edge')
invariant(methodContainsText(chromeSource, 'register', 'ownerContext.effect')
  && methodContainsText(chromeSource, 'register', 'chrome-slot-registry.display.'),
  'chrome display registration must bind each producer to an owning Cordis effect')
invariant(pluginSources.length === 5
  && pluginSources.every(source => source.identifiers instanceof Set),
  'five plugin sources must be parsed')
for (const [source, identity] of [
  [pluginSources[0], 'tuiLogoDisplayPlugin'],
  [pluginSources[1], 'tuiConnectionDisplayPlugin'],
  [pluginSources[2], 'tuiSessionDisplayPlugin'],
  [pluginSources[3], 'tuiStatusDisplayPlugin'],
  [pluginSources[4], 'tuiExecutionDisplayPlugin'],
]) {
  invariant(source?.identifiers.has(identity) && source.calls.has('ctx.tuiChromeSlotRegistry.register'),
    `${identity} must own its effect-backed registration`)
}
const chromeStartupSource = sourceFacts('playground/experiments/startup/src/startup.ts')
invariant(chromeStartupSource.identifiers.has('chromeDisplayPlugins')
  && chromeStartupSource.calls.has('ctx.plugin')
  && !chromeStartupSource.identifiers.has('installChromeDisplayPlugins'),
  'app-shell startup must load five declared plugins through real Cordis fibers')
invariant(chromeTestSource.calls.has('ctx.plugin')
  && chromeTestSource.calls.has('fiber.dispose'),
  'chrome contract must exercise independent Cordis unload')
invariant(chromeProjection?.resource_ids.includes('logic_control_registry'),
  'project_chrome_slot_registry must bind its real logic-control input resource')
const appContainerMainlineEdge = mainline.edges.find(edge =>
  edge.from === 'TuiOutputIn05InkTreeComposed' && edge.to === 'TuiOutputIn06AppContainerFrame')
invariant(appContainerMainlineEdge.owner === 'dsh-tui::app-container', 'app-container mainline edge owner drift')
invariant(!appContainerMainlineEdge.entry_symbols.includes('TuiChromeSlotRegistry'),
  'app-container mainline edge cannot claim chrome-slot-registry symbols')
const appContainerSuite = testDesign.suites.find(row => row.suite_id === 'app-container.composition')
invariant(appContainerSuite.whitebox.includes('app-container may import only terminal-ui and chrome-slot-registry contract faces'),
  'app-container test design boundary drift')
invariant(appContainerSuite.negative.some(row => row.includes('missing headerSession or headerStatus')),
  'app-container test design must require complete chrome headers')
const chromeSuite = testDesign.suites.find(row => row.suite_id === 'chrome-display-plugins.registry')
invariant(chromeSuite.negative.some(row => row.includes('registered producer output with an extra control field')),
  'chrome display test design must require producer-output closure')
invariant(chromeSuite.negative.some(row => row.includes('incomplete required slot set')),
  'chrome display test design must require the five-slot set')
invariant(chromeSuite.negative.some(row => row.includes('projectState without logic-control owner fails')),
  'chrome display test design must require its missing-owner negative')
invariant(chromeSuite.negative.some(row => row.includes('extra projection input fields fail')),
  'chrome display test design must reject undeclared projection inputs')
invariant(appContainerSuite.negative.some(row => row.includes('typed composition failure preserves cause without rethrowing')),
  'app-container test design must bind typed composition failure truth')
const appShellSource = sourceFacts('playground/experiments/app-shell/src/app-shell.ts')
const compositionFailureRebindingEarly = functionMap.target_functions?.find(row =>
  row.function_id === 'route_composition_failure_to_terminal_failure')
invariant(compositionFailureRebindingEarly?.owner === 'dsh-tui::app-shell'
  && compositionFailureRebindingEarly.status === 'implemented'
  && compositionFailureRebindingEarly.binding_status === 'active'
  && JSON.stringify(compositionFailureRebindingEarly.entry_symbols)
    === JSON.stringify(['createTuiRuntimeController', 'routeCompositionFailureToTerminalFailure'])
  && compositionFailureRebindingEarly.declaration_bindings.some(row =>
    row.symbol === 'routeCompositionFailureToTerminalFailure'),
  'v4 composition error owner/function binding drift')
invariant([...appShellSource.calls].includes('deps.appContainer.composeFrameSafe'),
  'app-shell must request the safe typed app-container edge')
invariant([...appShellSource.calls].some(call => call === 'deps.lifecycle.fail'),
  'app-shell must route composition failure through the public terminal failure face')
const executableCompositionEdge = executableFrameLifecycle.composition_failure_rebinding
invariant(executableCompositionEdge.from === 'TuiExecutableErrorIn02AppCompositionFailure'
  && executableCompositionEdge.to === 'TuiExecutableErrorOut05TerminalFailure'
  && executableCompositionEdge.owner === 'dsh-tui::app-shell'
  && executableCompositionEdge.function_id === 'route_composition_failure_to_terminal_failure'
  && executableCompositionEdge.entry_symbols.includes('routeCompositionFailureToTerminalFailure')
  && executableCompositionEdge.inherited_edges.every(edge => edge.status === 'implemented')
  && executableCompositionEdge.inherited_edges.at(-1)?.entry_symbols.includes('cliExitForTuiStartupOutcome')
  && executableCompositionEdge.inherited_edges.at(-1)?.entry_symbols.includes('pluginExitForTuiStartupOutcome'),
  'composition error chain must bind app-container failure to executable process exit')
const lifecycleChainNodeOwners = executableFrameLifecycle.executable_frame_error_chain.nodes.map(node => node.owner)
invariant(JSON.stringify(lifecycleChainNodeOwners) === JSON.stringify([
  'dsh-tui::terminal-ui', 'dsh-tui::app-container', 'dsh-tui::terminal-ui',
  'dsh-tui::terminal-lifecycle', 'dsh-tui::terminal-lifecycle',
  'dsh-tui::app-shell', 'dsh-tui::app-shell',
]), 'executable error lifecycle node owners drift')
function methodContainsText(source, methodName, needle) {
  const method = source.methods.get(methodName)
  return method !== undefined && method.getText(source.ast).includes(needle)
}
const appContainerSafeMethod = appContainerSource.methods.get('composeFrameSafe')
invariant(appContainerSafeMethod !== undefined
  && methodContainsText(appContainerSource, 'composeFrameSafe', 'projectChromeInternal')
  && methodContainsText(appContainerSource, 'composeFrameSafe', 'buildFrame'),
  'app-container safe path must share its owned projection and build path')
const terminalLifecycleSource = sourceFacts('playground/experiments/terminal-lifecycle/src/terminal-lifecycle.ts')
for (const hardcodedChromeField of [
  'header.logo', 'header.connection', 'header.session', 'header.status',
  'logoVisible', 'connectionState', 'headerSession', 'headerStatus', 'executionState',
]) {
  invariant(!terminalLifecycleSource.source.includes(hardcodedChromeField),
    `terminal-lifecycle must not hand-assemble chrome; found ${hardcodedChromeField}`)
}
const chromeProjectionFunction = functionMap.target_functions?.find(row =>
  row.function_id === 'project_chrome_slots_to_terminal_nodes')
invariant(chromeProjectionFunction?.owner === 'dsh-tui::app-container'
  && chromeProjectionFunction.status === 'implemented'
  && chromeProjectionFunction.binding_status === 'active'
  && chromeProjectionFunction.declaration_bindings.some(binding =>
    binding.symbol === 'projectChromeInternal'
    && binding.path === 'playground/experiments/app-container/src/app-container.ts')
  && chromeProjectionFunction.declaration_bindings.some(binding =>
    binding.symbol === 'composeFrameSafe'
    && binding.path === 'playground/experiments/app-container/src/app-container.ts'),
  'chrome terminal-node projection owner/function binding drift')
invariant(!moduleRegistry.import_edges.some(edge =>
  edge.from === 'app-container' && edge.to === 'terminal-lifecycle'),
  'app-container must consume terminal-ui, not own a renderer edge to terminal-lifecycle')
invariant(resourceMap.required_relations.some(relation =>
  relation.from === 'typed_app_chrome_terminal_nodes'
  && relation.via === 'required_chrome_region_nodes'
  && relation.to === 'tui_app_container_composition'),
  'app-container -> ordered-tree chrome terminal-node resource relation missing')

const targetFrameResource = resourceMap.resources.find(row =>
  row.resource_id === 'typed_ordered_terminal_frame_tree')
const targetViewportObservationResource = resourceMap.resources.find(row =>
  row.resource_id === 'terminal_viewport_observation')
const targetValidatedViewportResource = resourceMap.resources.find(row =>
  row.resource_id === 'validated_terminal_viewport')
const targetCurrentViewportResource = resourceMap.resources.find(row =>
  row.resource_id === 'current_terminal_viewport')
const targetTerminalStatusResource = resourceMap.resources.find(row =>
  row.resource_id === 'terminal_status_projection')
const currentAppShellLocalErrorResource = resourceMap.resources.find(row =>
  row.resource_id === 'app_shell_local_error_state')
const targetRegionLeavesResource = resourceMap.resources.find(row =>
  row.resource_id === 'typed_terminal_region_leaves')
const targetRegionProjectionFailureResource = resourceMap.resources.find(row =>
  row.resource_id === 'terminal_region_projection_failure_chain')
const targetChromeNodesResource = resourceMap.resources.find(row =>
  row.resource_id === 'typed_app_chrome_terminal_nodes')
const targetRealizedTreeResource = resourceMap.resources.find(row =>
  row.resource_id === 'realized_terminal_primitive_tree')
const targetRealizationFailureResource = resourceMap.resources.find(row =>
  row.resource_id === 'terminal_primitive_realization_failure_chain')
const targetCarrierFailureResource = resourceMap.resources.find(row =>
  row.resource_id === 'terminal_carrier_failure_chain')
const currentAppCompositionFailureResource = resourceMap.resources.find(row =>
  row.resource_id === 'app_composition_failure_chain')
const targetAppCompositionFailureResource = resourceMap.resources.find(row =>
  row.resource_id === 'app_container_composition_failure_chain')
const currentStartupOutcomeResource = resourceMap.resources.find(row =>
  row.resource_id === 'tui_startup_outcome')
invariant(targetFrameResource?.status === 'active'
  && targetFrameResource.owner === 'dsh-tui::app-container'
  && targetFrameResource.truth_store === 'TuiAppContainerService_buildFrame_frozen_root',
  'ordered frame-tree resource must remain active and owned by app-container')
invariant(targetViewportObservationResource?.status === 'active'
  && targetViewportObservationResource.owner === 'dsh-tui::terminal-lifecycle'
  && targetViewportObservationResource.truth_store === 'TuiTerminalLifecycleService.observeViewport',
  'terminal viewport observation must remain active and owned by terminal-lifecycle')
invariant(targetValidatedViewportResource?.status === 'active'
  && targetValidatedViewportResource.owner === 'dsh-tui::app-event-bus'
  && targetValidatedViewportResource.truth_store
    === 'validateViewportSize_frozen_TuiValidatedTerminalViewport',
  'validated terminal viewport must remain active and owned by app-event-bus')
invariant(targetCurrentViewportResource?.status === 'active'
  && targetCurrentViewportResource.owner === 'dsh-tui::app-shell'
  && targetCurrentViewportResource.truth_store === 'createTuiRuntimeController_currentViewport',
  'current terminal viewport must remain active and owned by app-shell')
invariant(targetTerminalStatusResource?.status === undefined
  && targetTerminalStatusResource.owner === 'dsh-tui::app-shell'
  && targetTerminalStatusResource.kind === 'presentation_projection'
  && targetTerminalStatusResource.truth_store === 'createTuiRuntimeController_status_TuiTerminalStatusState'
  && targetTerminalStatusResource.current_evidence_binding?.local_function_symbol === 'status'
  && targetTerminalStatusResource.current_evidence_binding?.consumer_input_field === 'status',
  'terminal status must bind the current app-shell presentation projection truth')
invariant(currentAppShellLocalErrorResource?.status === undefined
  && currentAppShellLocalErrorResource.owner === 'dsh-tui::app-shell'
  && currentAppShellLocalErrorResource.kind === 'typed_control_state'
  && currentAppShellLocalErrorResource.truth_store === 'createTuiRuntimeController_local_fatalMessage',
  'app-shell local error state must remain current control truth outside presentation payload')
invariant(targetRegionLeavesResource?.status === 'active'
  && targetRegionLeavesResource.owner === 'dsh-tui::terminal-ui'
  && targetRegionLeavesResource.truth_store
    === 'TuiTerminalRegionProjectionResult_success_TuiTerminalRegionLeaves',
  'closed body region-leaf resource must remain active and owned by terminal-ui')
invariant(targetRegionProjectionFailureResource?.status === 'active'
  && targetRegionProjectionFailureResource.owner === 'dsh-tui::terminal-ui'
  && targetRegionProjectionFailureResource.truth_store === 'TuiTerminalRegionProjectionFailure',
  'region projection failure must remain a distinct terminal-ui source')
invariant(targetChromeNodesResource?.status === 'active'
  && targetChromeNodesResource.owner === 'dsh-tui::app-container'
  && targetChromeNodesResource.truth_store
    === 'TuiAppContainerService_projectChromeInternal_frozen_nodes',
  'typed app chrome nodes must remain an app-container-owned projection')
invariant(targetRealizedTreeResource?.status === 'active'
  && targetRealizedTreeResource.owner === 'dsh-tui::terminal-ui'
  && targetRealizedTreeResource.truth_store
    === 'TuiTerminalPrimitiveRealizationResult_success_TuiRealizedTerminalPrimitiveTree',
  'generic realized-tree resource must remain active and owned by terminal-ui')
invariant(targetRealizationFailureResource?.status === 'active'
  && targetRealizationFailureResource.owner === 'dsh-tui::terminal-ui'
  && targetRealizationFailureResource.kind === 'typed_error_chain'
  && targetRealizationFailureResource.truth_store === 'TuiTerminalPrimitiveRealizationFailure',
  'generic realization failure must remain an independent terminal-ui typed source')
invariant(targetCarrierFailureResource?.status === 'active'
  && targetCarrierFailureResource.owner === 'dsh-tui::terminal-lifecycle'
  && targetCarrierFailureResource.truth_store === 'TuiTerminalCarrierFailureSource',
  'carrier failure must remain an independent terminal-lifecycle typed source')
invariant(currentAppCompositionFailureResource?.status === undefined
  && currentAppCompositionFailureResource.truth_store === 'immutable_TuiTerminalCompositionResult_failure'
  && currentAppCompositionFailureResource.target_truth_store === undefined,
  'current app composition failure truth cannot masquerade as the target result domain')
invariant(targetAppCompositionFailureResource?.status === 'active'
  && targetAppCompositionFailureResource.owner === 'dsh-tui::app-container'
  && targetAppCompositionFailureResource.truth_store === 'TuiAppContainerCompositionFailure',
  'app-container composition failure must use a versioned resource domain')
invariant(currentStartupOutcomeResource?.status === undefined
  && currentStartupOutcomeResource.owner === 'dsh-tui::app-shell'
  && currentStartupOutcomeResource.truth_store === 'single_settlement_TuiStartupOutcome',
  'startup outcome must remain the current single-settlement error-chain intermediary')

const currentFailureTail = resourceMap.required_relations.filter(row =>
  ['terminal_failure_chain', 'tui_startup_outcome', 'process_exit_control'].includes(row.from)
  || ['terminal_failure_chain', 'tui_startup_outcome', 'process_exit_control'].includes(row.to))
sameSet(new Set(currentFailureTail.map(row => `${row.from}|${row.via}|${row.to}`)), new Set([
  'terminal_lifecycle|typed_terminal_failure|terminal_failure_chain',
  'terminal_carrier_failure_chain|enter_terminal_failure_once|terminal_failure_chain',
  'terminal_failure_chain|projectTerminalFailureOutcome|tui_startup_outcome',
  'tui_startup_outcome|exitCodeForTuiStartupOutcome|process_exit_control',
]), 'current terminal failure -> startup outcome -> process exit chain')

const targetRequiredRelations = resourceMap.target_required_relations ?? []
const targetForbiddenRelations = resourceMap.target_forbidden_relations ?? []
invariant(targetRequiredRelations.every(row => row.status === 'active'),
  'v4 target resource relations must remain complete and active')
sameSet(new Set(targetRequiredRelations.map(row => `${row.from}|${row.via}|${row.to}`)), new Set([
  'terminal_component_registry|terminal_ui_closed_region_projection|typed_terminal_region_leaves',
  'tui_presentation_model|terminal_ui_project_presentation_leaves|typed_terminal_region_leaves',
  'pending_input_projection|terminal_ui_append_local_echo_leaves|typed_terminal_region_leaves',
  'terminal_input_control|terminal_ui_project_composer_leaf|typed_terminal_region_leaves',
  'current_session_selection|app_shell_project_session_status|terminal_status_projection',
  'tui_presentation_model|app_shell_bind_status_publication_revision|terminal_status_projection',
  'app_shell_local_error_state|app_shell_attach_local_error_status|terminal_status_projection',
  'terminal_status_projection|terminal_ui_project_footer_status_leaf|typed_terminal_region_leaves',
  'tui_focus_overlay_stack|terminal_ui_project_optional_overlay_leaf|typed_terminal_region_leaves',
  'typed_terminal_region_leaves|closed_body_region_leaves|tui_app_container_composition',
  'typed_terminal_region_leaves|typed_region_projection_error|terminal_region_projection_failure_chain',
  'terminal_region_projection_failure_chain|app_shell_route_region_projection_failure|terminal_failure_chain',
  'tui_chrome_slot_registry|app_container_consume_project_state_and_map_terminal_nodes|typed_app_chrome_terminal_nodes',
  'typed_app_chrome_terminal_nodes|required_chrome_region_nodes|tui_app_container_composition',
  'terminal_lifecycle|observe_real_stream_dimensions|terminal_viewport_observation',
  'terminal_viewport_observation|publish_typed_terminal_resize_intent|tui_app_event_bus',
  'tui_app_event_bus|validate_and_freeze_viewport_app_event|validated_terminal_viewport',
  'validated_terminal_viewport|app_shell_store_pair_atomically|current_terminal_viewport',
  'current_terminal_viewport|required_composition_input|tui_app_container_composition',
  'tui_app_container_composition|build_and_freeze|typed_ordered_terminal_frame_tree',
  'tui_app_container_composition|typed_app_container_composition_error|app_container_composition_failure_chain',
  'typed_ordered_terminal_frame_tree|terminal_ui_generic_realization|realized_terminal_primitive_tree',
  'typed_ordered_terminal_frame_tree|typed_generic_realization_error|terminal_primitive_realization_failure_chain',
  'terminal_primitive_realization_failure_chain|app_shell_route_generic_realization_failure|terminal_failure_chain',
  'app_container_composition_failure_chain|app_shell_route_composition_failure|terminal_failure_chain',
  'realized_terminal_primitive_tree|generic_mount_input|terminal_lifecycle',
  'terminal_lifecycle|typed_mount_rerender_or_flush_failure|terminal_carrier_failure_chain',
  'terminal_carrier_failure_chain|enter_terminal_failure_once|terminal_failure_chain',
]), 'v4 target resource chain')
invariant(targetForbiddenRelations.every(row => row.status === 'active'),
  'v4 target forbidden relations must remain active')
const expectedTargetForbiddenRelations = new Set([
  'tui_app_container_composition->terminal_lifecycle',
  'terminal_component_registry->terminal_lifecycle',
  'typed_terminal_region_leaves->terminal_lifecycle',
  'tui_chrome_slot_registry->terminal_lifecycle',
  'tui_chrome_slot_registry->tui_app_container_composition',
  'terminal_viewport_observation->validated_terminal_viewport',
  'terminal_viewport_observation->tui_app_container_composition',
  'terminal_viewport_observation->current_terminal_viewport',
  'terminal_lifecycle->current_terminal_viewport',
  'tui_app_event_bus->tui_app_container_composition',
  'validated_terminal_viewport->tui_app_container_composition',
  'current_terminal_viewport->terminal_lifecycle',
  'tui_app_container_composition->terminal_failure_chain',
  'tui_presentation_model->tui_app_container_composition',
  'terminal_component_registry->tui_app_container_composition',
  'pending_input_projection->tui_app_container_composition',
  'terminal_input_control->tui_app_container_composition',
  'app_shell_local_error_state->typed_terminal_region_leaves',
  'current_session_selection->typed_terminal_region_leaves',
  'terminal_status_projection->tui_app_container_composition',
  'tui_focus_overlay_stack->tui_app_container_composition',
  'tui_presentation_model->terminal_lifecycle',
  'pending_input_projection->terminal_lifecycle',
  'terminal_input_control->terminal_lifecycle',
  'terminal_status_projection->terminal_lifecycle',
  'tui_focus_overlay_stack->terminal_lifecycle',
  'terminal_failure_chain->process_exit_control',
])
const targetFailureSources = [
  'terminal_region_projection_failure_chain',
  'app_container_composition_failure_chain',
  'terminal_primitive_realization_failure_chain',
  'terminal_carrier_failure_chain',
]
for (const source of targetFailureSources) {
  expectedTargetForbiddenRelations.add(`${source}->process_exit_control`)
  for (const other of targetFailureSources) {
    if (source !== other) expectedTargetForbiddenRelations.add(`${source}->${other}`)
  }
}
sameSet(new Set(targetForbiddenRelations.map(row => `${row.from}->${row.to}`)),
  expectedTargetForbiddenRelations, 'v4 target forbidden resource edges')

invariant(terminalFrameTreeContract.contract_id === 'tui.terminal-frame-tree.v1'
  && terminalFrameTreeContract.status === 'active'
  && terminalFrameTreeContract.binding_status === 'active'
  && terminalFrameTreeContract.owner === 'dsh-tui::terminal-ui',
  'shared terminal frame-tree contract status or owner drift')
invariant(JSON.stringify(terminalFrameTreeContract.frame_fields) === JSON.stringify([
  'contract', 'publicationRevision', 'root',
]), 'terminal frame-tree contract must carry exact frame fields without control payload leakage')
invariant(JSON.stringify(terminalFrameTreeContract.node_union?.text?.fields) === JSON.stringify([
  'kind', 'key', 'text', 'style',
]) && JSON.stringify(terminalFrameTreeContract.node_union?.box?.fields) === JSON.stringify([
  'kind', 'key', 'style', 'children',
]) && JSON.stringify(terminalFrameTreeContract.node_union?.text?.style_fields) === JSON.stringify([
  'bold', 'dimColor', 'inverse', 'color',
]) && JSON.stringify(terminalFrameTreeContract.node_union?.box?.style_fields) === JSON.stringify([
  'flexDirection', 'width', 'borderStyle', 'paddingX',
]), 'terminal frame-tree node union or style family is not closed')
for (const rule of [
  'plain_objects_only', 'exact_own_fields_only', 'no_symbol_keys', 'no_accessors',
  'no_explicit_undefined', 'recursively_frozen', 'acyclic',
  'globally_unique_stable_keys', 'keys_exclude_layout_revision_and_position',
]) {
  invariant(terminalFrameTreeContract.closure_rules.includes(rule),
    `terminal frame-tree closure rule missing: ${rule}`)
}
invariant(terminalFrameTreeContract.key_contract?.grammar
  === '^[a-z][a-z0-9]*(?:[.:][a-z0-9_-]+)+$'
  && terminalFrameTreeContract.key_contract.uniqueness_scope === 'entire_frame_tree'
  && terminalFrameTreeContract.key_contract.dynamic_encoding === 'lowercase_hex_sha256_of_stable_source_identity'
  && JSON.stringify(terminalFrameTreeContract.key_contract.forbidden_sources)
    === JSON.stringify(['layout', 'publication_revision', 'array_position']),
  'terminal frame stable-key grammar, scope or source contract drift')
for (const forbiddenField of [
  'metadata', 'debug', 'provider', 'routing', 'retry', 'invalidation',
  'sessionEvent', 'transportFrame',
]) {
  invariant(terminalFrameTreeContract.forbidden_payload_fields.includes(forbiddenField),
    `terminal frame-tree payload separation rule missing: ${forbiddenField}`)
}

invariant(validatedViewportContract.contract_id === 'tui.validated-terminal-viewport.v1'
  && validatedViewportContract.status === 'active'
  && validatedViewportContract.binding_status === 'active'
  && validatedViewportContract.owner === 'dsh-tui::app-event-bus'
  && validatedViewportContract.type_path === 'contracts/tui/app-event-bus/validated-terminal-viewport.types.ts'
  && validatedViewportContract.type_symbol === 'TuiValidatedTerminalViewport',
  'validated viewport canonical type owner or Phase 1 status drift')
invariant(validatedViewportContract.source_resource === 'terminal_viewport_observation'
  && validatedViewportContract.input_resource === 'tui_app_event_bus'
  && validatedViewportContract.output_resource === 'validated_terminal_viewport'
  && validatedViewportContract.input_contract_node === 'TuiInputIn01TerminalIntent'
  && validatedViewportContract.output_contract_node === 'TuiInputIn02AppEvent'
  && mainlineIds.has(validatedViewportContract.input_contract_node)
  && mainlineIds.has(validatedViewportContract.output_contract_node),
  'validated viewport must pass through the typed app-event-bus input chain')
invariant(JSON.stringify(validatedViewportContract.fields) === JSON.stringify(['columns', 'rows'])
  && validatedViewportContract.rules.includes('plain_exact_object')
  && validatedViewportContract.rules.includes('columns_is_positive_safe_integer')
  && validatedViewportContract.rules.includes('rows_is_positive_safe_integer')
  && validatedViewportContract.rules.includes('no_accessors_symbols_or_explicit_undefined')
  && validatedViewportContract.rules.includes('validated_pair_is_frozen_before_state_storage')
  && validatedViewportContract.rules.includes('validated_pair_is_forwarded_by_reference_without_reconstruction'),
  'validated viewport pair must be exact, safe and frozen')
invariant(validatedViewportContract.output_resize_branch?.contract_node === 'TuiInputIn02AppEvent'
  && validatedViewportContract.output_resize_branch.size_type === 'TuiValidatedTerminalViewport'
  && JSON.stringify(validatedViewportContract.output_resize_branch.pair_rules) === JSON.stringify([
    'plain_exact_object',
    'own_string_keys_exactly_columns_and_rows',
    'no_symbol_keys',
    'no_accessors',
    'no_explicit_undefined',
    'columns_positive_safe_integer',
    'rows_positive_safe_integer',
    'pair_frozen_before_subscriber_delivery',
    'containing_resize_intent_frozen_before_subscriber_delivery',
  ]), 'validated viewport output branch must close and freeze the canonical pair before dispatch')
invariant(validatedViewportContract.phase2_replacement?.path
  === 'playground/experiments/app-event-bus/src/app-event-bus.ts'
  && validatedViewportContract.phase2_replacement.declaration_symbol === 'ViewportSize'
  && validatedViewportContract.phase2_replacement.replacement_symbol === 'TuiValidatedTerminalViewport',
  'validated viewport duplicate DTO replacement binding drift')

invariant(viewportBootstrapContract.contract_id === 'tui.terminal-viewport-bootstrap.v1'
  && viewportBootstrapContract.status === 'active'
  && viewportBootstrapContract.binding_status === 'active'
  && viewportBootstrapContract.owner === 'dsh-tui::app-shell',
  'viewport bootstrap contract owner or Phase 1 status drift')
invariant(viewportBootstrapContract.resources?.observation === 'terminal_viewport_observation'
  && viewportBootstrapContract.resources.typed_event_bus === 'tui_app_event_bus'
  && viewportBootstrapContract.resources.validator_output === 'validated_terminal_viewport'
  && viewportBootstrapContract.resources.state === 'current_terminal_viewport'
  && viewportBootstrapContract.resources.consumer === 'tui_app_container_composition',
  'viewport bootstrap resources must bind every adjacent owner')
invariant(JSON.stringify(viewportBootstrapContract.initial_sequence) === JSON.stringify([
  'install_viewport_app_event_subscription',
  'install_terminal_input_handler',
  'enter_terminal_without_mounting',
  'attach_stdout_resize_listener',
  'observe_real_stream_columns_and_rows',
  'publish_typed_terminal_resize_intent',
  'validate_exact_positive_safe_integer_pair',
  'store_frozen_pair_atomically',
  'assert_current_viewport_before_start',
  'compose_first_ordered_frame',
  'realize_generic_primitives',
  'mount_first_frame',
]) && JSON.stringify(viewportBootstrapContract.resize_sequence) === JSON.stringify([
  'observe_resize_columns_and_rows',
  'publish_typed_terminal_resize_intent',
  'validate_exact_positive_safe_integer_pair',
  'replace_frozen_pair_atomically',
  'compose_ordered_frame',
  'realize_generic_primitives',
  'rerender_once',
]), 'viewport bootstrap and resize sequence drift')
for (const failureRule of [
  'missing_initial_columns_fails_before_terminal_mount',
  'missing_initial_rows_fails_before_terminal_mount',
  'invalid_initial_pair_fails_before_terminal_mount',
  'no_width_or_rows_default',
  'no_partial_columns_only_state',
  'no_first_compose_before_current_viewport_exists',
  'no_direct_validator_or_store_bypass_around_typed_app_event_publication',
  'no_viewport_copy_or_reconstruction_before_frame_construction',
]) {
  invariant(viewportBootstrapContract.failure_rules.includes(failureRule),
    `viewport bootstrap failure rule missing: ${failureRule}`)
}
invariant(viewportBootstrapContract.pair_identity
  === 'same_frozen_reference_as_TuiInputIn02AppEvent.intent.size',
'viewport bootstrap must preserve the validated pair identity through first composition')

invariant(orderedAppFrameContract.contract_id === 'tui.app-container.ordered-frame-policy.v3'
  && orderedAppFrameContract.status === 'active'
  && orderedAppFrameContract.binding_status === 'active'
  && orderedAppFrameContract.owner === 'dsh-tui::app-container'
  && orderedAppFrameContract.output_contract === terminalFrameTreeContract.contract_id,
  'ordered app-frame contract status, owner or shared contract drift')
invariant(orderedAppFrameContract.input_resources.every(resource => resourceIds.has(resource))
  && JSON.stringify(orderedAppFrameContract.input_resources) === JSON.stringify([
    'typed_terminal_region_leaves', 'typed_app_chrome_terminal_nodes', 'current_terminal_viewport',
  ]), 'ordered app-frame input resources must bind registered adjacent owners')
invariant(JSON.stringify(orderedAppFrameContract.output_fields) === JSON.stringify([
  'contract', 'publicationRevision', 'root',
]) && JSON.stringify(orderedAppFrameContract.output_forbidden_fields) === JSON.stringify([
  'layout', 'slots', 'chromeNodes', 'metadata',
]), 'ordered app-frame output must use order as truth without reconstruction metadata')
invariant(JSON.stringify(orderedAppFrameContract.required_slots) === JSON.stringify([
  'header.logo', 'header.connection', 'header.session', 'header.status',
  'transcript', 'execution', 'composer', 'footer',
]) && JSON.stringify(orderedAppFrameContract.optional_slots) === JSON.stringify(['overlay'])
  && orderedAppFrameContract.optional_slot_absence === 'omit_property_and_tree_node',
  'ordered app-frame slot cardinality or overlay omission drift')
invariant(JSON.stringify(orderedAppFrameContract.root_contract) === JSON.stringify({
  key: 'frame.root',
  kind: 'box',
  style: { flexDirection: 'column' },
  required_child_keys: [
    'region.header', 'region.transcript', 'region.execution', 'region.composer', 'region.footer',
  ],
  optional_child_keys: ['region.overlay'],
  cardinality: 'each_required_exactly_once_optional_zero_or_one',
  additional_children: false,
}), 'ordered app-frame root contract drift')
const expectedRegionContracts = {
  'region.header': {
    kind: 'box', style: { flexDirection: 'row' },
    ordered_child_keys: [
      'slot.header.logo', 'slot.header.connection', 'slot.header.session', 'slot.header.status',
    ],
    cardinality: 'exactly_one_of_each_no_extra',
  },
  'region.transcript': {
    kind: 'box', style: { flexDirection: 'column' },
    ordered_child_keys: ['leaf.transcript'], cardinality: 'exactly_one_no_extra',
  },
  'region.execution': {
    kind: 'box', style: { flexDirection: 'column' },
    ordered_child_keys: ['slot.execution'], cardinality: 'exactly_one_no_extra',
  },
  'region.composer': {
    kind: 'box', style: { flexDirection: 'column' },
    ordered_child_keys: ['leaf.composer'], cardinality: 'exactly_one_no_extra',
  },
  'region.overlay': {
    kind: 'box', style: { flexDirection: 'column' },
    ordered_child_keys: ['leaf.overlay'], presence: 'only_when_overlay_leaf_property_exists',
    cardinality: 'zero_or_one_no_placeholder',
  },
  'region.footer': {
    kind: 'box', style: { flexDirection: 'column' },
    ordered_child_keys: ['leaf.footer'], cardinality: 'exactly_one_no_extra',
  },
}
invariant(JSON.stringify(orderedAppFrameContract.region_contracts)
  === JSON.stringify(expectedRegionContracts), 'ordered app-frame region contracts drift')
const expectedSlotBindings = [
  ['header.logo', 'typed_app_chrome_terminal_nodes', 'TuiAppChromeTerminalNodes.logo', 'slot.header.logo', 'region.header'],
  ['header.connection', 'typed_app_chrome_terminal_nodes', 'TuiAppChromeTerminalNodes.connection', 'slot.header.connection', 'region.header'],
  ['header.session', 'typed_app_chrome_terminal_nodes', 'TuiAppChromeTerminalNodes.session', 'slot.header.session', 'region.header'],
  ['header.status', 'typed_app_chrome_terminal_nodes', 'TuiAppChromeTerminalNodes.status', 'slot.header.status', 'region.header'],
  ['transcript', 'typed_terminal_region_leaves', 'TuiTerminalRegionLeaves.transcript', 'leaf.transcript', 'region.transcript'],
  ['execution', 'typed_app_chrome_terminal_nodes', 'TuiAppChromeTerminalNodes.execution', 'slot.execution', 'region.execution'],
  ['composer', 'typed_terminal_region_leaves', 'TuiTerminalRegionLeaves.composer', 'leaf.composer', 'region.composer'],
  ['footer', 'typed_terminal_region_leaves', 'TuiTerminalRegionLeaves.footer', 'leaf.footer', 'region.footer'],
  ['overlay', 'typed_terminal_region_leaves', 'TuiTerminalRegionLeaves.overlay', 'leaf.overlay', 'region.overlay'],
]
invariant(JSON.stringify(orderedAppFrameContract.slot_bindings.map(row => [
  row.slot, row.source_resource, row.source_symbol, row.node_key, row.output_region,
])) === JSON.stringify(expectedSlotBindings), 'ordered app-frame slot bindings drift')
const chromeSlotContractSource = sourceFacts('contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts')
const chromeSlotImplementationSource = sourceFacts('playground/experiments/chrome-slot-registry/src/chrome-slot-registry.ts')
const terminalRegionLeavesSource = sourceFacts('contracts/tui/terminal-ui/terminal-region-leaves.types.ts')
const orderedFrameSlotTypesSource = sourceFacts('contracts/tui/app-container/ordered-app-frame.types.ts')
for (const binding of orderedAppFrameContract.slot_bindings) {
  invariant(resourceIds.has(binding.source_resource),
    `ordered app-frame slot ${binding.slot}: unknown source resource`)
  const source = binding.source_resource === 'typed_app_chrome_terminal_nodes'
    ? orderedFrameSlotTypesSource
    : terminalRegionLeavesSource
  invariant(declarationQualifiedNames(source, binding.source_symbol.split('.').at(-1))
    .has(binding.source_symbol),
  `ordered app-frame slot ${binding.slot}: source symbol is not a real public declaration`)
  invariant(binding.source === undefined,
    `ordered app-frame slot ${binding.slot}: pseudo dotted source is forbidden`)
}
invariant(!JSON.stringify(orderedAppFrameContract).includes('region.status')
  && orderedAppFrameContract.invariants.includes('footer_owns_existing_status_block')
  && orderedAppFrameContract.slot_bindings.some(row => row.slot === 'footer'
    && row.source_resource === 'typed_terminal_region_leaves'
    && row.source_symbol === 'TuiTerminalRegionLeaves.footer'
    && row.output_region === 'region.footer')
  && orderedAppFrameContract.slot_bindings.some(row => row.slot === 'execution'
    && row.source_resource === 'typed_app_chrome_terminal_nodes'
    && row.source_symbol === 'TuiAppChromeTerminalNodes.execution'),
  'footer must own the current status block without an implicit status region')

const chromeProjectionContract = orderedAppFrameContract.chrome_projection_contract
invariant(chromeProjectionContract?.source_resource === 'tui_chrome_slot_registry'
  && chromeProjectionContract.consumer_symbol === 'TuiChromeSlotRegistryFace.projectState'
  && chromeProjectionContract.consumer_input_symbol === 'TuiAppChromeProjectionInput'
  && JSON.stringify(chromeProjectionContract.consumer_input_fields) === JSON.stringify(['publicationRevision'])
  && chromeProjectionContract.target_publication_revision_source
    === 'TuiAppChromeProjectionInput.publicationRevision'
  && chromeProjectionContract.revision_policy
    === 'exact_nonnegative_safe_integer_forwarded_without_default_copy_or_reconstruction'
  && chromeProjectionContract.target_resource === 'typed_app_chrome_terminal_nodes'
  && chromeProjectionContract.target_symbol === 'TuiAppChromeTerminalNodes'
  && chromeProjectionContract.target_function_id === 'project_chrome_slots_to_terminal_nodes',
  'ordered app-frame chrome projection owner, input or revision policy drift')
invariant(JSON.stringify(chromeProjectionContract.implementation_lineage) === JSON.stringify({
  project_state_symbol: 'TuiChromeSlotRegistry.projectState',
  producer_symbol: 'TuiChromeSlotRegistry.project',
  producer_call: 'this.project',
  producer_discriminator_field: 'slotId',
  producer_discriminator_values: [
    'header.logo', 'header.connection', 'header.session', 'header.status', 'execution',
  ],
}), 'ordered app-frame chrome projectState -> project lineage drift')
invariant(JSON.stringify(chromeProjectionContract.mappings) === JSON.stringify([
  { slot: 'header.logo', source_fields: ['logoVariant', 'logoVisible'], node_key: 'slot.header.logo', text_projection: 'visible_full_DSH_compact_D_hidden_empty', style_projection: { bold_from: 'logoVisible' } },
  { slot: 'header.connection', source_fields: ['connectionState'], node_key: 'slot.header.connection', text_projection: 'connection_state_literal', style_projection: {} },
  { slot: 'header.session', source_fields: ['headerSession'], node_key: 'slot.header.session', text_projection: 'header_session_literal', style_projection: {} },
  { slot: 'header.status', source_fields: ['headerStatus'], node_key: 'slot.header.status', text_projection: 'header_status_literal', style_projection: {} },
  { slot: 'execution', source_fields: ['executionState'], node_key: 'slot.execution', text_projection: 'execution_state_marker', style_projection: { dimColor: true } },
]), 'ordered app-frame chrome semantic mapping drift')
const projectStateContractMethod = interfaceMethod(chromeSlotContractSource,
  'TuiChromeSlotRegistryFace', 'projectState')
invariant(projectStateContractMethod.parameters.length === 1
  && projectStateContractMethod.parameters[0].name.getText(chromeSlotContractSource.ast) === 'input'
  && normalizedNodeText(projectStateContractMethod.parameters[0].type, chromeSlotContractSource)
    === '{readonlypublicationRevision:TuiChromeRevision}'
  && normalizedNodeText(projectStateContractMethod.type, chromeSlotContractSource)
    === 'TuiChromeProjectionState',
  'chrome public projectState face must accept only publicationRevision')
invariant(methodContainsText(chromeSlotImplementationSource, 'projectState', 'this.project({')
  && methodContainsText(chromeSlotImplementationSource, 'projectState', 'logicControls: registry')
  && !methodContainsText(chromeSlotImplementationSource, 'projectState', 'input.logicControls'),
  'chrome projectState implementation must reuse project without public logicControls input')
const targetChromeProjectionFunction = targetFunctions.find(row =>
  row.function_id === 'project_chrome_slots_to_terminal_nodes')
invariant(targetChromeProjectionFunction?.owner === 'dsh-tui::app-container'
  && targetChromeProjectionFunction.input_type === 'TuiAppChromeProjectionInput'
  && targetChromeProjectionFunction.source_output_type === 'TuiChromeProjectionState'
  && targetChromeProjectionFunction.output_type === 'TuiAppChromeTerminalNodes'
  && targetChromeProjectionFunction.result_type === 'TuiAppChromeProjectionResult'
  && JSON.stringify(targetChromeProjectionFunction.resource_ids) === JSON.stringify([
    'tui_chrome_slot_registry', 'typed_app_chrome_terminal_nodes',
    'app_container_composition_failure_chain',
  ]), 'target chrome projection function contract drift')

invariant(terminalRegionLeavesContract.contract_id === 'tui.terminal-region-leaves.v1'
  && terminalRegionLeavesContract.status === 'active'
  && terminalRegionLeavesContract.binding_status === 'active'
  && terminalRegionLeavesContract.owner === 'dsh-tui::terminal-ui'
  && terminalRegionLeavesContract.chrome_input === 'excluded_adjacent_app_container_input',
  'terminal body-region leaf contract status, owner or chrome boundary drift')
invariant(JSON.stringify(terminalRegionLeavesContract.required_fields) === JSON.stringify([
  'contract', 'publicationRevision', 'transcript', 'composer', 'footer',
]) && JSON.stringify(terminalRegionLeavesContract.optional_fields) === JSON.stringify(['overlay'])
  && JSON.stringify(terminalRegionLeavesContract.required_leaf_keys) === JSON.stringify([
  'leaf.transcript', 'leaf.composer', 'leaf.footer',
]) && JSON.stringify(terminalRegionLeavesContract.optional_leaf_keys) === JSON.stringify(['leaf.overlay']),
  'terminal body-region leaf set must be exact and closed')
invariant(JSON.stringify(terminalRegionLeavesContract.footer_contract) === JSON.stringify({
  ordered_child_keys: ['footer.status', 'footer.marker'],
  cardinality: 'exactly_one_of_each_no_extra',
  status_source_resource: 'terminal_status_projection',
}), 'terminal footer leaf must bind one status node and one marker node')
for (const rule of [
  'property_omitted_when_absent', 'null_or_placeholder_forbidden',
  'item_values_nonempty_and_unique', 'selected_item_key_derived_from_value_not_position',
]) {
  invariant(terminalRegionLeavesContract.overlay_rules.includes(rule),
    `terminal body-region overlay rule missing: ${rule}`)
}
invariant(JSON.stringify(orderedAppFrameContract.layout_policies?.default) === JSON.stringify([
  { key: 'region.header', presence: 'required' },
  { key: 'region.transcript', presence: 'required' },
  { key: 'region.execution', presence: 'required' },
  { key: 'region.composer', presence: 'required' },
  { key: 'region.overlay', presence: 'when_overlay_present' },
  { key: 'region.footer', presence: 'required' },
]) && JSON.stringify(orderedAppFrameContract.layout_policies?.compact) === JSON.stringify([
  { key: 'region.transcript', presence: 'required' },
  { key: 'region.execution', presence: 'required' },
  { key: 'region.overlay', presence: 'when_overlay_present' },
  { key: 'region.composer', presence: 'required' },
  { key: 'region.header', presence: 'required' },
  { key: 'region.footer', presence: 'required' },
]), 'ordered app-frame default/compact policy drift')

const validatedViewportTypesSource = sourceFacts('contracts/tui/app-event-bus/validated-terminal-viewport.types.ts')
const terminalFrameTypesSource = sourceFacts('contracts/tui/terminal-ui/terminal-frame-tree.types.ts')
const terminalRegionLeavesTypesSource = sourceFacts('contracts/tui/terminal-ui/terminal-region-leaves.types.ts')
const orderedFrameTypesSource = sourceFacts('contracts/tui/app-container/ordered-app-frame.types.ts')
const orderedFrameResultTypesSource = sourceFacts('contracts/tui/app-container/ordered-app-frame-result.types.ts')
const terminalFramePipelineResultTypesSource = sourceFacts('contracts/tui/terminal-ui/terminal-frame-pipeline-result.types.ts')
const terminalCarrierResultTypesSource = sourceFacts('contracts/tui/terminal-lifecycle/terminal-carrier-result.types.ts')
assertInterfaceShape(validatedViewportTypesSource, 'TuiValidatedTerminalViewport', ['columns', 'rows'])
assertInterfaceShape(terminalFrameTypesSource, 'TuiTerminalTextStyle', [], [
  'bold', 'dimColor', 'inverse', 'color',
])
assertInterfaceShape(terminalFrameTypesSource, 'TuiTerminalBoxStyle', ['flexDirection'], [
  'width', 'borderStyle', 'paddingX',
])
assertInterfaceShape(terminalFrameTypesSource, 'TuiTerminalTextNode', [
  'kind', 'key', 'text', 'style',
])
assertLiteralProperty(terminalFrameTypesSource, 'TuiTerminalTextNode', 'kind', 'text')
assertInterfaceShape(terminalFrameTypesSource, 'TuiTerminalBoxNode', [
  'kind', 'key', 'style', 'children',
])
assertLiteralProperty(terminalFrameTypesSource, 'TuiTerminalBoxNode', 'kind', 'box')
const frameProperties = assertInterfaceShape(terminalFrameTypesSource, 'TuiTerminalFrameTree', [
  'contract', 'publicationRevision', 'root',
])
assertLiteralProperty(terminalFrameTypesSource, 'TuiTerminalFrameTree', 'contract', 'tui.terminal-frame-tree.v1')
invariant(normalizedTypeText(terminalFrameTypesSource, 'TuiTerminalTextColor')
  === "'red'|'yellow'|'green'|'cyan'"
  && normalizedTypeText(terminalFrameTypesSource, 'TuiTerminalPrimitiveNode')
    === 'TuiTerminalBoxNode|TuiTerminalTextNode',
  'shared terminal primitive union or color family drift')

for (const [interfaceName, key] of [
  ['TuiTerminalTranscriptLeaf', 'leaf.transcript'],
  ['TuiTerminalComposerLeaf', 'leaf.composer'],
  ['TuiTerminalOverlayLeaf', 'leaf.overlay'],
]) {
  assertInterfaceShape(terminalRegionLeavesTypesSource, interfaceName, ['key'])
  assertLiteralProperty(terminalRegionLeavesTypesSource, interfaceName, 'key', key)
}
for (const [interfaceName, key] of [
  ['TuiTerminalFooterStatusNode', 'footer.status'],
  ['TuiTerminalFooterMarkerNode', 'footer.marker'],
]) {
  assertInterfaceShape(terminalRegionLeavesTypesSource, interfaceName, ['key'])
  assertLiteralProperty(terminalRegionLeavesTypesSource, interfaceName, 'key', key)
}
const footerLeafProperties = assertInterfaceShape(
  terminalRegionLeavesTypesSource, 'TuiTerminalFooterLeaf', ['key', 'children'])
assertLiteralProperty(terminalRegionLeavesTypesSource, 'TuiTerminalFooterLeaf', 'key', 'leaf.footer')
invariant(footerLeafProperties.get('children').type?.getText(terminalRegionLeavesTypesSource.ast)
  .replace(/\s+/gu, '').replace(/,\]/gu, ']')
  === 'readonly[TuiTerminalFooterStatusNode,TuiTerminalFooterMarkerNode]',
  'TuiTerminalFooterLeaf.children must bind exact status and marker nodes')
assertInterfaceShape(terminalRegionLeavesTypesSource, 'TuiTerminalRegionLeaves', [
  'contract', 'publicationRevision', 'transcript', 'composer', 'footer',
], ['overlay'])
assertLiteralProperty(terminalRegionLeavesTypesSource, 'TuiTerminalRegionLeaves', 'contract',
  'tui.terminal-region-leaves.v1')

for (const [alias, expected] of [
  ['TuiAppLogoSlot', "TuiAppChromeSlotNode<'slot.header.logo'>"],
  ['TuiAppConnectionSlot', "TuiAppChromeSlotNode<'slot.header.connection'>"],
  ['TuiAppSessionSlot', "TuiAppChromeSlotNode<'slot.header.session'>"],
  ['TuiAppStatusSlot', "TuiAppChromeSlotNode<'slot.header.status'>"],
  ['TuiAppExecutionSlot', "TuiAppChromeSlotNode<'slot.execution'>"],
]) {
  invariant(normalizedTypeText(orderedFrameTypesSource, alias) === expected,
    `${alias}: stable slot specialization drift`)
}
const regionInterfaceKeys = [
  ['TuiAppHeaderRegion', 'region.header'],
  ['TuiAppTranscriptRegion', 'region.transcript'],
  ['TuiAppExecutionRegion', 'region.execution'],
  ['TuiAppComposerRegion', 'region.composer'],
  ['TuiAppOverlayRegion', 'region.overlay'],
  ['TuiAppFooterRegion', 'region.footer'],
]
assertInterfaceShape(orderedFrameTypesSource, 'TuiAppRowRegionStyle', ['flexDirection'])
assertLiteralProperty(orderedFrameTypesSource, 'TuiAppRowRegionStyle', 'flexDirection', 'row')
assertInterfaceShape(orderedFrameTypesSource, 'TuiAppColumnRegionStyle', ['flexDirection'])
assertLiteralProperty(orderedFrameTypesSource, 'TuiAppColumnRegionStyle', 'flexDirection', 'column')
for (const [interfaceName, key] of regionInterfaceKeys) {
  assertInterfaceShape(orderedFrameTypesSource, interfaceName, ['key', 'style', 'children'])
  assertLiteralProperty(orderedFrameTypesSource, interfaceName, 'key', key)
  const expectedStyle = interfaceName === 'TuiAppHeaderRegion'
    ? 'TuiAppRowRegionStyle'
    : 'TuiAppColumnRegionStyle'
  invariant(interfacePropertyMap(orderedFrameTypesSource, interfaceName)
    .get('style').type?.getText(orderedFrameTypesSource.ast) === expectedStyle,
  `${interfaceName}.style must match its exact region policy`)
}
const appHeaderProperties = interfacePropertyMap(orderedFrameTypesSource, 'TuiAppHeaderRegion')
invariant(appHeaderProperties.get('children').type?.getText(orderedFrameTypesSource.ast).replace(/\s+/gu, '')
  .replace(/,\]/gu, ']')
  === 'readonly[TuiAppLogoSlot,TuiAppConnectionSlot,TuiAppSessionSlot,TuiAppStatusSlot]',
  'TuiAppHeaderRegion.children must bind the four exact chrome slots')
for (const [interfaceName, leafType] of [
  ['TuiAppTranscriptRegion', 'TuiTerminalTranscriptLeaf'],
  ['TuiAppExecutionRegion', 'TuiAppExecutionSlot'],
  ['TuiAppComposerRegion', 'TuiTerminalComposerLeaf'],
  ['TuiAppOverlayRegion', 'TuiTerminalOverlayLeaf'],
  ['TuiAppFooterRegion', 'TuiTerminalFooterLeaf'],
]) {
  const properties = interfacePropertyMap(orderedFrameTypesSource, interfaceName)
  invariant(properties.get('children').type?.getText(orderedFrameTypesSource.ast).replace(/\s+/gu, '')
    === `readonly[${leafType}]`, `${interfaceName}.children specialization drift`)
}
assertInterfaceShape(orderedFrameTypesSource, 'TuiAppFrameRoot', ['key', 'style', 'children'])
assertLiteralProperty(orderedFrameTypesSource, 'TuiAppFrameRoot', 'key', 'frame.root')
invariant(interfacePropertyMap(orderedFrameTypesSource, 'TuiAppFrameRoot')
  .get('style').type?.getText(orderedFrameTypesSource.ast) === 'TuiAppColumnRegionStyle',
  'TuiAppFrameRoot.style must be the exact column policy')
invariant(interfacePropertyMap(orderedFrameTypesSource, 'TuiAppFrameRoot')
  .get('children').type?.getText(orderedFrameTypesSource.ast) === 'ReadonlyArray<TuiAppRootRegionNode>',
  'TuiAppFrameRoot.children must use the closed root-region union')
assertInterfaceShape(orderedFrameTypesSource, 'TuiAppContainerFrameV3', ['root'])
invariant(normalizedTypeText(orderedFrameTypesSource, 'TuiAppRootRegionNode') === [
  'TuiAppHeaderRegion', 'TuiAppTranscriptRegion', 'TuiAppExecutionRegion',
  'TuiAppComposerRegion', 'TuiAppOverlayRegion', 'TuiAppFooterRegion',
].join('|'), 'TuiAppRootRegionNode union drift')

invariant(orderedAppFrameResultContract.contract_id === 'tui.app-container.ordered-frame-result.v1'
  && orderedAppFrameResultContract.status === 'active'
  && orderedAppFrameResultContract.binding_status === 'active'
  && orderedAppFrameResultContract.owner === 'dsh-tui::app-container'
  && orderedAppFrameResultContract.type_path
    === 'contracts/tui/app-container/ordered-app-frame-result.types.ts'
  && orderedAppFrameResultContract.input_type === 'TuiAppContainerFrameInput'
  && orderedAppFrameResultContract.internal_builder_input_type
    === 'TuiAppContainerFrameBuildInput'
  && orderedAppFrameResultContract.success_type === 'TuiAppContainerFrameV3'
  && orderedAppFrameResultContract.failure_type === 'TuiAppContainerCompositionFailure'
  && orderedAppFrameResultContract.result_type === 'TuiAppContainerCompositionResult'
  && orderedAppFrameResultContract.face_type === 'TuiAppContainerFrameComposerFace'
  && orderedAppFrameResultContract.chrome_projector_face_type
    === 'TuiAppChromeTerminalNodeProjectorFace',
  'app-container result contract identity, owner or type binding drift')
invariant(JSON.stringify(orderedAppFrameResultContract.input_fields) === JSON.stringify([
  'publicationRevision', 'layout', 'regionLeaves', 'viewport',
]) && JSON.stringify(orderedAppFrameResultContract.internal_builder_input_fields)
  === JSON.stringify(['publicationRevision', 'layout', 'regionLeaves', 'viewport', 'chrome'])
  && JSON.stringify(orderedAppFrameResultContract.chrome_projection_input_fields)
    === JSON.stringify(['publicationRevision'])
  && JSON.stringify(orderedAppFrameResultContract.failure_fields)
    === JSON.stringify(['stage', 'code', 'message', 'cause'])
  && JSON.stringify(orderedAppFrameResultContract.failure_stages)
    === JSON.stringify(['chrome-projection', 'build', 'validate'])
  && orderedAppFrameResultContract.failure_code === 'invalid-app-container-frame'
  && orderedAppFrameResultContract.cause_type === 'Error'
  && orderedAppFrameResultContract.result_discriminator === 'ok',
  'app-container result exact fields, stages or failure contract drift')
assertInterfaceShape(orderedFrameResultTypesSource, 'TuiAppContainerFrameInput', [
  'publicationRevision', 'layout', 'regionLeaves', 'viewport',
])
assertPropertyType(orderedFrameResultTypesSource, 'TuiAppContainerFrameInput',
  'publicationRevision', 'number')
assertPropertyType(orderedFrameResultTypesSource, 'TuiAppContainerFrameInput',
  'layout', "'default'|'compact'")
assertPropertyType(orderedFrameResultTypesSource, 'TuiAppContainerFrameInput',
  'regionLeaves', 'TuiTerminalRegionLeaves')
assertPropertyType(orderedFrameResultTypesSource, 'TuiAppContainerFrameInput',
  'viewport', 'TuiAppCompositionViewport')
const internalBuildInput = namedTypeDeclaration(orderedFrameResultTypesSource,
  'TuiAppContainerFrameBuildInput')
invariant(internalBuildInput !== undefined && ts.isInterfaceDeclaration(internalBuildInput)
  && internalBuildInput.heritageClauses?.length === 1
  && internalBuildInput.heritageClauses[0].token === ts.SyntaxKind.ExtendsKeyword
  && internalBuildInput.heritageClauses[0].types.length === 1
  && normalizedNodeText(internalBuildInput.heritageClauses[0].types[0].expression,
    orderedFrameResultTypesSource) === 'TuiAppContainerFrameInput',
  'TuiAppContainerFrameBuildInput must extend only the public safe input')
assertInterfaceShape(orderedFrameResultTypesSource, 'TuiAppContainerFrameBuildInput', ['chrome'])
assertPropertyType(orderedFrameResultTypesSource, 'TuiAppContainerFrameBuildInput',
  'chrome', 'TuiAppChromeTerminalNodes')
assertInterfaceShape(orderedFrameResultTypesSource, 'TuiAppContainerCompositionFailure', [
  'stage', 'code', 'message', 'cause',
])
assertPropertyType(orderedFrameResultTypesSource, 'TuiAppContainerCompositionFailure',
  'stage', "'chrome-projection'|'build'|'validate'")
assertLiteralProperty(orderedFrameResultTypesSource, 'TuiAppContainerCompositionFailure',
  'code', 'invalid-app-container-frame')
assertPropertyType(orderedFrameResultTypesSource, 'TuiAppContainerCompositionFailure',
  'message', 'string')
assertPropertyType(orderedFrameResultTypesSource, 'TuiAppContainerCompositionFailure',
  'cause', 'Error')
invariant(normalizedTypeText(orderedFrameResultTypesSource, 'TuiAppContainerCompositionResult')
  === '{readonlyok:true;readonlyvalue:TuiAppContainerFrameV3}|{readonlyok:false;readonlyerror:TuiAppContainerCompositionFailure}'
  && normalizedTypeText(orderedFrameResultTypesSource, 'TuiAppChromeProjectionResult')
    === '{readonlyok:true;readonlyvalue:TuiAppChromeTerminalNodes}|{readonlyok:false;readonlyerror:TuiAppContainerCompositionFailure}',
  'app-container success/failure result arms drift')
assertInterfaceShape(orderedFrameResultTypesSource, 'TuiAppChromeProjectionInput', [
  'publicationRevision',
])
assertPropertyType(orderedFrameResultTypesSource, 'TuiAppChromeProjectionInput',
  'publicationRevision', 'number')
assertInterfaceMethodShape(orderedFrameResultTypesSource,
  'TuiAppChromeTerminalNodeProjectorFace', 'projectChrome', 'input',
  'TuiAppChromeProjectionInput', 'TuiAppChromeTerminalNodes')
assertInterfaceMethodShape(orderedFrameResultTypesSource,
  'TuiAppChromeTerminalNodeProjectorFace', 'projectChromeSafe', 'input',
  'TuiAppChromeProjectionInput', 'TuiAppChromeProjectionResult')
assertInterfaceMethodShape(orderedFrameResultTypesSource,
  'TuiAppContainerFrameComposerFace', 'composeFrame', 'input',
  'TuiAppContainerFrameInput', 'TuiAppContainerFrameV3')
assertInterfaceMethodShape(orderedFrameResultTypesSource,
  'TuiAppContainerFrameComposerFace', 'composeFrameSafe', 'input',
  'TuiAppContainerFrameInput', 'TuiAppContainerCompositionResult')

invariant(terminalFramePipelineResultContract.contract_id
    === 'tui.terminal-ui.frame-pipeline-result.v1'
  && terminalFramePipelineResultContract.status === 'active'
  && terminalFramePipelineResultContract.binding_status === 'active'
  && terminalFramePipelineResultContract.owner === 'dsh-tui::terminal-ui'
  && terminalFramePipelineResultContract.type_path
    === 'contracts/tui/terminal-ui/terminal-frame-pipeline-result.types.ts'
  && terminalFramePipelineResultContract.cause_type === 'Error'
  && terminalFramePipelineResultContract.result_discriminator === 'ok'
  && JSON.stringify(terminalFramePipelineResultContract.failure_fields)
    === JSON.stringify(['stage', 'code', 'message', 'cause']),
  'terminal-ui pipeline result contract identity or failure shape drift')
const regionProjectionResultContract = terminalFramePipelineResultContract.region_projection
invariant(regionProjectionResultContract?.input_type === 'TuiTerminalRegionProjectionInput'
  && JSON.stringify(regionProjectionResultContract.input_fields)
    === JSON.stringify(['model', 'localEchoes', 'composer', 'status', 'overlay'])
  && JSON.stringify(regionProjectionResultContract.optional_input_fields)
    === JSON.stringify(['overlay'])
  && regionProjectionResultContract.face_type === 'TuiTerminalRegionProjectorFace'
  && regionProjectionResultContract.throwing_method === 'project'
  && regionProjectionResultContract.safe_method === 'projectSafe'
  && regionProjectionResultContract.success_type === 'TuiTerminalRegionLeaves'
  && regionProjectionResultContract.failure_type === 'TuiTerminalRegionProjectionFailure'
  && regionProjectionResultContract.result_type === 'TuiTerminalRegionProjectionResult'
  && regionProjectionResultContract.failure_stage === 'region-projection'
  && regionProjectionResultContract.failure_code === 'invalid-terminal-region-leaves',
  'terminal-ui region projection result contract drift')
assertInterfaceShape(terminalFramePipelineResultTypesSource,
  'TuiTerminalRegionProjectionInput', ['model', 'localEchoes', 'composer', 'status'], ['overlay'])
for (const [field, type] of [
  ['model', 'TuiTerminalModel'],
  ['localEchoes', 'readonlyTuiTerminalLocalEchoState[]'],
  ['composer', 'TuiTerminalComposerState'],
  ['status', 'TuiTerminalStatusState'],
  ['overlay', 'TuiTerminalOverlayState'],
]) assertPropertyType(terminalFramePipelineResultTypesSource,
  'TuiTerminalRegionProjectionInput', field, type)
assertInterfaceShape(terminalFramePipelineResultTypesSource,
  'TuiTerminalRegionProjectionFailure', ['stage', 'code', 'message', 'cause'])
assertLiteralProperty(terminalFramePipelineResultTypesSource,
  'TuiTerminalRegionProjectionFailure', 'stage', 'region-projection')
assertLiteralProperty(terminalFramePipelineResultTypesSource,
  'TuiTerminalRegionProjectionFailure', 'code', 'invalid-terminal-region-leaves')
assertPropertyType(terminalFramePipelineResultTypesSource,
  'TuiTerminalRegionProjectionFailure', 'message', 'string')
assertPropertyType(terminalFramePipelineResultTypesSource,
  'TuiTerminalRegionProjectionFailure', 'cause', 'Error')
invariant(normalizedTypeText(terminalFramePipelineResultTypesSource,
  'TuiTerminalRegionProjectionResult')
    === '{readonlyok:true;readonlyvalue:TuiTerminalRegionLeaves}|{readonlyok:false;readonlyerror:TuiTerminalRegionProjectionFailure}',
  'terminal-ui region projection result arms drift')
assertInterfaceMethodShape(terminalFramePipelineResultTypesSource,
  'TuiTerminalRegionProjectorFace', 'project', 'input',
  'TuiTerminalRegionProjectionInput', 'TuiTerminalRegionLeaves')
assertInterfaceMethodShape(terminalFramePipelineResultTypesSource,
  'TuiTerminalRegionProjectorFace', 'projectSafe', 'input',
  'TuiTerminalRegionProjectionInput', 'TuiTerminalRegionProjectionResult')
const primitiveRealizationResultContract = terminalFramePipelineResultContract.primitive_realization
invariant(primitiveRealizationResultContract?.input_type === 'TuiTerminalFrameTree'
  && primitiveRealizationResultContract.success_type === 'TuiRealizedTerminalPrimitiveTree'
  && JSON.stringify(primitiveRealizationResultContract.success_fields)
    === JSON.stringify(['contract', 'root'])
  && primitiveRealizationResultContract.success_contract_literal
    === 'tui.realized-terminal-primitive-tree.v1'
  && primitiveRealizationResultContract.root_type === 'TuiTerminalPrimitiveNode'
  && primitiveRealizationResultContract.failure_type
    === 'TuiTerminalPrimitiveRealizationFailure'
  && primitiveRealizationResultContract.result_type
    === 'TuiTerminalPrimitiveRealizationResult'
  && primitiveRealizationResultContract.face_type === 'TuiTerminalPrimitiveRealizerFace'
  && primitiveRealizationResultContract.throwing_method === 'realize'
  && primitiveRealizationResultContract.safe_method === 'realizeSafe'
  && primitiveRealizationResultContract.failure_stage === 'primitive-realization'
  && primitiveRealizationResultContract.failure_code === 'invalid-terminal-primitive-tree',
  'terminal-ui primitive realization result contract drift')
assertInterfaceShape(terminalFramePipelineResultTypesSource,
  'TuiRealizedTerminalPrimitiveTree', ['contract', 'root'])
assertLiteralProperty(terminalFramePipelineResultTypesSource,
  'TuiRealizedTerminalPrimitiveTree', 'contract', 'tui.realized-terminal-primitive-tree.v1')
assertPropertyType(terminalFramePipelineResultTypesSource,
  'TuiRealizedTerminalPrimitiveTree', 'root', 'TuiTerminalPrimitiveNode')
assertInterfaceShape(terminalFramePipelineResultTypesSource,
  'TuiTerminalPrimitiveRealizationFailure', ['stage', 'code', 'message', 'cause'])
assertLiteralProperty(terminalFramePipelineResultTypesSource,
  'TuiTerminalPrimitiveRealizationFailure', 'stage', 'primitive-realization')
assertLiteralProperty(terminalFramePipelineResultTypesSource,
  'TuiTerminalPrimitiveRealizationFailure', 'code', 'invalid-terminal-primitive-tree')
assertPropertyType(terminalFramePipelineResultTypesSource,
  'TuiTerminalPrimitiveRealizationFailure', 'message', 'string')
assertPropertyType(terminalFramePipelineResultTypesSource,
  'TuiTerminalPrimitiveRealizationFailure', 'cause', 'Error')
invariant(normalizedTypeText(terminalFramePipelineResultTypesSource,
  'TuiTerminalPrimitiveRealizationResult')
    === '{readonlyok:true;readonlyvalue:TuiRealizedTerminalPrimitiveTree}|{readonlyok:false;readonlyerror:TuiTerminalPrimitiveRealizationFailure}',
  'terminal-ui primitive realization result arms drift')
assertInterfaceMethodShape(terminalFramePipelineResultTypesSource,
  'TuiTerminalPrimitiveRealizerFace', 'realize', 'frame',
  'TuiTerminalFrameTree', 'TuiRealizedTerminalPrimitiveTree')
assertInterfaceMethodShape(terminalFramePipelineResultTypesSource,
  'TuiTerminalPrimitiveRealizerFace', 'realizeSafe', 'frame',
  'TuiTerminalFrameTree', 'TuiTerminalPrimitiveRealizationResult')

invariant(terminalCarrierResultContract.contract_id === 'tui.terminal-lifecycle.carrier-result.v1'
  && terminalCarrierResultContract.status === 'active'
  && terminalCarrierResultContract.binding_status === 'active'
  && terminalCarrierResultContract.owner === 'dsh-tui::terminal-lifecycle'
  && terminalCarrierResultContract.type_path
    === 'contracts/tui/terminal-lifecycle/terminal-carrier-result.types.ts'
  && terminalCarrierResultContract.input_type === 'TuiRealizedTerminalPrimitiveTree'
  && terminalCarrierResultContract.failure_type === 'TuiTerminalCarrierFailure'
  && terminalCarrierResultContract.async_failure_type === 'TuiTerminalAsyncFlushFailure'
  && terminalCarrierResultContract.failure_source_type === 'TuiTerminalCarrierFailureSource'
  && terminalCarrierResultContract.result_type === 'TuiTerminalCarrierResult'
  && terminalCarrierResultContract.face_type === 'TuiTerminalCarrierFace'
  && terminalCarrierResultContract.method === 'render'
  && JSON.stringify(terminalCarrierResultContract.failure_fields)
    === JSON.stringify(['stage', 'code', 'message', 'cause'])
  && JSON.stringify(terminalCarrierResultContract.failure_stages)
    === JSON.stringify(['mount', 'rerender'])
  && terminalCarrierResultContract.failure_code === 'terminal-carrier-failed'
  && terminalCarrierResultContract.async_failure_stage === 'flush'
  && terminalCarrierResultContract.async_failure_code === 'terminal-flush-failed'
  && terminalCarrierResultContract.cause_type === 'Error'
  && terminalCarrierResultContract.result_discriminator === 'ok',
  'terminal carrier result contract identity, sync or async shape drift')
for (const [interfaceName, stageType, code] of [
  ['TuiTerminalCarrierFailure', "'mount'|'rerender'", 'terminal-carrier-failed'],
  ['TuiTerminalAsyncFlushFailure', "'flush'", 'terminal-flush-failed'],
]) {
  assertInterfaceShape(terminalCarrierResultTypesSource, interfaceName,
    ['stage', 'code', 'message', 'cause'])
  assertPropertyType(terminalCarrierResultTypesSource, interfaceName, 'stage', stageType)
  assertLiteralProperty(terminalCarrierResultTypesSource, interfaceName, 'code', code)
  assertPropertyType(terminalCarrierResultTypesSource, interfaceName, 'message', 'string')
  assertPropertyType(terminalCarrierResultTypesSource, interfaceName, 'cause', 'Error')
}
invariant(normalizedTypeText(terminalCarrierResultTypesSource,
  'TuiTerminalCarrierFailureSource')
    === 'TuiTerminalCarrierFailure|TuiTerminalAsyncFlushFailure'
  && normalizedTypeText(terminalCarrierResultTypesSource, 'TuiTerminalCarrierResult')
    === '{readonlyok:true}|{readonlyok:false;readonlyerror:TuiTerminalCarrierFailure}',
  'terminal carrier sync result or async failure-source union drift')
assertInterfaceMethodShape(terminalCarrierResultTypesSource,
  'TuiTerminalCarrierFace', 'render', 'tree',
  'TuiRealizedTerminalPrimitiveTree', 'TuiTerminalCarrierResult')
for (const forbiddenTargetField of [
  'layout', 'slots', 'chromeNodes', 'metadata', 'debug', 'provider', 'routing',
  'retry', 'invalidation', 'sessionEvent', 'transportFrame',
]) {
  invariant(!terminalFrameTypesSource.identifiers.has(forbiddenTargetField)
    && !terminalRegionLeavesTypesSource.identifiers.has(forbiddenTargetField)
    && !orderedFrameTypesSource.identifiers.has(forbiddenTargetField),
  `target TypeScript contracts contain forbidden field: ${forbiddenTargetField}`)
}
const targetLifecycle = (mainline.target_lifecycles ?? []).find(row =>
  row.lifecycle_id === 'dsh-tui-v4')
invariant((mainline.target_lifecycles ?? []).length === 1
  && targetLifecycle?.status === 'implemented'
  && targetLifecycle.binding_status === 'active'
  && targetLifecycle.replaces === 'dsh-tui-mainline-v3'
  && targetLifecycle.chain_kind === 'versioned_output_tail'
  && targetLifecycle.inherited_prefix?.lifecycle_id === 'dsh-tui-mainline-v3'
  && targetLifecycle.inherited_prefix.through_node === 'TuiOutputIn04TypedComponentResolved'
  && targetLifecycle.inherited_prefix.status === 'implemented'
  && targetLifecycle.replaces_scope?.from_node === 'TuiOutputIn05InkTreeComposed'
  && targetLifecycle.replaces_scope.to_node === 'TuiOutputOut07TerminalFrame'
  && targetLifecycle.entrypoint === 'TuiOutputIn04TypedComponentResolved'
  && targetLifecycle.return_path?.from === 'TuiExecutableOutputOut08TerminalFrame'
  && targetLifecycle.return_path.to === 'TuiInputIn01TerminalIntent'
  && targetLifecycle.return_path.to_scope === 'inherited_input_chain'
  && targetLifecycle.return_path.status === 'implemented'
  && targetLifecycle.cutover?.status === 'completed'
  && targetLifecycle.cutover.atomic === true
  && targetLifecycle.cutover.delete_replaced_path === true,
  'dsh-tui-v4 target lifecycle must remain an atomic design/pending cutover')
const viewportControlChain = targetLifecycle.viewport_bootstrap_control_chain
invariant(viewportControlChain?.chain_id === 'dsh-tui-v4-viewport-bootstrap'
  && viewportControlChain.status === 'implemented'
  && viewportControlChain.binding_status === 'active'
  && JSON.stringify(viewportControlChain.precondition_function_ids) === JSON.stringify([
    'install_viewport_subscription_before_enter',
    'install_terminal_input_handler_before_enter',
  ])
  && viewportControlChain.entry_function_id === 'observe_terminal_viewport'
  && viewportControlChain.postcondition_function_id === 'start_runtime_after_viewport_ready'
  && viewportControlChain.mount_precondition_resource === 'current_terminal_viewport'
  && JSON.stringify(viewportControlChain.postcondition) === JSON.stringify({
    resource_id: 'current_terminal_viewport',
    consumer_node: 'TuiExecutableOutputIn06OrderedAppFrameTree',
    consumer_function_id: 'build_ordered_app_frame_tree',
    same_pair_identity: 'TuiInputIn02AppEvent.intent.size',
  })
  && viewportControlChain.initial_failure === 'fail_before_terminal_mount'
  && viewportControlChain.defaults === 'forbidden',
  'v4 viewport control chain status, ordering or first-mount precondition drift')
const viewportNodeIds = unique(viewportControlChain.nodes.map(row => row.node_id), 'v4 viewport node ids')
invariant(JSON.stringify([...viewportNodeIds]) === JSON.stringify([
  'TuiViewportIn01TerminalStreamsObserved',
  'TuiViewportIn02ResizeIntentPublished',
  'TuiViewportIn03AppEventValidated',
  'TuiViewportOut04CurrentPairStored',
]), 'v4 viewport control node order drift')
for (const node of viewportControlChain.nodes) {
  invariant(resourceIds.has(node.resource_id),
    `v4 viewport node ${node.node_id}: unknown resource ${node.resource_id}`)
  invariant(resourceMap.resources.find(row => row.resource_id === node.resource_id)?.owner === node.owner,
    `v4 viewport node ${node.node_id}: resource owner drift`)
  if (node.contract_node !== undefined) {
    invariant(mainlineIds.has(node.contract_node),
      `v4 viewport node ${node.node_id}: unknown inherited contract node ${node.contract_node}`)
  }
}
invariant(viewportControlChain.nodes[1]?.contract_node === 'TuiInputIn01TerminalIntent'
  && viewportControlChain.nodes[2]?.contract_node === 'TuiInputIn02AppEvent',
  'v4 viewport publication must reuse the app-event-bus input nodes')
const expectedViewportEdges = [
  ['TuiViewportIn01TerminalStreamsObserved', 'TuiViewportIn02ResizeIntentPublished', 'publish_terminal_resize_intent'],
  ['TuiViewportIn02ResizeIntentPublished', 'TuiViewportIn03AppEventValidated', 'publish_typed_app_intent'],
  ['TuiViewportIn03AppEventValidated', 'TuiViewportOut04CurrentPairStored', 'store_current_terminal_viewport'],
]
invariant(JSON.stringify(viewportControlChain.edges.map(row => [row.from, row.to, row.function_id]))
  === JSON.stringify(expectedViewportEdges)
  && viewportControlChain.edges.every(row => row.status === 'implemented'
    && Array.isArray(row.entry_symbols)),
  'v4 viewport control edges must remain adjacent and pending')
for (const edge of viewportControlChain.edges) {
  const fn = targetFunctions.find(row => row.function_id === edge.function_id)
    ?? functionMap.functions.find(row => row.function_id === edge.function_id)
  invariant(fn?.owner === edge.owner,
    `v4 viewport edge ${edge.from}->${edge.to}: function owner drift`)
  if (edge.binding_kind === 'current_function_update') {
    const update = targetFunctionUpdates.find(row => row.function_id === edge.function_id)
    invariant(update?.status === 'implemented'
      && update.binding_status === 'active'
      && JSON.stringify(edge.entry_symbols) === JSON.stringify(fn.entry_symbols),
    `v4 viewport edge ${edge.from}->${edge.to}: current function update binding drift`)
  } else {
    invariant(edge.binding_kind === undefined && edge.entry_symbols.length > 0,
      `v4 viewport edge ${edge.from}->${edge.to}: active target binding incomplete`)
  }
}
for (const functionId of [
  ...viewportControlChain.precondition_function_ids,
  viewportControlChain.entry_function_id,
  viewportControlChain.postcondition_function_id,
]) {
  invariant(targetFunctionIds.has(functionId), `v4 viewport chain references unknown function: ${functionId}`)
}
const compositionFailureRebinding = targetLifecycle.composition_failure_rebinding
const regionProjectionFailureBinding = targetLifecycle.region_projection_failure_binding
const realizationFailureBinding = targetLifecycle.realization_failure_binding
const carrierFailureBinding = targetLifecycle.carrier_failure_binding
const targetFailureBindingSpecs = [
  [regionProjectionFailureBinding, 'TuiExecutableErrorIn01RegionProjectionFailure',
    'dsh-tui::app-shell', 'route_region_projection_failure_to_terminal_failure',
    'terminal_region_projection_failure_chain', 'TuiTerminalRegionProjectionFailure',
    'region_projection_failure_to_carrier_router', 'region-projection'],
  [compositionFailureRebinding, 'TuiExecutableErrorIn02AppCompositionFailure',
    'dsh-tui::app-shell', 'route_composition_failure_to_terminal_failure',
    'app_container_composition_failure_chain', 'TuiAppContainerCompositionFailure',
    'composition_failure_to_carrier_router', 'app-container-composition'],
  [realizationFailureBinding, 'TuiExecutableErrorIn03PrimitiveRealizationFailure',
    'dsh-tui::app-shell', 'route_generic_realization_failure_to_terminal_failure',
    'terminal_primitive_realization_failure_chain', 'TuiTerminalPrimitiveRealizationFailure',
    'generic_realization_failure_to_carrier_router', 'primitive-realization'],
  [carrierFailureBinding, 'TuiExecutableErrorIn04CarrierFailure',
    'dsh-tui::terminal-lifecycle', 'route_carrier_failure_to_terminal_failure',
    'terminal_carrier_failure_chain', 'TuiTerminalCarrierFailureSource',
    'carrier_failure_to_terminal_failure_router', 'terminal-carrier'],
]
const expectedFailureTail = [
  {
    from: 'TuiExecutableErrorOut05TerminalFailure',
    to: 'TuiExecutableErrorIn06StartupOutcome',
    status: 'implemented',
    owner: 'dsh-tui::app-shell',
    function_id: 'project_terminal_failure_startup_outcome',
    entry_symbols: ['startTui', 'projectTerminalFailureOutcome'],
  },
  {
    from: 'TuiExecutableErrorIn06StartupOutcome',
    to: 'TuiExecutableErrorOut07ProcessExit',
    status: 'implemented',
    owner: 'dsh-tui::app-shell',
    function_id: 'project_terminal_failure_exit',
    entry_symbols: [
      'cliExitForTuiStartupOutcome', 'pluginExitForTuiStartupOutcome',
      'exitCodeForTuiStartupOutcome',
    ],
  },
]
const failureSinkSource = sourceFacts(compositionFailureRebinding.sink_binding.path)
const expectedFailureSink = {
  symbol: 'fail',
  qualified_name: 'TuiTerminalLifecycleService.fail',
  path: 'playground/experiments/terminal-lifecycle/src/terminal-lifecycle.ts',
  public_symbol: 'fail',
  public_qualified_name: 'TuiTerminalLifecycle.fail',
}
invariant(JSON.stringify(compositionFailureRebinding?.sink_binding)
    === JSON.stringify(expectedFailureSink)
  && declarationQualifiedNames(failureSinkSource, 'fail')
    .has(expectedFailureSink.qualified_name)
  && declarationQualifiedNames(failureSinkSource, 'fail')
    .has(expectedFailureSink.public_qualified_name),
  'v4 executable-frame failures must enter the generic lifecycle fail face')
for (const [binding, from, owner, functionId, sourceResource, sourceType, role, sourceLiteral]
  of targetFailureBindingSpecs) {
  invariant(sourceResource !== 'terminal_primitive_realization_failure_chain'
    || (binding !== undefined && binding.source_resource === sourceResource),
    'generic realization failure must use an independent typed source')
  invariant(!Array.isArray(binding?.inherited_edges)
    || JSON.stringify(binding.inherited_edges) === JSON.stringify(expectedFailureTail),
    sourceResource === 'app_container_composition_failure_chain'
      ? 'v4 executable-frame failures must preserve the startup and process-exit edges'
      : 'generic realization failure must preserve the implemented startup and process-exit tail')
  invariant(binding?.chain_id === 'dsh-tui-executable-frame-error-v1'
    && binding.tail_id === 'terminal-failure-startup-exit'
    && binding.status === 'implemented'
    && binding.binding_status === 'active'
    && binding.from === from
    && binding.to === 'TuiExecutableErrorOut05TerminalFailure'
    && binding.owner === owner
    && binding.function_id === functionId
    && binding.source_resource === sourceResource
    && binding.source_type === sourceType
    && Array.isArray(binding.entry_symbols) && binding.entry_symbols.length > 0
    && JSON.stringify(binding.sink_binding) === JSON.stringify(expectedFailureSink)
    && JSON.stringify(binding.inherited_edges) === JSON.stringify(expectedFailureTail)
    && JSON.stringify(binding.error_projection) === JSON.stringify({
      error_type: 'Error',
      message_source_fields: ['stage', 'code', 'message'],
      cause_source_field: 'cause',
      preserve_cause_identity: true,
      sink_source_literal: sourceLiteral,
    }), `v4 executable-frame failure binding drift: ${sourceResource}`)
  sameSet(new Set(binding.forbidden_projection_resources),
    new Set(targetFailureSources.filter(resource => resource !== sourceResource)),
    `v4 executable-frame failure source non-alias set: ${sourceResource}`)
  const targetFunction = targetFunctions.find(row => row.function_id === functionId)
  invariant(targetFunction?.owner === owner
    && targetFunction.semantic_roles.includes(role)
    && targetFunction.input_type === sourceType
    && targetFunction.resource_ids.includes(sourceResource)
    && targetFunction.resource_ids.includes('terminal_lifecycle')
    && targetFunction.resource_ids.includes('terminal_failure_chain'),
  `v4 executable-frame failure target function drift: ${functionId}`)
  for (const edge of binding.inherited_edges) {
    const fn = functionMap.functions.find(row => row.function_id === edge.function_id)
    invariant(fn?.status === 'implemented' && fn.owner === edge.owner
      && edge.entry_symbols.every(symbol => fn.entry_symbols.includes(symbol)),
    `v4 inherited executable-frame failure edge ${edge.from}->${edge.to}: binding drift`)
  }
}
const targetNodeIds = unique(targetLifecycle.nodes.map(row => row.node_id), 'v4 target node ids')
for (const nodeId of targetNodeIds) {
  invariant(/^[A-Z][A-Za-z0-9]*Output(?:In|Out)[0-9]{2}[A-Z][A-Za-z0-9]*$/.test(nodeId),
    `v4 target node naming contract violation: ${nodeId}`)
}
for (const node of targetLifecycle.nodes) {
  invariant(resourceIds.has(node.resource_id),
    `v4 target node ${node.node_id}: unknown resource ${node.resource_id}`)
  const resource = resourceMap.resources.find(row => row.resource_id === node.resource_id)
  invariant(resource?.owner === node.owner,
    `v4 target node ${node.node_id}: resource owner ${resource?.owner} != node owner ${node.owner}`)
}
invariant(targetNodeIds.has(targetLifecycle.return_path.from)
  && mainlineIds.has(targetLifecycle.return_path.to),
  'v4 output-tail return path must close through the inherited input chain')
const targetRoleByNode = new Map(targetLifecycle.nodes.map(row => [row.node_id, row.role]))
const expectedTargetRoleEdges = new Set([
  'typed_component_resolved->closed_region_leaves',
  'closed_region_leaves->ordered_app_frame_tree',
  'ordered_app_frame_tree->generic_primitive_realized',
  'generic_primitive_realized->terminal_frame',
])
const actualTargetRoleEdges = targetLifecycle.edges.map(edge =>
  `${targetRoleByNode.get(edge.from)}->${targetRoleByNode.get(edge.to)}`)
invariant(targetLifecycle.edges.length === expectedTargetRoleEdges.size
  && actualTargetRoleEdges.every(edge => expectedTargetRoleEdges.has(edge))
  && targetLifecycle.edges.every(edge => edge.status === 'implemented'
    && Array.isArray(edge.entry_symbols) && edge.entry_symbols.length > 0),
  'v4 target edge drift or shortcut')
for (const edge of targetLifecycle.edges) {
  const fn = targetFunctions.find(row => row.function_id === edge.function_id)
  invariant(fn?.owner === edge.owner,
    `v4 target edge ${edge.from}->${edge.to}: function owner drift`)
}
const orderedFrameBuildEdge = targetLifecycle.edges.find(edge =>
  edge.function_id === 'build_ordered_app_frame_tree')
const regionLeafProjectionEdge = targetLifecycle.edges.find(edge =>
  edge.function_id === 'project_closed_terminal_region_leaves')
const regionLeafProjectionFunction = targetFunctions.find(row =>
  row.function_id === 'project_closed_terminal_region_leaves')
invariant(JSON.stringify(regionLeafProjectionEdge?.required_side_input_resources) === JSON.stringify([
  'tui_presentation_model',
  'pending_input_projection',
  'terminal_input_control',
  'terminal_status_projection',
  'tui_focus_overlay_stack',
]) && JSON.stringify(regionLeafProjectionFunction?.resource_ids) === JSON.stringify([
  'tui_presentation_model',
  'terminal_component_registry',
  'pending_input_projection',
  'tui_focus_overlay_stack',
  'terminal_input_control',
  'terminal_status_projection',
  'typed_terminal_region_leaves',
  'terminal_region_projection_failure_chain',
])
  && JSON.stringify(regionLeafProjectionEdge.side_input_bindings)
    === JSON.stringify(terminalRegionLeavesContract.source_bindings)
  && JSON.stringify(terminalRegionLeavesContract.input_resources) === JSON.stringify([
    'terminal_component_registry',
    ...regionLeafProjectionEdge.required_side_input_resources,
  ]), 'v4 region-leaf projection must retain every adjacent presentation and interaction input')
invariant(orderedFrameBuildEdge?.validator_function_id === 'validate_ordered_app_frame_tree'
  && orderedFrameBuildEdge.safe_function_id === 'compose_ordered_app_frame_tree_safe'
  && orderedFrameBuildEdge.input_type === 'TuiAppContainerFrameBuildInput'
  && orderedFrameBuildEdge.safe_input_type === 'TuiAppContainerFrameInput'
  && orderedFrameBuildEdge.internal_builder_input_type === 'TuiAppContainerFrameBuildInput'
  && JSON.stringify(orderedFrameBuildEdge.required_side_input_resources) === JSON.stringify([
    'typed_app_chrome_terminal_nodes', 'current_terminal_viewport',
  ])
  && JSON.stringify(orderedFrameBuildEdge.side_input_producer_function_ids)
    === JSON.stringify(['project_chrome_slots_to_terminal_nodes'])
  && JSON.stringify(orderedFrameBuildEdge.side_input_bindings) === JSON.stringify([
    {
      resource_id: 'typed_app_chrome_terminal_nodes',
      delivery: 'owner_internal_safe_projection_result',
      internal_builder_input_field: 'chrome',
      public_input_field_forbidden: true,
      cardinality: 'required',
    },
    {
      resource_id: 'current_terminal_viewport',
      input_field: 'viewport',
      cardinality: 'required_same_frozen_reference',
    },
  ])
  && orderedFrameBuildEdge.precondition_chain_id === viewportControlChain.chain_id
  && orderedFrameBuildEdge.precondition_function_id === viewportControlChain.postcondition_function_id
  && JSON.stringify(orderedFrameBuildEdge.preconditions) === JSON.stringify([
    'current_terminal_viewport_exists',
    'current_terminal_viewport_is_frozen',
    'current_terminal_viewport_is_validated_app_event_pair',
  ]), 'v4 ordered-frame build edge must bind its validator, viewport and chrome side inputs')
for (const edge of [...targetLifecycle.edges, ...(targetLifecycle.forbidden_edges ?? [])]) {
  invariant(targetNodeIds.has(edge.from) && targetNodeIds.has(edge.to),
    `v4 target edge references unknown node: ${edge.from}->${edge.to}`)
}
invariant(executableFrameLifecycle.lifecycle_id === targetLifecycle.lifecycle_id
  && executableFrameLifecycle.status === targetLifecycle.status
  && executableFrameLifecycle.binding_status === targetLifecycle.binding_status
  && executableFrameLifecycle.replaces === targetLifecycle.replaces
  && executableFrameLifecycle.chain_kind === targetLifecycle.chain_kind
  && JSON.stringify(executableFrameLifecycle.inherited_prefix)
    === JSON.stringify(targetLifecycle.inherited_prefix)
  && JSON.stringify(executableFrameLifecycle.replaces_scope)
    === JSON.stringify(targetLifecycle.replaces_scope)
  && executableFrameLifecycle.entrypoint === targetLifecycle.entrypoint
  && JSON.stringify(executableFrameLifecycle.return_path)
    === JSON.stringify(targetLifecycle.return_path),
  'v4 architecture manifest status or replacement drift')
invariant(JSON.stringify(executableFrameLifecycle.nodes.map(row => [
  row.node_id, row.role, row.status, row.owner, row.resource_id, row.binding_status,
])) === JSON.stringify(targetLifecycle.nodes.map(row => [
  row.node_id, row.role, row.status, row.owner, row.resource_id, row.binding_status,
]))
  && JSON.stringify(executableFrameLifecycle.edges) === JSON.stringify(targetLifecycle.edges)
  && JSON.stringify(executableFrameLifecycle.forbidden_edges)
    === JSON.stringify(targetLifecycle.forbidden_edges)
  && JSON.stringify(executableFrameLifecycle.viewport_bootstrap_control_chain)
    === JSON.stringify(targetLifecycle.viewport_bootstrap_control_chain)
  && JSON.stringify(executableFrameLifecycle.composition_failure_rebinding)
    === JSON.stringify(targetLifecycle.composition_failure_rebinding)
  && JSON.stringify(executableFrameLifecycle.region_projection_failure_binding)
    === JSON.stringify(targetLifecycle.region_projection_failure_binding)
  && JSON.stringify(executableFrameLifecycle.realization_failure_binding)
    === JSON.stringify(targetLifecycle.realization_failure_binding)
  && JSON.stringify(executableFrameLifecycle.carrier_failure_binding)
    === JSON.stringify(targetLifecycle.carrier_failure_binding)
  && JSON.stringify(executableFrameLifecycle.executable_frame_error_chain)
    === JSON.stringify(targetLifecycle.executable_frame_error_chain),
  'v4 architecture manifest and mainline target bindings drift')
for (const path of [
  ...executableFrameLifecycle.canonical_docs,
  ...executableFrameLifecycle.contracts,
]) {
  invariant(existsSync(resolve(root, path)), `v4 architecture reference missing: ${path}`)
}
const cutoverBindings = executableFrameLifecycle.cutover
invariant(cutoverBindings?.phase === 2
  && cutoverBindings.status === 'completed'
  && cutoverBindings.atomic === true
  && cutoverBindings.delete_replaced_path === true
  && cutoverBindings.function_ids.length === 0
  && cutoverBindings.mainline_nodes.length === 0
  && cutoverBindings.replacement_bindings.length === 0,
  'completed v4 cutover must not retain replaced runtime bindings')
for (const legacySymbol of [
  'chromeRenderNodes', 'composeInkElement', 'TuiShellView', 'renderWithCompose',
]) {
  invariant(!terminalLifecycleSource.identifiers.has(legacySymbol),
    `legacy terminal-lifecycle symbol remains after cutover: ${legacySymbol}`)
  invariant(!appContainerSource.identifiers.has(legacySymbol),
    `legacy app-container symbol remains after cutover: ${legacySymbol}`)
  invariant(!appShellSource.identifiers.has(legacySymbol),
    `legacy app-shell symbol remains after cutover: ${legacySymbol}`)
}

const orderedFrameBuilders = targetFunctions.filter(row =>
  row.semantic_roles.includes('ordered_frame_tree_builder'))
const orderedFrameValidators = targetFunctions.filter(row =>
  row.semantic_roles.includes('ordered_frame_tree_validator'))
invariant(orderedFrameBuilders.length === 1
  && orderedFrameBuilders[0].owner === 'dsh-tui::app-container',
  'duplicate_owner: app-container must be the only pending ordered-frame builder')
invariant(orderedFrameValidators.length === 1
  && orderedFrameValidators[0].owner === 'dsh-tui::app-container',
  'duplicate_validator_owner: app-container must be the only pending ordered-frame validator')
for (const [role, owner] of [
  ['viewport_subscription_wiring', 'dsh-tui::app-shell'],
  ['terminal_input_bootstrap_wiring', 'dsh-tui::app-shell'],
  ['terminal_viewport_observer', 'dsh-tui::terminal-lifecycle'],
  ['terminal_resize_intent_publisher', 'dsh-tui::terminal-lifecycle'],
  ['current_viewport_store', 'dsh-tui::app-shell'],
  ['first_compose_viewport_gate', 'dsh-tui::app-shell'],
  ['closed_region_leaf_projector', 'dsh-tui::terminal-ui'],
  ['closed_primitive_realizer', 'dsh-tui::terminal-ui'],
  ['generic_terminal_carrier', 'dsh-tui::terminal-lifecycle'],
  ['region_projection_failure_to_carrier_router', 'dsh-tui::app-shell'],
  ['composition_failure_to_carrier_router', 'dsh-tui::app-shell'],
  ['generic_realization_failure_to_carrier_router', 'dsh-tui::app-shell'],
  ['carrier_failure_to_terminal_failure_router', 'dsh-tui::terminal-lifecycle'],
]) {
  const owners = targetFunctions.filter(row => row.semantic_roles.includes(role))
  invariant(owners.length === 1 && owners[0].owner === owner,
    `v4 target semantic role ${role}: expected one ${owner} owner`)
}
const viewportPublishUpdate = targetFunctionUpdates.find(row =>
  row.function_id === 'publish_typed_app_intent')
const currentViewportPublishFunction = functionMap.functions.find(row =>
  row.function_id === 'publish_typed_app_intent')
sameSet(targetFunctionUpdateIds, new Set([
  'publish_typed_app_intent',
  'own_terminal_lifecycle',
  'project_terminal_status',
  'orchestrate_terminal_runtime_frame',
]), 'v4 target function update set')
invariant(viewportPublishUpdate?.owner === 'dsh-tui::app-event-bus'
  && viewportPublishUpdate.mutation === 'strengthen_terminal_resize_branch_to_exact_frozen_canonical_pair'
  && viewportPublishUpdate.validator_symbol === 'validateViewportSize'
  && viewportPublishUpdate.target_type_symbol === 'TuiValidatedTerminalViewport'
  && JSON.stringify(viewportPublishUpdate.target_resource_ids) === JSON.stringify([
    'tui_app_event_bus', 'validated_terminal_viewport',
  ])
  && currentViewportPublishFunction?.entry_symbols.includes('publish')
  && currentViewportPublishFunction.entry_symbols.includes('TuiAppEventBusService')
  && currentViewportPublishFunction.entry_symbols.includes('validateViewportSize'),
'v4 viewport validation must strengthen the existing typed app-event publication owner')

const appOwnerGate = verification.gates.find(row =>
  row.gate_id === 'app_container_unique_composition_owner')
const carrierGate = verification.gates.find(row =>
  row.gate_id === 'terminal_lifecycle_pure_carrier')
const viewportGate = verification.gates.find(row =>
  row.gate_id === 'terminal_viewport_bootstrap')
const executableFrameErrorGate = verification.gates.find(row =>
  row.gate_id === 'executable_frame_error_chain_e2e')
invariant((appOwnerGate?.status === 'pending' || appOwnerGate?.status === 'active')
  && appOwnerGate.command === 'pnpm run check:design && pnpm run test:terminal-ui && pnpm run test:app-container && pnpm run test:terminal-lifecycle && pnpm run test:app-shell'
  && (carrierGate?.status === 'pending' || carrierGate?.status === 'active')
  && carrierGate.command === 'pnpm run check:design && pnpm run test:terminal-lifecycle && pnpm run test:app-shell'
  && (viewportGate?.status === 'pending' || viewportGate?.status === 'active')
  && viewportGate.command === 'pnpm run check:design && pnpm run test:app-event-bus && pnpm run test:terminal-lifecycle && pnpm run test:app-shell'
  && (executableFrameErrorGate?.status === 'pending'
    || executableFrameErrorGate?.status === 'active')
  && executableFrameErrorGate.command === 'pnpm run check:design && pnpm run test:terminal-ui && pnpm run test:app-container && pnpm run test:terminal-lifecycle && pnpm run test:app-shell',
  'v4 runtime owner gates must be executable and use a known admission state')
const appContainerModule = moduleRegistry.modules.find(row => row.module_id === 'app-container')
const appShellModule = moduleRegistry.modules.find(row => row.module_id === 'app-shell')
const appEventBusModule = moduleRegistry.modules.find(row => row.module_id === 'app-event-bus')
const terminalUiModule = moduleRegistry.modules.find(row => row.module_id === 'terminal-ui')
const terminalLifecycleModule = moduleRegistry.modules.find(row => row.module_id === 'terminal-lifecycle')
invariant(appContainerModule?.target_verification_gates?.includes(appOwnerGate.gate_id)
  && appContainerModule.target_verification_gates.includes(viewportGate.gate_id)
  && appContainerModule.target_verification_gates.includes(executableFrameErrorGate.gate_id)
  && appShellModule?.target_verification_gates?.includes(appOwnerGate.gate_id)
  && appShellModule?.target_verification_gates?.includes(carrierGate.gate_id)
  && appShellModule.target_verification_gates.includes(viewportGate.gate_id)
  && appShellModule.target_verification_gates.includes(executableFrameErrorGate.gate_id)
  && appEventBusModule?.target_verification_gates?.includes(appOwnerGate.gate_id)
  && appEventBusModule.target_verification_gates.includes(viewportGate.gate_id)
  && terminalUiModule?.target_verification_gates?.includes(appOwnerGate.gate_id)
  && terminalUiModule?.target_verification_gates?.includes(carrierGate.gate_id)
  && terminalUiModule.target_verification_gates.includes(executableFrameErrorGate.gate_id)
  && terminalLifecycleModule?.target_verification_gates?.includes(appOwnerGate.gate_id)
  && terminalLifecycleModule?.target_verification_gates?.includes(carrierGate.gate_id)
  && terminalLifecycleModule.target_verification_gates.includes(viewportGate.gate_id)
  && terminalLifecycleModule.target_verification_gates.includes(executableFrameErrorGate.gate_id),
  'v4 pending owner gates must bind their real module owners')
sameSet(new Set(executableFrameLifecycle.verification_gates), new Set([
  appOwnerGate.gate_id,
  carrierGate.gate_id,
  viewportGate.gate_id,
  executableFrameErrorGate.gate_id,
  'design_gate_red_tests',
]), 'v4 architecture manifest verification gates')
const executableFrameSuite = testDesign.suites.find(row =>
  row.suite_id === 'app-container.executable-frame-owner')
invariant(executableFrameSuite?.status === 'implemented'
  && executableFrameSuite.gates.includes(appOwnerGate.gate_id)
  && executableFrameSuite.gates.includes(carrierGate.gate_id)
  && executableFrameSuite.gates.includes(viewportGate.gate_id)
  && executableFrameSuite.gates.includes(executableFrameErrorGate.gate_id)
  && executableFrameSuite.gates.includes('design_gate_red_tests')
  && executableFrameSuite.positive.some(row => row.includes('first frame has a validated frozen columns and rows pair'))
  && executableFrameSuite.negative.some(row => row.includes('renderWithCompose'))
  && executableFrameSuite.negative.some(row => row.includes('no 80 or 24 default'))
  && executableFrameSuite.known_gaps.some(row => row.includes('installed default/compact PTY and live dual-client evidence remain delivery exits'))
  && executableFrameSuite.known_gaps.length === 2,
  'v4 executable frame test design must remain implemented with only external runtime evidence gaps')
const executableFrameErrorSuite = testDesign.suites.find(row =>
  row.suite_id === 'app-shell.executable-frame-error-chain')
invariant(executableFrameErrorSuite?.status === 'implemented'
  && executableFrameErrorSuite.gates.includes(executableFrameErrorGate.gate_id)
  && executableFrameErrorSuite.gates.includes(carrierGate.gate_id)
  && executableFrameErrorSuite.gates.includes('design_gate_red_tests')
  && executableFrameErrorSuite.positive.some(row =>
    row.includes('composition success followed by generic realization failure'))
  && executableFrameErrorSuite.negative.some(row =>
    row.includes('cannot enter app_composition_failure_chain'))
  && executableFrameErrorSuite.known_gaps.some(row =>
    row.includes('installed PTY failure replay remains a delivery exit')),
  'v4 executable-frame error-chain test design must keep both failure sources distinct')
const viewportBootstrapSuite = testDesign.suites.find(row =>
  row.suite_id === 'app-shell.viewport-bootstrap')
invariant(viewportBootstrapSuite?.status === 'implemented'
  && viewportBootstrapSuite.gates.includes(viewportGate.gate_id)
  && viewportBootstrapSuite.gates.includes('payload_control_separation')
  && viewportBootstrapSuite.gates.includes('pty_lifecycle')
  && viewportBootstrapSuite.gates.includes('design_gate_red_tests')
  && viewportBootstrapSuite.positive.some(row => row.includes('exact frozen event intent size object'))
  && viewportBootstrapSuite.negative.some(row => row.includes('80 or 24 viewport defaults'))
  && viewportBootstrapSuite.known_gaps.some(row =>
    row.includes('installed PTY resize and identity replay remain delivery exits')),
'v4 viewport bootstrap test design must expose source and installed PTY exits')

function hasRowsSubtraction(ast) {
  let found = false
  const visit = node => {
    if (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.MinusToken
      && /\brows\b/.test(node.getText(ast))) {
      found = true
    }
    node.forEachChild(visit)
  }
  ast.forEachChild(visit)
  return found
}

function hasViewportNumericDefault(ast) {
  let found = false
  const visit = node => {
    if (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      && /\b(columns|rows|width)\b/u.test(node.left.getText(ast))
      && ts.isNumericLiteral(node.right)
      && (node.right.text === '24' || node.right.text === '80')) {
      found = true
    }
    node.forEachChild(visit)
  }
  ast.forEachChild(visit)
  return found
}

function productionTypeScriptSources(ownerId) {
  return ownerSourcePaths(ownerId)
    .filter(path => !path.startsWith('tests/') && !path.includes('/tests/'))
    .filter(path => path.startsWith('playground/experiments/') || path.startsWith('contracts/'))
    .map(path => ({ path, facts: sourceFacts(path) }))
}

function collectPureCarrierViolations() {
  const violations = []
  const lifecycleSources = productionTypeScriptSources('dsh-tui::terminal-lifecycle')
  for (const { path, facts } of lifecycleSources) {
    if (['slots', 'placement', 'chromeNodes', 'assertTuiChromeRenderNodes']
      .some(name => facts.identifiers.has(name))) {
      violations.push('slot_placement_reconstruction')
    }
    if (['OverlayView', 'ComposerView', 'transcriptCells', 'statusLine', 'outputText', 'outputPrefix']
      .some(name => facts.identifiers.has(name))
      || [
        'transcript.title', 'composer.title', 'session.title', "'footer'",
        '== Transcript ==', '-- composer.editor --', '-- Session --', '-- footer --',
      ].some(text => facts.source.includes(text))) {
      violations.push('fixed_region_assembler')
    }
    if (['renderWithCompose', 'composeInkTree', 'composeInkTreeSafe', 'TuiTerminalCompositionResult']
      .some(name => facts.identifiers.has(name))
      || [...facts.calls].some(call => /compose/i.test(call))) {
      violations.push('composition_callback')
    }
    if (['TuiInkTreeComposed', 'TuiTerminalShellDescriptor', 'TuiChromeRenderNode', 'TuiRenderOutput',
      'assertRenderableNode', 'composeInkElement'].some(name => facts.identifiers.has(name))) {
      violations.push('legacy_presentation_contract')
    }
    if (hasRowsSubtraction(facts.ast)) violations.push('fixed_row_budget')
    if (hasViewportNumericDefault(facts.ast)) violations.push('initial_viewport_default')
    if (!path.startsWith('contracts/') && importSpecifiers(path).some(specifier =>
      !specifier.includes('/contracts/')
      && (specifier.includes('/terminal-ui/') || specifier.includes('/app-container/')
        || specifier.includes('/chrome-slot-registry/') || specifier.includes('/component-registry/')))) {
      violations.push('legacy_presentation_import')
    }
  }
  const appShellRuntime = sourceFacts('playground/experiments/app-shell/src/app-shell.ts')
  if (appShellRuntime.identifiers.has('renderWithCompose')
    || [...appShellRuntime.calls].some(call => call.endsWith('.renderWithCompose'))) {
    violations.push('composition_callback')
  }
  return [...new Set(violations)]
}

function activeTargetEdgeBindingsComplete(edges) {
  return edges.every(edge => {
    const targetFunction = targetFunctions.find(row => row.function_id === edge.function_id)
    const currentFunction = functionMap.functions.find(row => row.function_id === edge.function_id)
    const update = targetFunctionUpdates.find(row => row.function_id === edge.function_id)
    const functionBindingActive = edge.binding_kind === 'current_function_update'
      ? currentFunction?.status === 'implemented' && update?.status === 'implemented'
        && update.binding_status === 'active'
      : targetFunction?.status === 'implemented' && targetFunction.binding_status === 'active'
    const entrySymbols = edge.binding_kind === 'current_function_update'
      ? currentFunction?.entry_symbols
      : targetFunction?.entry_symbols
    if (edge.status !== 'implemented' || !functionBindingActive
      || !Array.isArray(edge.entry_symbols)
      || edge.entry_symbols.length === 0
      || !Array.isArray(entrySymbols)
      || edge.entry_symbols.some(symbol => !entrySymbols.includes(symbol))
      || !Array.isArray(edge.call_bindings) || edge.call_bindings.length === 0) return false
    return edge.call_bindings.every(binding => {
      if (typeof binding.path !== 'string' || typeof binding.caller_symbol !== 'string'
        || typeof binding.callee !== 'string' || typeof binding.caller_owner !== 'string'
        || !existsSync(resolve(root, binding.path))) return false
      const source = sourceFacts(binding.path)
      return assertUniquePathOwner(binding.path).module_id === binding.caller_owner.replace(/^dsh-tui::/, '')
        && source.identifiers.has(binding.caller_symbol) && source.calls.has(binding.callee)
    })
  })
}

function activeFailureBindingComplete(binding) {
  const targetFunction = targetFunctions.find(row => row.function_id === binding.function_id)
  if (binding.status !== 'implemented' || binding.binding_status !== 'active'
    || targetFunction?.status !== 'implemented' || targetFunction.binding_status !== 'active'
    || !Array.isArray(binding.entry_symbols) || binding.entry_symbols.length === 0
    || binding.entry_symbols.some(symbol => !targetFunction.entry_symbols.includes(symbol))
    || !Array.isArray(binding.call_bindings) || binding.call_bindings.length === 0) return false
  return binding.call_bindings.every(callBinding => {
    if (typeof callBinding.path !== 'string' || typeof callBinding.caller_symbol !== 'string'
      || typeof callBinding.callee !== 'string' || callBinding.caller_owner !== 'dsh-tui::app-shell'
      || !existsSync(resolve(root, callBinding.path))) return false
    const source = sourceFacts(callBinding.path)
    return assertUniquePathOwner(callBinding.path).module_id === 'app-shell'
      && source.identifiers.has(callBinding.caller_symbol)
      && source.calls.has(callBinding.callee)
  })
}

function collectExecutableFrameErrorChainViolations() {
  const violations = []
  const realizer = targetFunctions.find(row =>
    row.semantic_roles.includes('closed_primitive_realizer'))
  const compositionRouter = targetFunctions.find(row =>
    row.semantic_roles.includes('composition_failure_to_carrier_router'))
  const realizationRouter = targetFunctions.find(row =>
    row.semantic_roles.includes('generic_realization_failure_to_carrier_router'))
  if (targetRealizationFailureResource?.status !== 'active') {
    violations.push('pending_realization_failure_resource')
  }
  if (!realizer?.resource_ids.includes('terminal_primitive_realization_failure_chain')) {
    violations.push('realizer_failure_resource_missing')
  }
  if (compositionRouter?.resource_ids.includes('terminal_primitive_realization_failure_chain')
    || realizationRouter?.resource_ids.includes('app_container_composition_failure_chain')
    || realizationFailureBinding.source_resource !== 'terminal_primitive_realization_failure_chain'
    || !realizationFailureBinding.forbidden_projection_resources.includes('app_container_composition_failure_chain')) {
    violations.push('realization_failure_projection_alias')
  }
  if (!activeFailureBindingComplete(compositionFailureRebinding)) {
    violations.push('composition_failure_router_unbound')
  }
  if (!activeFailureBindingComplete(realizationFailureBinding)) {
    violations.push('realization_failure_router_unbound')
  }
  if (JSON.stringify(realizationFailureBinding.inherited_edges)
    !== JSON.stringify(compositionFailureRebinding.inherited_edges)) {
    violations.push('error_tail_drift')
  }
  return [...new Set(violations)]
}

function collectUniqueCompositionOwnerViolations() {
  const violations = []
  const builders = targetFunctions.filter(row =>
    row.semantic_roles.includes('ordered_frame_tree_builder'))
  const validators = targetFunctions.filter(row =>
    row.semantic_roles.includes('ordered_frame_tree_validator'))
  if (builders.length !== 1 || builders[0]?.owner !== 'dsh-tui::app-container') {
    violations.push('duplicate_owner')
  }
  if (validators.length !== 1 || validators[0]?.owner !== 'dsh-tui::app-container') {
    violations.push('duplicate_validator_owner')
  }
  if (targetFrameResource?.owner !== 'dsh-tui::app-container') {
    violations.push('ordered_tree_resource_owner')
  }
  if (targetFrameResource?.status !== 'active'
    || targetRegionLeavesResource?.status !== 'active'
    || targetRealizedTreeResource?.status !== 'active'
    || targetViewportObservationResource?.status !== 'active'
    || targetValidatedViewportResource?.status !== 'active'
    || targetCurrentViewportResource?.status !== 'active'
    || targetLifecycle.status !== 'implemented'
    || targetLifecycle.binding_status !== 'active'
    || targetLifecycle.edges.some(edge => edge.status !== 'implemented')
    || viewportControlChain.status !== 'implemented'
    || viewportControlChain.binding_status !== 'active'
    || viewportControlChain.edges.some(edge => edge.status !== 'implemented')
    || compositionFailureRebinding.status !== 'implemented'
    || compositionFailureRebinding.binding_status !== 'active'
    || realizationFailureBinding.status !== 'implemented'
    || realizationFailureBinding.binding_status !== 'active'
    || targetRealizationFailureResource?.status !== 'active') {
    violations.push('pending_runtime_binding')
  }
  if (targetFunctions.some(row => row.status !== 'implemented'
    || row.binding_status !== 'active'
    || row.entry_symbols.length === 0)
    || targetFunctionUpdates.some(row => row.status !== 'implemented'
      || row.binding_status !== 'active')) {
    violations.push('pending_function_binding')
  }
  const roleEdges = targetLifecycle.edges.map(edge =>
    `${targetRoleByNode.get(edge.from)}->${targetRoleByNode.get(edge.to)}`)
  if (targetLifecycle.edges.length !== expectedTargetRoleEdges.size
    || roleEdges.some(edge => !expectedTargetRoleEdges.has(edge))) {
    violations.push('shortcut')
  }
  if (!activeTargetEdgeBindingsComplete(targetLifecycle.edges)
    || !activeTargetEdgeBindingsComplete(viewportControlChain.edges)) {
    violations.push('unbound_runtime_call_edge')
  }
  const realizer = targetFunctions.find(row => row.semantic_roles.includes('closed_primitive_realizer'))
  const carrier = targetFunctions.find(row => row.semantic_roles.includes('generic_terminal_carrier'))
  if (realizer?.output_type !== 'TuiRealizedTerminalPrimitiveTree'
    || carrier?.input_type !== 'TuiRealizedTerminalPrimitiveTree'
    || !carrier.resource_ids.includes('realized_terminal_primitive_tree')
    || carrier.resource_ids.includes('typed_ordered_terminal_frame_tree')) {
    violations.push('carrier_input_contract')
  }
  const viewportPublisher = targetFunctions.find(row =>
    row.semantic_roles.includes('terminal_resize_intent_publisher'))
  const viewportStore = targetFunctions.find(row => row.semantic_roles.includes('current_viewport_store'))
  const viewportUpdate = targetFunctionUpdates.find(row => row.function_id === 'publish_typed_app_intent')
  if (!viewportPublisher?.resource_ids.includes('tui_app_event_bus')
    || !viewportStore?.resource_ids.includes('tui_app_event_bus')
    || !viewportUpdate?.target_resource_ids.includes('tui_app_event_bus')
    || !viewportUpdate?.target_resource_ids.includes('validated_terminal_viewport')) {
    violations.push('viewport_event_bus_bypass')
  }
  for (const source of [
    sourceFacts('playground/experiments/app-shell/src/app-shell.ts'),
    sourceFacts('playground/experiments/terminal-lifecycle/src/terminal-lifecycle.ts'),
  ]) {
    if (source.calls.has('validateViewportSize')) violations.push('viewport_event_bus_bypass')
  }
  if (moduleRegistry.import_edges.some(edge =>
    edge.from === 'app-container' && edge.to === 'terminal-lifecycle')) {
    violations.push('renderer_import_shortcut')
  }
  if (moduleRegistry.import_edges.some(edge =>
    edge.from === 'terminal-lifecycle'
    && (edge.to === 'app-container' || edge.to === 'chrome-slot-registry'
      || ((edge.to === 'terminal-ui' || edge.to === 'component-registry')
        && edge.edge_class !== 'type_contract')))) {
    violations.push('carrier_legacy_import_edge')
  }
  if (cutoverBindings.function_ids.some(functionId => implementedFunctionIds.has(functionId))
    || cutoverBindings.mainline_nodes.some(nodeId => mainlineIds.has(nodeId))) {
    violations.push('legacy_runtime_binding_present')
  }
  if (collectPureCarrierViolations().length > 0) violations.push('carrier_reconstruction_present')
  return [...new Set(violations)]
}

function collectViewportBootstrapViolations() {
  const violations = []
  const startup = sourceFacts('playground/experiments/startup/src/startup.ts')
  const appShell = sourceFacts('playground/experiments/app-shell/src/app-shell.ts')
  const appContainer = sourceFacts('playground/experiments/app-container/src/app-container.ts')
  const lifecycle = sourceFacts('playground/experiments/terminal-lifecycle/src/terminal-lifecycle.ts')
  const eventBus = sourceFacts('playground/experiments/app-event-bus/src/app-event-bus.ts')

  if (startup.source.includes('readonly width?: number')) {
    violations.push('startup_width_override')
  }
  if (hasViewportNumericDefault(appShell.ast)) {
    violations.push('controller_default_viewport')
  }
  if (hasViewportNumericDefault(appContainer.ast)) {
    violations.push('app_container_width_default')
  }
  if (lifecycle.source.includes('stdout.columns ?? shell.width')) {
    violations.push('lifecycle_columns_fallback')
  }
  if (lifecycle.source.includes('stdout.rows ?? 24')) {
    violations.push('lifecycle_rows_default')
  }
  if (appShell.source.includes('width = event.columns')) {
    violations.push('rows_dropped')
  }
  if (appShell.calls.has('validateViewportSize')
    || appShell.source.includes("handleTerminalEvent({ type: 'resize'")
    || appShell.source.includes('storeViewport(Object.freeze(')
    || lifecycle.source.includes("handler({ type: 'resize'")) {
    violations.push('direct_resize_bus_bypass')
  }
  if (appShell.source.includes('deps.lifecycle.setInputHandler(handleTerminalEvent)')
    && appShell.source.includes('render()')) {
    violations.push('first_compose_before_initial_viewport')
  }
  if (startup.source.includes("case 'terminal.resize':")
    && startup.source.includes("case 'terminal.resize':\n      break")) {
    violations.push('event_bus_subscription_missing')
  }
  if (!lifecycle.identifiers.has('tuiEventBus')
    || ![...lifecycle.calls].some(call => call.endsWith('.publish'))) {
    violations.push('event_bus_publication_missing')
  }
  if (!eventBus.identifiers.has('TuiValidatedTerminalViewport')
    || !eventBus.source.includes('Number.isSafeInteger')
    || !eventBus.source.includes('Reflect.ownKeys')) {
    violations.push('validated_output_type_missing')
  }
  if (!eventBus.source.includes('Object.freeze({ columns')
    && !eventBus.source.includes('Object.freeze({columns')) {
    violations.push('nested_viewport_not_frozen')
  }
  if (targetViewportObservationResource?.status !== 'active'
    || targetValidatedViewportResource?.status !== 'active'
    || targetCurrentViewportResource?.status !== 'active'
    || viewportControlChain.status !== 'implemented'
    || viewportControlChain.binding_status !== 'active'
    || viewportControlChain.edges.some(edge => edge.status !== 'implemented')
    || viewportPublishUpdate?.status !== 'implemented'
    || viewportPublishUpdate.binding_status !== 'active') {
    violations.push('pending_viewport_binding')
  }
  if (JSON.stringify(orderedFrameBuildEdge?.required_side_input_resources) !== JSON.stringify([
    'typed_app_chrome_terminal_nodes', 'current_terminal_viewport',
  ]) || orderedFrameBuildEdge.precondition_chain_id !== viewportControlChain.chain_id
    || orderedFrameBuildEdge.precondition_function_id !== 'start_runtime_after_viewport_ready') {
    violations.push('first_compose_precondition_missing')
  }
  return [...new Set(violations)]
}

if (appOwnerGate.status === 'active') {
  const violations = collectUniqueCompositionOwnerViolations()
  invariant(violations.length === 0,
    `app_container_unique_composition_owner: ${violations.join('; ')}`)
}
if (carrierGate.status === 'active') {
  const violations = collectPureCarrierViolations()
  invariant(violations.length === 0,
    `terminal_lifecycle_pure_carrier: ${violations.join('; ')}`)
}
if (viewportGate.status === 'active') {
  const violations = collectViewportBootstrapViolations()
  invariant(violations.length === 0,
    `terminal_viewport_bootstrap: ${violations.join('; ')}`)
}
if (executableFrameErrorGate.status === 'active') {
  const violations = collectExecutableFrameErrorChainViolations()
  invariant(violations.length === 0,
    `executable_frame_error_chain_e2e: ${violations.join('; ')}`)
}
const lifecycleServiceClass = terminalLifecycleSource.ast.statements.find(node =>
  ts.isClassDeclaration(node) && node.name?.text === 'TuiTerminalLifecycleService')
invariant(lifecycleServiceClass?.heritageClauses?.some(clause =>
  clause.token === ts.SyntaxKind.ImplementsKeyword
  && clause.types.some(type => type.expression.getText(terminalLifecycleSource.ast) === 'TuiTerminalLifecycle')),
  'terminal-lifecycle service must implement its declared contract face')
invariant(terminalLifecycleSource.methods.get('exit') !== undefined
  && terminalLifecycleSource.methods.get('fail') !== undefined,
  'terminal-lifecycle service implementation is missing exit or fail')
const lifecycleApplyFunction = terminalLifecycleSource.ast.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'apply')
invariant(lifecycleApplyFunction?.body?.getText(terminalLifecycleSource.ast)
  .includes('new TuiTerminalLifecycleService(ctx, options)'),
  'terminal-lifecycle apply must construct the unique service implementation')
const startupSource = sourceFacts('playground/experiments/startup/src/startup.ts')
invariant(startupSource.source.includes('projectTerminalFailureOutcome(terminalLifecycle)')
  && [...startupSource.calls].some(call => call === 'lifecycle.failure'),
  'startTui must consume its owned terminal-failure outcome projector')
const cliSource = sourceFacts('src/cli.ts')
const pluginStartupSource = sourceFacts('src/plugin-startup.ts')
invariant([...cliSource.calls].includes('cliExitForTuiStartupOutcome')
  && cliSource.source.includes('return exitCodeForTuiStartupOutcome(outcome)'),
  'CLI main must delegate its process exit to the owned startup exit projection')
invariant([...pluginStartupSource.calls].includes('pluginExitForTuiStartupOutcome')
  && pluginStartupSource.source.includes('exit(exitCodeForTuiStartupOutcome(outcome))'),
  'Cordis plugin startup must delegate its process exit to the owned startup exit projection')
invariant(!startupSource.identifiers.has('TuiStartupDependencies')
  && !startupSource.source.includes('dependencies.startTui'),
  'production startTui must not expose a whole-runtime replacement path')
assertImplementedErrorChainSymbols()
const executableFrameChainFunctions = [
  ['project_closed_terminal_region_leaves', 'dsh-tui::terminal-ui'],
  ['build_ordered_app_frame_tree', 'dsh-tui::app-container'],
  ['realize_generic_terminal_frame_tree', 'dsh-tui::terminal-ui'],
  ['carry_realized_terminal_primitive_tree', 'dsh-tui::terminal-lifecycle'],
  ['route_region_projection_failure_to_terminal_failure', 'dsh-tui::app-shell'],
  ['route_composition_failure_to_terminal_failure', 'dsh-tui::app-shell'],
  ['route_generic_realization_failure_to_terminal_failure', 'dsh-tui::app-shell'],
  ['route_carrier_failure_to_terminal_failure', 'dsh-tui::terminal-lifecycle'],
  ['project_terminal_failure_startup_outcome', 'dsh-tui::app-shell'],
  ['project_terminal_failure_exit', 'dsh-tui::app-shell'],
].map(([functionId, owner]) => {
  const row = functionMap.target_functions.find(candidate => candidate.function_id === functionId)
    ?? functionMap.functions.find(candidate => candidate.function_id === functionId)
  invariant(row?.owner === owner && row.required_gates.includes('executable_frame_error_chain_e2e'),
    `executable-frame chain function ${functionId}: owner or gate binding drift`)
  return row
})
invariant((executableFrameErrorGate?.status === 'pending'
    || executableFrameErrorGate?.status === 'active')
  && executableFrameErrorGate.command === 'pnpm run check:design && pnpm run test:terminal-ui && pnpm run test:app-container && pnpm run test:terminal-lifecycle && pnpm run test:app-shell',
  'executable-frame error-chain gate is not executable with its mapped suites')
invariant(executableFrameErrorGate.required_for.includes('terminal_ui_implementation')
  && executableFrameErrorGate.required_for.includes('app_container_implementation')
  && executableFrameErrorGate.required_for.includes('app_shell_implementation')
  && executableFrameErrorGate.required_for.includes('terminal_lifecycle_implementation'),
  'executable-frame error-chain gate must be required by all four implementation stages')
const designGateRedTests = verification.gates.find(row => row.gate_id === 'design_gate_red_tests')
invariant(designGateRedTests?.status === 'active'
  && designGateRedTests.command === 'pnpm run test:design'
  && packageManifest.scripts['test:design'] === 'node --test .appsdk/verification/verify-design.spec.mjs',
  'design red-test gate must execute its registered verification spec')
const governanceModule = moduleRegistry.modules.find(row => row.module_id === 'governance-build')
const governanceFunction = functionMap.functions.find(row => row.function_id === 'validate_governance_build_surface')
invariant(governanceModule?.verification_gates.includes('design_gate_red_tests')
  && governanceFunction?.required_gates.includes('design_gate_red_tests'),
  'governance owner must require the executable design red-test gate')
const runtimePipelineSource = sourceFacts('playground/experiments/app-shell/src/app-shell.ts')
invariant([...runtimePipelineSource.calls].includes('deps.terminalUi.projectSafe')
  && [...runtimePipelineSource.calls].includes('deps.appContainer.composeFrameSafe')
  && [...runtimePipelineSource.calls].includes('deps.terminalUi.realizeSafe')
  && [...runtimePipelineSource.calls].includes('deps.lifecycle.render'),
  'executable-frame e2e does not drive the adjacent project, compose, realize, carry pipeline')
const executableFrameE2e = sourceFacts('tests/app-shell/app-shell.spec.ts')
invariant(executableFrameE2e.source.includes("'region-projection'")
  && executableFrameE2e.source.includes("'app-container-composition'")
  && executableFrameE2e.source.includes("'primitive-realization'"),
  'executable-frame e2e does not exercise all upstream failure routers')
invariant(rustGovernancePlan.schema_version === 1
  && rustGovernancePlan.owner === 'dsh-tui::governance-build'
  && rustGovernancePlan.status === 'pending'
  && rustGovernancePlan.runtime_owner.status === 'pending'
  && rustGovernancePlan.runtime_owner.artifact === 'pinned external AppSDK Rust binary'
  && rustGovernancePlan.runtime_owner.current_sdk_lock === '0.1.3',
  'Rust governance migration is not implemented and must remain explicitly pending')
invariant(rustGovernancePlan.project_adapter.path === '.appsdk/verification/verify-design.mjs'
  && rustGovernancePlan.project_adapter.role === 'resolve project paths and consume the typed Rust governance result',
  'Rust governance project adapter contract drift')
unique(rustGovernancePlan.milestones.map(row => row.id), 'Rust governance milestone ids')
invariant(rustGovernancePlan.milestones.every(row => row.status === 'pending'),
  'Rust governance migration milestones must remain pending until the Rust owner is admitted')
sameSet(new Set(rustGovernancePlan.completion_conditions), new Set([
  'all milestones have status implemented',
  'sdk.lock records the AppSDK release containing the Rust governance engine',
  'sdk-bundle manifest records the same pinned artifact',
  'function map, module registry and verification map bind the Rust gate as active',
  ]), 'Rust governance completion conditions')
invariant(testDesign.status === 'implemented' && executableFrameErrorSuite !== undefined
  && executableFrameErrorSuite.status === 'implemented'
  && executableFrameErrorSuite.gates.includes('executable_frame_error_chain_e2e')
  && executableFrameErrorSuite.positive.some(row => row.includes('region projection failure preserves the original cause'))
  && executableFrameErrorSuite.negative.some(row => row.includes('async flush rejection cannot become an unhandled promise')),
  'app-shell executable-frame error-chain design is not implemented in lockstep')
invariant(ciWorkflow.includes(executableFrameErrorGate.command),
  'CI executable-frame error-chain gate wiring missing')
const v3Design = readText('.appsdk/architecture/tui-v3-design.md')
invariant(v3Design.includes('Status: confirmed v3 runtime implementation; delivery admission remains gated by verification-map.'),
  'canonical v3 runtime status drift')
invariant(v3Design.includes('The `chrome-slot-registry` Cordis service is the\nsole owner of typed slot projection'),
  'canonical v3 chrome owner drift')
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
