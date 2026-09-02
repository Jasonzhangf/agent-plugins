#!/usr/bin/env -S node --import tsx
/**
 * dsh-tui CLI entry point.
 *
 * Usage:
 *   dsh-tui [options]
 *   dsh-tui --resume <sessionId> [options]
 *   dsh-tui --continue [options]
 *   dsh-tui --help
 *
 * Options:
 *   --endpoint <url>   DSH HTTP origin (default: http://127.0.0.1:3080)
 *   --resume <id>       Resume an existing session in the current cwd
 *   --continue          Resume the latest non-blank session in the current cwd
 *   --cwd <path>       Canonical cwd for session scoping (default: process.cwd())
 *   --help             Show this help
 *
 * Exit codes:
 *   0  normal exit (Ctrl+C twice within 3s, or /quit)
 *   1  startup error, session error, or terminal error
 *   2  invalid argument
 */

import {
  exitCodeForTuiStartupOutcome,
  type TuiStartupOutcome,
  startTui,
  type TuiStartupOptions,
} from '../playground/experiments/startup/src/startup.ts'

function help(): void {
  process.stdout.write(
`dsh-tui — Codex-style terminal client for Claude Harness

Usage: dsh-tui [options]
       dsh-tui --resume <sessionId> [options]
       dsh-tui --continue [options]
       dsh-tui --help

Options:
  --endpoint <url>   DSH HTTP origin (default: http://127.0.0.1:3080)
  --resume <id>      Resume an existing session in the current cwd
  --continue         Resume the latest non-blank session in the current cwd
  --cwd <path>       Canonical cwd for session scoping (default: process.cwd())
  --harness-projection-file <path>
                     Test-only public presentation node observation file
  --help             Show this help

Exit codes:
  0  normal exit (Ctrl+C twice within 3s, or /quit)
  1  startup error, session error, or terminal error
  2  invalid argument
`,
  )
}

export function cliExitForTuiStartupOutcome(outcome: TuiStartupOutcome): 0 | 1 {
  if (outcome.state === 'failed') {
    process.stderr.write(`error: terminal lifecycle failed: ${outcome.error.message}\n`)
  }
  return exitCodeForTuiStartupOutcome(outcome)
}

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2) // drop node / script name
  const options: TuiStartupOptions = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      help()
      return 0
    }
    if (arg === '--endpoint') {
      const next = args[++i]
      if (!next || next.startsWith('-')) {
        process.stderr.write('error: --endpoint requires a URL\n')
        return 2
      }
      options.endpoint = next
    } else if (arg === '--resume') {
      const next = args[++i]
      if (!next || next.startsWith('-')) {
        process.stderr.write('error: --resume requires a session ID\n')
        return 2
      }
      options.resumeSessionId = next
    } else if (arg === '--continue') {
      options.continueSession = true
    } else if (arg === '--cwd') {
      const next = args[++i]
      if (!next || next.startsWith('-')) {
        process.stderr.write('error: --cwd requires a path\n')
        return 2
      }
      options.cwd = next
    } else if (arg === '--harness-projection-file') {
      const next = args[++i]
      if (!next || next.startsWith('-')) {
        process.stderr.write('error: --harness-projection-file requires a path\n')
        return 2
      }
      options.projectionFile = next
    } else if (arg === '--') {
      // passthrough; stop parsing
      break
    } else if (typeof arg !== "undefined" && arg.startsWith("-")) {
      process.stderr.write(`error: unknown option '${arg}'\n`)
      return 2
    } else {
      process.stderr.write(`error: unexpected argument '${arg}'\n`)
      return 2
    }
  }

  // Node version check
  const [major] = process.version.slice(1).split('.').map(Number)
  if (major !== undefined && major < 22) {
    process.stderr.write(
      `error: dsh-tui requires Node.js >= 22 (detected ${process.version})\n`,
    )
    return 1
  }

  let startup: Awaited<ReturnType<typeof startTui>> | null = null
  try {
    startup = await startTui(options)
  } catch (err) {
    process.stderr.write(
      `error: TUI startup failed: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 1
  }

  // The lifecycle service owns raw mode and alternate screen. Every exit path
  // resolves this promise, including Ctrl+C confirm, signals, render failure, and
  // explicit disposal. Waiting on controller.stop would miss direct lifecycle
  // exits and leave the CLI process alive indefinitely.
  const outcome = await startup.exited

  startup.dispose()
  return cliExitForTuiStartupOutcome(outcome)
}
