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
const rustGovernancePlan = readJson('.appsdk/architecture/rust-governance-migration-plan.json')
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
for (const relation of [...resourceMap.required_relations, ...resourceMap.forbidden_relations]) {
  invariant(resourceIds.has(relation.from), `resource relation has unknown source: ${relation.from}`)
  invariant(resourceIds.has(relation.to), `resource relation has unknown target: ${relation.to}`)
}
const chromeProjection = functionMap.functions.find(row => row.function_id === 'project_chrome_slots')
const logicProjection = functionMap.functions.find(row => row.function_id === 'project_logic_controls')
invariant(logicProjection?.owner === 'dsh-tui::logic-controls', 'logic projection function owner drift')
invariant(JSON.stringify(logicProjection.entry_symbols) === JSON.stringify(['TuiLogicControlRegistryService', 'project']),
  'logic projection entry symbols drift')
invariant(JSON.stringify(chromeProjection?.entry_symbols) === JSON.stringify([
  'TuiChromeSlotRegistry', 'apply', 'createLogoPlugin', 'createConnectionPlugin', 'createSessionPlugin',
  'createStatusPlugin', 'createExecutionPlugin', 'project', 'projectState',
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
function executableTests(relativePath) {
  const absolutePath = resolve(root, relativePath)
  const ast = bindingProgram.getSourceFile(absolutePath)
    ?? bindingProgram.getSourceFile(absolutePath.split(sep).join('/'))
  invariant(ast !== undefined, `binding program did not load test file: ${relativePath}`)
  const tests = new Map()
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'test' && node.arguments.length >= 2
      && ts.isStringLiteral(node.arguments[0])
      && node.arguments[1] && ts.isFunctionLike(node.arguments[1])) {
      invariant(!tests.has(node.arguments[0].text),
        `duplicate executable test name in ${relativePath}: ${node.arguments[0].text}`)
      tests.set(node.arguments[0].text, {
        body: node.arguments[1].body,
        ast,
        sourceFile: resolve(root, relativePath).split(sep).join('/'),
        relativePath,
      })
    }
    node.forEachChild(visit)
  }
  ast.forEachChild(visit)
  return tests
}
function resolveScriptCommand(scriptName, visiting = new Set()) {
  invariant(!visiting.has(scriptName), `package script cycle: ${scriptName}`)
  visiting.add(scriptName)
  const body = packageManifest.scripts?.[scriptName]
  invariant(typeof body === 'string' && body.length > 0, `package script ${scriptName} required`)
  return body
}
function gateCommandRunsExactFile(command, testFile) {
  invariant(!command.includes('||') && !command.includes(';') && !command.includes('#')
    && !command.includes('>') && !command.includes('<') && !command.includes('|'),
    `gate command must be an unconditional shell chain: ${command}`)
  invariant(!command.split(/\s+/).some(part => part === 'echo' || part.startsWith('#')),
    `gate command must not contain comments or echo-only proof: ${command}`)
  const segmentResults = command.split(/&&/g).map(part => part.trim()).map(token => {
    const scriptMatch = token.match(/^pnpm(?:\s+run)?\s+(\S+)$/)
    if (scriptMatch) return gateCommandRunsExactFile(resolveScriptCommand(scriptMatch[1]), testFile)
    const argv = token.split(/\s+/).filter(Boolean)
    invariant(argv[0] !== 'node' || !argv.includes('--test-name-pattern') && !argv.includes('--test-only'),
      `gate argv must exactly match the allowlist: ${token}`)
    const withoutImporter = argv[1] === '--import' && argv[2] === 'tsx' ? argv.slice(3) : argv.slice(1)
    if (argv[0] !== 'node') return false
    return JSON.stringify(withoutImporter) === JSON.stringify(['--test', testFile])
  })
  return segmentResults.some(result => result === true)
}
const bindingConfig = ts.parseJsonConfigFileContent(
  readJson('tsconfig.json'),
  ts.sys,
  root,
  undefined,
  resolve(root, 'tsconfig.json'),
)
invariant(bindingConfig.errors.length === 0,
  `tsconfig cannot be parsed for executable bindings: ${bindingConfig.errors.map(error => error.messageText).join('; ')}`)
const bindingProgram = ts.createProgram([
  resolve(root, 'tests/app-shell/app-shell.spec.ts'),
  resolve(root, '.appsdk/verification/verify-design.spec.mjs'),
], { ...bindingConfig.options, noEmit: true, allowJs: true })
const bindingChecker = bindingProgram.getTypeChecker()
function symbolDeclarationModule(test, node) {
  let symbol = bindingChecker.getSymbolAtLocation(node)
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = bindingChecker.getAliasedSymbol(symbol)
  }
  const declarations = symbol?.declarations ?? []
  invariant(declarations.length >= 1, `cannot resolve executable symbol in ${test.relativePath}`)
  const declarationFile = declarations.map(row => row.getSourceFile().fileName.split(sep).join('/'))
    .find(file => file.startsWith(`${root.split(sep).join('/')}/`))
  invariant(declarationFile !== undefined, `executable symbol resolves outside the project: ${test.relativePath}`)
  return assertUniquePathOwner(relative(root, declarationFile).split(sep).join('/')).module_id
}

function declarationBinding(ownerModule, symbolName, declarationFile, declaration, expectedFunctionId) {
  const relativeDeclaration = relative(root, declarationFile).split(sep).join('/')
  const ownerPrefix = `dsh-tui::${ownerModule}`
  const candidates = functionMap.functions.filter(row => row.status === 'implemented'
    && row.owner === ownerPrefix
    && (row.declaration_bindings ?? []).some(binding =>
      binding.symbol === symbolName
      && binding.path === relativeDeclaration
      && binding.qualified_name === qualifiedDeclarationName(symbolName, declaration)))
  invariant(candidates.length === 1,
    `declaration binding for ${ownerPrefix}.${symbolName} at ${relativeDeclaration}: expected 1, got ${candidates.length}; bindings=${JSON.stringify(
      functionMap.functions.filter(row => row.owner === ownerPrefix).flatMap(row => row.declaration_bindings ?? []),
    )}`)
  const binding = candidates[0].declaration_bindings.find(row => row.symbol === symbolName
    && row.path === relativeDeclaration
    && row.qualified_name === qualifiedDeclarationName(symbolName, declaration))
  const actualQualifiedName = qualifiedDeclarationName(symbolName, declaration)
  invariant(binding?.qualified_name === actualQualifiedName,
    `declaration binding qualified name mismatch: ${ownerPrefix}.${symbolName}: map=${binding?.qualified_name}, declaration=${actualQualifiedName}`)
  invariant(expectedFunctionId === undefined || candidates[0].function_id === expectedFunctionId,
    `semantic owner drift for ${ownerPrefix}.${symbolName}: expected ${expectedFunctionId}, got ${candidates[0].function_id}`)
  if (binding.declaration_kind === 'contract') {
    invariant(typeof binding.implementation_qualified_name === 'string',
      `contract binding ${binding.qualified_name} requires its implementation qualified name`)
    const implementations = candidates[0].declaration_bindings.filter(row =>
      row.symbol === symbolName && row.qualified_name === binding.implementation_qualified_name)
    invariant(implementations.length === 1,
      `contract binding ${binding.qualified_name}: expected one implementation binding`)
    invariant(implementations[0].declaration_kind === 'implementation',
      `implementation binding ${binding.implementation_qualified_name} must declare declaration_kind=implementation`)
  }
  assertUniquePathOwner(relativeDeclaration)
  return candidates[0]
}

function qualifiedDeclarationName(symbolName, declaration) {
  const parent = declaration?.parent
  if (parent && (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)
    || ts.isInterfaceDeclaration(parent)) && parent.name) {
    return `${parent.name.text}.${symbolName}`
  }
  return symbolName
}
function entrySymbolMatches(ownerModule, entrySymbol) {
  return functionMap.functions.some(row => row.status === 'implemented'
    && row.owner === `dsh-tui::${ownerModule}`
    && row.entry_symbols?.includes(entrySymbol))
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
}

function localFunctions(test) {
  const functions = new Map()
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && ts.isIdentifier(node.name)) {
      functions.set(node.name.text, node)
    }
    if ((ts.isVariableDeclaration(node)) && ts.isIdentifier(node.name)
      && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      functions.set(node.name.text, node.initializer)
    }
    node.forEachChild(visit)
  }
  visit(test.ast)
  return functions
}

function isConstantFalseExpression(expression) {
  if (!expression) return false
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return true
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return isConstantFalseExpression(expression.left) || isConstantFalseExpression(expression.right)
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return isConstantFalseExpression(expression.left) && isConstantFalseExpression(expression.right)
  }
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    return isConstantTrueExpression(expression.operand)
  }
  if (ts.isParenthesizedExpression(expression)) return isConstantFalseExpression(expression.expression)
  return false
}
function isConstantTrueExpression(expression) {
  if (!expression) return false
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return isConstantTrueExpression(expression.left) && isConstantTrueExpression(expression.right)
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return isConstantTrueExpression(expression.left) || isConstantTrueExpression(expression.right)
  }
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    return isConstantFalseExpression(expression.operand)
  }
  if (ts.isParenthesizedExpression(expression)) return isConstantTrueExpression(expression.expression)
  return false
}
function collectReachable(test, matches) {
  const nodes = []
  const functions = localFunctions(test)
  const activeFunctions = new Set()
  const terminates = node => ts.isReturnStatement(node) || ts.isThrowStatement(node)
    || ts.isBreakStatement(node) || ts.isContinueStatement(node)
    || (ts.isExpressionStatement(node) && ts.isThrowStatement(node.expression))
  const exitsFunction = node => ts.isReturnStatement(node) || ts.isThrowStatement(node)
    || (ts.isExpressionStatement(node) && ts.isThrowStatement(node.expression))
  const walk = (node, reachable) => {
    if (node !== test.body && isFunctionLike(node)) return
    if (matches(node) && reachable) nodes.push(node)
    if (ts.isBlock(node)) {
      let live = reachable
      for (const statement of node.statements) {
        if (live) walk(statement, live)
        if (exitsFunction(statement)) live = false
      }
      return
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      const initializer = ts.isForStatement(node) ? node.initializer : undefined
      if (initializer && isConstantFalseExpression(initializer)) return
      const condition = ts.isForStatement(node) ? node.condition : undefined
      if (condition !== undefined && condition !== null && isConstantFalseExpression(condition)) return
      walk(node.statement, reachable)
      return
    }
    if (ts.isWhileStatement(node)) {
      if (isConstantFalseExpression(node.expression)) return
      walk(node.statement, reachable)
      return
    }
    if (ts.isDoStatement(node)) {
      walk(node.statement, reachable)
      return
    }
    const constantFalse = isConstantFalseExpression(node.expression)
      && (ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isWhileStatement(node))
    const constantTrue = isConstantTrueExpression(node.expression)
      && (ts.isIfStatement(node) || ts.isConditionalExpression(node))
    if (constantFalse || constantTrue) {
      if (ts.isIfStatement(node)) {
        const thenTerminates = node.thenStatement !== undefined
          && walkTerminatesBlock(node.thenStatement)
        walk(node.thenStatement, constantTrue)
        if (node.elseStatement) walk(node.elseStatement, !constantTrue)
        if (thenTerminates) return
      } else if (ts.isConditionalExpression(node)) {
        walk(node.whenTrue, constantTrue)
        walk(node.whenFalse, !constantTrue)
      } else {
        walk(node.statement, false)
      }
      return
    }
    if (ts.isCallExpression(node) && reachable && ts.isIdentifier(node.expression)) {
      const functionName = node.expression.text
      const declaration = functions.get(functionName)
      const body = declaration?.body
      if (body !== undefined && !activeFunctions.has(functionName)) {
        activeFunctions.add(functionName)
        walk(body, true)
        declaration.parameters.forEach((parameter, index) => {
          const argument = node.arguments[index]
          if (ts.isIdentifier(parameter.name) && argument && ts.isFunctionLike(argument)) {
            walk(argument.body, true)
          }
        })
        activeFunctions.delete(functionName)
      }
    }
    if (ts.isCallExpression(node) && reachable && node.expression.getText(test.ast) === 'assert.throws') {
      for (const argument of node.arguments.filter(ts.isFunctionLike)) walk(argument.body, true)
    }
    node.forEachChild(child => walk(child, reachable))
  }
  function walkTerminatesBlock(statement) {
    if (!statement) return false
    if (ts.isBlock(statement)) {
      for (const child of statement.statements) if (exitsFunction(child)) return true
      return false
    }
    return exitsFunction(statement)
  }
  walk(test.body, true)
  return nodes
}

function collectReachableCalls(test, predicate) {
  return collectReachable(test, node => ts.isCallExpression(node) && predicate(node))
}

function reachableCalls(test, expression) {
  return collectReachableCalls(test, node =>
    node.getText(test.ast) === expression
  )
}

function reachableCalleeCalls(test, calleeExpression) {
  return collectReachableCalls(test, node =>
    node.expression.getText(test.ast) === calleeExpression
  )
}
function strictAssertSymbol(test) {
  let importNode
  for (const statement of test.ast.statements) {
    if (ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === 'node:assert/strict'
      && statement.importClause?.name?.text === 'assert') importNode = statement.importClause.name
  }
  invariant(importNode !== undefined,
    `${test.relativePath} must import assert as the default from node:assert/strict`)
  let symbol = bindingChecker.getSymbolAtLocation(importNode)
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = bindingChecker.getAliasedSymbol(symbol)
  }
  invariant(symbol !== undefined, `cannot resolve strict assert import in ${test.relativePath}`)
  return symbol
}
function usesStrictAssert(test, call) {
  invariant(ts.isPropertyAccessExpression(call.expression), `assertion must use property access: ${test.relativePath}`)
  const objectSymbol = bindingChecker.getSymbolAtLocation(call.expression.expression)
  if (objectSymbol === undefined) return false
  let resolved = objectSymbol
  if ((resolved.flags & ts.SymbolFlags.Alias) !== 0) resolved = bindingChecker.getAliasedSymbol(resolved)
  return resolved === strictAssertSymbol(test)
}
function containsDescendantCall(ancestor, descendant) {
  let found = false
  const visit = node => {
    if (node === descendant) found = true
    node.forEachChild(visit)
  }
  visit(ancestor)
  return found
}
function matcherAllowedKeys(matcher, keys) {
  const provided = new Set(Object.keys(matcher))
  const required = new Set(keys)
  for (const key of required) invariant(provided.has(key),
    `AST matcher missing required field: ${key}; provided=${JSON.stringify([...provided])}`)
  for (const key of provided) invariant(required.has(key),
    `AST matcher has unexpected field: ${key}; required=${JSON.stringify([...required])}`)
}
function regularExpressionPattern(node) {
  return node.text.replace(/^\/(.+)\/[a-z]*$/u, '$1')
}
function resolvedSymbol(test, node) {
  let symbol = bindingChecker.getSymbolAtLocation(node)
  if (symbol === undefined) return undefined
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = bindingChecker.getAliasedSymbol(symbol)
  }
  return symbol
}

function importedCalleeMatchesOwner(test, node, ownerModule) {
  const symbol = resolvedSymbol(test, node)
  invariant(symbol !== undefined, `cannot resolve bound callee in ${test.relativePath}: ${node.getText(test.ast)}`)
  const declarations = symbol.declarations ?? []
  invariant(declarations.length >= 1,
    `bound callee has no declaration in ${test.relativePath}: ${symbol.getName()}`)
  const declaration = declarations.find(candidate => candidate.parent
    && (ts.isClassDeclaration(candidate.parent) || ts.isClassExpression(candidate.parent)))
    ?? declarations[0]
  const imported = declarations.some(declaration =>
    declaration.getSourceFile().fileName !== test.sourceFile)
  if (!imported) {
    return ownerModule === 'governance-build'
      && symbolDeclarationModule(test, node) === ownerModule
      && entrySymbolMatches(ownerModule, symbol.getName())
  }
  const ownerRow = declarationBinding(
    ownerModule,
    symbol.getName(),
    declaration.getSourceFile().fileName,
    declaration,
    arguments.length > 3 ? arguments[3] : undefined,
  )
  const symbolName = symbol.getName()
  const expectedFunctionId = arguments.length > 3 ? arguments[3] : undefined
  const symbolBindings = functionMap.functions.filter(row => row.owner === ownerRow.owner
    && row.entry_symbols.includes(symbolName))
  invariant(symbolBindings.length === 0 || symbolBindings.length === 1
    || symbolBindings.every(row => row.function_id === ownerRow.function_id),
    `semantic owner drift for ${ownerRow.function_id}: entry_symbol binding ${symbolBindings.map(r => r.function_id).join(',')} != declaration binding ${ownerRow.function_id}`)
  const semanticNode = arguments.length > 3 ? arguments[3] : undefined
  invariant(semanticNode === undefined || ownerRow.semantic_nodes?.includes(semanticNode),
    `function ${ownerRow.function_id} does not own semantic node ${semanticNode}`)
  if (semanticNode !== undefined) {
    const mainlineMatch = mainline.edges.some(edge => edge.to === semanticNode
      && edge.owner === ownerRow.owner && edge.entry_symbols.includes(symbolName))
    const errorChainMatch = (mainline.error_chains ?? []).some(chain => chain.nodes.includes(semanticNode)
      && chain.edges.some(edge => edge.owner === ownerRow.owner && edge.entry_symbols.includes(symbolName)))
    invariant(mainlineMatch || errorChainMatch,
      `symbol ${symbolName} is not an executable edge input for ${semanticNode}`)
  }
  return symbolDeclarationModule(test, node) === ownerModule
    && ownerRow.entry_symbols.includes(symbolName)
    && (expectedFunctionId === undefined || ownerRow.function_id === expectedFunctionId)
}

function containsFlowValue(test, node, valueSymbol, valueName) {
  if (ts.isIdentifier(node)) {
    const symbol = resolvedSymbol(test, node)
    return node.text === valueName && symbol !== undefined && symbol === valueSymbol
  }
  return node.getChildren().some(child => containsFlowValue(test, child, valueSymbol, valueName))
}

function collectReachableIdentifiers(root, symbol) {
  const identifiers = []
  const visit = node => {
    if (ts.isIdentifier(node) && resolvedSymbol(root, node) === symbol) identifiers.push(node)
    node.forEachChild(visit)
  }
  visit(testAst(root))
  return identifiers
}
function reassigns(test, symbol, declaration) {
  for (const reference of collectReachableIdentifiers(test, symbol)) {
    const target = reference.parent
    if (!target) continue
    if (target === declaration) continue
    if (ts.isVariableDeclaration(target) && target.name === reference) continue
    if (ts.isBinaryExpression(target) && (target.operatorToken.kind === ts.SyntaxKind.EqualsToken
      || target.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken
      || target.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken)) {
      if (target.left === reference) return true
    }
    if (ts.isPrefixUnaryExpression(target)
      && (target.operator === ts.SyntaxKind.PlusPlusToken || target.operator === ts.SyntaxKind.MinusMinusToken)) {
      if (target.operand === reference) return true
    }
    if (ts.isPostfixUnaryExpression(target)
      && (target.operator === ts.SyntaxKind.PlusPlusToken || target.operator === ts.SyntaxKind.MinusMinusToken)) {
      if (target.operand === reference) return true
    }
  }
  return false
}
function declarationIsConst(declaration) {
  if (!declaration) return false
  const list = declaration.parent
  if (!list) return false
  return list.flags !== undefined && (list.flags & ts.NodeFlags.Const) !== 0
}
function testAst(test) { return test.ast }
function valueFlowMatches(test, matcher) {
  const producerCalls = reachableCalls(test, matcher.producer_call).filter(call => {
    if (!ts.isIdentifier(call.expression) && !ts.isPropertyAccessExpression(call.expression)) return false
    return importedCalleeMatchesOwner(
      test,
      call.expression,
      matcher.producer_owner,
      matcher.producer_function_id,
      matcher.semantic_node,
    )
  })
  const producer = producerCalls.find(call => ts.isVariableDeclaration(call.parent)
    && ts.isIdentifier(call.parent.name) && call.parent.name.text === matcher.producer_result)
  invariant(producer !== undefined,
    `value-flow producer result is not assigned to ${matcher.producer_result}`)
  const projectionSymbol = resolvedSymbol(test, producer.parent.name)
  invariant(projectionSymbol !== undefined, 'cannot resolve the value-flow producer result')
  invariant(declarationIsConst(producer.parent),
    `value-flow producer ${matcher.producer_result} must be declared const`)
  invariant(!reassigns(test, projectionSymbol, producer.parent),
    `value-flow producer ${matcher.producer_result} must not be reassigned after creation`)
  const awaited = collectReachable(test, node => ts.isAwaitExpression(node)
    && node.expression.getText(test.ast) === matcher.awaited_value)
    .map(awaitNode => ({ awaitNode, assignment: awaitNode.parent }))
    .filter(row => ts.isVariableDeclaration(row.assignment)
      && ts.isIdentifier(row.assignment.name) && row.assignment.name.text === matcher.flow_result)
  invariant(awaited.length === 1, `value-flow awaited result is not assigned to one ${matcher.flow_result} declaration`)
  const awaitedExpression = awaited[0].awaitNode.expression
  invariant(ts.isPropertyAccessExpression(awaitedExpression)
    && resolvedSymbol(test, awaitedExpression.expression) === projectionSymbol,
    `value-flow awaited value does not come from ${matcher.producer_result}`)
  const outcomeSymbol = resolvedSymbol(test, awaited[0].assignment.name)
  invariant(outcomeSymbol !== undefined, `cannot resolve value-flow outcome: ${matcher.flow_result}`)
  invariant(declarationIsConst(awaited[0].assignment),
    `value-flow awaited outcome ${matcher.flow_result} must be declared const`)
  invariant(!reassigns(test, outcomeSymbol, awaited[0].assignment),
    `value-flow awaited outcome ${matcher.flow_result} must not be reassigned`)
  return matcher.sink_calls.every((sinkCall, index) => reachableCalls(test, sinkCall).some(call =>
    call.arguments.some(argument => containsFlowValue(test, argument, outcomeSymbol, matcher.flow_result))
    && (ts.isIdentifier(call.expression) || ts.isPropertyAccessExpression(call.expression))
    && importedCalleeMatchesOwner(
      test,
      call.expression,
      matcher.sink_owners[index],
      matcher.sink_function_ids?.[index],
      matcher.sink_nodes?.[index],
    )))
}

function callMatcherMatches(test, matcher) {
  const calls = reachableCalls(test, matcher.expression)
  return calls.some(call => (ts.isIdentifier(call.expression) || ts.isPropertyAccessExpression(call.expression))
    && (!matcher.callee_owner || importedCalleeMatchesOwner(
      test,
      call.expression,
      matcher.callee_owner,
      matcher.function_id,
      matcher.semantic_node,
    )) && (matcher.callee_owner ? importedCalleeMatchesOwner(
      test,
      call.expression,
      matcher.callee_owner,
      matcher.function_id,
      matcher.semantic_node,
    ) : true))
}

function assertionCalls(test, methodName) {
  return reachableCalleeCalls(test, `assert.${methodName}`).filter(call =>
    usesStrictAssert(test, call))
}

function assertionArgumentsMatch(call, actual, expected) {
  return call.arguments.length >= 2
    && call.arguments[0].getText(call.getSourceFile()) === actual
    && call.arguments[1].getText(call.getSourceFile()) === expected
}

function regexArgumentMatches(node, pattern) {
  return node !== undefined
    && ts.isRegularExpressionLiteral(node)
    && regularExpressionPattern(node) === pattern
}

function matchesAstMatcher(test, matcher) {
  switch (matcher.kind) {
    case 'call': {
      const keys = ['kind', 'expression']
      if (matcher.callee_owner !== undefined) keys.push('callee_owner')
      if (matcher.function_id !== undefined) keys.push('function_id')
      if (matcher.semantic_node !== undefined) keys.push('semantic_node')
      matcherAllowedKeys(matcher, keys)
      invariant(typeof matcher.expression === 'string' && matcher.expression.length > 0,
        'call matcher requires expression')
      return callMatcherMatches(test, matcher)
    }
    case 'identifier': {
      matcherAllowedKeys(matcher, ['kind', 'name', 'owner_module'])
      invariant(typeof matcher.name === 'string' && matcher.name.length > 0,
        'identifier matcher requires name')
      let matched = false
      const visit = node => {
        if (ts.isIdentifier(node) && node.text === matcher.name
          && (!matcher.owner_module || symbolDeclarationModule(test, node) === matcher.owner_module)) matched = true
        node.forEachChild(visit)
      }
      visit(test.body)
      return matched
    }
    case 'deep_equal': {
      matcherAllowedKeys(matcher, ['kind', 'actual', 'expected'])
      return assertionCalls(test, 'deepEqual').some(call => assertionArgumentsMatch(call, matcher.actual, matcher.expected))
        || assertionCalls(test, 'deepStrictEqual').some(call => assertionArgumentsMatch(call, matcher.actual, matcher.expected))
    }
    case 'assert_equal': {
      matcherAllowedKeys(matcher, ['kind', 'actual', 'expected'])
      return assertionCalls(test, 'equal').some(call => assertionArgumentsMatch(call, matcher.actual, matcher.expected))
    }
    case 'assert_match': {
      matcherAllowedKeys(matcher, ['kind', 'actual', 'pattern'])
      return assertionCalls(test, 'match').some(call => call.arguments.length >= 2
        && call.arguments[0].getText(call.getSourceFile()) === matcher.actual
        && regexArgumentMatches(call.arguments[1], matcher.pattern))
    }
    case 'throws': {
      matcherAllowedKeys(matcher, ['kind', 'call', 'pattern'])
      return assertionCalls(test, 'throws').some(call => call.arguments.length >= 2
        && containsDescendantCall(call.arguments[0], reachableCalls(test, matcher.call)[0])
        && regexArgumentMatches(call.arguments[1], matcher.pattern))
    }
    case 'value_flow': {
      matcherAllowedKeys(matcher, [
        'kind', 'producer_call', 'producer_owner', 'producer_result', 'awaited_value',
        'flow_result', 'sink_calls', 'sink_owners',
      ])
      invariant(typeof matcher.producer_call === 'string' && typeof matcher.producer_result === 'string'
        && typeof matcher.awaited_value === 'string' && typeof matcher.flow_result === 'string'
        && Array.isArray(matcher.sink_calls) && matcher.sink_calls.length > 0
        && Array.isArray(matcher.sink_owners)
        && matcher.sink_calls.length === matcher.sink_owners.length,
        'value-flow matcher requires one producer, awaited result and aligned sinks')
      return valueFlowMatches(test, matcher)
    }
    default:
      invariant(false, `unknown executable AST matcher kind: ${String(matcher.kind)}`)
  }
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
  const contractPath = 'contracts/tui/chrome-controls/chrome-controls.types.ts'
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
const chromeManifest = JSON.parse(readText('contracts/tui/chrome-controls/manifest.json'))
sameSet(new Set(declaredChromeSlotIds()), new Set(chromeManifest.slot_ids),
  'canonical runtime <-> manifest chrome slot coverage')
invariant(JSON.stringify(declaredChromeSlotIds()) === JSON.stringify(chromeManifest.slot_ids),
  'canonical runtime <-> manifest chrome slot order')
const appContainerSource = sourceFacts('playground/experiments/app-container/src/app-container.ts')
invariant(!appContainerSource.identifiers.has('tuiLogicControls'),
  'app-container cannot consume the logic-control registry directly')
invariant([...appContainerSource.calls].some(call => call.endsWith('.projectState')),
  'app-container must consume the closed chrome projectState edge')
const chromeSource = sourceFacts('playground/experiments/chrome-controls/src/chrome-controls.ts')
const chromeCallKinds = new Map()
const visitChromeCalls = node => {
  if (ts.isCallExpression(node) && node.expression.getText(chromeSource.ast) === 'chromeControlProjection'
    && node.arguments.length === 2 && ts.isStringLiteral(node.arguments[1])) {
    chromeCallKinds.set(node.arguments[1].text, true)
  }
  node.forEachChild(visitChromeCalls)
}
chromeSource.ast.forEachChild(visitChromeCalls)
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
const chromeControlHelper = sourceFacts('contracts/tui/chrome-controls/chrome-controls.types.ts')
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
const producerLogicEdge = auxEdges.find(edge =>
  edge.from === 'chrome_slot_producer_project'
  && edge.to === 'chrome_control_helper.project')
const helperLogicEdge = auxEdges.find(edge =>
  edge.from === 'chrome_control_helper.project'
  && edge.to === 'logic_control_registry.project')
invariant(appProjectionEdge?.owner === 'dsh-tui::app-container'
  && appProjectionEdge.caller === 'TuiAppContainerService.chromeFromSlots'
  && appProjectionEdge.callee === 'TuiChromeSlotRegistry.projectState',
  'app-container -> chrome state edge is not the parsed adjacent call edge')
invariant(stateToSlotsEdge?.owner === 'dsh-tui::chrome-controls'
  && stateToSlotsEdge.caller === 'TuiChromeSlotRegistry.projectState'
  && stateToSlotsEdge.callee === 'TuiChromeSlotRegistry.project',
  'projectState -> project edge is not the parsed adjacent call edge')
invariant(producerLogicEdge?.owner === 'dsh-tui::chrome-controls'
  && producerLogicEdge.caller === 'TuiChromeSlotProducer.project'
  && producerLogicEdge.callee === 'chromeControlProjection',
  'producer -> helper edge is not the parsed adjacent call edge')
invariant(helperLogicEdge?.owner === 'dsh-tui::chrome-controls'
  && helperLogicEdge.caller === 'chromeControlProjection'
  && helperLogicEdge.callee === 'TuiLogicControlRegistryService.project',
  'helper -> logic-control edge is not the parsed runtime implementation edge')
const logicControlsSource = sourceFacts('playground/experiments/logic-controls/src/logic-controls.ts')
invariant(logicControlsSource.identifiers.has('TuiLogicControlRegistryService')
  && logicControlsSource.methods.has('project'),
  'chrome helper must bind to the registered logic-control service implementation')
const chromeTestSource = sourceFacts('tests/chrome-controls/chrome-controls.spec.ts')
invariant(chromeTestSource.identifiers.has('applyLogicControls')
  && [...chromeTestSource.calls].some(call => call === 'applyLogicControls'),
  'chrome contract must bind the concrete logic-control owner in tests')
invariant([...chromeTestSource.calls].some(call => call.endsWith('.projectState')),
  'chrome contract must exercise the public projectState edge')
invariant(chromeProjection?.resource_ids.includes('logic_control_registry'),
  'project_chrome_slots must bind its real logic-control input resource')
const appContainerMainlineEdge = mainline.edges.find(edge =>
  edge.from === 'TuiOutputIn05InkTreeComposed' && edge.to === 'TuiOutputIn06AppContainerFrame')
invariant(appContainerMainlineEdge.owner === 'dsh-tui::app-container', 'app-container mainline edge owner drift')
invariant(!appContainerMainlineEdge.entry_symbols.includes('TuiChromeSlotRegistry'),
  'app-container mainline edge cannot claim chrome-controls symbols')
const appContainerSuite = testDesign.suites.find(row => row.suite_id === 'app-container.composition')
invariant(appContainerSuite.whitebox.includes('app-container may import only terminal-ui and chrome-controls contract faces'),
  'app-container test design boundary drift')
invariant(appContainerSuite.negative.some(row => row.includes('missing headerSession or headerStatus')),
  'app-container test design must require complete chrome headers')
const chromeSuite = testDesign.suites.find(row => row.suite_id === 'chrome-controls.registry')
invariant(chromeSuite.negative.some(row => row.includes('registered producer output with an extra control field')),
  'chrome-controls test design must require producer-output closure')
invariant(chromeSuite.negative.some(row => row.includes('incomplete required slot set')),
  'chrome-controls test design must require the five-slot set')
invariant(chromeSuite.negative.some(row => row.includes('projectState without logic-control owner fails')),
  'chrome-controls test design must require its missing-owner negative')
invariant(chromeSuite.negative.some(row => row.includes('extra projection input fields fail')),
  'chrome-controls test design must reject undeclared projection inputs')
invariant(appContainerSuite.negative.some(row => row.includes('typed composition failure preserves cause without rethrowing')),
  'app-container test design must bind typed composition failure truth')
const compositionErrorFn = functionMap.functions.find(row => row.function_id === 'route_app_composition_errors')
invariant(compositionErrorFn?.owner === 'dsh-tui::app-container'
  && JSON.stringify(compositionErrorFn.entry_symbols) === JSON.stringify(['TuiAppContainerService', 'composeInkTreeSafe'])
  && compositionErrorFn.resource_ids.includes('app_composition_failure_chain'),
  'app-container composition error owner/function binding drift')
const appShellSource = sourceFacts('playground/experiments/app-shell/src/app-shell.ts')
invariant([...appShellSource.calls].some(call => call === 'deps.ui.composeInkTreeSafe'),
  'app-shell must request the safe typed app-container edge')
invariant([...appShellSource.calls].some(call => call === 'deps.lifecycle.renderWithCompose'),
  'app-shell must route composition through terminal lifecycle failure chain')
const compositionChain = mainline.error_chains?.find(chain =>
  chain.chain_id === 'dsh-tui-app-composition-error-v1')
invariant(compositionChain?.nodes[0] === 'TuiErrorOut01CompositionFailure'
  && compositionChain.nodes.at(-1) === 'TuiErrorOut04ProcessExit'
  && compositionChain.edges[0]?.entry_symbols?.includes('renderWithCompose')
  && compositionChain.edges[2]?.entry_symbols?.includes('cliExitForTuiStartupOutcome')
  && compositionChain.edges[2]?.entry_symbols?.includes('pluginExitForTuiStartupOutcome'),
  'composition error chain must bind terminal failure to executable process exit')
invariant(compositionChain.edges.length === 3
  && compositionChain.edges[0]?.owner === 'dsh-tui::terminal-lifecycle'
  && JSON.stringify(compositionChain.edges[0].entry_symbols) === JSON.stringify(['TuiTerminalLifecycleService', 'renderWithCompose'])
  && compositionChain.edges[1]?.owner === 'dsh-tui::app-shell'
  && JSON.stringify(compositionChain.edges[2].entry_symbols) === JSON.stringify([
    'cliExitForTuiStartupOutcome', 'pluginExitForTuiStartupOutcome',
  ]),
  'composition error-chain owners must follow the real conversion boundaries')
const lifecycleChainNodeOwners = (lifecycle.error_chains ?? []).find(chain => chain.chain_id === 'dsh-tui-app-composition-error-v1')?.nodes ?? []
invariant(JSON.stringify(lifecycleChainNodeOwners.map(node => node.owner)) === JSON.stringify([
  'app-container', 'terminal-lifecycle', 'app-shell', 'app-shell',
]), 'composition error lifecycle node owners drift')
function methodContainsText(source, methodName, needle) {
  const method = source.methods.get(methodName)
  return method !== undefined && method.getText(source.ast).includes(needle)
}
const appContainerSafeMethod = appContainerSource.methods.get('composeInkTreeSafe')
invariant(appContainerSafeMethod !== undefined
  && appContainerSafeMethod.getText(appContainerSource.ast).includes('this.terminalUi()')
  && appContainerSafeMethod.getText(appContainerSource.ast).includes('terminalUi.composeInkTreeSafe'),
  'app-container safe path must consume the terminal-ui canonical result')
const terminalLifecycleSource = sourceFacts('playground/experiments/terminal-lifecycle/src/terminal-lifecycle.ts')
invariant(methodContainsText(terminalLifecycleSource, 'renderWithCompose', 'cause: result.error.cause'),
  'renderWithCompose must preserve the canonical composition cause')
for (const hardcodedChromeField of [
  'header.logo', 'header.connection', 'header.session', 'header.status',
  'logoVisible', 'connectionState', 'headerSession', 'headerStatus', 'executionState',
]) {
  invariant(!terminalLifecycleSource.source.includes(hardcodedChromeField),
    `terminal-lifecycle must not hand-assemble chrome; found ${hardcodedChromeField}`)
}
invariant(terminalLifecycleSource.source.includes(".filter(node => node.placement === 'header')"),
  'terminal-lifecycle must render header chrome from projected placement')
invariant(terminalLifecycleSource.source.includes(".find(node => node.placement === 'execution')"),
  'terminal-lifecycle must render execution chrome from projected placement')
invariant([...terminalLifecycleSource.calls].some(call => call === 'assertTuiChromeRenderNodes'),
  'terminal-lifecycle must validate projected chrome render nodes')
const appFrameFunction = functionMap.functions.find(row => row.function_id === 'compose_app_container_frame')
invariant(appFrameFunction?.entry_symbols.includes('chromeRenderNodes')
  && (appFrameFunction.declaration_bindings ?? []).some(binding =>
    binding.symbol === 'chromeRenderNodes'
    && binding.path === 'playground/experiments/app-container/src/app-container.ts'),
  'chrome render-node projection owner/function binding drift')
invariant(!moduleRegistry.import_edges.some(edge =>
  edge.from === 'app-container' && edge.to === 'terminal-lifecycle'),
  'app-container must consume terminal-ui, not own a renderer edge to terminal-lifecycle')
invariant(resourceMap.required_relations.some(relation =>
  relation.from === 'tui_app_container_composition'
  && relation.via === 'typed_chrome_render_nodes'
  && relation.to === 'terminal_lifecycle'),
  'app-container -> lifecycle chrome render-node resource relation missing')
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
const compositionChainFunctions = [
  ['route_app_composition_errors', 'dsh-tui::app-container'],
  ['project_composition_terminal_failure', 'dsh-tui::terminal-lifecycle'],
  ['project_terminal_failure_startup_outcome', 'dsh-tui::app-shell'],
].map(([functionId, owner]) => {
  const row = functionMap.functions.find(candidate => candidate.function_id === functionId)
  invariant(row?.owner === owner && row.required_gates.includes('composition_error_chain_e2e'),
    `composition chain function ${functionId}: owner or gate binding drift`)
  return row
})
const compositionGate = verification.gates.find(row => row.gate_id === 'composition_error_chain_e2e')
invariant(compositionGate?.status === 'active'
  && compositionGate.command === 'pnpm run test:app-container && pnpm run test:terminal-lifecycle && pnpm run test:app-shell',
  'composition error-chain gate is not active with its mapped suites')
invariant(compositionGate.required_for.includes('app_container_implementation')
  && compositionGate.required_for.includes('app_shell_implementation')
  && compositionGate.required_for.includes('terminal_lifecycle_implementation'),
  'composition error-chain gate must be required by all three implementation stages')
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
const compositionE2e = sourceFacts('tests/app-shell/app-shell.spec.ts')
invariant([...compositionE2e.calls].includes('projectTerminalFailureOutcome'),
  'composition e2e does not invoke the startup outcome projector')
invariant((compositionE2e.source.match(/controller\.render\(\)/g) ?? []).length >= 2,
  'composition e2e does not drive success and failure renders')
invariant(compositionE2e.source.includes('composeInkTreeSafe(input)')
  && compositionE2e.source.includes('if (shouldFail) throw originalCause')
  && compositionE2e.source.includes('ui: lifecycleContext.tuiAppContainer'),
  'composition e2e does not originate the failure at the real app-container boundary')
invariant([...compositionE2e.calls].includes('cliExitForTuiStartupOutcome')
  && [...compositionE2e.calls].includes('pluginExitForTuiStartupOutcome'),
  'composition e2e does not exercise both production process-exit owners')
const compositionChainSuite = testDesign.suites.find(row => row.suite_id === 'app-shell.composition-error-chain')
invariant(testDesign.status === 'implemented' && compositionChainSuite !== undefined
  && compositionChainSuite.gates.includes('composition_error_chain_e2e')
  && compositionChainSuite.positive.some(row => row.includes('exits with code 1 via real cli and plugin exit owners'))
  && compositionChainSuite.negative.some(row => row.includes('production startTui cannot be replaced')),
  'app-shell composition error-chain design is not implemented in lockstep')
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
const declaredScenarios = [...compositionChainSuite.positive, ...compositionChainSuite.negative]
const scenarioBindings = compositionChainSuite.test_bindings ?? []
sameSet(new Set(declaredScenarios), new Set(scenarioBindings.map(row => row.scenario)),
  'app-shell composition-error scenario bindings')
const executableTestBodies = new Map([
  ['tests/app-shell/app-shell.spec.ts', executableTests('tests/app-shell/app-shell.spec.ts')],
  ['.appsdk/verification/verify-design.spec.mjs', executableTests('.appsdk/verification/verify-design.spec.mjs')],
])
function lookupTest(testFile, testName) {
  const bodies = executableTestBodies.get(testFile)
  if (!bodies) return undefined
  return bodies.get(testName)
}
for (const binding of scenarioBindings) {
  invariant(typeof binding.test_name === 'string' && Array.isArray(binding.required_ast)
    && binding.required_ast.length > 0
    && typeof binding.test_file === 'string' && typeof binding.gate_id === 'string',
    `malformed test binding for ${binding.scenario}`)
  invariant(compositionChainSuite.gates.includes(binding.gate_id),
    `scenario ${binding.scenario} declares a gate absent from its suite`)
  const owner = assertUniquePathOwner(binding.test_file)
  invariant(owner.module_id === 'app-shell' || owner.module_id === 'governance-build',
    `scenario ${binding.scenario}: test_file owner ${owner.module_id} is not governed by app-shell or governance-build`)
  const gateRow = verification.gates.find(row => row.gate_id === binding.gate_id)
  invariant(gateRow?.status === 'active' && gateCommandRunsExactFile(gateRow.command, binding.test_file),
    `scenario ${binding.scenario} is not unconditionally executed by its declared gate ${binding.gate_id}`)
  const test = lookupTest(binding.test_file, binding.test_name)
  invariant(test !== undefined,
    `scenario has no executable test in ${binding.test_file}: ${binding.scenario} -> ${binding.test_name}`)
  for (const matcher of binding.required_ast) {
    invariant(matchesAstMatcher(test, matcher),
      `executable test omits bound AST matcher for ${binding.scenario}: ${JSON.stringify(matcher)}`)
  }
}
invariant(ciWorkflow.includes(compositionGate.command),
  'CI composition error-chain gate wiring missing')
const v3Design = readText('.appsdk/architecture/tui-v3-design.md')
invariant(v3Design.includes('Status: confirmed v3 runtime implementation; delivery admission remains gated by verification-map.'),
  'canonical v3 runtime status drift')
invariant(v3Design.includes('The `chrome-controls` Cordis plugin is the sole\nowner of typed slot projection'),
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
