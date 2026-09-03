import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  throw new Error(`CLEAN_REGISTRY_INSTALL: ${message}`)
}

function run(program, args, cwd, env = process.env) {
  const result = spawnSync(program, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    fail(`${program} ${args.join(' ')} failed with ${String(result.status)}${detail ? `\n${detail}` : ''}`)
  }
  return result.stdout.trim()
}

function assertRegistryDependencySpec(name, spec) {
  if (typeof spec !== 'string' || spec.length === 0) fail(`dependency ${name} has an empty spec`)
  if (/^(?:file:|link:|portal:|workspace:|git\+|git:|ssh:|https?:\/\/github\.com\/)/.test(spec)) {
    fail(`dependency ${name} is not registry-only: ${spec}`)
  }
}

const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const packageName = packageManifest.name
const packageVersion = packageManifest.version
if (typeof packageName !== 'string' || typeof packageVersion !== 'string') {
  fail('package name and version are required')
}

for (const [name, spec] of Object.entries(packageManifest.dependencies ?? {})) {
  assertRegistryDependencySpec(name, spec)
}

const cleanRoot = mkdtempSync(join(tmpdir(), 'agent-tui-clean-install-'))
const installRoot = join(cleanRoot, 'install')
const npmCache = join(cleanRoot, 'npm-cache')
mkdirSync(installRoot)
mkdirSync(npmCache)

run('pnpm', ['run', 'build:runtime'], root)
run('pnpm', ['pack', '--pack-destination', cleanRoot], root)

const tarballName = `${packageName.replace(/^@[^/]+\//, '')}-${packageVersion}.tgz`
const tarballPath = join(cleanRoot, tarballName)
if (!lstatSync(tarballPath).isFile()) fail(`expected tarball missing: ${tarballPath}`)

writeFileSync(join(installRoot, 'package.json'), `${JSON.stringify({
  name: 'agent-tui-clean-install-verification',
  private: true,
  version: '0.0.0',
}, null, 2)}\n`)

run('npm', ['install', '--cache', npmCache, '--ignore-scripts', tarballPath], installRoot)
run('npm', ['ls', '--all'], installRoot)

const installedPackagePath = join(installRoot, 'node_modules', packageName)
if (lstatSync(installedPackagePath).isSymbolicLink()) fail('installed agent-tui package is a symlink')
const installedRealpath = realpathSync(installedPackagePath)
const expectedPrefix = `${realpathSync(join(installRoot, 'node_modules'))}/`
if (!installedRealpath.startsWith(expectedPrefix)) {
  fail(`installed package escapes clean node_modules: ${installedRealpath}`)
}

const installedManifest = JSON.parse(readFileSync(join(installedPackagePath, 'package.json'), 'utf8'))
if (installedManifest.name !== packageName || installedManifest.version !== packageVersion) {
  fail(`installed package identity mismatch: ${String(installedManifest.name)}@${String(installedManifest.version)}`)
}
for (const [name, spec] of Object.entries(installedManifest.dependencies ?? {})) {
  assertRegistryDependencySpec(name, spec)
}

const help = run(process.execPath, [join(installedPackagePath, 'lib', 'cli.js'), '--help'], installRoot)
if (!help.includes('agent-tui')) fail('installed CLI help is missing its package identity')

run(process.execPath, [join(root, 'scripts', 'verify-public-exports.mjs')], root, {
  ...process.env,
  AGENT_TUI_CLEAN_INSTALL_ROOT: installRoot,
})

const sha256 = createHash('sha256').update(readFileSync(tarballPath)).digest('hex')
process.stdout.write(`${JSON.stringify({
  ok: true,
  package: `${packageName}@${packageVersion}`,
  tarball: basename(tarballPath),
  sha256,
  clean_root: cleanRoot,
  installed_realpath: installedRealpath,
})}\n`)
