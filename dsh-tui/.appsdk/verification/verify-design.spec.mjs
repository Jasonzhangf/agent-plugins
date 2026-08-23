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

test('rejects project dependency missing a declared module import edge', () => withFixture(root => {
  mutate(root, '.appsdk/project.json', value => {
    const module = value.modules.find(item => item.module_id === 'app-shell')
    assert.ok(module)
    module.dependency_modules = module.dependency_modules.filter(item => item !== 'chrome-controls')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /app-shell: project\.json dependency_modules <-> module-registry import_edges/)
}))

test('rejects app-container claiming chrome symbols on its mainline edge', () => withFixture(root => {
  mutate(root, '.appsdk/maps/mainline-call-map.json', value => {
    const edge = value.edges.find(item =>
      item.from === 'TuiOutputIn05InkTreeComposed' && item.to === 'TuiOutputIn06AppContainerFrame')
    assert.ok(edge)
    edge.entry_symbols.push('TuiChromeSlotRegistry')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /app-container mainline edge cannot claim chrome-controls symbols/)
}))

test('rejects activating pure-carrier gate against v3 layout assembly', () => withFixture(root => {
  mutate(root, '.appsdk/maps/verification-map.json', value => {
    const gate = value.gates.find(item => item.gate_id === 'terminal_lifecycle_pure_carrier')
    assert.ok(gate)
    gate.status = 'active'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /layout_branch/)
  assert.match(result.stderr, /slot_placement_reconstruction/)
  assert.match(result.stderr, /fixed_region_assembler/)
  assert.match(result.stderr, /fixed_row_budget/)
  assert.match(result.stderr, /composition_callback/)
  assert.match(result.stderr, /legacy_presentation_contract/)
  assert.match(result.stderr, /initial_viewport_default/)
}))

test('rejects a v4 shortcut around app-container', () => withFixture(root => {
  mutate(root, '.appsdk/maps/mainline-call-map.json', value => {
    const lifecycle = value.target_lifecycles.find(item => item.lifecycle_id === 'dsh-tui-v4')
    assert.ok(lifecycle)
    lifecycle.edges.push({
      from: 'TuiExecutableOutputIn05ClosedRegionLeaves',
      to: 'TuiExecutableOutputIn07GenericPrimitiveRealized',
      status: 'pending',
      owner: 'dsh-tui::terminal-ui',
    })
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /shortcut/)
}))

test('rejects activating app-container owner gate before runtime binding', () => withFixture(root => {
  mutate(root, '.appsdk/maps/verification-map.json', value => {
    const gate = value.gates.find(item => item.gate_id === 'app_container_unique_composition_owner')
    assert.ok(gate)
    gate.status = 'active'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /pending_runtime_binding/)
  assert.match(result.stderr, /pending_function_binding/)
}))

test('rejects duplicate ordered-frame builders', () => withFixture(root => {
  mutate(root, '.appsdk/maps/function-map.json', value => {
    value.target_functions.push({
      function_id: 'duplicate_ordered_app_frame_tree_builder',
      status: 'pending',
      binding_status: 'pending',
      owner: 'dsh-tui::terminal-ui',
      semantic_roles: ['ordered_frame_tree_builder'],
      entry_symbols: [],
      resource_ids: ['typed_ordered_terminal_frame_tree'],
      required_gates: ['app_container_unique_composition_owner'],
    })
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /duplicate_owner/)
}))

test('rejects reconstruction metadata in the target executable frame', () => withFixture(root => {
  mutate(root, 'contracts/tui/app-container/ordered-app-frame.contract.json', value => {
    value.output_fields.push('layout')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /without reconstruction metadata/)
}))

test('rejects a target TypeScript frame with reconstruction metadata', () => withFixture(root => {
  const path = 'contracts/tui/app-container/ordered-app-frame.types.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '  readonly root: TuiAppFrameRoot\n',
    "  readonly root: TuiAppFrameRoot\n  readonly layout: 'default' | 'compact'\n",
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /TuiAppContainerFrameV3 exact fields/)
}))

test('rejects an open terminal primitive style family', () => withFixture(root => {
  const path = 'contracts/tui/terminal-ui/terminal-frame-tree.types.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '  readonly color?: TuiTerminalTextColor\n',
    '  readonly color?: TuiTerminalTextColor\n  readonly backgroundColor?: string\n',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /TuiTerminalTextStyle exact fields/)
}))

test('rejects an unknown ordered-frame input resource', () => withFixture(root => {
  mutate(root, 'contracts/tui/app-container/ordered-app-frame.contract.json', value => {
    value.input_resources[0] = 'unknown_terminal_region_truth'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /ordered app-frame input resources/)
}))

test('rejects optional terminal region-leaf drift', () => withFixture(root => {
  mutate(root, 'contracts/tui/terminal-ui/terminal-region-leaves.contract.json', value => {
    value.optional_fields.push('status')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /region leaf set must be exact and closed/)
}))

test('rejects unstable dynamic-key encoding', () => withFixture(root => {
  mutate(root, 'contracts/tui/terminal-ui/terminal-frame-tree.contract.json', value => {
    value.key_contract.dynamic_encoding = 'array_position'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /stable-key grammar, scope or source contract drift/)
}))

test('rejects a cutover that omits lifecycle composition callback deletion', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/tui-v4-app-container-frame.manifest.json', value => {
    value.cutover.declaration_bindings = value.cutover.declaration_bindings.filter(binding =>
      binding.qualified_name !== 'TuiTerminalLifecycleService.renderWithCompose')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /cutover must delete compose callbacks/)
}))

test('rejects a cutover that leaves the app-container safe failure owner alive', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/tui-v4-app-container-frame.manifest.json', value => {
    value.cutover.function_ids = value.cutover.function_ids.filter(id =>
      id !== 'route_app_composition_errors')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /cutover current function binding set/)
}))

test('rejects an ordered-frame edge without its owning validator', () => withFixture(root => {
  mutate(root, '.appsdk/maps/mainline-call-map.json', value => {
    const lifecycle = value.target_lifecycles.find(item => item.lifecycle_id === 'dsh-tui-v4')
    const edge = lifecycle.edges.find(item => item.function_id === 'build_ordered_app_frame_tree')
    delete edge.validator_function_id
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must bind its validator, viewport and chrome side inputs/)
}))

test('rejects a composition failure target without the public carrier seam', () => withFixture(root => {
  mutate(root, '.appsdk/maps/mainline-call-map.json', value => {
    const lifecycle = value.target_lifecycles.find(item => item.lifecycle_id === 'dsh-tui-v4')
    delete lifecycle.composition_failure_rebinding.sink_binding.public_qualified_name
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /generic lifecycle fail face/)
}))

test('rejects a composition failure target without inherited process-exit projection', () => withFixture(root => {
  mutate(root, '.appsdk/maps/mainline-call-map.json', value => {
    const lifecycle = value.target_lifecycles.find(item => item.lifecycle_id === 'dsh-tui-v4')
    lifecycle.composition_failure_rebinding.inherited_edges.pop()
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /preserve the startup and process-exit edges/)
}))

test('rejects an executable frame without an independent realization failure binding', () => withFixture(root => {
  mutate(root, '.appsdk/maps/mainline-call-map.json', value => {
    const lifecycle = value.target_lifecycles.find(item => item.lifecycle_id === 'dsh-tui-v4')
    assert.ok(lifecycle)
    delete lifecycle.realization_failure_binding
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /generic realization failure must use an independent typed source/)
}))

test('rejects generic realization failure projected as app composition failure', () => withFixture(root => {
  mutate(root, '.appsdk/maps/mainline-call-map.json', value => {
    const lifecycle = value.target_lifecycles.find(item => item.lifecycle_id === 'dsh-tui-v4')
    assert.ok(lifecycle)
    lifecycle.realization_failure_binding.source_resource = 'app_composition_failure_chain'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /generic realization failure must use an independent typed source/)
}))

test('rejects generic realization failure without inherited process-exit projection', () => withFixture(root => {
  mutate(root, '.appsdk/maps/mainline-call-map.json', value => {
    const lifecycle = value.target_lifecycles.find(item => item.lifecycle_id === 'dsh-tui-v4')
    assert.ok(lifecycle)
    lifecycle.realization_failure_binding.inherited_edges.pop()
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /generic realization failure must preserve the implemented startup and process-exit tail/)
}))

test('rejects activating executable-frame error chain before runtime binding', () => withFixture(root => {
  mutate(root, '.appsdk/maps/verification-map.json', value => {
    const gate = value.gates.find(item => item.gate_id === 'executable_frame_error_chain_e2e')
    assert.ok(gate)
    gate.status = 'active'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /pending_realization_failure_resource/)
  assert.match(result.stderr, /composition_failure_router_unbound/)
  assert.match(result.stderr, /realization_failure_router_unbound/)
}))

test('rejects v4 manifest forbidden-edge drift', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/tui-v4-app-container-frame.manifest.json', value => {
    value.forbidden_edges.pop()
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /architecture manifest and mainline target bindings drift/)
}))

test('rejects v4 manifest without the viewport bootstrap gate', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/tui-v4-app-container-frame.manifest.json', value => {
    value.verification_gates = value.verification_gates.filter(gate =>
      gate !== 'terminal_viewport_bootstrap')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /architecture manifest verification gates/)
}))

test('rejects viewport bootstrap sequence drift', () => withFixture(root => {
  mutate(root, 'contracts/tui/app-shell/terminal-viewport-bootstrap.contract.json', value => {
    value.initial_sequence.splice(3, 1)
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /viewport bootstrap and resize sequence drift/)
}))

test('rejects activating viewport bootstrap against v3 direct resize and defaults', () => withFixture(root => {
  mutate(root, '.appsdk/maps/verification-map.json', value => {
    const gate = value.gates.find(item => item.gate_id === 'terminal_viewport_bootstrap')
    assert.ok(gate)
    gate.status = 'active'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /controller_default_viewport/)
  assert.match(result.stderr, /app_container_width_default/)
  assert.match(result.stderr, /lifecycle_rows_default/)
  assert.match(result.stderr, /rows_dropped/)
  assert.match(result.stderr, /direct_resize_bus_bypass/)
  assert.match(result.stderr, /nested_viewport_not_frozen/)
  assert.match(result.stderr, /pending_viewport_binding/)
}))

test('rejects chrome resource truth that hides the logic-control input edge', () => withFixture(root => {
  mutate(root, '.appsdk/maps/resource-map.json', value => {
    value.required_relations = value.required_relations.filter(relation =>
      !(relation.from === 'logic_control_registry' && relation.to === 'tui_chrome_slot_registry'))
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /logic-control -> chrome-slot resource relation missing/)
}))

test('rejects an unregistered logic projection owner', () => withFixture(root => {
  mutate(root, '.appsdk/maps/function-map.json', value => {
    const fn = value.functions.find(item => item.function_id === 'project_logic_controls')
    assert.ok(fn)
    fn.owner = 'dsh-tui::chrome-controls'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /logic projection function owner drift/)
}))

test('rejects direct app-container consumption of logic controls', () => withFixture(root => {
  const path = 'playground/experiments/app-container/src/app-container.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, `${value}\nconst forbidden = tuiLogicControls\n`)
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /app-container cannot consume the logic-control registry directly/)
}))

test('rejects chrome manifest slot drift', () => withFixture(root => {
  mutate(root, 'contracts/tui/chrome-controls/manifest.json', value => {
    value.slot_ids[0] = 'header.brand'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /canonical runtime <-> manifest chrome slot coverage/)
}))

test('rejects governance dependency hidden as a non-runtime edge class', () => withFixture(root => {
  mutate(root, '.appsdk/project.json', value => {
    const module = value.modules.find(item => item.module_id === 'governance-build')
    assert.ok(module)
    assert.ok(module)
    module.dependency_modules = module.dependency_modules.filter(item => item !== 'app-shell')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /governance-build: project\.json dependency_modules <-> module-registry import_edges/)
}))

test('rejects stale runtime admission or owner prose in the canonical design', () => withFixture(root => {
  const path = '.appsdk/architecture/tui-v3-design.md'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace('Status: confirmed v3 runtime implementation; delivery admission remains gated by verification-map.', 'Status: confirmed v3 design; runtime implementation not admitted.'))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /canonical v3 runtime status drift/)
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

test('rejects a composite chrome producer edge that hides its helper hop', () => withFixture(root => {
  mutate(root, '.appsdk/maps/mainline-call-map.json', value => {
    const edge = value.auxiliary_edges.find(item =>
      item.from === 'chrome_slot_producer_project' && item.to === 'chrome_control_helper.project')
    assert.ok(edge)
    edge.callee = 'TuiLogicControlProjector.project'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /producer -> helper edge is not the parsed adjacent call edge/)
}))

test('rejects chrome contract without the concrete logic-control binding test', () => withFixture(root => {
  const path = 'tests/chrome-controls/chrome-controls.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace('  applyLogicControls(ctx)\n', ''))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /chrome contract must bind the concrete logic-control owner/)
}))

test('rejects a chrome helper edge that names only its typed contract face', () => withFixture(root => {
  mutate(root, '.appsdk/maps/mainline-call-map.json', value => {
    const edge = value.auxiliary_edges.find(item =>
      item.from === 'chrome_control_helper.project' && item.to === 'logic_control_registry.project')
    assert.ok(edge)
    edge.callee = 'TuiLogicControlProjector.project'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /helper -> logic-control edge is not the parsed runtime implementation edge/)
}))

test('rejects a composition error edge owned by the failure producer', () => withFixture(root => {
  mutate(root, '.appsdk/maps/mainline-call-map.json', value => {
    const chain = value.error_chains.find(item => item.chain_id === 'dsh-tui-app-composition-error-v1')
    assert.ok(chain)
    chain.edges[0].owner = 'dsh-tui::app-container'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /composition error-chain owners must follow the real conversion boundaries/)
}))

test('rejects a fabricated composition exit symbol', () => withFixture(root => {
  mutate(root, '.appsdk/maps/mainline-call-map.json', value => {
    const chain = value.error_chains.find(item => item.chain_id === 'dsh-tui-app-composition-error-v1')
    assert.ok(chain)
    chain.edges[2].entry_symbols.push('pluginStartup')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /composition error-chain owners must follow the real conversion boundaries/)
}))

test('rejects a composition gate that omits terminal lifecycle admission', () => withFixture(root => {
  mutate(root, '.appsdk/maps/verification-map.json', value => {
    const gate = value.gates.find(item => item.gate_id === 'composition_error_chain_e2e')
    assert.ok(gate)
    gate.required_for = gate.required_for.filter(stage => stage !== 'terminal_lifecycle_implementation')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /all three implementation stages/)
}))

test('rejects a composition e2e that disconnects the real app-container edge', () => withFixture(root => {
  const path = 'tests/app-shell/app-shell.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace('ui: lifecycleContext.tuiAppContainer', 'ui: fakeComposer'))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /does not originate the failure at the real app-container boundary/)
}))

test('rejects a replaceable production startTui runtime', () => withFixture(root => {
  const path = 'playground/experiments/startup/src/startup.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '/** Wires all services and returns a started TuiRuntimeController. */',
    'export interface TuiStartupDependencies { readonly startTui?: unknown }\n/** Replaced runtime entrypoint. */',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must not expose a whole-runtime replacement path/)
}))

test('rejects terminal lifecycle when it drops the canonical composition cause', () => withFixture(root => {
  const path = 'playground/experiments/terminal-lifecycle/src/terminal-lifecycle.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(', { cause: result.error.cause }', ''))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /renderWithCompose must preserve the canonical composition cause/)
}))

test('rejects CI without the composition error-chain executable gate', () => withFixture(root => {
  const target = join(root, '../.github/workflows/dsh-tui.yml')
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace('      - run: pnpm run test:app-container && pnpm run test:terminal-lifecycle && pnpm run test:app-shell\n', ''))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CI composition error-chain gate wiring missing/)
}))

test('rejects app-shell bypass of the safe composition failure route', () => withFixture(root => {
  const path = 'playground/experiments/app-shell/src/app-shell.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace('deps.ui.composeInkTreeSafe', 'deps.ui.composeInkTree'))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /app-shell must request the safe typed app-container edge/)
}))

test('rejects an aggregate check that omits type and runtime boundary gates', () => withFixture(root => {
  mutate(root, 'package.json', value => {
    value.scripts.check = 'pnpm run check:design && pnpm run test:design'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /package check must run design, red, type and runtime boundary gates/)
}))

test('rejects a declared composition scenario without an executable binding', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/test-design.json', value => {
    const suite = value.suites.find(row => row.suite_id === 'app-shell.composition-error-chain')
    assert.ok(suite)
    suite.test_bindings = suite.test_bindings.filter(binding =>
      binding.test_name !== 'explicit disposal projects exited exactly once')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /app-shell composition-error scenario bindings/)
}))

test('rejects a composition scenario binding without its executable AST call', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/test-design.json', value => {
    const suite = value.suites.find(row => row.suite_id === 'app-shell.composition-error-chain')
    assert.ok(suite)
    const binding = suite.test_bindings.find(row =>
      row.test_name === 'composition error chain reaches CLI and plugin process exits through production owners')
    assert.ok(binding)
    binding.required_ast[0].expression += ' --missing'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /executable test omits bound AST matcher/)
}))

test('rejects a bound composition call that survives only as a string literal', () => withFixture(root => {
  const path = 'tests/app-shell/app-shell.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '    applyAppContainer(context)\n',
    "    const hidden = 'applyAppContainer(context)'\n",
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /executable test omits bound AST matcher/)
}))

test('rejects a bound composition call hidden behind a dead branch', () => withFixture(root => {
  const path = 'tests/app-shell/app-shell.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '    applyAppContainer(context)\n',
    '    if (false) applyAppContainer(context)\n',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /executable test omits bound AST matcher/)
}))

test('rejects a production declaration bound to a different owned source path', () => withFixture(root => {
  mutate(root, '.appsdk/maps/function-map.json', value => {
    const fn = value.functions.find(row => row.function_id === 'project_terminal_failure_exit')
    assert.ok(fn)
    const binding = fn.declaration_bindings.find(row =>
      row.symbol === 'pluginExitForTuiStartupOutcome')
    assert.ok(binding)
    binding.path = 'playground/experiments/app-shell/src/app-shell.ts'
  })
  const productionPath = 'playground/experiments/app-shell/src/app-shell.ts'
  writeFileSync(join(root, productionPath), `${readFileSync(join(root, productionPath), 'utf8')}\nexport function pluginExitForTuiStartupOutcome() {}\n`)
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /declaration binding for dsh-tui::app-shell\.pluginExitForTuiStartupOutcome/)
}))

test('rejects a bound call retained only inside an uncalled local function', () => withFixture(root => {
  const path = 'tests/app-shell/app-shell.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '    applyAppContainer(context)\n',
    'function uncalledRuntimeContext() {\n      applyAppContainer(context)\n    }\n',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /executable test omits bound AST matcher/)
}))

test('rejects a bound call hidden behind while (false)', () => withFixture(root => {
  const path = 'tests/app-shell/app-shell.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '    applyAppContainer(context)\n',
    '    while (false) applyAppContainer(context)\n',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /executable test omits bound AST matcher/)
}))

test('rejects a bound call hidden behind if (true) else', () => withFixture(root => {
  const path = 'tests/app-shell/app-shell.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '    applyAppContainer(context)\n',
    '    if (true) { const admitted = 1 } else { applyAppContainer(context) }\n',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /executable test omits bound AST matcher/)
}))

test('rejects a gate filter that removes every bound executable test', () => withFixture(root => {
  mutate(root, 'package.json', value => {
    value.scripts['test:app-shell'] =
      'node --test-name-pattern=^$ --import tsx --test tests/app-shell/app-shell.spec.ts'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /is not unconditionally executed by its declared gate/)
}))

test('rejects a value flow that discards the producer result and substitutes fake outcome', () => withFixture(root => {
  const path = 'tests/app-shell/app-shell.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '  shouldFail = true\n  controller.render()\n  const outcome = await projection.exited\n',
    '  shouldFail = true\n  controller.render()\n  await projection.exited\n  const outcome = { state: \'failed\', error: { cause: originalCause } } as TuiStartupOutcome\n',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /value-flow awaited result is not assigned to one outcome declaration/)
}))

test('rejects a value flow that reassigns the projection after the producer call', () => withFixture(root => {
  const path = 'tests/app-shell/app-shell.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '  shouldFail = true\n  controller.render()\n  const outcome = await projection.exited\n',
    '  shouldFail = true\n  controller.render()\n  let projection = projectTerminalFailureOutcome(lifecycle)\n  projection = projectTerminalFailureOutcome(lifecycle)\n  const outcome = await projection.exited\n',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /value-flow producer projection must be declared const|value-flow producer projection must not be reassigned/)
}))

test('rejects a value flow that reassigns the outcome after the awaited result', () => withFixture(root => {
  const path = 'tests/app-shell/app-shell.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '  shouldFail = true\n  controller.render()\n  const outcome = await projection.exited\n',
    '  shouldFail = true\n  controller.render()\n  const awaitedOutcome = await projection.exited\n  const outcome = awaitedOutcome\n  void outcome\n',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /value-flow awaited result is not assigned to one outcome declaration/)
}))

test('rejects a bound call after a return statement in the same block', () => withFixture(root => {
  const path = 'tests/app-shell/app-shell.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '    applyAppContainer(context)\n',
    '    return\n    applyAppContainer(context)\n',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /executable test omits bound AST matcher/)
}))

test('rejects a bound call hidden behind for (let i = 0; false; i++)', () => withFixture(root => {
  const path = 'tests/app-shell/app-shell.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '    applyAppContainer(context)\n',
    '    for (let i = 0; false; i++) applyAppContainer(context)\n',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /executable test omits bound AST matcher/)
}))

test('rejects a value flow with a producer result declared as let', () => withFixture(root => {
  const path = 'tests/app-shell/app-shell.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    '  shouldFail = true\n  controller.render()\n  const outcome = await projection.exited\n',
    '  shouldFail = true\n  controller.render()\n  let outcome = await projection.exited\n',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /value-flow awaited outcome outcome must be declared const/)
}))

test('rejects moving a production declaration binding into a different function_id', () => withFixture(root => {
  mutate(root, '.appsdk/maps/function-map.json', value => {
    const fn = value.functions.find(row => row.function_id === 'project_terminal_failure_exit')
    assert.ok(fn)
    const binding = fn.declaration_bindings.find(row =>
      row.symbol === 'pluginExitForTuiStartupOutcome')
    assert.ok(binding)
    binding.symbol = 'pluginExitForTuiStartupOutcome'
    const wrong = value.functions.find(row => row.function_id === 'compose_app_container_frame')
    assert.ok(wrong)
    wrong.declaration_bindings = wrong.declaration_bindings ?? []
    wrong.declaration_bindings.push({ ...binding })
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /declaration binding for dsh-tui::app-container\.pluginExitForTuiStartupOutcome|declaration path is owned by another module/)
}))

test('rejects a pending Rust governance plan that claims implementation', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/rust-governance-migration-plan.json', value => {
    value.status = 'implemented'
    value.runtime_owner.status = 'active'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Rust governance migration is not implemented/)
}))

test('rejects a locally shadowed bound production owner', () => withFixture(root => {
  const path = 'tests/app-shell/app-shell.spec.ts'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, value.replace(
    "import { pluginExitForTuiStartupOutcome } from '../../src/plugin-startup.ts'",
    "import { pluginExitForTuiStartupOutcome as productionPluginExitForTuiStartupOutcome } from '../../src/plugin-startup.ts'\n\n"
      + 'function pluginExitForTuiStartupOutcome(context: unknown, outcome: unknown) {'
      + ' return productionPluginExitForTuiStartupOutcome(context, outcome) }',
  ))
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /executable test omits bound AST matcher/)
}))

test('rejects an executable scenario binding with no AST matchers', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/test-design.json', value => {
    const suite = value.suites.find(row => row.suite_id === 'app-shell.composition-error-chain')
    assert.ok(suite)
    const binding = suite.test_bindings.find(row =>
      row.test_name === 'explicit disposal projects exited exactly once')
    assert.ok(binding)
    binding.required_ast = []
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /malformed test binding/)
}))

test('rejects a declared gate whose package script stops running the bound file', () => withFixture(root => {
  mutate(root, 'package.json', value => {
    value.scripts['test:app-shell'] = 'node --import tsx --test unrelated.spec.ts'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /is not unconditionally executed by its declared gate/)
}))

test('rejects a bound file reached through shell fallback', () => withFixture(root => {
  mutate(root, 'package.json', value => {
    value.scripts['test:app-shell'] =
      'true || node --import tsx --test tests/app-shell/app-shell.spec.ts'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /gate command must be an unconditional shell chain/)
}))

test('rejects a gate that does not execute the declared binding file', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/test-design.json', value => {
    const suite = value.suites.find(row => row.suite_id === 'app-shell.composition-error-chain')
    assert.ok(suite)
    const binding = suite.test_bindings.find(row =>
      row.scenario === 'production startTui cannot be replaced through an injection parameter')
    assert.ok(binding)
    binding.test_file = 'tests/app-shell/app-shell.spec.ts'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /is not unconditionally executed by its declared gate/)
}))

test('rejects an unknown executable AST matcher kind', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/test-design.json', value => {
    const suite = value.suites.find(row => row.suite_id === 'app-shell.composition-error-chain')
    assert.ok(suite)
    const binding = suite.test_bindings.find(row =>
      row.test_name === 'explicit disposal projects exited exactly once')
    assert.ok(binding)
    binding.required_ast[0].kind = 'unknown-kind'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unknown executable AST matcher kind/)
}))

test('rejects an executable AST matcher with undeclared fields', () => withFixture(root => {
  mutate(root, '.appsdk/architecture/test-design.json', value => {
    const suite = value.suites.find(row => row.suite_id === 'app-shell.composition-error-chain')
    assert.ok(suite)
    const binding = suite.test_bindings.find(row =>
      row.test_name === 'explicit disposal projects exited exactly once')
    assert.ok(binding)
    binding.required_ast[0].control = 'smuggled'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /AST matcher has unexpected field/)
}))

test('rejects duplicate executable test names within one bound file', () => withFixture(root => {
  const path = '.appsdk/verification/verify-design.spec.mjs'
  const target = join(root, path)
  const value = readFileSync(target, 'utf8')
  writeFileSync(target, `${value}\ntest('accepts the canonical design contracts', () => {})\n`)
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /duplicate executable test name/)
}))

test('rejects a nested package script that omits the bound file', () => withFixture(root => {
  mutate(root, 'package.json', value => {
    value.scripts['test:app-shell-inner'] = 'node --import tsx --test unrelated.spec.ts'
    value.scripts['test:app-shell'] = 'pnpm run test:app-shell-inner'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /is not unconditionally executed by its declared gate/)
}))

test('rejects echo-only proof beside a bound gate command', () => withFixture(root => {
  mutate(root, 'package.json', value => {
    value.scripts['test:app-shell'] =
      'node --import tsx --test tests/app-shell/app-shell.spec.ts && echo tests/app-shell/app-shell.spec.ts'
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /gate command must not contain comments or echo-only proof/)
}))

test('rejects governance ownership without the executable design red-test gate', () => withFixture(root => {
  mutate(root, '.appsdk/maps/function-map.json', value => {
    const fn = value.functions.find(row => row.function_id === 'validate_governance_build_surface')
    assert.ok(fn)
    fn.required_gates = fn.required_gates.filter(gate => gate !== 'design_gate_red_tests')
  })
  const result = verify(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /governance owner must require the executable design red-test gate/)
}))
