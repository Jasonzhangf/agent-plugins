import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { Box, Text, useInput, useStdout } from 'ink'
import type { Key } from 'ink'
import { createElement, useEffect, type ReactElement, type ReactNode } from 'react'
import type { TuiRenderOutput } from '../../../../contracts/tui/component-registry/component-registry.types.ts'
import type {
  TuiInkTreeComposed,
  TuiTerminalShellDescriptor,
} from '../../../../contracts/tui/terminal-ui/terminal-shell.types.ts'

// ---------- Public types ----------

export const tuiTerminalLifecycleServiceName = 'tuiTerminalLifecycle' as const

export type TuiTerminalState =
  | 'idle'
  | 'active'
  | 'suspending'
  | 'suspended'
  | 'restoring'
  | 'exited'
  | 'failed'

export type { TuiInkTreeComposed, TuiTerminalShellDescriptor }

export interface TuiRenderStreams {
  readonly stdout: NodeJS.WriteStream
  readonly stdin: NodeJS.ReadStream
  readonly stderr: NodeJS.WriteStream
}

export interface TuiTerminalExit {
  readonly reason: string
}

export interface TuiTerminalSuspend {
  readonly reason: string
}

export type TuiTerminalKey = Key

export type TuiTerminalInputEvent =
  | {
      readonly type: 'key'
      readonly input: string
      readonly key: TuiTerminalKey
    }
  | {
      readonly type: 'resize'
      readonly columns: number
      readonly rows: number
    }

export interface InkInstance {
  rerender(node: unknown): void
  unmount(): void
  waitUntilRenderFlush(): Promise<void>
  cleanup(): void
}

export type InkRenderFactory = (
  node: unknown,
  options: { stdout: NodeJS.WriteStream; stdin: NodeJS.ReadStream; stderr: NodeJS.WriteStream; alternateScreen: true; maxFps: 30; incrementalRendering: true; interactive: true; exitOnCtrlC: false; patchConsole: false },
) => InkInstance

export interface TuiTerminalLifecycle {
  readonly name: typeof tuiTerminalLifecycleServiceName
  state(): TuiTerminalState
  subscribe(listener: (state: TuiTerminalState) => void): () => void
  setInputHandler(handler: ((event: TuiTerminalInputEvent) => void) | null): void
  enter(streams: TuiRenderStreams): void
  render(node: TuiInkTreeComposed): void
  suspend(reason: TuiTerminalSuspend): void
  resume(): void
  exit(reason: TuiTerminalExit): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiTerminalLifecycle: TuiTerminalLifecycle
  }
}

// ---------- Forbidden control/payload field detection ----------

const FORBIDDEN_PROP_KEYS = new Set([
  'transport',
  'frame',
  'muxframe',
  'hostframe',
  'rpcframe',
  'rpc',
  'session_event',
  'sessionevent',
  'event',
  'event_seq',
  'seq',
  'sequence',
  'endpoint',
  'rpc_id',
  'rpcid',
  'envelope',
  'metadata',
  'health',
  'snapshot',
  'revision_ack',
  'control',
  'debug',
  'route',
  'routing',
  'switch',
  'switching',
  'continuation',
  'retry',
  'attempt',
  'backoff',
  'provider',
  'stopless',
  'servertool',
])

function assertRenderableNode(node: unknown): asserts node is TuiInkTreeComposed {
  if (!node || typeof node !== 'object') {
    throw new TypeError('terminal-lifecycle: render() requires a composed Ink tree object')
  }
  const record = node as Record<string, unknown>
  if (record['nodeId'] !== 'tui.shell') {
    throw new TypeError('terminal-lifecycle: composed Ink tree requires nodeId tui.shell')
  }
  if (record['kind'] !== 'tui.shell') {
    throw new TypeError('terminal-lifecycle: composed Ink tree requires kind tui.shell')
  }
  if (typeof record['publicationRevision'] !== 'number' || !Number.isFinite(record['publicationRevision'])) {
    throw new TypeError('terminal-lifecycle: composed Ink tree requires a finite publicationRevision')
  }
  const lifecycleValue = record['lifecycle']
  if (lifecycleValue !== 'streaming' && lifecycleValue !== 'settled' && lifecycleValue !== 'interrupted' && lifecycleValue !== 'failed') {
    throw new TypeError('terminal-lifecycle: composed Ink tree requires a closed lifecycle tag')
  }
  if (!record['descriptor'] || typeof record['descriptor'] !== 'object') {
    throw new TypeError('terminal-lifecycle: composed Ink tree requires a shell descriptor')
  }
  const descriptor = record['descriptor'] as Record<string, unknown>
  if (!Number.isSafeInteger(descriptor['scrollOffset']) || (descriptor['scrollOffset'] as number) < 0) {
    throw new TypeError('terminal-lifecycle: composed Ink tree requires a non-negative scrollOffset')
  }
  assertClosedValue(descriptor, 'descriptor')
}

function assertClosedValue(value: unknown, path: string): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertClosedValue(value[index], `${path}[${String(index)}]`)
    }
    return
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_PROP_KEYS.has(key)) {
      throw new TypeError(`terminal-lifecycle: forbidden prop '${key}' at ${path}; renderer must not consume transport/control/session-event fields`)
    }
    assertClosedValue(record[key], `${path}.${key}`)
  }
}

// ---------- State machine ----------

const VALID_TRANSITIONS: Readonly<Record<TuiTerminalState, readonly TuiTerminalState[]>> = Object.freeze({
  idle:      Object.freeze(['active', 'failed']) as readonly TuiTerminalState[],
  active:    Object.freeze(['suspending', 'restoring', 'failed']) as readonly TuiTerminalState[],
  suspending: Object.freeze(['suspended', 'failed']) as readonly TuiTerminalState[],
  suspended: Object.freeze(['active', 'restoring', 'failed']) as readonly TuiTerminalState[],
  restoring: Object.freeze(['active', 'exited', 'failed']) as readonly TuiTerminalState[],
  exited:    Object.freeze([]) as readonly TuiTerminalState[],
  failed:    Object.freeze(['restoring', 'exited'] as readonly TuiTerminalState[]),
})

function assertTransition(from: TuiTerminalState, to: TuiTerminalState): void {
  if (from === to) return
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    throw new Error(`terminal-lifecycle: illegal transition ${from} -> ${to}`)
  }
}

// ---------- Default Ink factory ----------

import { render as inkRender } from 'ink'

export function defaultInkFactory(
  node: unknown,
  options: Parameters<InkRenderFactory>[1],
): InkInstance {
  // Ink's default render returns an Instance with rerender/unmount/waitUntilRenderFlush/cleanup.
  // The cast adapts the Ink Instance to our closed seam.
  return (inkRender as unknown as (node: unknown, options: unknown) => InkInstance)(node, options)
}

function outputText(output: TuiRenderOutput): string {
  if (output === null) return ''
  if (output.contract === 'tui.intent.v1') {
    throw new TypeError(`terminal-lifecycle: typed intent '${output.intent}' cannot enter transcript rendering`)
  }
  const props = output.props ?? {}
  if (typeof props['text'] === 'string') return props['text']
  if (typeof props['value'] === 'object' && props['value'] !== null) {
    const value = props['value'] as Record<string, unknown>
    const title = typeof value['title'] === 'string' ? value['title'] : output.elementType
    const status = typeof value['status'] === 'string' ? value['status'] : ''
    const input = typeof value['input'] === 'string' ? `\n  in: ${value['input']}` : ''
    const result = typeof value['output'] === 'string' ? `\n  out: ${value['output']}` : ''
    const message = typeof value['message'] === 'string' ? value['message'] : ''
    return message || `${title}${status ? ` [${status}]` : ''}${input}${result}`
  }
  return output.elementType
}

function outputPrefix(output: TuiRenderOutput): string {
  if (output === null || output.contract === 'tui.intent.v1') return ''
  if (output.elementType === 'conversation.user') return '› '
  if (output.elementType === 'conversation.reasoning') return '· '
  if (output.elementType === 'error.terminal') return '! '
  return ''
}

export function composeInkElement(
  shell: TuiTerminalShellDescriptor,
  handler: ((event: TuiTerminalInputEvent) => void) | null = null,
): ReactElement {
  return createElement(TuiShellView, { shell, handler })
}

function TuiShellView({
  shell,
  handler,
}: {
  shell: TuiTerminalShellDescriptor
  handler: ((event: TuiTerminalInputEvent) => void) | null
}): ReactElement {
  useInput((input, key) => {
    handler?.({ type: 'key', input, key })
  }, { isActive: handler !== null })
  const { stdout } = useStdout()
  const columns = stdout.columns ?? shell.width
  const rows = stdout.rows ?? 24
  useEffect(() => {
    handler?.({ type: 'resize', columns, rows })
  }, [columns, rows, handler])
  return createElement(
    Box,
    { flexDirection: 'column', width: shell.width },
    createElement(Text, { bold: true }, '== Transcript =='),
    transcriptCells(shell, rows),
    createElement(Text, { dimColor: true }, '-- composer.editor --'),
    createElement(ComposerView, { composer: shell.composer }),
    createElement(Text, { dimColor: true }, `cursor=${shell.composer.cursor} mode=${shell.composer.mode}`),
    createElement(Text, { dimColor: true }, '-- Session --'),
    createElement(
      Text,
      { color: shell.status.mode === 'error' ? 'red' : 'yellow' },
      statusLine(shell),
    ),
  )
}

function ComposerView({
  composer,
}: {
  composer: TuiTerminalShellDescriptor['composer']
}): ReactElement {
  const lines = composer.lines.length > 0 ? composer.lines : ['']
  return createElement(
    Box,
    { flexDirection: 'column' },
    lines.map((line, index) => {
      if (index !== composer.cursorLine) {
        return createElement(Text, { color: 'green', key: `composer-line-${index}` }, line || ' ')
      }
      const before = line.slice(0, composer.cursorColumn)
      const atCursor = line.slice(composer.cursorColumn, composer.cursorColumn + 1) || ' '
      const after = line.slice(composer.cursorColumn + 1)
      return createElement(
        Text,
        { color: 'green', key: `composer-line-${index}` },
        before,
        createElement(Text, { inverse: true }, atCursor),
        after,
      )
    }),
  )
}

function transcriptCells(shell: TuiTerminalShellDescriptor, rows: number): ReactNode[] {
  const capacity = Math.max(1, rows - shell.composer.lines.length - 6)
  const end = Math.max(0, shell.transcript.length - shell.scrollOffset)
  const start = Math.max(0, end - capacity)
  const visible = shell.transcript.slice(start, end)
  const transcript: ReactNode[] = visible.map(cell => {
    const isUser = cell.output !== null && cell.output.contract === 'tui.element.v1' && cell.output.elementType === 'conversation.user'
    return createElement(
      Box,
      { key: cell.nodeId, flexDirection: 'column' },
      createElement(Text, isUser ? { color: 'cyan' } : {}, `[${cell.nodeId}] ${outputPrefix(cell.output)}${outputText(cell.output)}`),
    )
  })
  const prefix = start > 0
    ? [createElement(Text, { dimColor: true, key: 'transcript-older' }, `... ${start} earlier cells`)]
    : []
  return [...prefix, ...transcript]
}

function statusLine(shell: TuiTerminalShellDescriptor): string {
  return `Session ${shell.status.sessionId ?? 'no-session'} @ ${shell.status.cwd ?? 'no-cwd'} [${shell.status.mode}]${shell.status.message ? ` ${shell.status.message}` : ''}`
}

// ---------- Service ----------

export interface TuiTerminalLifecycleApplyOptions {
  readonly factory?: InkRenderFactory
  readonly signalTargets?: ReadonlyArray<NodeJS.Signals>
}

export class TuiTerminalLifecycleService extends Service implements TuiTerminalLifecycle {
  readonly name = tuiTerminalLifecycleServiceName

  private currentState: TuiTerminalState = 'idle'
  private instance: InkInstance | null = null
  private streams: TuiRenderStreams | null = null
  private factory: InkRenderFactory
  private signalTargets: ReadonlyArray<NodeJS.Signals>
  private listeners = new Set<(state: TuiTerminalState) => void>()
  private pendingFlush: Promise<void> | null = null
  private signalHandlers = new Map<NodeJS.Signals, NodeJS.SignalsListener>()
  private lastError: Error | null = null
  private inputHandler: ((event: TuiTerminalInputEvent) => void) | null = null

  constructor(ctx: Context, options: TuiTerminalLifecycleApplyOptions = {}) {
    super(ctx, tuiTerminalLifecycleServiceName)
    this.factory = options.factory ?? defaultInkFactory
    this.signalTargets = options.signalTargets ?? (['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    ctx.effect(() => () => {
      this.disengage()
    }, 'terminal-lifecycle.disposal')
  }

  state(): TuiTerminalState {
    return this.currentState
  }

  subscribe(listener: (state: TuiTerminalState) => void): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('terminal-lifecycle: listener must be a function')
    }
    this.listeners.add(listener)
    listener(this.currentState)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setInputHandler(handler: ((event: TuiTerminalInputEvent) => void) | null): void {
    if (handler !== null && typeof handler !== 'function') {
      throw new TypeError('terminal-lifecycle: input handler must be a function or null')
    }
    this.inputHandler = handler
  }

  enter(streams: TuiRenderStreams): void {
    if (this.currentState !== 'idle' && this.currentState !== 'failed') {
      throw new Error(`terminal-lifecycle: enter() refused; already ${this.currentState}`)
    }
    assertTransition(this.currentState, 'active')
    if (!streams || typeof streams !== 'object') {
      throw new TypeError('terminal-lifecycle: enter() requires a TuiRenderStreams object')
    }
    if (!streams.stdout || typeof (streams.stdout as { write?: unknown }).write !== 'function') {
      throw new TypeError('terminal-lifecycle: enter() requires a writable stdout')
    }
    if (!streams.stdin || typeof (streams.stdin as { on?: unknown }).on !== 'function') {
      throw new TypeError('terminal-lifecycle: enter() requires a readable stdin')
    }
    this.streams = streams
    // Mount exactly one Ink instance; render() will populate the tree.
    try {
      this.instance = this.factory(null, {
        stdout: streams.stdout,
        stdin: streams.stdin,
        stderr: streams.stderr,
        alternateScreen: true,
        maxFps: 30,
        incrementalRendering: true,
        interactive: true,
        exitOnCtrlC: false,
        patchConsole: false,
      })
    } catch (error) {
      this.streams = null
      throw error
    }
    this.transition('active')
    this.attachSignals()
  }

  render(node: TuiInkTreeComposed): void {
    if (this.currentState !== 'active') {
      throw new Error(`terminal-lifecycle: render() requires active state, observed ${this.currentState}`)
    }
    assertRenderableNode(node)
    if (!this.instance || !this.streams) {
      throw new Error(`terminal-lifecycle: render() called without an Ink instance; observed ${this.currentState}`)
    }
    try {
      this.instance.rerender(composeInkElement(node.descriptor, this.inputHandler))
    } catch (error) {
      this.routeRenderFailure(error)
      throw error
    }
    this.scheduleFlush()
  }

  suspend(reason: TuiTerminalSuspend): void {
    if (this.currentState !== 'active') {
      throw new Error(`terminal-lifecycle: suspend() requires active state, observed ${this.currentState}; reason=${reason.reason}`)
    }
    this.transition('suspending')
    // Suspending is intentionally a state-only step: bracketed paste and resize
    // continue to flow through stdin while the render instance stays mounted.
    this.transition('suspended')
  }

  resume(): void {
    if (this.currentState !== 'suspended') {
      throw new Error(`terminal-lifecycle: resume() requires suspended state, observed ${this.currentState}`)
    }
    this.transition('active')
  }

  exit(reason: TuiTerminalExit): void {
    if (this.currentState === 'exited') {
      throw new Error('terminal-lifecycle: already exited')
    }
    this.restore(reason.reason)
    this.transition('exited')
  }

  private transition(next: TuiTerminalState): void {
    assertTransition(this.currentState, next)
    this.currentState = next
    for (const listener of [...this.listeners]) listener(next)
  }

  private scheduleFlush(): void {
    if (this.pendingFlush) return
    const instance = this.instance
    if (!instance) return
    this.pendingFlush = instance.waitUntilRenderFlush().finally(() => {
      this.pendingFlush = null
    })
  }

  private routeRenderFailure(error: unknown): void {
    // A render failure is unrecoverable; we restore immediately and switch to
    // 'failed'. Subscribers receive the transition and may exit the host
    // through their own error chain. We never call process.exit and never
    // re-throw on a microtask, so the failure does not become an uncaught
    // exception racing the test runner or the application shutdown.
    this.lastError = error instanceof Error ? error : new Error(String(error))
    this.restore('render-exception')
    this.transition('failed')
  }

  private restore(reason: string): void {
    if (this.currentState === 'restoring' || this.currentState === 'exited') return
    const previous = this.currentState
    if (previous !== 'active' && previous !== 'suspended' && previous !== 'failed') {
      // Nothing mounted; we still must respect the exit contract.
      this.detachSignals()
      return
    }
    this.transition('restoring')
    try {
      if (this.instance) {
        try {
          this.instance.unmount()
        } finally {
          this.instance = null
        }
      }
    } finally {
      this.detachSignals()
      this.streams = null
      void reason // captured for future diagnostics; never logged
    }
  }

  private disengage(): void {
    if (this.currentState === 'exited' || this.currentState === 'idle') return
    this.restore('cordis-disposal')
    this.inputHandler = null
    this.transition('exited')
  }

  private attachSignals(): void {
    for (const signal of this.signalTargets) {
      const handler: NodeJS.SignalsListener = () => {
        this.restore(`signal:${signal}`)
        this.transition('exited')
      }
      this.signalHandlers.set(signal, handler)
      process.on(signal, handler)
    }
  }

  private detachSignals(): void {
    for (const [signal, handler] of this.signalHandlers) {
      process.removeListener(signal, handler)
    }
    this.signalHandlers.clear()
  }
}

export const name = 'terminal-lifecycle'

export function apply(ctx: Context, options: TuiTerminalLifecycleApplyOptions = {}): void {
  new TuiTerminalLifecycleService(ctx, options)
}
