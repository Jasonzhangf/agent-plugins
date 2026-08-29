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

const ANSI_SEQUENCE = /\x1b\[[0-9;?]*[ -/]*[@-~]/gu
const ANSI_STYLE_SEQUENCE = /\x1b\[(?:[0-9;]*)m/gu

function plainText(text) {
  return text.replaceAll(ANSI_SEQUENCE, '')
}

function visibleLines(text) {
  const lines = plainText(text).split('\n')
  while (lines.length > 0 && lines.at(-1)?.trim() === '') lines.pop()
  return lines
}

function nonEmptyLines(text) {
  return visibleLines(text).filter(line => line.trim().length > 0)
}

function styleSummary(text) {
  const styles = [...text.matchAll(ANSI_STYLE_SEQUENCE)].map(match => match[0])
  const foreground = styles.filter(style => /(?:3[0-7]|9[0-7]|38;)/u.test(style))
  const background = styles.filter(style => /(?:4[0-7]|10[0-7]|48;)/u.test(style))
  return {
    escapeCount: styles.length,
    foregroundCount: foreground.length,
    backgroundCount: background.length,
    unique: [...new Set(styles)].sort(),
  }
}

function surfaceSummary(text) {
  const lines = visibleLines(text)
  const content = lines.join('\n')
  const composerLine = lines.findIndex(line => /^\s*[›>]\s/u.test(line))
  const executionLine = lines.findIndex(line => /(?:Execution\s+|Running\s+·)/u.test(line))
  const footerIndex = lines.findIndex(line => /(?:model:|directory:|\[connected\]|goal:)/u.test(line))
  const positionRatio = index => index === -1 || lines.length === 0 ? null : Number((index / lines.length).toFixed(4))
  return {
    hasComposer: lines.some(line => /^\s*[›>]\s/u.test(line)),
    hasModelOrEffort: /(?:model:|thinking\s+\w+)/u.test(content),
    hasPath: /(?:directory:|\/Volumes\/|\/Users\/|\.\.\.\/[^\n]*\/)/u.test(content),
    hasRoundDivider: /─{4,}/u.test(content),
    hasToolCardStatus: /(?:Called|Ran|●)/u.test(content),
    hasInternalContextLeak: /(?:conversation\.context|metadata|rpcId|route|retry|providerSource)/u.test(content),
    footerLine: footerIndex === -1 ? null : footerIndex + 1,
    layout: {
      lineCount: lines.length,
      composerLine: composerLine === -1 ? null : composerLine + 1,
      executionLine: executionLine === -1 ? null : executionLine + 1,
      footerLine: footerIndex === -1 ? null : footerIndex + 1,
      footerBottomDistance: footerIndex === -1 ? null : lines.length - footerIndex - 1,
      composerRatio: positionRatio(composerLine),
      executionRatio: positionRatio(executionLine),
      footerRatio: positionRatio(footerIndex),
      executionBeforeComposer: executionLine === -1 || composerLine === -1 ? null : executionLine < composerLine,
      composerBeforeFooter: composerLine === -1 || footerIndex === -1 ? null : composerLine < footerIndex,
    },
  }
}

function diffSummary(leftText, rightText) {
  const leftLines = visibleLines(leftText)
  const rightLines = visibleLines(rightText)
  let commonPrefix = 0
  while (commonPrefix < leftLines.length && commonPrefix < rightLines.length && leftLines[commonPrefix] === rightLines[commonPrefix]) commonPrefix += 1
  return {
    leftLines: leftLines.length,
    rightLines: rightLines.length,
    leftNonEmptyLines: nonEmptyLines(leftText).length,
    rightNonEmptyLines: nonEmptyLines(rightText).length,
    leftBlankLines: leftLines.filter(line => line.length === 0).length,
    rightBlankLines: rightLines.filter(line => line.length === 0).length,
    commonPrefix,
    firstDifference: commonPrefix < Math.max(leftLines.length, rightLines.length) ? commonPrefix + 1 : null,
    sameText: leftLines.join('\n') === rightLines.join('\n'),
    sameLineCount: leftLines.length === rightLines.length,
    sameBlankLineCount: leftLines.filter(line => line.length === 0).length === rightLines.filter(line => line.length === 0).length,
    styles: {
      left: styleSummary(leftText),
      right: styleSummary(rightText),
      same: JSON.stringify(styleSummary(leftText)) === JSON.stringify(styleSummary(rightText)),
    },
    surfaces: {
      left: surfaceSummary(leftText),
      right: surfaceSummary(rightText),
    },
  }
}

function layoutSignature(frame) {
  const layout = frame.diff.surfaces.right.layout
  return JSON.stringify({
    composerLine: layout.composerLine,
    executionLine: layout.executionLine,
    footerLine: layout.footerLine,
    executionBeforeComposer: layout.executionBeforeComposer,
    composerBeforeFooter: layout.composerBeforeFooter,
  })
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
  staticComparison: {
    geometryIgnored: true,
    rawTextEquality: frames.every(frame => frame.diff.sameText),
    rawStyleEquality: frames.every(frame => frame.diff.styles.same),
    rawBlankLineEquality: frames.every(frame => frame.diff.sameBlankLineCount),
    internalContextLeak: frames.some(frame => frame.diff.surfaces.left.hasInternalContextLeak || frame.diff.surfaces.right.hasInternalContextLeak),
    requiredRightSurfaces: ['hasComposer', 'hasModelOrEffort', 'hasPath'],
    rightSurfaceContract: frames.every(frame => {
      const surface = frame.diff.surfaces.right
      return surface.hasComposer && surface.hasModelOrEffort && surface.hasPath && !surface.hasInternalContextLeak
    }),
    rightLayoutContract: frames.every(frame => {
      const layout = frame.diff.surfaces.right.layout
      return layout.composerBeforeFooter === true && layout.footerBottomDistance !== null
    }),
  },
  ...(durationMs > 0 ? {
    dynamicComparison: {
      frameCount: frames.length,
      stableRightLayout: frames.every(frame => layoutSignature(frame) === layoutSignature(frames[0])),
      rightLayoutSignatures: [...new Set(frames.map(layoutSignature))],
    },
  } : {}),
}
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(JSON.stringify(manifest, null, 2))
if (manifest.staticComparison.internalContextLeak) {
  console.error('static comparison failed: internal context/control field detected')
  process.exitCode = 1
}
if (!manifest.staticComparison.rightSurfaceContract) {
  console.error('static comparison failed: dsh-tui surface contract is incomplete')
  process.exitCode = 1
}
if (!manifest.staticComparison.rightLayoutContract) {
  console.error('static comparison failed: dsh-tui layout contract is incomplete')
  process.exitCode = 1
}
