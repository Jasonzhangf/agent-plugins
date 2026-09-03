import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, resolve } from 'node:path'

export const fixtureContractServiceName = 'tuiFixtureContract' as const

export interface TuiFixtureViewport {
  readonly columns: number
  readonly rows: number
}

export interface TuiCanonicalNode {
  readonly nodeId: string
  readonly kind: string
  readonly publicationRevision: number
  readonly lifecycle: 'streaming' | 'settled' | 'interrupted' | 'failed'
  readonly turnId?: string
  readonly stepId?: string
  readonly timestamp?: number
  readonly value: Readonly<Record<string, unknown>>
}

export interface TuiFixtureCase {
  readonly fixtureId: string
  readonly componentKind: string
  readonly viewport: TuiFixtureViewport
  readonly node: TuiCanonicalNode
}

export interface TuiFixtureManifestEntry {
  readonly fixtureId: string
  readonly componentKind: string
  readonly viewport: TuiFixtureViewport
  readonly file: string
}

export interface TuiFixtureManifest {
  readonly schema_version: 1
  readonly bundleId: string
  readonly fixtures: readonly TuiFixtureManifestEntry[]
}

export interface TuiFixtureBundle {
  readonly manifest: TuiFixtureManifest
  readonly cases: ReadonlyMap<string, TuiFixtureCase>
  readonly bundleHash: string
}

export interface TuiFixtureContract {
  readonly loadBundle: (root: string) => TuiFixtureBundle
  readonly validateManifest: (value: unknown) => TuiFixtureManifest
  readonly validateCase: (value: unknown) => TuiFixtureCase
  readonly sha256: (value: string) => string
}

const FORBIDDEN_CONTROL_KEYS = new Set([
  'transport', 'frame', 'muxFrame', 'hostFrame', 'rpcFrame',
  'rpc', 'session_event', 'sessionEvent', 'event', 'seq', 'sequence',
  'endpoint', 'rpcId', 'envelope', 'metadata', 'health', 'snapshot',
  'revisionAck', 'control', 'debug', 'route', 'routing', 'switch',
  'switching', 'continuation', 'retry', 'attempt', 'backoff', 'provider',
  'stopless', 'servertool',
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertSafeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`fixture-contract: ${path} must be a non-negative safe integer`)
  }
  return value
}

function assertPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`fixture-contract: ${path} must be a positive safe integer`)
  }
  return value
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`fixture-contract: ${path} must be a non-empty string`)
  }
  return value
}

function assertViewport(value: unknown, path: string): TuiFixtureViewport {
  if (!isPlainObject(value)) throw new TypeError(`fixture-contract: ${path} must be a plain object`)
  return Object.freeze({
    columns: assertPositiveInteger(value['columns'], `${path}.columns`),
    rows: assertPositiveInteger(value['rows'], `${path}.rows`),
  })
}

function assertNoControlLeak(value: unknown, path: string): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoControlLeak(item, `${path}[${index}]`))
    return
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_CONTROL_KEYS.has(key)) {
      throw new TypeError(`fixture-contract: forbidden control field '${key}' at ${path}`)
    }
    assertNoControlLeak((value as Record<string, unknown>)[key], `${path}.${key}`)
  }
}

function assertClosedObject(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) throw new TypeError(`fixture-contract: ${path} must be a plain object`)
  const record = value as Record<string, unknown>
  assertNoControlLeak(record, path)
  return Object.freeze({ ...record })
}

export function validateCanonicalNode(value: unknown): TuiCanonicalNode {
  if (!isPlainObject(value)) throw new TypeError('fixture-contract: canonical node must be a plain object')
  const nodeId = assertString(value['nodeId'], 'node.nodeId')
  const kind = assertString(value['kind'], 'node.kind')
  const publicationRevision = assertSafeInteger(value['publicationRevision'], 'node.publicationRevision')
  const lifecycle = value['lifecycle']
  if (lifecycle !== 'streaming' && lifecycle !== 'settled' && lifecycle !== 'interrupted' && lifecycle !== 'failed') {
    throw new TypeError(`fixture-contract: node.lifecycle is not closed: ${String(lifecycle)}`)
  }
  return Object.freeze({
    nodeId,
    kind,
    publicationRevision,
    lifecycle,
    value: assertClosedObject(value['value'], 'node.value'),
    ...(value['turnId'] === undefined ? {} : { turnId: assertString(value['turnId'], 'node.turnId') }),
    ...(value['stepId'] === undefined ? {} : { stepId: assertString(value['stepId'], 'node.stepId') }),
    ...(value['timestamp'] === undefined ? {} : { timestamp: assertSafeInteger(value['timestamp'], 'node.timestamp') }),
  })
}

export function validateFixtureCase(value: unknown): TuiFixtureCase {
  if (!isPlainObject(value)) throw new TypeError('fixture-contract: fixture case must be a plain object')
  const fixtureId = assertString(value['fixtureId'], 'case.fixtureId')
  const componentKind = assertString(value['componentKind'], 'case.componentKind')
  return Object.freeze({
    fixtureId,
    componentKind,
    viewport: assertViewport(value['viewport'], 'case.viewport'),
    node: validateCanonicalNode(value['node']),
  })
}

export function validateManifest(value: unknown): TuiFixtureManifest {
  if (!isPlainObject(value)) throw new TypeError('fixture-contract: manifest must be a plain object')
  if (value['schema_version'] !== 1) throw new TypeError('fixture-contract: manifest schema_version must be 1')
  const bundleId = assertString(value['bundleId'], 'manifest.bundleId')
  if (!Array.isArray(value['fixtures']) || value['fixtures'].length === 0) {
    throw new TypeError('fixture-contract: manifest.fixtures must be a non-empty array')
  }
  const fixtures = Object.freeze(value['fixtures'].map((entry, index) => {
    if (!isPlainObject(entry)) throw new TypeError(`fixture-contract: manifest.fixtures[${index}] must be a plain object`)
    return Object.freeze({
      fixtureId: assertString(entry['fixtureId'], `manifest.fixtures[${index}].fixtureId`),
      componentKind: assertString(entry['componentKind'], `manifest.fixtures[${index}].componentKind`),
      viewport: assertViewport(entry['viewport'], `manifest.fixtures[${index}].viewport`),
      file: assertString(entry['file'], `manifest.fixtures[${index}].file`),
    })
  }))
  const ids = new Set<string>()
  for (const entry of fixtures) {
    if (ids.has(entry.fixtureId)) {
      throw new TypeError(`fixture-contract: duplicate fixtureId '${entry.fixtureId}'`)
    }
    ids.add(entry.fixtureId)
  }
  return Object.freeze({ schema_version: 1, bundleId, fixtures })
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

export function loadBundle(root: string): TuiFixtureBundle {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('fixture-contract: bundle root must be a non-empty path')
  }
  const manifestPath = isAbsolute(root) ? root : resolve(root)
  const manifestRoot = dirname(resolve(manifestPath, 'bundle.manifest.json'))
  const manifest = validateManifest(readJson(resolve(manifestRoot, 'bundle.manifest.json')))
  const cases = new Map<string, TuiFixtureCase>()
  const digest = createHash('sha256')
  digest.update(`${manifest.bundleId}\0`)
  for (const entry of manifest.fixtures) {
    const casePath = isAbsolute(entry.file) ? entry.file : resolve(manifestRoot, entry.file)
    const raw = readJson(casePath)
    const fixtureCase = validateFixtureCase(raw)
    if (fixtureCase.fixtureId !== entry.fixtureId) {
      throw new TypeError(`fixture-contract: case fixtureId '${fixtureCase.fixtureId}' does not match manifest '${entry.fixtureId}'`)
    }
    if (fixtureCase.componentKind !== entry.componentKind) {
      throw new TypeError(`fixture-contract: case kind '${fixtureCase.componentKind}' does not match manifest '${entry.componentKind}'`)
    }
    if (fixtureCase.viewport.columns !== entry.viewport.columns || fixtureCase.viewport.rows !== entry.viewport.rows) {
      throw new TypeError(`fixture-contract: case viewport does not match manifest for '${entry.fixtureId}'`)
    }
    if (cases.has(entry.fixtureId)) {
      throw new TypeError(`fixture-contract: duplicate loaded fixture '${entry.fixtureId}'`)
    }
    cases.set(entry.fixtureId, fixtureCase)
    digest.update(`${entry.fixtureId}\0${entry.file}\0`)
    digest.update(sha256(readFileSync(casePath, 'utf8')))
    digest.update('\0')
  }
  return Object.freeze({
    manifest,
    cases,
    bundleHash: digest.digest('hex'),
  })
}

export const fixtureContract: TuiFixtureContract = Object.freeze({
  loadBundle,
  validateManifest,
  validateCase: validateFixtureCase,
  sha256,
})
