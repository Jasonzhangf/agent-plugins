import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import manifest from '../../../../contracts/tui/logic-controls/logic-controls.manifest.json' with { type: 'json' }
import type {
  LogicControlErrorShape,
  LogicControlErrorRecord,
  LogicControlEvent,
  LogicControlKind,
  LogicControlProjection,
} from '../../../../contracts/tui/logic-controls/logic-controls.types.ts'

export type { LogicControlProjection } from '../../../../contracts/tui/logic-controls/logic-controls.types.ts'

export const logicControlRegistryServiceName = 'tuiLogicControls' as const

type LogicControlManifestEntry = {
  readonly control: LogicControlKind
  readonly plugin: `tui.logic.${LogicControlKind}`
  readonly projection: `control.${LogicControlKind}`
  readonly lifecycle_owner: string
  readonly source_owner: string
  readonly source_resource: string
  readonly required_gates: readonly string[]
}

export type LogicControlSourceResource =
  | 'terminal_input_control'
  | 'tui_status_control'
  | 'tui_execution_control'
  | 'transport_control'
  | 'current_session_selection'
  | 'tui_app_event_bus'
  | 'logic_control_registry'

export interface LogicControlSourceCapability {
  readonly resource: LogicControlSourceResource
  dispatch(event: LogicControlEvent): LogicControlProjection
  dispose(): void
}

const logicControlManifest = Object.freeze(manifest.controls.map(entry => Object.freeze({ ...entry }))) as readonly LogicControlManifestEntry[]
const manifestByControl = new Map(logicControlManifest.map(entry => [entry.control, entry]))

if (logicControlManifest.length !== 7 || manifestByControl.size !== logicControlManifest.length
  || logicControlManifest.some(entry => entry.projection !== `control.${entry.control}` || entry.required_gates.length === 0)) {
  throw new TypeError('logic-control manifest must declare seven unique controls and plugins')
}

export interface LogicControlPlugin {
  readonly name: `tui.logic.${LogicControlKind}`
  readonly control: LogicControlKind
  readonly reduce: (event: LogicControlEvent, revision: number) => void
  readonly project: () => LogicControlProjection
  readonly dispose: () => void
}

export interface TuiLogicCordisPlugin {
  readonly name: `tui.logic.${LogicControlKind}`
  apply(ctx: Context): void
}

export interface TuiLogicControlRegistry {
  readonly name: typeof logicControlRegistryServiceName
  register(ownerContext: Context, plugin: LogicControlPlugin): () => void | Promise<void>
  bindSource(ownerContext: Context, resource: LogicControlSourceResource): LogicControlSourceCapability
  project(control: LogicControlKind): LogicControlProjection
  error(): LogicControlErrorRecord | null
  list(): readonly LogicControlKind[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiLogicControls: TuiLogicControlRegistry
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertControlEvent(value: unknown): asserts value is LogicControlEvent {
  if (!isPlainRecord(value) || typeof value['control'] !== 'string' || typeof value['action'] !== 'string') {
    throw new LogicControlError('unknown', 'invalid-event', 'logic control event must be a plain typed object')
  }
  const control = value['control']
  const action = value['action']
  if (!isLogicControlKind(control)) {
    throw new LogicControlError('unknown', 'invalid-event', `unsupported logic control event: ${control}/${action}`)
  }
  if (value['revision'] !== undefined && (!Number.isSafeInteger(value['revision']) || Number(value['revision']) < 0)) {
    throw new LogicControlError(control as LogicControlKind, 'invalid-event', 'control revision must be a non-negative integer')
  }
  switch (control) {
    case 'input':
      switch (action) {
        case 'edit':
          assertExactKeys(value, ['control', 'action', 'text', 'cursor', 'revision'])
          assertString(value['text'], 'input.text')
          assertCursor(value['cursor'], value['text'])
          return
        case 'submit':
          assertExactKeys(value, ['control', 'action', 'text', 'revision'])
          assertString(value['text'], 'input.text')
          if (value['text'].length === 0) throw new LogicControlError('input', 'invalid-transition', 'empty input cannot be submitted')
          return
        case 'fail':
          assertExactKeys(value, ['control', 'action', 'message', 'revision'])
          assertString(value['message'], 'input.message')
          return
      }
      break
    case 'status':
      if (action === 'set') {
        assertExactKeys(value, ['control', 'action', 'sessionId', 'cwd', 'mode', 'message', 'revision'])
        assertNullableString(value['sessionId'], 'status.sessionId')
        assertNullableString(value['cwd'], 'status.cwd')
        assertEnum(value['mode'], ['idle', 'streaming', 'tool', 'error'], 'status.mode')
        assertOptionalString(value['message'], 'status.message')
        return
      }
      break
    case 'connection':
      if (action === 'set') {
        assertExactKeys(value, ['control', 'action', 'state', 'message', 'revision'])
        assertEnum(value['state'], ['connecting', 'connected', 'disconnected', 'failed'], 'connection.state')
        assertOptionalString(value['message'], 'connection.message')
        return
      }
      break
    case 'execution':
      if (action === 'set') {
        assertExactKeys(value, ['control', 'action', 'state', 'turnId', 'message', 'revision'])
        assertEnum(value['state'], ['idle', 'running', 'completed', 'failed'], 'execution.state')
        assertNullableString(value['turnId'], 'execution.turnId')
        assertOptionalString(value['message'], 'execution.message')
        return
      }
      break
    case 'session':
      if (action === 'snapshot') {
        assertExactKeys(value, ['control', 'action', 'selectedSessionId', 'availableSessionIds', 'cwd', 'lifecycle', 'revision'])
        assertNullableString(value['selectedSessionId'], 'session.selectedSessionId')
        assertSessionIds(value['availableSessionIds'])
        if (value['selectedSessionId'] !== null && !(value['availableSessionIds'] as readonly string[]).includes(value['selectedSessionId'] as string)) {
          throw new LogicControlError('session', 'invalid-transition', 'selected session is outside the owner-provided session scope')
        }
        assertNullableString(value['cwd'], 'session.cwd')
        assertEnum(value['lifecycle'], ['active', 'terminated'], 'session.lifecycle')
        return
      }
      if (action === 'request-select') {
        assertExactKeys(value, ['control', 'action', 'sessionId', 'revision'])
        assertString(value['sessionId'], 'session.sessionId')
        return
      }
      break
    case 'slash-command':
      if (action === 'project') {
        assertExactKeys(value, ['control', 'action', 'command', 'args', 'accepted', 'input', 'revision'])
        assertNullableString(value['command'], 'slash-command.command')
        assertSessionIds(value['args'])
        if (typeof value['accepted'] !== 'boolean') throw new LogicControlError('slash-command', 'invalid-event', 'slash-command.accepted must be boolean')
        assertOptionalString(value['input'], 'slash-command.input')
        return
      }
      break
    case 'logo':
      if (action === 'set') {
        assertExactKeys(value, ['control', 'action', 'variant', 'visible', 'revision'])
        assertEnum(value['variant'], ['full', 'compact'], 'logo.variant')
        if (typeof value['visible'] !== 'boolean') throw new LogicControlError('logo', 'invalid-event', 'logo.visible must be boolean')
        return
      }
      break
  }
  throw new LogicControlError(control, 'invalid-event', `unsupported logic control event: ${control}/${action}`)
}

function isLogicControlKind(value: unknown): value is LogicControlKind {
  return value === 'input' || value === 'status' || value === 'connection' || value === 'execution'
    || value === 'session' || value === 'slash-command' || value === 'logo'
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
}

function assertOptionalString(value: unknown, label: string): void {
  if (value !== undefined) assertString(value, label)
}

function assertNullableString(value: unknown, label: string): void {
  if (value !== null) assertString(value, label)
}

function assertEnum<T extends string>(value: unknown, values: readonly T[], label: string): asserts value is T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new TypeError(`${label} is invalid`)
}

function assertCursor(value: unknown, text: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > text.length) {
    throw new LogicControlError('input', 'invalid-event', 'input cursor is outside text')
  }
}

function assertSessionIds(value: unknown): asserts value is readonly string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.length > 0)) {
    throw new LogicControlError('session', 'invalid-event', 'session list contains an invalid id')
  }
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) throw new LogicControlError(record['control'] as LogicControlKind, 'invalid-event', `unknown control field '${key}'`)
  }
  for (const key of allowed) {
    if (key !== 'revision' && key !== 'message' && key !== 'input' && !Object.hasOwn(record, key)) {
      throw new LogicControlError(record['control'] as LogicControlKind, 'invalid-event', `missing control field '${key}'`)
    }
  }
}

function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new RangeError('logic control revision must be a non-negative integer')
}

export class LogicControlError extends Error implements LogicControlErrorShape {
  readonly name = 'LogicControlError'
  constructor(
    readonly control: LogicControlKind | 'unknown',
    readonly code: LogicControlErrorShape['code'],
    message: string,
  ) {
    super(message)
  }
}

type AnyProjection = LogicControlProjection

abstract class BasePlugin {
  protected revision = 0
  protected disposed = false
  protected nextRevision(revision: number): number {
    if (this.disposed) throw new LogicControlError(this.control, 'disposed', `${this.control} plugin is disposed`)
    assertRevision(revision)
    if (revision < this.revision) throw new LogicControlError(this.control, 'stale-event', `${this.control} event revision is stale`)
    return revision
  }
  abstract readonly control: LogicControlKind
  abstract reduce(event: LogicControlEvent, revision: number): void
  abstract project(): AnyProjection
  dispose(): void { this.disposed = true }
}

class InputPlugin extends BasePlugin {
  readonly control = 'input' as const
  private text = ''
  private cursor = 0
  private mode: 'idle' | 'submitted' | 'error' = 'idle'
  private message: string | undefined
  reduce(event: LogicControlEvent, revision: number): void {
    const current = this.nextRevision(revision)
    if (event.control !== 'input') throw new LogicControlError(this.control, 'invalid-event', 'input plugin received another control event')
    if (event.action === 'edit') {
      assertString(event.text, 'input.text')
      if (!Number.isSafeInteger(event.cursor) || event.cursor < 0 || event.cursor > event.text.length) throw new LogicControlError(this.control, 'invalid-event', 'input cursor is outside text')
      this.text = event.text; this.cursor = event.cursor; this.mode = 'idle'; this.message = undefined
    } else if (event.action === 'submit') {
      assertString(event.text, 'input.text')
      this.text = ''; this.cursor = 0; this.mode = 'submitted'; this.message = undefined
    } else {
      assertString(event.message, 'input.message'); this.mode = 'error'; this.message = event.message
    }
    this.revision = current
  }
  project(): LogicControlProjection { return { control: 'input', stableKey: 'control.input', text: this.text, cursor: this.cursor, mode: this.mode, ...(this.message === undefined ? {} : { message: this.message }), revision: this.revision } }
}

class StatusPlugin extends BasePlugin {
  readonly control = 'status' as const
  private sessionId: string | null = null
  private cwd: string | null = null
  private mode: 'idle' | 'streaming' | 'tool' | 'error' = 'idle'
  private message: string | undefined
  reduce(event: LogicControlEvent, revision: number): void {
    this.nextRevision(revision)
    if (event.control !== 'status' || event.action !== 'set') throw new LogicControlError(this.control, 'invalid-event', 'status plugin received another control event')
    if (event.sessionId !== null) assertString(event.sessionId, 'status.sessionId')
    if (event.cwd !== null) assertString(event.cwd, 'status.cwd')
    this.sessionId = event.sessionId; this.cwd = event.cwd; this.mode = event.mode; this.message = event.message; this.revision = revision
  }
  project(): LogicControlProjection { return { control: 'status', stableKey: 'control.status', sessionId: this.sessionId, cwd: this.cwd, mode: this.mode, ...(this.message === undefined ? {} : { message: this.message }), revision: this.revision } }
}

class ConnectionPlugin extends BasePlugin {
  readonly control = 'connection' as const
  private state: 'connecting' | 'connected' | 'disconnected' | 'failed' = 'disconnected'
  private message: string | undefined
  reduce(event: LogicControlEvent, revision: number): void {
    this.nextRevision(revision)
    if (event.control !== 'connection' || event.action !== 'set') throw new LogicControlError(this.control, 'invalid-event', 'connection plugin received another control event')
    this.state = event.state; this.message = event.message; this.revision = revision
  }
  project(): LogicControlProjection { return { control: 'connection', stableKey: 'control.connection', state: this.state, ...(this.message === undefined ? {} : { message: this.message }), revision: this.revision } }
}

class ExecutionPlugin extends BasePlugin {
  readonly control = 'execution' as const
  private state: 'idle' | 'running' | 'completed' | 'failed' = 'idle'
  private turnId: string | null = null
  private message: string | undefined
  reduce(event: LogicControlEvent, revision: number): void {
    this.nextRevision(revision)
    if (event.control !== 'execution' || event.action !== 'set') throw new LogicControlError(this.control, 'invalid-event', 'execution plugin received another control event')
    this.state = event.state; this.turnId = event.turnId; this.message = event.message; this.revision = revision
  }
  project(): LogicControlProjection { return { control: 'execution', stableKey: 'control.execution', state: this.state, turnId: this.turnId, ...(this.message === undefined ? {} : { message: this.message }), revision: this.revision } }
}

class SessionPlugin extends BasePlugin {
  readonly control = 'session' as const
  private selectedSessionId: string | null = null
  private availableSessionIds: readonly string[] = []
  private cwd: string | null = null
  private lifecycle: 'active' | 'terminated' = 'active'
  private requestedSessionId: string | null = null
  reduce(event: LogicControlEvent, revision: number): void {
    this.nextRevision(revision)
    if (event.control !== 'session') throw new LogicControlError(this.control, 'invalid-event', 'session plugin received another control event')
    if (event.action === 'snapshot') {
      const availableSessionIds = Object.freeze([...new Set(event.availableSessionIds)])
      if (event.selectedSessionId !== null && !availableSessionIds.includes(event.selectedSessionId)) {
        throw new LogicControlError(this.control, 'invalid-transition', 'selected session is outside the owner-provided session scope')
      }
      this.selectedSessionId = event.selectedSessionId
      this.availableSessionIds = availableSessionIds
      this.cwd = event.cwd
      this.lifecycle = event.lifecycle
      this.requestedSessionId = null
    } else {
      assertString(event.sessionId, 'session.sessionId')
      if (this.lifecycle === 'terminated') {
        throw new LogicControlError(this.control, 'invalid-transition', 'cannot request selection from a terminated session')
      }
      if (!this.availableSessionIds.includes(event.sessionId)) {
        throw new LogicControlError(this.control, 'invalid-transition', 'session selection is outside the owner-provided session scope')
      }
      if (this.selectedSessionId === event.sessionId || this.requestedSessionId === event.sessionId) {
        throw new LogicControlError(this.control, 'invalid-transition', 'session selection is already active')
      }
      this.requestedSessionId = event.sessionId
    }
    this.revision = revision
  }
  project(): LogicControlProjection { return { control: 'session', stableKey: 'control.session', selectedSessionId: this.selectedSessionId, availableSessionIds: this.availableSessionIds, cwd: this.cwd, lifecycle: this.lifecycle, requestedSessionId: this.requestedSessionId, revision: this.revision } }
}

class SlashCommandPlugin extends BasePlugin {
  readonly control = 'slash-command' as const
  private input: string | undefined
  private command: string | null = null
  private args: readonly string[] = []
  private accepted = false
  reduce(event: LogicControlEvent, revision: number): void {
    this.nextRevision(revision)
    if (event.control !== 'slash-command' || event.action !== 'project') throw new LogicControlError(this.control, 'invalid-event', 'slash command plugin received another control event')
    if (!event.accepted || event.command === null || !event.command.startsWith('/')) throw new LogicControlError(this.control, 'unknown-command', 'app-shell rejected slash command')
    this.input = event.input; this.command = event.command; this.args = Object.freeze([...event.args]); this.accepted = event.accepted; this.revision = revision
  }
  project(): LogicControlProjection { return { control: 'slash-command', stableKey: 'control.slash-command', ...(this.input === undefined ? {} : { input: this.input }), command: this.command, args: this.args, accepted: this.accepted, revision: this.revision } }
}

class LogoPlugin extends BasePlugin {
  readonly control = 'logo' as const
  private variant: 'full' | 'compact' = 'full'
  private visible = true
  reduce(event: LogicControlEvent, revision: number): void {
    this.nextRevision(revision)
    if (event.control !== 'logo' || event.action !== 'set') throw new LogicControlError(this.control, 'invalid-event', 'logo plugin received another control event')
    this.variant = event.variant; this.visible = event.visible; this.revision = revision
  }
  project(): LogicControlProjection { return { control: 'logo', stableKey: 'control.logo', variant: this.variant, visible: this.visible, revision: this.revision } }
}

function createPlugin(control: LogicControlKind): BasePlugin {
  switch (control) {
    case 'input': return new InputPlugin()
    case 'status': return new StatusPlugin()
    case 'connection': return new ConnectionPlugin()
    case 'execution': return new ExecutionPlugin()
    case 'session': return new SessionPlugin()
    case 'slash-command': return new SlashCommandPlugin()
    case 'logo': return new LogoPlugin()
  }
}

export class TuiLogicControlRegistryService extends Service implements TuiLogicControlRegistry {
  readonly name = logicControlRegistryServiceName
  private readonly plugins = new Map<LogicControlKind, LogicControlPlugin>()
  private disposed = false
  private lastError: LogicControlErrorRecord | null = null
  private errorSequence = 0
  constructor(ctx: Context) {
    super(ctx, logicControlRegistryServiceName)
    ctx.effect(() => () => {
      this.disposed = true
      for (const plugin of this.plugins.values()) plugin.dispose()
      this.plugins.clear()
      this.lastError = null
    }, 'logic-controls.dispose')
  }
  register(ownerContext: Context, plugin: LogicControlPlugin): () => void | Promise<void> {
    if (this.disposed) throw this.recordError(new LogicControlError('unknown', 'disposed', 'logic control registry is disposed'))
    if (!ownerContext || typeof ownerContext.effect !== 'function') throw this.recordError(new LogicControlError('unknown', 'invalid-event', 'logic control registration requires an owning Cordis context'))
    if (!plugin || typeof plugin !== 'object' || typeof plugin.control !== 'string' || typeof plugin.name !== 'string' || typeof plugin.reduce !== 'function' || typeof plugin.project !== 'function' || typeof plugin.dispose !== 'function') {
      throw this.recordError(new LogicControlError('unknown', 'invalid-event', 'logic control plugin is invalid'))
    }
    const declared = manifestByControl.get(plugin.control as LogicControlKind)
    if (!declared || declared.plugin !== plugin.name || declared.projection !== `control.${plugin.control}` || declared.lifecycle_owner !== plugin.name) {
      throw this.recordError(new LogicControlError((plugin.control as LogicControlKind) || 'unknown', 'invalid-event', 'logic control plugin is not declared by the manifest'))
    }
    if (this.plugins.has(plugin.control)) throw this.recordError(new LogicControlError(plugin.control, 'duplicate-plugin', `${plugin.control} plugin is already registered`))
    this.plugins.set(plugin.control, plugin)
    let active = true
    const remove = () => {
      if (!active) return
      active = false
      if (this.plugins.get(plugin.control) === plugin) {
        plugin.dispose()
        this.plugins.delete(plugin.control)
      }
    }
    try { return ownerContext.effect(() => remove, `logic-controls.${plugin.control}`) } catch (error) { remove(); throw error }
  }
  bindSource(ownerContext: Context, resource: LogicControlSourceResource): LogicControlSourceCapability {
    if (this.disposed) throw this.recordError(new LogicControlError('unknown', 'disposed', 'logic control registry is disposed'))
    if (!ownerContext || typeof ownerContext.effect !== 'function') throw this.recordError(new LogicControlError('unknown', 'invalid-event', 'logic control source requires an owning Cordis context'))
    if (!logicControlManifest.some(entry => entry.source_resource === resource)) {
      throw this.recordError(new LogicControlError('unknown', 'invalid-event', `logic control source is not declared by the manifest: ${resource}`))
    }
    let active = true
    const capability: LogicControlSourceCapability = {
      resource,
      dispatch: (event) => {
        if (!active) throw this.recordError(new LogicControlError('unknown', 'disposed', `logic control source is disposed: ${resource}`))
        const declared = isPlainRecord(event) && isLogicControlKind(event['control'])
          ? manifestByControl.get(event['control'])
          : undefined
        if (!declared || declared.source_resource !== resource) {
          throw this.recordError(new LogicControlError(isPlainRecord(event) && isLogicControlKind(event['control']) ? event['control'] : 'unknown', 'invalid-event', `logic control event is not owned by source resource: ${resource}`))
        }
        return this.dispatchFromSource(resource, event)
      },
      dispose: () => { active = false },
    }
    try {
      ownerContext.effect(() => capability.dispose, `logic-controls.source.${resource}`)
    } catch (error) {
      capability.dispose()
      throw error
    }
    return Object.freeze(capability)
  }
  private dispatchFromSource(_resource: LogicControlSourceResource, event: LogicControlEvent): LogicControlProjection {
    let revision = this.globalRevision + 1
    try {
      revision = this.nextGlobalRevisionForError(event)
      assertControlEvent(event)
      const plugin = this.plugins.get(event.control)
      if (!plugin) throw new LogicControlError(event.control, 'invalid-transition', `${event.control} plugin is not registered`)
      plugin.reduce(event, revision)
      this.globalRevision = Math.max(this.globalRevision, revision)
      return plugin.project()
    } catch (error) {
      const typedError = error instanceof LogicControlError
        ? error
        : new LogicControlError(isPlainRecord(event) && isLogicControlKind(event['control']) ? event['control'] : 'unknown', 'invalid-event', error instanceof Error ? error.message : String(error))
      const eventRevision = isPlainRecord(event) && Number.isSafeInteger(event['revision']) ? Number(event['revision']) : undefined
      this.recordError(typedError, eventRevision)
      throw typedError
    }
  }
  project(control: LogicControlKind): LogicControlProjection {
    const plugin = this.plugins.get(control)
    if (!plugin) throw this.recordError(new LogicControlError(control, 'invalid-transition', `${control} plugin is not registered`))
    return plugin.project()
  }
  list(): readonly LogicControlKind[] { return Object.freeze([...this.plugins.keys()]) }
  error(): LogicControlErrorRecord | null { return this.lastError }
  private recordError(error: LogicControlError, eventRevision?: number): LogicControlError {
    this.lastError = Object.freeze({ control: error.control, code: error.code, message: error.message, revision: ++this.errorSequence, ...(eventRevision === undefined ? {} : { eventRevision }) })
    return error
  }
  private globalRevision = 0
  private nextGlobalRevisionForError(event: unknown): number {
    if (isPlainRecord(event) && Object.hasOwn(event, 'revision')) {
      if (!Number.isSafeInteger(event['revision']) || Number(event['revision']) < 0) {
        throw new LogicControlError(isPlainRecord(event) && isLogicControlKind(event['control']) ? event['control'] : 'unknown', 'invalid-event', 'control revision must be a non-negative integer')
      }
      const revision = Number(event['revision'])
      if (revision <= this.globalRevision) {
        throw new LogicControlError(isPlainRecord(event) && isLogicControlKind(event['control']) ? event['control'] : 'unknown', 'stale-event', 'control revision must be newer than the global revision')
      }
      return revision
    }
    return this.globalRevision + 1
  }
}

export const logicControlPluginNames = Object.freeze(logicControlManifest.map(entry => entry.plugin))

export function createLogicControlPlugin(control: LogicControlKind): LogicControlPlugin {
  const declared = manifestByControl.get(control)
  if (!declared) throw new LogicControlError(control, 'invalid-event', `logic control is not declared: ${control}`)
  const implementation = createPlugin(control)
  return Object.freeze({
    name: declared.plugin,
    control,
    reduce: implementation.reduce.bind(implementation),
    project: implementation.project.bind(implementation),
    dispose: implementation.dispose.bind(implementation),
  })
}

export function createLogicControlCordisPlugin(control: LogicControlKind): TuiLogicCordisPlugin {
  const declared = manifestByControl.get(control)
  if (!declared) throw new LogicControlError(control, 'invalid-event', `logic control is not declared: ${control}`)
  const name = declared.plugin
  return Object.freeze({
    name,
    apply(ctx: Context): void {
      ctx.tuiLogicControls.register(ctx, createLogicControlPlugin(control))
    },
  })
}

export const logicControlPlugins = Object.freeze(logicControlManifest.map(entry => createLogicControlCordisPlugin(entry.control)))

export function apply(ctx: Context): void {
  new TuiLogicControlRegistryService(ctx)
}

export function applyInput(ctx: Context): void { logicControlPlugins[0]!.apply(ctx) }
export function applyStatus(ctx: Context): void { logicControlPlugins[1]!.apply(ctx) }
export function applyConnection(ctx: Context): void { logicControlPlugins[2]!.apply(ctx) }
export function applyExecution(ctx: Context): void { logicControlPlugins[3]!.apply(ctx) }
export function applySession(ctx: Context): void { logicControlPlugins[4]!.apply(ctx) }
export function applySlashCommand(ctx: Context): void { logicControlPlugins[5]!.apply(ctx) }
export function applyLogo(ctx: Context): void { logicControlPlugins[6]!.apply(ctx) }
