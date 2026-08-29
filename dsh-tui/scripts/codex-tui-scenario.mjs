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
const target = valueFor('--target', 'dsh-tui:0')
const label = valueFor('--label', `scenario-${new Date().toISOString().replaceAll(':', '-')}`)
const scenario = valueFor('--scenario', 'input-slash-ctrlc')
const outDir = resolve(root, valueFor('--out', 'docs/evidence/codex-compare'), label)
const compare = resolve(root, 'scripts/codex-tui-compare.mjs')
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms))

if (scenario !== 'input-slash-ctrlc' && scenario !== 'tool-read' && scenario !== 'overlay-layout') throw new TypeError(`unsupported scenario: ${scenario}`)
mkdirSync(outDir, { recursive: true })

function tmux(...command) {
  return execFileSync('tmux', command, { encoding: 'utf8' }).trim()
}

function capture(labelPart, durationMs = 0) {
  const frameLabel = `${label}-${labelPart}`
  execFileSync(process.execPath, [compare, '--label', frameLabel, '--duration-ms', String(durationMs), '--interval-ms', '500'], { cwd: root, stdio: 'ignore' })
  const manifestPath = resolve(root, 'docs/evidence/codex-compare', frameLabel, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`scenario capture missing manifest: ${frameLabel}`)
  return { label: labelPart, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) }
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
} else if (scenario === 'overlay-layout') {
  const commands = ['models', 'provider', 'permissions']
  for (const command of commands) {
    tmux('send-keys', '-t', target, `/${command}`)
    tmux('send-keys', '-t', target, 'Enter')
    await sleep(700)
    const phase = capture(`overlay-${command}`, 1000)
    const layout = phase.manifest.frames.at(-1)?.diff.surfaces.right.layout
    if (!layout || layout.overlayLine === null || layout.overlayBeforeComposer !== true || layout.overlayBeforeFooter !== true) {
      throw new Error(`${command} overlay did not stay between transcript and composer/footer`)
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
  phases.push(capture('slash-suggestions', 1000))
  tmux('send-keys', '-t', target, 'Escape')
  await sleep(350)
  phases.push(capture('slash-after-escape'))
  tmux('send-keys', '-t', target, 'C-c')
  await sleep(350)
  phases.push(capture('idle-after-slash-clear'))
}

const result = {
  contractVersion: '1',
  scenario,
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
