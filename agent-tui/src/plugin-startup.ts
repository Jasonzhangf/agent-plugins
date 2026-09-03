import type { Context } from '@deepseek-ai/cordis'
import {
  exitCodeForTuiStartupOutcome,
  type TuiStartupOutcome,
  startTui,
  type TuiStartupOptions,
} from './experiments/startup/src/startup.ts'

export const name = 'agent-tui-startup'
export const inject = ['cmdlineArgs']

function parseArgs(args: readonly string[]): TuiStartupOptions {
  const options: TuiStartupOptions = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--endpoint' || arg === '--resume' || arg === '--cwd') {
      const value = args[index + 1]
      if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`)
      index += 1
      if (arg === '--endpoint') options.endpoint = value
      else if (arg === '--resume') options.resumeSessionId = value
      else options.cwd = value
      continue
    }
    if (arg === '--continue') {
      options.continueSession = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      throw new TuiUsageExit(0)
    }
    throw new Error(`unknown agent-tui option '${arg}'`)
  }
  return options
}

class TuiUsageExit extends Error {
  constructor(readonly code: number) {
    super(`agent-tui options: --endpoint <origin> --resume <sessionId> --cwd <path>`)
    this.name = 'TuiUsageExit'
  }
}

export function pluginExitForTuiStartupOutcome(
  ctx: Context,
  outcome: TuiStartupOutcome,
): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('agent-tui-startup requires ctx.appExit')
  if (outcome.state === 'failed') {
    process.stderr.write(`agent-tui: terminal lifecycle failed: ${outcome.error.message}\n`)
  }
  exit(exitCodeForTuiStartupOutcome(outcome))
}

export function apply(ctx: Context): void {
  const args = ctx.get('cmdlineArgs')?.get() ?? []
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('agent-tui-startup requires ctx.appExit')
  let options: TuiStartupOptions
  try {
    options = parseArgs(args)
  } catch (error) {
    if (error instanceof TuiUsageExit) {
      process.stdout.write(`${error.message}\n`)
      exit(error.code)
      return
    }
    process.stderr.write(`agent-tui: ${error instanceof Error ? error.message : String(error)}\n`)
    exit(2)
    return
  }
  void startTui(options).then(runtime => {
    void runtime.exited.then(outcome => pluginExitForTuiStartupOutcome(ctx, outcome))
    ctx.effect(() => () => runtime.dispose(), 'agent-tui-startup.runtime')
  }, error => {
    process.stderr.write(`agent-tui: startup failed: ${error instanceof Error ? error.message : String(error)}\n`)
    exit(1)
  })
}
