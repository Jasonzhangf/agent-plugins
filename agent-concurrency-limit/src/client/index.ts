/**
 * Concurrency-limit plugin, browser half: the composer tool-row stepper over
 * the `concurrencyLimits` projection (read) and the `/concurrency` command
 * channel (write). Per-session scope: each conversation window carries its
 * own cap, adjusted live.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ConcurrencyControl } from './ConcurrencyControl.tsx'
import { ConcurrencyControlInjected } from './slots.ts'
import { en, zh, type ConcurrencyKey } from './locales.ts'

export type { ConcurrencyControlInjected } from './slots.ts'
export type { ConcurrencyKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The concurrency stepper's copy. */
    concurrency: ConcurrencyKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'concurrency'

/** Required services: the seat's slot registry, commands Remote, and locale. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the composer stepper over the command channel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agent-concurrency-limit: dictionaries')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'concurrency-limit',
    order: 50,
    locale: NS,
    inject: (sessionId: SessionId): ConcurrencyControlInjected => ({
      set: async (next: number) => {
        const result = await ctx.remote.commands.execute(sessionId, '/concurrency set ' + String(next))
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        return null
      },
      reset: async () => {
        const result = await ctx.remote.commands.execute(sessionId, '/concurrency reset')
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        return null
      },
    }),
  }, ConcurrencyControl))
}
