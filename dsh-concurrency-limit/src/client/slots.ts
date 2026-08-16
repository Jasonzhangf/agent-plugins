/** Client slot declarations and composed component props. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the projection-key declaration (single home: ../types.ts).
import type {} from '../types.ts'
import type { ConcurrencyKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The concurrency stepper's copy. */
    concurrency: ConcurrencyKey
  }
}

/** Injected business face of the composer stepper. */
export interface ConcurrencyControlInjected {
  /** Set the cap to one positive integer; resolves to a failure line or null. */
  set: (next: number) => Promise<string | null>
  /** Restore the deployment default. */
  reset: () => Promise<string | null>
}

/** Full stepper props: runtime share + injected share + the locale seat. */
export type ConcurrencyControlProps =
  PropsRuntime<'conversation.input.right'> & InjectFace<ConcurrencyControlInjected> & PropsLocale<'concurrency'>