/**
 * TUI command-line provider: parses --help and --resume <id> then publishes
 * {@link TUI_STARTUP_SERVICE}. The runtime row consumes the provider through
 * Cordis dependency injection.
 * @module dsh-tui/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before parsing. */
export const inject = ['cmdlineArgs']

/** Service name provided by this plugin and consumed by the runtime row. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the runtime row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Optional session id to resume; absent means create a fresh session. */
  resumeSessionId?: string
}

/** Build a fresh commander program; tests reuse it for independent parses. */
function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Run DeepSeek Harness as a Ratatui terminal surface.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume <id>', 'resume a previously persisted session id')
    .addHelpText('after', `
Examples:
  dsh --profile tui                       start a fresh session
  dsh --profile tui --resume <id>         resume a saved session
`)
}

/** Parse the command line and publish the resolved startup values. */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const opts = program.opts<{ resume?: string }>()
    ctx.provide(TUI_STARTUP_SERVICE, opts.resume === undefined ? {} : { resumeSessionId: opts.resume })
  })
  parseCmdline(ctx, program)
}
