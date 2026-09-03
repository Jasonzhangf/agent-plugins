#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const valueFor = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}
const target = valueFor('--target', 'agent-tui:0')
const left = valueFor('--left', 'dsh-codex:0')
const label = valueFor('--label', `scenario-${new Date().toISOString().replaceAll(':', '-')}`)
const scenario = valueFor('--scenario', 'input-slash-ctrlc')
const outDir = resolve(root, valueFor('--out', 'docs/evidence/codex-compare'), label)
const compare = resolve(root, 'scripts/codex-tui-compare.mjs')
const historyIdleTimeoutMs = Number(valueFor('--history-idle-timeout-ms', '120000'))
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms))

if (scenario !== 'input-slash-ctrlc' && scenario !== 'tool-read' && scenario !== 'cancel-running' && scenario !== 'history-layout' && scenario !== 'shell-layout' && scenario !== 'overlay-layout' && scenario !== 'resize-layout') throw new TypeError(`unsupported scenario: ${scenario}`)
if (!Number.isInteger(historyIdleTimeoutMs) || historyIdleTimeoutMs < 1000) throw new TypeError('--history-idle-timeout-ms must be an integer >= 1000')
mkdirSync(outDir, { recursive: true })

function tmux(...command) {
  return execFileSync('tmux', command, { encoding: 'utf8' }).trim()
}

function visiblePane(target) {
  const height = tmux('display-message', '-p', '-t', target, '#{pane_height}')
  return tmux('capture-pane', '-p', '-t', target, '-S', `-${height}`)
}

const overlayPattern = /Up\/Down\s+(?:move|choose)|↑↓.*(?:choose|select)|Enter\s+(?:apply|select|resume)|Esc\s+(?:close|cancel)|·\s+inactive|permission\s+(?:read-only|workspace-write|full-access)|^\s*\/[a-z][\w-]+\s+(?:choose|switch)\b/u

function capture(labelPart, durationMs = 0) {
  const frameLabel = `${label}-${labelPart}`
  execFileSync(process.execPath, [compare, '--left', left, '--right', target, '--label', frameLabel, '--duration-ms', String(durationMs), '--interval-ms', '500', '--scrollback-lines', '200'], { cwd: root, stdio: 'ignore' })
  const manifestPath = resolve(root, 'docs/evidence/codex-compare', frameLabel, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`scenario capture missing manifest: ${frameLabel}`)
  return { label: labelPart, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) }
}

function overlayVisible(expectedCommand = null) {
  const lines = visiblePane(target).replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').split('\n')
  const composerIndex = lines.findIndex(line => /^\s*>\s/u.test(line))
  const overlayLines = lines.slice(0, composerIndex === -1 ? lines.length : composerIndex)
  if (expectedCommand === 'models') return overlayLines.some(line => /^\s*\/models\s+·/u.test(line))
  if (expectedCommand === 'provider') return overlayLines.some(line => /·\s+inactive/u.test(line))
  if (expectedCommand === 'permissions') return overlayLines.some(line => /^\s*\/permissions\s+·/u.test(line))
  if (expectedCommand === 'resume') return overlayLines.some(line => /^\s*[›>]\s+(?:Current|Recent)\s+·/u.test(line))
  return overlayLines.some(line => overlayPattern.test(line))
}

async function waitForOverlay(expectedCommand, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (overlayVisible(expectedCommand)) return
    await sleep(250)
  }
  throw new Error(`${expectedCommand} overlay did not become visible before timeout`)
}

async function waitForOverlayClosed(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!overlayVisible()) return
    await sleep(250)
  }
  throw new Error('overlay remained visible after close input')
}

function rightFrameText(phase) {
  const frame = phase.manifest.frames.at(-1)
  if (!frame?.right?.file) throw new Error(`scenario capture missing right frame: ${phase.label}`)
  const framePath = resolve(root, 'docs/evidence/codex-compare', `${label}-${phase.label}`, frame.right.file)
  return readFileSync(framePath, 'utf8').replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

function rightScrollbackText(phase) {
  const frame = phase.manifest.frames.at(-1)
  if (!frame?.right?.scrollbackFile) throw new Error(`scenario capture missing right scrollback: ${phase.label}`)
  const filePath = resolve(root, 'docs/evidence/codex-compare', `${label}-${phase.label}`, frame.right.scrollbackFile)
  return readFileSync(filePath, 'utf8').replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
}

async function waitForIdle(expectedText, timeoutMs = historyIdleTimeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = visiblePane(target).replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
    const composerIsEmpty = text.split('\n').some(line => /^\s*>\s*$/u.test(line))
    // Idle is represented by the absence of the execution region. The footer
    // intentionally does not expose an internal `[idle]` state token.
    if (text.includes(expectedText) && composerIsEmpty && !/\b(?:Running|Execution)\b/u.test(text)) return
    await sleep(250)
  }
  throw new Error('history scenario did not return to idle before the next input')
}

async function waitForRunning(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = visiblePane(target).replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
    if (/\b(?:Running|Execution)\b/u.test(text)) return
    await sleep(250)
  }
  throw new Error('shell scenario did not enter running state before settlement')
}

tmux('display-message', '-p', '-t', target, '#{pane_pid}')
const phases = []

if (scenario === 'tool-read') {
  tmux('send-keys', '-t', target, 'Please read package.json and tell me its package name.')
  tmux('send-keys', '-t', target, 'Enter')
  await sleep(350)
  const phase = capture('tool-read', 12000)
  const signatures = phase.manifest.dynamicComparison?.rightLayoutSignatures ?? []
  const parsedSignatures = signatures.map(signature => JSON.parse(signature))
  if (!parsedSignatures.some(signature => signature.executionLine !== null)
    || !parsedSignatures.some(signature => signature.executionLine === null)
    || !phase.manifest.staticComparison.rightLayoutContract) {
    throw new Error('tool-read scenario did not observe both running and idle layout contracts')
  }
  phases.push(phase)
} else if (scenario === 'cancel-running') {
  tmux('send-keys', '-t', target, 'Please run a shell command that sleeps for 8 seconds, then report when it finishes.')
  tmux('send-keys', '-t', target, 'Enter')
  await sleep(700)
  const running = capture('cancel-running-before', 1000)
  const runningSignatures = running.manifest.dynamicComparison?.rightLayoutSignatures ?? []
  const runningLayouts = runningSignatures.map(signature => JSON.parse(signature))
  if (!runningLayouts.some(layout => layout.executionLine !== null && layout.executionBeforeComposer === true)) {
    throw new Error('cancel-running scenario did not observe a running execution row before composer')
  }
  phases.push(running)
  tmux('send-keys', '-t', target, 'C-c')
  await sleep(1000)
  const cancelled = capture('cancel-running-after', 1000)
  const cancelledLayout = cancelled.manifest.frames.at(-1)?.diff.surfaces.right.layout
  if (!cancelledLayout || cancelledLayout.executionLine !== null || cancelledLayout.composerBeforeFooter !== true || cancelledLayout.footerBottomDistance === null) {
    throw new Error('cancel-running scenario did not restore idle composer/footer layout after Ctrl+C')
  }
  phases.push(cancelled)
} else if (scenario === 'history-layout') {
  for (const round of ['one', 'two', 'three', 'four', 'five', 'six']) {
    tmux('send-keys', '-t', target, '-l', '--', `Reply with exactly HISTORY_ROUND_${round.toUpperCase()}.`)
    await sleep(350)
    tmux('send-keys', '-t', target, 'Enter')
    await waitForIdle(`HISTORY_ROUND_${round.toUpperCase()}`)
  }
  const settled = capture('history-settled', 1000)
  const settledText = rightFrameText(settled)
  const settledScrollback = rightScrollbackText(settled)
  const dividerCount = (settledScrollback.match(/─{4,}/gu) ?? []).length
  const userRoundCount = (settledScrollback.match(/^[^A-Za-z\n]*Reply with exactly HISTORY_ROUND_/gmu) ?? []).length
  const settledLayout = settled.manifest.frames.at(-1)?.diff.surfaces.right.layout
  if (dividerCount < 6 || userRoundCount < 6 || !settledScrollback.includes('HISTORY_ROUND_ONE')
    || !settledLayout || settledLayout.composerBeforeFooter !== true || settledLayout.footerBottomDistance === null) {
    throw new Error(`history scenario did not preserve six rounds and anchored composer/footer (dividers=${dividerCount}, users=${userRoundCount})`)
  }
  phases.push(settled)
  // Exercise the terminal's native scrollback, not the application's transcript
  // projection. tmux copy-mode is the deterministic PTY equivalent of scrolling
  // the terminal emulator history with a mouse/trackpad.
  tmux('copy-mode', '-u', '-t', target)
  await sleep(500)
  const scrolled = capture('history-terminal-scrolled', 1000)
  const scrolledScrollback = rightScrollbackText(scrolled)
  const scrolledLayout = scrolled.manifest.frames.at(-1)?.diff.surfaces.right.layout
  const scrolledTerminal = scrolled.manifest.frames.at(-1)?.right?.terminal
  if (!scrolledTerminal || scrolledTerminal.inCopyMode !== true || scrolledTerminal.scrollPosition <= 0
    || !scrolledScrollback.includes('HISTORY_ROUND_ONE') || !scrolledLayout) {
    throw new Error('history scenario did not enter native terminal scrollback')
  }
  phases.push(scrolled)
  tmux('send-keys', '-t', target, 'q')
  await sleep(500)
  const returned = capture('history-terminal-tail', 1000)
  const returnedText = rightFrameText(returned)
  const returnedLayout = returned.manifest.frames.at(-1)?.diff.surfaces.right.layout
  const returnedTerminal = returned.manifest.frames.at(-1)?.right?.terminal
  if (!returnedTerminal || returnedTerminal.inCopyMode !== false || returnedTerminal.scrollPosition !== 0
    || !returnedLayout || returnedLayout.composerBeforeFooter !== true || returnedLayout.footerBottomDistance === null
    || returnedText !== settledText) {
    throw new Error('history scenario did not return to the terminal tail after native scrollback')
  }
  phases.push(returned)
} else if (scenario === 'shell-layout') {
  const shellMarker = `SHELL_CARD_${Date.now()}`
  const assistantMarker = `ASSISTANT_DONE_${Date.now()}`
  tmux('send-keys', '-t', target, `Run the shell command \`printf ${shellMarker}\`, then reply with exactly ${assistantMarker}.`)
  tmux('send-keys', '-t', target, 'Enter')
  await waitForRunning()
  await waitForIdle(assistantMarker)
  const settled = capture('shell-settled', 1000)
  const rawText = rightFrameText(settled)
  const visibleText = rawText.replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
  const scrollbackText = rightScrollbackText(settled)
  const scrollbackLines = scrollbackText.split('\n')
  const userLine = scrollbackLines.findIndex(line => line.includes(shellMarker))
  const toolLine = scrollbackLines.findIndex(line => line.includes(`Ran printf ${shellMarker}`))
  const assistantLine = scrollbackLines.findIndex(line => line.trim() === assistantMarker)
  const dividerLine = scrollbackLines.findIndex((line, index) => index > assistantLine && /─{4,}/u.test(line))
  const layout = settled.manifest.frames.at(-1)?.diff.surfaces.right.layout
  if (!visibleText.includes(shellMarker)
    || !scrollbackText.includes(`Ran printf ${shellMarker}`)
    || userLine < 0 || toolLine <= userLine || assistantLine <= toolLine || dividerLine <= assistantLine
    || visibleText.includes('tools.')
    || visibleText.includes('const result')
    || visibleText.includes('exitCode')
    || !layout || layout.executionLine !== null || layout.composerBeforeFooter !== true || layout.footerBottomDistance === null) {
    throw new Error('shell scenario rendered raw code or lost the composer/footer layout contract')
  }
  phases.push(settled)
} else if (scenario === 'resize-layout') {
  const sizes = [{ width: 48, height: 18 }, { width: 60, height: 20 }, { width: 80, height: 24 }]
  try {
    for (const size of sizes) {
      tmux('set-window-option', '-t', target, 'window-size', 'manual')
      tmux('resize-window', '-t', target, '-x', String(size.width), '-y', String(size.height))
      await sleep(700)
      const phase = capture(`resize-${size.width}x${size.height}`, 1000)
      const frame = phase.manifest.frames.at(-1)
      const layout = frame?.diff.surfaces.right.layout
      if (!frame || frame.right.width !== size.width || frame.right.height !== size.height || !phase.manifest.staticComparison.rightLayoutContract || !layout || layout.composerBeforeFooter !== true) {
        throw new Error(`resize ${size.width}x${size.height} did not preserve composer/footer layout`)
      }
      phases.push(phase)
    }
  } finally {
    tmux('set-window-option', '-t', target, 'window-size', 'manual')
    tmux('resize-window', '-t', target, '-x', '80', '-y', '24')
  }
} else if (scenario === 'overlay-layout') {
  const commands = ['models', 'provider', 'permissions', 'resume']
  for (const command of commands) {
    tmux('send-keys', '-t', target, `/${command}`)
    tmux('send-keys', '-t', target, 'Enter')
    await sleep(command === 'resume' ? 2000 : 700)
    await waitForOverlay(command)
    const phase = capture(`overlay-${command}`, 1000)
    const layout = phase.manifest.frames.at(-1)?.diff.surfaces.right.layout
    if (!layout || layout.overlayLine === null || layout.overlayBeforeComposer !== true || layout.overlayBeforeFooter !== true) {
      throw new Error(`${command} overlay did not stay between transcript and composer/footer`)
    }
    if (command === 'resume') {
      const text = rightFrameText(phase)
      if (!/^\s*[›>]\s+(?:Current|Recent)\s+·/mu.test(text) || /session-[0-9a-f-]{8,}/u.test(text)) {
        throw new Error('resume overlay exposed a raw Session ID or omitted the user-readable Session label')
      }
    }
    phases.push(phase)
    tmux('send-keys', '-t', target, 'Escape')
    await sleep(350)
    const closed = capture(`overlay-${command}-closed`)
    const closedLayout = closed.manifest.frames.at(-1)?.diff.surfaces.right.layout
    if (!closedLayout || closedLayout.overlayLine !== null || closedLayout.composerBeforeFooter !== true) {
      throw new Error(`${command} overlay did not close before composer/footer layout capture`)
    }
    phases.push(closed)
  }
} else {
  phases.push(capture('idle'))
  tmux('send-keys', '-t', target, 'abc')
  await sleep(350)
  phases.push(capture('input'))
  tmux('send-keys', '-t', target, 'C-c')
  await sleep(350)
  phases.push(capture('ctrl-c-clear'))
  tmux('send-keys', '-t', target, '/mo')
  await sleep(700)
  const suggestions = capture('slash-suggestions', 1000)
  const suggestionText = rightFrameText(suggestions)
  const suggestionLayout = suggestions.manifest.frames.at(-1)?.diff.surfaces.right.layout
  if (!suggestionText.includes('/models') || !suggestionText.includes('choose a model') || !suggestionLayout || suggestionLayout.overlayLine === null || suggestionLayout.overlayBeforeComposer !== true) {
    throw new Error('slash suggestions did not expose a filtered command list above the composer')
  }
  phases.push(suggestions)
  tmux('send-keys', '-t', target, 'Escape')
  await waitForOverlayClosed()
  const slashAfterEscape = capture('slash-after-escape')
  const slashAfterEscapeText = rightFrameText(slashAfterEscape)
  if (/^\s*\/models\s+choose a model/u.test(slashAfterEscapeText)) {
    throw new Error('slash suggestions remained visible after Escape')
  }
  phases.push(slashAfterEscape)
  tmux('send-keys', '-t', target, 'C-c')
  await sleep(350)
  phases.push(capture('idle-after-slash-clear'))
}

const result = {
  contractVersion: '1',
  scenario,
  left,
  target,
  phases: phases.map(phase => ({
    label: phase.label,
    manifest: `docs/evidence/codex-compare/${label}-${phase.label}/manifest.json`,
    rightLayout: phase.manifest.frames.at(-1)?.diff.surfaces.right.layout ?? null,
    rightLayoutContract: phase.manifest.staticComparison.rightLayoutContract,
  })),
}
writeFileSync(resolve(outDir, 'scenario-manifest.json'), JSON.stringify(result, null, 2) + '\n', 'utf8')
console.log(JSON.stringify(result, null, 2))
