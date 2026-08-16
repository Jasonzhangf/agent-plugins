/**
 * Strict channel codecs and delivery-ledger pairing for the four inherited
 * pipes between the Node host and Rust renderer.
 * @module dsh-tui/protocol
 */

import { randomUUID } from 'node:crypto'
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import protocolSchema from '../docs/architecture/protocol.schema.json' with { type: 'json' }

/** Protocol version pinned for the first runtime release. */
export const PROTOCOL_VERSION = 1 as const

/** Maximum UTF-8 bytes in one JSON body. */
export const MAX_RECORD_BYTES = 8 * 1024 * 1024

/** Maximum unmatched bytes held by one delivery-pair receiver. */
export const MAX_QUEUED_BYTES = 16 * 1024 * 1024

/** Maximum unmatched records held by one delivery-pair receiver. */
export const MAX_QUEUED_RECORDS = 256

export type ChannelName = 'business_projection' | 'business_action' | 'host_control' | 'child_control'

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

/** Projection records sent host to child on fd 3. */
export type HostProjectionRecord =
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'projection_window'; publicationRevision: number; index: number; cells: readonly Cell[]; views: readonly View[] }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'projection_commit'; publicationRevision: number; totalWindows: number }

/** User intents sent child to host on fd 4. */
export type ChildActionRecord =
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'submit'; actionId: string; sessionId: string; text: string; attachments: readonly unknown[]; mode: 'queue' | 'steer' }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'cancel'; actionId: string; sessionId: string }

/** Control records sent host to child on fd 5. */
export type HostControlRecord =
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'hello'; hostVersion: string; minProtocolVersion: typeof PROTOCOL_VERSION; maxProtocolVersion: typeof PROTOCOL_VERSION; maxRecordBytes: number; maxQueuedBytes: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'delivery_ledger'; channel: 'projection'; sequence: number; recordBytes: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'ack'; channel: 'action'; sequence: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'capacity'; channel: 'action'; availableBytes: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'shutdown'; reason: 'user' | 'host' | 'signal' }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'fatal'; code: string; message: string }

/** Control records sent child to host on fd 6. */
export type ChildControlRecord =
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'ready'; childVersion: string; selectedProtocolVersion: typeof PROTOCOL_VERSION; target: string }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'delivery_ledger'; channel: 'action'; sequence: number; recordBytes: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'ack'; channel: 'projection'; sequence: number; projectionRevision: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'request_resync'; expectedSequence: number; observedSequence: number; observedProjectionRevision: number; reason: 'sequence_gap' | 'revision_mismatch' | 'child_restart' }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'capacity'; channel: 'projection'; availableBytes: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'shutdown'; reason: 'user' | 'host' | 'signal' }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: 'fatal'; code: string; message: string }

export interface ChannelRecords {
  business_projection: HostProjectionRecord
  business_action: ChildActionRecord
  host_control: HostControlRecord
  child_control: ChildControlRecord
}

export interface DecodedRecord<T> {
  readonly record: T
  readonly bodyBytes: number
}

const definitionByChannel: Record<ChannelName, string> = {
  business_projection: 'channelBusinessProjection',
  business_action: 'channelBusinessAction',
  host_control: 'channelHostControl',
  child_control: 'channelChildControl',
}

const ajv = new Ajv2020({ strict: true, allErrors: true })
const validators = Object.fromEntries(
  Object.entries(definitionByChannel).map(([channel, definition]) => [
    channel,
    ajv.compile({
      $schema: protocolSchema.$schema,
      $defs: protocolSchema.$defs,
      $ref: `#/$defs/${definition}`,
    }),
  ]),
) as Record<ChannelName, ValidateFunction>

function validateRecord<C extends ChannelName>(channel: C, value: unknown): ChannelRecords[C] {
  const validate = validators[channel]
  if (!validate(value)) {
    const detail = ajv.errorsText(validate.errors, { separator: '; ' })
    throw new Error(`invalid ${channel} record: ${detail}`)
  }
  return value as ChannelRecords[C]
}

function frameBody<C extends ChannelName>(record: ChannelRecords[C] | unknown, channel: C): Buffer {
  validateRecord(channel, record)
  const body = Buffer.from(JSON.stringify(record), 'utf8')
  if (body.byteLength > MAX_RECORD_BYTES) throw new Error(`record exceeds ${MAX_RECORD_BYTES} bytes`)
  return body
}

/** Encode one validated record into a length-prefixed frame. */
export function encodeFrame<C extends ChannelName>(record: ChannelRecords[C] | unknown, channel: C): Buffer {
  const body = frameBody(record, channel)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.byteLength, 0)
  return Buffer.concat([length, body])
}

function parseBody<C extends ChannelName>(body: Buffer, channel: C): DecodedRecord<ChannelRecords[C]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch (error) {
    throw new Error(`malformed ${channel} JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { record: validateRecord(channel, parsed), bodyBytes: body.byteLength }
}

/** Decode one complete frame and reject the wrong record family or direction. */
export function decodeFrame<C extends ChannelName>(
  buffer: Buffer,
  channel: C,
): DecodedRecord<ChannelRecords[C]> & { remaining: Buffer } {
  if (buffer.byteLength < 4) throw new Error('partial length prefix')
  const length = buffer.readUInt32BE(0)
  if (length === 0 || length > MAX_RECORD_BYTES) throw new Error(`frame length out of range: ${length}`)
  if (buffer.byteLength < 4 + length) throw new Error('partial record body')
  return {
    ...parseBody(buffer.subarray(4, 4 + length), channel),
    remaining: buffer.subarray(4 + length),
  }
}

/** Stateful strict decoder; partial frames survive chunk boundaries. */
export class FrameDecoder<C extends ChannelName> {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  constructor(private readonly channel: C) {}

  /** Append a stream chunk and return every completed frame. */
  push(chunk: Buffer): Array<DecodedRecord<ChannelRecords[C]>> {
    this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const records: Array<DecodedRecord<ChannelRecords[C]>> = []
    while (true) {
      if (this.buffer.byteLength < 4) break
      const length = this.buffer.readUInt32BE(0)
      if (length === 0 || length > MAX_RECORD_BYTES) throw new Error(`frame length out of range: ${length}`)
      if (this.buffer.byteLength < 4 + length) break
      records.push(parseBody(this.buffer.subarray(4, 4 + length), this.channel))
      this.buffer = this.buffer.subarray(4 + length)
    }
    return records
  }

  /** Fail if EOF closes a partial frame. */
  finish(): void {
    if (this.buffer.byteLength !== 0) throw new Error(`partial ${this.channel} frame at EOF`)
  }

  get pendingBytes(): number {
    return this.buffer.byteLength
  }
}

export interface AcceptedAction {
  readonly record: ChildActionRecord
  readonly sequence: number
}

/** Pairs action records with their independent control-pipe delivery ledgers. */
export class ActionPairReceiver {
  private readonly actions: Array<DecodedRecord<ChildActionRecord>> = []
  private readonly ledgers: Array<Extract<ChildControlRecord, { type: 'delivery_ledger' }>> = []
  private pendingBytes = 0
  private expectedSequence = 1

  pushAction(action: DecodedRecord<ChildActionRecord>): AcceptedAction[] {
    this.actions.push(action)
    this.pendingBytes += action.bodyBytes
    this.assertBounds()
    return this.acceptPairs()
  }

  pushLedger(ledger: Extract<ChildControlRecord, { type: 'delivery_ledger' }>): AcceptedAction[] {
    this.ledgers.push(ledger)
    this.assertBounds()
    return this.acceptPairs()
  }

  finish(): void {
    if (this.actions.length !== 0 || this.ledgers.length !== 0) {
      throw new Error('action channel closed with unpaired business or ledger records')
    }
  }

  private acceptPairs(): AcceptedAction[] {
    const accepted: AcceptedAction[] = []
    while (this.actions.length !== 0 && this.ledgers.length !== 0) {
      const action = this.actions.shift()!
      const ledger = this.ledgers.shift()!
      this.pendingBytes -= action.bodyBytes
      if (ledger.recordBytes !== action.bodyBytes) {
        throw new Error(`action ledger recordBytes ${ledger.recordBytes} does not match ${action.bodyBytes}`)
      }
      if (ledger.sequence !== this.expectedSequence) {
        const direction = ledger.sequence > this.expectedSequence ? 'forward gap' : 'rewind'
        throw new Error(`action ledger sequence ${direction}: expected ${this.expectedSequence}, observed ${ledger.sequence}`)
      }
      accepted.push({ record: action.record, sequence: ledger.sequence })
      this.expectedSequence += 1
    }
    return accepted
  }

  private assertBounds(): void {
    if (this.actions.length + this.ledgers.length > MAX_QUEUED_RECORDS || this.pendingBytes > MAX_QUEUED_BYTES) {
      throw new Error('action delivery pairing buffer overflow')
    }
  }
}

/** Monotonic textual action identifier. */
export function newActionId(): string {
  return randomUUID()
}
