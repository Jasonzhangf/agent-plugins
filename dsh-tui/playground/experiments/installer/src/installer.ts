import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const installerServiceName = 'tuiInstaller' as const
export const defaultTuiProfileName = 'tui' as const

export interface TuiProfileManifest {
  readonly name?: string
  readonly private?: boolean
  readonly dependencies?: Readonly<Record<string, string>>
  readonly dsh?: {
    readonly profile?: {
      readonly bundles?: readonly string[]
      readonly [key: string]: unknown
    }
    readonly [key: string]: unknown
  }
  readonly [key: string]: unknown
}

export interface TuiInstallerPaths {
  readonly dshHome?: string
  readonly profileName?: string
}

export interface InstallClientOnlyProfileOptions extends TuiInstallerPaths {
  readonly packageSpec: string
  readonly packageManager?: string
  readonly runInstall?: boolean
  readonly exec?: typeof execFileAsync
}

export interface TuiProfileSnapshot {
  readonly packageJson: string | null
  readonly patch: string | null
}

export interface TuiInstallResult {
  readonly profileDir: string
  readonly packageName: string
  readonly packageSpec: string
  readonly manifest: TuiProfileManifest
}

function profileDir(options: TuiProfilePaths): string {
  return join(options.dshHome, 'profiles', options.profileName)
}

interface TuiProfilePaths {
  readonly dshHome: string
  readonly profileName: string
}

function paths(options: TuiProfilePaths): TuiProfilePaths {
  return {
    dshHome: resolve(options.dshHome),
    profileName: options.profileName,
  }
}

function normalizePaths(options: TuiProfilePaths | TuiInstallerPaths): TuiProfilePaths {
  const dshHome = 'dshHome' in options && options.dshHome !== undefined
    ? options.dshHome
    : join(homedir(), '.dsh')
  const profileName = 'profileName' in options && options.profileName !== undefined
    ? options.profileName
    : defaultTuiProfileName
  if (typeof profileName !== 'string' || !/^[a-z][a-z0-9-]*$/.test(profileName)) {
    throw new TypeError(`invalid DSH profile name: ${String(profileName)}`)
  }
  return paths({ dshHome, profileName })
}

function assertRegistryPackageSpec(spec: string): { packageName: string; packageSpec: string } {
  if (typeof spec !== 'string' || spec.length === 0) throw new TypeError('packageSpec must be non-empty')
  if (/^(?:\.|\/|~\/|file:|link:|portal:|workspace:|github:|git\+|https?:)/.test(spec)) {
    throw new TypeError('dsh-tui installer accepts registry package specs only; local and git specs are forbidden')
  }
  const match = spec.match(/^(@[a-z0-9._-]+\/)?([a-z0-9._-]+)(?:@(.+))?$/i)
  if (!match) throw new TypeError(`invalid registry package spec: ${spec}`)
  const packageName = `${match[1] ?? ''}${match[2]}`
  const version = match[3]
  if (packageName !== 'dsh-tui') {
    throw new TypeError(`installer package must be dsh-tui, got ${packageName}`)
  }
  if (!version || version.startsWith('file:') || version.startsWith('link:')) {
    throw new TypeError('dsh-tui registry package spec must include a registry version or tag')
  }
  return { packageName, packageSpec: spec }
}

async function readManifest(file: string): Promise<TuiProfileManifest> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as TuiProfileManifest
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'ENOENT') return { name: 'dsh-profile-tui', private: true }
    throw error
  }
}

function clientOnlyManifest(current: TuiProfileManifest, packageName: string, packageSpec: string): TuiProfileManifest {
  const dependencies = { ...(current.dependencies ?? {}), [packageName]: packageSpec }
  const profile = { ...(current.dsh?.profile ?? {}), bundles: [packageName] }
  return {
    ...current,
    name: typeof current.name === 'string' ? current.name : 'dsh-profile-tui',
    private: true,
    dependencies,
    dsh: { ...(current.dsh ?? {}), profile },
  }
}

export async function snapshotProfile(options: TuiInstallerPaths = {}): Promise<TuiProfileSnapshot> {
  const resolved = normalizePaths(options)
  const dir = profileDir(resolved)
  const readOptional = async (file: string): Promise<string | null> => {
    try { return await readFile(file, 'utf8') } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null
      throw error
    }
  }
  return Object.freeze({
    packageJson: await readOptional(join(dir, 'package.json')),
    patch: await readOptional(join(dir, 'cordis.patch.yml')),
  })
}

export async function assertProfileUnchanged(options: TuiInstallerPaths, before: TuiProfileSnapshot): Promise<void> {
  const after = await snapshotProfile(options)
  if (after.packageJson !== before.packageJson || after.patch !== before.patch) {
    throw new Error(`profile changed unexpectedly: ${normalizePaths(options).profileName}`)
  }
}

export async function installClientOnlyProfile(options: InstallClientOnlyProfileOptions): Promise<TuiInstallResult> {
  const { packageName, packageSpec } = assertRegistryPackageSpec(options.packageSpec)
  const resolved = normalizePaths(options)
  const dir = profileDir(resolved)
  await mkdir(dir, { recursive: true })
  const packagePath = join(dir, 'package.json')
  const current = await readManifest(packagePath)
  const manifest = clientOnlyManifest(current, packageName, packageSpec)
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const patchPath = join(dir, 'cordis.patch.yml')
  try {
    await readFile(patchPath, 'utf8')
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
    await writeFile(patchPath, '[]\n', 'utf8')
  }
  if (options.runInstall !== false) {
    const run = options.exec ?? execFileAsync
    await run(options.packageManager ?? 'pnpm', ['install', '--save-exact', '--lockfile-only'], { cwd: dir })
  }
  return Object.freeze({ profileDir: dir, packageName, packageSpec, manifest })
}

export async function uninstallClientOnlyProfile(options: TuiInstallerPaths = {}): Promise<void> {
  const resolved = normalizePaths(options)
  const dir = profileDir(resolved)
  const packagePath = join(dir, 'package.json')
  const current = await readManifest(packagePath)
  const bundles = [...(current.dsh?.profile?.bundles ?? [])]
  const dependencies = { ...(current.dependencies ?? {}) }
  if (!bundles.includes('dsh-tui') && dependencies['dsh-tui'] === undefined) return
  const nextBundles = bundles.filter(bundle => bundle !== 'dsh-tui')
  delete dependencies['dsh-tui']
  const nextDsh = current.dsh === undefined
    ? undefined
    : { ...current.dsh, profile: { ...(current.dsh.profile ?? {}), bundles: nextBundles } }
  const next: TuiProfileManifest = { ...current }
  if (Object.keys(dependencies).length === 0) delete (next as Record<string, unknown>).dependencies
  else (next as Record<string, unknown>).dependencies = dependencies
  if (nextDsh === undefined) delete (next as Record<string, unknown>).dsh
  else (next as Record<string, unknown>).dsh = nextDsh
  await writeFile(packagePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

export const installer = Object.freeze({
  installClientOnlyProfile,
  uninstallClientOnlyProfile,
  snapshotProfile,
  assertProfileUnchanged,
})
