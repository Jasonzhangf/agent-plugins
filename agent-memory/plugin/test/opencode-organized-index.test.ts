import { strict as assert } from 'node:assert';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfiguredOpenCodePlugin } from '../src/opencode.js';

const root = await mkdtemp(join(tmpdir(), 'agent-memory-organized-index-'));
const binary = join(import.meta.dirname, '../../target/release/agent-memory-bridge');
const plugin = createConfiguredOpenCodePlugin({ bridgeBinary: binary, root, maxIndexEntries: 10 });
const hooks = await plugin({ serverUrl: new URL('http://127.0.0.1'), directory: root, worktree: root });

const entry = (title: string) => ({
  schema: 'dsh.memory.index-entry.v1', operation: 'add', scope: 'project', kind: 'fact',
  title, summary: `summary-${title}`, tags: [], entities: [],
});

for (const [index, title] of ['one', 'two', 'three'].entries()) {
  await hooks['tool.execute.after']?.(
    { tool: 'fixture', sessionID: 'ses_fixture', callID: `call_${index}`, args: {} },
    { title: 'fixture', output: 'ok', metadata: {}, memory: { entries: [entry(title)] } },
  );
}

const before = JSON.parse(await readFile(join(root, 'index/state.json'), 'utf8')) as {
  generation: number;
  pending: Array<{ entry_id: string }>;
};
assert.equal(before.generation, 0);
assert.equal(before.pending.length, 3);

// Controlled provider fixture: this mirrors the typed assistant compaction
// response that OpenCode would deliver when the model returns organized_index.
await hooks.event?.({ event: {
  type: 'message.updated',
  properties: {
    id: 'msg_compaction_fixture',
    role: 'assistant',
    summary: true,
    memory: { organized_index: { segments: [{ child_entry_ids: before.pending.map(item => item.entry_id) }] } },
  },
} });
await hooks.dispose?.();

const after = JSON.parse(await readFile(join(root, 'index/state.json'), 'utf8')) as {
  generation: number;
  pending: unknown[];
  raw_knowledge: unknown[];
  organization_deltas: Array<{ compressed_segments: Array<{ child_entry_ids: string[] }> }>;
  organization_epochs: unknown[];
  diagnostics: string[];
};
assert.equal(after.generation, 1);
assert.equal(after.pending.length, 0);
assert.equal(after.raw_knowledge.length, 3);
assert.equal(after.organization_epochs.length, 1);
assert.equal(after.diagnostics.length, 0);
assert.deepEqual(after.organization_deltas.at(-1)?.compressed_segments[0]?.child_entry_ids, before.pending.map(item => item.entry_id));
