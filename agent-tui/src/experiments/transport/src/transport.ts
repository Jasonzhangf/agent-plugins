/** Agent TUI transport contracts. OpenCode is the only protocol adaptor. */

export type AgentResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } }

export type SessionId = string
export type SessionWireEvent = any
export type SessionHistoryRecord = any
export type SessionFollowFrame = any
export type SessionControlFrame = any
export type SessionQueuedItem = any
export type SessionJob = any
export type SessionProjectionBaseline = any
export type SessionSummary = { readonly sessionId: SessionId; readonly cwd: string; readonly running: boolean; readonly updatedAt: number; readonly blank: boolean; readonly origin: 'root' | 'subagent'; readonly projections?: SessionProjectionBaseline; readonly [key: string]: any }
export type SessionAddress = { readonly kind: 'session'; readonly sessionId: SessionId }
export type SessionPageRequest = any
export type SessionPage = any
export type SessionCreateRequest = any
export type SessionPromptRequest = any
export type SessionUpdateQueueRequest = any
export type SessionSelectModelRequest = any

export interface AgentQuestionItem { readonly id: string; readonly question: string; readonly detail?: string; readonly header?: string; readonly options?: readonly { readonly label: string; readonly description?: string }[]; readonly multiSelect?: boolean }
export interface AgentQuestionAnswer { readonly answers: readonly { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[] }
export type AgentApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
export type AskUserQuestionItem = AgentQuestionItem
export type AskUserQuestionAnswer = AgentQuestionAnswer
export type ApprovalOutcome = AgentApprovalOutcome
export type TuiForwardedEvent = any
export type TuiForwardedEventResult = AgentForwardedEventResult
export type ToolCallView = any
export type ToolResultView = any

export interface AgentRemote {
  readonly [key: string]: any
  readonly session: {
    readonly [key: string]: any
    list(signal?: AbortSignal): Promise<AgentResult<{ readonly items: readonly SessionSummary[] }>>
    create(request: SessionCreateRequest): Promise<AgentResult<{ readonly sessionId: string; readonly agentPreset?: string }>>
    fork(request: { readonly sessionId: string; readonly atSeq?: number }): Promise<AgentResult<{ readonly sessionId: string }>>
    openWorkspacePath(request: { readonly path: string }): Promise<AgentResult<unknown>>
    page(request: SessionPageRequest, signal?: AbortSignal): Promise<AgentResult<SessionPage>>
    follow(request: SessionPageRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame>
    control(signal: AbortSignal): AsyncIterable<SessionControlFrame>
    prompt(request: SessionPromptRequest, signal?: AbortSignal): Promise<AgentResult<{ readonly accepted: true }>>
    updateQueue(request: SessionUpdateQueueRequest): Promise<AgentResult<{ readonly accepted: true }>>
    cancel(request: { readonly sessionId: string }): Promise<AgentResult<{ readonly accepted: true }>>
    selectModel(request: SessionSelectModelRequest): Promise<AgentResult<{ readonly selected: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } }>>
    modelCatalog(): Promise<AgentResult<unknown>>
    search(request: unknown, signal?: AbortSignal): Promise<AgentResult<any>>
  }
  readonly commands: { execute(sessionId: string, line: string, images: readonly unknown[]): Promise<AgentResult<{ readonly matched: boolean; readonly kind?: string }>> }
  readonly events: { follow(signal: AbortSignal): AsyncIterable<any>; respond(result: AgentForwardedEventResult): Promise<void> }
}

export interface AgentForwardedEventResult {
  readonly clientId: string
  readonly eventId: string
  readonly outcome: { readonly kind: 'next' | 'result' | 'rejected'; readonly value?: unknown; readonly error?: { readonly name: string; readonly message: string; readonly code?: string; readonly details?: unknown } }
}

export interface AgentHost {
  readonly remote: AgentRemote
  readonly origin: string
  exportSessionLog(sessionId: string, includeChildren: boolean): Promise<Uint8Array>
}
