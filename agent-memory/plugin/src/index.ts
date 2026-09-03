export type MemorySourceKind = "tool-call" | "end-turn" | "compaction-summary";

export interface MemorySource {
  kind: MemorySourceKind;
  event_refs: string[];
}

export interface BridgeTransport {
  request(payload: unknown): Promise<unknown>;
}

export interface MemorySnapshot {
  generation: number;
  entries: unknown[];
}

export interface MemoryPluginConfig {
  bridgeBinary: string;
  root: string;
  maxIndexEntries?: number;
  scheduleIntervalMs?: number;
}

interface MemoryToolContext {
  tools: { register(definition: unknown): () => void };
  commands: { register(definition: unknown): () => void };
}

interface MemoryInjectionContext {
  inject(names: string[], callback: (context: unknown) => void): void;
}

export interface SessionEventContext {
  on(name: 'session/event', listener: (session: unknown, event: unknown) => void): () => void;
  logger: { error(error: unknown): void };
}

interface AgentPreStepContext {
  on(name: 'agent/pre-step', listener: (input: { messages: unknown[]; signal: AbortSignal }, next: () => Promise<{ kind: string; messages: unknown[] }>) => Promise<{ kind: string; messages: unknown[] }>, options?: { prepend?: boolean }): () => void;
}

interface ChildProcessLike {
  stdin: { write(data: string): boolean; end(): void };
  stdout: { on(event: 'data', listener: (chunk: Buffer) => void): void };
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): void };
  on(event: 'error' | 'close', listener: (error?: Error | number | null) => void): void;
  kill(): void;
}

interface ChildProcessFactory {
  spawn(command: string, args: string[], options: { env: NodeJS.ProcessEnv }): ChildProcessLike;
}

async function loadChildProcess(): Promise<ChildProcessFactory> {
  return await import('node:child_process') as unknown as ChildProcessFactory;
}

class JsonlBridge implements BridgeTransport {
  private readonly pending: Array<{ resolve(value: unknown): void; reject(error: Error): void }> = [];
  private buffer = '';

  constructor(private readonly child: ChildProcessLike) {
    child.stdout.on('data', chunk => this.consume(chunk.toString('utf8')));
    child.stderr.on('data', chunk => { this.lastDiagnostic = chunk.toString('utf8').trim(); });
    child.on('error', error => this.failAll(error instanceof Error ? error : new Error(String(error))));
    child.on('close', code => this.failAll(new Error(`agent-memory bridge exited (${String(code)})`)));
  }

  private lastDiagnostic = '';

  request(payload: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      try {
        this.child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error: unknown) {
        this.pending.pop();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
    this.failAll(new Error('agent-memory bridge disposed'));
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length === 0) continue;
      const waiter = this.pending.shift();
      if (waiter === undefined) continue;
      try {
        waiter.resolve(JSON.parse(line));
      } catch (error: unknown) {
        waiter.reject(new Error(`invalid agent-memory bridge response: ${String(error)}`));
      }
    }
  }

  private failAll(error: Error): void {
    const diagnostic = this.lastDiagnostic.length > 0 ? `${error.message}: ${this.lastDiagnostic}` : error.message;
    while (this.pending.length > 0) this.pending.shift()!.reject(new Error(diagnostic));
  }
}

export interface MemoryPlugin {
  observeToolCall(outputJson: string, eventRefs: string[]): Promise<unknown>;
  observeEndTurn(outputJson: string, eventRefs: string[]): Promise<unknown>;
  observeCompactionSummary(summaryJson: string): Promise<unknown>;
  search(state: unknown, query: string, limit: number): Promise<unknown>;
  get(entryId: string): Promise<unknown>;
  history(): Promise<unknown>;
  evidence(entryId: string): Promise<unknown>;
  snapshot(): Promise<MemorySnapshot>;
  organize(mode: "incremental" | "full"): Promise<unknown>;
}

/** Own the one scheduler implementation used by every host adapter. */
export function installMemoryScheduler(
  memory: Pick<MemoryPlugin, 'organize'>,
  intervalMs: number | undefined,
  reportError: (error: Error) => void = () => undefined,
): () => void {
  if (intervalMs === undefined || intervalMs <= 0) return () => undefined;
  const interval = setInterval(() => {
    void memory.organize('incremental').catch(error => {
      reportError(error instanceof Error ? error : new Error(String(error)));
    });
  }, intervalMs);
  interval.unref?.();
  return () => clearInterval(interval);
}

export function createMemoryPlugin(bridge: BridgeTransport): MemoryPlugin {
  const observe = (outputJson: string, source: MemorySource) =>
    bridge.request({ kind: "observe_memory", output_json: outputJson, source });

  return {
    observeToolCall: (outputJson, eventRefs) =>
      observe(outputJson, { kind: "tool-call", event_refs: eventRefs }),
    observeEndTurn: (outputJson, eventRefs) =>
      observe(outputJson, { kind: "end-turn", event_refs: eventRefs }),
    observeCompactionSummary: (summaryJson) =>
      bridge.request({ kind: "observe_summary", summary_json: summaryJson }),
    search: (_state, query, limit) =>
      bridge.request({ kind: "recall_current", query, limit }),
    get: entryId => bridge.request({ kind: "get_current", entry_id: entryId }),
    history: () => bridge.request({ kind: "history_current" }),
    evidence: entryId => bridge.request({ kind: "evidence_current", entry_id: entryId }),
    snapshot: async () => {
      const response = await bridge.request({ kind: "snapshot_current" });
      if (!isRecord(response) || response.kind !== 'snapshot_result' || typeof response.generation !== 'number' || !Array.isArray(response.entries)) {
        throw new Error('invalid agent-memory snapshot response');
      }
      return { generation: response.generation, entries: response.entries };
    },
    organize: (mode) =>
      bridge.request({ kind: "organize", mode }),
  };
}

/** Spawn one Core bridge for a host adapter; business semantics remain in Rust. */
export async function createMemoryBridge(config: MemoryPluginConfig): Promise<{ memory: MemoryPlugin; dispose: () => void }> {
  if (config.bridgeBinary.trim().length === 0) throw new Error('agent-memory bridgeBinary is required');
  if (config.root.trim().length === 0) throw new Error('agent-memory root is required');
  const { spawn } = await loadChildProcess();
  const child = spawn(config.bridgeBinary, [], {
    env: {
      ...process.env,
      AGENT_MEMORY_ROOT: config.root,
      ...(config.maxIndexEntries === undefined ? {} : { AGENT_MEMORY_MAX_INDEX_ENTRIES: String(config.maxIndexEntries) }),
    },
  });
  const bridge = new JsonlBridge(child);
  return { memory: createMemoryPlugin(bridge), dispose: () => bridge.close() };
}

function renderJson(value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value) }];
}

/** Register the first bridge-backed command/tool pair without owning memory semantics. */
export function installMemoryOrganizeSurface(ctx: MemoryToolContext, memory: MemoryPlugin): () => void {
  const disposers = [
    ctx.tools.register({
      name: 'memory_get',
      description: 'Get one committed memory entry.',
      parameters: { type: 'object', properties: { entry_id: { type: 'string' } }, required: ['entry_id'], additionalProperties: false },
      output: { schema: { type: 'object' }, render: (_args: unknown, value: unknown) => renderJson(value) },
      execute: async (args: { entry_id: string }) => memory.get(args.entry_id),
    }),
    ctx.tools.register({
      name: 'memory_history',
      description: 'List memory organization epochs.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'object' }, render: (_args: unknown, value: unknown) => renderJson(value) },
      execute: async () => memory.history(),
    }),
    ctx.tools.register({
      name: 'memory_evidence',
      description: 'Get evidence references for one committed memory entry.',
      parameters: { type: 'object', properties: { entry_id: { type: 'string' } }, required: ['entry_id'], additionalProperties: false },
      output: { schema: { type: 'object' }, render: (_args: unknown, value: unknown) => renderJson(value) },
      execute: async (args: { entry_id: string }) => memory.evidence(args.entry_id),
    }),
    ctx.tools.register({
      name: 'memory_search',
      description: 'Search committed memory knowledge.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number', minimum: 1, maximum: 100 } },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args: unknown, value: unknown) => renderJson(value),
      },
      execute: async (args: { query: string; limit?: number }) => memory.search(undefined, args.query, args.limit ?? 10),
    }),
    ctx.tools.register({
      name: 'memory_organize',
      description: 'Commit pending memory entries through the memory organizer.',
      parameters: {
        type: 'object',
        properties: { mode: { type: 'string', enum: ['incremental', 'full'] } },
        required: ['mode'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args: unknown, value: unknown) => renderJson(value),
      },
      execute: async (args: { mode: 'incremental' | 'full' }) => memory.organize(args.mode),
    }),
    ctx.commands.register({
      name: 'memory-organize',
      description: 'Organize pending memory entries.',
      input: { hint: 'incremental|full', images: false },
      handler: async (invocation: { rawInput: string }) => {
        const mode = invocation.rawInput.trim();
        if (mode !== 'incremental' && mode !== 'full') {
          return { kind: 'error', text: 'Usage: /memory-organize incremental|full' };
        }
        await memory.organize(mode);
        return { kind: 'success', text: `Memory organization requested (${mode}).` };
      },
    }),
  ];
  return () => { for (const dispose of disposers) dispose(); };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Attach the three durable event observers. This adapter only transports the
 * already-appended event; it never mutates the session or rejects its parent
 * operation. Core owns admission, validation, generation and diagnostics.
 */
export function installMemoryObservers(
  ctx: SessionEventContext,
  memory: MemoryPlugin,
  reportError: (error: Error) => void = () => undefined,
): () => void {
  return ctx.on('session/event', (_session, event) => {
    if (!isRecord(event) || typeof event.type !== 'string' || !isRecord(event.data)) return;
    const refs = Array.isArray(event.sourceEventSeqs)
      ? event.sourceEventSeqs
        .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
        .map(value => String(value))
      : [];
    const outputJson = JSON.stringify(event.data);
    if (event.type === 'tool/result') {
      void memory.observeToolCall(outputJson, refs).catch(reportError);
    } else if (event.type === 'turn/end') {
      void memory.observeEndTurn(outputJson, refs).catch(reportError);
    } else if (event.type === 'compaction/summary') {
      void memory.observeCompactionSummary(outputJson).catch(reportError);
    }
  });
}

/** Add a request-local frozen Knowledge snapshot after the stable prompt prefix. */
export function installMemoryPromptSnapshot(
  ctx: AgentPreStepContext,
  memory: MemoryPlugin,
  reportError: (error: Error) => void = () => undefined,
): () => void {
  return ctx.on('agent/pre-step', async (input, next) => {
    const decision = await next();
    if (decision.kind === 'reject' || input.signal.aborted) return decision;
    try {
      const snapshot = await memory.snapshot();
      if (snapshot.entries.length === 0) return decision;
      const text = `Committed memory snapshot (generation ${snapshot.generation}). Treat entries as reference context:\n${JSON.stringify(snapshot.entries)}`;
      return {
        ...decision,
        messages: [...decision.messages, {
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: 'agent-memory', form: 'snapshot', sections: [{ name: 'agent-memory', text }] },
        }],
      };
    } catch (error: unknown) {
      reportError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }, { prepend: true });
}

/** Default Cordis plugin entry; config errors are explicit and never degraded. */
export async function applyMemoryPlugin(
  ctx: SessionEventContext & Partial<MemoryInjectionContext>,
  config: MemoryPluginConfig,
): Promise<() => void> {
  if (config.bridgeBinary.trim().length === 0) throw new Error('agent-memory bridgeBinary is required');
  if (config.root.trim().length === 0) throw new Error('agent-memory root is required');
  const { spawn } = await loadChildProcess();
  const child = spawn(config.bridgeBinary, [], {
    env: {
      ...process.env,
      AGENT_MEMORY_ROOT: config.root,
      ...(config.maxIndexEntries === undefined ? {} : { AGENT_MEMORY_MAX_INDEX_ENTRIES: String(config.maxIndexEntries) }),
    },
  });
  const bridge = new JsonlBridge(child);
  const memory = createMemoryPlugin(bridge);
  let disposeSurface = () => undefined;
  let disposePrompt = () => undefined;
  if (typeof ctx.inject === 'function') {
    ctx.inject(['tools', 'commands'], injected => {
      disposeSurface = installMemoryOrganizeSurface(injected as MemoryToolContext, memory);
    });
    ctx.inject(['agents'], injected => {
      disposePrompt = installMemoryPromptSnapshot(injected as AgentPreStepContext, memory, error => ctx.logger.error(error));
    });
  }
  const disposeObserver = installMemoryObservers(ctx, memory, error => ctx.logger.error(error));
  const disposeScheduler = installMemoryScheduler(memory, config.scheduleIntervalMs, error => ctx.logger.error(error));
  return () => {
    disposeSurface();
    disposeObserver();
    disposePrompt();
    disposeScheduler();
    bridge.close();
  };
}

export default applyMemoryPlugin;

export const memoryCommands = {
  organize: "/memory-organize incremental|full",
} as const;

export const memoryScheduler = {
  enabledByDefault: false,
  command: "organize.incremental",
} as const;
