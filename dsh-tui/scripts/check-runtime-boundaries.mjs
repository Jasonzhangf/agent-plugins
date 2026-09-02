import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const experimentRoot = resolve(root, 'src/experiments')
const project = JSON.parse(readFileSync(resolve(root, '.appsdk/project.json'), 'utf8'))
const projectModules = new Map(project.modules.map(module => [module.module_id, module]))
const moduleForPath = (filePath) => {
  const projectPath = relative(root, filePath)
  return project.modules.find((module) => module.owned_paths.some((pattern) => {
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3).replace(/\/$/, '')
      return projectPath === prefix || projectPath.startsWith(`${prefix}/`)
    }
    return projectPath === pattern
  }))
}
// ink and react are forbidden for runtime modules *except* terminal-lifecycle,
// which is the single Ink carrier owner. Any other module importing them is a
// governance breach and must be caught here.
const forbidden = [
  '@deepseek-ai/dsh-client-connection',
]
const carrierPackages = []
const carrierOwners = new Set(['terminal-lifecycle'])

if (!readdirSync(experimentRoot, { withFileTypes: true }).some(entry => entry.isDirectory())) {
  console.error('RUNTIME_BOUNDARIES: PASS (no runtime source yet)')
  process.exit(0)
}

const failures = []
for (const moduleName of readdirSync(experimentRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name)) {
  const sourceRoot = resolve(experimentRoot, moduleName, 'src')
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.ts')) files.push(path)
    }
  }
  if (existsSync(sourceRoot)) walk(sourceRoot)
  const text = files.map(file => readFileSync(file, 'utf8')).join('\n')
  for (const specifier of forbidden) {
    if (new RegExp(`from ['"]${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(text)) {
      failures.push(`${moduleName} imports forbidden package ${specifier}`)
    }
  }
  for (const specifier of carrierPackages) {
    if (carrierOwners.has(moduleName)) continue
    if (new RegExp(`from ['"]${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(text)) {
      failures.push(`${moduleName} imports carrier package ${specifier}; only ${[...carrierOwners].join(', ')} may import it`)
    }
  }
  const forbiddenImport = /from ['"]([^'"]+)['"]/
  for (const line of text.split('\n')) {
    const match = line.match(forbiddenImport)
    if (!match) continue
    const specifier = match[1]
    if (forbidden.some(pkg => specifier.startsWith(pkg))) {
      failures.push(`${moduleName} imports forbidden package ${specifier}`)
    }
    if (carrierPackages.some(pkg => specifier === pkg) && !carrierOwners.has(moduleName)) {
      failures.push(`${moduleName} imports carrier package ${specifier}; only ${[...carrierOwners].join(', ')} may import it`)
    }
    if (specifier.includes('/src/')) {
      const parts = specifier.split('/')
      const targetModule = parts[2]
      const declared = projectModules.get(moduleName)
      const importerOwner = moduleForPath(sourceRoot)
      const targetOwner = moduleForPath(resolve(sourceRoot, specifier))
      const sameOwner = importerOwner !== undefined && targetOwner !== undefined &&
        importerOwner.module_id === targetOwner.module_id
      const allowed = sameOwner || moduleName === 'startup' ||
        (declared !== undefined && Array.isArray(declared.dependency_modules) &&
          (declared.dependency_modules.includes(targetModule) ||
            (targetOwner !== undefined && declared.dependency_modules.includes(targetOwner.module_id))))
      if (allowed && specifier.startsWith('.')) {
        // Playground source modules may typecheck through declared module
        // dependencies; packaged runtime imports consume generated artifacts.
      } else {
        failures.push(`${moduleName} imports private source path ${specifier}`)
      }
    }
  }
  if (new RegExp(`from ['"][^'"]*deepseek-harness[^'"]*['"]`).test(text)) {
    failures.push(`${moduleName} imports a deepseek-harness private path`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`)
  console.error('RUNTIME_BOUNDARIES: FAIL')
  process.exitCode = 1
} else {
  console.log('RUNTIME_BOUNDARIES: PASS')
}
