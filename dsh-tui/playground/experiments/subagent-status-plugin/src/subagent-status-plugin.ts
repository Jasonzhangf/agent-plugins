import { Service, type Context } from '@deepseek-ai/cordis'
import type { TuiElementDescriptor } from '../../../../contracts/tui/component-registry/component-registry.types.ts'
import type { TuiSubagentStatus, TuiSubagentStatusFace } from '../../../../contracts/tui/subagent-status-plugin/subagent-status-plugin.types.ts'

export const tuiSubagentStatusName = 'tuiSubagentStatus' as const

function assertStatus(status: TuiSubagentStatus): void {
  if (!status || typeof status.agentId !== 'string' || status.agentId.length === 0
    || typeof status.label !== 'string' || status.label.length === 0
    || typeof status.latestToolSummary !== 'string'
    || !Number.isSafeInteger(status.revision) || status.revision < 0) {
    throw new TypeError('subagent-status-plugin: invalid status')
  }
}

function projectStatus(status: TuiSubagentStatus): TuiElementDescriptor {
  return Object.freeze({
    contract: 'tui.element.v1',
    elementType: 'subagent.status',
    props: Object.freeze({
      text: `${status.label}: ${status.latestToolSummary || 'Working'}`,
      agentId: status.agentId,
      revision: status.revision,
    }),
  })
}

export class TuiSubagentStatusService extends Service implements TuiSubagentStatusFace {
  readonly name = tuiSubagentStatusName
  private readonly statuses = new Map<string, TuiSubagentStatus>()
  private disposed = false

  constructor(ctx: Context) {
    super(ctx, tuiSubagentStatusName)
    ctx.effect(() => () => this.dispose(), 'subagent-status-plugin.dispose')
  }

  update(status: TuiSubagentStatus): void {
    if (this.disposed) throw new Error('subagent-status-plugin: disposed')
    assertStatus(status)
    const previous = this.statuses.get(status.agentId)
    if (previous && previous.revision > status.revision) throw new Error('subagent-status-plugin: stale status')
    this.statuses.set(status.agentId, Object.freeze({ ...status }))
  }

  remove(agentId: string): void {
    if (this.disposed) throw new Error('subagent-status-plugin: disposed')
    if (typeof agentId !== 'string' || agentId.length === 0) throw new TypeError('subagent-status-plugin: invalid agent id')
    this.statuses.delete(agentId)
  }

  project(): readonly TuiElementDescriptor[] {
    if (this.disposed) throw new Error('subagent-status-plugin: disposed')
    return Object.freeze([...this.statuses.values()].map(projectStatus))
  }

  projectTerminalBar(): import('../../../../contracts/tui/terminal-ui/terminal-frame-tree.types.ts').TuiTerminalBoxNode | undefined {
    if (this.disposed) throw new Error('subagent-status-plugin: disposed')
    if (this.statuses.size === 0) return undefined
    return Object.freeze({
      kind: 'box',
      key: 'leaf.subagent-status-bar',
      style: Object.freeze({ flexDirection: 'column' as const, flexShrink: 0, backgroundColor: 'black' as const, paddingX: 1 }),
      children: Object.freeze([...this.statuses.values()].map(status => Object.freeze({
        kind: 'text' as const,
        key: `subagent-status.${status.agentId}`,
        text: `${status.label}  ${status.latestToolSummary || 'Working'}`,
        style: Object.freeze({ color: 'tool' as const, bold: true }),
      }))),
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.statuses.clear()
  }
}

export function apply(ctx: Context): void {
  ctx.tuiSubagentStatus = new TuiSubagentStatusService(ctx)
}
