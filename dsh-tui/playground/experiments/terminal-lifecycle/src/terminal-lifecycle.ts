import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { Box, Text, useInput, useStdout } from 'ink'
import type { Key } from 'ink'
import { createElement, useEffect, type ReactElement, type ReactNode } from 'react'
import type { TuiRenderOutput } from '../../../../contracts/tui/component-registry/component-registry.types.ts'
import type {
  TuiInkTreeComposed,
  TuiTerminalCompositionResult,
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

export interface TuiTerminalProcessEvents {
  on(event: NodeJS.Signals, listener: NodeJS.SignalsListener): unknown
  on(event: 'unhandledRejection', listener: (reason: unknown, promise: Promise<unknown>) => void): unknown
  removeListener(event: NodeJS.Signals, listener: NodeJS.SignalsListener): unknown
  removeListener(event: 'unhandledRejection', listener: (reason: unknown, promise: Promise<unknown>) => void): unknown
}

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
  failure(): Error | null
  subscribe(listener: (state: TuiTerminalState) => void): () => void
  setInputHandler(handler: ((event: TuiTerminalInputEvent) => void) | null): void
  enter(streams: TuiRenderStreams): void
  render(node: TuiInkTreeComposed): void
  renderWithCompose(compose: () => TuiTerminalCompositionResult): void
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
    if (handler === null) return
    handler({ type: 'key', input, key })
  })
  const { stdout } = useStdout()
  const columns = stdout.columns ?? shell.width
  const rows = stdout.rows ?? 24
  useEffect(() => {
    if (handler === null) return
    handler({ type: 'resize', columns, rows })
  }, [columns, rows, handler])
  const header = shell.appContainer === undefined ? [] : [
    createElement(Text, { bold: shell.appContainer.logoVisible, key: 'header.logo' }, shell.appContainer.logoVisible ? (shell.appContainer.logoVariant === 'full' ? 'DSH' : 'D') : ''),
    createElement(Text, { key: 'header.connection' }, shell.appContainer.connectionState),
    createElement(Text, { key: 'header.session' }, shell.appContainer.headerSession ?? `Session ${shell.status.sessionId ?? 'no-session'}`),
    createElement(Text, { key: 'header.status' }, shell.appContainer.headerStatus ?? `Status ${shell.status.mode}`),
  ]
  const transcript = [
    createElement(Text, { bold: true, key: 'transcript.title' }, '== Transcript =='),
    ...transcriptCells(shell, rows),
    ...shell.localEchoes.map(echo => createElement(
      Text,
      { color: echo.state === 'failed' ? 'red' : 'cyan', key: echo.echoId },
      `› ${echo.text} [${echo.state === 'pending' ? 'sending' : 'failed'}]`,
    )),
  ]
  const overlay = shell.overlay === undefined ? null : createElement(OverlayView, { overlay: shell.overlay })
  const execution = shell.appContainer === undefined ? null : createElement(
      Text,
      { dimColor: true, key: 'app.execution' },
      `-- execution.${shell.appContainer.executionState} --`,
    )
  const composer = [
    createElement(Text, { dimColor: true, key: 'composer.title' }, '-- composer.editor --'),
    createElement(ComposerView, { composer: shell.composer, key: 'composer.input' }),
    createElement(Text, { dimColor: true, key: 'composer.cursor' }, `cursor=${shell.composer.cursor} mode=${shell.composer.mode}`),
  ]
  const status = [
    createElement(Text, { dimColor: true, key: 'session.title' }, '-- Session --'),
    createElement(
      Text,
      { color: shell.status.mode === 'error' ? 'red' : 'yellow', key: 'session.status' },
      statusLine(shell),
    ),
  ]
  const footer = createElement(Text, { dimColor: true, key: 'footer' }, '-- footer --')
  const compact = shell.appContainer?.layout === 'compact'
  return createElement(
    Box,
    { flexDirection: 'column', width: shell.width },
    ...(compact
      ? [...transcript, execution, overlay, ...composer, ...status, ...header, footer]
      : [...header, ...transcript, overlay, execution, ...composer, ...status, footer]),
  )
}

function OverlayView({
  overlay,
}: {
  overlay: NonNullable<TuiTerminalShellDescriptor['overlay']>
}): ReactElement {
  return createElement(
    Box,
    { borderStyle: 'round', flexDirection: 'column', paddingX: 1 },
    createElement(Text, { bold: true }, overlay.title),
    overlay.items.map((item, index) => createElement(
      Text,
      { key: `${overlay.view}-${String(index)}`, ...(index === overlay.selectedIndex ? { color: 'cyan' as const } : {}) },
      `${index === overlay.selectedIndex ? '›' : ' '} ${item}`,
    )),
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
  const overlayRows = shell.overlay === undefined ? 0 : shell.overlay.items.length + 2
  const capacity = Math.max(1, rows - shell.composer.lines.length - shell.localEchoes.length - overlayRows - 6)
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
  readonly processTarget?: TuiTerminalProcessEvents
}

export class TuiTerminalLifecycleService extends Service implements TuiTerminalLifecycle {
  readonly name = tuiTerminalLifecycleServiceName

  private currentState: TuiTerminalState = 'idle'
  private instance: InkInstance | null = null
  private streams: TuiRenderStreams | null = null
  private factory: InkRenderFactory
  private signalTargets: ReadonlyArray<NodeJS.Signals>
  private processTarget: TuiTerminalProcessEvents
  private listeners = new Set<(state: TuiTerminalState) => void>()
  private pendingFlush: Promise<void> | null = null
  private signalHandlers = new Map<NodeJS.Signals, NodeJS.SignalsListener>()
  // Cordis wraps function-typed own properties on read. EventEmitter removal
  // requires the exact listener identity, so keep lifecycle callbacks nested
  // in a plain box just like the terminal input handler.
  private failureBoundaryBox: {
    stdinEndHandler: (() => void) | null
    unhandledRejectionHandler: ((reason: unknown, promise: Promise<unknown>) => void) | null
  } = { stdinEndHandler: null, unhandledRejectionHandler: null }
  private lastError: Error | null = null
  // The input handler is a function. The Cordis traceable proxy re-wraps any
  // function-typed own property on every read, which would give React a new
  // handler reference on each render and re-fire the resize effect in a loop.
  // Storing it in a plain object keeps the reference identity-stable.
  private inputBox: { handler: ((event: TuiTerminalInputEvent) => void) | null } = { handler: null }
  private mounting = false
  private pendingMountElement: ReactElement | null = null

  constructor(ctx: Context, options: TuiTerminalLifecycleApplyOptions = {}) {
    super(ctx, tuiTerminalLifecycleServiceName)
    this.factory = options.factory ?? defaultInkFactory
    this.signalTargets = options.signalTargets ?? (['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    this.processTarget = options.processTarget ?? process
    ctx.effect(() => () => {
      this.disengage()
    }, 'terminal-lifecycle.disposal')
  }

  state(): TuiTerminalState {
    return this.currentState
  }

  failure(): Error | null {
    return this.lastError
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
    this.inputBox.handler = handler
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
    this.transition('active')
    this.attachSignals()
    this.attachFailureBoundaries()
  }

  render(node: TuiInkTreeComposed): void {
    if (this.currentState !== 'active') {
      throw new Error(`terminal-lifecycle: render() requires active state, observed ${this.currentState}`)
    }
    assertRenderableNode(node)
    if (!this.streams) {
      throw new Error(`terminal-lifecycle: render() called without terminal streams; observed ${this.currentState}`)
    }
    let element: ReactElement
    try {
      element = composeInkElement(node.descriptor, this.inputBox.handler)
    } catch (error) {
      this.routeRenderFailure(error)
      throw error
    }
    this.mountOrRerender(element)
  }

  renderWithCompose(compose: () => TuiTerminalCompositionResult): void {
    if (this.currentState !== 'active') {
      throw new Error(`terminal-lifecycle: renderWithCompose() requires active state, observed ${this.currentState}`)
    }
    if (!this.streams) {
      throw new Error(`terminal-lifecycle: renderWithCompose() called without terminal streams; observed ${this.currentState}`)
    }
    let element: ReactElement
    try {
      const result = compose()
      if (!result.ok) {
        const error = new Error(`terminal composition failed: ${result.error.code}: ${result.error.message}`)
        this.routeFailure(error, 'composition-error')
        return
      }
      assertRenderableNode(result.value)
      element = composeInkElement(result.value.descriptor, this.inputBox.handler)
    } catch (error) {
      this.routeRenderFailure(error)
      throw error
    }
    this.mountOrRerender(element)
  }

  private mountOrRerender(element: ReactElement): void {
    if (!this.streams) {
      throw new Error(`terminal-lifecycle: render() called without terminal streams; observed ${this.currentState}`)
    }
    try {
      if (this.instance) {
        this.instance.rerender(element)
        this.scheduleFlush()
        return
      }
      if (this.mounting) {
        this.pendingMountElement = element
        return
      }
      this.mounting = true
      const instance = this.factory(element, {
        stdout: this.streams.stdout,
        stdin: this.streams.stdin,
        stderr: this.streams.stderr,
        alternateScreen: true,
        maxFps: 30,
        incrementalRendering: true,
        interactive: true,
        exitOnCtrlC: false,
        patchConsole: false,
      })
      this.instance = instance
      this.mounting = false
      const pendingElement = this.pendingMountElement
      this.pendingMountElement = null
      if (pendingElement) {
        instance.rerender(pendingElement)
      }
    } catch (error) {
      this.mounting = false
      this.pendingMountElement = null
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
    this.routeFailure(error, 'render-exception')
  }

  private routeFailure(error: unknown, reason: string): void {
    this.lastError = error instanceof Error ? error : new Error(String(error))
    this.restore(reason)
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
      this.mounting = false
      this.pendingMountElement = null
      this.detachFailureBoundaries()
      this.detachSignals()
      this.streams = null
      void reason // captured for future diagnostics; never logged
    }
  }

  private disengage(): void {
    if (this.currentState === 'exited' || this.currentState === 'idle') return
    this.restore('cordis-disposal')
    this.inputBox.handler = null
    this.transition('exited')
  }

  private attachSignals(): void {
    for (const signal of this.signalTargets) {
      const handler: NodeJS.SignalsListener = () => {
        this.restore(`signal:${signal}`)
        this.transition('exited')
      }
      this.signalHandlers.set(signal, handler)
      this.processTarget.on(signal, handler)
    }
  }

  private detachSignals(): void {
    for (const [signal, handler] of this.signalHandlers) {
      this.processTarget.removeListener(signal, handler)
    }
    this.signalHandlers.clear()
  }

  private attachFailureBoundaries(): void {
    const stdinEndHandler = (): void => {
      if (this.currentState !== 'active' && this.currentState !== 'suspended') return
      this.restore('stdin-eof')
      this.transition('exited')
    }
    const unhandledRejectionHandler = (reason: unknown): void => {
      if (this.currentState !== 'active' && this.currentState !== 'suspended') return
      this.routeFailure(reason, 'unhandled-rejection')
    }
    this.failureBoundaryBox.stdinEndHandler = stdinEndHandler
    this.failureBoundaryBox.unhandledRejectionHandler = unhandledRejectionHandler
    this.streams?.stdin.on('end', stdinEndHandler)
    this.processTarget.on('unhandledRejection', unhandledRejectionHandler)
  }

  private detachFailureBoundaries(): void {
    const stdinEndHandler = this.failureBoundaryBox.stdinEndHandler
    if (stdinEndHandler) {
      this.streams?.stdin.removeListener('end', stdinEndHandler)
      this.failureBoundaryBox.stdinEndHandler = null
    }
    const unhandledRejectionHandler = this.failureBoundaryBox.unhandledRejectionHandler
    if (unhandledRejectionHandler) {
      this.processTarget.removeListener('unhandledRejection', unhandledRejectionHandler)
      this.failureBoundaryBox.unhandledRejectionHandler = null
    }
  }
}

export const name = 'terminal-lifecycle'

export function apply(ctx: Context, options: TuiTerminalLifecycleApplyOptions = {}): void {
  new TuiTerminalLifecycleService(ctx, options)
}
