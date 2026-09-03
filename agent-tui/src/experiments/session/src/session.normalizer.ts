/**
 * Lossless adapter between OpenCode-derived session records and the TUI's
 * presentation input.
 *
 * Owns the declared boundary between the local `SessionHistoryRecord`
 * union (event entry or chunk run) and the TUI's
 * `TuiHistoryEntry`. Packed chunk rows are expanded into one synthetic
 * `assistant/chunk` `SessionWireEvent` per member, preserving the original
 * `seq..seq+length-1` range so projection, raw buffer, and revision
 * monotonicity never see a gap. Unknown fields are carried through verbatim;
 * a malformed row fails loudly rather than being silently dropped.
 */
import type { SessionHistoryRecord, SessionWireEvent } from '../../transport/src/transport.ts'
type ChunkRowEvent = SessionWireEvent & { readonly data: Record<string, any> }
type SessionEventEntry = { readonly event: SessionWireEvent }
import type { TuiHistoryEntry } from '../../../../contracts/tui/session/history-entry.types.ts'

/** Inclusive first logical sequence represented by one session history record. */
export function historyRecordFirstSeq(record: SessionHistoryRecord): number {
  return record.event.seq
}

/** Inclusive last logical sequence represented by one session history record. */
export function historyRecordLastSeq(record: SessionHistoryRecord): number {
  if (record.type === 'event') return record.event.seq
  const chunk = record.event
  const length = chunk.type === 'chunkrow/tool-call-chunks'
    ? chunk.data.args.length
    : chunk.data.texts.length
  return chunk.seq + length - 1
}

function chunkMemberEntry(
  chunk: ChunkRowEvent,
  index: number,
  cumulativeTime: number,
): TuiHistoryEntry {
  const { turn, step } = chunk.data
  if (chunk.type === 'chunkrow/text-chunks') {
    const data = chunk.data as { readonly texts: readonly string[]; readonly index: number }
    return {
      event: {
        type: 'assistant/chunk',
        seq: chunk.seq + index,
        time: cumulativeTime,
        data: {
          turn,
          step,
          chunk: { type: 'text-delta', index: data.index, text: data.texts[index] ?? '' },
        },
      },
    }
  }
  if (chunk.type === 'chunkrow/reasoning-chunks') {
    const data = chunk.data as { readonly texts: readonly string[]; readonly index: number }
    return {
      event: {
        type: 'assistant/chunk',
        seq: chunk.seq + index,
        time: cumulativeTime,
        data: {
          turn,
          step,
          chunk: { type: 'reasoning-delta', index: data.index, text: data.texts[index] ?? '' },
        },
      },
    }
  }
  const data = chunk.data as { readonly args: readonly string[]; readonly index: number; readonly id: string; readonly name?: string }
  const args = data.args
  const chunkData: { type: 'tool-call-delta'; index: number; id: string; argumentsDelta: string; name?: string } = {
    type: 'tool-call-delta',
    index: data.index,
    id: data.id,
    argumentsDelta: args[index] ?? '',
  }
  if (Object.hasOwn(data, 'name') && typeof data.name === 'string') {
    chunkData.name = data.name
  }
  return {
    event: {
      type: 'assistant/chunk',
      seq: chunk.seq + index,
      time: cumulativeTime,
      data: { turn, step, chunk: chunkData },
    },
  }
}

function expandChunkRow(record: Extract<SessionHistoryRecord, { type: 'chunks' }>): TuiHistoryEntry[] {
  const chunk = record.event
  const length = chunk.type === 'chunkrow/tool-call-chunks'
    ? chunk.data.args.length
    : chunk.data.texts.length
  if (length <= 0) {
    throw new Error('session normalizer: packed chunk row must carry at least one member')
  }
  const entries: TuiHistoryEntry[] = []
  let cumulative = chunk.time
  for (let index = 0; index < length; index += 1) {
    entries.push(chunkMemberEntry(chunk, index, cumulative))
    const dt = chunk.data.dt[index]
    if (dt !== undefined) cumulative += dt
  }
  return entries
}

/** Normalize one session history record to one or more presentation entries. */
export function normalizeHistoryRecord(record: SessionHistoryRecord): readonly TuiHistoryEntry[] {
  if (record.type === 'event') return [entryFromWire(record)]
  return expandChunkRow(record)
}

/** Convenience: project one SessionEventEntry into a presentation entry. */
export function entryFromWire(entry: SessionEventEntry): TuiHistoryEntry {
  return { event: entry.event as SessionWireEvent }
}

/** Normalize a page/follow opening payload into presentation entries. */
export function normalizeHistoryRecords(
  records: readonly SessionHistoryRecord[],
): readonly TuiHistoryEntry[] {
  const entries: TuiHistoryEntry[] = []
  for (const record of records) {
    for (const entry of normalizeHistoryRecord(record)) entries.push(entry)
  }
  return Object.freeze(entries)
}

/** Inclusive last logical sequence covered by the normalized entries. */
export function lastSeqOf(entries: readonly TuiHistoryEntry[]): number {
  let last = -1
  for (const entry of entries) {
    if (entry.event.seq > last) last = entry.event.seq
  }
  return last
}

/** Inclusive first logical sequence covered by the normalized entries. */
export function firstSeqOf(entries: readonly TuiHistoryEntry[]): number {
  let first = Number.POSITIVE_INFINITY
  for (const entry of entries) {
    if (entry.event.seq < first) first = entry.event.seq
  }
  return Number.isFinite(first) ? first : -1
}
