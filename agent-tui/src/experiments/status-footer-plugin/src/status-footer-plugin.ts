import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  TuiTerminalFooterLeaf,
  TuiTerminalFooterMarkerNode,
  TuiTerminalFooterStatusNode,
  TuiTerminalFooterNoticeNode,
} from '../../../../contracts/tui/terminal-ui/terminal-region-leaves.types.ts'
import type {
  TuiStatusFooterFace,
  TuiStatusFooterInput,
  TuiStatusFooterProjectionFailure,
  TuiStatusFooterProjectionResult,
} from '../../../../contracts/tui/status-footer-plugin/status-footer-plugin.types.ts'
import { FOCUS_KEYMAP, focusKeymapLine } from '../../../../contracts/tui/focus-manager/focus-keymap.ts'
import type { TuiFocusViewId } from '../../../../contracts/tui/focus-manager/focus-manager.types.ts'

export const tuiStatusFooterName = 'tuiStatusFooter' as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function assertRevision(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`status-footer-plugin: ${label} must be a non-negative safe integer`)
  }
}

function assertNonEmptyOrNull(value: unknown, label: string): asserts value is string | null {
  if (value !== null && (typeof value !== 'string' || value.length === 0)) {
    throw new TypeError(`status-footer-plugin: ${label} must be a non-empty string or null`)
  }
}

function assertInput(value: unknown): asserts value is TuiStatusFooterInput {
  if (!isPlainObject(value)) throw new TypeError('status-footer-plugin: input must be a plain object')
  const keys = Object.keys(value).sort()
  const required = ['connection', 'execution', 'focus', 'goal', 'model', 'permission', 'publicationRevision', 'selectedSession', 'status', 'viewport']
  const expected = value['error'] === undefined
    ? (value['notice'] === undefined ? required : [...required, 'notice'].sort())
    : (value['notice'] === undefined ? [...required, 'error'].sort() : [...required, 'error', 'notice'].sort())
  if (keys.join(',') !== expected.join(',')) {
    throw new TypeError('status-footer-plugin: input has an invalid closed contract')
  }
  assertRevision(value['publicationRevision'], 'publicationRevision')
  for (const key of ['connection', 'execution', 'status', 'selectedSession', 'model', 'permission', 'viewport']) {
    if (!isPlainObject(value[key])) throw new TypeError(`status-footer-plugin: ${key} must be a plain object`)
  }
  const connection = value['connection'] as Record<string, unknown>
  if (!['connecting', 'connected', 'disconnected', 'failed'].includes(String(connection['state']))) {
    throw new TypeError('status-footer-plugin: connection.state is invalid')
  }
  assertRevision(connection['revision'], 'connection.revision')
  const execution = value['execution'] as Record<string, unknown>
  if (!['idle', 'running', 'completed', 'failed'].includes(String(execution['state']))) {
    throw new TypeError('status-footer-plugin: execution.state is invalid')
  }
  assertRevision(execution['revision'], 'execution.revision')
  const status = value['status'] as Record<string, unknown>
  if (!['idle', 'streaming', 'tool', 'error'].includes(String(status['mode']))) {
    throw new TypeError('status-footer-plugin: status.mode is invalid')
  }
  if (status['message'] !== undefined && (typeof status['message'] !== 'string' || status['message'].length === 0)) {
    throw new TypeError('status-footer-plugin: status.message must be a non-empty string')
  }
  assertRevision(status['revision'], 'status.revision')
  const selectedSession = value['selectedSession'] as Record<string, unknown>
  assertNonEmptyOrNull(selectedSession['sessionId'], 'selectedSession.sessionId')
  assertNonEmptyOrNull(selectedSession['cwd'], 'selectedSession.cwd')
  const model = value['model'] as Record<string, unknown>
  assertNonEmptyOrNull(model['provider'], 'model.provider')
  assertNonEmptyOrNull(model['model'], 'model.model')
  assertNonEmptyOrNull(model['thinkingEffort'], 'model.thinkingEffort')
  const permission = value['permission'] as Record<string, unknown>
  assertNonEmptyOrNull(permission['current'], 'permission.current')
  if (value['goal'] !== null && !['active', 'paused', 'blocked', 'complete'].includes(String(value['goal']))) {
    throw new TypeError('status-footer-plugin: goal is invalid')
  }
  const viewport = value['viewport'] as Record<string, unknown>
  if (viewport['class'] !== 'compact' && viewport['class'] !== 'regular') {
    throw new TypeError('status-footer-plugin: viewport.class is invalid')
  }
  assertRevision(viewport['columns'], 'viewport.columns')
  assertRevision(viewport['rows'], 'viewport.rows')
  if ((viewport['columns'] as number) === 0 || (viewport['rows'] as number) === 0) {
    throw new TypeError('status-footer-plugin: viewport dimensions must be positive')
  }
  if (value['notice'] !== undefined) {
    const notice = value['notice'] as Record<string, unknown>
    if (!isPlainObject(notice) || typeof notice['message'] !== 'string' || notice['message'].length === 0) {
      throw new TypeError('status-footer-plugin: notice.message must be a non-empty string')
    }
  }
  if (value['error'] !== undefined) {
    if (!isPlainObject(value['error'])
      || (value['error']['kind'] !== 'fatal' && value['error']['kind'] !== 'local')
      || typeof value['error']['message'] !== 'string'
      || value['error']['message'].length === 0) {
      throw new TypeError('status-footer-plugin: error is invalid')
    }
  }
}

function textNode(
  key: 'footer.status',
  text: string,
  style: TuiTerminalFooterStatusNode['style'],
): TuiTerminalFooterStatusNode
function textNode(
  key: 'footer.marker',
  text: string,
  style: TuiTerminalFooterMarkerNode['style'],
): TuiTerminalFooterMarkerNode
function textNode(
  key: 'footer.notice',
  text: string,
  style: TuiTerminalFooterNoticeNode['style'],
): TuiTerminalFooterNoticeNode
function textNode(
  key: 'footer.status' | 'footer.marker' | 'footer.notice',
  text: string,
  style: TuiTerminalFooterStatusNode['style'],
): TuiTerminalFooterStatusNode | TuiTerminalFooterNoticeNode | TuiTerminalFooterMarkerNode {
  return Object.freeze({ kind: 'text', key, text, style: Object.freeze(style) }) as TuiTerminalFooterStatusNode | TuiTerminalFooterNoticeNode | TuiTerminalFooterMarkerNode
}

function renderKeymap(view: TuiFocusViewId): string {
  return focusKeymapLine(view)
}

function projectFooter(input: TuiStatusFooterInput): TuiTerminalFooterLeaf {
  assertInput(input)
  const errorMessage = input.error?.message ?? input.status.message
  const model = input.model.model ?? 'model unavailable'
  const provider = input.model.provider ?? 'provider unavailable'
  const effort = input.model.thinkingEffort ?? 'effort unavailable'
  const permission = input.permission.current ?? 'permission unavailable'
  const statusText = `${provider}/${model} · thinking ${effort} · permission ${permission}${errorMessage ? ` · ${errorMessage}` : ''}`
  const goalText = `goal: ${input.goal ?? 'none'}`
  const statusStyle = input.error?.kind === 'fatal' || input.status.mode === 'error'
    ? { color: 'red' as const }
    : { color: 'white' as const, ...(input.execution.state === 'running' ? { bold: true } : { dimColor: true }) }
  const status = textNode('footer.status', statusText, statusStyle)
  const keymap = textNode('footer.marker', `${goalText}    ${renderKeymap(input.focus.activeView)}`, { dimColor: true })
  const children = input.notice
    ? ([status, textNode('footer.notice', input.notice.message, { dimColor: true }), keymap] as const)
    : ([status, keymap] as const)
  return Object.freeze({
    kind: 'box',
    key: 'leaf.footer',
    style: Object.freeze({ flexDirection: 'column' }),
    children: Object.freeze(children),
  })
}

export class TuiStatusFooterService extends Service implements TuiStatusFooterFace {
  readonly name = tuiStatusFooterName
  private disposed = false

  constructor(ctx: Context) {
    super(ctx, tuiStatusFooterName)
    ctx.effect(() => () => this.dispose(), 'status-footer-plugin.dispose')
  }

  project(input: TuiStatusFooterInput): TuiTerminalFooterLeaf {
    if (this.disposed) throw new Error('status-footer-plugin: disposed')
    return projectFooter(input)
  }

  projectSafe(input: TuiStatusFooterInput): TuiStatusFooterProjectionResult {
    if (this.disposed) {
      const cause = new Error('status-footer-plugin: disposed')
      return { ok: false, error: Object.freeze({ stage: 'status-footer-projection', code: 'invalid-status-footer-input', message: cause.message, cause }) }
    }
    try {
      return { ok: true, value: projectFooter(input) }
    } catch (cause) {
      const error = cause instanceof Error ? cause : new TypeError(String(cause))
      const failure: TuiStatusFooterProjectionFailure = Object.freeze({
        stage: 'status-footer-projection',
        code: 'invalid-status-footer-input',
        message: error.message,
        cause: error,
      })
      return { ok: false, error: failure }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
  }
}

export function apply(ctx: Context): void {
  ctx.tuiStatusFooter = new TuiStatusFooterService(ctx)
}
