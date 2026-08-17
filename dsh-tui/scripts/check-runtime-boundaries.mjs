import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const experimentRoot = resolve(root, 'playground/experiments')
const forbidden = [
  '@deepseek-ai/dsh-host-apiproxy',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-goal',
  '@deepseek-ai/dsh-message-feedback',
  '@deepseek-ai/dsh-host-plugin-inventory',
  'ink',
  'react',
]

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
