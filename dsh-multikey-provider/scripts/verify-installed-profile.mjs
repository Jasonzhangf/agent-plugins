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

export function assertOfficialProviderActive(profile) {
  const provider = findEntry(profile, 'llm-pi-ai', '@deepseek-ai/dsh-llm-pi-ai')
  if (provider === undefined || provider.disabled === true) {
    throw new Error('installed profile: official Provider must remain active')
  }
}

export function assertModelsClientReplaced(profile) {
  const models = findEntry(profile, 'ui-settings-models', '@deepseek-ai/dsh-client-ui-settings-models')
  if (models === undefined || models.disabled !== true) {
    throw new Error('installed profile: official Models client must be disabled by exact name')
  }
}

export function assertMultikeyEntryActive(profile) {
  const entry = findEntry(profile, 'multikey-provider', 'dsh-multikey-provider')
  if (entry === undefined || entry.disabled === true) {
    throw new Error('installed profile: multikey-provider entry must be active')
  }
}

export function assertInstalledOwners(profile) {
  const assertions = profile.owner_assertions ?? profile.ownersVerified
  if (assertions !== true) {
    throw new Error('installed profile: runtime route, namespace, and Models owners were not verified')
  }
}

export function verifyInstalledProfile(
  actual,
  expectedPath = join(root, 'docs/architecture/fixtures/installed-profile.dump-config.json'),
) {
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'))
  assertOfficialProviderActive(actual)
  assertModelsClientReplaced(actual)
  assertMultikeyEntryActive(actual)
  assertInstalledOwners(actual)
  for (const marker of expected.forbidden ?? []) {
    if (actual.forbiddenObserved?.includes(marker)) {
      throw new Error(`installed profile: forbidden condition observed: ${marker}`)
    }
  }
  return true
}
