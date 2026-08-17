import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import {
  apply,
  TUI_STARTUP_SERVICE,
  WEB_STARTUP_SERVICE,
} from '../src/startup.js'

function mount(args: readonly string[]): {
  services: Map<string, unknown>
  exitCodes: number[]
} {
  const services = new Map<string, unknown>()
  const exitCodes: number[] = []
  const ctx = {
    provide(key: string, value: unknown): void {
      services.set(key, value)
    },
    get(key: string): unknown {
      return services.get(key)
    },
  } as unknown as Context
  provideCmdline(ctx, {
    args,
    exit(code) {
      exitCodes.push(code)
    },
  })
  apply(ctx)
  return { services, exitCodes }
}

describe('combined TUI and Web startup', () => {
  it('publishes both surface services from one command line', () => {
    const { services } = mount(['--resume', 'session-1', '--port', '3099', '--trusted-host', 'host-a'])
    expect(services.get(TUI_STARTUP_SERVICE)).toEqual({ resumeSessionId: 'session-1' })
    expect(services.get(WEB_STARTUP_SERVICE)).toEqual({ port: 3099, trustedHosts: ['host-a'] })
  })

  it('publishes defaults for the standard Web invocation', () => {
    const { services } = mount([])
    expect(services.get(TUI_STARTUP_SERVICE)).toEqual({})
    expect(services.get(WEB_STARTUP_SERVICE)).toEqual({ trustedHosts: [] })
  })

  it('rejects an unsafe all-interfaces web bind before publishing services', () => {
    const { services, exitCodes } = mount(['--host', '0.0.0.0'])
    expect(exitCodes).toEqual([1])
    expect(services.get(TUI_STARTUP_SERVICE)).toBeUndefined()
    expect(services.get(WEB_STARTUP_SERVICE)).toBeUndefined()
  })

  it('rejects an out-of-range web port before publishing services', () => {
    const { services, exitCodes } = mount(['--port', '70000'])
    expect(exitCodes).toEqual([1])
    expect(services.get(TUI_STARTUP_SERVICE)).toBeUndefined()
    expect(services.get(WEB_STARTUP_SERVICE)).toBeUndefined()
  })
})
