#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const packageName = manifest.name
const packageVersion = manifest.version
const profile = process.env.DSH_TUI_PROFILE ?? 'web'
const storeLink = resolve(process.env.DSH_PLUGIN_STORE_LINK ?? join(homedir(), '.dsh-plugins'))
const storeTarget = resolve(process.env.DSH_PLUGIN_STORE_TARGET ?? '/Volumes/extension/dsh-plugins')

function fail(message) {
  throw new Error(`dsh-tui release: ${message}`)
}

function pathExists(path) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
  })
  if (result.error !== undefined) fail(`${command} could not start: ${result.error.message}`)
  if (result.status !== 0) {
    const stderr = options.capture ? result.stderr.trim() : ''
    fail(`${command} ${args.join(' ')} exited ${result.status}${stderr === '' ? '' : `: ${stderr}`}`)
  }
  return options.capture ? result.stdout : ''
}

function git(args) {
  return run('git', args, { capture: true }).trim()
}

function ensureCleanSource() {
  const top = git(['rev-parse', '--show-toplevel'])
  const pluginPath = relative(top, root)
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=all', '--', pluginPath], {
    cwd: top,
    capture: true,
  }).trim()
  if (dirty !== '') fail(`source tree is not clean:\n${dirty}`)
}

export function ensureStoreLink(linkPath, targetPath) {
  mkdirSync(targetPath, { recursive: true })
  if (!pathExists(linkPath)) {
    symlinkSync(targetPath, linkPath, 'dir')
    return
  }
  const stat = lstatSync(linkPath)
  if (!stat.isSymbolicLink()) fail(`${linkPath} exists and is not a symbolic link`)
  const actual = realpathSync(resolve(dirname(linkPath), readlinkSync(linkPath)))
  const expected = realpathSync(targetPath)
  if (actual !== expected) fail(`${linkPath} points to ${actual}, expected ${expected}`)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function writeJson(path, value) {
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(value, undefined, 2)}\n`)
  renameSync(temporary, path)
}

function setCurrentRelease(packageStore, releaseDir) {
  const current = join(packageStore, 'current')
  if (pathExists(current)) {
    if (!lstatSync(current).isSymbolicLink()) fail(`${current} exists and is not a symbolic link`)
  }
  const temporary = `${current}.tmp-${process.pid}`
  if (pathExists(temporary)) unlinkSync(temporary)
  symlinkSync(relative(packageStore, releaseDir), temporary, 'dir')
  renameSync(temporary, current)
}

function verifyProfile(artifactPath) {
  const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  const profileManifestPath = join(dshHome, 'profiles', profile, 'package.json')
  if (!existsSync(profileManifestPath)) fail(`profile manifest was not created at ${profileManifestPath}`)
  const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'))
  const dependency = profileManifest.dependencies?.[packageName]
  if (typeof dependency !== 'string' || !dependency.startsWith('file:')) {
    fail(`${profile} profile does not reference the released artifact`)
  }
  const installedArtifact = resolve(dirname(profileManifestPath), dependency.slice('file:'.length))
  if (!existsSync(installedArtifact) || realpathSync(installedArtifact) !== realpathSync(artifactPath)) {
    fail(`${profile} profile references ${installedArtifact}, expected ${artifactPath}`)
  }
  const bundles = profileManifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || bundles.filter(value => value === packageName).length !== 1) {
    fail(`${profile} profile must contain exactly one ${packageName} bundle layer`)
  }
  if (!bundles.includes('@deepseek-ai/dsh-web-app')) fail(`${profile} profile no longer contains the shipped Web bundle`)
  const installedBinary = join(dirname(profileManifestPath), 'node_modules', packageName, 'lib', 'native', 'dsh-tui')
  if (!existsSync(installedBinary)) fail(`installed renderer binary is missing at ${installedBinary}`)
  chmodSync(installedBinary, 0o755)
  const dump = run('dsh', ['--profile', profile, '--dump-config'], { capture: true })
  for (const marker of ['web-runtime', 'tui-startup', 'tui-runtime']) {
    if (!dump.includes(marker)) fail(`composed ${profile} profile is missing ${marker}`)
  }
  return profileManifestPath
}

function buildRelease(releaseDir, commit) {
  if (existsSync(releaseDir)) {
    const releaseManifestPath = join(releaseDir, 'release.json')
    if (!existsSync(releaseManifestPath)) fail(`${releaseDir} exists without release.json`)
    const release = JSON.parse(readFileSync(releaseManifestPath, 'utf8'))
    const artifact = join(releaseDir, release.artifact)
    if (release.commit !== commit || !existsSync(artifact) || release.sha256 !== sha256(artifact)) {
      fail(`${releaseDir} does not match the current source commit`)
    }
    return artifact
  }

  const parent = dirname(releaseDir)
  mkdirSync(parent, { recursive: true })
  const staging = mkdtempSync(join(parent, '.staging-'))
  try {
    run('pnpm', ['pack', '--pack-destination', staging])
    const artifactName = `${packageName}-${packageVersion}.tgz`
    const artifact = join(staging, artifactName)
    if (!existsSync(artifact)) fail(`pnpm pack did not create ${artifactName}`)
    writeJson(join(staging, 'release.json'), {
      schemaVersion: 1,
      package: packageName,
      version: packageVersion,
      commit,
      artifact: artifactName,
      sha256: sha256(artifact),
    })
    renameSync(staging, releaseDir)
    return join(releaseDir, artifactName)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

export function main() {
  if (profile !== 'web') fail('the persistent dual-surface release currently targets the shipped web profile only')
  ensureCleanSource()
  ensureStoreLink(storeLink, storeTarget)
  run('pnpm', ['run', 'check'])

  const commit = git(['rev-parse', 'HEAD'])
  const releaseId = `${packageVersion}-${commit.slice(0, 12)}`
  const packageStore = join(storeLink, packageName)
  const releaseDir = join(packageStore, 'releases', releaseId)
  const artifact = buildRelease(releaseDir, commit)

  run('dsh', ['plugin', '--profile', profile, 'add', artifact, '--save-exact'])
  const profileManifestPath = verifyProfile(artifact)
  setCurrentRelease(packageStore, releaseDir)
  const profileStateDir = join(packageStore, 'profiles')
  mkdirSync(profileStateDir, { recursive: true })
  writeJson(join(profileStateDir, `${profile}.json`), {
    schemaVersion: 1,
    profile,
    profileManifestPath,
    artifact,
    installedAt: new Date().toISOString(),
  })

  process.stdout.write(`dsh-tui release installed\nartifact: ${artifact}\nprofile: ${profileManifestPath}\nnext: dsh --profile ${profile}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
