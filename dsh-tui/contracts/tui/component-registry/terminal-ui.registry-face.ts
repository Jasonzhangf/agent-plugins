import type { Context } from '@deepseek-ai/cordis'
import type {
  ComponentManifest,
  ComponentRegistration,
  TuiComponentProps,
  TuiRenderOutput,
} from './component-registry.types.ts'

export interface TuiComponentRegistry {
  readonly name: 'tuiComponentRegistry'
  register(ownerContext: Context, registration: ComponentRegistration): () => void | Promise<void>
  resolve(groupId: string, kind: string): ComponentRegistration
  render(groupId: string, kind: string, props: TuiComponentProps): TuiRenderOutput
  compileManifest(): ComponentManifest
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiComponentRegistry: TuiComponentRegistry
  }
}
