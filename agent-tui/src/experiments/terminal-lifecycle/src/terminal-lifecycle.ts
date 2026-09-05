import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { Box, Static, Text, render as inkRender, useInput, usePaste } from 'ink'
import type { Key } from 'ink'
import { createElement, type ReactElement } from 'react'
import type { TuiInputIn01TerminalIntent } from '../../app-event-bus/src/app-event-bus.ts'
import type {
  TuiRealizedTerminalPrimitiveTree,
} from '../../../../contracts/tui/terminal-ui/terminal-frame-pipeline-result.types.ts'
import type { TuiTerminalPrimitiveNode } from '../../../../contracts/tui/terminal-ui/terminal-frame-tree.types.ts'
import type {
  TuiTerminalCarrierFailureSource,
  TuiTerminalCarrierFailure,
  TuiTerminalCarrierResult,
} from '../../../../contracts/tui/terminal-lifecycle/terminal-carrier-result.types.ts'
import type { TuiAppEventBus } from '../../app-event-bus/src/app-event-bus.ts'
import type { TuiTerminalOutputFace } from '../../../../contracts/tui/terminal-output-plugin/terminal-output-plugin.types.ts'
import type { TuiTerminalVisibleRow } from '../../../../contracts/tui/terminal-render-plugin/terminal-render-plugin.types.ts'
import type { TuiThemeFace } from '../../../../contracts/tui/theme-plugin/theme-plugin.types.ts'

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

export interface InkInstance {
  rerender(node: unknown): void
  unmount(): void
  waitUntilRenderFlush(): Promise<void>
  cleanup(): void
}

export type InkRenderFactory = (
  node: unknown,
  options: { stdout: NodeJS.WriteStream; stdin: NodeJS.ReadStream; stderr: NodeJS.WriteStream; alternateScreen: false; maxFps: 30; incrementalRendering: true; interactive: true; exitOnCtrlC: false; patchConsole: false },
) => InkInstance

export interface TuiTerminalLifecycle {
  readonly name: typeof tuiTerminalLifecycleServiceName
  state(): TuiTerminalState
  failure(): Error | null
  fail(error: Error, source?: string): void
  subscribe(listener: (state: TuiTerminalState) => void): () => void
  setInputHandler(handler: ((event: TuiTerminalInputEvent) => void) | null): void
  enter(streams: TuiRenderStreams): void
  render(tree: TuiRealizedTerminalPrimitiveTree): TuiTerminalCarrierResult
  suspend(reason: TuiTerminalSuspend): void
  resume(): void
  exit(reason: TuiTerminalExit): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiTerminalLifecycle: TuiTerminalLifecycle
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

export function defaultInkFactory(
  node: unknown,
  options: Parameters<InkRenderFactory>[1],
): InkInstance {
  // Ink's default render returns an Instance with rerender/unmount/waitUntilRenderFlush/cleanup.
  // The cast adapts the Ink Instance to our closed seam.
  return (inkRender as unknown as (node: unknown, options: unknown) => InkInstance)(node, options)
}

function displayRowAbsoluteKey(key: string): number | null {
  const match = /^display-row-(\d+)$/u.exec(key)
  return match === null ? null : Number(match[1])
}

function terminalStaticIdentity(sessionKey: string | null, width: number, paddingX: number): string {
  return `terminal-scrollback-${sessionKey ?? 'empty'}-${String(width)}-${String(paddingX)}`
}

function displayRowElement(row: TuiTerminalVisibleRow, paddingX: number, width: number, theme: TuiThemeFace): ReactElement {
  const dividerText = row.line.spans[0]?.text ?? ''
  const dividerMatch = /^(.*?)(─+)$/u.exec(dividerText)
  const dividerPrefix = dividerMatch?.[1] ?? ''
  const divider = row.line.spans.length === 1 && row.line.spans[0]?.style === 'dim' && dividerMatch !== null
  const spans = divider
    ? [{ ...row.line.spans[0]!, text: `${dividerPrefix}${'─'.repeat(Math.max(1, width - paddingX * 2 - dividerPrefix.length))}` }]
    : row.line.spans.length > 0
      ? row.line.spans
      : [{ text: ' ', style: 'white' as const }]
  return createElement(
    Box,
    { key: `display-row-${String(row.absoluteRow)}`, flexDirection: 'row', paddingX },
    ...spans.map((span, index) => createElement(
      Text,
      {
        key: `display-row-${String(row.absoluteRow)}-${String(index)}`,
        ...(span.style === 'dim'
          ? { dimColor: true, color: theme.resolveColor('dim') }
          : span.style === 'thinking'
            ? { color: theme.resolveColor('thinking'), italic: true }
            : { color: theme.resolveColor(span.style) }),
      },
      span.text,
    )),
  )
}

function realizeCarrierPrimitive(node: TuiTerminalPrimitiveNode, stableRows: ReadonlySet<number>, theme: TuiThemeFace): ReactElement | null {
  if (node.kind === 'text') {
    const { bold, italic, dimColor, inverse, color, backgroundColor } = node.style
    return createElement(
      Text,
      {
        key: node.key,
        ...(bold === undefined ? {} : { bold }),
        ...(italic === undefined ? {} : { italic }),
        ...(dimColor === undefined ? {} : { dimColor }),
        ...(inverse === undefined ? {} : { inverse }),
      ...(color === undefined ? {} : { color: theme.resolveColor(color) }),
      ...(backgroundColor === undefined ? {} : { backgroundColor: theme.resolveColor(backgroundColor) }),
      },
      node.text,
    )
  }
  const { flexDirection, width, height, minHeight, flexGrow, flexShrink, overflow, borderStyle, borderColor, backgroundColor, paddingX } = node.style
  const children = node.children
    .filter(child => {
      const absoluteRow = child.kind === 'box' ? displayRowAbsoluteKey(child.key) : null
      return absoluteRow === null || !stableRows.has(absoluteRow)
    })
    .map(child => realizeCarrierPrimitive(child, stableRows, theme))
    .filter((child): child is ReactElement => child !== null)
  return createElement(
    Box,
    {
      key: node.key,
      flexDirection,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(minHeight === undefined ? {} : { minHeight }),
      ...(flexGrow === undefined ? {} : { flexGrow }),
      ...(flexShrink === undefined ? {} : { flexShrink }),
      ...(overflow === undefined ? {} : { overflow }),
      ...(borderStyle === undefined ? {} : { borderStyle }),
      ...(borderColor === undefined ? {} : { borderColor: theme.resolveColor(borderColor) }),
      ...(backgroundColor === undefined ? {} : { backgroundColor: theme.resolveColor(backgroundColor) }),
      ...(paddingX === undefined ? {} : { paddingX }),
    },
    ...children,
  )
}

function constrainLiveViewport(
  root: TuiTerminalPrimitiveNode,
  stableRowCount: number,
): TuiTerminalPrimitiveNode {
  if (root.kind !== 'box' || root.style.height === undefined || root.style.minHeight === undefined) return root
  const reservedHistoryRows = Math.min(stableRowCount, root.style.height - root.style.minHeight)
  const height = root.style.height - reservedHistoryRows
  if (height === root.style.height) return root
  return Object.freeze({
    ...root,
    style: Object.freeze({ ...root.style, height }),
  })
}

function pasteKey(): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  }
}

function signalKey(): Key {
  return { ...pasteKey(), ctrl: true }
}

function TerminalInputBridge({
  handlerBox,
  children,
}: {
  handlerBox: { handler: ((event: TuiTerminalInputEvent) => void) | null }
  children: ReactElement
}): ReactElement {
  useInput((input, key) => {
    projectKeyboardInput(input, key, handlerBox.handler)
  })
  usePaste(input => {
    handlerBox.handler?.({ type: 'key', input, key: pasteKey() })
  })
  return children
}

export function projectKeyboardInput(
  input: string,
  key: Key,
  handler: ((event: TuiTerminalInputEvent) => void) | null,
): void {
    if (handler === null) return
    if (input === '\u001b[13;2u' || input === '\u001b[27;2;13~' || input === '\u001b[13;2~') {
      handler({ type: 'key', input: '', key: { ...key, return: true, shift: true } })
      return
    }
    const etxIndex = input.indexOf('\u0003')
    if (etxIndex >= 0) {
      if (etxIndex > 0) projectKeyboardInput(input.slice(0, etxIndex), key, handler)
      handler({ type: 'key', input: 'c', key: { ...key, ctrl: true } })
      if (etxIndex + 1 < input.length) projectKeyboardInput(input.slice(etxIndex + 1), key, handler)
      return
    }
    if (key.return) {
      handler({ type: 'key', input: '', key })
      return
    }
    let offset = 0
    for (let index = 0; index < input.length; index += 1) {
      const character = input[index]
      if (character !== '\r' && character !== '\n' && character !== '\t') continue
      if (index > offset) handler({ type: 'key', input: input.slice(offset, index), key })
      if (character === '\t') {
        handler({ type: 'key', input: '', key: { ...key, return: false, tab: true } })
        offset = index + 1
        continue
      }
      handler({ type: 'key', input: '', key: { ...key, return: true } })
      if (character === '\r' && input[index + 1] === '\n') index += 1
      offset = index + 1
    }
    if (offset < input.length) handler({ type: 'key', input: input.slice(offset), key })
    else if (input.length === 0 && !key.return) handler({ type: 'key', input: '', key })
}

function realizeCarrierTree(
  root: TuiTerminalPrimitiveNode,
  handlerBox: { handler: ((event: TuiTerminalInputEvent) => void) | null },
  sessionKey: string | null,
  stableRows: readonly TuiTerminalVisibleRow[],
  pendingStableRows: readonly TuiTerminalVisibleRow[],
  width: number,
  paddingX: number,
  theme: TuiThemeFace,
): ReactElement {
  const stableIds = new Set(stableRows.map(row => row.absoluteRow))
  const lastStableRow = stableRows.at(-1)?.absoluteRow
  const stableElements = lastStableRow === undefined ? [] : new Array<ReactElement>(lastStableRow + 1)
  for (const row of pendingStableRows) stableElements[row.absoluteRow] = displayRowElement(row, paddingX, width, theme)
  const dynamicRoot = realizeCarrierPrimitive(constrainLiveViewport(root, stableRows.length), stableIds, theme)
  if (dynamicRoot === null) throw new Error('terminal-lifecycle: realized tree lost its root')
  return createElement(
    TerminalInputBridge,
    {
      key: 'terminal-input-bridge',
      handlerBox,
      children: createElement(
        Box,
        { key: 'terminal-carrier-root', flexDirection: 'column' },
        createElement(Static, {
          key: terminalStaticIdentity(sessionKey, width, paddingX),
          items: stableElements,
          children: (item: unknown) => item as ReactElement,
        }),
        dynamicRoot,
      ),
    },
  )
}

// ---------- Service ----------

export interface TuiTerminalLifecycleApplyOptions {
  readonly factory?: InkRenderFactory
  readonly signalTargets?: ReadonlyArray<NodeJS.Signals>
  readonly processTarget?: TuiTerminalProcessEvents
  readonly eventBus?: Pick<TuiAppEventBus, 'publish'>
}

export class TuiTerminalLifecycleService extends Service implements TuiTerminalLifecycle {
  readonly name = tuiTerminalLifecycleServiceName

  private currentState: TuiTerminalState = 'idle'
  private instance: InkInstance | null = null
  private streams: TuiRenderStreams | null = null
  private factory: InkRenderFactory
  private signalTargets: ReadonlyArray<NodeJS.Signals>
  private processTarget: TuiTerminalProcessEvents
  private readonly eventBus: Pick<TuiAppEventBus, 'publish'> | null
  private readonly output: TuiTerminalOutputFace | null
  private readonly theme: TuiThemeFace
  private listeners = new Set<(state: TuiTerminalState) => void>()
  private pendingFlush: Promise<void> | null = null
  private signalHandlers = new Map<NodeJS.Signals, NodeJS.SignalsListener>()
  private signalDispatchDepth = 0
  private signalDetachPending = false
  // Cordis wraps function-typed own properties on read. EventEmitter removal
  // requires the exact listener identity, so keep lifecycle callbacks nested
  // in a plain box just like the terminal input handler.
  private failureBoundaryBox: {
    stdinEndHandler: (() => void) | null
    unhandledRejectionHandler: ((reason: unknown, promise: Promise<unknown>) => void) | null
  } = { stdinEndHandler: null, unhandledRejectionHandler: null }
  private resizeBox: { listener: (() => void) | null } = { listener: null }
  private lastError: Error | null = null
  // The input handler is a function. The Cordis traceable proxy re-wraps any
  // function-typed own property on every read, which would give React a new
  // handler reference on each render and re-fire the resize effect in a loop.
  // Storing it in a plain object keeps the reference identity-stable.
  private inputBox: { handler: ((event: TuiTerminalInputEvent) => void) | null } = { handler: null }
  private mounting = false
  private pendingMountElement: ReactElement | null = null
  private pendingRerenderElement: ReactElement | null = null
  private pendingStaticIdentity: string | null = null
  private pendingStableRows = new Map<number, TuiTerminalVisibleRow>()
  private committedStaticIdentity: string | null = null
  private committedStableRows = new Map<number, TuiTerminalVisibleRow>()

  constructor(ctx: Context, options: TuiTerminalLifecycleApplyOptions = {}) {
    super(ctx, tuiTerminalLifecycleServiceName)
    this.factory = options.factory ?? defaultInkFactory
    this.signalTargets = options.signalTargets ?? (['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    this.processTarget = options.processTarget ?? process
    this.eventBus = options.eventBus
      ?? (ctx as Context & { readonly tuiEventBus?: TuiAppEventBus }).tuiEventBus
      ?? null
    this.output = ctx.tuiTerminalOutput ?? null
    this.theme = ctx.tuiTheme ?? (() => { throw new Error('terminal-lifecycle: theme plugin is required') })()
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

  fail(error: Error, source = 'lifecycle.fail'): void {
    if (this.currentState === 'failed' || this.currentState === 'exited') return
    if (!(error instanceof Error)) {
      throw new TypeError('terminal-lifecycle: fail() requires an Error instance')
    }
    this.routeFailure(error, source)
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
    this.attachResizeListener()
  }

  render(tree: TuiRealizedTerminalPrimitiveTree): TuiTerminalCarrierResult {
    if (this.currentState !== 'active') {
      this.fail(new Error(`terminal-lifecycle: render() requires active state, observed ${this.currentState}`), 'carrier-state')
      return { ok: false, error: { stage: 'rerender', code: 'terminal-carrier-failed', message: 'terminal lifecycle is not active', cause: new Error(`observed ${this.currentState}`) } }
    }
    if (!this.streams) {
      const cause = new Error(`observed ${this.currentState}`)
      this.fail(new Error('terminal-lifecycle: render() called without terminal streams', { cause }), 'carrier-streams')
      return { ok: false, error: { stage: 'rerender', code: 'terminal-carrier-failed', message: 'terminal streams are unavailable', cause } }
    }
    const output = this.output?.read()
    const stableRows = output?.stableRows ?? []
    const sessionKey = output?.sessionKey ?? null
    const width = output?.width ?? 0
    const paddingX = output?.paddingX ?? 0
    const pendingStableRows = output?.pendingStableRows ?? stableRows
    const staticIdentity = terminalStaticIdentity(sessionKey, width, paddingX)
    if (this.committedStaticIdentity !== staticIdentity) {
      this.committedStaticIdentity = staticIdentity
      this.committedStableRows.clear()
    }
    const firstMount = this.instance === null && !this.mounting
    const pendingRows = firstMount
      ? pendingStableRows
      : this.accumulatePendingStableRows(sessionKey, width, paddingX, pendingStableRows)
    if (firstMount) {
      this.committedStaticIdentity = staticIdentity
      this.committedStableRows.clear()
      for (const row of stableRows) this.committedStableRows.set(row.absoluteRow, row)
    }
    const fullElement = realizeCarrierTree(
      tree.root,
      this.inputBox,
      sessionKey,
      stableRows,
      pendingRows,
      width,
      paddingX,
      this.theme,
    )
    const immediateStableRows = this.pendingFlush === null
      ? stableRows
      : [...this.committedStableRows.values()].sort((left, right) => left.absoluteRow - right.absoluteRow)
    const immediatePendingRows = this.pendingFlush === null ? pendingRows : []
    const immediateElement = this.pendingFlush === null
      ? fullElement
      : realizeCarrierTree(
        tree.root,
        this.inputBox,
        sessionKey,
        immediateStableRows,
        immediatePendingRows,
        width,
        paddingX,
        this.theme,
      )
    return this.mountOrRerender(immediateElement, fullElement)
  }

  private mountOrRerender(element: ReactElement, committedElement = element): TuiTerminalCarrierResult {
    if (!this.streams) {
      const cause = new Error(`observed ${this.currentState}`)
      this.fail(new Error('terminal-lifecycle: mount() called without terminal streams', { cause }), 'carrier-mount')
      return { ok: false, error: { stage: 'mount', code: 'terminal-carrier-failed', message: 'terminal streams are unavailable', cause } }
    }
    let mountedBeforeAttempt = this.instance != null
    try {
      if (this.instance) {
        if (this.pendingFlush !== null) {
          this.pendingRerenderElement = committedElement
          this.instance.rerender(element)
          return { ok: true }
        }
        this.instance.rerender(element)
        this.scheduleFlush()
        return { ok: true }
      }
      if (this.mounting) {
        this.pendingMountElement = element
        return { ok: true }
      }
      this.mounting = true
      const instance = this.factory(element, {
        stdout: this.streams.stdout,
        stdin: this.streams.stdin,
        stderr: this.streams.stderr,
        alternateScreen: false,
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
      const cause = error instanceof Error ? error : new Error(String(error))
      const stage: TuiTerminalCarrierFailure['stage'] = mountedBeforeAttempt ? 'rerender' : 'mount'
      this.fail(new Error(`terminal-lifecycle: ${stage} failed`, { cause }), `terminal-carrier:${stage}`)
      return { ok: false, error: { stage, code: 'terminal-carrier-failed', message: cause.message, cause } }
    }
    this.scheduleFlush()
    return { ok: true }
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

  private accumulatePendingStableRows(
    sessionKey: string | null,
    width: number,
    paddingX: number,
    rows: readonly TuiTerminalVisibleRow[],
  ): readonly TuiTerminalVisibleRow[] {
    const identity = terminalStaticIdentity(sessionKey, width, paddingX)
    if (this.pendingStaticIdentity !== identity) {
      this.pendingStaticIdentity = identity
      this.pendingStableRows.clear()
    }
    for (const row of rows) this.pendingStableRows.set(row.absoluteRow, row)
    return [...this.pendingStableRows.values()].sort((left, right) => left.absoluteRow - right.absoluteRow)
  }

  private clearPendingStableRows(): void {
    this.pendingStaticIdentity = null
    this.pendingStableRows.clear()
  }

  private commitPendingStableRows(): void {
    if (this.pendingStaticIdentity === null) return
    if (this.committedStaticIdentity !== this.pendingStaticIdentity) {
      this.committedStaticIdentity = this.pendingStaticIdentity
      this.committedStableRows.clear()
    }
    for (const [absoluteRow, row] of this.pendingStableRows) this.committedStableRows.set(absoluteRow, row)
  }

  private scheduleFlush(): void {
    if (this.pendingFlush) return
    const instance = this.instance
    if (!instance) return
    this.pendingFlush = instance.waitUntilRenderFlush().catch((cause: unknown) => {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      this.fail(new Error('terminal-lifecycle: async render flush failed', { cause: error }), 'terminal-carrier:flush')
    }).finally(() => {
      this.pendingFlush = null
      const pending = this.pendingRerenderElement
      this.pendingRerenderElement = null
      this.commitPendingStableRows()
      this.clearPendingStableRows()
      if (pending === null || this.instance !== instance || this.currentState !== 'active') return
      try {
        instance.rerender(pending)
        this.scheduleFlush()
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause))
        this.fail(new Error('terminal-lifecycle: queued rerender failed', { cause: error }), 'terminal-carrier:rerender')
      }
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
      this.detachResizeListener()
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
        this.signalDispatchDepth += 1
        try {
          if (signal === 'SIGINT' && this.inputBox.handler !== null) {
            this.inputBox.handler({ type: 'key', input: 'c', key: signalKey() })
            return
          }
          this.restore(`signal:${signal}`)
          this.transition('exited')
        } finally {
          this.signalDispatchDepth -= 1
          if (this.signalDispatchDepth === 0 && this.signalDetachPending) {
            this.signalDetachPending = false
            // Keep the SIGINT listener installed until the current signal
            // dispatch has fully returned. Removing it from inside the
            // handler lets Node apply SIGINT's default action to this same
            // signal after an app-shell Ctrl+C confirmation exits the TUI.
            setImmediate(() => this.detachSignals())
          }
        }
      }
      this.signalHandlers.set(signal, handler)
      this.processTarget.on(signal, handler)
    }
  }

  private detachSignals(): void {
    if (this.signalDispatchDepth > 0) {
      this.signalDetachPending = true
      return
    }
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

  private observeViewport(streams: TuiRenderStreams): void {
    const columns = streams.stdout.columns
    const rows = streams.stdout.rows
    if (typeof columns !== 'number' || !Number.isSafeInteger(columns) || columns <= 0
      || typeof rows !== 'number' || !Number.isSafeInteger(rows) || rows <= 0) {
      this.fail(new Error('terminal-lifecycle: real stdout did not expose a positive columns and rows pair'), 'viewport-observation')
      return
    }
    if (this.eventBus === null) {
      this.fail(new Error('terminal-lifecycle: terminal viewport publisher is not installed'), 'viewport-observation')
      return
    }
    this.eventBus.publish({ kind: 'terminal.resize', sourceId: 'terminal.streams', size: Object.freeze({ columns, rows }) })
  }

  private attachResizeListener(): void {
    if (!this.streams || this.resizeBox.listener) return
    const listener = (): void => {
      if (!this.streams || (this.currentState !== 'active' && this.currentState !== 'suspended')) return
      this.observeViewport(this.streams)
    }
    this.resizeBox.listener = listener
    this.streams.stdout.on('resize', listener)
    this.observeViewport(this.streams)
  }

  private detachResizeListener(): void {
    const listener = this.resizeBox.listener
    if (!listener || !this.streams) return
    this.streams.stdout.removeListener('resize', listener)
    this.resizeBox.listener = null
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
