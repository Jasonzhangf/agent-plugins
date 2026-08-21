export type LogicControlKind =
  | 'input'
  | 'status'
  | 'connection'
  | 'execution'
  | 'session'
  | 'slash-command'
  | 'logo'

type LogicControlEventBase = { readonly revision?: number }

export type LogicControlEvent =
  | (LogicControlEventBase & { readonly control: 'input'; readonly action: 'edit'; readonly text: string; readonly cursor: number })
  | (LogicControlEventBase & { readonly control: 'input'; readonly action: 'submit'; readonly text: string })
  | (LogicControlEventBase & { readonly control: 'input'; readonly action: 'fail'; readonly message: string })
  | (LogicControlEventBase & { readonly control: 'status'; readonly action: 'set'; readonly sessionId: string | null; readonly cwd: string | null; readonly mode: 'idle' | 'streaming' | 'tool' | 'error'; readonly message?: string })
  | (LogicControlEventBase & { readonly control: 'connection'; readonly action: 'set'; readonly state: 'connecting' | 'connected' | 'disconnected' | 'failed'; readonly message?: string })
  | (LogicControlEventBase & { readonly control: 'execution'; readonly action: 'set'; readonly state: 'idle' | 'running' | 'completed' | 'failed'; readonly turnId: string | null; readonly message?: string })
  | (LogicControlEventBase & { readonly control: 'session'; readonly action: 'snapshot'; readonly selectedSessionId: string | null; readonly availableSessionIds: readonly string[]; readonly cwd: string | null; readonly lifecycle: 'active' | 'terminated' })
  | (LogicControlEventBase & { readonly control: 'session'; readonly action: 'request-select'; readonly sessionId: string })
  | (LogicControlEventBase & { readonly control: 'slash-command'; readonly action: 'project'; readonly command: string | null; readonly args: readonly string[]; readonly accepted: boolean; readonly input?: string })
  | (LogicControlEventBase & { readonly control: 'logo'; readonly action: 'set'; readonly variant: 'full' | 'compact'; readonly visible: boolean })

export type LogicControlProjection =
  | { readonly control: 'input'; readonly stableKey: 'control.input'; readonly text: string; readonly cursor: number; readonly mode: 'idle' | 'submitted' | 'error'; readonly message?: string; readonly revision: number }
  | { readonly control: 'status'; readonly stableKey: 'control.status'; readonly sessionId: string | null; readonly cwd: string | null; readonly mode: 'idle' | 'streaming' | 'tool' | 'error'; readonly message?: string; readonly revision: number }
  | { readonly control: 'connection'; readonly stableKey: 'control.connection'; readonly state: 'connecting' | 'connected' | 'disconnected' | 'failed'; readonly message?: string; readonly revision: number }
  | { readonly control: 'execution'; readonly stableKey: 'control.execution'; readonly state: 'idle' | 'running' | 'completed' | 'failed'; readonly turnId: string | null; readonly message?: string; readonly revision: number }
  | { readonly control: 'session'; readonly stableKey: 'control.session'; readonly selectedSessionId: string | null; readonly availableSessionIds: readonly string[]; readonly cwd: string | null; readonly lifecycle: 'active' | 'terminated'; readonly requestedSessionId: string | null; readonly revision: number }
  | { readonly control: 'slash-command'; readonly stableKey: 'control.slash-command'; readonly input?: string; readonly command: string | null; readonly args: readonly string[]; readonly accepted: boolean; readonly revision: number }
  | { readonly control: 'logo'; readonly stableKey: 'control.logo'; readonly variant: 'full' | 'compact'; readonly visible: boolean; readonly revision: number }

export interface LogicControlErrorShape {
  readonly control: LogicControlKind | 'unknown'
  readonly code: 'invalid-event' | 'invalid-transition' | 'stale-event' | 'unknown-command' | 'duplicate-plugin' | 'disposed'
  readonly message: string
}

export interface LogicControlErrorRecord extends LogicControlErrorShape {
  readonly revision: number
  readonly eventRevision?: number
}
