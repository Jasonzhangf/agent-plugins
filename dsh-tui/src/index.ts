/**
 * Cordis runtime row that owns one DSH Agent, a Rust renderer child, and the
 * four strict inherited-pipe channels between them.
 * @module dsh-tui
 */

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable, Writable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import {
  type Agent,
  type AgentHandle,
  type AgentOptions,
  type AgentSetup,
  type AgentStatus,
  type CreateAgentOptions,
  type ResumeAgentOptions,
} from '@deepseek-ai/dsh-agent'
import type { AgentPresets, PresetBearingSession } from '@deepseek-ai/dsh-agent-presets'
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { TUI_STARTUP_SERVICE, type TuiStartupValues } from './startup.js'
import {
  ActionPairReceiver,
  MAX_QUEUED_BYTES,
  MAX_RECORD_BYTES,
  PROTOCOL_VERSION,
  type ChildActionRecord,
  type ChildControlRecord,
  type DecodedRecord,
  FrameDecoder,
  type HostControlRecord,
  type HostProjectionRecord,
  encodeFrame,
} from './protocol.js'
import { projectSession, publishPublication } from './projection.js'

/** Stable Cordis plugin name. */
export const name = 'tui-runtime'

/** Required services before the TUI can mount. */
export const inject = ['tuiStartup', 'agentDefaultModel', 'agents', 'sessions', 'sessionPersistence']

export interface AgentRegistryLike {
  create(options: CreateAgentOptions): Promise<AgentHandle>
  resume(options: ResumeAgentOptions): Promise<AgentHandle>
  get(sessionId: SessionId): Agent | undefined
}

interface SessionStoreLike {
  flush(session: Session): Promise<void>
}

export interface PersistenceLike {
  inspect(id: SessionId): Promise<SessionInspection>
}

export interface OwnedAgentHandle {
  agent: Agent
  dispose(): Promise<void>
  owned: boolean
}

interface ChildStdio {
  stdio: [
    Writable | null,
    Readable | null,
    Readable | null,
    Writable | null,
    Readable | null,
    Writable | null,
    Readable | null,
  ]
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
}

function debugLog(message: string): void {
  const target = process.env.DSH_TUI_DEBUG_FILE
  if (target !== undefined) appendFileSync(target, `dsh-tui: ${message}\n`)
}

/** Mount the runtime after startup parsing has published its immutable values. */
export function apply(ctx: Context): void {
  const startup = ctx.get(TUI_STARTUP_SERVICE) as TuiStartupValues | undefined
  const defaultModel = ctx.get('agentDefaultModel') as { currentSelection(): { provider: string; model: string } } | undefined
  const agents = ctx.get('agents') as AgentRegistryLike | undefined
  const sessions = ctx.get('sessions') as SessionStoreLike | undefined
  const persistence = ctx.get('sessionPersistence') as PersistenceLike | undefined
  const exit = ctx.get('appExit') as ((code: number) => void) | undefined
  if (startup === undefined || agents === undefined || sessions === undefined || persistence === undefined || exit === undefined || defaultModel === undefined) {
    throw new Error('tui-runtime: required services are unavailable')
  }

  void run(ctx, startup, agents, sessions, persistence, defaultModel, exit).catch((error: unknown) => {
    process.stderr.write(`dsh-tui: ${errorMessage(error)}\n`)
    exit(1)
  })
}

interface AgentComposition {
  readonly agentPreset?: string
  readonly setup: AgentSetup
}

async function resolveComposition(
  presets: AgentPresets | undefined,
  source?: PresetBearingSession,
): Promise<AgentComposition> {
  if (presets === undefined) return { setup: () => {} }
  let id: string | undefined
  if (source !== undefined) {
    const { resolveSessionPreset } = await import('@deepseek-ai/dsh-agent-presets')
    id = resolveSessionPreset(source)
  }
  const preset = await presets.resolve(id)
  return {
    agentPreset: preset.id,
    setup: async agentCtx => {
      await presets.mount(agentCtx, preset.id)
    },
  }
}

/**
 * Resolve the live Agent the TUI surface should render.
 *
 * A session already live in this process is adopted without a new owner; the
 * Web surface may have created it, and disposing it from the TUI would take
 * the shared Session away from the browser. A cold session is resumed through
 * the public registry so the caller owns its flush/dispose lifecycle.
 */
export async function acquireOwnedAgent(
  startup: TuiStartupValues,
  agents: AgentRegistryLike,
  persistence: PersistenceLike,
  presets: AgentPresets | undefined,
  agentOptions: AgentOptions | undefined,
): Promise<OwnedAgentHandle> {
  if (startup.resumeSessionId === undefined) {
    const composition = await resolveComposition(presets)
    const created = await agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: {
        cwd: process.cwd(),
        ...composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset },
      },
      agentOptions,
      setup: composition.setup,
    })
    return { agent: created.agent, dispose: created.dispose, owned: true }
  }

  const resumeSessionId = SessionId(startup.resumeSessionId)
  const live = agents.get(resumeSessionId)
  if (live !== undefined) {
    return { agent: live, dispose: async () => {}, owned: false }
  }
  const inspected = await persistence.inspect(resumeSessionId)
  const composition = await resolveComposition(presets, {
    header: inspected.meta,
    events: inspected.events,
  })
  const resumed = await agents.resume({
    resumeSessionId,
    agentOptions,
    setup: composition.setup,
  })
  return { agent: resumed.agent, dispose: resumed.dispose, owned: true }
}

async function run(
  ctx: Context,
  startup: TuiStartupValues,
  agents: AgentRegistryLike,
  sessions: SessionStoreLike,
  persistence: PersistenceLike,
  defaultModel: { currentSelection(): { provider: string; model: string } },
  exit: (code: number) => void,
): Promise<void> {
  await ctx.get('loader')?.await?.()
  const selection = defaultModel.currentSelection()
  const agentOptions = { provider: selection.provider, model: selection.model }
  const presets = ctx.get('agentPresets') as AgentPresets | undefined
  const handle = await acquireOwnedAgent(startup, agents, persistence, presets, agentOptions)

  const binary = resolveRendererBinary()
  if (!existsSync(binary)) {
    const cleanupError = await cleanup(handle, sessions)
    if (cleanupError !== undefined) throw cleanupError
    throw new Error(`renderer binary not found at ${binary}`)
  }

  const child = spawn(binary, [], {
    stdio: ['inherit', 'inherit', 'inherit', 'pipe', 'pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DSH_TUI_PROTOCOL_VERSION: String(PROTOCOL_VERSION),
      DSH_TUI_SESSION_ID: String(handle.agent.id),
    },
  }) as unknown as ChildStdio
  const projectionOut = requiredPipe(child.stdio[3], 3)
  const actionIn = requiredPipe(child.stdio[4], 4)
  const hostControlOut = requiredPipe(child.stdio[5], 5)
  const childControlIn = requiredPipe(child.stdio[6], 6)
  const sessionId = String(handle.agent.id)
  console.log(`dsh tui session: ${sessionId}`)

  await writeRecord(hostControlOut as Writable, {
    protocolVersion: PROTOCOL_VERSION,
    type: 'hello',
    hostVersion: 'dsh-tui/0.1.0',
    minProtocolVersion: PROTOCOL_VERSION,
    maxProtocolVersion: PROTOCOL_VERSION,
    maxRecordBytes: MAX_RECORD_BYTES,
    maxQueuedBytes: MAX_QUEUED_BYTES,
  } satisfies HostControlRecord, 'host_control')

  const childControlDecoder = new FrameDecoder('child_control')
  await waitForReady(childControlIn as Readable, childControlDecoder, sessionId)

  let projectionSequence = 1
  let projectionScheduled = false
  let projectionWrites = Promise.resolve()
  let actionDispatch = Promise.resolve()
  let exiting = false
  const actionDecoder = new FrameDecoder('business_action')
  const actionPairs = new ActionPairReceiver()

  const shutdown = async (requestedCode: number, cause?: unknown): Promise<void> => {
    if (exiting) return
    exiting = true
    if (cause !== undefined) process.stderr.write(`dsh-tui: ${errorMessage(cause)}\n`)
    const cleanupError = await cleanup(handle, sessions)
    if (cleanupError !== undefined) process.stderr.write(`dsh-tui: ${cleanupError.message}\n`)
    exit(cause === undefined && cleanupError === undefined ? requestedCode : 1)
  }

  const publishCurrentProjection = async (): Promise<void> => {
    const snapshot = projectSession(handle.agent)
    debugLog(`projection cells=${snapshot.cells.length} kinds=${snapshot.cells.map(cell => cell.kind).join(',')} provider=${snapshot.agent.provider} model=${snapshot.agent.model}`)
    for (const record of publishPublication(snapshot)) {
      const frame = encodeFrame(record, 'business_projection')
      await writeBuffer(projectionOut as Writable, frame)
      await writeRecord(hostControlOut as Writable, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'delivery_ledger',
        channel: 'projection',
        sequence: projectionSequence,
        recordBytes: frame.byteLength - 4,
      } satisfies HostControlRecord, 'host_control')
      if (projectionSequence === Number.MAX_SAFE_INTEGER) throw new Error('projection delivery sequence exhausted')
      projectionSequence += 1
    }
  }

  const scheduleProjection = (): void => {
    if (projectionScheduled || exiting) return
    projectionScheduled = true
    setImmediate(() => {
      projectionScheduled = false
      projectionWrites = projectionWrites.then(publishCurrentProjection)
      void projectionWrites.catch(error => shutdown(1, error))
    })
  }

  const dispatchAccepted = (accepted: readonly { record: ChildActionRecord; sequence: number }[]): void => {
    for (const item of accepted) {
      actionDispatch = actionDispatch
        .then(() => handleAction(item.record, handle.agent, sessionId))
        .then(() => writeRecord(hostControlOut as Writable, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'ack',
          channel: 'action',
          sequence: item.sequence,
        } satisfies HostControlRecord, 'host_control'))
      void actionDispatch.catch(error => shutdown(1, error))
    }
  }

  actionIn.on('data', (chunk: Buffer) => {
    try {
      for (const action of actionDecoder.push(chunk)) dispatchAccepted(actionPairs.pushAction(action))
    } catch (error) {
      void shutdown(1, error)
    }
  })
  actionIn.on('end', () => {
    try {
      actionDecoder.finish()
      actionPairs.finish()
    } catch (error) {
      void shutdown(1, error)
    }
  })
  actionIn.on('error', error => void shutdown(1, error))

  childControlIn.on('data', (chunk: Buffer) => {
    try {
      for (const decoded of childControlDecoder.push(chunk)) {
        const record = decoded.record
        switch (record.type) {
          case 'delivery_ledger':
            dispatchAccepted(actionPairs.pushLedger(record))
            break
          case 'request_resync':
            scheduleProjection()
            break
          case 'ack':
          case 'capacity':
            break
          case 'shutdown':
            void shutdown(0)
            break
          case 'fatal':
            void shutdown(1, new Error(`child fatal ${record.code}: ${record.message}`))
            break
          case 'ready':
            throw new Error('duplicate child ready record')
        }
      }
    } catch (error) {
      void shutdown(1, error)
    }
  })
  childControlIn.on('end', () => {
    try {
      childControlDecoder.finish()
      actionPairs.finish()
    } catch (error) {
      void shutdown(1, error)
    }
  })
  childControlIn.on('error', error => void shutdown(1, error))
  child.on('error', error => void shutdown(1, error))
  child.on('exit', code => void shutdown(code ?? 1))

  ctx.on('session/event', (session: Session) => {
    if (session === handle.agent.session) scheduleProjection()
  })
  ctx.on('agent/status', (payload: { agent: Agent; status: AgentStatus }) => {
    if (payload.agent === handle.agent) scheduleProjection()
  })

  await publishCurrentProjection()
}

function resolveRendererBinary(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, 'native/dsh-tui')
}

function requiredPipe<T>(pipe: T | null, index: number): T {
  if (pipe === null) throw new Error(`child stdio ${index} is unavailable`)
  return pipe
}

async function waitForReady(
  stream: Readable,
  decoder: FrameDecoder<'child_control'>,
  sessionId: string,
): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    const cleanup = (): void => {
      stream.off('data', onData)
      stream.off('end', onEnd)
      stream.off('error', onError)
    }
    const onData = (chunk: Buffer): void => {
      try {
        const records = decoder.push(chunk)
        if (records.length === 0) return
        if (records.length !== 1 || records[0].record.type !== 'ready') {
          throw new Error('child sent a non-ready control record before handshake completed')
        }
        if (records[0].record.target !== sessionId) throw new Error('child ready target does not match the active session')
        cleanup()
        resolveReady()
      } catch (error) {
        cleanup()
        rejectReady(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const onEnd = (): void => {
      cleanup()
      rejectReady(new Error('child control EOF before ready'))
    }
    const onError = (error: Error): void => {
      cleanup()
      rejectReady(error)
    }
    stream.on('data', onData)
    stream.on('end', onEnd)
    stream.on('error', onError)
  })
}

async function handleAction(record: ChildActionRecord, agent: Agent, sessionId: string): Promise<void> {
  if (record.sessionId !== sessionId) throw new Error(`action targets ${record.sessionId}, expected ${sessionId}`)
  switch (record.type) {
    case 'submit':
      if (record.attachments.length !== 0) throw new Error('attachment submission is not implemented by this runtime')
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: record.text }],
        source: { kind: 'user' },
      }))
      return
    case 'cancel':
      agent.cancel({ kind: 'user' })
      return
    default:
      throw new Error(`unsupported business action type: ${String((record as { type?: unknown }).type)}`)
  }
}

async function cleanup(
  handle: OwnedAgentHandle,
  sessions: SessionStoreLike,
): Promise<Error | undefined> {
  if (!handle.owned) return undefined
  const results = await Promise.allSettled([
    sessions.flush(handle.agent.session),
    handle.dispose(),
  ])
  const failures = results.flatMap((result, index) => result.status === 'rejected'
    ? [`${index === 0 ? 'session flush' : 'agent dispose'} failed: ${errorMessage(result.reason)}`]
    : [])
  return failures.length === 0 ? undefined : new Error(failures.join('; '))
}

function writeRecord<C extends 'business_projection' | 'host_control'>(
  stream: Writable,
  record: C extends 'business_projection' ? HostProjectionRecord : HostControlRecord,
  channel: C,
): Promise<void> {
  return writeBuffer(stream, encodeFrame(record, channel))
}

function writeBuffer(stream: Writable, buffer: Buffer): Promise<void> {
  return new Promise((resolveWrite, rejectWrite) => {
    stream.write(buffer, error => {
      if (error === null || error === undefined) resolveWrite()
      else rejectWrite(error)
    })
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
