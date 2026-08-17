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
  it('keeps the TUI-only code-runtime row separately named', () => {
    const rows = patch('cordis.patch.yml').flatMap(row => Array.isArray(row.insert) ? row.insert : [])
    expect(rows.map(row => row.id)).toContain('tui-code-runtime')
    expect(rows.map(row => row.id)).not.toContain('code-runtime')
  })

  it('disables the Web startup provider and duplicate TUI code-runtime in dual mode', () => {
    const rows = patch('cordis.web-tui.patch.yml')
    expect(rows).toContainEqual({ id: 'web-startup', disabled: true })
    expect(rows).toContainEqual({ id: 'tui-code-runtime', disabled: true })
  })

  it('ships the dual overlay inside the npm package', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      files?: string[]
    }
    expect(manifest.files).toContain('cordis.web-tui.patch.yml')
  })
})
