/**
 * Length-prefixed JSON framing for the four inherited-pipe channels that
 * connect the Node host to the Rust Ratatui renderer. Each record carries
 * {@link PROTOCOL_VERSION}; control and business records share the wire
 * format, but the channel they appear on encodes direction and family, so a
 * wrong-channel record is fatal at the receiving end.
 * @module dsh-tui/protocol
 */

import { createHash, randomUUID } from 'node:crypto'

/** Protocol version pinned at {@link PROTOCOL_VERSION} for this release. */
export const PROTOCOL_VERSION = 1 as const

/** Maximum UTF-8 bytes in a single record body. */
export const MAX_RECORD_BYTES = 8 * 1024 * 1024

/** Maximum UTF-8 bytes queued for one channel before backpressure engages. */
export const MAX_QUEUED_BYTES = 16 * 1024 * 1024

/** Channel identifiers by inherited pipe index on the child. */
export type ChannelIndex = 3 | 4 | 5 | 6

export type ChannelName = 'business_projection' | 'business_action' | 'host_control' | 'child_control'

/** Common envelope: every record carries the protocol version and a type tag. */
export interface VersionedRecord {
  readonly protocolVersion: typeof PROTOCOL_VERSION
  readonly type: string
}

/** Cell payload sent through the projection channel. */
export interface Cell {
  readonly id: string
  readonly kind: 'user' | 'assistant_text' | 'assistant_reasoning' | 'tool_call' | 'tool_result' | 'status'
  readonly lines: readonly Line[]
}

export interface Line {
  readonly text: string
  readonly style?: 'dim' | 'bold' | 'accent' | 'error' | 'code'
}

export interface View {
  readonly id: string
  readonly payload: Record<string, unknown>
}

/** Projection channel records (host -> child, fd 3). */
export type HostProjectionRecord =
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'projection_window'; publicationRevision: number; index: number; cells: readonly Cell[]; views: readonly View[] }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'projection_commit'; publicationRevision: number; totalWindows: number }

/** Action channel records (child -> host, fd 4). */
export type ChildActionRecord =
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'submit'; actionId: string; sessionId: string; text: string; mode: 'queue' | 'steer' }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'cancel'; actionId: string; sessionId: string }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'shutdown'; actionId: string; reason: 'user' | 'signal' }

/** Host control channel records (host -> child, fd 5). */
export type HostControlRecord =
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'hello'; hostVersion: string; minProtocolVersion: typeof PROTOCOL_VERSION; maxProtocolVersion: typeof PROTOCOL_VERSION; maxRecordBytes: number; maxQueuedBytes: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'delivery_ledger'; channel: 'projection'; sequence: number; recordBytes: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'ack'; channel: 'projection'; sequence: number; projectionRevision: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'capacity'; channel: 'projection'; availableBytes: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'shutdown'; reason: 'user' | 'host' | 'signal' }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'fatal'; code: string; message: string }

/** Child control channel records (child -> host, fd 6). */
export type ChildControlRecord =
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'ready'; childVersion: string; selectedProtocolVersion: typeof PROTOCOL_VERSION; target: string }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'delivery_ledger'; channel: 'action'; sequence: number; recordBytes: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'ack'; channel: 'action'; sequence: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'request_resync'; expectedSequence: number; observedSequence: number; observedProjectionRevision: number; reason: 'sequence_gap' | 'revision_mismatch' | 'child_restart' }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'capacity'; channel: 'action'; availableBytes: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'shutdown'; reason: 'user' | 'host' | 'signal' }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'fatal'; code: string; message: string }

export type AnyRecord = HostProjectionRecord | ChildActionRecord | HostControlRecord | ChildControlRecord

/** Encode a record into a length-prefixed JSON frame. */
export function encodeFrame(record: AnyRecord): Buffer {
  const body = Buffer.from(JSON.stringify(record), 'utf8')
  if (body.byteLength > MAX_RECORD_BYTES) throw new Error(`record exceeds ${MAX_RECORD_BYTES} bytes`)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.byteLength, 0)
  return Buffer.concat([length, body])
}

/** Decode one full frame from a buffer; returns the record and remaining bytes. */
export function decodeFrame(buffer: Buffer): { record: AnyRecord; remaining: Buffer } {
  if (buffer.byteLength < 4) throw new Error('partial length prefix')
  const length = buffer.readUInt32BE(0)
  if (length === 0 || length > MAX_RECORD_BYTES) throw new Error(`frame length out of range: ${length}`)
  if (buffer.byteLength < 4 + length) throw new Error('partial record body')
  const body = buffer.subarray(4, 4 + length).toString('utf8')
  const record = JSON.parse(body) as AnyRecord
  if (record.protocolVersion !== PROTOCOL_VERSION) throw new Error(`incompatible protocol version: ${String(record.protocolVersion)}`)
  return { record, remaining: buffer.subarray(4 + length) }
}

/** Decode frames from a buffer repeatedly; emits each record and returns residual bytes. */
export function* decodeFrames(buffer: Buffer): IterableIterator<AnyRecord> {
  let remaining = buffer
  while (remaining.byteLength >= 4) {
    const length = remaining.readUInt32BE(0)
    if (length === 0 || length > MAX_RECORD_BYTES) throw new Error(`frame length out of range: ${length}`)
    if (remaining.byteLength < 4 + length) break
    const body = remaining.subarray(4, 4 + length).toString('utf8')
    const record = JSON.parse(body) as AnyRecord
    if (record.protocolVersion !== PROTOCOL_VERSION) throw new Error(`incompatible protocol version: ${String(record.protocolVersion)}`)
    yield record
    remaining = remaining.subarray(4 + length)
  }
}

/** Stateful frame decoder for a continuous stream; partial frames survive chunk boundaries. */
export class FrameDecoder {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  /** Append one stream chunk and return every complete record it completes. */
  push(chunk: Buffer): AnyRecord[] {
    this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const records: AnyRecord[] = []
    while (true) {
      if (this.buffer.byteLength < 4) break
      const length = this.buffer.readUInt32BE(0)
      if (length === 0 || length > MAX_RECORD_BYTES) throw new Error(`frame length out of range: ${length}`)
      if (this.buffer.byteLength < 4 + length) break
      const body = this.buffer.subarray(4, 4 + length).toString('utf8')
      const record = JSON.parse(body) as AnyRecord
      if (record.protocolVersion !== PROTOCOL_VERSION) throw new Error(`incompatible protocol version: ${String(record.protocolVersion)}`)
      records.push(record)
      this.buffer = this.buffer.subarray(4 + length)
    }
    return records
  }

  /** Number of bytes held while waiting for a record body. */
  get pendingBytes(): number {
    return this.buffer.byteLength
  }
}

/** Stable deterministic revision derived from the canonical publication bytes. */
export function publicationRevision(record: HostProjectionRecord): number {
  if (record.type !== 'projection_window') return 0
  const hash = createHash('sha256').update(JSON.stringify(record.cells)).digest('hex')
  return Number(BigInt('0x' + hash.slice(0, 8))) & 0x7fffffff
}

/** Monotonic action id with stable textual form. */
export function newActionId(): string {
  return randomUUID()
}
