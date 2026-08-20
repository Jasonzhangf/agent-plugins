import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
    filter: path => !path.endsWith('/node_modules')
      && !path.includes('/node_modules/')
      && !path.endsWith('/.git')
      && !path.includes('/.git/'),
  })
  symlinkSync(join(projectRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
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

test('rejects drift from the pinned Codex TUI audit commit', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/codex-tui-selection-audit.json', value => {
    value.audited_source.commit = '0000000000000000000000000000000000000000'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Codex TUI audit commit pin mismatch/)
}))

test('rejects an unknown capability disposition', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/official-webui-capability-audit.json', value => {
    value.domains[0].tui_disposition = 'typo_selected'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unknown tui_disposition/)
}))

test('rejects a project module absent from module-registry', () => withFixture(root => {
  mutate(root, '.appsdk/maps/module-registry.json', value => {
    value.modules = value.modules.filter(module => module.module_id !== 'fixture-contract')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /project\.json <-> module-registry module coverage/)
}))

test('rejects project ownership absent from module-registry', () => withFixture(root => {
  mutate(root, '.appsdk/project.json', value => {
    value.modules[0].owned_paths.push('unregistered/ownership/**')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /project\.json <-> module-registry owned_paths/)
}))

test('rejects component-registry contract ownership drift', () => withFixture(root => {
  mutate(root, '.appsdk/maps/module-registry.json', value => {
    const module = value.modules.find(item => item.module_id === 'component-registry')
    assert.ok(module)
    module.owned_paths = module.owned_paths.filter(path => path !== 'contracts/tui/component-registry/**')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /project\.json <-> module-registry owned_paths/)
}))

test('rejects a package import map without its governance-build owner', () => withFixture(root => {
  mutate(root, '.appsdk/maps/module-registry.json', value => {
    const module = value.modules.find(item => item.module_id === 'governance-build')
    assert.ok(module)
    module.owned_paths = module.owned_paths.filter(path => path !== 'package.json')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /project\.json <-> module-registry owned_paths/)
}))

test('rejects governance ownership overlap', () => withFixture(root => {
  mutate(root, '.appsdk/maps/module-registry.json', value => {
    const module = value.modules.find(item => item.module_id === 'component-registry')
    assert.ok(module)
    module.owned_paths.push('package.json')
  })
  mutate(root, '.appsdk/project.json', value => {
    const module = value.modules.find(item => item.module_id === 'component-registry')
    assert.ok(module)
    module.owned_paths.push('package.json')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /OVERLAPPING_MODULE_OWNERSHIP/)
}))

test('rejects a stale lifecycle node', () => withFixture(root => {
  mutate(root, 'contracts/tui/architecture/lifecycle.manifest.json', value => {
    value.nodes[1].node_id = 'TuiInputIn02BusinessAction'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /mainline <-> lifecycle node coverage/)
}))

test('rejects a terminal error chain missing from the lifecycle manifest', () => withFixture(root => {
  mutate(root, 'contracts/tui/architecture/lifecycle.manifest.json', value => {
    value.error_chains = []
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /mainline <-> lifecycle error chain coverage/)
}))

test('rejects a resource relation whose endpoint is not registered', () => withFixture(root => {
  mutate(root, '.appsdk/maps/resource-map.json', value => {
    value.required_relations[0].to = 'missing_resource'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /resource relation has unknown target/)
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

test('rejects CI that omits the component-registry contract gate', () => withFixture(root => {
  const target = join(root, '../.github/workflows/dsh-tui.yml')
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '      - run: pnpm run test:component-registry && pnpm run build:component-registry && node --input-type=module -e "import(\'./component-registry.js\')"',
    '      - run: pnpm run test:component-registry',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CI component-registry gate wiring missing/)
}))

test('rejects CI that omits the governance build gate', () => withFixture(root => {
  const target = join(root, '../.github/workflows/dsh-tui.yml')
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace('      - run: pnpm run build:governance\n', ''))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CI governance-build gate wiring missing/)
}))

test('rejects a commit surface that admits generated visual or PTY evidence', () => withFixture(root => {
  const target = join(root, '.gitignore')
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace('/docs/evidence/simulator/*.png\n', ''))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /generated evidence ignore missing/)
}))

test('rejects CI that omits the executable clean-install gate', () => withFixture(root => {
  const target = join(root, '../.github/workflows/dsh-tui.yml')
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace('      - run: pnpm run check:clean-install\n', ''))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CI implementation gate wiring missing required command: pnpm run check:clean-install/)
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

test('rejects a project module whose package scripts are missing', () => withFixture(root => {
  mutate(root, 'package.json', value => {
    delete value.scripts['build:transport']
    delete value.scripts['test:transport']
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /package script build:transport required/)
}))

test('rejects a missing public-export clean-registry manifest', () => withFixture(root => {
  rmSync(join(root, '.appsdk/architecture/public-exports.manifest.json'))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /public-exports\.manifest\.json/)
}))

test('rejects a public-export manifest that regresses to pending after clean install', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/public-exports.manifest.json', value => {
    value.status = 'pending_clean_registry'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must record verified_clean_registry/)
}))

test('rejects a public package dependency that drifts from the selected registry version', () => withFixture(root => {
  mutate(root, 'package.json', value => {
    value.dependencies['@deepseek-ai/dsh-session'] = '0.1.0-rc.7'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /public package dependency must exactly match selected version/)
}))

test('rejects selected public version drift from its recorded npm tag', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/public-exports.manifest.json', value => {
    value.selected_version = '0.1.0-rc.7'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /selected_version must equal the recorded selected tag version/)
}))

test('rejects Markdown corpus fixture-hash drift', () => withFixture(root => {
  mutate(root, 'contracts/tui/fixtures/markdown/provenance.json', value => {
    const fixture = value.files.find(entry => entry.path.includes('/tests/fixtures/markdown-dom/'))
    assert.ok(fixture, 'official markdown fixture must exist')
    fixture.sha256 = '0000000000000000000000000000000000000000000000000000000000000000'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /markdown provenance hash mismatch/)
}))

test('rejects a pending Markdown semantic-token contract', () => withFixture(root => {
  mutate(root, 'contracts/tui/fixtures/markdown/semantic-tokens.json', value => {
    value.status = 'pending_normalization'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /markdown semantic-token contract must be admitted/)
}))

test('rejects missing Markdown semantic-token fixture coverage', () => withFixture(root => {
  mutate(root, 'contracts/tui/fixtures/markdown/semantic-tokens.json', value => {
    delete value.fixtures['task-lists']
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /markdown input <-> semantic-token fixture coverage/)
}))

test('rejects a stale no-runtime gap after runtime implementation begins', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/test-design.json', value => {
    value.known_gaps.push('No runtime source exists yet.')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /runtime source is absent/)
}))

test('rejects a source file absent from module ownership', () => withFixture(root => {
  writeFileSync(join(root, 'scripts/unowned-runtime-gate.mjs'), 'export const unowned = true\n')
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /module owner coverage for scripts\/unowned-runtime-gate\.mjs/)
}))

test('rejects a parsed cross-module import absent from dependency registry', () => withFixture(root => {
  const target = join(root, 'playground/experiments/transport/src/transport.ts')
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, `${value}\nexport type { TuiSessionSnapshot } from '../../session/src/session.ts'\n`)
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /undeclared module edge transport -> session/)
}))

test('rejects an aggregate check that omits type and runtime boundary gates', () => withFixture(root => {
  mutate(root, 'package.json', value => {
    value.scripts.check = 'pnpm run check:design && pnpm run test:design'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /package check must run design, red, type and runtime boundary gates/)
}))
