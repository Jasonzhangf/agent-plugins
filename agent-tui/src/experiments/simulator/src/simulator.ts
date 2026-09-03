import type { TuiFixtureBundle, TuiFixtureCase } from '../../fixture-contract/src/fixture-contract.ts'

export const simulatorServiceName = 'tuiSimulator' as const

export interface SimulatorRenderOptions {
  readonly theme?: 'terminal-light' | 'terminal-dark'
}

export interface SimulatorDocument {
  readonly fixtureId: string
  readonly html: string
  readonly deterministicHash: string
}

export interface TuiSimulator {
  renderFixture(bundle: TuiFixtureBundle, fixtureId: string, options?: SimulatorRenderOptions): SimulatorDocument
  renderAll(bundle: TuiFixtureBundle, options?: SimulatorRenderOptions): ReadonlyArray<SimulatorDocument>
}

export interface SimulatorIndexDocument {
  readonly html: string
  readonly fixtureIds: readonly string[]
  readonly deterministicHash: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function nodeText(node: TuiFixtureCase['node']): string {
  const value = node.value as Readonly<Record<string, unknown>>
  if (typeof value['text'] === 'string') return value['text']
  if (typeof value['message'] === 'string') return value['message']
  if (typeof value['summary'] === 'string') return value['summary']
  if (Array.isArray(value['blocks'])) {
    return value['blocks']
      .map((block) => {
        if (block && typeof block === 'object' && typeof (block as Record<string, unknown>)['text'] === 'string') {
          return (block as Record<string, unknown>)['text'] as string
        }
        return ''
      })
      .filter(text => text.length > 0)
      .join('\n')
  }
  if (typeof value['name'] === 'string' || typeof value['status'] === 'string') {
    const name = typeof value['name'] === 'string' ? value['name'] : node.kind
    const status = typeof value['status'] === 'string' ? value['status'] : 'unknown'
    const input = typeof value['arguments'] === 'string' ? `\n  in: ${value['arguments']}` : ''
    const result = typeof value['result'] === 'string' ? `\n  out: ${value['result']}` : ''
    return `${name} [${status}]${input}${result}`
  }
  if (typeof value['turn'] === 'number' || typeof value['reason'] === 'string') {
    const turn = typeof value['turn'] === 'number' ? String(value['turn']) : '?'
    const reason = typeof value['reason'] === 'string' ? value['reason'] : 'running'
    return `turn ${turn} ${reason}`
  }
  return `[${node.kind}]`
}

function renderCell(caseItem: TuiFixtureCase): string {
  const text = escapeHtml(nodeText(caseItem.node))
  const lifecycle = caseItem.node.lifecycle
  const status = lifecycle === 'streaming' ? 'streaming' : lifecycle === 'settled' ? 'settled' : lifecycle
  return `<article class="cell cell-${escapeHtml(caseItem.componentKind.replaceAll('.', '-'))}" data-fixture-id="${escapeHtml(caseItem.fixtureId)}" data-kind="${escapeHtml(caseItem.componentKind)}" data-revision="${caseItem.node.publicationRevision}" data-lifecycle="${status}">
  <div class="cell-kind">${escapeHtml(caseItem.componentKind)}</div>
  <pre class="cell-text">${text}</pre>
</article>`
}

function fixtureDocument(caseItem: TuiFixtureCase, theme: string): SimulatorDocument {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>agent-tui simulator</title>
<style>
:root { --bg: #f7f5f2; --fg: #1f2328; --border: #c8c4bd; --accent: #2f6f4f; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.simulator { max-width: 1180px; margin: 0 auto; padding: 24px; }
.frame { background: #101418; color: #e8e6e3; border: 1px solid var(--border); padding: 16px; min-height: 12em; }
.status { display: flex; gap: 16px; padding: 10px 2px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.cell { border-left: 3px solid var(--accent); padding: 8px 10px; margin: 8px 0; background: rgba(0,0,0,0.08); }
.cell-kind { font-size: 11px; color: #9bb8a8; text-transform: uppercase; margin-bottom: 4px; }
.cell-text { margin: 0; white-space: pre-wrap; }
.viewport { color: #cdd3d9; }
</style>
</head>
<body>
<main class="simulator">
  <section class="status">
    <span data-testid="fixture-id">fixture: ${escapeHtml(caseItem.fixtureId)}</span>
    <span class="viewport" data-testid="viewport">${caseItem.viewport.columns} x ${caseItem.viewport.rows}</span>
    <span data-testid="theme">${escapeHtml(theme)}</span>
    <span data-testid="revision">revision ${caseItem.node.publicationRevision}</span>
  </section>
  <section class="frame" data-testid="terminal-frame" style="width: min(100%, ${caseItem.viewport.columns * 10}px); min-height: ${caseItem.viewport.rows * 18}px;">
    ${renderCell(caseItem)}
  </section>
</main>
</body>
</html>`
  let hash = 5381
  for (let i = 0; i < html.length; i += 1) {
    hash = ((hash << 5) + hash + html.charCodeAt(i)) | 0
  }
  return {
    fixtureId: caseItem.fixtureId,
    html,
    deterministicHash: (hash >>> 0).toString(16).padStart(8, '0'),
  }
}

export function renderSimulatorIndex(
  bundle: TuiFixtureBundle,
  options: SimulatorRenderOptions = {},
): SimulatorIndexDocument {
  const theme = options.theme ?? 'terminal-dark'
  const documents = renderAll(bundle, options)
  const fixtureIds = documents.map(document => document.fixtureId)
  const frames = documents.map(document => {
    const caseItem = bundle.cases.get(document.fixtureId)
    if (!caseItem) throw new TypeError(`simulator: missing fixture '${document.fixtureId}' during index render`)
    return `<section class="fixture" data-fixture-id="${escapeHtml(document.fixtureId)}">
  <header><strong>${escapeHtml(document.fixtureId)}</strong><span>${caseItem.viewport.columns} x ${caseItem.viewport.rows}</span></header>
  ${renderCell(caseItem)}
</section>`
  }).join('\n')
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>agent-tui simulator</title>
<style>
:root { color-scheme: dark; --bg: #111315; --panel: #1b1e21; --fg: #eceff1; --muted: #9aa4aa; --line: #343a40; --accent: #55c28a; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
main { max-width: 1180px; margin: 0 auto; padding: 24px; }
h1 { margin: 0 0 16px; font-size: 20px; letter-spacing: 0; }
.fixture { border-top: 1px solid var(--line); padding: 16px 0; }
.fixture header { display: flex; justify-content: space-between; color: var(--muted); margin-bottom: 8px; }
.cell { border-left: 3px solid var(--accent); background: var(--panel); padding: 10px 12px; }
.cell-kind { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
.cell-text { margin: 0; color: var(--fg); white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
</head>
<body data-theme="${escapeHtml(theme)}">
<main>
  <h1>agent-tui fixture simulator</h1>
  ${frames}
</main>
</body>
</html>`
  let hash = 5381
  for (let index = 0; index < html.length; index += 1) {
    hash = ((hash << 5) + hash + html.charCodeAt(index)) | 0
  }
  return Object.freeze({
    html,
    fixtureIds: Object.freeze(fixtureIds),
    deterministicHash: (hash >>> 0).toString(16).padStart(8, '0'),
  })
}

export function renderFixture(bundle: TuiFixtureBundle, fixtureId: string, options: SimulatorRenderOptions = {}): SimulatorDocument {
  const caseItem = bundle.cases.get(fixtureId)
  if (!caseItem) {
    throw new TypeError(`simulator: unknown fixture id '${fixtureId}'`)
  }
  return fixtureDocument(caseItem, options.theme ?? 'terminal-dark')
}

export function renderAll(bundle: TuiFixtureBundle, options: SimulatorRenderOptions = {}): ReadonlyArray<SimulatorDocument> {
  return [...bundle.cases.values()].map(caseItem => fixtureDocument(caseItem, options.theme ?? 'terminal-dark'))
}

export const simulator: TuiSimulator = Object.freeze({
  renderFixture,
  renderAll,
})
