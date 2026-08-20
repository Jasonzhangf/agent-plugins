import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {
  TuiInputIn01TerminalIntent,
  TuiInputIn02AppEvent,
} from '../../app-event-bus/src/app-event-bus.ts'
import { validateViewportSize } from '../../app-event-bus/src/app-event-bus.ts'
import type {
  TuiTerminalComposerState,
  TuiTerminalLocalEchoState,
  TuiTerminalNodeLifecycle,
  TuiTerminalOverlayState,
  TuiTerminalStatusState,
} from '../../../../contracts/tui/terminal-ui/terminal-shell.types.ts'

export const appShellServiceName = 'tuiShell' as const

export type TuiInputIn03BusinessAction =
  | {
      readonly kind: 'session.prompt'
      readonly actionId: string
      readonly text: string
      readonly attachments?: readonly string[]
    }
  | {
      readonly kind: 'session.cancel'
      readonly actionId: string
    }
  | {
      readonly kind: 'interaction.approval.respond'
      readonly actionId: string
      readonly interactionId: string
      readonly decision: boolean
    }
  | {
      readonly kind: 'interaction.question.respond'
      readonly actionId: string
      readonly interactionId: string
      readonly answer: unknown
    }

export interface TuiShellControlAction {
  readonly kind: 'command'
  readonly input: string
}

export interface TuiShellPolicy {
  readonly composerEmpty: boolean
  readonly sessionRunning: boolean
  readonly sessionSelected: boolean
}

export interface TuiShell {
  readonly name: typeof appShellServiceName
  dispatch(event: TuiInputIn02AppEvent): void
  canExit(state: { empty: boolean; running: boolean }): boolean
  updatePolicy(partial: Partial<TuiShellPolicy>): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiShell: TuiShell
  }
}

const EVENT_KEYS = new Set(['eventId', 'acceptedAt', 'intent'])
const FORBIDDEN_INTENT_KEYS = new Set(['transport', 'frame', 'rpcId', 'endpoint', 'sequence', 'metadata', 'control', 'retry', 'ack'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function assertNoForbiddenKeys(value: Record<string, unknown>, path: string): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_INTENT_KEYS.has(key)) {
      throw new TypeError(`app-shell: forbidden control key '${key}' at ${path}`)
    }
    const child = value[key]
    if (child !== null && typeof child === 'object') {
      assertNoForbiddenKeys(child as Record<string, unknown>, `${path}.${key}`)
    }
  }
}

function assertAppEvent(value: unknown): asserts value is TuiInputIn02AppEvent {
  if (!isPlainObject(value)) {
    throw new TypeError('app-shell: TuiInputIn02AppEvent must be a plain object')
  }
  for (const key of Object.keys(value)) {
    if (!EVENT_KEYS.has(key)) throw new TypeError(`app-shell: unexpected AppEvent field '${key}'`)
  }
  if (typeof value['eventId'] !== 'string' || value['eventId'].length === 0) {
    throw new TypeError('app-shell: AppEvent requires a non-empty eventId')
  }
  if (typeof value['acceptedAt'] !== 'number' || !Number.isFinite(value['acceptedAt'])) {
    throw new TypeError('app-shell: AppEvent requires a finite acceptedAt')
  }
  if (!isPlainObject(value['intent'])) {
    throw new TypeError('app-shell: AppEvent requires a typed intent')
  }
  assertNoForbiddenKeys(value['intent'], 'event.intent')
}

function nextActionId(seq: number): string {
  return `a${String(seq)}`
}

export class TuiShellService extends Service implements TuiShell {
  readonly name = appShellServiceName
  private readonly policy: TuiShellPolicy
  private readonly dispatchBusinessAction: (action: TuiInputIn03BusinessAction) => void
  private readonly dispatchControlAction: (action: TuiShellControlAction) => void
  private sequence = 0

  constructor(ctx: Context, options: {
    policy: TuiShellPolicy
    dispatchBusiness: (action: TuiInputIn03BusinessAction) => void
    dispatchControl: (action: TuiShellControlAction) => void
  }) {
    super(ctx, appShellServiceName)
    this.policy = options.policy
    this.dispatchBusinessAction = options.dispatchBusiness
    this.dispatchControlAction = options.dispatchControl
    ctx.effect(() => () => {
      this.sequence = 0
    }, 'app-shell.dispose')
  }

  dispatch(event: TuiInputIn02AppEvent): void {
    assertAppEvent(event)
    const intent = event.intent
    const kind = intent.kind
    switch (kind) {
      case 'terminal.submit':
        this.assertSessionSelected()
        this.dispatchBusinessAction(this.action({
          kind: 'session.prompt',
          text: intent.text,
          ...(intent.attachments?.length ? { attachments: intent.attachments } : {}),
        }))
        return
      case 'terminal.cancel':
        this.assertSessionRunning()
        this.dispatchBusinessAction(this.action({ kind: 'session.cancel' }))
        return
      case 'terminal.command':
        this.assertSessionSelected()
        this.dispatchControlAction({
          kind: 'command',
          input: intent.input,
        })
        return
      case 'interaction.approval':
        if (!intent.payload || typeof intent.payload['interactionId'] !== 'string') {
          throw new TypeError('app-shell: approval response requires interactionId')
        }
        this.dispatchBusinessAction(this.action({
          kind: 'interaction.approval.respond',
          interactionId: intent.payload['interactionId'],
          decision: intent.decision,
        }))
        return
      case 'interaction.question':
        if (!intent.payload || typeof intent.payload['interactionId'] !== 'string') {
          throw new TypeError('app-shell: question response requires interactionId')
        }
        this.dispatchBusinessAction(this.action({
          kind: 'interaction.question.respond',
          interactionId: intent.payload['interactionId'],
          answer: intent.answer,
        }))
        return
      case 'terminal.resize':
        throw new TypeError('app-shell: terminal.resize is control state; it must never become a business action')
      default:
        throw new TypeError(`app-shell: unknown event kind ${String(kind)}`)
    }
  }

  canExit(state: { empty: boolean; running: boolean }): boolean {
    return state.empty && !state.running
  }

  updatePolicy(partial: Partial<TuiShellPolicy>): void {
    if (!partial || typeof partial !== 'object') {
      throw new TypeError('app-shell: policy update must be an object')
    }
    Object.assign(this.policy, partial)
  }

  private assertSessionSelected(): void {
    if (!this.policy.sessionSelected) {
      throw new Error('app-shell: no Session is selected; submit fails closed')
    }
  }

  private assertSessionRunning(): void {
    if (!this.policy.sessionRunning) {
      throw new Error('app-shell: Session is not running; cancel fails closed')
    }
  }

  private action<T extends Omit<TuiInputIn03BusinessAction, 'actionId'>>(partial: T): T & { readonly actionId: string } {
    this.sequence += 1
    return Object.freeze({ ...partial, actionId: nextActionId(this.sequence) })
  }
}

export const name = 'app-shell'

export function apply(ctx: Context, options: {
  policy: TuiShellPolicy
  dispatchBusiness: (action: TuiInputIn03BusinessAction) => void
  dispatchControl: (action: TuiShellControlAction) => void
}): void {
  new TuiShellService(ctx, options)
}

// ---------- Composer state ----------

export function emptyComposerState(): TuiTerminalComposerState {
  return {
    text: '',
    cursor: 0,
    lines: [''],
    cursorLine: 0,
    cursorColumn: 0,
    mode: 'idle',
  }
}

function derivedComposerState(state: TuiTerminalComposerState, text: string, cursor: number): TuiTerminalComposerState {
  const before = text.slice(0, cursor)
  const cursorLine = before.split('\n').length - 1
  const cursorColumn = before.length - before.lastIndexOf('\n') - 1
  return {
    text,
    cursor,
    lines: Object.freeze(text.split('\n')),
    cursorLine,
    cursorColumn,
    mode: state.mode,
  }
}

export function composerInsertText(state: TuiTerminalComposerState, value: string): TuiTerminalComposerState {
  const text = state.text.slice(0, state.cursor) + value + state.text.slice(state.cursor)
  return derivedComposerState(state, text, state.cursor + value.length)
}

export function composerNewline(state: TuiTerminalComposerState): TuiTerminalComposerState {
  return composerInsertText(state, '\n')
}

export function composerBackspace(state: TuiTerminalComposerState): TuiTerminalComposerState {
  if (state.cursor === 0) return state
  const text = state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor)
  return derivedComposerState(state, text, state.cursor - 1)
}

export function composerDelete(state: TuiTerminalComposerState): TuiTerminalComposerState {
  if (state.cursor >= state.text.length) return state
  const text = state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1)
  return derivedComposerState(state, text, state.cursor)
}

export function composerMoveLeft(state: TuiTerminalComposerState): TuiTerminalComposerState {
  if (state.cursor === 0) return state
  return derivedComposerState(state, state.text, state.cursor - 1)
}

export function composerMoveRight(state: TuiTerminalComposerState): TuiTerminalComposerState {
  if (state.cursor >= state.text.length) return state
  return derivedComposerState(state, state.text, state.cursor + 1)
}

export function composerHome(state: TuiTerminalComposerState): TuiTerminalComposerState {
  const lineStart = state.text.lastIndexOf('\n', state.cursor - 1) + 1
  return derivedComposerState(state, state.text, lineStart)
}

export function composerEnd(state: TuiTerminalComposerState): TuiTerminalComposerState {
  const nextNewline = state.text.indexOf('\n', state.cursor)
  const lineEnd = nextNewline === -1 ? state.text.length : nextNewline
  return derivedComposerState(state, state.text, lineEnd)
}

export function composerClear(state: TuiTerminalComposerState): TuiTerminalComposerState {
  return { ...emptyComposerState(), mode: state.mode }
}

export function composerSetMode(state: TuiTerminalComposerState, mode: TuiTerminalComposerState['mode']): TuiTerminalComposerState {
  return { ...state, mode }
}

// ---------- Runtime controller ----------

export interface TuiRuntimeSnapshotLike {
  readonly sessionId: string
  readonly cwd: string
  readonly running: boolean
  readonly error?: string
}

export interface TuiRuntimePresentationLike {
  readonly nodes: ReadonlyArray<
    { readonly nodeId: string; readonly kind: string;
      readonly publicationRevision: number; readonly lifecycle: TuiTerminalNodeLifecycle }
    & { readonly value: Readonly<Record<string, unknown>> }
  >
  readonly publicationRevision: number
}

export interface TuiRuntimeUiLike {
  composeInkTree(input: {
    model: TuiRuntimePresentationLike
    composer: TuiTerminalComposerState
    status: TuiTerminalStatusState
    width: number
    scrollOffset: number
    localEchoes: readonly TuiTerminalLocalEchoState[]
    overlay?: TuiTerminalOverlayState
  }): { readonly publicationRevision: number; readonly descriptor: unknown }
}

export interface TuiRuntimeLifecycleLike {
  state(): string
  setInputHandler(handler: ((event: TuiRuntimeTerminalEvent) => void) | null): void
  render(tree: { readonly publicationRevision: number; readonly descriptor: unknown }): void
  enter(streams: {
    readonly stdout: NodeJS.WriteStream
    readonly stdin: NodeJS.ReadStream
    readonly stderr: NodeJS.WriteStream
  }): void
  exit(reason: { readonly reason: string }): void
}

export interface TuiRuntimeKeyState {
  readonly ctrl: boolean
  readonly return: boolean
  readonly shift: boolean
  readonly backspace: boolean
  readonly delete: boolean
  readonly leftArrow: boolean
  readonly rightArrow: boolean
  readonly upArrow: boolean
  readonly downArrow: boolean
  readonly pageUp: boolean
  readonly pageDown: boolean
  readonly home: boolean
  readonly end: boolean
  readonly escape: boolean
}

export type TuiRuntimeTerminalEvent =
  | {
      readonly type: 'key'
      readonly input: string
      readonly key: TuiRuntimeKeyState
    }
  | {
      readonly type: 'resize'
      readonly columns: number
      readonly rows: number
    }

export interface TuiRuntimeDeps {
  readonly getSnapshot: () => TuiRuntimeSnapshotLike | null
  readonly getPresentation: () => TuiRuntimePresentationLike | null
  readonly shell: TuiShell
  readonly ui: TuiRuntimeUiLike
  readonly lifecycle: TuiRuntimeLifecycleLike
  readonly focus: {
    shouldExitOnCtrlD(state: { empty: boolean; running: boolean }): boolean
    shouldExitOnKey(key: string): boolean
    pushView(view: TuiTerminalOverlayState['view']): () => void
  }
  readonly emitEvent: (event: TuiInputIn01TerminalIntent) => void
  readonly width?: number
}

export interface TuiRuntimeController {
  start(): void
  stop(reason?: string): void
  render(): void
  reportError(message: string): void
  reportSubmissionError(message: string): void
  clearError(): void
  handleTerminalEvent(event: TuiRuntimeTerminalEvent): void
  openOverlay(
    overlay: Omit<TuiTerminalOverlayState, 'selectedIndex'> & { readonly selectedIndex?: number },
    onSelect?: (selectedIndex: number) => void,
  ): void
  closeOverlay(): void
}

export function createTuiRuntimeController(deps: TuiRuntimeDeps): TuiRuntimeController {
  let composer = emptyComposerState()
  let width = deps.width ?? 80
  let scrollOffset = 0
  let fatalMessage: string | undefined
  let overlay: TuiTerminalOverlayState | undefined
  let overlaySelect: ((selectedIndex: number) => void) | undefined
  let overlayFocusDispose: (() => void) | undefined
  let echoSequence = 0
  let localEchoes: Array<TuiTerminalLocalEchoState & { readonly afterRevision: number }> = []

  const snapshot = (): TuiRuntimeSnapshotLike | null => deps.getSnapshot()
  const presentation = (): TuiRuntimePresentationLike | null => deps.getPresentation()
  const running = (): boolean => snapshot()?.running === true
  const selected = (): boolean => snapshot() !== null

  function status(): TuiTerminalStatusState {
    return {
      sessionId: snapshot()?.sessionId ?? null,
      cwd: snapshot()?.cwd ?? null,
      mode: fatalMessage || snapshot()?.error ? 'error' : running() ? 'streaming' : 'idle',
      publicationRevision: presentation()?.publicationRevision ?? 0,
      ...(fatalMessage ? { message: fatalMessage } : snapshot()?.error ? { message: snapshot()!.error } : {}),
    }
  }

  function publishEvent(event: TuiInputIn01TerminalIntent): void {
    deps.emitEvent(event)
  }

  function renderNow(): void {
    deps.shell.updatePolicy({
      composerEmpty: composer.text.length === 0,
      sessionRunning: running(),
      sessionSelected: selected(),
    })
    const model = presentation()
    if (!model || deps.lifecycle.state() !== 'active') return
    const matchedNodeIds = new Set<string>()
    localEchoes = localEchoes.filter(echo => {
      const match = model.nodes.find(node =>
        !matchedNodeIds.has(node.nodeId)
        && node.kind === 'conversation.user'
        && node.publicationRevision > echo.afterRevision
        && node.value['text'] === echo.text)
      if (match === undefined) return true
      matchedNodeIds.add(match.nodeId)
      return false
    })
    composer = composerSetMode(
      composer,
      running() ? 'streaming' : fatalMessage || snapshot()?.error ? 'error' : 'idle',
    )
    const tree = deps.ui.composeInkTree({
      model,
      composer,
      status: status(),
      width,
      scrollOffset,
      localEchoes: localEchoes.map(({ afterRevision: _afterRevision, ...echo }) => Object.freeze(echo)),
      ...(overlay === undefined ? {} : { overlay }),
    })
    deps.lifecycle.render(tree)
  }

  function render(): void {
    renderNow()
  }

  function handleResize(event: Extract<TuiRuntimeTerminalEvent, { type: 'resize' }>): void {
    validateViewportSize({ columns: event.columns, rows: event.rows })
    width = event.columns
    render()
  }

  function submitOrCommand(): void {
    const text = composer.text.trim()
    if (text.length === 0) return
    fatalMessage = undefined
    if (text.startsWith('/')) {
      publishEvent({ kind: 'terminal.command', sourceId: 'composer.editor', input: text })
    } else {
      echoSequence += 1
      localEchoes.push(Object.freeze({
        echoId: `local-${String(echoSequence)}`,
        text: composer.text,
        state: 'pending',
        afterRevision: presentation()?.publicationRevision ?? -1,
      }))
      try {
        publishEvent({ kind: 'terminal.submit', sourceId: 'composer.editor', text: composer.text })
      } catch (error) {
        const index = localEchoes.length - 1
        const pending = localEchoes[index]
        if (pending !== undefined) localEchoes[index] = Object.freeze({ ...pending, state: 'failed' })
        fatalMessage = error instanceof Error ? error.message : String(error)
      }
    }
    composer = composerClear(composer)
    render()
  }

  function handleKey(event: Extract<TuiRuntimeTerminalEvent, { type: 'key' }>): void {
    const { input, key } = event
    if (overlay !== undefined) {
      if (key.escape || input === 'q') {
        closeOverlay()
        return
      }
      if (key.upArrow || key.pageUp || key.downArrow || key.pageDown) {
        const delta = key.upArrow || key.pageUp ? -1 : 1
        const selectedIndex = Math.max(0, Math.min(overlay.items.length - 1, overlay.selectedIndex + delta))
        overlay = Object.freeze({ ...overlay, selectedIndex })
        render()
        return
      }
      if (key.return) {
        const selectedIndex = overlay.selectedIndex
        const select = overlaySelect
        closeOverlay()
        select?.(selectedIndex)
      }
      return
    }
    if (key.ctrl && input.toLowerCase() === 'c') {
      if (running()) publishEvent({ kind: 'terminal.cancel', sourceId: 'composer.editor' })
      else deps.lifecycle.exit({ reason: 'ctrl-c' })
      return
    }
    if (key.ctrl && input.toLowerCase() === 'd') {
      if (deps.focus.shouldExitOnCtrlD({ empty: composer.text.length === 0, running: running() })) {
        deps.lifecycle.exit({ reason: 'ctrl-d' })
      }
      return
    }
    if (key.upArrow || key.pageUp) {
      scrollOffset += key.pageUp ? 5 : 1
      render()
      return
    }
    if (key.downArrow || key.pageDown) {
      scrollOffset = Math.max(0, scrollOffset - (key.pageDown ? 5 : 1))
      render()
      return
    }
    if (input === 'q' && deps.focus.shouldExitOnKey('q')) {
      deps.lifecycle.exit({ reason: 'q-key' })
      return
    }
    if (key.return) {
      if (key.shift) composer = composerNewline(composer)
      else submitOrCommand()
      render()
      return
    }
    if (key.backspace) composer = composerBackspace(composer)
    else if (key.delete) composer = composerDelete(composer)
    else if (key.leftArrow) composer = composerMoveLeft(composer)
    else if (key.rightArrow) composer = composerMoveRight(composer)
    else if (key.home) composer = composerHome(composer)
    else if (key.end) composer = composerEnd(composer)
    else if (input.length > 0) composer = composerInsertText(composer, input)
    else return
    render()
  }

  function closeOverlay(): void {
    if (overlay === undefined) return
    overlay = undefined
    overlaySelect = undefined
    overlayFocusDispose?.()
    overlayFocusDispose = undefined
    render()
  }

  const controller: TuiRuntimeController = {
    start() {
      deps.lifecycle.setInputHandler(event => {
        if (event.type === 'resize') {
          handleResize(event)
          return
        }
        handleKey(event)
      })
      render()
    },
    stop(reason = 'explicit') {
      closeOverlay()
      deps.lifecycle.setInputHandler(null)
      if (deps.lifecycle.state() === 'exited') return
      deps.lifecycle.exit({ reason })
    },
    render: renderNow,
    reportError(message) {
      if (typeof message !== 'string' || message.length === 0) {
        throw new TypeError('runtime error message must be non-empty')
      }
      fatalMessage = message
      render()
    },
    reportSubmissionError(message) {
      if (typeof message !== 'string' || message.length === 0) {
        throw new TypeError('runtime submission error message must be non-empty')
      }
      fatalMessage = message
      let pendingIndex = -1
      for (let index = localEchoes.length - 1; index >= 0; index -= 1) {
        if (localEchoes[index]?.state === 'pending') {
          pendingIndex = index
          break
        }
      }
      const pending = localEchoes[pendingIndex]
      if (pending !== undefined) localEchoes[pendingIndex] = Object.freeze({ ...pending, state: 'failed' })
      render()
    },
    clearError() {
      fatalMessage = undefined
      render()
    },
    handleTerminalEvent(event) {
      if (event.type === 'resize') {
        handleResize(event)
      } else {
        handleKey(event)
      }
    },
    openOverlay(input, onSelect) {
      if (input.view !== 'overlay.help' && input.view !== 'selector.resume-current-cwd') {
        throw new TypeError(`runtime overlay view is not supported: ${String(input.view)}`)
      }
      if (typeof input.title !== 'string' || input.title.length === 0) {
        throw new TypeError('runtime overlay title must be non-empty')
      }
      if (!Array.isArray(input.items) || input.items.length === 0 || input.items.some(item => typeof item !== 'string' || item.length === 0)) {
        throw new TypeError('runtime overlay items must contain non-empty strings')
      }
      const selectedIndex = input.selectedIndex ?? 0
      if (!Number.isSafeInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= input.items.length) {
        throw new TypeError('runtime overlay selectedIndex is out of bounds')
      }
      closeOverlay()
      overlay = Object.freeze({
        view: input.view,
        title: input.title,
        items: Object.freeze([...input.items]),
        selectedIndex,
      })
      overlaySelect = onSelect
      overlayFocusDispose = deps.focus.pushView(input.view)
      render()
    },
    closeOverlay,
  }
  return controller
}

export type { TuiTerminalComposerState, TuiTerminalStatusState }
