#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const valueFor = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}
const has = name => args.includes(name)
const left = valueFor('--left', 'dsh-codex:0')
const right = valueFor('--right', 'dsh-tui:0')
const label = valueFor('--label', new Date().toISOString().replaceAll(':', '-'))
const outDir = resolve(root, valueFor('--out', 'docs/evidence/codex-compare'), label)
const intervalMs = Number(valueFor('--interval-ms', '500'))
const durationMs = Number(valueFor('--duration-ms', has('--watch') ? '5000' : '0'))

if (!Number.isInteger(intervalMs) || intervalMs < 100) throw new TypeError('--interval-ms must be an integer >= 100')
if (!Number.isInteger(durationMs) || durationMs < 0) throw new TypeError('--duration-ms must be a non-negative integer')

function tmux(target, format) {
  return execFileSync('tmux', ['display-message', '-p', '-t', target, format], { encoding: 'utf8' }).trim()
}

function capture(target) {
  return execFileSync('tmux', ['capture-pane', '-e', '-p', '-t', target, '-S', '-'], { encoding: 'utf8' })
}

function snapshot(target) {
  return {
    target,
    width: Number(tmux(target, '#{pane_width}')),
    height: Number(tmux(target, '#{pane_height}')),
    cwd: tmux(target, '#{pane_current_path}'),
    command: tmux(target, '#{pane_current_command}'),
    title: tmux(target, '#{pane_title}'),
    text: capture(target),
  }
}

function visibleLines(text) {
  return text.replaceAll(/\x1b\[[0-9;?]*[ -/]*[@-~]/gu, '').split('\n').filter(line => line.trim().length > 0)
}

function diffSummary(leftText, rightText) {
  const leftLines = visibleLines(leftText)
  const rightLines = visibleLines(rightText)
  let commonPrefix = 0
  while (commonPrefix < leftLines.length && commonPrefix < rightLines.length && leftLines[commonPrefix] === rightLines[commonPrefix]) commonPrefix += 1
  return {
    leftLines: leftLines.length,
    rightLines: rightLines.length,
    commonPrefix,
    firstDifference: commonPrefix < Math.max(leftLines.length, rightLines.length) ? commonPrefix + 1 : null,
  }
}

mkdirSync(outDir, { recursive: true })
const startedAt = new Date().toISOString()
const frames = []
const captureFrame = index => {
  const leftSnapshot = snapshot(left)
  const rightSnapshot = snapshot(right)
  const frame = {
    index,
    capturedAt: new Date().toISOString(),
    left: { ...leftSnapshot, file: `frame-${String(index).padStart(4, '0')}-left.txt` },
    right: { ...rightSnapshot, file: `frame-${String(index).padStart(4, '0')}-right.txt` },
    diff: diffSummary(leftSnapshot.text, rightSnapshot.text),
  }
  writeFileSync(resolve(outDir, frame.left.file), leftSnapshot.text, 'utf8')
  writeFileSync(resolve(outDir, frame.right.file), rightSnapshot.text, 'utf8')
  frames.push(frame)
}

captureFrame(0)
const deadline = Date.now() + durationMs
let index = 1
while (Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, intervalMs))
  captureFrame(index)
  index += 1
}

const manifest = {
  contractVersion: '1',
  startedAt,
  completedAt: new Date().toISOString(),
  mode: durationMs > 0 ? 'dynamic' : 'static',
  intervalMs,
  durationMs,
  left,
  right,
  frames: frames.map(({ left: leftFrame, right: rightFrame, ...frame }) => ({
    ...frame,
    left: { ...leftFrame, text: undefined },
    right: { ...rightFrame, text: undefined },
  })),
  geometry: {
    sameWidth: frames.every(frame => frame.left.width === frame.right.width),
    sameHeight: frames.every(frame => frame.left.height === frame.right.height),
    sameCwd: frames.every(frame => frame.left.cwd === frame.right.cwd),
  },
}
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(JSON.stringify(manifest, null, 2))
