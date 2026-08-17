import { readFile } from 'node:fs/promises'
import yaml from 'js-yaml'

function parseProfile(text) {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return JSON.parse(text)
  return yaml.load(text.replace(/!!js[\t ]*/gu, ''))
}

function entriesOf(profile) {
  if (Array.isArray(profile)) return profile
  if (Array.isArray(profile?.entries)) return profile.entries
  if (Array.isArray(profile?.required_entries)) return profile.required_entries
  throw new Error('dump-config does not contain a top-level entry list')
}

function countsOf(profile, evidence) {
  if (profile.unique_owner_counts !== undefined) return profile.unique_owner_counts
  if (evidence.unique_owner_counts !== undefined) return evidence.unique_owner_counts
  throw new Error('live YAML dump-config requires an evidence JSON path with unique_owner_counts')
}

const EXPECTED = new Map([
  ['llm-pi-ai', { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', disabled: true }],
  ['ui-settings-models', { id: 'ui-settings-models', name: '@deepseek-ai/dsh-client-ui-settings-models', disabled: true }],
  ['llm-pi-ai-multikey', { id: 'llm-pi-ai-multikey', name: 'dsh-llm-pi-ai-multikey', disabled: false }],
])

function entryTuple(entry) {
  return `${entry?.id}|${entry?.name}|${String(entry?.disabled === true)}`
}

export function assertInstalledEntries(entries) {
  for (const [id, expected] of EXPECTED) {
    const actual = entries.find(entry => entry.id === id)
    if (entryTuple(actual) !== entryTuple(expected)) {
      throw new Error(`installed profile entry ${id} does not match the exact target tuple`)
    }
  }
}

export function assertInstalledOwnerCounts(counts) {
  for (const [resource, expected] of Object.entries({
    provider_routes: 1,
    'settings_namespace:llm-pi-ai': 1,
    'settings_section:models': 1,
  })) {
    if (counts[resource] !== expected) {
      throw new Error(`installed ${resource} owner count is ${String(counts[resource])}, expected ${String(expected)}`)
    }
  }
}

export async function verifyInstalledProfile(path, evidencePath) {
  const raw = parseProfile(await readFile(path, 'utf8'))
  const entries = entriesOf(raw)
  const evidence = evidencePath === undefined ? {} : JSON.parse(await readFile(evidencePath, 'utf8'))
  const counts = countsOf(raw, evidence)
  assertInstalledEntries(entries)
  assertInstalledOwnerCounts(counts)
  const base = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {}
  return { ...base, ...evidence, entries, unique_owner_counts: counts }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2]
  if (path === undefined) throw new Error('usage: node scripts/verify-installed-profile.mjs <dump-config.yaml|json> [owner-counts.json]')
  await verifyInstalledProfile(path, process.argv[3])
}
