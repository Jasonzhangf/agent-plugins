import { strict as assert } from 'node:assert';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfiguredOpenCodePlugin } from '../src/opencode.js';

const root = await mkdtemp(join(tmpdir(), 'agent-memory-opencode-'));
const binary = join(import.meta.dirname, '../../target/release/agent-memory-bridge');
const plugin = createConfiguredOpenCodePlugin({ bridgeBinary: binary, root, maxIndexEntries: 2 });
const hooks = await plugin({ serverUrl: new URL('http://127.0.0.1'), directory: root, worktree: root });
await hooks['tool.execute.after']?.(
  { tool: 'read', sessionID: 'ses_1', callID: 'call_1', args: {} },
  {
    title: 'read',
    output: 'ok',
    metadata: {},
    memory: {
      entries: [{
        schema: 'dsh.memory.index-entry.v1',
        operation: 'add',
        scope: 'project',
        kind: 'fact',
        title: 'Fixture',
        summary: 'persisted',
        tags: [],
        entities: [],
      }],
    },
  },
);
await hooks.event?.({ event: {
  type: 'session.next.step.ended',
  properties: {
    assistantMessageID: 'assistant_1',
    memory: {
      entries: [{
        schema: 'dsh.memory.index-entry.v1',
        operation: 'add',
        scope: 'project',
        kind: 'fact',
        title: 'Turn fixture',
        summary: 'end-turn persisted',
        tags: [],
        entities: [],
      }],
    },
  },
} });
await hooks['tool.execute.after']?.(
  { tool: 'read', sessionID: 'ses_1', callID: 'call_3', args: {} },
  {
    title: 'read',
    output: 'ok',
    metadata: {},
    memory: {
      entries: [{
        schema: 'dsh.memory.index-entry.v1',
        operation: 'add',
        scope: 'project',
        kind: 'fact',
        title: 'Summary fixture',
        summary: 'compaction persisted',
        tags: [],
        entities: [],
      }],
    },
  },
);
const pendingBeforeCompaction = JSON.parse(await readFile(join(root, 'index/state.json'), 'utf8')) as {
  pending: Array<{ entry_id: string }>;
};
assert.equal(pendingBeforeCompaction.pending.length, 3);
await hooks.event?.({ event: {
  type: 'session.next.compaction.ended',
  properties: {
    shadowedSeqs: ['compaction-1'],
    memory: {
      organized_index: {
        segments: [{ child_entry_ids: pendingBeforeCompaction.pending.map(entry => entry.entry_id) }],
      },
    },
  },
} });
await hooks.dispose?.();
const state = await readFile(join(root, 'index/state.json'), 'utf8');
assert.match(state, /persisted/);
assert.match(state, /end-turn persisted/);
assert.match(state, /compaction persisted/);
const committed = JSON.parse(state) as {
  pending: unknown[];
  raw_knowledge: unknown[];
  organization_deltas: Array<{ compressed_segments: Array<{ child_entry_ids: string[] }> }>;
};
assert.equal(committed.pending.length, 0);
assert.equal(committed.raw_knowledge.length, 3);
assert.deepEqual(committed.organization_deltas.at(-1)?.compressed_segments[0]?.child_entry_ids, pendingBeforeCompaction.pending.map(entry => entry.entry_id));
