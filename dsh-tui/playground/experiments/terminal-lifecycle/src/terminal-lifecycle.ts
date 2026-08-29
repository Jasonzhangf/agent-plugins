import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { Box, Text, render as inkRender, useInput, usePaste } from 'ink'
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
  options: { stdout: NodeJS.WriteStream; stdin: NodeJS.ReadStream; stderr: NodeJS.WriteStream; alternateScreen: true; maxFps: 30; incrementalRendering: true; interactive: true; exitOnCtrlC: false; patchConsole: false },
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

function realizeCarrierPrimitive(node: TuiTerminalPrimitiveNode): ReactElement {
  if (node.kind === 'text') {
    const { bold, dimColor, inverse, color, backgroundColor } = node.style
    return createElement(
      Text,
      {
        key: node.key,
        ...(bold === undefined ? {} : { bold }),
        ...(dimColor === undefined ? {} : { dimColor }),
        ...(inverse === undefined ? {} : { inverse }),
      ...(color === undefined ? {} : { color }),
      ...(backgroundColor === undefined ? {} : { backgroundColor }),
      },
      node.text,
    )
  }
  const { flexDirection, width, height, flexGrow, flexShrink, overflow, borderStyle, borderColor, backgroundColor, paddingX } = node.style
  return createElement(
    Box,
    {
      key: node.key,
      flexDirection,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(flexGrow === undefined ? {} : { flexGrow }),
      ...(flexShrink === undefined ? {} : { flexShrink }),
      ...(overflow === undefined ? {} : { overflow }),
      ...(borderStyle === undefined ? {} : { borderStyle }),
      ...(borderColor === undefined ? {} : { borderColor }),
      ...(backgroundColor === undefined ? {} : { backgroundColor }),
      ...(paddingX === undefined ? {} : { paddingX }),
    },
    ...node.children.map(child => realizeCarrierPrimitive(child)),
  )
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
      if (character !== '\r' && character !== '\n') continue
      if (index > offset) handler({ type: 'key', input: input.slice(offset, index), key })
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
): ReactElement {
  return createElement(
    TerminalInputBridge,
    { key: 'terminal-input-bridge', handlerBox, children: realizeCarrierPrimitive(root) },
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

  constructor(ctx: Context, options: TuiTerminalLifecycleApplyOptions = {}) {
    super(ctx, tuiTerminalLifecycleServiceName)
    this.factory = options.factory ?? defaultInkFactory
    this.signalTargets = options.signalTargets ?? (['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    this.processTarget = options.processTarget ?? process
    this.eventBus = options.eventBus
      ?? (ctx as Context & { readonly tuiEventBus?: TuiAppEventBus }).tuiEventBus
      ?? null
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
    return this.mountOrRerender(realizeCarrierTree(tree.root, this.inputBox))
  }

  private mountOrRerender(element: ReactElement): TuiTerminalCarrierResult {
    if (!this.streams) {
      const cause = new Error(`observed ${this.currentState}`)
      this.fail(new Error('terminal-lifecycle: mount() called without terminal streams', { cause }), 'carrier-mount')
      return { ok: false, error: { stage: 'mount', code: 'terminal-carrier-failed', message: 'terminal streams are unavailable', cause } }
    }
    let mountedBeforeAttempt = this.instance != null
    try {
      if (this.instance) {
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

  private scheduleFlush(): void {
    if (this.pendingFlush) return
    const instance = this.instance
    if (!instance) return
    this.pendingFlush = instance.waitUntilRenderFlush().catch((cause: unknown) => {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      this.fail(new Error('terminal-lifecycle: async render flush failed', { cause: error }), 'terminal-carrier:flush')
    }).finally(() => {
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
