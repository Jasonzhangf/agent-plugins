import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname

function entriesOf(profile) {
  if (Array.isArray(profile)) return profile
  if (Array.isArray(profile.entries)) return profile.entries
  if (Array.isArray(profile.packages)) return profile.packages
  return []
}

function findEntry(profile, id, name) {
  return entriesOf(profile).find(entry => entry.id === id && entry.name === name)
}

export function assertPluginAbsent(profile) {
  const entry = findEntry(profile, 'multikey-provider', 'dsh-multikey-provider')
  if (entry !== undefined) throw new Error('restored profile: plugin entry must be absent')
  if (profile.pluginResourcesAbsent !== true) {
    throw new Error('restored profile: pool routes, namespace, RPCs, and client bundle must be absent')
  }
}

export function assertPostRestartRuntime(profile) {
  if (profile.runtime?.restarted !== true && profile.restarted !== true) {
    throw new Error('restored profile: exact restart evidence is required')
  }
}

export function assertOfficialOwners(profile) {
  const provider = findEntry(profile, 'llm-pi-ai', '@deepseek-ai/dsh-llm-pi-ai')
  const models = findEntry(profile, 'ui-settings-models', '@deepseek-ai/dsh-client-ui-settings-models')
  if (provider === undefined || provider.disabled === true) {
    throw new Error('restored profile: official Provider must be active')
  }
  if (models === undefined || models.disabled === true) {
    throw new Error('restored profile: official Models client must be active')
  }
}

export function replayOfficialPaths(profile) {
  if (profile.officialProviderReplay !== true || profile.officialModelsReplay !== true) {
    throw new Error('restored profile: official Provider and Models replays are required')
  }
}

export function verifyRestoredProfile(
  actual,
  expectedPath = join(root, 'docs/architecture/fixtures/restored-profile.dump-config.json'),
) {
  JSON.parse(readFileSync(expectedPath, 'utf8'))
  assertPluginAbsent(actual)
  assertPostRestartRuntime(actual)
  assertOfficialOwners(actual)
  replayOfficialPaths(actual)
  return true
}
