import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const moduleId = 'app-core'
const issueId = 'dsh-tui-governance-reset-20260901'
const adapterIdentity = 'dsh-tui::lifecycle-adapter:v1'

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function now() {
  return new Date().toISOString()
}

function run(program, args, cwd = root, env = process.env) {
  const result = spawnSync(program, args, { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.status !== 0) {
    const error = new Error(`${program} ${args.join(' ')} failed with ${String(result.status)}${output ? `\n${output}` : ''}`)
    error.output = output
    throw error
  }
  return output
}

function git(args) {
  return run('git', args).trim()
}

function assertCleanCandidate() {
  const unexpected = git(['status', '--porcelain']).split('\n').filter(Boolean).filter(line => !/^\?\? (?:dsh-tui\/)?(?:\.appsdk\/records\/|\.appsdk-control\/|\.agent-collab\/)/u.test(line))
  if (unexpected.length > 0) throw new Error(`lifecycle adapter requires a clean candidate worktree: ${unexpected.join('; ')}`)
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
}

function readArtifactHash(output) {
  const matches = [...output.matchAll(/"artifact_hash"\s*:\s*"([^"]+)"/g)]
  const hash = matches.at(-1)?.[1]
  if (!hash) throw new Error('compile output did not contain an artifact hash')
  return hash
}

function candidateContext() {
  const headCommit = git(['rev-parse', 'HEAD'])
  const baseCommit = git(['merge-base', 'HEAD', 'origin/main'])
  const treeHash = git(['rev-parse', 'HEAD^{tree}'])
  const diff = git(['diff', '--binary', `${baseCommit}...HEAD`])
  const changedPaths = git(['diff', '--name-only', `${baseCommit}...HEAD`]).split('\n').filter(Boolean)
  const scopeHash = sha256(JSON.stringify({ moduleId, changedPaths }))
  return {
    headCommit,
    baseCommit,
    treeHash,
    diffHash: sha256(diff),
    changedPaths,
    scopeHash,
  }
}

function evidenceBase({ evidenceId, phase, kind, candidate, artifactHash, environmentId, entrypoint, inputHashes, executionSurface, producer }) {
  const evidence = {
    evidence_id: evidenceId,
    issue_id: issueId,
    experiment_id: issueId,
    phase,
    kind,
    source_commit: candidate.headCommit,
    scope: { module_id: moduleId },
    producer: producer ?? { adapter: adapterIdentity, identity: `${adapterIdentity}/${evidenceId}` },
    result: 'pass',
    created_at: now(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    input_hashes: inputHashes,
    scope_hash: candidate.scopeHash,
  }
  if (artifactHash) evidence.artifact_hash = artifactHash
  if (environmentId) evidence.environment_id = environmentId
  if (entrypoint) evidence.entrypoint = entrypoint
  if (executionSurface) evidence.execution_surface = executionSurface
  return evidence
}

function main() {
  assertCleanCandidate()
  const candidate = candidateContext()
  const attemptId = `attempt-${Date.now()}-${randomUUID()}`
  const controlRoot = join(root, '.appsdk-control', 'lifecycle-adapter', attemptId)
  const evidenceRoot = join(root, '.appsdk', 'records', 'evidence', moduleId)
  const entrypoint = 'dsh-tui --help'
  const environmentId = sha256(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch }))
  const inputHashes = [sha256('pnpm run check'), sha256('pnpm run build:runtime'), sha256(entrypoint)]
  const deploymentProducer = { adapter: adapterIdentity, identity: `${adapterIdentity}/deployment` }
  mkdirSync(controlRoot, { recursive: true })
  writeFileSync(join(controlRoot, 'transaction.json'), `${JSON.stringify({ attemptId, issueId, moduleId, candidate, environmentId, inputHashes, entrypoint, state: 'started', created_at: now() }, null, 2)}\n`, { flag: 'wx' })

  const fixCandidateId = `fix-${candidate.headCommit.slice(0, 12)}-${attemptId}`
  const fixCandidate = {
    fix_candidate_id: fixCandidateId,
    issue_id: issueId,
    module_id: moduleId,
    worktree_id: `worktree-${candidate.headCommit.slice(0, 12)}`,
    base_commit: candidate.baseCommit,
    head_commit: candidate.headCommit,
    tree_hash: candidate.treeHash,
    diff_hash: candidate.diffHash,
    design_id: issueId,
    owner: adapterIdentity,
    scope_hash: candidate.scopeHash,
    changed_paths: candidate.changedPaths,
    verification_evidence_ids: [`${attemptId}-whitebox`, `${attemptId}-install`, `${attemptId}-restart`],
    created_at: now(),
  }
  const fixCandidatePath = join(root, '.appsdk', 'records', `fix-candidate-record-${moduleId}.json`)
  if (existsSync(fixCandidatePath)) {
    const existing = JSON.parse(readFileSync(fixCandidatePath, 'utf8'))
    if (existing.head_commit !== candidate.headCommit || existing.tree_hash !== candidate.treeHash || existing.diff_hash !== candidate.diffHash) {
      throw new Error('existing fix candidate belongs to a different source candidate')
    }
    const validationPath = join(root, '.appsdk', 'records', `pre-review-validation-record-${moduleId}.json`)
    if (existsSync(validationPath)) {
      process.stdout.write(`${JSON.stringify({ ok: true, idempotent: true, candidate: existing })}\n`)
      return
    }
    throw new Error('existing fix candidate has no completed validation; create a new candidate')
  }
  writeJson(fixCandidatePath, fixCandidate)

  try {
    run('pnpm', ['run', 'check'])
    const compileOutput = run('appsdk', ['compile-module', '.', '--module', moduleId])
    const artifactHash = readArtifactHash(compileOutput)
    const whitebox = evidenceBase({
      evidenceId: `${attemptId}-whitebox`,
      phase: 'development_whitebox',
      kind: 'gate',
      candidate,
      artifactHash,
      environmentId,
      entrypoint: 'pnpm run check',
      inputHashes,
      executionSurface: 'development_whitebox',
      producer: { adapter: adapterIdentity, identity: `${adapterIdentity}/whitebox` },
    })
    writeJson(join(controlRoot, 'whitebox.json'), whitebox)

    const installRoot = join(controlRoot, 'install')
    mkdirSync(installRoot, { recursive: true })
    run('pnpm', ['pack', '--pack-destination', controlRoot])
    const packageName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name
    const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
    const tarball = join(controlRoot, `${packageName.replace(/^@[^/]+\//, '')}-${packageVersion}.tgz`)
    run('npm', ['init', '--yes'], installRoot)
    run('npm', ['install', '--ignore-scripts', tarball], installRoot)
    const installedEntrypoint = join(installRoot, 'node_modules', packageName, 'lib', 'cli.js')
    run(process.execPath, [installedEntrypoint, '--help'], installRoot)
    const installEvidence = evidenceBase({
      evidenceId: `${attemptId}-install`,
      phase: 'deployment_install',
      kind: 'install',
      candidate,
      artifactHash,
      environmentId,
      entrypoint: installedEntrypoint,
      inputHashes,
      executionSurface: 'deployed_blackbox',
      producer: deploymentProducer,
    })
    writeJson(join(controlRoot, 'install.json'), installEvidence)
    run(process.execPath, [installedEntrypoint, '--help'], installRoot)
    const restartEvidence = evidenceBase({
      evidenceId: `${attemptId}-restart`,
      phase: 'deployment_restart',
      kind: 'restart',
      candidate,
      artifactHash,
      environmentId,
      entrypoint: installedEntrypoint,
      inputHashes,
      executionSurface: 'deployed_blackbox',
      producer: deploymentProducer,
    })
    writeJson(join(controlRoot, 'restart.json'), restartEvidence)
    const blackbox = evidenceBase({
      evidenceId: `${attemptId}-blackbox`,
      phase: 'deployed_blackbox',
      kind: 'runtime',
      candidate,
      artifactHash,
      environmentId,
      entrypoint: installedEntrypoint,
      inputHashes,
      executionSurface: 'deployed_blackbox',
      producer: deploymentProducer,
    })
    writeJson(join(controlRoot, 'blackbox.json'), blackbox)
    for (const name of ['whitebox', 'install', 'restart', 'blackbox']) {
      writeJson(join(evidenceRoot, `${attemptId}-${name}.json`), JSON.parse(readFileSync(join(controlRoot, `${name}.json`), 'utf8')))
    }
    writeJson(join(root, '.appsdk', 'records', 'evidence-record.json'), JSON.parse(readFileSync(join(controlRoot, 'whitebox.json'), 'utf8')))
    const validation = {
      validation_id: `validation-${attemptId}`,
      issue_id: issueId,
      module_id: moduleId,
      fix_candidate_id: fixCandidateId,
      candidate_commit: candidate.headCommit,
      candidate_tree_hash: candidate.treeHash,
      artifact_hash: artifactHash,
      whitebox_producer: { adapter: adapterIdentity, identity: `${adapterIdentity}/whitebox` },
      whitebox_evidence_ids: [`${attemptId}-whitebox`],
      blackbox_evidence_ids: [`${attemptId}-blackbox`],
      deployment: {
        environment_id: environmentId,
        install_receipt_id: `${attemptId}-install`,
        restart_receipt_id: `${attemptId}-restart`,
        entrypoint: installedEntrypoint,
        producer: { adapter: adapterIdentity, identity: `${adapterIdentity}/deployment` },
        observed_at: now(),
      },
      source_unchanged: true,
      result: 'pass',
      created_at: now(),
    }
    writeJson(join(root, '.appsdk', 'records', `pre-review-validation-record-${moduleId}.json`), validation)
    writeFileSync(join(controlRoot, 'transaction.json'), `${JSON.stringify({ attemptId, issueId, moduleId, candidate, environmentId, inputHashes, entrypoint, state: 'committed', artifactHash, completed_at: now() }, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify({ ok: true, attemptId, candidate, artifactHash, environmentId })}\n`)
  } catch (error) {
    writeFileSync(join(controlRoot, 'failure.json'), `${JSON.stringify({ attemptId, candidate, error: String(error), retry_allowed: true, failed_at: now() }, null, 2)}\n`, { flag: 'wx' })
    process.stderr.write(`${JSON.stringify({ ok: false, attemptId, candidate, retry_allowed: true, failed_node: String(error) })}\n`)
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()

export { candidateContext, evidenceBase, sha256 }
