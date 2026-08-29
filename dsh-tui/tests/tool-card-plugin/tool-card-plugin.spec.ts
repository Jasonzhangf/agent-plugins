import test from 'node:test'
import assert from 'node:assert/strict'
import { _internal } from '../../playground/experiments/tool-card-plugin/src/tool-card-plugin.ts'

const parser = {
  parse({ text }: { text: string }) { return ['paragraph:start', `text\t${text}`, 'paragraph:end'] },
} as any

test('read cards expose the filename with a blue segment', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-1', kind: 'tool.read', lifecycle: 'settled',
    value: { name: 'read', arguments: '/tmp/app.ts', status: 'completed', callRenderIntent: { kind: 'read' } },
  }, parser)
  assert.equal(card.elementType, 'tool.card')
  assert.equal(card.children?.[1]?.props?.['text'], '/tmp/app.ts')
  assert.equal(card.children?.[1]?.props?.['color'], 'blue')
})

test('canonical read cards do not dump the public file content', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-canonical-read', kind: 'tool.read', lifecycle: 'settled',
    value: { name: 'read', arguments: '{"file_path":"package.json"}', status: 'completed', result: '1: {\\n2: hidden file content' },
  }, parser)
  assert.equal(card.children?.length, 2)
  assert.equal(card.children?.[1]?.props?.['text'], 'package.json')
  assert.doesNotMatch(card.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? '', /hidden file content/)
})

test('structured read results keep only the public filename', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-read-result', kind: 'tool.read', lifecycle: 'settled',
    value: {
      name: 'read', arguments: '{"file_path":"package.json"}', status: 'completed',
      callRenderIntent: { card: 'generic', title: 'Read package.json', kind: 'read', locations: [{ path: 'package.json' }] },
      resultRenderIntent: { card: 'read', path: 'package.json', offset: 4, totalLines: 8, lines: [{ number: 4, text: '"name": "dsh-tui"' }] },
    },
  }, parser)
  assert.equal(card.children?.[1]?.props?.['text'], 'package.json')
  assert.equal(card.children?.[1]?.props?.['color'], 'blue')
  assert.equal(card.children?.length, 2)
})

test('semantic read titles classify code-mode calls and expose the file path', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-code-read', kind: 'tool.generic', lifecycle: 'settled',
    value: {
      name: 'run_code', arguments: JSON.stringify({ code: 'const res = await tools.read({ file_path: "package.json" })' }), status: 'completed',
      callRenderIntent: {
        card: 'generic', title: 'Read package.json contents', kind: 'execute',
        rawInput: 'const res = await tools.read({ file_path: "package.json" })',
      },
    },
  }, parser)
  assert.equal(card.children?.[1]?.props?.['text'], 'package.json')
  assert.equal(card.children?.[1]?.props?.['color'], 'blue')
})

test('shell cards render Ran and red command tokens without status text', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-2', kind: 'tool.terminal', lifecycle: 'settled',
    value: { name: 'shell', arguments: 'pnpm test --watch', status: 'completed', callRenderIntent: { kind: 'shell' } },
  }, parser)
  const text = card.children?.map(child => child.props?.['text']).join('')
  assert.equal(text, '● Ran pnpm test --watch')
  assert.equal(card.children?.[2]?.props?.['color'], 'red')
  assert.equal(card.children?.[4]?.props?.['color'], 'red')
  assert.equal(text.includes('completed'), false)
})

test('code-mode shell cards extract the public shell command and stdout', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-code-shell', kind: 'tool.generic', lifecycle: 'settled',
    value: {
      name: 'run_code', status: 'completed',
      callRenderIntent: {
        card: 'generic', title: 'Run the shell command', kind: 'execute',
        rawInput: 'const result = await tools.bash({ command: "printf SHELL_CARD_OK" });',
      },
      result: '{"kind":"foreground","exitCode":0,"stdout":"SHELL_CARD_OK\\n","stderr":""}',
    },
  }, parser)
  const text = card.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? ''
  assert.equal(text, '● Ran printf SHELL_CARD_OK\nSHELL_CARD_OK\n')
  assert.doesNotMatch(text, /tools\.shell|const result|exitCode|foreground/)
})

test('search and generic cards render semantic labels without dumping raw arguments', () => {
  const search = _internal.projectCard({
    nodeId: 'tool-search', kind: 'tool.search', lifecycle: 'settled',
    value: { name: 'search', arguments: 'publish|relay|updates', status: 'completed', callRenderIntent: { kind: 'search' } },
  }, parser)
  assert.equal(search.children?.map(child => child.props?.['text']).join(''), '● Search publish|relay|updates')
  assert.equal(search.children?.[1]?.props?.['color'], 'white')
  assert.equal(search.children?.[2]?.props?.['color'], 'blue')

  const called = _internal.projectCard({
    nodeId: 'tool-called', kind: 'tool.generic', lifecycle: 'settled',
    value: { name: 'agy-review.review_start', arguments: '{"repo":"/private","metadata":"hidden"}', status: 'completed' },
  }, parser)
  assert.equal(called.children?.map(child => child.props?.['text']).join(''), '● Called agy-review.review_start')
  assert.doesNotMatch(called.children?.map(child => String(child.props?.['text'])).join('') ?? '', /metadata|private/)
})

test('failed cards use the red status point and preserve plain error text', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-3', kind: 'tool.generic', lifecycle: 'failed',
    value: { name: 'write', arguments: 'app.ts', status: 'failed', error: 'permission denied' },
  }, parser)
  assert.equal(card.children?.[0]?.props?.['color'], 'red')
  assert.equal(card.children?.at(-1)?.props?.['text'], '\npermission denied')
})

test('textual tool output is parsed by the shared Markdown owner', () => {
  let calls = 0
  const markdownParser = {
    parse({ text }: { text: string }) {
      calls += 1
      return ['paragraph:start', 'strong:start', `text\t${text}`, 'strong:end', 'paragraph:end']
    },
  } as any
  const card = _internal.projectCard({
    nodeId: 'tool-markdown', kind: 'tool.generic', lifecycle: 'settled',
    value: { name: 'inspect', status: 'completed', result: 'result' },
  }, markdownParser)
  assert.equal(calls, 1)
  assert.equal(card.children?.at(-1)?.props?.['text'], '\nresult')
  assert.equal(card.children?.at(-1)?.props?.['bold'], true)
})

test('diff cards expose filename and colored numbered lines', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-4', kind: 'tool.diff', lifecycle: 'settled',
    value: { name: 'edit', arguments: 'app.ts', status: 'completed', result: '-old\n+new' },
  }, parser)
  assert.equal(card.children?.[1]?.props?.['color'], 'blue')
  assert.equal(card.children?.[2]?.props?.['color'], 'red')
  assert.equal(card.children?.[3]?.props?.['color'], 'green')
  assert.match(String(card.children?.[2]?.props?.['text']), /1 │ -old/)
})

test('structured diff results render one white context line around colored changes', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-structured-diff', kind: 'tool.diff', lifecycle: 'settled',
    value: {
      name: 'edit', arguments: '{"file_path":"app.ts"}', status: 'completed',
      resultRenderIntent: { card: 'diff', title: 'Edit app.ts', diffs: [{ path: 'app.ts', oldText: 'before\nold\nafter', newText: 'before\nnew\nafter' }] },
    },
  }, parser)
  const lines = card.children?.slice(2).map(child => String(child.props?.['text'])) ?? []
  assert.deepEqual(lines, ['\n   1 │  before', '\n   2 │ -old', '\n   2 │ +new', '\n   3 │  after'])
  assert.equal(card.children?.[2]?.props?.['color'], 'white')
  assert.equal(card.children?.[3]?.props?.['color'], 'red')
  assert.equal(card.children?.[4]?.props?.['color'], 'green')
})

test('code-mode edit results derive a diff from public call arguments and result content', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-code-edit', kind: 'tool.generic', lifecycle: 'settled',
    value: {
      name: 'run_code', status: 'completed',
      callRenderIntent: {
        card: 'generic', title: 'Replace before-line with after-line', kind: 'execute',
        rawInput: 'const result = await tools.edit({ file_path: "/tmp/target.txt", old_string: "before-line", new_string: "after-line" })',
      },
      result: '{"path":"/tmp/target.txt","before":"before-line\\nsecond-line\\n","after":"after-line\\nsecond-line\\n"}',
    },
  }, parser)
  const lines = card.children?.slice(2).map(child => String(child.props?.['text'])) ?? []
  assert.deepEqual(lines, [
    '\n   1 │ -before-line',
    '\n   1 │ +after-line',
    '\n   2 │  second-line',
  ])
  assert.equal(card.children?.[1]?.props?.['text'], '/tmp/target.txt')
  assert.equal(card.children?.[1]?.props?.['color'], 'blue')
  assert.equal(card.children?.[2]?.props?.['color'], 'red')
  assert.equal(card.children?.[3]?.props?.['color'], 'green')
})

test('structured search results render paths and matches without raw arguments', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-structured-search', kind: 'tool.search', lifecycle: 'settled',
    value: {
      name: 'grep', arguments: '{"pattern":"secret","path":"private"}', status: 'completed',
      resultRenderIntent: { card: 'search', shape: 'matches', title: 'Search secret', truncated: false, total: 1, files: [{ path: 'app.ts', matches: [{ lineNumber: 7, line: 'const value = 1' }] }] },
    },
  }, parser)
  const text = card.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? ''
  assert.match(text, /Search secret/)
  assert.match(text, /app\.ts/)
  assert.match(text, /7: const value = 1/)
  assert.doesNotMatch(text, /secret.*private/)
})

test('search result JSON is parsed into paths and numbered matches instead of raw code', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-search-json', kind: 'tool.generic', lifecycle: 'settled',
    value: {
      name: 'run_code', status: 'completed',
      callRenderIntent: { card: 'generic', title: 'Search for doctor command references', kind: 'execute' },
      result: '[{"path":"packages/app.ts","lineNumber":203,"line":"const doctored = new SyntaxError(\\"boom\\")"}]',
    },
  }, parser)
  const text = card.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? ''
  assert.match(text, /Search for doctor command references/)
  assert.match(text, /packages\/app\.ts/)
  assert.match(text, /203: const doctored/)
  assert.doesNotMatch(text, /lineNumber|SyntaxError.*boom.*path/)
})

test('diff cards keep at most one context line around changes', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-5', kind: 'tool.diff', lifecycle: 'settled',
    value: { name: 'edit', arguments: 'app.ts', status: 'completed', result: ' one\n two\n-three\n+four\n five\n six\n seven' },
  }, parser)
  const lines = card.children?.slice(2).map(child => String(child.props?.['text'])) ?? []
  assert.deepEqual(lines, ['\n   2 │  two', '\n   3 │ -three', '\n   3 │ +four', '\n   4 │  five'])
})
