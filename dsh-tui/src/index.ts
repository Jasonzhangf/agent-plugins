/**
 * TUI runtime row: compose one Agent through the public DSH services,
 * stream projection windows to the Rust renderer through four inherited
 * pipes, and forward user actions back to the Agent. The renderer is the
 * packaged native binary under `lib/native/dsh-tui`.
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
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { TUI_STARTUP_SERVICE, TuiStartupValues } from './startup.js'
import {
  PROTOCOL_VERSION, MAX_RECORD_BYTES, MAX_QUEUED_BYTES,
  ChildActionRecord, HostControlRecord,
  encodeFrame, FrameDecoder, AnyRecord,
} from './protocol.js'
import { projectSession, publishPublication } from './projection.js'

/** Stable Cordis plugin name. */
export const name = 'tui-runtime'

function debugLog(message: string): void {
  const target = process.env.DSH_TUI_DEBUG_FILE
  if (target === undefined) return
  appendFileSync(target, `dsh-tui: ${message}\n`)
}

/** Required services before the TUI can mount. */
export const inject = ['tuiStartup', 'agentDefaultModel', 'agents', 'sessions']

interface AgentHandleLike {
  agent: Agent
  dispose(): Promise<void>
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
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
}

/** Process exit request, supplied by the launcher on the global context. */
export function apply(ctx: Context): void {
  const startup = ctx.get(TUI_STARTUP_SERVICE) as TuiStartupValues | undefined
  const defaultModel = ctx.get('agentDefaultModel') as { currentSelection(): { provider: string; model: string } } | undefined
  const agents = ctx.get('agents') as {
    create(options: unknown): Promise<AgentHandleLike>
    resume(options: unknown): Promise<AgentHandleLike>
  } | undefined
  const sessions = ctx.get('sessions') as { flush(session: Session): Promise<void> } | undefined
  const exit = ctx.get('appExit') as ((code: number) => void) | undefined
  if (startup === undefined || agents === undefined || sessions === undefined || exit === undefined || defaultModel === undefined) {
    throw new Error('tui-runtime: required services are unavailable')
  }

  void run(ctx, startup, agents, sessions, defaultModel, exit).catch((error: unknown) => {
    process.stderr.write(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`)
    exit(1)
  })
}

async function run(
  ctx: Context,
  startup: TuiStartupValues,
  agents: { create(opts: unknown): Promise<AgentHandleLike>; resume(opts: unknown): Promise<AgentHandleLike> },
  sessions: { flush(session: Session): Promise<void> },
  defaultModel: { currentSelection(): { provider: string; model: string } },
  exit: (code: number) => void,
): Promise<void> {
  await ctx.get('loader')?.await?.()
  const selection = defaultModel.currentSelection()
  const handle: AgentHandleLike = startup.resumeSessionId === undefined
    ? await agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: process.cwd() },
        agentOptions: { provider: selection.provider, model: selection.model },
      })
    : await agents.resume({
        resumeSessionId: SessionId(startup.resumeSessionId),
        agentOptions: { provider: selection.provider, model: selection.model },
      })

  const binary = resolveRendererBinary()
  if (!existsSync(binary)) {
    process.stderr.write(`dsh-tui: renderer binary not found at ${binary}\n`)
    await sessions.flush(handle.agent.session)
    await handle.dispose()
    exit(1)
    return
  }

  const child = spawn(binary, [], {
    stdio: ['inherit', 'inherit', 'inherit', 'pipe', 'pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DSH_TUI_PROTOCOL_VERSION: String(PROTOCOL_VERSION),
      DSH_TUI_SESSION_ID: String(handle.agent.id),
    },
  }) as unknown as ChildStdio

  const projectionIn = child.stdio[3] as Writable
  const actionOut = child.stdio[4] as Readable
  const hostControlOut = child.stdio[5] as Writable
  const childControlIn = child.stdio[6] as Readable

  const sessionId = String(handle.agent.id)

  const hello: HostControlRecord = {
    protocolVersion: PROTOCOL_VERSION,
    type: 'hello',
    hostVersion: 'dsh-tui/0.1.0',
    minProtocolVersion: PROTOCOL_VERSION,
    maxProtocolVersion: PROTOCOL_VERSION,
    maxRecordBytes: MAX_RECORD_BYTES,
    maxQueuedBytes: MAX_QUEUED_BYTES,
  }
  hostControlOut.write(encodeFrame(hello))

  await onceRecord(childControlIn, record => record.type === 'ready')

  flushProjection(handle.agent, projectionIn)

  ctx.on('session/event', (session: Session, event) => {
    if (session !== handle.agent.session) return
    scheduleProjection(handle.agent, projectionIn)
  })
  ctx.on('agent/status', (payload: { agent: Agent; status: AgentStatus }) => {
    if (payload.agent === handle.agent) scheduleProjection(handle.agent, projectionIn)
  })

  const decoder = new FrameDecoder()
  let exiting = false
  const shutdown = async (code: number): Promise<void> => {
    if (exiting) return
    exiting = true
    debugLog(`shutdown requested code=${code}`)
    try {
      debugLog('session flush start')
      await sessions.flush(handle.agent.session)
      debugLog('session flush done')
    } catch (error) {
      debugLog(`session flush failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      debugLog('agent dispose start')
      await handle.dispose()
      debugLog('agent dispose done')
    } catch (error) {
      debugLog(`agent dispose failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    debugLog(`app exit ${code}`)
    exit(code)
  }

  childControlIn.on('data', (chunk: Buffer) => {
    for (const record of decoder.push(chunk)) {
      if (record.type === 'shutdown') {
        debugLog(`child control shutdown reason=${record.reason}`)
        void shutdown(0)
      } else if (record.type === 'fatal') {
        debugLog(`child fatal: ${record.message}`)
        void shutdown(1)
      }
    }
  })

  child.on('exit', (code) => {
    void shutdown(code ?? 0)
  })

  await pumpActions(actionOut, handle.agent, sessionId)
}

function resolveRendererBinary(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, 'native/dsh-tui')
}

function flushProjection(agent: Agent, channel: Writable): void {
  const snapshot = projectSession(agent)
  debugLog(`projection cells=${snapshot.cells.length} kinds=${snapshot.cells.map(cell => cell.kind).join(',')}`)
  for (const record of publishPublication(snapshot)) channel.write(encodeFrame(record))
}

let pendingFlush: ReturnType<typeof setImmediate> | null = null
function scheduleProjection(agent: Agent, channel: Writable): void {
  if (pendingFlush !== null) return
  pendingFlush = setImmediate(() => {
    pendingFlush = null
    flushProjection(agent, channel)
  })
}

function onceRecord(stream: Readable, predicate: (record: AnyRecord) => boolean): Promise<AnyRecord> {
  return new Promise((resolve, reject) => {
    const decoder = new FrameDecoder()
    const onData = (chunk: Buffer): void => {
      try {
        for (const record of decoder.push(chunk)) {
          if (predicate(record)) {
            stream.off('data', onData)
            stream.off('error', onError)
            resolve(record)
            return
          }
        }
      } catch (error) {
        stream.off('data', onData)
        stream.off('error', onError)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const onError = (error: Error): void => {
      stream.off('data', onData)
      stream.off('error', onError)
      reject(error)
    }
    stream.on('data', onData)
    stream.on('error', onError)
  })
}

async function pumpActions(stream: Readable, agent: Agent, sessionId: string): Promise<void> {
  const decoder = new FrameDecoder()
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    for (const record of decoder.push(chunk)) {
      await handleAction(record as ChildActionRecord, agent, sessionId)
    }
  }
}

async function handleAction(record: ChildActionRecord, agent: Agent, sessionId: string): Promise<void> {
  switch (record.type) {
    case 'submit': {
      debugLog(`submit action ${record.text}`)
      if (record.sessionId !== sessionId) return
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: record.text }],
        source: { kind: 'user' },
      }))
      break
    }
    case 'cancel': {
      if (record.sessionId !== sessionId) return
      agent.cancel({ kind: 'user' })
      break
    }
    case 'shutdown': {
      void agent.whenIdle().finally(() => {})
      break
    }
    default:
      break
  }
}
