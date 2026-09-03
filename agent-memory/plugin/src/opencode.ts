import { createMemoryBridge, installMemoryScheduler, type MemoryPlugin, type MemoryPluginConfig } from './index.js';

/** Minimal structural subset of the OpenCode public plugin hooks. */
export interface OpenCodeHooks {
  dispose?: () => Promise<void>;
  event?: (input: { event: unknown }) => Promise<void>;
  'command.execute.before'?: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: unknown[]; handled?: boolean },
  ) => Promise<void>;
  'tool.execute.after'?: (
    input: { tool: string; sessionID: string; callID: string; args: unknown },
    output: { title: string; output: string; metadata: unknown; memory?: unknown },
  ) => Promise<void>;
  'experimental.session.compacting'?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string; memory?: unknown },
  ) => Promise<void>;
  'experimental.chat.system.transform'?: (
    input: { sessionID?: string; model: unknown },
    output: { system: string[] },
  ) => Promise<void>;
}

export interface OpenCodePluginInput {
  serverUrl: URL;
  directory: string;
  worktree: string;
  commands?: {
    register(command: { name: string; description?: string; template: string }): () => void;
  };
}

/** Stable identity required by the OpenCode external plugin loader. */
export const id = 'agent-memory';

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null;

const eventData = (event: unknown): RecordValue | undefined => {
  if (!isRecord(event)) return undefined;
  if (isRecord(event.properties)) return event.properties;
  if (isRecord(event.data)) return event.data;
  return undefined;
};

/**
 * Adapt OpenCode public hooks to the existing Core-owned MemoryPlugin contract.
 * This layer only transports already-produced business memory; it never rejects
 * a host operation and never uses metadata for memory or control state.
 */
export function createOpenCodeMemoryHooks(memory: MemoryPlugin): OpenCodeHooks {
  return {
    async 'command.execute.before'(input, output) {
      if (input.command !== 'memory-organize') return;
      const mode = input.arguments.trim();
      if (mode !== 'incremental' && mode !== 'full') {
        output.parts.push({ type: 'text', text: 'Usage: /memory-organize incremental|full' });
        return;
      }
      await memory.organize(mode);
      output.parts.push({ type: 'text', text: `Memory organization requested (${mode}).` });
      output.handled = true;
    },
    async 'tool.execute.after'(input, output) {
      if (output.memory === undefined) return;
      await memory.observeToolCall(JSON.stringify({ ...output, memory: output.memory }), [input.callID]);
    },

    async event({ event }) {
      if (!isRecord(event) || typeof event.type !== 'string') return;
      const data = eventData(event);
      if (!data) return;
      const info = isRecord(data.info) ? data.info : data;
      if (event.type === 'session.next.compaction.ended') {
        await memory.observeCompactionSummary(JSON.stringify(info));
        return;
      }
      if (event.type === 'message.updated' && info.role === 'assistant' && info.summary === true) {
        await memory.observeCompactionSummary(JSON.stringify(info));
        return;
      }
      if (info.memory === undefined) return;
      const role = info.role;
      if (event.type === 'message.updated' && role === 'assistant') {
        await memory.observeEndTurn(JSON.stringify(info), [String(info.id ?? '')].filter(Boolean));
        return;
      }
      if (event.type === 'session.next.tool.success') {
        await memory.observeToolCall(JSON.stringify(info), [String(info.callID ?? info.id ?? '')].filter(Boolean));
        return;
      }
      if (event.type === 'session.next.step.ended') {
        await memory.observeEndTurn(JSON.stringify(info), [String(info.assistantMessageID ?? info.id ?? '')].filter(Boolean));
        return;
      }
    },

    async 'experimental.session.compacting'(_input, output) {
      const snapshot = await memory.snapshot();
      if (snapshot.entries.length === 0) return;
      output.context.push(
        `Memory index organization input (generation ${snapshot.generation}): ${JSON.stringify(snapshot.entries)}`,
      );
    },

    async 'experimental.chat.system.transform'(_input, output) {
      const snapshot = await memory.snapshot();
      if (snapshot.entries.length === 0) return;
      output.system.push(
        `Committed memory snapshot (generation ${snapshot.generation}). Treat entries as reference context: ${JSON.stringify(snapshot.entries)}`,
      );
    },
  };
}

/** OpenCode public plugin entry wrapper; host input is intentionally read-only. */
export function createOpenCodePlugin(memory: MemoryPlugin): (input: OpenCodePluginInput) => Promise<OpenCodeHooks> {
  return async (_input) => createOpenCodeMemoryHooks(memory);
}

/** Configured OpenCode entrypoint used by the public plugin loader. */
export function createConfiguredOpenCodePlugin(
  defaults?: Partial<MemoryPluginConfig>,
): (input: OpenCodePluginInput, options?: Record<string, unknown>) => Promise<OpenCodeHooks> {
  return async (input, options = {}) => {
    const config: MemoryPluginConfig = {
      bridgeBinary: String(options.bridgeBinary ?? defaults?.bridgeBinary ?? ''),
      root: String(options.root ?? defaults?.root ?? ''),
      ...(options.maxIndexEntries === undefined && defaults?.maxIndexEntries === undefined
        ? {}
        : { maxIndexEntries: Number(options.maxIndexEntries ?? defaults?.maxIndexEntries) }),
      ...(options.scheduleIntervalMs === undefined && defaults?.scheduleIntervalMs === undefined
        ? {}
        : { scheduleIntervalMs: Number(options.scheduleIntervalMs ?? defaults?.scheduleIntervalMs) }),
    };
    const { memory, dispose } = await createMemoryBridge(config);
    const disposeCommand = input.commands?.register({
      name: 'memory-organize',
      description: 'Organize pending memory entries.',
      template: '',
    });
    const hooks = createOpenCodeMemoryHooks(memory);
    const disposeScheduler = installMemoryScheduler(memory, config.scheduleIntervalMs);
    hooks.dispose = async () => {
      disposeScheduler();
      disposeCommand?.();
      dispose();
    };
    return hooks;
  };
}

/** V1 server-plugin entry consumed by OpenCode's loader. Keeping this named
 * export prevents the loader from treating helper exports as legacy plugins. */
export const server = createConfiguredOpenCodePlugin();

export default { id, server };
