import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.ts'
import type { Config as ConfigShape } from './config.ts'
import { MultiKeyControl, mountMultiKeyControl } from './control.ts'
import { applyMultiKeyProvider } from './provider/index.ts'

export { Config }
export type { Config as ConfigShape } from './config.ts'
export { OfficialDerivedPiAiAdapter as PiAiAdapter } from './adapter.ts'
export { MultiKeyControl } from './control.ts'
export { applyMultiKeyProvider } from './provider/index.ts'

export const name = 'multikey-provider'
export const inject = ['llm']

export function apply(ctx: Context, config: ConfigShape = {}): void {
  const provider = applyMultiKeyProvider(ctx, config)
  mountMultiKeyControl(ctx, new MultiKeyControl(() => provider.adapter))
}
