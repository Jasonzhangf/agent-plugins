import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.ts'
import type { Config as ConfigShape } from './config.ts'
import { MultiKeyControl, mountMultiKeyControl } from './control.ts'
import { applyOfficialDerivedProvider } from './provider/index.ts'
import { installUnsafePortFetch } from './provider/unsafe-port-fetch.ts'

export { Config }
export type { Config as ConfigShape } from './config.ts'
export { OfficialDerivedPiAiAdapter, OfficialDerivedPiAiAdapter as PiAiAdapter } from './adapter.ts'
export { MultiKeyControl } from './control.ts'
export { applyOfficialDerivedProvider } from './provider/index.ts'

export const name = 'llm-pi-ai-multikey'
export const inject = ['llm']

export function apply(ctx: Context, config: ConfigShape = {}): void {
  installUnsafePortFetch()
  const provider = applyOfficialDerivedProvider(ctx, config)
  mountMultiKeyControl(ctx, new MultiKeyControl(() => provider.adapter))
}
