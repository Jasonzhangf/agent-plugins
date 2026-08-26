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

function entryTuple(entry) {
  return `${entry?.id}|${entry?.name}|${String(entry?.disabled === true)}`
}

export function assertReplacementBundleAbsent(entries) {
  if (entries.some(entry => entry.id === 'multikey-provider')) {
    throw new Error('restored profile still contains the plugin entry')
  }
}

export function assertOfficialOwners(entries) {
  for (const [id, name] of [
    ['llm-pi-ai', '@deepseek-ai/dsh-llm-pi-ai'],
    ['ui-settings-models', '@deepseek-ai/dsh-client-ui-settings-models'],
  ]) {
    const entry = entries.find(candidate => candidate.id === id)
    if (entryTuple(entry) !== `${id}|${name}|false`) {
      throw new Error(`restored profile entry ${id} is not the active official owner`)
    }
  }
}

export function assertPostRestartRuntime(profile) {
  if (profile.restart_evidence !== 'exact service or PID-scoped DSH restart completed') {
    throw new Error('restore evidence must include an exact restart, not a hot reload')
  }
}

export async function replayOfficialPaths(profile) {
  for (const path of profile.original_paths ?? []) {
    if (path.status !== 'ok') {
      throw new Error(`restored original path ${path.name} did not replay successfully`)
    }
  }
  return profile
}

export async function verifyRestoredProfile(path, evidencePath) {
  const raw = parseProfile(await readFile(path, 'utf8'))
  const entries = entriesOf(raw)
  const evidence = evidencePath === undefined ? {} : JSON.parse(await readFile(evidencePath, 'utf8'))
  const counts = countsOf(raw, evidence)
  const profile = {
    ...(typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {}),
    ...evidence,
    entries,
    unique_owner_counts: counts,
  }
  assertReplacementBundleAbsent(entries)
  assertOfficialOwners(entries)
  assertPostRestartRuntime(profile)
  for (const [resource, expected] of Object.entries({
    official_provider_routes: 1,
    'settings_namespace:llm-pi-ai': 1,
    'settings_section:models': 1,
  })) {
    if (counts[resource] !== expected) {
      throw new Error(`restored ${resource} owner count is not ${String(expected)}`)
    }
  }
  return replayOfficialPaths(profile)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2]
  if (path === undefined) throw new Error('usage: node scripts/verify-restored-profile.mjs <dump-config.yaml|json> [owner-counts.json]')
  await verifyRestoredProfile(path, process.argv[3])
}
