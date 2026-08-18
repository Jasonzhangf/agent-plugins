import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8',
})
if (packed.status !== 0) throw new Error(`pack-gate: npm pack failed: ${packed.stderr.trim()}`)

const jsonStart = packed.stdout.lastIndexOf('\n[')
if (jsonStart < 0) throw new Error('pack-gate: npm pack did not emit a JSON report')
const report = JSON.parse(packed.stdout.slice(jsonStart + 1))[0]
if (report?.id !== `${packageJson.name}@${packageJson.version}`) {
  throw new Error('pack-gate: package identity differs from package.json')
}
const paths = report.files.map(file => file.path).sort()
const allowed = [
  /^README\.md$/u,
  /^cordis\.patch\.yml$/u,
  /^lib\/(?:client|index|invariant)\.js$/u,
  /^lib\/types\/.+\.d\.ts$/u,
  /^package\.json$/u,
]
for (const path of paths) {
  if (!allowed.some(pattern => pattern.test(path))) {
    throw new Error(`pack-gate: unexpected packed path ${path}`)
  }
}
for (const required of ['README.md', 'cordis.patch.yml', 'lib/client.js', 'lib/index.js', 'lib/invariant.js', 'package.json']) {
  if (!paths.includes(required)) throw new Error(`pack-gate: missing packed path ${required}`)
}

const packedText = await Promise.all(paths.map(path => readFile(join(root, path), 'utf8')))
const joinedRuntime = paths
  .map((path, index) => path.endsWith('.js') ? packedText[index] : '')
  .join('\n')
for (const official of ['@deepseek-ai/dsh-llm-pi-ai', '@deepseek-ai/dsh-client-ui-settings-models']) {
  const escaped = official.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const runtimeImport = new RegExp(`(?:from\\s*|import\\s*\\(|require\\s*\\()\\s*['"]${escaped}(?:/[^'"]*)?['"]`, 'u')
  if (runtimeImport.test(joinedRuntime)) {
    throw new Error(`pack-gate: packed runtime imports official package ${official}`)
  }
}
for (const marker of [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bsk-[A-Za-z0-9_-]{16,}\b/u,
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/u,
]) {
  if (marker.test(packedText.join('\n'))) throw new Error(`pack-gate: packed content matches secret marker ${String(marker)}`)
}

console.log(`PACK_GATE: PASS (${String(paths.length)} files)`)
