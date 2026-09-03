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
const right = valueFor('--right', 'agent-tui:0')
const label = valueFor('--label', new Date().toISOString().replaceAll(':', '-'))
const outDir = resolve(root, valueFor('--out', 'docs/evidence/codex-compare'), label)
const intervalMs = Number(valueFor('--interval-ms', '500'))
const durationMs = Number(valueFor('--duration-ms', has('--watch') ? '5000' : '0'))
const scrollbackLines = Number(valueFor('--scrollback-lines', '0'))

if (!Number.isInteger(intervalMs) || intervalMs < 100) throw new TypeError('--interval-ms must be an integer >= 100')
if (!Number.isInteger(durationMs) || durationMs < 0) throw new TypeError('--duration-ms must be a non-negative integer')
if (!Number.isInteger(scrollbackLines) || scrollbackLines < 0) throw new TypeError('--scrollback-lines must be a non-negative integer')

function tmux(target, format) {
  return execFileSync('tmux', ['display-message', '-p', '-t', target, format], { encoding: 'utf8' }).trim()
}

function capture(target, start = null, end = null) {
  const command = ['capture-pane', '-e', '-p', '-t', target]
  if (start !== null) command.push('-S', String(start))
  if (end !== null) command.push('-E', String(end))
  return execFileSync('tmux', command, { encoding: 'utf8' })
}

function snapshot(target) {
  const height = Number(tmux(target, '#{pane_height}'))
  const scrollPosition = Number(tmux(target, '#{scroll_position}'))
  const inCopyMode = tmux(target, '#{pane_in_mode}') === '1'
  const visibleStart = inCopyMode && scrollPosition > 0 ? -scrollPosition : null
  const visibleEnd = visibleStart === null ? null : visibleStart + height - 1
  return {
    target,
    width: Number(tmux(target, '#{pane_width}')),
    height,
    terminal: {
      historySize: Number(tmux(target, '#{history_size}')),
      scrollPosition,
      inCopyMode,
      viewSource: visibleStart === null ? 'terminal-tail' : 'terminal-scrollback',
      visibleStart,
      visibleEnd,
    },
    cwd: tmux(target, '#{pane_current_path}'),
    command: tmux(target, '#{pane_current_command}'),
    title: tmux(target, '#{pane_title}'),
    text: capture(target, visibleStart, visibleEnd),
    scrollbackText: scrollbackLines > 0 ? capture(target, -Math.max(height, scrollbackLines)) : null,
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
  // Transcript user echoes contain text after `›`; only a bare prompt is the composer.
  // Codex uses `›`, agent-tui uses `>`.
  const rawLines = text.split('\n')
  // A transcript user turn can also begin with `›`/`>`.  The composer is the
  // bottom-anchored prompt, so select the last prompt-shaped line instead of
  // treating the first transcript prompt as the composer.
  const composerLine = lines.findLastIndex((line, index) => (
    /^\s*[›>]\s*$/u.test(line)
    || /^\s*>\s/u.test(line)
    || (/^\s*›\s/u.test(line) && /Ask Codex to do anything/u.test(line))
    || (/^\s*›\s/u.test(line) && /48;2;49;52;57m/u.test(rawLines[index] ?? ''))
  ))
  const executionLine = lines.findIndex(line => /(?:Execution\s+|Running\s+·)/u.test(line))
  const overlayLine = lines.findIndex((line, index) => index < composerLine && /(?:↑↓.*(?:choose|select)|Up\/Down\s+(?:move|choose)|Enter\s+(?:apply|select|resume)|Esc\s+(?:close|cancel)|^\s+\/[a-z][\w-]+\s+\S|·\s+inactive|^\s*›\s+(?:Current|Recent)\s+·)/u.test(line))
  const footerPattern = /(?:model:|directory:|\[connected\]|goal:|\/Volumes\/|\/Users\/|\.\.\.\/[^\n]*\/)/u
  const footerIndex = lines.findLastIndex((line, index) => index > composerLine && footerPattern.test(line))
  const toolCardLabels = lines
    .map(line => /^\s*●\s+(.+?)\s*$/u.exec(line)?.[1] ?? null)
    .filter((label) => label !== null)
  const transcriptLine = lines.findIndex((line, index) => (
    line.trim().length > 0
    && index > 4
    && (composerLine === -1 || index < composerLine)
    && (executionLine === -1 || index < executionLine)
    && (footerIndex === -1 || index < footerIndex)
  ))
  const positionRatio = index => index === -1 || lines.length === 0 ? null : Number((index / lines.length).toFixed(4))
  return {
    hasComposer: lines.some(line => /^\s*[›>]\s/u.test(line)),
    hasModelOrEffort: /(?:model:|thinking\s+\w+)/u.test(content),
    hasPath: /(?:directory:|\/Volumes\/|\/Users\/|\.\.\/|@\s+\.\.\.\/)/u.test(content),
    hasRoundDivider: /─{4,}/u.test(content),
    hasToolCardStatus: /(?:Called|Ran|●)/u.test(content),
    toolCardCount: toolCardLabels.length,
    toolCardLabels,
    hasInternalContextLeak: /(?:conversation\.context|metadata|rpcId|route|retry|providerSource)/u.test(content),
    footerLine: footerIndex === -1 ? null : footerIndex + 1,
    layout: {
      lineCount: lines.length,
      composerLine: composerLine === -1 ? null : composerLine + 1,
      executionLine: executionLine === -1 ? null : executionLine + 1,
      overlayLine: overlayLine === -1 ? null : overlayLine + 1,
      footerLine: footerIndex === -1 ? null : footerIndex + 1,
      footerBottomDistance: footerIndex === -1 ? null : lines.length - footerIndex - 1,
      composerRatio: positionRatio(composerLine),
      executionRatio: positionRatio(executionLine),
      overlayRatio: positionRatio(overlayLine),
      footerRatio: positionRatio(footerIndex),
      executionBeforeComposer: executionLine === -1 || composerLine === -1 ? null : executionLine < composerLine,
      overlayBeforeComposer: overlayLine === -1 || composerLine === -1 ? null : overlayLine < composerLine,
      overlayBeforeFooter: overlayLine === -1 || footerIndex === -1 ? null : overlayLine < footerIndex,
      composerBeforeFooter: composerLine === -1 || footerIndex === -1 ? null : composerLine < footerIndex,
      regionOrder: [
        ['header', lines.findIndex(line => line.trim().length > 0)],
        ['transcript', transcriptLine],
        ['execution', executionLine],
        ['overlay', overlayLine],
        ['composer', composerLine],
        ['footer', footerIndex],
      ].filter(([, index]) => index !== -1).sort(([, leftIndex], [, rightIndex]) => leftIndex - rightIndex).map(([name]) => name),
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

function terminalComparison(leftSnapshot, rightSnapshot) {
  return {
    left: leftSnapshot.terminal,
    right: rightSnapshot.terminal,
    nativeScrollbackAvailable: {
      left: leftSnapshot.terminal.historySize > 0,
      right: rightSnapshot.terminal.historySize > 0,
    },
    terminalTailObserved: {
      left: leftSnapshot.terminal.inCopyMode === false && leftSnapshot.terminal.scrollPosition === 0,
      right: rightSnapshot.terminal.inCopyMode === false && rightSnapshot.terminal.scrollPosition === 0,
    },
  }
}

function layoutSignature(frame) {
  const layout = frame.diff.surfaces.right.layout
  return JSON.stringify({
    composerLine: layout.composerLine,
    executionLine: layout.executionLine,
    overlayLine: layout.overlayLine,
    footerLine: layout.footerLine,
    executionBeforeComposer: layout.executionBeforeComposer,
    composerBeforeFooter: layout.composerBeforeFooter,
  })
}

function layoutComparison(frame) {
  const left = frame.diff.surfaces.left.layout
  const right = frame.diff.surfaces.right.layout
  const ratioDelta = (key) => left[`${key}Ratio`] === null || right[`${key}Ratio`] === null
    ? null
    : Number((right[`${key}Ratio`] - left[`${key}Ratio`]).toFixed(4))
  return {
    leftRegionOrder: left.regionOrder,
    rightRegionOrder: right.regionOrder,
    sameRegionOrder: JSON.stringify(left.regionOrder) === JSON.stringify(right.regionOrder),
    ratioDelta: {
      composer: ratioDelta('composer'),
      execution: ratioDelta('execution'),
      overlay: ratioDelta('overlay'),
      footer: ratioDelta('footer'),
    },
    footerBottomDistance: { left: left.footerBottomDistance, right: right.footerBottomDistance },
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
  frame.diff.terminalComparison = terminalComparison(leftSnapshot, rightSnapshot)
  frame.diff.layoutComparison = layoutComparison(frame)
  writeFileSync(resolve(outDir, frame.left.file), leftSnapshot.text, 'utf8')
  writeFileSync(resolve(outDir, frame.right.file), rightSnapshot.text, 'utf8')
  if (leftSnapshot.scrollbackText !== null) {
    frame.left.scrollbackFile = `frame-${String(index).padStart(4, '0')}-left-scrollback.txt`
    frame.right.scrollbackFile = `frame-${String(index).padStart(4, '0')}-right-scrollback.txt`
    writeFileSync(resolve(outDir, frame.left.scrollbackFile), leftSnapshot.scrollbackText, 'utf8')
    writeFileSync(resolve(outDir, frame.right.scrollbackFile), rightSnapshot.scrollbackText, 'utf8')
  }
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
  scrollbackLines,
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
    leftInternalContextLeak: frames.some(frame => frame.diff.surfaces.left.hasInternalContextLeak),
    rightInternalContextLeak: frames.some(frame => frame.diff.surfaces.right.hasInternalContextLeak),
    internalContextLeak: frames.some(frame => frame.diff.surfaces.right.hasInternalContextLeak),
    requiredRightSurfaces: ['hasComposer', 'hasModelOrEffort', 'hasPath'],
    rightSurfaceContract: frames.every(frame => {
      const surface = frame.diff.surfaces.right
      if (frame.right.terminal.viewSource === 'terminal-scrollback') return nonEmptyLines(frame.right.text).length > 0 && !surface.hasInternalContextLeak
      return surface.hasComposer && surface.hasModelOrEffort && surface.hasPath && !surface.hasInternalContextLeak
    }),
    rightLayoutContract: frames.every(frame => {
      if (frame.right.terminal.viewSource === 'terminal-scrollback') return true
      const layout = frame.diff.surfaces.right.layout
      return layout.composerBeforeFooter === true
        && layout.footerBottomDistance !== null
        && (layout.overlayLine === null || (layout.overlayBeforeComposer === true && layout.overlayBeforeFooter === true))
    }),
    layoutComparison: frames.map(frame => frame.diff.layoutComparison),
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
  console.error('static comparison failed: agent-tui surface contract is incomplete')
  process.exitCode = 1
}
if (!manifest.staticComparison.rightLayoutContract) {
  console.error('static comparison failed: agent-tui layout contract is incomplete')
  process.exitCode = 1
}
