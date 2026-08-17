import { mkdtempSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureStoreLink } from '../scripts/release-install.mjs'

describe('global DSH plugin store', () => {
  it('creates an idempotent link to the extension-volume store', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-store-'))
    const link = join(root, '.dsh-plugins')
    const target = join(root, 'extension', 'dsh-plugins')

    ensureStoreLink(link, target)
    ensureStoreLink(link, target)

    expect(readlinkSync(link)).toBe(target)
  })

  it('refuses to replace an existing directory or a link to another store', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-store-'))
    const directory = join(root, '.dsh-plugins-directory')
    const target = join(root, 'extension', 'dsh-plugins')
    mkdirSync(directory)

    expect(() => ensureStoreLink(directory, target)).toThrow('is not a symbolic link')

    const file = join(root, '.dsh-plugins-file')
    writeFileSync(file, 'occupied')
    expect(() => ensureStoreLink(file, target)).toThrow('is not a symbolic link')

    const otherTarget = join(root, 'other-store')
    const wrongLink = join(root, '.dsh-plugins-wrong-link')
    mkdirSync(otherTarget)
    symlinkSync(otherTarget, wrongLink, 'dir')
    expect(() => ensureStoreLink(wrongLink, target)).toThrow('points to')
  })
})
