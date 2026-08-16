import { describe, expect, it } from 'vitest'
import { decodeFrame, encodeFrame, FrameDecoder } from '../src/protocol.js'

describe('bridge framing', () => {
  it('round-trips a length-prefixed action frame', () => {
    const record = {
      protocolVersion: 1 as const,
      type: 'cancel' as const,
      actionId: 'a1',
      sessionId: 's1',
    }
    expect(decodeFrame(encodeFrame(record)).record).toEqual(record)
  })

  it('keeps partial frames across stream chunks', () => {
    const record = {
      protocolVersion: 1 as const,
      type: 'shutdown' as const,
      actionId: 'a2',
      reason: 'user' as const,
    }
    const frame = encodeFrame(record)
    const split = Math.floor(frame.byteLength / 2)
    const decoder = new FrameDecoder()
    expect(decoder.push(frame.subarray(0, split))).toEqual([])
    expect(decoder.push(frame.subarray(split))).toEqual([record])
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
      mode: 'queue' as const,
    }
    const decoder = new FrameDecoder()
    expect(decoder.push(Buffer.concat([encodeFrame(first), encodeFrame(second)]))).toEqual([first, second])
  })

  it('rejects an incompatible protocol version', () => {
    const body = Buffer.from(JSON.stringify({ protocolVersion: 2, type: 'cancel' }), 'utf8')
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.byteLength, 0)
    expect(() => decodeFrame(Buffer.concat([length, body]))).toThrow(/incompatible protocol version/)
  })
})
