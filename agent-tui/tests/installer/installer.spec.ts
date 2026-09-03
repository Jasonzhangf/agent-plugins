import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assertProfileUnchanged,
  installClientOnlyProfile,
  snapshotProfile,
  uninstallClientOnlyProfile,
} from '../../src/experiments/installer/src/installer.ts'

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-tui-installer-'))
}

test('installs a registry-only client profile without dsh-base and preserves user fields', async () => {
  const home = await tempHome()
  const profileDir = join(home, 'profiles', 'tui')
  const before = JSON.stringify({
    name: 'dsh-profile-tui',
    private: true,
    custom: { keep: true },
    dependencies: { 'other-plugin': '1.2.3' },
    dsh: { profile: { bundles: ['other-plugin'] }, custom: 'keep' },
  }, null, 2) + '\n'
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), before)
  await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')

  const calls: unknown[][] = []
  const result = await installClientOnlyProfile({
    dshHome: home,
    packageSpec: 'dsh-tui@0.1.0-mvp.1',
    exec: (async (_command: string, args: readonly string[], options: { cwd: string }) => {
      calls.push([_command, args, options])
      return { stdout: '', stderr: '' }
    }) as never,
  })
  const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as Record<string, any>
  assert.equal(result.packageName, 'dsh-tui')
  assert.deepEqual(manifest.dsh.profile.bundles, ['dsh-tui'])
  assert.equal(manifest.dependencies['dsh-tui'], 'dsh-tui@0.1.0-mvp.1')
  assert.equal(manifest.dependencies['other-plugin'], '1.2.3')
  assert.equal(manifest.dsh.custom, 'keep')
  assert.equal(manifest.custom.keep, true)
  assert.equal(manifest.dsh.profile.bundles.includes('@deepseek-ai/dsh-base'), false)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0]?.[1], ['install', '--save-exact', '--lockfile-only'])
})

test('rejects local, git, wrong-package and unversioned specs', async () => {
  const home = await tempHome()
  for (const packageSpec of ['./dsh-tui', 'file:./dsh-tui', 'github:org/dsh-tui', 'other@1.0.0', 'dsh-tui']) {
    await assert.rejects(
      installClientOnlyProfile({ dshHome: home, packageSpec, runInstall: false }),
      /registry package|must be dsh-tui|include a registry version/,
    )
  }
})

test('uninstall removes only the TUI dependency and bundle', async () => {
  const home = await tempHome()
  await installClientOnlyProfile({ dshHome: home, packageSpec: 'dsh-tui@0.1.0-mvp.1', runInstall: false })
  const profile = { dshHome: home }
  await uninstallClientOnlyProfile(profile)
  const manifest = JSON.parse(await readFile(join(home, 'profiles', 'tui', 'package.json'), 'utf8')) as Record<string, any>
  assert.equal(manifest.dependencies, undefined)
  assert.deepEqual(manifest.dsh.profile.bundles, [])
})

test('profile snapshot detects unintended mutation', async () => {
  const home = await tempHome()
  const before = await snapshotProfile({ dshHome: home })
  await assertProfileUnchanged({ dshHome: home }, before)
})
