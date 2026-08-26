import Schema from '@deepseek-ai/schemastery'
import type { SettingsSchemaOperations } from '../../src/client/schema-operations.js'

/** Schema operations for unit tests, structurally identical to the settings service. */
export const testSchema: SettingsSchemaOperations = {
  rehydrate: serialized => new Schema(serialized as Schema),
  validate: (schema, draft) => {
    try {
      ;(schema as unknown as (value: unknown) => unknown)(draft)
      return undefined
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  },
  nodeAtPath: (root, path) => {
    let node: unknown = root
    for (const key of path) {
      if (node === undefined) return undefined
      if (typeof node !== 'object' || node === null) return undefined
      const record = node as Record<string, unknown>
      if (record.type === 'object') node = (record.dict as Record<string, unknown> | undefined)?.[key]
      else if (record.type === 'dict' || record.type === 'array') node = record.inner
      else return undefined
    }
    return node as Schema
  },
  getPath: (value, path) => {
    let current: unknown = value
    for (const key of path) {
      if (Array.isArray(current)) {
        current = current[Number(key)]
        continue
      }
      if (typeof current !== 'object' || current === null) return undefined
      current = (current as Record<string, unknown>)[key]
    }
    return current
  },
  hasPath: (value, path) => {
    if (path.length === 0) return value !== undefined
    const parent = testSchema.getPath(value, path.slice(0, -1))
    const key = path[path.length - 1] ?? ''
    if (Array.isArray(parent)) return Number(key) < parent.length
    if (typeof parent !== 'object' || parent === null) return false
    return key in parent
  },
  setPath: (root, path, value) => {
    if (path.length === 0) throw new Error('schema-form: setPath needs a non-empty path')
    const clone = structuredClone(root)
    let current: unknown = clone
    for (const key of path.slice(0, -1)) {
      if (Array.isArray(current)) current = current[Number(key)]
      else if (typeof current === 'object' && current !== null) current = (current as Record<string, unknown>)[key]
    }
    const leaf = path[path.length - 1] ?? ''
    if (Array.isArray(current)) current[Number(leaf)] = value
    else if (typeof current === 'object' && current !== null) (current as Record<string, unknown>)[leaf] = value
    return clone
  },
  deletePath: (root, path) => {
    if (path.length === 0) throw new Error('schema-form: deletePath needs a non-empty path')
    if (!testSchema.hasPath(root, path)) return root
    const clone = structuredClone(root)
    let current: unknown = clone
    for (const key of path.slice(0, -1)) {
      if (Array.isArray(current)) current = current[Number(key)]
      else if (typeof current === 'object' && current !== null) current = (current as Record<string, unknown>)[key]
    }
    const leaf = path[path.length - 1] ?? ''
    if (Array.isArray(current)) current.splice(Number(leaf), 1)
    else if (typeof current === 'object' && current !== null) Reflect.deleteProperty(current as Record<string, unknown>, leaf)
    return clone
  },
}
