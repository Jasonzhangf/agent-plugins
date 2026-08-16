import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  const seen = new Set()
  for (const value of values) {
    if (seen.has(value)) fail(`duplicate ${label}: ${value}`)
    seen.add(value)
  }
  return seen
}

function asString(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`)
  return value
}

function requireRelativeFile(fromDir, path, label) {
  if (typeof path !== 'string' || isAbsolute(path)) fail(`${label} must be a relative file path`)
  readFileSync(resolve(fromDir, path))
}

function checkoutPackageDir(checkoutRoot, packageName) {
  const packagesDir = join(checkoutRoot, 'packages')
  const candidates = []
  const visit = (dir, depth) => {
    if (depth > 2) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = join(dir, entry.name)
      const manifestPath = join(child, 'package.json')
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (manifest.name === packageName) candidates.push(child)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      visit(child, depth + 1)
    }
  }
  visit(packagesDir, 0)
  if (candidates.length !== 1) fail(`${packageName} must resolve to exactly one checkout package, found ${candidates.length}`)
  return candidates[0]
}

function installedPackageDir(installRoot, checkoutRoot, packageName) {
  if (!isAbsolute(installRoot)) fail('clean install root must be absolute')
  const packagePath = join(installRoot, 'node_modules', ...packageName.split('/'))
  const realInstallRoot = realpathSync(installRoot)
  const realPackagePath = realpathSync(packagePath)
  const pathFromInstall = relative(realInstallRoot, realPackagePath)
  if (pathFromInstall.startsWith('..') || isAbsolute(pathFromInstall)) fail(`${packageName} resolves outside the clean install root`)
  if (isWithin(checkoutRoot, realPackagePath)) fail(`${packageName} resolves into the DSH checkout`)
  return realPackagePath
}

function packageDir(artifactContext, packageName) {
  if (artifactContext.package_layout === 'dsh_checkout') return checkoutPackageDir(artifactContext.package_root, packageName)
  if (artifactContext.package_layout === 'node_modules') return installedPackageDir(artifactContext.package_root, artifactContext.checkout_root, packageName)
  fail(`unknown artifact package layout: ${artifactContext.package_layout}`)
}

function exportTypesTarget(entry) {
  if (typeof entry === 'string') return entry
  if (entry !== null && typeof entry === 'object' && typeof entry.types === 'string') return entry.types
  return undefined
}

function symbolPattern(symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:export\\s+(?:declare\\s+)?(?:abstract\\s+)?(?:class|interface|type|const|function|enum)\\s+${escaped}\\b|export\\s+(?:type\\s+)?\\{[^}]*\\b${escaped}\\b[^}]*\\})`, 's')
}

function requireExportedSymbol(artifactContext, binding) {
  const dir = packageDir(artifactContext, binding.package)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (manifest.version !== binding.package_version) fail(`${binding.capability_id} package version is ${manifest.version}, expected ${binding.package_version}`)
  const exportEntry = manifest.exports?.[binding.export_path]
  if (exportEntry === undefined) fail(`${binding.capability_id} missing package export ${binding.package}${binding.export_path}`)
  const declaredTypes = exportTypesTarget(exportEntry)
  if (declaredTypes === undefined) fail(`${binding.capability_id} export ${binding.export_path} has no types target`)
  const actualArtifact = declaredTypes.replace(/^\.\//, '')
  if (actualArtifact !== binding.types_artifact) fail(`${binding.capability_id} types artifact mismatch: ${actualArtifact}`)
  const declarations = readFileSync(join(dir, actualArtifact), 'utf8')
  if (!symbolPattern(binding.symbol).test(declarations)) fail(`${binding.capability_id} symbol ${binding.symbol} is not exported by ${binding.package}${binding.export_path}`)
}

function requireExportedSymbols(artifactContext, binding, symbols) {
  for (const symbol of symbols) requireExportedSymbol(artifactContext, { ...binding, symbol })
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function isWithin(parent, child) {
  const pathFromParent = relative(realpathSync(parent), realpathSync(child))
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent))
}

function requireCleanRegistryLockfile(lockfilePath, installRoot, checkoutRoot) {
  if (!isWithin(installRoot, lockfilePath)) fail('clean install lockfile must be inside the clean install root')
  if (isWithin(checkoutRoot, installRoot)) fail('clean install root must be outside the DSH checkout')
  const lockfile = YAML.parse(readFileSync(lockfilePath, 'utf8'))
  const visit = value => {
    if (typeof value === 'string') {
      if (/^(?:file|link|portal|workspace):/.test(value)) fail(`clean install lockfile contains a local dependency reference: ${value}`)
      if (value.includes(checkoutRoot)) fail('clean install lockfile contains the DSH checkout path')
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item)
    }
  }
  visit(lockfile)
  return lockfile
}

function lockfilePackageIntegrity(lockfile, packageName, version) {
  const packageKey = `${packageName}@${version}`
  const matches = Object.entries(lockfile.packages ?? {}).filter(([key]) => {
    const normalized = key.startsWith('/') ? key.slice(1) : key
    return normalized === packageKey || normalized.startsWith(`${packageKey}(`)
  })
  if (matches.length === 0) fail(`clean install lockfile has no registry entry for ${packageKey}`)
  const integrities = unique(matches.map(([, entry]) => entry?.resolution?.integrity), `${packageKey} lockfile integrity`)
  if (integrities.size !== 1 || typeof [...integrities][0] !== 'string' || ![...integrities][0].startsWith('sha512-')) {
    fail(`clean install lockfile has no unique registry integrity for ${packageKey}`)
  }
  return [...integrities][0]
}

function requireInstalledRegistryPackage(artifactContext, lockfile, packageName, version, expectedIntegrity) {
  const dir = installedPackageDir(artifactContext.package_root, artifactContext.checkout_root, packageName)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (manifest.name !== packageName) fail(`${packageName} installed manifest has package name ${manifest.name}`)
  if (manifest.version !== version) fail(`${packageName} installed version is ${manifest.version}, expected ${version}`)
  const lockfileIntegrity = lockfilePackageIntegrity(lockfile, packageName, version)
  if (lockfileIntegrity !== expectedIntegrity) fail(`${packageName} release integrity does not match the clean install lockfile`)
}

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', ...options }).trim()
}

function gitObjectIdPattern() {
  const format = git(['rev-parse', '--show-object-format'])
  const lengths = { sha1: 40, sha256: 64 }
  const length = lengths[format]
  if (length === undefined) fail(`unsupported Git object format: ${format}`)
  return new RegExp(`^[0-9a-f]{${length}}$`)
}

function reviewReportPasses(report) {
  const lines = report.split('\n')
  const conclusions = lines.map(line => line.trim().replace(/^\*\*(.*)\*\*$/, '$1'))
  const verdictFail = conclusions.some(line => /^(?:VERDICT|Final verdict|Final conclusion|结论|最终结论)\s*[:：]\s*FAIL\s*$/iu.test(line) || /^overall(?: verdict)?(?:\s*[:：])?\s+FAIL\s*$/i.test(line))
  const verdictPass = conclusions.some(line => /^(?:VERDICT|Final verdict|Final conclusion|结论|最终结论)\s*[:：]\s*PASS\s*$/iu.test(line)
    || /^overall(?: verdict)?(?:\s*[:：])?\s+PASS\s*$/i.test(line)
    || /^No P0\/P1 issues;\s*PASS\s*$/i.test(line))
  const blockingFinding = lines.some(line => {
    if (/\bno\b.*\bP[01]\b/i.test(line) || /\b0\s+P[01]\b/i.test(line)) return false
    return /^\s*(?:[-*#>|]|\d+[.)])?\s*(?:🔴\s*)?P[01]\b(?:\s*[:：|-]|\s+\S)/iu.test(line)
      || /\b[1-9]\d*\s*(?:×|x)\s*P[01]\b/iu.test(line)
      || /\bblocking\s+P[01]\b/i.test(line)
  })
  const reReviewRequired = /(?:修复|解决|处理).{0,24}(?:后再审|后重新审)|(?:fix|address|resolve).{0,40}(?:before|then).{0,20}(?:re-?review|review again)/is.test(report)
  return verdictPass && !verdictFail && !blockingFinding && !reReviewRequired
}

function requireDshReviewPass(evidencePath, reviewedTree, reviewedDiffSha256) {
  if (typeof evidencePath !== 'string' || !isAbsolute(evidencePath)) fail('release_admission.evidence.dsh_review must be an absolute path')
  const finalPath = realpathSync(evidencePath)
  if (finalPath !== realpathSync(join(dirname(finalPath), 'review.final.md'))) fail('DSH Review evidence must point to review.final.md')
  const evidenceDir = dirname(finalPath)
  const run = JSON.parse(readFileSync(join(evidenceDir, 'run.json'), 'utf8'))
  const status = JSON.parse(readFileSync(join(evidenceDir, 'status.json'), 'utf8'))
  const exit = readFileSync(join(evidenceDir, 'review.exit'), 'utf8').trim()
  const report = readFileSync(finalPath, 'utf8')
  const repoRoot = realpathSync(git(['rev-parse', '--show-toplevel']))
  if (run.action !== 'review' || run.mode !== 'uncommitted' || run.commit !== null) fail('DSH Review must run in uncommitted review mode')
  if (run.provider !== 'opencode-go') fail('DSH Review must use the opencode-go provider')
  if (realpathSync(run.repo) !== repoRoot) fail('DSH Review repository does not match the release repository')
  if (realpathSync(run.runDir) !== realpathSync(evidenceDir)) fail('DSH Review run directory does not match its evidence path')
  if (typeof run.prompt !== 'string' || !run.prompt.includes(`Reviewed tree: ${reviewedTree}`) || !run.prompt.includes(`Reviewed diff SHA-256: ${reviewedDiffSha256}`)) fail('DSH Review prompt does not bind the reviewed tree and diff evidence')
  if (status.taskId !== run.taskId || status.action !== 'review' || status.provider !== run.provider || status.state !== 'completed' || status.verdict !== 'pass' || status.mode !== 'uncommitted' || status.commit !== null) fail('DSH Review status is not a completed passing uncommitted review')
  if (realpathSync(status.repo) !== repoRoot || exit !== '0') fail('DSH Review status repository or exit evidence is invalid')
  if (!reviewReportPasses(report)) fail('DSH Review final evidence is not an unambiguous semantic PASS')
}

function uploadedCommitIdentityMatches(commit, reviewedTree, uploadedTreeEvidence, reviewedDiffSha256) {
  execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: root })
  const remoteRefs = execFileSync('git', ['branch', '-r', '--contains', commit], { cwd: root, encoding: 'utf8' }).trim()
  if (remoteRefs.length === 0) fail('release admission uploaded commit is absent from remote-tracking refs')
  const uploadedTree = git(['rev-parse', `${commit}^{tree}`])
  const parentRecord = git(['rev-list', '--parents', '-n', '1', commit]).split(' ')
  if (parentRecord.length !== 2) fail('release admission uploaded commit must have exactly one parent')
  const uploadedDiff = execFileSync('git', ['diff', '--binary', '--full-index', parentRecord[1], commit], { cwd: root })
  const uploadedDiffSha256 = createHash('sha256').update(uploadedDiff).digest('hex')
  return uploadedTree === reviewedTree
    && uploadedTree === uploadedTreeEvidence
    && uploadedDiffSha256 === reviewedDiffSha256
}

function expectFailure(run, label) {
  try {
    run()
  } catch {
    return
  }
  fail(`${label} must fail`)
}

function runDesignGateSelfTests(checkoutRoot) {
  const lockfile = YAML.parse(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'))
  const ajvIntegrity = 'sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA=='
  if (lockfilePackageIntegrity(lockfile, 'ajv', '8.20.0') !== ajvIntegrity) fail('lockfile integrity positive sample failed')
  expectFailure(() => lockfilePackageIntegrity(lockfile, 'ajv', '0.0.0'), 'missing lockfile package integrity')
  const artifactContext = { package_root: root, checkout_root: checkoutRoot }
  installedPackageDir(root, checkoutRoot, 'ajv')
  expectFailure(() => installedPackageDir(root, root, 'ajv'), 'package realpath into forbidden checkout')
  const externalLinkRoot = mkdtempSync(join(tmpdir(), 'dsh-tui-design-link-'))
  try {
    mkdirSync(join(externalLinkRoot, 'node_modules'))
    symlinkSync(realpathSync(join(root, 'node_modules/ajv')), join(externalLinkRoot, 'node_modules/ajv'), 'dir')
    expectFailure(() => installedPackageDir(externalLinkRoot, checkoutRoot, 'ajv'), 'package symlink outside clean install root')
  } finally {
    rmSync(externalLinkRoot, { recursive: true, force: true })
  }
  requireInstalledRegistryPackage(artifactContext, lockfile, 'ajv', '8.20.0', ajvIntegrity)
  expectFailure(() => requireInstalledRegistryPackage(artifactContext, lockfile, 'ajv', '8.20.0', 'sha512-invalid'), 'mismatched release integrity')
  expectFailure(() => requireInstalledRegistryPackage(artifactContext, lockfile, 'ajv', '0.0.0', ajvIntegrity), 'mismatched installed version')
  for (const report of ['No findings.\n\nVERDICT: PASS\n', '**Final verdict: PASS**\n', 'overall PASS\n', 'No P0/P1 issues; PASS\n']) {
    if (!reviewReportPasses(report)) fail('DSH Review PASS sample failed')
  }
  for (const [report, label] of [
    ['VERDICT: FAIL\n', 'explicit FAIL'],
    ['P1: blocking ownership error\n\nVERDICT: PASS\n', 'blocking P1'],
    ['2× P1 findings\n\nVERDICT: PASS\n', 'counted blocking P1'],
    ['Fix the issue before re-review.\n\nVERDICT: PASS\n', 'required re-review'],
    ['The prompt says VERDICT: PASS or VERDICT: FAIL.\n', 'prompt echo'],
  ]) expectFailure(() => {
    if (!reviewReportPasses(report)) throw new Error(label)
  }, label)
  const objectId = gitObjectIdPattern()
  const head = git(['rev-parse', 'HEAD'])
  if (!objectId.test(head)) fail('dynamic Git object ID length sample failed')
  const headTree = git(['rev-parse', 'HEAD^{tree}'])
  const parent = git(['rev-parse', 'HEAD^'])
  const headDiff = execFileSync('git', ['diff', '--binary', '--full-index', parent, head], { cwd: root })
  const headDiffSha256 = createHash('sha256').update(headDiff).digest('hex')
  const headRemoteRefs = execFileSync('git', ['branch', '-r', '--contains', head], { cwd: root, encoding: 'utf8' }).trim()
  if (headRemoteRefs.length > 0) {
    if (!uploadedCommitIdentityMatches(head, headTree, headTree, headDiffSha256)) fail('uploaded commit identity positive sample failed')
    if (uploadedCommitIdentityMatches(head, headTree, headTree, '0'.repeat(64))) fail('uploaded commit identity negative sample failed')
  }
  const reviewEvidenceRoot = mkdtempSync(join(tmpdir(), 'dsh-tui-design-review-'))
  try {
    const repoRoot = realpathSync(git(['rev-parse', '--show-toplevel']))
    const taskId = 'design-gate-self-test'
    const run = {
      taskId,
      action: 'review',
      provider: 'opencode-go',
      repo: repoRoot,
      mode: 'uncommitted',
      commit: null,
      runDir: reviewEvidenceRoot,
      prompt: `Reviewed tree: ${headTree}\nReviewed diff SHA-256: ${headDiffSha256}`,
    }
    const status = {
      taskId,
      action: 'review',
      provider: 'opencode-go',
      state: 'completed',
      verdict: 'pass',
      repo: repoRoot,
      mode: 'uncommitted',
      commit: null,
    }
    writeFileSync(join(reviewEvidenceRoot, 'run.json'), `${JSON.stringify(run)}\n`)
    writeFileSync(join(reviewEvidenceRoot, 'status.json'), `${JSON.stringify(status)}\n`)
    writeFileSync(join(reviewEvidenceRoot, 'review.exit'), '0\n')
    writeFileSync(join(reviewEvidenceRoot, 'review.final.md'), 'No findings.\n\nVERDICT: PASS\n')
    requireDshReviewPass(join(reviewEvidenceRoot, 'review.final.md'), headTree, headDiffSha256)
    writeFileSync(join(reviewEvidenceRoot, 'review.final.md'), 'P1: blocking finding\n\nVERDICT: PASS\n')
    expectFailure(() => requireDshReviewPass(join(reviewEvidenceRoot, 'review.final.md'), headTree, headDiffSha256), 'DSH Review evidence with a blocking finding')
  } finally {
    rmSync(reviewEvidenceRoot, { recursive: true, force: true })
  }
}

function forbidFields(schema, definitionNames, fields, label) {
  for (const name of definitionNames) {
    const definition = schema.$defs?.[name]
    if (definition === undefined) fail(`protocol schema is missing ${name}`)
    for (const field of fields) {
      if (Object.hasOwn(definition.properties ?? {}, field)) fail(`${label} variant ${name} exposes forbidden field ${field}`)
    }
  }
}

function markdownCapabilityIds(markdown) {
  const ids = []
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
    const statuses = cells.map(cell => cell.replaceAll('*', ''))
    if (!statuses.some(cell => ['bound', 'blocked', 'N/A'].includes(cell))) continue
    if (/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(cells[0])) ids.push(cells[0])
  }
  return ids
}

function compileChannel(ajv, schema, name) {
  const channelSchema = {
    $schema: schema.$schema,
    $defs: schema.$defs,
    $ref: `#/$defs/${name}`,
  }
  return ajv.compile(channelSchema)
}

function expectValid(validate, sample, label) {
  if (!validate(sample)) fail(`${label} must validate: ${JSON.stringify(validate.errors)}`)
}

function expectInvalid(validate, sample, label) {
  if (validate(sample)) fail(`${label} must be rejected`)
}

const maps = Object.fromEntries(yamlNames.map(name => [name, loadYaml(name)]))
JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patch = YAML.parse(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'))
const designStage = maps['capability-bindings.yaml'].implementation_admission?.status !== 'pass'
if (designStage && (!Array.isArray(patch) || patch.length !== 0)) fail('cordis.patch.yml must remain empty before implementation admission')
if (designStage && (existsSync(join(root, 'src')) || existsSync(join(root, 'native')))) fail('src/ and native/ are forbidden before implementation admission')

const resources = maps['resource-map.yaml'].resources ?? []
const resourceIds = unique(resources.map(resource => resource.resource_id), 'resource_id')
for (const relation of [...(maps['resource-map.yaml'].relations ?? []), ...(maps['resource-map.yaml'].forbidden_relations ?? [])]) {
  if (!resourceIds.has(relation.from)) fail(`unknown relation source: ${relation.from}`)
  if (!resourceIds.has(relation.to)) fail(`unknown relation target: ${relation.to}`)
  if (relation.via !== undefined && !resourceIds.has(relation.via)) fail(`unknown relation mediator: ${relation.via}`)
}

const modules = maps['module-registry.yaml'].modules ?? []
const moduleIds = unique(modules.map(module => module.module_id), 'module_id')
const ownedPaths = unique(modules.flatMap(module => module.owned_paths ?? []), 'owned path')
if (ownedPaths.size === 0) fail('module registry declares no owned paths')
for (const edge of maps['module-registry.yaml'].declared_edges ?? []) {
  if (!moduleIds.has(edge.from) || !moduleIds.has(edge.to)) fail(`module edge does not resolve: ${edge.from} -> ${edge.to}`)
}

const nodes = maps['mainline-call-map.yaml'].nodes ?? []
const nodeIds = unique(nodes.map(node => node.node_id), 'mainline node_id')
unique((maps['mainline-call-map.yaml'].edges ?? []).map(edge => edge.edge_id), 'mainline edge_id')
for (const edge of maps['mainline-call-map.yaml'].edges ?? []) {
  if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) fail(`mainline edge does not resolve: ${edge.edge_id}`)
}

const gates = maps['verification-map.yaml'].gates ?? []
const gateIds = unique(gates.map(gate => gate.gate_id), 'gate_id')
const pendingCommandIds = new Set(maps['verification-map.yaml'].pending_commands?.map(command => command.command_id) ?? [])
for (const feature of maps['verification-map.yaml'].features ?? []) {
  for (const field of ['build', 'lint', 'white_box', 'module_black_box', 'project_black_box', 'smoke']) {
    for (const gateId of feature[field] ?? []) {
      if (!gateIds.has(gateId) && !pendingCommandIds.has(gateId)) fail(`${feature.feature_id}.${field} references unknown gate or pending command ${gateId}`)
    }
  }
}
for (const gateId of maps['lifecycle.yaml'].verification_gates ?? []) {
  if (!gateIds.has(gateId)) fail(`lifecycle references unknown gate ${gateId}`)
}
for (const module of modules) {
  for (const gateId of module.verification_gates ?? []) {
    if (!gateIds.has(gateId)) fail(`${module.module_id} references unknown gate ${gateId}`)
  }
}

for (const name of ['function-map.yaml', 'mainline-call-map.yaml', 'verification-map.yaml', 'lifecycle.yaml']) {
  const map = maps[name]
  for (const field of ['resource_map', 'function_map', 'mainline_call_map', 'module_registry', 'verification_map', 'test_design', 'lifecycle', 'projection_window_budget']) {
    if (map[field] !== undefined) requireRelativeFile(architectureDir, map[field], `${name}.${field}`)
  }
}

for (const binding of maps['function-map.yaml'].upstream_bindings ?? []) {
  if (binding.status !== 'bound') continue
  if (!isAbsolute(binding.path)) fail(`${binding.binding_id} bound path must be absolute`)
  const source = readFileSync(binding.path, 'utf8')
  if (binding.symbol !== 'none' && !source.includes(binding.symbol)) fail(`${binding.binding_id} symbol is absent: ${binding.symbol}`)
}
for (const planned of maps['function-map.yaml'].planned_functions ?? []) {
  if (isAbsolute(planned.path)) fail(`${planned.symbol} authored path must remain inside this plugin`)
}

const capabilityMap = maps['capability-bindings.yaml']
const defaults = capabilityMap.binding_defaults ?? {}
const bindings = capabilityMap.bindings ?? []
const capabilityIds = unique(bindings.map(binding => asString(binding.capability_id, 'capability_id')), 'capability_id')
const capabilityGroups = capabilityMap.capability_groups ?? {}
const groupIds = new Map()
for (const groupName of ['host', 'projection', 'n_a']) {
  const ids = unique(capabilityGroups[groupName] ?? [], `${groupName} capability_id`)
  groupIds.set(groupName, ids)
}
const groupedIds = new Set()
for (const [groupName, ids] of groupIds) {
  for (const id of ids) {
    if (!capabilityIds.has(id)) fail(`${groupName} capability group references unknown ${id}`)
    if (groupedIds.has(id)) fail(`capability appears in more than one group: ${id}`)
    groupedIds.add(id)
  }
}
for (const id of capabilityIds) if (!groupedIds.has(id)) fail(`capability is absent from capability_groups: ${id}`)

const artifactVerification = capabilityMap.artifact_verification ?? {}
const cleanInstallEvidence = artifactVerification.clean_install_evidence ?? {}
let cleanRegistryLockfile
const cleanRegistryVerified = capabilityMap.artifact_source === 'clean_registry_install'
  && capabilityMap.artifact_release_status === 'verified'
  && artifactVerification.package_layout === 'node_modules'
  && cleanInstallEvidence.status === 'verified'
  && cleanInstallEvidence.checkout_links_detected === false
if (capabilityMap.artifact_source === 'clean_registry_install') {
  for (const field of ['install_root', 'lockfile_path', 'lockfile_sha256', 'registry_url']) {
    if (typeof cleanInstallEvidence[field] !== 'string' || cleanInstallEvidence[field].length === 0) fail(`clean registry evidence is missing ${field}`)
  }
  if (artifactVerification.package_root !== cleanInstallEvidence.install_root) fail('artifact package_root must equal the verified clean install root')
  const lockfilePath = resolve(root, cleanInstallEvidence.lockfile_path)
  if (sha256(lockfilePath) !== cleanInstallEvidence.lockfile_sha256) fail('clean install lockfile SHA-256 does not match its evidence')
  cleanRegistryLockfile = requireCleanRegistryLockfile(lockfilePath, cleanInstallEvidence.install_root, capabilityMap.dsh_checkout_root)
  if (cleanInstallEvidence.checkout_links_detected !== false) fail('clean registry evidence must prove zero checkout links')
}
const artifactContext = {
  package_layout: artifactVerification.package_layout,
  package_root: artifactVerification.package_root,
  checkout_root: capabilityMap.dsh_checkout_root,
}
const forbiddenClientOwners = /\b(?:ISessions|ISession|SessionFace|IWorkspaces)\b/
const requiredArtifactPackages = new Map()
function recordRequiredPackage(packageName, version) {
  const previous = requiredArtifactPackages.get(packageName)
  if (previous !== undefined && previous !== version) fail(`${packageName} has conflicting required versions ${previous} and ${version}`)
  requiredArtifactPackages.set(packageName, version)
}
for (const row of bindings) {
  if (!['bound', 'blocked', 'n_a'].includes(row.capability_status)) fail(`${row.capability_id} has invalid capability_status`)
  if (row.capability_ids !== undefined) fail(`${row.capability_id} must not use grouped capability_ids`)
  if (row.planned_path !== undefined && isAbsolute(row.planned_path)) fail(`${row.capability_id} planned_path must be plugin-relative`)
  const groupName = [...groupIds].find(([, ids]) => ids.has(row.capability_id))?.[0]
  if (groupName === 'host' && row.capability_status !== 'bound') fail(`${row.capability_id} is a Host capability and must remain bound`)
  if (groupName === 'n_a' && row.capability_status !== 'n_a') fail(`${row.capability_id} is the approved N/A capability`)
  if (groupName === 'projection' && row.capability_status === 'n_a') fail(`${row.capability_id} projection capability cannot be N/A`)
  if (row.capability_status === 'bound') {
    const base = row.binding === undefined ? {} : defaults[row.binding]
    if (row.binding !== undefined && base === undefined) fail(`${row.capability_id} references unknown binding default ${row.binding}`)
    const resolved = { ...base, ...row }
    const requiredFields = groupName === 'host'
      ? ['owner', 'package', 'package_version', 'export_path', 'types_artifact', 'symbol', 'method', 'direction', 'source_path', 'gate']
      : ['owner', 'package', 'package_version', 'export_path', 'types_artifact', 'direction', 'scope', 'planned_path', 'gate']
    for (const field of requiredFields) {
      if (resolved[field] === undefined) fail(`${row.capability_id} bound row is missing ${field}`)
    }
    if (forbiddenClientOwners.test(JSON.stringify(resolved))) fail(`${row.capability_id} uses a forbidden Web client object owner`)
    if (row.blocking_owner !== undefined || row.release_prerequisite !== undefined) fail(`${row.capability_id} bound row retains blocking fields`)
    if (groupName === 'projection') {
      if (row.approval_status !== 'approved' || row.approved_by !== 'Jason') fail(`${row.capability_id} projection disposition is not Jason-approved`)
      if (row.capability_id === 'transcript.tools') {
        const segments = row.owner_segments ?? []
        if (segments.length !== 3) fail('transcript.tools must declare three bound owner segments')
        const segmentNames = unique(segments.map(segment => segment.segment), 'transcript.tools owner segment')
        for (const name of ['intent', 'pairing_topology', 'presentation_model']) {
          if (!segmentNames.has(name)) fail(`transcript.tools is missing ${name} owner segment`)
        }
        for (const segment of segments) {
          for (const field of ['owner', 'package', 'package_version', 'export_path', 'types_artifact', 'symbols']) {
            if (segment[field] === undefined) fail(`transcript.tools ${segment.segment} bound segment is missing ${field}`)
          }
          if (segment.capability_status !== 'bound') fail(`transcript.tools ${segment.segment} must be bound`)
          if (!Array.isArray(segment.symbols) || segment.symbols.length === 0) fail(`transcript.tools ${segment.segment} has no symbols`)
          requireExportedSymbols(artifactContext, { capability_id: `transcript.tools.${segment.segment}`, ...segment }, segment.symbols)
          recordRequiredPackage(segment.package, segment.package_version)
        }
      } else {
        const symbols = row.required_symbols ?? []
        if (symbols.length === 0) fail(`${row.capability_id} bound projection row has no required_symbols`)
        requireExportedSymbols(artifactContext, resolved, symbols)
      }
    } else {
      requireExportedSymbol(artifactContext, resolved)
    }
    recordRequiredPackage(resolved.package, resolved.package_version)
  } else if (row.capability_status === 'blocked') {
    if (groupName !== 'projection') fail(`${row.capability_id} blocked row must belong to the projection group`)
    for (const field of ['approval_status', 'owner', 'package', 'package_version', 'export_path', 'symbol', 'direction', 'scope', 'blocking_owner', 'required_export', 'required_symbols', 'release_prerequisite', 'planned_path', 'gate']) {
      if (row[field] === undefined) fail(`${row.capability_id} blocked row is missing ${field}`)
    }
    if (row.approval_status !== 'approved' || row.approved_by !== 'Jason') fail(`${row.capability_id} blocked disposition is not Jason-approved`)
    if (typeof row.approved_disposition !== 'string' || row.approved_disposition.length === 0) fail(`${row.capability_id} has no approved disposition`)
    if (row.capability_id === 'transcript.tools') {
      const segments = row.owner_segments ?? []
      if (segments.length !== 3) fail('transcript.tools must declare intent, pairing_topology, and presentation_model owner segments')
      const segmentNames = unique(segments.map(segment => segment.segment), 'transcript.tools owner segment')
      for (const name of ['intent', 'pairing_topology', 'presentation_model']) {
        if (!segmentNames.has(name)) fail(`transcript.tools is missing ${name} owner segment`)
      }
      const intent = segments.find(segment => segment.segment === 'intent')
      requireExportedSymbols(artifactContext, { capability_id: 'transcript.tools.intent', ...intent }, intent.symbols)
      recordRequiredPackage(intent.package, intent.package_version)
      for (const segment of segments.filter(candidate => candidate.capability_status === 'blocked')) {
        for (const field of ['owner', 'package', 'package_version', 'required_export', 'required_symbols']) {
          if (segment[field] === undefined) fail(`transcript.tools ${segment.segment} segment is missing ${field}`)
        }
      }
    }
  } else {
    for (const field of ['approval_status', 'approved_by', 'approved_disposition', 'owner', 'direction', 'scope', 'n_a_reason', 'planned_path', 'gate']) {
      if (row[field] === undefined) fail(`${row.capability_id} N/A row is missing ${field}`)
    }
    if (row.approval_status !== 'approved' || row.approved_by !== 'Jason' || row.approved_disposition !== 'n_a') fail(`${row.capability_id} N/A disposition is not Jason-approved`)
    if (row.blocking_owner !== undefined || row.release_prerequisite !== undefined) fail(`${row.capability_id} approved N/A must not retain blocking fields`)
  }
}

if (cleanRegistryVerified) {
  const artifactRows = artifactVerification.release_artifacts ?? []
  const artifactPackages = unique(artifactRows.map(row => row.package), 'release artifact package')
  for (const [packageName, version] of requiredArtifactPackages) {
    if (!artifactPackages.has(packageName)) fail(`clean registry evidence is missing ${packageName}`)
    const artifact = artifactRows.find(row => row.package === packageName)
    if (artifact.version !== version) fail(`${packageName} release evidence has version ${artifact.version}, expected ${version}`)
    if (typeof artifact.integrity !== 'string' || !artifact.integrity.startsWith('sha512-')) fail(`${packageName} release evidence has no registry integrity`)
    if (artifact.registry_url !== cleanInstallEvidence.registry_url) fail(`${packageName} release evidence registry URL does not match the clean install`)
    requireInstalledRegistryPackage(artifactContext, cleanRegistryLockfile, packageName, version, artifact.integrity)
  }
  for (const packageName of artifactPackages) if (!requiredArtifactPackages.has(packageName)) fail(`clean registry evidence has unrequired package ${packageName}`)
}

const expectedOwnerArtifactIdentity = cleanRegistryVerified
  ? `sha256:${createHash('sha256').update(JSON.stringify((artifactVerification.release_artifacts ?? [])
    .map(({ package: packageName, version, integrity, registry_url: registryUrl }) => ({ package: packageName, version, integrity, registry_url: registryUrl }))
    .sort((left, right) => left.package.localeCompare(right.package)))).digest('hex')}`
  : null

const countByGroupAndStatus = (groupName, status) => [...groupIds.get(groupName)].filter(id => bindings.find(row => row.capability_id === id)?.capability_status === status).length
const hostBoundCount = countByGroupAndStatus('host', 'bound')
const projectionBoundCount = countByGroupAndStatus('projection', 'bound')
const approvedNaCount = [...groupIds.get('n_a')].filter(id => {
  const row = bindings.find(candidate => candidate.capability_id === id)
  return row?.capability_status === 'n_a' && row.approval_status === 'approved' && row.approved_by === 'Jason'
}).length
const blockedCount = bindings.filter(row => row.capability_status === 'blocked').length

const implementationAdmission = capabilityMap.implementation_admission
if (implementationAdmission.required_bound_host_capabilities !== groupIds.get('host').size) fail('implementation admission Host count must derive from capability_groups.host')
if (implementationAdmission.required_bound_projection_capabilities !== groupIds.get('projection').size) fail('implementation admission projection count must derive from capability_groups.projection')
if (implementationAdmission.required_approved_n_a_capabilities !== groupIds.get('n_a').size) fail('implementation admission N/A count must derive from capability_groups.n_a')
if (implementationAdmission.required_blocked_capabilities !== 0) fail('implementation admission must require zero blocked capabilities')
if (implementationAdmission.required_artifact_source !== 'clean_registry_install' || implementationAdmission.required_artifact_release_status !== 'verified') fail('implementation admission must require a verified clean registry installation')
if (implementationAdmission.required_design_gate !== 'pass' || implementationAdmission.disposition_approval_status !== 'approved') fail('implementation admission must require design and disposition approval')
if (!['codec', 'runtime'].every(target => implementationAdmission.unlocks?.includes(target))) fail('implementation admission must gate both codec and runtime')
const implementationAdmissionPass = hostBoundCount === implementationAdmission.required_bound_host_capabilities
  && projectionBoundCount === implementationAdmission.required_bound_projection_capabilities
  && approvedNaCount === implementationAdmission.required_approved_n_a_capabilities
  && blockedCount === implementationAdmission.required_blocked_capabilities
  && cleanRegistryVerified
  && implementationAdmission.owner_artifact_verification_status === 'verified'
  && implementationAdmission.owner_artifact_release_identity === expectedOwnerArtifactIdentity
const expectedImplementationStatus = implementationAdmissionPass ? 'pass' : 'blocked'
if (implementationAdmission.status !== expectedImplementationStatus) fail(`implementation admission status must be ${expectedImplementationStatus}`)

const releaseAdmission = capabilityMap.release_admission
if (!['release', 'delivery'].every(target => releaseAdmission.unlocks?.includes(target))) fail('release admission must gate release and delivery')
if (releaseAdmission.reviewed_commit_sha !== undefined) fail('release admission must identify the reviewed tree, not a pre-review commit')
const requiredReleaseStatuses = {
  required_implementation_status: 'complete',
  required_tests_status: 'pass',
  required_build_status: 'pass',
  required_install_status: 'pass',
  required_online_status: 'pass',
  required_dsh_review: 'pass',
  required_git_state: 'committed_and_uploaded',
}
for (const [field, expected] of Object.entries(requiredReleaseStatuses)) {
  if (releaseAdmission[field] !== expected) fail(`release admission ${field} must be ${expected}`)
}
const releaseEvidence = releaseAdmission.evidence ?? {}
const releaseStatusesPass = releaseAdmission.implementation_status === releaseAdmission.required_implementation_status
  && releaseAdmission.tests_status === releaseAdmission.required_tests_status
  && releaseAdmission.build_status === releaseAdmission.required_build_status
  && releaseAdmission.install_status === releaseAdmission.required_install_status
  && releaseAdmission.online_status === releaseAdmission.required_online_status
  && releaseAdmission.dsh_review_status === releaseAdmission.required_dsh_review
  && releaseAdmission.git_state === releaseAdmission.required_git_state
let releaseIdentityMatches = false
if (releaseStatusesPass) {
  for (const field of ['implementation', 'tests', 'build', 'install', 'online']) requireRelativeFile(root, releaseEvidence[field], `release_admission.evidence.${field}`)
  const objectId = gitObjectIdPattern()
  for (const field of ['reviewed_tree_sha', 'uploaded_commit_sha', 'uploaded_tree_sha']) {
    if (typeof releaseAdmission[field] !== 'string' || !objectId.test(releaseAdmission[field])) fail(`release admission ${field} is not a valid repository object ID`)
  }
  if (typeof releaseAdmission.reviewed_diff_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(releaseAdmission.reviewed_diff_sha256)) fail('release admission reviewed_diff_sha256 is not a SHA-256 digest')
  requireDshReviewPass(releaseEvidence.dsh_review, releaseAdmission.reviewed_tree_sha, releaseAdmission.reviewed_diff_sha256)
  releaseIdentityMatches = uploadedCommitIdentityMatches(
    releaseAdmission.uploaded_commit_sha,
    releaseAdmission.reviewed_tree_sha,
    releaseAdmission.uploaded_tree_sha,
    releaseAdmission.reviewed_diff_sha256,
  )
}
const releaseAdmissionPass = implementationAdmissionPass && releaseStatusesPass && releaseIdentityMatches
const expectedReleaseStatus = releaseAdmissionPass ? 'pass' : 'blocked'
if (releaseAdmission.status !== expectedReleaseStatus) fail(`release admission status must be ${expectedReleaseStatus}`)

const markdownIds = markdownCapabilityIds(readFileSync(join(root, 'docs/capability-matrix.md'), 'utf8'))
const markdownCoverage = unique(markdownIds, 'Markdown capability_id')
for (const id of capabilityIds) if (!markdownCoverage.has(id)) fail(`capability matrix is missing ${id}`)
for (const id of markdownCoverage) if (!capabilityIds.has(id)) fail(`capability matrix has unknown ${id}`)

const protocolSchema = JSON.parse(readFileSync(join(architectureDir, 'protocol.schema.json'), 'utf8'))
const ajv = new Ajv2020({ allErrors: true, strict: true })
const projection = compileChannel(ajv, protocolSchema, 'channelBusinessProjection')
const action = compileChannel(ajv, protocolSchema, 'channelBusinessAction')
const hostControl = compileChannel(ajv, protocolSchema, 'channelHostControl')
const childControl = compileChannel(ajv, protocolSchema, 'channelChildControl')
const projectionDefinitions = ['projectionWindow', 'projectionCommit', 'projectionTranscriptPatch', 'projectionViewUpdate']
const actionDefinitions = ['actionSubmit', 'actionCancel', 'actionSession', 'actionQueue', 'actionCommand', 'actionSelection', 'actionInteractionResponse', 'actionSettings']
const controlDefinitions = ['controlHello', 'controlReady', 'controlDeliveryLedgerProjection', 'controlDeliveryLedgerAction', 'controlAckProjection', 'controlAckAction', 'controlRequestResync', 'controlCapacityProjection', 'controlCapacityAction', 'controlShutdown', 'controlFatal']
forbidFields(protocolSchema, projectionDefinitions, ['metadata', 'control', 'routing', 'retry', 'health', 'debug', 'shutdown', 'sequence', 'ack', 'completion', 'snapshot', 'snapshotRevision'], 'BusinessProjection')
forbidFields(protocolSchema, actionDefinitions, ['metadata', 'control', 'routing', 'retry', 'health', 'debug', 'shutdown', 'sequence', 'ack', 'completion', 'snapshot'], 'BusinessAction')
forbidFields(protocolSchema, controlDefinitions, ['transcript', 'prompt', 'attachment', 'tool_result', 'session_projection', 'metadata'], 'control')

const projectionWindow = { protocolVersion: 1, type: 'projection_window', publicationRevision: 1, index: 0, cells: [], views: [] }
const projectionCommit = { protocolVersion: 1, type: 'projection_commit', publicationRevision: 1, totalWindows: 1 }
const submit = { protocolVersion: 1, type: 'submit', actionId: 'a1', sessionId: 's1', text: 'hello', attachments: [], mode: 'queue' }
const cancel = { protocolVersion: 1, type: 'cancel', actionId: 'a2', sessionId: 's1' }
const projectionLedger = { protocolVersion: 1, type: 'delivery_ledger', channel: 'projection', sequence: 1, recordBytes: 17 }
const actionLedger = { protocolVersion: 1, type: 'delivery_ledger', channel: 'action', sequence: 1, recordBytes: 17 }
const hello = { protocolVersion: 1, type: 'hello', hostVersion: '0.0.0', minProtocolVersion: 1, maxProtocolVersion: 1, maxRecordBytes: 8388608, maxQueuedBytes: 16777216 }
const ready = { protocolVersion: 1, type: 'ready', childVersion: '0.0.0', selectedProtocolVersion: 1, target: 'aarch64-apple-darwin' }

for (const [validate, sample, label] of [
  [projection, projectionWindow, 'projection_window'],
  [projection, projectionCommit, 'projection_commit'],
  [action, submit, 'submit'],
  [action, cancel, 'cancel'],
  [hostControl, hello, 'host hello'],
  [hostControl, projectionLedger, 'projection delivery ledger'],
  [childControl, ready, 'child ready'],
  [childControl, actionLedger, 'action delivery ledger'],
]) expectValid(validate, sample, label)

for (const [validate, sample, label] of [
  [projection, submit, 'action on projection channel'],
  [projection, hello, 'control on projection channel'],
  [action, projectionWindow, 'projection on action channel'],
  [action, ready, 'control on action channel'],
  [hostControl, projectionWindow, 'business projection on HostControl'],
  [hostControl, submit, 'business action on HostControl'],
  [hostControl, ready, 'child-only ready on HostControl'],
  [childControl, projectionWindow, 'business projection on ChildControl'],
  [childControl, submit, 'business action on ChildControl'],
  [childControl, hello, 'host-only hello on ChildControl'],
  [hostControl, actionLedger, 'action ledger on HostControl'],
  [childControl, projectionLedger, 'projection ledger on ChildControl'],
  [action, { protocolVersion: 1, type: 'submit', actionId: 'a1' }, 'submit missing required fields'],
  [action, { ...cancel, line: '/quit' }, 'cross-variant action field'],
  [action, { ...submit, snapshot: {} }, 'snapshot control field on business action'],
  [projection, { ...projectionCommit, metadata: {} }, 'unknown projection field'],
  [projection, { ...projectionWindow, snapshot: {} }, 'snapshot control field on business projection'],
  [projection, { ...projectionWindow, type: 'snapshot_window', snapshotRevision: 1 }, 'legacy snapshot window control terminology'],
  [projection, { ...projectionCommit, type: 'snapshot_complete', snapshotRevision: 1 }, 'legacy snapshot complete control terminology'],
  [hostControl, { ...projectionLedger, sequence: 0 }, 'zero ledger sequence'],
  [hostControl, { ...projectionLedger, sequence: 9007199254740992 }, 'unsafe ledger sequence'],
  [action, { ...submit, protocolVersion: 2 }, 'wrong protocol version'],
]) expectInvalid(validate, sample, label)

const projectionWindowBudget = loadYaml('projection-window-budget.yaml')
for (const field of ['max_bytes_per_window', 'max_cells_per_window', 'max_windows_per_publication', 'max_staged_publication_bytes', 'history_window_limit', 'catalog_page_limit']) {
  if (!Number.isSafeInteger(projectionWindowBudget.limits?.[field]) || projectionWindowBudget.limits[field] < 1) fail(`projection window budget missing positive safe integer ${field}`)
}

const plannedPaths = [
  ...(maps['function-map.yaml'].planned_functions ?? []).map(entry => entry.path),
  ...nodes.map(entry => entry.path).filter(path => typeof path === 'string' && !isAbsolute(path)),
]
const modulePathPatterns = modules.flatMap(module => module.owned_paths ?? [])
for (const plannedPath of plannedPaths) {
  const owners = modulePathPatterns.filter(pattern => pattern === plannedPath || (pattern.endsWith('/**') && plannedPath.startsWith(pattern.slice(0, -3))))
  if (owners.length !== 1) fail(`planned path must have exactly one module owner: ${plannedPath}`)
}

const protocol = maps['protocol.yaml']
const channels = protocol.channels ?? []
const stdioIndexes = unique(channels.map(channel => channel.child_stdio_index), 'protocol stdio index')
if (stdioIndexes.size !== 4 || ![3, 4, 5, 6].every(index => stdioIndexes.has(index))) fail('protocol channels must occupy child stdio indexes 3 through 6 exactly once')
if (protocol.channel_location?.raw_handle_environment !== 'forbidden') fail('raw Windows handle environment transfer must remain forbidden')
const expectedSchemaRoots = new Map([
  ['channel.business_projection', '#/$defs/channelBusinessProjection'],
  ['channel.business_action', '#/$defs/channelBusinessAction'],
  ['channel.host_control', '#/$defs/channelHostControl'],
  ['channel.child_control', '#/$defs/channelChildControl'],
])
for (const channel of channels) {
  if (channel.terminal_stream !== false) fail(`${channel.channel_id} must not be a terminal stream`)
  if (channel.schema_ref !== expectedSchemaRoots.get(channel.channel_id)) fail(`${channel.channel_id} has the wrong channel schema root`)
}

runDesignGateSelfTests(capabilityMap.dsh_checkout_root)

console.log(`DESIGN_MAPS: PASS (${hostBoundCount} Host bound, ${projectionBoundCount} projection bound, ${approvedNaCount} approved N/A, ${blockedCount} blocked)`)
console.log(`IMPLEMENTATION_ADMISSION: ${implementationAdmissionPass ? 'PASS' : 'BLOCKED'}`)
console.log(`RELEASE_ADMISSION: ${releaseAdmissionPass ? 'PASS' : 'BLOCKED'}`)
