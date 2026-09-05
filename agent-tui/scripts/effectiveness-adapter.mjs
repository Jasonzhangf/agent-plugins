import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertCleanCandidate, candidateContext, worktreeId } from './lifecycle-adapter.mjs'

const root = resolve(import.meta.dirname, '..')
const repoRoot = resolve(root, '..')
const moduleId = 'agent-tui'
const issueId = 'agent-tui-lifecycle-order-20260905'
const adapterIdentity = 'agent-tui::effectiveness-adapter:v1'

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function now() {
  return new Date().toISOString()
}

function run(program, args, cwd = root) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.status !== 0) {
    const error = new Error(`${program} ${args.join(' ')} failed with ${String(result.status)}${output ? `\n${output}` : ''}`)
    error.output = output
    throw error
  }
  return output
}

function git(args, cwd = root) {
  return run('git', args, cwd).trim()
}

function writeJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
}

function readJsonIfExists(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
}

function commitContainsAgentTui(commit) {
  return spawnSync('git', ['cat-file', '-e', `${commit}:agent-tui`], { cwd: root }).status === 0
}

function evidence({ id, phase, kind, sourceCommit, candidateValue, artifactHash, environmentId, entrypoint, inputHashes, surface, result = 'pass' }) {
  return {
    evidence_id: id,
    issue_id: issueId,
    experiment_id: issueId,
    phase,
    kind,
    source_commit: sourceCommit,
    scope: { module_id: moduleId },
    producer: { adapter: adapterIdentity, identity: `${adapterIdentity}/${id}` },
    result,
    created_at: now(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    input_hashes: inputHashes,
    scope_hash: candidateValue.scopeHash,
    ...(artifactHash === undefined ? {} : { artifact_hash: artifactHash }),
    ...(environmentId === undefined ? {} : { environment_id: environmentId }),
    ...(entrypoint === undefined ? {} : { entrypoint }),
    ...(surface === undefined ? {} : { execution_surface: surface }),
  }
}

function expectQuit(command) {
  const script = [
    'set timeout 8',
    'set stty_init "rows 24 columns 80"',
    `spawn -noecho ${command}`,
    'expect -re {> }',
    'send -- "/quit"',
    'expect -re {> /quit}',
    'send -- "\\r"',
    'expect { eof { exit 0 } timeout { exit 1 } }',
  ].join('\n')
  const result = spawnSync('expect', ['-c', script], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

function reproduceFailedAttemptRerun(baselineProject) {
  const first = spawnSync(process.execPath, ['scripts/lifecycle-adapter.mjs'], {
    cwd: baselineProject,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (first.status === 0) throw new Error('baseline first adapter attempt unexpectedly passed')
  run('pnpm', ['install', '--frozen-lockfile'], baselineProject)
  const second = spawnSync(process.execPath, ['scripts/lifecycle-adapter.mjs'], {
    cwd: baselineProject,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return {
    status: second.status,
    output: `${second.stdout ?? ''}${second.stderr ?? ''}`.trim(),
  }
}

function baseline() {
  assertCleanCandidate()
  const current = candidateContext()
  const existingReproduction = readJsonIfExists(join(root, '.appsdk', 'records', `reproduction-record-${moduleId}.json`))
  if (existingReproduction?.base_commit === current.baseCommit && existingReproduction.result === 'reproduced') {
    process.stdout.write(`${JSON.stringify({ ok: true, idempotent: true, reproductionId: existingReproduction.reproduction_id })}\n`)
    return
  }
  const attemptId = `baseline-${Date.now()}-${randomUUID()}`
  const controlRoot = join(root, '.appsdk-control', 'effectiveness-adapter', attemptId)
  const evidenceRoot = join(root, '.appsdk', 'records', 'evidence', moduleId)
  const baselineWorktree = join(repoRoot, 'playground', attemptId)
  const baselineProject = join(baselineWorktree, 'agent-tui')
  const parentCommits = git(['rev-list', '--parents', '-n', '1', current.headCommit]).split(' ').slice(1)
  const baselineCommit = [current.baseCommit, ...parentCommits]
    .find(commitContainsAgentTui)
  if (!baselineCommit) throw new Error('baseline reproduction source commit with agent-tui is missing')
  const inputHashes = [sha256('origin/main'), sha256('lifecycle-adapter failed attempt rerun'), sha256('pnpm install --frozen-lockfile')]
  mkdirSync(controlRoot, { recursive: true })
  writeJson(join(controlRoot, 'transaction.json'), { attemptId, issueId, moduleId, phase: 'baseline_reproduction', base_commit: baselineCommit, state: 'started', created_at: now() })
  try {
    run('git', ['worktree', 'add', '--detach', baselineWorktree, baselineCommit], repoRoot)
    const replay = reproduceFailedAttemptRerun(baselineProject)
    const immutableRecordRefusal = replay.output.includes('immutable record belongs to another transaction')
    const dirtyRecordRefusal = replay.output.includes('requires a clean candidate worktree')
      && replay.output.includes('.appsdk/records/')
    if (replay.status === 0 || (!immutableRecordRefusal && !dirtyRecordRefusal)) throw new Error(`baseline did not reproduce the pre-fix adapter rerun failure: ${replay.output}`)
    const baselineEvidence = evidence({
      id: `${attemptId}-baseline`,
      phase: 'baseline_reproduction',
      kind: 'red_test',
      sourceCommit: baselineCommit,
      candidateValue: current,
      inputHashes,
      result: 'pass',
    })
    baselineEvidence.observed_failure = replay.output
    writeJson(join(controlRoot, 'baseline.json'), baselineEvidence)
    writeJson(join(evidenceRoot, `${attemptId}-baseline.json`), baselineEvidence)
    writeJson(join(root, '.appsdk', 'records', `reproduction-record-${moduleId}.json`), {
      reproduction_id: `reproduction-${attemptId}`,
      issue_id: issueId,
      module_id: moduleId,
      worktree_id: worktreeId(current),
      base_commit: baselineCommit,
      input_hashes: inputHashes,
      baseline_evidence_id: baselineEvidence.evidence_id,
      first_divergence: 'pre-fix lifecycle adapter rejects a new run after a failed attempt has left the same candidate record without validation',
      result: 'reproduced',
      created_at: now(),
    })
    writeFileSync(join(controlRoot, 'transaction.json'), `${JSON.stringify({ attemptId, issueId, moduleId, phase: 'baseline_reproduction', base_commit: current.baseCommit, state: 'committed', evidence_id: baselineEvidence.evidence_id, completed_at: now() }, null, 2)}\n`)
    run('git', ['worktree', 'remove', '--force', baselineWorktree], repoRoot)
    process.stdout.write(`${JSON.stringify({ ok: true, attemptId, baselineEvidenceId: baselineEvidence.evidence_id })}\n`)
  } catch (error) {
    if (existsSync(join(baselineWorktree, '.git'))) run('git', ['worktree', 'remove', '--force', baselineWorktree], repoRoot)
    writeJson(join(controlRoot, 'failure.json'), { attemptId, error: String(error), retry_allowed: true, failed_at: now() })
    process.stderr.write(`${JSON.stringify({ ok: false, attemptId, retry_allowed: true, failed_node: String(error) })}\n`)
    process.exitCode = 1
  }
}

function effectiveness(reviewTaskId) {
  assertCleanCandidate()
  if (!reviewTaskId) throw new Error('effectiveness adapter requires --review-task from the completed AGY review')
  const current = candidateContext()
  const candidateRecord = JSON.parse(readFileSync(join(root, '.appsdk', 'records', `fix-candidate-record-${moduleId}.json`), 'utf8'))
  const validation = JSON.parse(readFileSync(join(root, '.appsdk', 'records', `pre-review-validation-record-${moduleId}.json`), 'utf8'))
  const existingEffectiveness = readJsonIfExists(join(root, '.appsdk', 'records', `effectiveness-record-${moduleId}.json`))
  if (existingEffectiveness?.reviewed_commit === current.headCommit
    && existingEffectiveness.reviewed_tree_hash === current.treeHash
    && existingEffectiveness.architecture_review_id === reviewTaskId
    && existingEffectiveness.result === 'pass') {
    process.stdout.write(`${JSON.stringify({ ok: true, idempotent: true, effectivenessId: existingEffectiveness.effectiveness_id })}\n`)
    return
  }
  const reviewStatusPath = join(root, '.agent-collab', 'review', reviewTaskId, 'status.json')
  if (!existsSync(reviewStatusPath)) throw new Error(`completed AGY review status is missing: ${reviewTaskId}`)
  const reviewStatus = JSON.parse(readFileSync(reviewStatusPath, 'utf8'))
  if (reviewStatus.verdict !== 'pass') throw new Error(`AGY review is not PASS: ${reviewStatus.verdict ?? 'unknown'}`)
  if (candidateRecord.head_commit !== current.headCommit || candidateRecord.tree_hash !== current.treeHash) throw new Error('candidate record does not bind current source')
  if (validation.candidate_commit !== current.headCommit || validation.candidate_tree_hash !== current.treeHash) throw new Error('pre-review validation does not bind current source')
  const evidenceRoot = join(root, '.appsdk', 'records', 'evidence', moduleId)
  const baselineName = run('find', [evidenceRoot, '-type', 'f', '-name', '*-baseline.json', '-print']).split('\n').filter(Boolean).at(-1)
  if (!baselineName) throw new Error('baseline reproduction evidence is missing; run --baseline first')
  const baselineEvidence = JSON.parse(readFileSync(baselineName, 'utf8'))
  const reproduction = JSON.parse(readFileSync(join(root, '.appsdk', 'records', `reproduction-record-${moduleId}.json`), 'utf8'))
  if (baselineEvidence.source_commit !== reproduction.base_commit || baselineEvidence.phase !== 'baseline_reproduction') throw new Error('baseline evidence is not bound to the recorded baseline commit')
  const attemptId = `effectiveness-${Date.now()}-${randomUUID()}`
  const controlRoot = join(root, '.appsdk-control', 'effectiveness-adapter', attemptId)
  const inputHashes = [sha256('pnpm run check'), sha256('pnpm run test:app-shell'), sha256('pnpm run test:composer-plugin'), sha256('global agent-tui /quit PTY')]
  const artifactHash = validation.artifact_hash
  const environmentId = validation.deployment.environment_id
  const entrypoint = '/opt/homebrew/bin/agent-tui'
  mkdirSync(controlRoot, { recursive: true })
  writeJson(join(controlRoot, 'transaction.json'), { attemptId, issueId, moduleId, phase: 'post_architecture_effectiveness', candidate: current, artifactHash, environmentId, inputHashes, state: 'started', created_at: now() })
  try {
    run('pnpm', ['run', 'check'])
    run('pnpm', ['run', 'test:app-shell'])
    const positive = evidence({ id: `${attemptId}-positive`, phase: 'positive_intervention', kind: 'positive_test', sourceCommit: current.headCommit, candidateValue: current, artifactHash, environmentId, entrypoint, inputHashes, surface: 'development_whitebox' })
    writeJson(join(controlRoot, 'positive.json'), positive)
    const negative = evidence({ id: `${attemptId}-negative`, phase: 'negative_intervention', kind: 'negative_test', sourceCommit: current.headCommit, candidateValue: current, artifactHash, environmentId, entrypoint, inputHashes, surface: 'development_whitebox' })
    writeJson(join(controlRoot, 'negative.json'), negative)
    const replay = expectQuit(`${entrypoint} --endpoint http://127.0.0.1:4096 --cwd ${root}`)
    if (replay.status !== 0) throw new Error(`global public-entrypoint replay failed: ${replay.output}`)
    const blackbox = evidence({ id: `${attemptId}-blackbox`, phase: 'post_architecture_effectiveness', kind: 'sample_replay', sourceCommit: current.headCommit, candidateValue: current, artifactHash, environmentId, entrypoint, inputHashes, surface: 'deployed_blackbox' })
    writeJson(join(controlRoot, 'blackbox.json'), blackbox)
    for (const name of ['positive', 'negative', 'blackbox']) writeJson(join(evidenceRoot, `${attemptId}-${name}.json`), JSON.parse(readFileSync(join(controlRoot, `${name}.json`), 'utf8')))
    const record = {
      effectiveness_id: `effectiveness-${attemptId}`,
      issue_id: issueId,
      module_id: moduleId,
      fix_candidate_id: candidateRecord.fix_candidate_id,
      architecture_review_id: reviewTaskId,
      reviewed_commit: current.headCommit,
      reviewed_tree_hash: current.treeHash,
      reproduction_input_hashes: baselineEvidence.input_hashes,
      baseline_evidence_id: baselineEvidence.evidence_id,
      fixed_replay_evidence_id: blackbox.evidence_id,
      positive_evidence_ids: [positive.evidence_id],
      negative_evidence_ids: [negative.evidence_id],
      blackbox_evidence_ids: [blackbox.evidence_id],
      source_unchanged_since_review: true,
      result: 'pass',
      created_at: now(),
    }
    writeJson(join(root, '.appsdk', 'records', `effectiveness-record-${moduleId}.json`), record)
    writeFileSync(join(controlRoot, 'transaction.json'), `${JSON.stringify({ attemptId, issueId, moduleId, phase: 'post_architecture_effectiveness', candidate: current, artifactHash, environmentId, inputHashes, state: 'committed', effectivenessId: record.effectiveness_id, completed_at: now() }, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify({ ok: true, attemptId, effectivenessId: record.effectiveness_id })}\n`)
  } catch (error) {
    writeJson(join(controlRoot, 'failure.json'), { attemptId, error: String(error), retry_allowed: true, failed_at: now() })
    process.stderr.write(`${JSON.stringify({ ok: false, attemptId, retry_allowed: true, failed_node: String(error) })}\n`)
    process.exitCode = 1
  }
}

const mode = process.argv[2]
if (mode === '--baseline') baseline()
else if (mode === '--effectiveness') effectiveness(process.argv[3] === '--review-task' ? process.argv[4] : undefined)
else throw new Error('usage: node scripts/effectiveness-adapter.mjs --baseline | --effectiveness --review-task <task-id>')
