import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { OfficialDerivedPiAiAdapter } from './adapter.ts'

export interface PoolHealthProjection {
  readonly [route: string]: {
    readonly [keyId: string]: {
      readonly state: string
      readonly consecutiveFailures: number
      readonly lastFailureAt?: number
      readonly lastCode?: string
    }
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LlmError('multikey control request must be an object', 'INVALID_ARGS')
  }
  return value as Record<string, unknown>
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string' || field.length === 0) {
    throw new LlmError(`multikey control field "${key}" must be a non-empty string`, 'INVALID_ARGS')
  }
  return field
}

/** Typed redacted control owner. */
export class MultiKeyControl {
  constructor(private readonly adapter: () => OfficialDerivedPiAiAdapter | undefined) {}

  private current(): OfficialDerivedPiAiAdapter {
    const adapter = this.adapter()
    if (adapter === undefined) throw new LlmError('multikey adapter has no active routes', 'NO_ADAPTER')
    return adapter
  }

  async probe(route: string, keyId: string): Promise<unknown> {
    return this.current().probeKey(route, keyId)
  }

  async view(): Promise<PoolHealthProjection> {
    const projection: Record<string, Record<string, object>> = {}
    for (const [route, pool] of this.current().getPools()) {
      projection[route] = Object.fromEntries(pool.view())
    }
    return projection as PoolHealthProjection
  }
}

export async function handleControlRequest(
  control: MultiKeyControl,
  endpoint: string,
  payload: unknown,
) {
  try {
    if (endpoint === 'view') return { ok: true as const, value: await control.view() }
    if (endpoint === 'probe') {
      const request = object(payload)
      return {
        ok: true as const,
        value: await control.probe(stringField(request, 'route'), stringField(request, 'keyId')),
      }
    }
    return {
      ok: false as const,
      error: { code: 'bad-request' as const, message: 'unknown multikey control endpoint', details: { issues: [] } },
    }
  } catch (error) {
    if (error instanceof LlmError && error.code === 'INVALID_ARGS') {
      return {
        ok: false as const,
        error: { code: 'bad-request' as const, message: error.message, details: { issues: [] } },
      }
    }
    return {
      ok: false as const,
      error: {
        message: error instanceof Error ? error.message : 'multikey control failed',
        code: 'internal' as const,
        details: {},
      },
    }
  }
}

/** Mount the redacted control channel on the installed Connection service. */
export function mountMultiKeyControl(ctx: Context, control: MultiKeyControl): void {
  ctx.inject(['connection'], connectionCtx => {
    connectionCtx.effect(() => connectionCtx.connection.rpc.handle(
      '/dsh-llm-pi-ai-multikey',
      (endpoint, payload) => handleControlRequest(control, endpoint, payload),
      { authority: 'loopback' },
    ), 'llm-pi-ai-multikey: loopback control')
  })
}
