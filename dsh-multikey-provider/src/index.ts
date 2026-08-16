// dsh-llm-pi-ai-multikey entry — public rc.6 provider composition
// Status: binding-pending
// Official package: @deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.6
export { applyReplacementProvider } from './official-provider/index.js'
export { MultiKeyControl } from './control.js'
export { MultiKeySecretControl } from './secret-control.js'
export async function apply(ctx: unknown, config: unknown): Promise<void> {
  void ctx; void config
  throw new Error("binding-pending")
}
