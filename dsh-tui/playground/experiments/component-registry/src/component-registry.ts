import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import contractManifest from '#tui-component-registry-manifest' with { type: 'json' }
import type {
  ComponentGroup,
  ComponentManifest,
  ComponentRegistration,
  TuiComponentProps,
  TuiElementDescriptor,
  TuiIntent,
  TuiRenderOutput,
} from '../../../../contracts/tui/component-registry/component-registry.types.ts'
import type { TuiComponentRegistry as TuiComponentRegistryFace } from '../../../../contracts/tui/component-registry/terminal-ui.registry-face.ts'

export type {
  ComponentGroup,
  ComponentManifest,
  ComponentRegistration,
  TuiComponentProps,
  TuiElementDescriptor,
  TuiIntent,
  TuiRenderOutput,
} from '../../../../contracts/tui/component-registry/component-registry.types.ts'

export const componentRegistryServiceName = 'tuiComponentRegistry' as const

export interface TuiComponentRegistry extends TuiComponentRegistryFace {
  readonly name: typeof componentRegistryServiceName
}

const manifest = freezeManifest(contractManifest as ComponentManifest)
const knownGroups = new Map(manifest.groups.map(group => [group.group_id, group]))
const knownKinds = new Map(
  manifest.groups.flatMap(group => group.members.map(kind => [`${group.group_id}\0${kind}`, group] as const)),
)

function freezeManifest(value: ComponentManifest): ComponentManifest {
  return Object.freeze({
    schema_version: 1,
    groups: Object.freeze(value.groups.map(group => Object.freeze({
      group_id: group.group_id,
      registry_face: group.registry_face,
      zone: group.zone,
      members: Object.freeze([...group.members]),
    }))),
  })
}

function assertPlainData(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  const seen = new Set<object>()
  const walk = (current: unknown, path: string): void => {
    if (current === null || typeof current !== 'object') return
    if (seen.has(current as object)) return
    seen.add(current as object)
    if (Array.isArray(current)) {
      current.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    const prototype = Object.getPrototypeOf(current)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`renderer props must use plain objects or arrays at ${path}`)
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      walk(child, `${path}.${key}`)
    }
  }
  walk(value, 'props')
}

function assertComponentProps(value: unknown): asserts value is TuiComponentProps {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('renderer props must use a typed TUI component contract')
  }
  const record = value as Record<string, unknown>
  if (record['contract'] === 'tui.presentation-node.v1') {
    if (!hasOnlyKeys(record, ['contract', 'node'])) {
      throw new TypeError('presentation component props contain unknown fields')
    }
    const node = record['node']
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      throw new TypeError('presentation component props require a node')
    }
    const nodeRecord = node as Record<string, unknown>
    if (!hasOnlyKeys(nodeRecord, ['nodeId', 'kind', 'publicationRevision', 'lifecycle', 'turnId', 'stepId', 'timestamp', 'value'])
      || typeof nodeRecord['nodeId'] !== 'string'
      || typeof nodeRecord['kind'] !== 'string'
      || !Number.isSafeInteger(nodeRecord['publicationRevision'])
      || !['streaming', 'settled', 'interrupted', 'failed'].includes(String(nodeRecord['lifecycle']))
      || nodeRecord['value'] === null
      || typeof nodeRecord['value'] !== 'object'
      || Array.isArray(nodeRecord['value'])) {
      throw new TypeError('presentation component props contain an invalid node')
    }
    return
  }
  if (record['contract'] === 'tui.interaction-state.v1') {
    if (!hasOnlyKeys(record, ['contract', 'state'])
      || record['state'] === null
      || typeof record['state'] !== 'object'
      || Array.isArray(record['state'])) {
      throw new TypeError('interaction component props contain invalid state')
    }
    return
  }
  throw new TypeError('renderer props must use a typed TUI component contract')
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(record).every(key => allowedKeys.has(key))
}

function assertRendererOutput(value: unknown, path: string): void {
  if (value === null) return
  if (typeof value !== 'object') {
    throw new TypeError(`renderer output must be a TuiElementDescriptor, TuiIntent, or null at ${path}; got ${typeof value}`)
  }
  assertPlainData(value)
  const output = value as Record<string, unknown>
  if (output['contract'] === 'tui.element.v1') {
    if (!hasOnlyKeys(output, ['contract', 'elementType', 'props', 'children', 'intents', 'collapsed'])
      || typeof output['elementType'] !== 'string'
      || output['elementType'].length === 0) {
      throw new TypeError(`TuiElementDescriptor is invalid at ${path}`)
    }
    if (output['collapsed'] !== undefined && typeof output['collapsed'] !== 'boolean') {
      throw new TypeError(`TuiElementDescriptor.collapsed must be boolean at ${path}`)
    }
    if (output['children'] !== undefined) {
      if (!Array.isArray(output['children'])) {
        throw new TypeError(`TuiElementDescriptor.children must be an array at ${path}`)
      }
      output['children'].forEach((child, index) => assertElementDescriptor(child, `${path}.children[${index}]`))
    }
    if (output['intents'] !== undefined) {
      if (!Array.isArray(output['intents'])) {
        throw new TypeError(`TuiElementDescriptor.intents must be an array at ${path}`)
      }
      output['intents'].forEach((intent, index) => assertIntent(intent, `${path}.intents[${index}]`))
    }
    return
  }
  if (output['contract'] === 'tui.intent.v1') {
    return assertIntent(value, path)
  }
  throw new TypeError(`renderer output must use a typed TUI output contract at ${path}`)
}

function assertElementDescriptor(value: unknown, path: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`TuiElementDescriptor child must be an object at ${path}`)
  }
  assertRendererOutput(value, path)
}

function assertIntent(value: unknown, path: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`TuiIntent must be an object at ${path}`)
  }
  const intent = value as Record<string, unknown>
  if (!hasOnlyKeys(intent, ['contract', 'intent', 'payload'])
    || intent['contract'] !== 'tui.intent.v1'
    || typeof intent['intent'] !== 'string'
    || intent['intent'].length === 0) {
    throw new TypeError(`TuiIntent requires non-empty intent at ${path}`)
  }
}

function assertKnownGroup(groupId: string): ComponentGroup {
  const group = knownGroups.get(groupId)
  if (!group) throw new TypeError(`unknown component group: ${groupId}`)
  return group
}

function assertKnownKind(groupId: string, kind: string): void {
  assertKnownGroup(groupId)
  if (!knownKinds.has(`${groupId}\0${kind}`)) {
    throw new TypeError(`unknown component kind: ${groupId}/${kind}`)
  }
}

export class TuiComponentRegistryService extends Service implements TuiComponentRegistry {
  readonly name = componentRegistryServiceName
  private readonly registrations = new Map<string, ComponentRegistration>()
  private readonly owners = new Map<string, string>()

  constructor(ctx: Context) {
    super(ctx, componentRegistryServiceName)
    ctx.effect(() => () => {
      this.registrations.clear()
      this.owners.clear()
    }, 'component-registry.registrations')
  }

  register(ownerContext: Context, registration: ComponentRegistration): () => void | Promise<void> {
    if (!ownerContext || typeof ownerContext.effect !== 'function') {
      throw new TypeError('component registration requires its owning Cordis context')
    }
    if (!registration || typeof registration !== 'object') {
      throw new TypeError('component registration must be an object')
    }
    const { groupId, kind, owner, validateProps, render } = registration
    if (typeof groupId !== 'string' || typeof kind !== 'string' || typeof owner !== 'string' || owner.length === 0) {
      throw new TypeError('component registration requires groupId, kind, and owner')
    }
    if (typeof validateProps !== 'function' || typeof render !== 'function') {
      throw new TypeError('component registration requires validateProps and render functions')
    }
    assertKnownKind(groupId, kind)
    const key = `${groupId}\0${kind}`
    if (this.registrations.has(key) || this.owners.has(owner)) {
      throw new Error(`duplicate owner or component kind: ${owner}`)
    }
    const stored = Object.freeze({ groupId, kind, owner, validateProps, render })
    this.registrations.set(key, stored)
    this.owners.set(owner, key)
    let active = true
    const remove = () => {
      if (!active) return
      active = false
      if (this.registrations.get(key) === stored) this.registrations.delete(key)
      if (this.owners.get(owner) === key) this.owners.delete(owner)
    }
    try {
      return ownerContext.effect(() => remove, `component-registry.registration.${owner}`)
    } catch (error) {
      remove()
      throw error
    }
  }

  resolve(groupId: string, kind: string): ComponentRegistration {
    assertKnownKind(groupId, kind)
    const registration = this.registrations.get(`${groupId}\0${kind}`)
    if (!registration) throw new Error(`component is not registered: ${groupId}/${kind}`)
    return registration
  }

  render(groupId: string, kind: string, props: TuiComponentProps): TuiRenderOutput {
    const registration = this.resolve(groupId, kind)
    assertPlainData(props)
    assertComponentProps(props)
    if (!registration.validateProps(props)) {
      throw new TypeError(`invalid props for component: ${groupId}/${kind}`)
    }
    const output = registration.render(props)
    assertRendererOutput(output, `render:${groupId}/${kind}`)
    return output
  }

  compileManifest(): ComponentManifest {
    return manifest
  }
}

export const name = 'component-registry'

export function apply(ctx: Context): void {
  new TuiComponentRegistryService(ctx)
}
