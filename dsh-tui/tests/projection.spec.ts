import { describe, expect, it } from 'vitest'
import { markdownLines, publishPublication, type ProjectionSnapshot } from '../src/projection.js'

describe('terminal projection', () => {
  it('renders GFM tables with the host parser', () => {
    expect(markdownLines('| a | b |\n| - | - |\n| 1 | 2 |')).toEqual([
      { text: 'a | b', style: 'dim' },
      { text: '1 | 2', style: 'dim' },
    ])
  })

  it('publishes one window before its matching commit', () => {
    const snapshot: ProjectionSnapshot = {
      agent: { status: 'idle', model: 'm', provider: 'p', sessionId: 's' } as ProjectionSnapshot['agent'],
      cells: [{ id: 'c1', kind: 'assistant_text', lines: [{ text: 'ok' }] }],
    }
    const records = publishPublication(snapshot)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ type: 'projection_window', index: 0 })
    expect(records[1]).toEqual({
      protocolVersion: 1,
      type: 'projection_commit',
      publicationRevision: records[0].publicationRevision,
      totalWindows: 1,
    })
  })
})
