import type { Context } from '@deepseek-ai/cordis'
export type TuiInteractiveWindowKind = 'approval' | 'ask' | 'models' | 'provider' | 'permissions'
export interface TuiInteractiveWindowInput { readonly kind: TuiInteractiveWindowKind; readonly key: string; readonly title: string; readonly items: readonly { readonly key: string; readonly label: string }[]; readonly selectedIndex?: number; readonly sourceRevision: number }
export interface TuiInteractiveResult { readonly kind: TuiInteractiveWindowKind; readonly key: string; readonly itemKey: string; readonly sourceRevision: number }
export interface TuiInteractiveWindowFace { readonly name: 'tuiInteractiveWindow'; open(input: TuiInteractiveWindowInput, onSelect?: (itemKey: string) => void): () => void; submit(): TuiInteractiveResult; cancel(): void; dispose(): void }
declare module '@deepseek-ai/cordis' { interface Context { tuiInteractiveWindow?: TuiInteractiveWindowFace } }
