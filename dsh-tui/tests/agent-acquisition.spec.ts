import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import type { AgentPresets } from '@deepseek-ai/dsh-agent-presets'
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'
import { describe, expect, it } from 'vitest'
import { acquireOwnedAgent } from '../src/index.js'

function fakeAgent(id: string): Agent {
  return { id: SessionId(id) } as Agent
}

describe('agent acquisition for the dual-surface runtime', () => {
  it('attaches a live shared session without resume or persistence work', async () => {
    const live = fakeAgent('session-live')
    let inspectCalls = 0
    let resumeCalls = 0
    const handle = await acquireOwnedAgent(
      { resumeSessionId: 'session-live' },
      {
        create: async () => { throw new Error('create must not run for a live session') },
        resume: async () => {
          resumeCalls += 1
          throw new Error('resume must not run for a live session')
        },
        get: id => String(id) === 'session-live' ? live : undefined,
      },
      {
        inspect: async () => {
          inspectCalls += 1
          throw new Error('inspect must not run for a live session')
        },
      },
      undefined,
      { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    )

    expect(handle.agent).toBe(live)
    expect(handle.owned).toBe(false)
    expect(inspectCalls).toBe(0)
    expect(resumeCalls).toBe(0)
    await expect(handle.dispose()).resolves.toBeUndefined()
  })

  it('resumes a cold session through the public registry and owns its cleanup', async () => {
    const resumed = fakeAgent('session-cold')
    let inspectCalls = 0
    let disposeCalls = 0
    const handle = await acquireOwnedAgent(
      { resumeSessionId: 'session-cold' },
      {
        create: async () => { throw new Error('create must not run when --resume is present') },
        resume: async () => ({
          agent: resumed,
          dispose: async () => {
            disposeCalls += 1
          },
        }),
        get: () => undefined,
      },
      {
        inspect: async () => {
          inspectCalls += 1
          return { meta: {}, events: [] } as unknown as SessionInspection
        },
      },
      undefined,
      { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    )

    expect(handle.agent).toBe(resumed)
    expect(handle.owned).toBe(true)
    expect(inspectCalls).toBe(1)
    await handle.dispose()
    expect(disposeCalls).toBe(1)
  })

  it('creates a fresh session with the resolved agent preset and agent options', async () => {
    const created = fakeAgent('session-fresh')
    let mountedPreset: string | undefined
    const createdOptions: CreateAgentOptions[] = []
    const presets = {
      resolve: async () => ({ id: 'standard' }),
      mount: async (_agentCtx: unknown, id?: string) => {
        mountedPreset = id
      },
    } as unknown as AgentPresets
    const handle = await acquireOwnedAgent(
      {},
      {
        create: async options => {
          createdOptions.push(options)
          return { agent: created, dispose: async () => {} }
        },
        resume: async () => { throw new Error('resume must not run without --resume') },
        get: () => undefined,
      },
      {
        inspect: async () => { throw new Error('inspect must not run for a fresh session') },
      },
      presets,
      { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    )

    expect(handle.agent).toBe(created)
    expect(handle.owned).toBe(true)
    expect(createdOptions).toHaveLength(1)
    expect(createdOptions[0].agentOptions).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    expect(createdOptions[0].meta).toMatchObject({ agentPreset: 'standard' })
    await createdOptions[0].setup?.({} as never)
    expect(mountedPreset).toBe('standard')
  })
})
