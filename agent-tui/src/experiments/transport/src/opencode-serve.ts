/** OpenCode `serve` protocol boundary for the agent-tui Cordis runtime. */

import type { AgentResult, AgentRemote, SessionFollowFrame, SessionSummary, SessionWireEvent, TuiForwardedEventResult } from './transport.ts'
import { realpath } from 'node:fs/promises'

export const DEFAULT_OPENCODE_ENDPOINT = 'http://127.0.0.1:4096'

const NON_TRANSCRIPT_OPENCODE_EVENTS = new Set([
  'server.connected',
  'server.heartbeat',
  'session.updated',
  'session.diff',
])

export function resolveOpenCodeEndpoint(value = DEFAULT_OPENCODE_ENDPOINT): URL {
  return validateEndpoint(value)
}

export type OpenCodeSession = {
  readonly id: string
  readonly title: string
  readonly directory: string
  readonly path?: string
  readonly summary?: Record<string, unknown>
  readonly tokens?: {
    readonly input?: number
    readonly output?: number
    readonly reasoning?: number
    readonly cache?: { readonly read?: number; readonly write?: number }
  }
  readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
  readonly [key: string]: unknown
}

export type OpenCodeAgent = {
  readonly name: string
  readonly mode: 'primary' | 'subagent' | 'all'
  readonly hidden?: boolean
  readonly description?: string
  readonly [key: string]: unknown
}

type OpenCodeConfiguredModel = {
  readonly id: string
  readonly name: string
  readonly status?: string
  readonly capabilities?: { readonly reasoning?: boolean }
  readonly variants?: Record<string, unknown>
  readonly [key: string]: unknown
}

type OpenCodeConfiguredProvider = {
  readonly id: string
  readonly name: string
  readonly models: Record<string, OpenCodeConfiguredModel>
  readonly [key: string]: unknown
}

type OpenCodeProviderCatalog = {
  readonly providers: readonly OpenCodeConfiguredProvider[]
  readonly default: Record<string, string>
}

export type OpenCodeEvent = {
  readonly id?: string
  readonly type: string
  readonly properties: unknown
}

/**
 * Protocol-independent event facts consumed by session/presentation owners.
 * The adaptor owns decoding OpenCode; downstream code never inspects the
 * OpenCode envelope or guesses whether an event is business or control data.
 */
export type OpenCodeSemanticEvent =
  | { readonly kind: 'message'; readonly sessionId: string; readonly messageId: string; readonly role: 'user' | 'assistant'; readonly info: Record<string, unknown> }
  | { readonly kind: 'text'; readonly sessionId: string; readonly messageId: string; readonly partId: string; readonly text: string; readonly streaming: boolean }
  | { readonly kind: 'reasoning'; readonly sessionId: string; readonly messageId: string; readonly partId: string; readonly text: string; readonly streaming: boolean }
  | { readonly kind: 'delta'; readonly sessionId: string; readonly messageId: string; readonly partId: string; readonly field: 'text'; readonly delta: string }
  | { readonly kind: 'tool'; readonly sessionId: string; readonly messageId: string; readonly partId: string; readonly callId: string; readonly name: string; readonly status: 'pending' | 'running' | 'completed' | 'failed'; readonly input: Record<string, unknown>; readonly output?: string; readonly error?: string }
  | { readonly kind: 'status'; readonly sessionId: string; readonly status: 'idle' | 'busy' | 'retry' }
  | { readonly kind: 'error'; readonly sessionId: string; readonly message: string }
  | { readonly kind: 'permission'; readonly sessionId: string; readonly requestId: string; readonly permission: string; readonly patterns: readonly string[] }
  | { readonly kind: 'question'; readonly sessionId: string; readonly requestId: string; readonly questions: readonly Record<string, unknown>[] }
  | { readonly kind: 'unknown'; readonly eventType: string; readonly properties: unknown }

export type OpenCodeServeClientOptions = {
  readonly endpoint?: string
  readonly directory?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
}

export class OpenCodeHttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`OpenCode serve request failed (${status})${body ? `: ${body}` : ''}`)
    this.name = 'OpenCodeHttpError'
  }
}

function validateEndpoint(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError(`invalid OpenCode endpoint: ${value}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`OpenCode endpoint must use http: or https:, got ${url.protocol}`)
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new TypeError('OpenCode endpoint must be an origin without credentials, query, or path')
  }
  return new URL(url.origin)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: Record<string, unknown>, key: string, context: string): string {
  const result = value[key]
  if (typeof result !== 'string' || result.length === 0) throw new TypeError(`OpenCode ${context} requires ${key}`)
  return result
}

function parseProviderCatalog(value: unknown): OpenCodeProviderCatalog {
  if (!isRecord(value) || !Array.isArray(value['providers']) || !isRecord(value['default'])) {
    throw new TypeError('OpenCode provider catalog requires providers and default')
  }
  const providers: OpenCodeConfiguredProvider[] = []
  for (const candidate of value['providers']) {
    if (!isRecord(candidate)) throw new TypeError('OpenCode provider catalog contains an invalid provider')
    const id = requiredString(candidate, 'id', 'provider catalog provider id')
    const name = requiredString(candidate, 'name', 'provider catalog provider name')
    const modelsValue = candidate['models']
    if (!isRecord(modelsValue)) throw new TypeError(`OpenCode provider ${id} requires models`)
    const models: Record<string, OpenCodeConfiguredModel> = {}
    for (const [modelKey, modelValue] of Object.entries(modelsValue)) {
      if (!isRecord(modelValue)) throw new TypeError(`OpenCode provider ${id} model ${modelKey} is invalid`)
      const modelId = requiredString(modelValue, 'id', `provider ${id} model id`)
      const modelName = requiredString(modelValue, 'name', `provider ${id} model name`)
      if (modelId !== modelKey) throw new TypeError(`OpenCode provider ${id} model key does not match id`)
      if (modelValue['status'] !== undefined && typeof modelValue['status'] !== 'string') {
        throw new TypeError(`OpenCode provider ${id} model ${modelId} has an invalid status`)
      }
      if (modelValue['capabilities'] !== undefined && !isRecord(modelValue['capabilities'])) {
        throw new TypeError(`OpenCode provider ${id} model ${modelId} has invalid capabilities`)
      }
      if (modelValue['variants'] !== undefined && !isRecord(modelValue['variants'])) {
        throw new TypeError(`OpenCode provider ${id} model ${modelId} has invalid variants`)
      }
      models[modelId] = modelValue as OpenCodeConfiguredModel
    }
    providers.push({ id, name, models, ...candidate } as OpenCodeConfiguredProvider)
  }
  const defaults: Record<string, string> = {}
  for (const [providerId, modelId] of Object.entries(value['default'])) {
    if (typeof modelId !== 'string' || modelId.length === 0) throw new TypeError(`OpenCode provider ${providerId} has an invalid default model`)
    const provider = providers.find(candidate => candidate.id === providerId)
    if (provider === undefined || provider.models[modelId] === undefined) {
      throw new TypeError(`OpenCode provider ${providerId} default model ${modelId} is unavailable`)
    }
    defaults[providerId] = modelId
  }
  return { providers, default: defaults }
}

function projectProviderCatalog(catalog: OpenCodeProviderCatalog): {
  readonly default: { readonly provider: string; readonly model: string }
  readonly groups: readonly {
    readonly id: string
    readonly name: string
    readonly models: readonly {
      readonly id: string
      readonly name: string
      readonly reasoning?: { readonly efforts: readonly { readonly id: string; readonly name: string }[] }
    }[]
  }[]
} {
  const defaultEntry = Object.entries(catalog.default)[0]
  if (defaultEntry === undefined) throw new TypeError('OpenCode provider catalog has no default model')
  return {
    default: { provider: defaultEntry[0], model: defaultEntry[1] },
    groups: catalog.providers.map(provider => ({
      id: provider.id,
      name: provider.name,
      models: Object.values(provider.models).map(model => {
        const variants = model.variants === undefined ? [] : Object.keys(model.variants)
        const reasoning = model.capabilities?.reasoning === true || variants.length > 0
        return {
          id: model.id,
          name: model.name,
          ...(reasoning && variants.length > 0 ? { reasoning: { efforts: variants.map(id => ({ id, name: id })) } } : {}),
        }
      }),
    })),
  }
}

function projectConfiguredDefault(catalog: OpenCodeProviderCatalog, config: unknown): { readonly provider: string; readonly model: string } {
  if (!isRecord(config) || typeof config['model'] !== 'string') {
    throw new TypeError('OpenCode global config requires model')
  }
  const separator = config['model'].indexOf('/')
  if (separator <= 0 || separator === config['model'].length - 1) {
    throw new TypeError('OpenCode global config model must be provider/model')
  }
  const provider = config['model'].slice(0, separator)
  const model = config['model'].slice(separator + 1)
  const configuredProvider = catalog.providers.find(candidate => candidate.id === provider)
  if (configuredProvider === undefined || configuredProvider.models[model] === undefined) {
    throw new TypeError(`OpenCode global config model ${config['model']} is unavailable`)
  }
  return { provider, model }
}

function eventProperties(event: OpenCodeEvent, context: string): Record<string, unknown> {
  if (!isRecord(event.properties)) throw new TypeError(`OpenCode ${context} properties must be an object`)
  return event.properties
}

function sessionId(properties: Record<string, unknown>, context: string): string {
  return requiredString(properties, 'sessionID', context)
}

function parseToolPart(properties: Record<string, unknown>): OpenCodeSemanticEvent {
  const part = properties['part']
  if (!isRecord(part) || part['type'] !== 'tool') throw new TypeError('OpenCode message.part.updated requires a tool part')
  const state = part['state']
  if (!isRecord(state) || typeof state['status'] !== 'string') throw new TypeError('OpenCode tool part requires a valid state')
  const status = state['status']
  if (status !== 'pending' && status !== 'running' && status !== 'completed' && status !== 'error') {
    throw new TypeError(`OpenCode tool part has unknown state ${status}`)
  }
  const input = state['input']
  if (!isRecord(input)) throw new TypeError('OpenCode tool state input must be an object')
  const result: OpenCodeSemanticEvent = {
    kind: 'tool',
    sessionId: sessionId(properties, 'tool part'),
    messageId: requiredString(part, 'messageID', 'tool part'),
    partId: requiredString(part, 'id', 'tool part'),
    callId: requiredString(part, 'callID', 'tool part'),
    name: requiredString(part, 'tool', 'tool part'),
    status: status === 'error' ? 'failed' : status,
    input,
  }
  if (typeof state['output'] === 'string') return { ...result, output: state['output'] }
  if (typeof state['error'] === 'string') return { ...result, error: state['error'] }
  return result
}

type OpenCodeToolKind = 'terminal' | 'read' | 'search' | 'diff' | 'workflow' | 'skill' | 'generic'

function toolKindForName(name: string): OpenCodeToolKind {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/gu, '_')
  if (normalized === 'skill' || normalized.endsWith('_skill')) return 'skill'
  if (/(^|_)(bash|shell|execute|run|terminal|command)(_|$)/u.test(normalized)) return 'terminal'
  if (/(^|_)(read|read_file|readfile|cat)(_|$)/u.test(normalized)) return 'read'
  if (/(^|_)(grep|glob|search|find|list|list_files|ls|websearch|webfetch)(_|$)/u.test(normalized)) return 'search'
  if (/(^|_)(edit|str_replace_editor|write|write_file|apply_patch|patch)(_|$)/u.test(normalized)) return 'diff'
  if (/(^|_)(task|todo|todowrite|todoread|question|permission|agent|subtask)(_|$)/u.test(normalized)) return 'workflow'
  return 'generic'
}

function toolTitle(properties: Record<string, unknown>): string | undefined {
  const part = properties['part']
  if (!isRecord(part) || !isRecord(part['state'])) return undefined
  const title = part['state']['title']
  return typeof title === 'string' && title.length > 0 ? title : undefined
}

function hasOpenCodeSessionWork(session: OpenCodeSession): boolean {
  if (isRecord(session.summary)) return true
  const tokens = session.tokens
  if (!isRecord(tokens)) return false
  const tokenValues = tokens as Record<string, unknown>
  if (['input', 'output', 'reasoning'].some(key => {
    const value = tokenValues[key]
    return typeof value === 'number' && value > 0
  })) return true
  const cache = tokenValues['cache']
  return isRecord(cache) && ['read', 'write'].some(key => {
    const value = (cache as Record<string, unknown>)[key]
    return typeof value === 'number' && value > 0
  })
}

/** Decode one OpenCode v1 `/event` item into typed semantic facts. */
export function parseOpenCodeSemanticEvent(event: OpenCodeEvent): OpenCodeSemanticEvent {
  if (event.type === 'message.updated') {
    const properties = eventProperties(event, event.type)
    const info = properties['info']
    if (!isRecord(info) || (info['role'] !== 'user' && info['role'] !== 'assistant')) {
      throw new TypeError('OpenCode message.updated requires a user or assistant message')
    }
    return {
      kind: 'message',
      sessionId: sessionId(properties, event.type),
      messageId: requiredString(info, 'id', 'message.updated info'),
      role: info['role'],
      info,
    }
  }
  if (event.type === 'message.part.updated') {
    const properties = eventProperties(event, event.type)
    const part = properties['part']
    if (!isRecord(part) || typeof part['type'] !== 'string') throw new TypeError('OpenCode message.part.updated requires a typed part')
    if (part['type'] === 'tool') return parseToolPart(properties)
    if (part['type'] !== 'text' && part['type'] !== 'reasoning') {
      return { kind: 'unknown', eventType: `message.part.updated:${part['type']}`, properties: event.properties }
    }
    const text = part['text']
    if (typeof text !== 'string') throw new TypeError(`OpenCode ${part['type']} part requires text`)
    const time = part['time']
    const streaming = !isRecord(time) || time['end'] === undefined
    return {
      kind: part['type'],
      sessionId: sessionId(properties, event.type),
      messageId: requiredString(part, 'messageID', `${part['type']} part`),
      partId: requiredString(part, 'id', `${part['type']} part`),
      text,
      streaming,
    }
  }
  if (event.type === 'message.part.delta') {
    const properties = eventProperties(event, event.type)
    if (properties['field'] !== 'text') throw new TypeError('OpenCode message.part.delta requires text field')
    return {
      kind: 'delta',
      sessionId: sessionId(properties, event.type),
      messageId: requiredString(properties, 'messageID', event.type),
      partId: requiredString(properties, 'partID', event.type),
      field: 'text',
      delta: requiredString(properties, 'delta', event.type),
    }
  }
  if (event.type === 'session.status') {
    const properties = eventProperties(event, event.type)
    const status = properties['status']
    if (!isRecord(status) || typeof status['type'] !== 'string') throw new TypeError('OpenCode session.status requires a typed status')
    const type = status['type']
    if (type !== 'idle' && type !== 'busy' && type !== 'retry') throw new TypeError(`OpenCode session.status has unknown status ${type}`)
    return { kind: 'status', sessionId: sessionId(properties, event.type), status: type }
  }
  if (event.type === 'session.idle') {
    const properties = eventProperties(event, event.type)
    return { kind: 'status', sessionId: sessionId(properties, event.type), status: 'idle' }
  }
  if (event.type === 'session.error') {
    const properties = eventProperties(event, event.type)
    const error = properties['error']
    const message = isRecord(error) && typeof error['data'] === 'string'
      ? error['data']
      : isRecord(error) && typeof error['message'] === 'string'
        ? error['message']
        : typeof error === 'string' ? error : 'OpenCode session error'
    return { kind: 'error', sessionId: sessionId(properties, event.type), message }
  }
  if (event.type === 'permission.asked') {
    const properties = eventProperties(event, event.type)
    const patterns = properties['patterns']
    if (!Array.isArray(patterns) || !patterns.every(item => typeof item === 'string')) throw new TypeError('OpenCode permission.asked requires string patterns')
    return {
      kind: 'permission',
      sessionId: sessionId(properties, event.type),
      requestId: requiredString(properties, 'id', event.type),
      permission: requiredString(properties, 'permission', event.type),
      patterns,
    }
  }
  if (event.type === 'question.asked') {
    const properties = eventProperties(event, event.type)
    const questions = properties['questions']
    if (!Array.isArray(questions) || !questions.every(isRecord)) throw new TypeError('OpenCode question.asked requires question objects')
    return {
      kind: 'question',
      sessionId: sessionId(properties, event.type),
      requestId: requiredString(properties, 'id', event.type),
      questions,
    }
  }
  return { kind: 'unknown', eventType: event.type, properties: event.properties }
}

function parseSseBlock(block: string): OpenCodeEvent | null {
  let id: string | undefined
  const data: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('id:')) id = line.slice(3).trimStart()
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (data.length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data.join('\n'))
  } catch (error) {
    throw new Error(`OpenCode event contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string' || !Object.hasOwn(parsed, 'properties')) {
    throw new Error('OpenCode event must contain {type, properties}')
  }
  return { ...(id === undefined ? {} : { id }), type: parsed.type, properties: parsed.properties }
}

async function* readSse(response: Response): AsyncIterable<OpenCodeEvent> {
  if (!response.body) throw new Error('OpenCode event stream has no response body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (true) {
      const chunk = await reader.read()
      pending += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done })
      const blocks = pending.split(/\r?\n\r?\n/)
      pending = blocks.pop() ?? ''
      for (const block of blocks) {
        const event = parseSseBlock(block)
        if (event) yield event
      }
      if (chunk.done) {
        const event = parseSseBlock(pending)
        if (event) yield event
        return
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export class OpenCodeServeClient {
  readonly endpoint: URL
  readonly directory: string | undefined
  private readonly fetchImpl: typeof fetch
  private readonly headers: Readonly<Record<string, string>>

  constructor(options: OpenCodeServeClientOptions = {}) {
    this.endpoint = validateEndpoint(options.endpoint ?? DEFAULT_OPENCODE_ENDPOINT)
    this.directory = options.directory
    this.fetchImpl = options.fetchImpl ?? fetch
    this.headers = { accept: 'application/json', ...options.headers }
  }

  get origin(): string {
    return this.endpoint.origin
  }

  get remote(): AgentRemote {
    const unsupported = <T>(operation: string): Promise<AgentResult<T>> =>
      Promise.reject(new Error(`OpenCode adaptor does not implement ${operation}`))
    const toSummary = (session: OpenCodeSession): SessionSummary => ({
      sessionId: session.id,
      cwd: session.directory,
      running: false,
      updatedAt: session.time.updated,
      blank: !hasOpenCodeSessionWork(session),
      origin: 'root',
      projections: {},
    } as unknown as SessionSummary)
    const remote: AgentRemote = {
      session: {
        list: async () => ({ ok: true, value: { items: (await this.listSessions()).map(toSummary) } }),
        create: async request => {
          const requestRecord = request as unknown as Record<string, unknown>
          const requestedSessionId = requestRecord['sessionId']
          if (typeof requestedSessionId === 'string' && requestedSessionId.length > 0) {
            const session = await this.getSession(requestedSessionId)
            if (this.directory !== undefined && !(await this.directoriesMatch(session.directory, this.directory))) {
              throw new Error(`OpenCode session ${requestedSessionId} belongs to a different directory`)
            }
            return { ok: true, value: { sessionId: session.id } }
          }
          const agentPreset = requestRecord['agentPreset']
          const created = await this.createSession({
            ...(typeof agentPreset === 'string' && agentPreset.length > 0 ? { agent: agentPreset } : {}),
          })
          return { ok: true, value: { sessionId: created.id } }
        },
        fork: request => unsupported(`session/fork (${request.sessionId})`),
        openWorkspacePath: request => unsupported(`session/openWorkspacePath (${request.path})`),
        page: request => unsupported(`session/page (${request.address.kind})`),
        follow: (request, signal) => {
          if (request.address.kind !== 'session') throw new Error('OpenCode adaptor cannot follow a subagent address')
          return this.followAsLegacy(request.address.sessionId, signal)
        },
        control: signal => this.waitForAbort(signal),
        prompt: async (request, signal) => {
          const text = request.content
            .filter((part: any): part is { readonly type: 'text'; readonly text: string } => part.type === 'text')
            .map((part: { readonly type: 'text'; readonly text: string }) => part.text)
            .join('')
          await this.prompt(request.sessionId, text, signal)
          return { ok: true, value: { accepted: true } }
        },
        updateQueue: (request: any) => unsupported(`session/updateQueue (${request.sessionId})`),
        cancel: async request => {
          await this.abort(request.sessionId)
          return { ok: true, value: { accepted: true } }
        },
        selectModel: request => unsupported(`session/selectModel (${request.sessionId})`),
        modelCatalog: async () => {
          const catalog = await this.providerCatalog()
          return { ok: true, value: { ...projectProviderCatalog(catalog), default: projectConfiguredDefault(catalog, await this.request('/global/config')) } }
        },
        search: () => unsupported('session/search'),
        rename: (request: any) => unsupported(`session/rename (${request.sessionId})`),
      },
      workspace: {
        follow: (signal: AbortSignal) => this.waitForAbort(signal),
        list: () => unsupported('workspace/list'),
        create: (request: any) => unsupported(`workspace/create (${request.path})`),
        rename: (request: any) => unsupported(`workspace/rename (${request.workspaceId})`),
        delete: (request: any) => unsupported(`workspace/delete (${request.workspaceId})`),
        archiveSession: (request: any) => unsupported(`workspace/archiveSession (${request.sessionId})`),
      },
      directoryPicker: {
        list: () => unsupported('directoryPicker/list'),
        pick: () => unsupported('directoryPicker/pick'),
        createDirectory: () => unsupported('directoryPicker/createDirectory'),
      },
      settings: {
        describe: () => unsupported('settings/describe'),
        mutate: () => unsupported('settings/mutate'),
        openSettingsDocument: () => unsupported('settings/openSettingsDocument'),
      },
      credentials: { describe: () => unsupported('credentials/describe') },
      agentPresets: {
        list: async () => ({
          ok: true,
          value: {
            presets: (await this.listAgents()).map(agent => ({
              id: agent.name,
              name: agent.name,
              ...(agent.description === undefined ? {} : { description: agent.description }),
            })),
            authorable: false,
          },
        }),
        select: () => unsupported('agent/select'),
        read: () => unsupported('agent/read'),
        copy: () => unsupported('agent/copy'),
        deletePreset: () => unsupported('agent/delete'),
      },
      goals: {
        pause: () => unsupported('goals/pause'),
        resume: () => unsupported('goals/resume'),
        clear: () => unsupported('goals/clear'),
        edit: () => unsupported('goals/edit'),
      },
      llm: {
        listProviders: async () => ({
          ok: true,
          value: {
            providers: (await this.providerCatalog()).providers.map(provider => ({ id: provider.id, name: provider.name })),
          },
        }),
        listConfigurableProviders: () => unsupported('provider/list'),
        discoverModels: () => unsupported('model/list'),
      },
      skills: { list: () => unsupported('skill/list') },
      subagents: {
        list: () => unsupported('session/children'),
        prompt: () => unsupported('session/children/prompt'),
        interruptByParent: () => unsupported('session/children/abort'),
      },
      commands: { execute: () => unsupported('session/command') },
      events: {
        follow: signal => this.waitForAbort(signal),
        respond: async () => undefined,
      },
    } as AgentRemote
    return remote
  }

  health(): Promise<unknown> {
    return this.request('/global/health')
  }

  async providerCatalog(): Promise<OpenCodeProviderCatalog> {
    const query = this.directory ? `?directory=${encodeURIComponent(this.directory)}` : ''
    return parseProviderCatalog(await this.request<unknown>(`/config/providers${query}`))
  }

  async listAgents(): Promise<readonly OpenCodeAgent[]> {
    const query = this.directory ? `?directory=${encodeURIComponent(this.directory)}` : ''
    const response = await this.request<readonly OpenCodeAgent[]>(`/agent${query}`)
    if (!Array.isArray(response)) throw new Error('OpenCode agent response must be an array')
    for (const agent of response) {
      if (!isRecord(agent) || typeof agent.name !== 'string'
        || (agent.mode !== 'primary' && agent.mode !== 'subagent' && agent.mode !== 'all')) {
        throw new Error('OpenCode agent response contains an invalid agent')
      }
    }
    return response
  }

  async listSessions(options: { readonly limit?: number; readonly start?: number; readonly search?: string } = {}): Promise<readonly OpenCodeSession[]> {
    const query = new URLSearchParams()
    if (this.directory) query.set('directory', this.directory)
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    if (options.start !== undefined) query.set('start', String(options.start))
    if (options.search !== undefined) query.set('search', options.search)
    const response = await this.request<readonly OpenCodeSession[]>(`/session${query.size ? `?${query}` : ''}`)
    if (!Array.isArray(response)) throw new Error('OpenCode session list response must be an array')
    return response
  }

  async getSession(sessionId: string): Promise<OpenCodeSession> {
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new TypeError('OpenCode session id must be non-empty')
    const query = this.directory ? `?directory=${encodeURIComponent(this.directory)}` : ''
    const response = await this.request<OpenCodeSession>(`/session/${encodeURIComponent(sessionId)}${query}`)
    if (!isRecord(response) || typeof response.id !== 'string' || typeof response.directory !== 'string') {
      throw new Error('OpenCode session response is malformed')
    }
    return response as OpenCodeSession
  }

  private async directoriesMatch(left: string, right: string): Promise<boolean> {
    try {
      return (await realpath(left)) === (await realpath(right))
    } catch {
      return left === right
    }
  }

  async createSession(options: { readonly agent?: string; readonly model?: { readonly providerID: string; readonly id: string; readonly variant?: string } } = {}): Promise<OpenCodeSession> {
    const query = this.directory ? `?directory=${encodeURIComponent(this.directory)}` : ''
    const response = await this.request<OpenCodeSession>(`/session${query}`, {
      method: 'POST',
      body: JSON.stringify({
        ...(options.agent === undefined ? {} : { agent: options.agent }),
        ...(options.model === undefined ? {} : { model: options.model }),
      }),
    })
    if (!isRecord(response) || typeof response.id !== 'string') {
      throw new Error('OpenCode session create response must contain a session id')
    }
    return response as OpenCodeSession
  }

  async listMessages(sessionId: string, options: { readonly limit?: number; readonly before?: string } = {}): Promise<readonly unknown[]> {
    const query = new URLSearchParams()
    if (this.directory) query.set('directory', this.directory)
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    if (options.before !== undefined) query.set('before', options.before)
    const response = await this.request<readonly unknown[]>(`/session/${encodeURIComponent(sessionId)}/message${query.size ? `?${query}` : ''}`)
    if (!Array.isArray(response)) throw new Error('OpenCode session messages response must be an array')
    return response
  }

  async prompt(sessionId: string, text: string, signal?: AbortSignal): Promise<unknown> {
    if (text.length === 0) throw new TypeError('OpenCode prompt requires non-empty text')
    return this.request(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      method: 'POST',
      body: JSON.stringify({ parts: [{ type: 'text', text }] }),
      ...(signal === undefined ? {} : { signal }),
    })
  }

  abort(sessionId: string): Promise<unknown> {
    return this.request(`/session/${encodeURIComponent(sessionId)}/abort`, { method: 'POST' })
  }

  exportSessionLog(_sessionId: string, _includeChildren: boolean): Promise<Uint8Array> {
    return Promise.reject(new Error('OpenCode serve does not expose the DSH session export contract'))
  }

  async *events(signal?: AbortSignal): AsyncIterable<OpenCodeEvent> {
    const query = this.directory ? `?directory=${encodeURIComponent(this.directory)}` : ''
    const init: RequestInit = { headers: { accept: 'text/event-stream', ...this.headers } }
    if (signal) init.signal = signal
    const response = await this.fetchImpl(new URL(`/event${query}`, this.endpoint), init)
    if (!response.ok) throw new OpenCodeHttpError(response.status, await response.text())
    yield* readSse(response)
  }

  private async *waitForAbort(signal: AbortSignal): AsyncIterable<never> {
    if (signal.aborted) return
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
  }

  private async *followAsLegacy(sessionId: string, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    const messages = await this.listMessages(sessionId)
    const turnIds = new Map<string, number>()
    const partTexts = new Map<string, string>()
    const partKinds = new Map<string, 'text' | 'reasoning'>()
    const userMessageIds = new Set<string>()
    const terminalSessions = new Set<string>()
    let nextHistorySeq = 0
    const records = messages.flatMap(message => {
      const events = this.messageToLegacyEvent(message, nextHistorySeq)
      if (events === null) throw new TypeError('OpenCode session message is missing a valid info/parts shape')
      nextHistorySeq += events.length
      return events.map(event => ({ type: 'event', event }))
    })
    let nextSeq = records.length
    // Historical assistant nodes use their compact history sequence as the
    // presentation turn identity. Start live message identities after that
    // range so a new SSE assistant message cannot reuse an old node id.
    yield {
      type: 'snapshot',
      header: { sessionId } as never,
      cursor: records.length - 1,
      hasMore: false,
      records,
      projections: {},
    } as unknown as SessionFollowFrame
    for await (const event of this.events(signal)) {
      const properties = event.properties
      if (!isRecord(properties) || properties['sessionID'] !== sessionId) continue
      const wire = this.semanticEventToLegacy(event, turnIds, partTexts, partKinds, userMessageIds, terminalSessions, nextSeq, records.length + 1)
      if (wire === null) continue
      nextSeq += 1
      yield {
        type: 'event',
        event: wire,
      } as SessionFollowFrame
    }
  }

  private messageToLegacyEvent(message: unknown, seq: number): readonly SessionWireEvent[] | null {
    if (!isRecord(message) || !isRecord(message['info']) || !Array.isArray(message['parts'])) return null
    const info = message['info']
    const role = info['role']
    if (role !== 'user' && role !== 'assistant') return null
    const content: Array<{ readonly type: string; readonly text?: string; readonly url?: string; readonly mediaType?: string }> = []
    let toolPart: Record<string, unknown> | null = null
    for (const part of message['parts']) {
      if (!isRecord(part) || typeof part['type'] !== 'string') continue
      if ((part['type'] === 'text' || part['type'] === 'reasoning') && typeof part['text'] === 'string') {
        content.push({ type: part['type'], text: part['text'] })
      } else if (part['type'] === 'file' && typeof part['url'] === 'string') {
        content.push({ type: 'image', url: part['url'], mediaType: typeof part['mime'] === 'string' ? part['mime'] : 'application/octet-stream' })
      } else if (part['type'] === 'tool') {
        toolPart = part
      }
    }
    if (role === 'assistant' && toolPart !== null) {
      const state = toolPart['state']
      if (!isRecord(state) || (state['status'] !== 'pending' && state['status'] !== 'running' && state['status'] !== 'completed' && state['status'] !== 'error')) {
        throw new TypeError('OpenCode tool history part has an invalid state')
      }
      const callId = requiredString(toolPart, 'callID', 'tool history part')
      const name = requiredString(toolPart, 'tool', 'tool history part')
      const input = isRecord(state['input']) ? state['input'] : {}
      const time = isRecord(info['time']) && typeof info['time']['created'] === 'number' ? info['time']['created'] : Date.now()
      const title = typeof state['title'] === 'string' && state['title'].length > 0 ? state['title'] : undefined
      const call: SessionWireEvent = {
        type: 'tool/call', seq, time,
        data: {
          callId, turn: seq, step: 0, name, arguments: JSON.stringify(input),
          toolKind: 'tool.' + toolKindForName(name),
          ...(title === undefined ? {} : { title }),
          status: state['status'] === 'running' ? 'running' : 'pending',
        },
      }
      if (state['status'] === 'pending' || state['status'] === 'running') {
        return [call]
      }
      const error = typeof state['error'] === 'string' ? state['error'] : undefined
      const output = typeof state['output'] === 'string' ? state['output'] : error ?? ''
      const result: SessionWireEvent = {
        type: 'tool/result', seq, time,
        data: {
          turn: seq, step: 0,
          message: { source: { callId }, content: [{ type: 'text', text: output }] },
          name,
          toolKind: 'tool.' + toolKindForName(name),
          ...(title === undefined ? {} : { title }),
          ...(error === undefined ? {} : { error: { name: error } }),
        },
      } as SessionWireEvent
      return [call, { ...result, seq: seq + 1 }]
    }
    if (content.length === 0) return null
    const time = isRecord(info['time']) && typeof info['time']['created'] === 'number' ? info['time']['created'] : Date.now()
    if (role === 'user') {
      return [{ type: 'user/message', seq, time, data: { source: { kind: 'user' }, content } } as SessionWireEvent]
    }
    return [{
      type: 'assistant/message',
      seq,
      time,
      data: { turn: seq, step: 0, message: { content } },
    } as SessionWireEvent]
  }

  private semanticEventToLegacy(
    event: OpenCodeEvent,
    turnIds: Map<string, number>,
    partTexts: Map<string, string>,
    partKinds: Map<string, 'text' | 'reasoning'>,
    userMessageIds: Set<string>,
    terminalSessions: Set<string>,
    seq: number,
    liveTurnOffset: number,
  ): SessionWireEvent | null {
    if (NON_TRANSCRIPT_OPENCODE_EVENTS.has(event.type)) return null
    if (event.type === 'message.part.updated' && isRecord(event.properties)) {
      const part = event.properties['part']
      if (isRecord(part) && (part['type'] === 'step-start' || part['type'] === 'step-finish')) return null
    }
    const semantic = parseOpenCodeSemanticEvent(event)
    const time = Date.now()
    const turnFor = (id: string): number => {
      const existing = turnIds.get(id)
      if (existing !== undefined) return existing
      const next = liveTurnOffset + turnIds.size
      turnIds.set(id, next)
      return next
    }
    if (semantic.kind === 'text' || semantic.kind === 'reasoning') {
      const previous = partTexts.get(semantic.partId) ?? ''
      const delta = semantic.text.startsWith(previous) ? semantic.text.slice(previous.length) : semantic.text
      partTexts.set(semantic.partId, semantic.text)
      partKinds.set(semantic.partId, semantic.kind)
      if (delta.length === 0) return null
      if (semantic.kind === 'text' && userMessageIds.has(semantic.messageId)) {
        return {
          type: 'user/message', seq, time,
          data: { source: { kind: 'user' }, content: [{ type: 'text', text: delta }] },
        } as SessionWireEvent
      }
      return {
        type: 'assistant/chunk', seq, time,
        data: {
          turn: turnFor(semantic.messageId), step: 0,
          chunk: { type: semantic.kind === 'text' ? 'text-delta' : 'reasoning-delta', index: 0, text: delta },
        },
      } as SessionWireEvent
    }
    if (semantic.kind === 'delta') {
      const kind = partKinds.get(semantic.partId)
      if (kind === undefined) throw new TypeError(`OpenCode message.part.delta arrived before part ${semantic.partId}`)
      partTexts.set(semantic.partId, `${partTexts.get(semantic.partId) ?? ''}${semantic.delta}`)
      if (userMessageIds.has(semantic.messageId)) {
        return {
          type: 'user/message', seq, time,
          data: { source: { kind: 'user' }, content: [{ type: 'text', text: semantic.delta }] },
        } as SessionWireEvent
      }
      return {
        type: 'assistant/chunk', seq, time,
        data: {
          turn: turnFor(semantic.messageId), step: 0,
          chunk: { type: kind === 'text' ? 'text-delta' : 'reasoning-delta', index: 0, text: semantic.delta },
        },
      } as SessionWireEvent
    }
    if (semantic.kind === 'message') {
      if (semantic.role === 'user') userMessageIds.add(semantic.messageId)
      return null
    }
    if (semantic.kind === 'tool') {
      const turn = turnFor(semantic.messageId)
      if (semantic.status === 'pending' || semantic.status === 'running') {
        return {
          type: 'tool/call', seq, time,
          data: {
            callId: semantic.callId, turn, step: 0, name: semantic.name,
            toolKind: 'tool.' + toolKindForName(semantic.name),
            arguments: JSON.stringify(semantic.input),
            ...(toolTitle(eventProperties(event, event.type)) === undefined ? {} : { title: toolTitle(eventProperties(event, event.type)) }),
            status: semantic.status,
          },
        } as SessionWireEvent
      }
      return {
        type: 'tool/result', seq, time,
        data: {
          turn, step: 0,
          message: {
            source: { callId: semantic.callId },
            content: [{ type: 'text', text: semantic.output ?? semantic.error ?? '' }],
          },
          name: semantic.name,
          toolKind: 'tool.' + toolKindForName(semantic.name),
          ...(toolTitle(eventProperties(event, event.type)) === undefined ? {} : { title: toolTitle(eventProperties(event, event.type)) }),
          ...(semantic.error === undefined ? {} : { error: { name: semantic.error } }),
        },
      } as SessionWireEvent
    }
    if (semantic.kind === 'status') {
      if (semantic.status === 'busy') {
        terminalSessions.delete(semantic.sessionId)
        return { type: 'turn/start', seq, time, data: { turn: turnFor(semantic.sessionId), status: 'running' } } as SessionWireEvent
      }
      if (semantic.status === 'idle') {
        if (terminalSessions.has(semantic.sessionId)) return null
        terminalSessions.add(semantic.sessionId)
        return { type: 'turn/end', seq, time, data: { turn: turnFor(semantic.sessionId), reason: { kind: 'completed' } } } as SessionWireEvent
      }
      return { type: 'request/context', seq, time, data: { status: semantic.status } } as SessionWireEvent
    }
    if (semantic.kind === 'error') {
      terminalSessions.add(semantic.sessionId)
      return { type: 'turn/end', seq, time, data: { turn: turnFor(semantic.sessionId), reason: { kind: 'error', error: semantic.message } } } as SessionWireEvent
    }
    if (semantic.kind === 'permission') return { type: 'user/message', seq, time, data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: `Permission requested: ${semantic.permission}` }] } } as SessionWireEvent
    if (semantic.kind === 'question') return { type: 'user/message', seq, time, data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: `Question requested (${semantic.questions.length})` }] } } as SessionWireEvent
    if (semantic.kind === 'unknown') return { type: 'opencode/unknown', seq, time, data: { eventType: semantic.eventType, text: `OpenCode event: ${semantic.eventType}`, properties: semantic.properties } } as SessionWireEvent
    throw new Error('OpenCode semantic event was not projected')
  }

  private requireData<T>(response: { readonly data: T }, operation: string): T {
    if (!isRecord(response) || !Object.hasOwn(response, 'data')) {
      throw new Error(`OpenCode ${operation} response must contain data`)
    }
    return response.data
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(new URL(path, this.endpoint), {
      ...init,
      headers: { ...this.headers, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers },
    })
    if (!response.ok) throw new OpenCodeHttpError(response.status, await response.text())
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }
}
