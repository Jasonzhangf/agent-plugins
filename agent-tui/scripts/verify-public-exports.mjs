import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const manifestPath = resolve(root, '.appsdk/architecture/public-exports.manifest.json')
const installRoot = process.env.AGENT_TUI_CLEAN_INSTALL_ROOT
  ? resolve(process.env.AGENT_TUI_CLEAN_INSTALL_ROOT)
  : root

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.schema_version !== 1) throw new Error('public-exports.manifest schema_version must be 1')
const tag = process.env.AGENT_TUI_NPM_TAG ?? manifest.selected_tag ?? 'latest'
const registry = process.env.AGENT_TUI_NPM_REGISTRY ?? 'https://registry.npmjs.org'

async function fetchRegistry(pkg) {
  const url = `${registry.replace(/\/$/, '')}/${pkg.replace('@', '%40')}/${tag}`
  const response = await fetch(url, { headers: { 'user-agent': 'agent-tui-public-exports-probe/0.1' } })
  if (!response.ok) throw new Error(`${pkg}@${tag} responded ${response.status}`)
  return response.json()
}

async function verifyRegistry() {
  const failures = []
  for (const entry of manifest.required) {
    try {
      const pkg = await fetchRegistry(entry.package)
      if (pkg.version !== manifest.selected_version) {
        failures.push(`${entry.package}@${tag}: expected ${manifest.selected_version}, got ${pkg.version}`)
        continue
      }
      const spec = pkg.exports?.[entry.export]
      const target = typeof spec === 'string' ? spec : spec?.default
      if (typeof target !== 'string') {
        failures.push(`${entry.package}@${pkg.version}: missing export ${entry.export}`)
      }
    } catch (error) {
      failures.push(`${entry.package}: ${error.message}`)
    }
  }
  return failures
}

if (process.env.AGENT_TUI_REGISTRY_ONLY === '1') {
  const failures = await verifyRegistry()
  if (failures.length > 0) {
    console.error('PUBLIC_EXPORTS_REGISTRY: FAIL')
    for (const failure of failures) console.error(`- ${failure}`)
    process.exit(1)
  }
  console.log(`PUBLIC_EXPORTS_REGISTRY: PASS (tag=${tag})`)
  process.exit(0)
}

async function resolveExport(packageName, exportName) {
  const pkgPath = require.resolve(`${packageName}/package.json`, { paths: [installRoot] })
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  const exports = pkg.exports
  const spec = exports?.[exportName]
  if (spec === undefined) throw new Error(`${packageName} does not export ${exportName}`)
  const target = typeof spec === 'string' ? spec : spec.default
  if (typeof target !== 'string') throw new Error(`${packageName}${exportName} has no default target`)
  return {
    pkgPath,
    target: resolve(pkgPath, '..', target),
    declarationRoot: resolve(pkgPath, '..', typeof spec === 'string' ? spec.replace(/\.js$/, '.d.ts') : spec.types ?? target),
  }
}

const failures = []
for (const entry of manifest.required) {
  const label = `${entry.package}${entry.export}`
  try {
    const { target } = await resolveExport(entry.package, entry.export)
    await access(target)
    const pkgPath = require.resolve(`${entry.package}/package.json`, { paths: [installRoot] })
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    const spec = pkg.exports?.[entry.export]
    const candidates = []
    if (spec?.types) candidates.push(resolve(pkgPath, '..', spec.types))
    if (target.endsWith('.js')) candidates.push(target.replace(/\.js$/, '.d.ts'))
    candidates.push(target)
    for (const sibling of ['index.d.ts', 'client/index.d.ts', 'api/index.d.ts']) {
      candidates.push(resolve(target, '..', sibling))
    }
    let declarationText = ''
    for (const candidate of candidates) {
      try {
        declarationText = await readFile(candidate, 'utf8')
        if (declarationText.length > 0) break
      } catch {}
    }
    for (const symbol of entry.symbols) {
      if (!new RegExp(`\\b${escapeRegExp(symbol)}\\b`).test(declarationText)) {
        failures.push(`${label}: missing declaration symbol ${symbol}`)
      }
    }
  } catch (error) {
    failures.push(`${label}: ${error.message}`)
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

if (failures.length > 0) {
  console.error('PUBLIC_EXPORTS: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`PUBLIC_EXPORTS: PASS (install_root=${installRoot})`)
}
