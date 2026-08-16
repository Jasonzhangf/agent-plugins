import { describe, expect, it } from 'vitest'
import {
  ActionPairReceiver,
  decodeFrame,
  encodeFrame,
  FrameDecoder,
} from '../src/protocol.js'

describe('bridge framing', () => {
  it('round-trips a length-prefixed action frame', () => {
    const record = {
      protocolVersion: 1 as const,
      type: 'cancel' as const,
      actionId: 'a1',
      sessionId: 's1',
    }
    expect(decodeFrame(encodeFrame(record, 'business_action'), 'business_action').record).toEqual(record)
  })

  it('keeps partial control frames across stream chunks', () => {
    const record = {
      protocolVersion: 1 as const,
      type: 'shutdown' as const,
      reason: 'user' as const,
    }
    const frame = encodeFrame(record, 'child_control')
    const split = Math.floor(frame.byteLength / 2)
    const decoder = new FrameDecoder('child_control')
    expect(decoder.push(frame.subarray(0, split))).toEqual([])
    expect(decoder.push(frame.subarray(split))).toEqual([{ record, bodyBytes: frame.byteLength - 4 }])
    expect(decoder.pendingBytes).toBe(0)
  })

  it('decodes two frames from one chunk', () => {
    const first = {
      protocolVersion: 1 as const,
      type: 'cancel' as const,
      actionId: 'a3',
      sessionId: 's3',
    }
    const second = {
      protocolVersion: 1 as const,
      type: 'submit' as const,
      actionId: 'a4',
      sessionId: 's4',
      text: 'hello',
      attachments: [],
      mode: 'queue' as const,
    }
    const decoder = new FrameDecoder('business_action')
    const firstFrame = encodeFrame(first, 'business_action')
    const secondFrame = encodeFrame(second, 'business_action')
    expect(decoder.push(Buffer.concat([firstFrame, secondFrame]))).toEqual([
      { record: first, bodyBytes: firstFrame.byteLength - 4 },
      { record: second, bodyBytes: secondFrame.byteLength - 4 },
    ])
  })

  it('rejects an incompatible protocol version', () => {
    const body = Buffer.from(JSON.stringify({ protocolVersion: 2, type: 'cancel' }), 'utf8')
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.byteLength, 0)
    expect(() => decodeFrame(Buffer.concat([length, body]), 'business_action')).toThrow(/business_action record/)
  })

  it('rejects a partial frame at EOF', () => {
    const decoder = new FrameDecoder('business_action')
    decoder.push(Buffer.from([0, 0, 0, 10, 123]))
    expect(() => decoder.finish()).toThrow(/partial business_action frame at EOF/)
  })

  it('rejects wrong-family, unknown, and cross-variant fields', () => {
    const shutdown = { protocolVersion: 1 as const, type: 'shutdown' as const, reason: 'user' as const }
    expect(() => encodeFrame(shutdown, 'business_action')).toThrow(/business_action record/)
    expect(() => encodeFrame({
      protocolVersion: 1,
      type: 'cancel',
      actionId: 'a5',
      sessionId: 's5',
      text: 'not allowed',
    }, 'business_action')).toThrow(/business_action record/)
    expect(() => encodeFrame({
      protocolVersion: 1,
      type: 'unknown',
    }, 'child_control')).toThrow(/child_control record/)
  })

  it('accepts an action only after its matching ledger arrives', () => {
    const action = {
      protocolVersion: 1 as const,
      type: 'cancel' as const,
      actionId: 'a6',
      sessionId: 's6',
    }
    const actionFrame = encodeFrame(action, 'business_action')
    const receiver = new ActionPairReceiver()
    expect(receiver.pushAction({ record: action, bodyBytes: actionFrame.byteLength - 4 })).toEqual([])
    expect(receiver.pushLedger({
      protocolVersion: 1,
      type: 'delivery_ledger',
      channel: 'action',
      sequence: 1,
      recordBytes: actionFrame.byteLength - 4,
    })).toEqual([{ record: action, sequence: 1 }])
    receiver.finish()
  })

  it('rejects action byte mismatches and unmatched EOF', () => {
    const action = {
      protocolVersion: 1 as const,
      type: 'cancel' as const,
      actionId: 'a7',
      sessionId: 's7',
    }
    const actionFrame = encodeFrame(action, 'business_action')
    const mismatched = new ActionPairReceiver()
    mismatched.pushAction({ record: action, bodyBytes: actionFrame.byteLength - 4 })
    expect(() => mismatched.pushLedger({
      protocolVersion: 1,
      type: 'delivery_ledger',
      channel: 'action',
      sequence: 1,
      recordBytes: actionFrame.byteLength - 5,
    })).toThrow(/recordBytes/)

    const unmatched = new ActionPairReceiver()
    unmatched.pushAction({ record: action, bodyBytes: actionFrame.byteLength - 4 })
    expect(() => unmatched.finish()).toThrow(/unpaired/)
  })

  it('treats action sequence gaps and replays as fatal', () => {
    const action = {
      protocolVersion: 1 as const,
      type: 'cancel' as const,
      actionId: 'a8',
      sessionId: 's8',
    }
    const actionFrame = encodeFrame(action, 'business_action')
    const decoded = { record: action, bodyBytes: actionFrame.byteLength - 4 }

    const gap = new ActionPairReceiver()
    gap.pushAction(decoded)
    expect(() => gap.pushLedger({
      protocolVersion: 1,
      type: 'delivery_ledger',
      channel: 'action',
      sequence: 2,
      recordBytes: decoded.bodyBytes,
    })).toThrow(/forward gap/)

    const replay = new ActionPairReceiver()
    expect(replay.pushAction(decoded)).toEqual([])
    expect(replay.pushLedger({
      protocolVersion: 1,
      type: 'delivery_ledger',
      channel: 'action',
      sequence: 1,
      recordBytes: decoded.bodyBytes,
    })).toHaveLength(1)
    replay.pushAction(decoded)
    expect(() => replay.pushLedger({
      protocolVersion: 1,
      type: 'delivery_ledger',
      channel: 'action',
      sequence: 1,
      recordBytes: decoded.bodyBytes,
    })).toThrow(/rewind/)
  })
})
