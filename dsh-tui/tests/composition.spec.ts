import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function patch(name: string): Array<Record<string, unknown>> {
  const value = YAML.parse(readFileSync(join(root, name), 'utf8'))
  if (!Array.isArray(value)) throw new Error(`${name} must be a patch list`)
  return value as Array<Record<string, unknown>>
}

describe('dual-surface profile composition', () => {
  it('reuses the Web profile code runtime and replaces only its startup owner', () => {
    const rows = patch('cordis.patch.yml').flatMap(row => Array.isArray(row.insert) ? row.insert : [])
    expect(rows.map(row => row.id)).not.toContain('tui-code-runtime')
    expect(rows.map(row => row.id)).not.toContain('code-runtime')
    expect(patch('cordis.patch.yml')).toContainEqual({ id: 'web-startup', disabled: true })
  })

  it('installs the dual-surface patch as the bundle default', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
      files?: string[]
      scripts?: Record<string, string>
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.files).not.toContain('cordis.web-tui.patch.yml')
    expect(manifest.scripts?.['release:install']).toBe('node scripts/release-install.mjs')
  })
})
