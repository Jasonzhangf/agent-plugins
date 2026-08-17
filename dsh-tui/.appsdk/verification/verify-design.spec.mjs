import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

// Governance tests live beside the checker; two levels up is the project root.
const projectRoot = resolve(import.meta.dirname, '../..')

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'dsh-tui-design-'))
  const root = join(parent, 'dsh-tui')
  cpSync(projectRoot, root, {
    recursive: true,
    filter: path => !path.includes('/node_modules/') && !path.includes('/.git/'),
  })
  mkdirSync(join(parent, '.github/workflows'), { recursive: true })
  cpSync(join(projectRoot, '../.github/workflows/dsh-tui.yml'), join(parent, '.github/workflows/dsh-tui.yml'))
  return { parent, root }
}

function mutate(root, path, change) {
  const target = join(root, path)
  const value = JSON.parse(readFileSync(target, 'utf8'))
  change(value)
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`)
}

function verify(root) {
  return spawnSync(process.execPath, ['.appsdk/verification/verify-design.mjs'], {
    cwd: root,
    encoding: 'utf8',
  })
}

function withFixture(run) {
  const value = fixture()
  try {
    return run(value.root)
  } finally {
    rmSync(value.parent, { recursive: true, force: true })
  }
}

test('accepts the canonical design contracts', () => {
  execFileSync(process.execPath, ['.appsdk/verification/verify-design.mjs'], { cwd: projectRoot })
})

test('rejects an audit capability without a matching binding', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/official-webui-capability-audit.json', value => {
    value.domains[0].capability_id = 'host.unmapped'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /official audit <-> capability binding coverage/)
}))

test('rejects drift from the pinned official DSH audit commit', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/official-webui-capability-audit.json', value => {
    value.audited_source.commit = '0000000000000000000000000000000000000000'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /official audit DSH commit pin mismatch/)
}))

test('rejects a project module absent from module-registry', () => withFixture(root => {
  mutate(root, '.appsdk/maps/module-registry.json', value => {
    value.modules = value.modules.filter(module => module.module_id !== 'fixture-contract')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /project\.json <-> module-registry module coverage/)
}))

test('rejects a stale lifecycle node', () => withFixture(root => {
  mutate(root, 'contracts/tui/architecture/lifecycle.manifest.json', value => {
    value.nodes[1].node_id = 'TuiInputIn02BusinessAction'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /mainline <-> lifecycle node coverage/)
}))

test('rejects a reference to an undeclared gate', () => withFixture(root => {
  mutate(root, '.appsdk/maps/function-map.json', value => {
    value.functions[0].required_gates.push('gate.does-not-exist')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unknown gate reference/)
}))

test('rejects CI that bypasses the aggregate design gate', () => withFixture(root => {
  const target = join(root, '../.github/workflows/dsh-tui.yml')
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace('pnpm run check', 'pnpm run check:design'))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CI design gate wiring missing aggregate/)
}))

test('rejects transport design without a deterministic endpoint source', () => withFixture(root => {
  const target = join(root, '.appsdk/architecture/transport-contract.md')
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace('environment variable `DSH_WEB_URL`', 'an unspecified environment variable'))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /transport contract missing required clause/)
}))

test('rejects Markdown alignment without the pinned streaming corpus', () => withFixture(root => {
  const target = join(root, '.appsdk/architecture/markdown-conformance.md')
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace('markdown-incremental.client.spec.tsx', 'markdown-unspecified.client.spec.tsx'))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Markdown corpus contract missing required clause/)
}))
