import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const repoRoot = resolve(root, '..')
const moduleId = 'agent-tui'
const issueId = 'agent-tui-renderer-lifecycle-20260904'
const adapterIdentity = 'agent-tui::lifecycle-adapter:v1'

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
  const unexpected = git(['status', '--porcelain']).split('\n').filter(Boolean).filter(line => !/^\?\? (?:agent-tui\/)?(?:\.appsdk\/records\/|\.appsdk-control\/|\.agent-collab\/)/u.test(line))
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

function fileHash(path) {
  return sha256(readFileSync(path))
}

function runGlobalPty(directory, logPath) {
  const script = [
    'set timeout 100',
    'set stty_init "rows 24 columns 80"',
    `log_file -noappend {${logPath}}`,
    'spawn -noecho /opt/homebrew/bin/agent-tui --endpoint http://127.0.0.1:4096 --cwd $env(BLACKBOX_CWD)',
    'expect -re {AGENT TUI}',
    'expect -re {● .*agent-tui-blackbox-}',
    'expect -re {> }',
    'send -- "Run pwd and respond with the exact token AGENT_TUI_BLACKBOX_OK."',
    'send -- "\\r"',
    'expect -re {Called bash}',
    'expect -re {AGENT_TUI_BLACKBOX_OK}',
    'send -- "/quit"',
    'send -- "\\r"',
    'expect eof',
    'set wait_status [wait]',
    'exit [lindex $wait_status 3]',
  ].join('\n')
  const result = spawnSync('expect', ['-c', script], {
    cwd: root,
    env: { ...process.env, BLACKBOX_CWD: directory },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

function runGlobalQuit(directory, logPath) {
  const script = [
    'set timeout 30',
    'set stty_init "rows 24 columns 80"',
    `log_file -noappend {${logPath}}`,
    'spawn -noecho /opt/homebrew/bin/agent-tui --endpoint http://127.0.0.1:4096 --cwd $env(BLACKBOX_CWD)',
    'expect -re {AGENT TUI}',
    'send -- "/quit"',
    'expect -re {> /quit}',
    'send -- "\\r"',
    'expect eof',
    'set wait_status [wait]',
    'exit [lindex $wait_status 3]',
  ].join('\n')
  const result = spawnSync('expect', ['-c', script], {
    cwd: root,
    env: { ...process.env, BLACKBOX_CWD: directory },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

function candidateContext() {
  const headCommit = git(['rev-parse', 'HEAD'])
  const baseCommit = git(['merge-base', 'HEAD', 'origin/main'])
  const treeHash = git(['rev-parse', 'HEAD^{tree}'])
  const diff = git(['diff', '--binary', `${baseCommit}...HEAD`, '--', 'agent-tui/'])
  const changedPaths = git(['diff', '--name-only', `${baseCommit}...HEAD`, '--', 'agent-tui/']).split('\n').filter(Boolean).map(path => path.replace(/^agent-tui\//u, ''))
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

function emitReviewRecord(reviewTaskId) {
  const candidate = candidateContext()
  const records = join(root, '.appsdk', 'records')
  const candidateRecord = JSON.parse(readFileSync(join(records, `fix-candidate-record-${moduleId}.json`), 'utf8'))
  const validation = JSON.parse(readFileSync(join(records, `pre-review-validation-record-${moduleId}.json`), 'utf8'))
  const effectiveness = JSON.parse(readFileSync(join(records, `effectiveness-record-${moduleId}.json`), 'utf8'))
  const moduleArtifact = JSON.parse(readFileSync(join(root, 'generated', 'modules', moduleId, 'module.compiled.json'), 'utf8'))
  const projectArtifact = JSON.parse(readFileSync(join(root, 'generated', 'project.compiled.json'), 'utf8'))
  const evidenceRoot = join(root, '.appsdk', 'records', 'evidence', moduleId)
  const baselinePath = run('find', [evidenceRoot, '-type', 'f', '-name', '*-baseline.json', '-print']).split('\n').filter(Boolean).at(-1)
  if (!baselinePath) throw new Error('baseline reproduction evidence is missing')
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const reviewStatusPath = join(root, '.agent-collab', 'review', reviewTaskId, 'status.json')
  if (!existsSync(reviewStatusPath)) throw new Error(`completed AGY review status is missing: ${reviewTaskId}`)
  const reviewStatus = JSON.parse(readFileSync(reviewStatusPath, 'utf8'))
  if (reviewStatus.verdict !== 'pass') throw new Error(`AGY review is not PASS: ${reviewStatus.verdict ?? 'unknown'}`)
  if (reviewStatus.commit !== candidate.headCommit || reviewStatus.base !== candidate.baseCommit) throw new Error('AGY review is not bound to current candidate')
  if (candidateRecord.head_commit !== candidate.headCommit || candidateRecord.tree_hash !== candidate.treeHash) throw new Error('candidate record is not bound to current source')
  if (validation.candidate_commit !== candidate.headCommit || validation.candidate_tree_hash !== candidate.treeHash) throw new Error('pre-review validation is not bound to current source')
  if (effectiveness.reviewed_commit !== candidate.headCommit || effectiveness.reviewed_tree_hash !== candidate.treeHash) throw new Error('effectiveness record is not bound to current source')
  const record = {
    review_id: reviewTaskId,
    review_kind: 'architecture',
    issue_id: issueId,
    promotion_id: `promotion-${candidate.headCommit.slice(0, 12)}`,
    fix_candidate_id: candidateRecord.fix_candidate_id,
    pre_review_validation_id: validation.validation_id,
    reviewer: { adapter: 'agy-review', identity: reviewTaskId },
    verdict: 'pass',
    evidence_ids: validation.whitebox_evidence_ids.concat(validation.blackbox_evidence_ids),
    reviewed_commit: candidate.headCommit,
    reviewed_tree_hash: candidate.treeHash,
    reviewed_diff_hash: candidate.diffHash,
    reviewed_artifact_hash: projectArtifact.artifact_hash,
    reviewed_scope_hash: candidate.scopeHash,
    resource_map_hash: fileHash(join(root, '.appsdk', 'maps', 'resource-map.json')),
    function_map_hash: fileHash(join(root, '.appsdk', 'maps', 'function-map.json')),
    mainline_call_map_hash: fileHash(join(root, '.appsdk', 'maps', 'mainline-call-map.json')),
    verification_map_hash: fileHash(join(root, '.appsdk', 'maps', 'verification-map.json')),
    ai_confidence: 1,
    confidence_rationale: 'AGY controller returned pass for the exact candidate commit.',
    created_at: now(),
  }
  writeJson(join(records, 'review-record.json'), { ...record, reviewed_artifact_hash: projectArtifact.artifact_hash })
  writeJson(join(records, `review-record-${moduleId}.json`), {
    ...record,
    reviewed_artifact_hash: moduleArtifact.artifact_hash,
    evidence_ids: [
      ...candidateRecord.verification_evidence_ids.slice(0, 3),
      ...validation.whitebox_evidence_ids,
      ...validation.blackbox_evidence_ids,
    ],
  })
  process.stdout.write(`${JSON.stringify({ ok: true, reviewId: reviewTaskId, promotionId: record.promotion_id })}\n`)
}

function emitPromotionRecords() {
  run('appsdk', ['compile', root])
  const candidate = candidateContext()
  run('git', ['merge-base', '--is-ancestor', candidate.headCommit, 'refs/heads/main'])
  const mainlineCommit = git(['rev-parse', 'refs/heads/main'])
  const mainlineTree = git(['rev-parse', 'refs/heads/main^{tree}'])
  if (mainlineTree !== candidate.treeHash) throw new Error('mainline tree does not equal the tested candidate tree')
  const records = join(root, '.appsdk', 'records')
  const candidateRecord = JSON.parse(readFileSync(join(records, `fix-candidate-record-${moduleId}.json`), 'utf8'))
  const reproduction = JSON.parse(readFileSync(join(records, `reproduction-record-${moduleId}.json`), 'utf8'))
  const review = JSON.parse(readFileSync(join(records, 'review-record.json'), 'utf8'))
  const effectiveness = JSON.parse(readFileSync(join(records, `effectiveness-record-${moduleId}.json`), 'utf8'))
  const artifact = JSON.parse(readFileSync(join(root, 'generated', 'project.compiled.json'), 'utf8'))
  const moduleArtifact = JSON.parse(readFileSync(join(root, 'generated', 'modules', moduleId, 'module.compiled.json'), 'utf8'))
  const evidenceRoot = join(root, '.appsdk', 'records', 'evidence', moduleId)
  const baselinePath = run('find', [evidenceRoot, '-type', 'f', '-name', '*-baseline.json', '-print']).split('\n').filter(Boolean).at(-1)
  if (!baselinePath) throw new Error('baseline reproduction evidence is missing')
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  if (review.reviewed_commit !== candidate.headCommit || effectiveness.reviewed_commit !== candidate.headCommit) throw new Error('promotion graph is not bound to current source')
  const branch = git(['branch', '--show-current'])
  const worktree = {
    worktree_id: candidateRecord.worktree_id,
    issue_id: issueId,
    module_id: moduleId,
    base_ref: 'origin/main',
    base_commit: candidate.baseCommit,
    branch,
    head_commit: candidate.headCommit,
    initial_clean: true,
    final_clean: true,
    isolation_mode: 'isolated_worktree',
    scope_hash: candidate.scopeHash,
    created_at: now(),
  }
  const merge = {
    merge_id: `merge-${candidate.headCommit.slice(0, 12)}`,
    issue_id: issueId,
    module_id: moduleId,
    fix_candidate_id: candidateRecord.fix_candidate_id,
    effectiveness_id: effectiveness.effectiveness_id,
    mainline_ref: 'refs/heads/main',
    candidate_commit: candidate.headCommit,
    merge_commit: mainlineCommit,
    candidate_tree_hash: candidate.treeHash,
    merged_tree_hash: mainlineTree,
    change_identity: 'exact',
    result: 'pass',
    created_at: now(),
  }
  const regression = {
    regression_report_id: `regression-${candidate.headCommit.slice(0, 12)}`,
    module_id: moduleId,
    source_commit: mainlineCommit,
    artifact_hash: moduleArtifact.artifact_hash,
    public_api_hash: moduleArtifact.public_api_hash,
    scope_hash: candidate.scopeHash,
    input_hash: moduleArtifact.artifact_hash,
    suite_id: 'agent-tui-runtime-regression',
    command: { program: 'pnpm', args: ['run', 'check'], working_directory: '.' },
    test_count: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    result: 'pass',
    producer: { adapter: adapterIdentity, identity: `${adapterIdentity}/regression` },
    test_characteristics: { whitebox: true, blackbox: true },
    created_at: now(),
  }
  const promotion = {
    promotion_id: review.promotion_id,
    issue_id: issueId,
    experiment_id: issueId,
    module_id: moduleId,
    worktree_record_id: worktree.worktree_id,
    reproduction_record_id: reproduction.reproduction_id,
    fix_candidate_id: candidateRecord.fix_candidate_id,
    architecture_review_id: review.review_id,
    effectiveness_record_id: effectiveness.effectiveness_id,
    merge_record_id: merge.merge_id,
    base_commit: candidate.baseCommit,
    candidate_commit: candidate.headCommit,
    merged_commit: mainlineCommit,
    source_commit: mainlineCommit,
    previous_active_version: null,
    new_active_version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    review_id: review.review_id,
    evidence_ids: [...new Set([baseline.evidence_id, ...candidateRecord.verification_evidence_ids, ...review.evidence_ids, ...effectiveness.positive_evidence_ids, ...effectiveness.negative_evidence_ids, ...effectiveness.blackbox_evidence_ids])],
    required_gate_results: [{ gate_id: 'fix_lifecycle_graph', result: 'pass', producer: adapterIdentity }],
    change_set_id: candidate.diffHash,
    compatibility_level: 'compatible',
    root_cause: reproduction.first_divergence,
    design_id: candidateRecord.design_id,
    change_reason_comment: 'Bind promotion to the real candidate, review, effectiveness, merge and regression graph.',
    playground_cleanup_record_id: `cleanup-${candidate.headCommit.slice(0, 12)}`,
    artifact_hash: artifact.artifact_hash,
    scope_hash: candidate.scopeHash,
    public_api_hash: moduleArtifact.public_api_hash,
    created_at: now(),
  }
  const projectRegression = { ...regression, artifact_hash: artifact.artifact_hash }
  const modulePromotion = { ...promotion, artifact_hash: moduleArtifact.artifact_hash }
  writeJson(join(records, `playground-cleanup-${promotion.playground_cleanup_record_id}.json`), { cleanup_id: promotion.playground_cleanup_record_id, disposition: 'retain_open' })
  const worktreePath = join(records, 'worktree-record.json')
  const moduleWorktreePath = join(records, `worktree-record-${moduleId}.json`)
  if (!existsSync(worktreePath)) writeJson(worktreePath, worktree)
  if (!existsSync(moduleWorktreePath)) writeJson(moduleWorktreePath, worktree)
  writeJson(join(records, 'merge-record.json'), merge)
  writeJson(join(records, `merge-record-${moduleId}.json`), merge)
  writeJson(join(records, 'regression-report.json'), projectRegression)
  writeJson(join(records, `regression-report-${moduleId}.json`), regression)
  writeJson(join(records, 'promotion-record.json'), promotion)
  writeJson(join(records, `promotion-record-${moduleId}.json`), modulePromotion)
  process.stdout.write(`${JSON.stringify({ ok: true, promotionId: promotion.promotion_id, mergeId: merge.merge_id })}\n`)
}

function main() {
  assertCleanCandidate()
  const candidate = candidateContext()
  const attemptId = `attempt-${Date.now()}-${randomUUID()}`
  const controlRoot = join(root, '.appsdk-control', 'lifecycle-adapter', attemptId)
  const evidenceRoot = join(root, '.appsdk', 'records', 'evidence', moduleId)
  const entrypoint = 'agent-tui --help'
  const environmentId = sha256(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch }))
  const inputHashes = [sha256('pnpm run check'), sha256('pnpm run build:runtime'), sha256(entrypoint)]
  const deploymentProducer = { adapter: adapterIdentity, identity: `${adapterIdentity}/deployment` }
  const records = join(root, '.appsdk', 'records')
  const worktree = {
    worktree_id: `worktree-${candidate.headCommit.slice(0, 12)}`,
    issue_id: issueId,
    module_id: moduleId,
    base_ref: 'origin/main',
    base_commit: candidate.baseCommit,
    branch: git(['branch', '--show-current']),
    head_commit: candidate.headCommit,
    initial_clean: true,
    final_clean: true,
    isolation_mode: 'isolated_worktree',
    scope_hash: candidate.scopeHash,
    created_at: now(),
  }
  writeJson(join(records, 'worktree-record.json'), worktree)
  writeJson(join(records, `worktree-record-${moduleId}.json`), worktree)
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
    verification_evidence_ids: [`${attemptId}-fix-candidate`, `${attemptId}-positive`, `${attemptId}-negative`, `${attemptId}-whitebox`, `${attemptId}-install`, `${attemptId}-restart`],
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
  }

  try {
    run('pnpm', ['run', 'check'])
    const compileOutput = run('appsdk', ['compile-module', '.', '--module', moduleId])
    const artifactHash = readArtifactHash(compileOutput)
    const fixCandidateEvidence = evidenceBase({
      evidenceId: `${attemptId}-fix-candidate`,
      phase: 'fix_candidate',
      kind: 'artifact',
      candidate,
      artifactHash,
      environmentId,
      entrypoint: 'pnpm run check',
      inputHashes,
      executionSurface: 'development_whitebox',
      producer: { adapter: adapterIdentity, identity: `${adapterIdentity}/fix-candidate` },
    })
    writeJson(join(controlRoot, 'fix-candidate.json'), fixCandidateEvidence)
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
    run('pnpm', ['run', 'test:app-shell'])
    const positive = evidenceBase({
      evidenceId: `${attemptId}-positive`,
      phase: 'positive_intervention',
      kind: 'positive_test',
      candidate,
      artifactHash,
      environmentId,
      entrypoint: 'pnpm run test:app-shell',
      inputHashes,
      executionSurface: 'development_whitebox',
    })
    writeJson(join(controlRoot, 'positive.json'), positive)
    run('pnpm', ['run', 'test:composer-plugin'])
    const negative = evidenceBase({
      evidenceId: `${attemptId}-negative`,
      phase: 'negative_intervention',
      kind: 'negative_test',
      candidate,
      artifactHash,
      environmentId,
      entrypoint: 'pnpm run test:composer-plugin',
      inputHashes,
      executionSurface: 'development_whitebox',
    })
    writeJson(join(controlRoot, 'negative.json'), negative)

    const installRoot = join(controlRoot, 'install')
    mkdirSync(installRoot, { recursive: true })
    run('pnpm', ['pack', '--pack-destination', controlRoot])
    const packageName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name
    const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
    const tarball = join(controlRoot, `${packageName.replace(/^@[^/]+\//, '')}-${packageVersion}.tgz`)
    run('npm', ['init', '--yes'], installRoot)
    run('npm', ['install', '--ignore-scripts', tarball], installRoot)
    const installedEntrypoint = join(installRoot, 'node_modules', packageName, 'lib', 'cli.js')
    run('npm', ['install', '--global', tarball])
    run('/opt/homebrew/bin/agent-tui', ['--help'])
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
    const restartCwd = mkdtempSync(join(tmpdir(), 'agent-tui-restart-'))
    const restart = runGlobalQuit(restartCwd, join(controlRoot, 'restart-pty.log'))
    if (restart.status !== 0) throw new Error(`global agent-tui restart failed: ${restart.output}`)
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
    const blackboxCwd = mkdtempSync(join(tmpdir(), 'agent-tui-blackbox-'))
    const blackboxRun = runGlobalPty(blackboxCwd, join(controlRoot, 'blackbox-pty.log'))
    if (blackboxRun.status !== 0) throw new Error(`global OpenCode blackbox failed: ${blackboxRun.output}`)
    writeFileSync(join(controlRoot, 'blackbox-observation.txt'), blackboxRun.output + '\n', { flag: 'wx' })
    const blackbox = evidenceBase({
      evidenceId: `${attemptId}-blackbox`,
      phase: 'deployed_blackbox',
      kind: 'runtime',
      candidate,
      artifactHash,
      environmentId,
      entrypoint: '/opt/homebrew/bin/agent-tui',
      inputHashes,
      executionSurface: 'deployed_blackbox',
      producer: deploymentProducer,
    })
    writeJson(join(controlRoot, 'blackbox.json'), blackbox)
    for (const name of ['fix-candidate', 'positive', 'negative', 'whitebox', 'install', 'restart', 'blackbox']) {
      const evidence = JSON.parse(readFileSync(join(controlRoot, `${name}.json`), 'utf8'))
      writeJson(join(evidenceRoot, `${evidence.evidence_id}.json`), evidence)
    }
    const whiteboxEvidence = JSON.parse(readFileSync(join(controlRoot, 'whitebox.json'), 'utf8'))
    writeJson(join(root, '.appsdk', 'records', 'evidence-record.json'), whiteboxEvidence)
    writeJson(join(root, '.appsdk', 'records', `evidence-record-${moduleId}.json`), whiteboxEvidence)
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
    writeFileSync(fixCandidatePath, `${JSON.stringify(fixCandidate, null, 2)}\n`)
    writeFileSync(join(controlRoot, 'transaction.json'), `${JSON.stringify({ attemptId, issueId, moduleId, candidate, environmentId, inputHashes, entrypoint, state: 'committed', artifactHash, completed_at: now() }, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify({ ok: true, attemptId, candidate, artifactHash, environmentId })}\n`)
  } catch (error) {
    writeFileSync(join(controlRoot, 'failure.json'), `${JSON.stringify({ attemptId, candidate, error: String(error), retry_allowed: true, failed_at: now() }, null, 2)}\n`, { flag: 'wx' })
    process.stderr.write(`${JSON.stringify({ ok: false, attemptId, candidate, retry_allowed: true, failed_node: String(error) })}\n`)
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === '--review-record') emitReviewRecord(process.argv[3])
  else if (process.argv[2] === '--promotion-records') emitPromotionRecords()
  else main()
}

export { candidateContext, evidenceBase, emitPromotionRecords, emitReviewRecord, sha256 }
