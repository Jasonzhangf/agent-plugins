/**
 * Combined TUI and Web command-line provider for the single-process dual
 * surface profile. It parses the TUI `--resume` flag plus the Web flag family,
 * then publishes both {@link TUI_STARTUP_SERVICE} and
 * {@link WEB_STARTUP_SERVICE} from one ordinary Cordis plugin. A TUI-only
 * profile mounts the same provider; the Web values stay unused there.
 * @module dsh-tui/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-web-startup'

/** Services required before parsing. */
export const inject = ['cmdlineArgs']

/** Service name provided by this plugin and consumed by the runtime row. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** Service name consumed by the Web bundle rows. */
export const WEB_STARTUP_SERVICE = 'webStartup'

/** What the runtime row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Optional session id to resume; absent means create a fresh session. */
  resumeSessionId?: string
}

/** What the Web rows read from {@link WEB_STARTUP_SERVICE}. */
export interface WebStartupValues {
  /** `--host`, absent when the invocation did not name one. */
  host?: string
  /** `--port`, absent when the invocation did not name one. */
  port?: number
  /** Explicit `--trusted-host` authorities, in argument order. */
  trustedHosts: string[]
}

interface CombinedOptions {
  resume?: string
  host?: string
  port?: string
  trustedHost?: string[]
}

/** Build a fresh commander program; tests reuse it for independent parses. */
export function combinedCommand(): Command {
  return new Command()
    .name('dsh --profile web-tui')
    .description('Run DeepSeek Harness with the Ratatui terminal and browser surfaces on one session.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume <id>', 'resume a previously persisted session id')
    .option('--host <host>', 'web bind host')
    .option('--port <port>', 'web listen port; pass 0 to let the OS pick a free one')
    .option('--trusted-host <authority...>', 'extra authority the /api browser-trust fence accepts (host or host:port; repeatable)')
    .addHelpText('after', `
Examples:
  dsh --profile web-tui                    start a fresh shared session
  dsh --profile web-tui --resume <id>      resume a saved session
  dsh --profile web-tui --port 8080        serve the browser surface on port 8080
`)
}

/**
 * Resolve the Web subset from commander options with the same rejection rules
 * as the shipped Web startup provider, plus an early port-range check so the
 * combined surface reports invalid invocation values before any row mounts.
 */
function webValues(options: CombinedOptions): WebStartupValues {
  if (options.host === '0.0.0.0') {
    throw new Error('--host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network; use 127.0.0.1 instead')
  }
  if (options.port !== undefined && !/^\d+$/.test(options.port)) {
    throw new Error(`--port must be a number, got ${JSON.stringify(options.port)}`)
  }
  if (options.port !== undefined) {
    const port = Number(options.port)
    if (!Number.isSafeInteger(port) || port > 65535) {
      throw new Error(`--port must be between 0 and 65535, got ${options.port}`)
    }
  }
  return {
    ...options.host === undefined ? {} : { host: options.host },
    ...options.port === undefined ? {} : { port: Number(options.port) },
    trustedHosts: options.trustedHost ?? [],
  }
}

/** Parse the command line and publish both immutable surface service values. */
export function apply(ctx: Context): void {
  const program = combinedCommand()
  program.action(() => {
    const options = program.opts<CombinedOptions>()
    let web: WebStartupValues
    try {
      web = webValues(options)
    } catch (error) {
      program.error(error instanceof Error ? error.message : String(error))
      return
    }
    ctx.provide(TUI_STARTUP_SERVICE, options.resume === undefined ? {} : { resumeSessionId: options.resume })
    ctx.provide(WEB_STARTUP_SERVICE, web)
  })
  parseCmdline(ctx, program)
}
