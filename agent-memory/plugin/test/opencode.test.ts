import { strict as assert } from 'node:assert';
import { createMemoryPlugin, installMemoryScheduler, type BridgeTransport } from '../src/index.js';
import { createOpenCodeMemoryHooks, createOpenCodePlugin } from '../src/opencode.js';
import { installMemoryOrganizeSurface } from '../src/index.js';

class FakeBridge implements BridgeTransport {
  readonly requests: unknown[] = [];
  async request(payload: unknown): Promise<unknown> {
    this.requests.push(payload);
    if (isRecord(payload) && payload.kind === 'snapshot_current') return { kind: 'snapshot_result', generation: 4, entries: [{ text: 'x' }] };
    return { kind: 'accepted' };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const bridge = new FakeBridge();
const memory = createMemoryPlugin(bridge);
const hooks = createOpenCodeMemoryHooks(memory);
const plugin = createOpenCodePlugin(memory);
assert.equal(typeof (await plugin({ serverUrl: new URL('http://127.0.0.1'), directory: '.', worktree: '.' })).event, 'function');

const commandParts: unknown[] = [];
const commandOutput = { parts: commandParts } as { parts: unknown[]; handled?: boolean };
await hooks['command.execute.before']?.(
  { command: 'memory-organize', sessionID: 'ses_1', arguments: 'incremental' },
  commandOutput,
);
assert.deepEqual(commandParts, [{ type: 'text', text: 'Memory organization requested (incremental).' }]);
assert.equal(commandOutput.handled, true);
const invalidCommandParts: unknown[] = [];
await hooks['command.execute.before']?.(
  { command: 'memory-organize', sessionID: 'ses_1', arguments: 'invalid' },
  { parts: invalidCommandParts },
);
assert.deepEqual(invalidCommandParts, [{ type: 'text', text: 'Usage: /memory-organize incremental|full' }]);

await hooks['tool.execute.after']?.(
  { tool: 'read', sessionID: 'ses_1', callID: 'call_1', args: {} },
  { title: 'read', output: 'ok', metadata: { diagnostic: 'x' }, memory: { text: 'remember' } },
);
await hooks.event?.({ event: { type: 'message.updated', properties: { id: 'msg_1', role: 'assistant', memory: { text: 'final' } } } });
await hooks.event?.({ event: { type: 'message.updated', properties: { info: { id: 'msg_2', role: 'assistant', memory: { text: 'nested-final' } } } } });
await hooks.event?.({ event: { type: 'session.next.tool.success', properties: { callID: 'call_2', memory: { text: 'v2-tool' } } } });
await hooks.event?.({ event: { type: 'session.next.step.ended', properties: { assistantMessageID: 'msg_2', memory: { text: 'v2-turn' } } } });
await hooks.event?.({ event: { type: 'session.next.compaction.ended', properties: { text: 'summary', memory: { entries: [] } } } });
await hooks.event?.({ event: { type: 'session.next.compaction.ended', properties: { text: 'summary-without-memory' } } });
await hooks.event?.({ event: { type: 'message.updated', properties: { id: 'msg_3', role: 'assistant', summary: true, memory: { entries: [] } } } });
const compacting = { context: [] as string[] };
await hooks['experimental.session.compacting']?.({ sessionID: 'ses_1' }, compacting);

assert.equal(bridge.requests.length, 10);
assert.equal((bridge.requests[0] as Record<string, unknown>).kind, 'organize');
assert.equal((bridge.requests[1] as Record<string, unknown>).kind, 'observe_memory');
assert.equal((bridge.requests[2] as Record<string, unknown>).kind, 'observe_memory');
assert.deepEqual(bridge.requests[3], {
  kind: 'observe_memory',
  output_json: JSON.stringify({ id: 'msg_2', role: 'assistant', memory: { text: 'nested-final' } }),
  source: { kind: 'end-turn', event_refs: ['msg_2'] },
});
assert.deepEqual(bridge.requests[4], {
  kind: 'observe_memory',
  output_json: JSON.stringify({ callID: 'call_2', memory: { text: 'v2-tool' } }),
  source: { kind: 'tool-call', event_refs: ['call_2'] },
});
assert.deepEqual(bridge.requests[5], {
  kind: 'observe_memory',
  output_json: JSON.stringify({ assistantMessageID: 'msg_2', memory: { text: 'v2-turn' } }),
  source: { kind: 'end-turn', event_refs: ['msg_2'] },
});
assert.deepEqual(bridge.requests[6], {
  kind: 'observe_summary',
  summary_json: JSON.stringify({ text: 'summary', memory: { entries: [] } }),
});
assert.deepEqual(bridge.requests[7], {
  kind: 'observe_summary',
  summary_json: JSON.stringify({ text: 'summary-without-memory' }),
});
assert.deepEqual(bridge.requests[8], {
  kind: 'observe_summary',
  summary_json: JSON.stringify({ id: 'msg_3', role: 'assistant', summary: true, memory: { entries: [] } }),
});
assert.match(compacting.context[0]!, /generation 4/);

const registeredTools: Record<string, any> = {};
const registeredCommands: Record<string, any> = {};
const surface = installMemoryOrganizeSurface({
  tools: { register(definition: any) { registeredTools[definition.name] = definition; return () => undefined; } },
  commands: { register(definition: any) { registeredCommands[definition.name] = definition; return () => undefined; } },
}, memory);
await registeredTools.memory_organize.execute({ mode: 'incremental' });
await registeredCommands['memory-organize'].handler({ rawInput: 'full' });
assert.deepEqual(bridge.requests.slice(-2).map(request => (request as Record<string, unknown>).kind), ['organize', 'organize']);
assert.deepEqual(bridge.requests.slice(-2).map(request => (request as Record<string, unknown>).mode), ['incremental', 'full']);
assert.deepEqual(await registeredCommands['memory-organize'].handler({ rawInput: 'bad' }), {
  kind: 'error', text: 'Usage: /memory-organize incremental|full',
});
surface();

const scheduledModes: string[] = [];
const disposeScheduler = installMemoryScheduler({
  organize: async mode => { scheduledModes.push(mode); },
}, 10);
await new Promise(resolve => setTimeout(resolve, 35));
disposeScheduler();
assert.ok(scheduledModes.length >= 1);
assert.ok(scheduledModes.every(mode => mode === 'incremental'));
