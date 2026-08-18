import type { Context } from '@deepseek-ai/cordis'
import { startTui, type TuiStartupOptions } from '../playground/experiments/startup/src/startup.ts'

export const name = 'dsh-tui-startup'
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
    if (arg === '--help' || arg === '-h') {
      throw new TuiUsageExit(0)
    }
    throw new Error(`unknown dsh-tui option '${arg}'`)
  }
  return options
}

class TuiUsageExit extends Error {
  constructor(readonly code: number) {
    super(`dsh-tui options: --endpoint <origin> --resume <sessionId> --cwd <path>`)
    this.name = 'TuiUsageExit'
  }
}

export function apply(ctx: Context): void {
  const args = ctx.get('cmdlineArgs')?.get() ?? []
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('dsh-tui-startup requires ctx.appExit')
  let options: TuiStartupOptions
  try {
    options = parseArgs(args)
  } catch (error) {
    if (error instanceof TuiUsageExit) {
      process.stdout.write(`${error.message}\n`)
      exit(error.code)
      return
    }
    process.stderr.write(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`)
    exit(2)
    return
  }
  void startTui(options).then(runtime => {
    void runtime.exited.then(() => exit(0))
    ctx.effect(() => () => runtime.dispose(), 'dsh-tui-startup.runtime')
  }, error => {
    process.stderr.write(`dsh-tui: startup failed: ${error instanceof Error ? error.message : String(error)}\n`)
    exit(1)
  })
}
