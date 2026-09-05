import test from 'node:test'
import assert from 'node:assert/strict'
import { _internal } from '../../src/experiments/tool-card-plugin/src/tool-card-plugin.ts'

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
      resultRenderIntent: { card: 'read', path: 'package.json', offset: 4, totalLines: 8, lines: [{ number: 4, text: '"name": "agent-tui"' }] },
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

test('native OpenCode bash cards render the semantic command while running', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-opencode-bash', kind: 'tool.terminal', lifecycle: 'streaming',
    value: {
      name: 'bash', arguments: JSON.stringify({ command: 'printf TOOL_OK' }), status: 'running',
      title: 'Run printf TOOL_OK',
    },
  }, parser)
  assert.equal(card.children?.map(child => String(child.props?.['text'] ?? '')).join(''), '● Ran printf TOOL_OK')
  assert.equal(card.children?.[0]?.props?.['color'], 'tool')
})

test('completed native OpenCode bash cards expose a short public result summary', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-opencode-bash-result', kind: 'tool.terminal', lifecycle: 'settled',
    value: {
      name: 'bash', arguments: JSON.stringify({ command: 'printf TOOL_OK' }), status: 'completed', result: 'TOOL_OK',
    },
  }, parser)
  const text = card.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? ''
  assert.equal(text, '● Ran printf TOOL_OK\n  TOOL_OK')
})

test('code-mode shell cards expose the public command and short stdout', () => {
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
  assert.equal(text, '● Ran printf SHELL_CARD_OK\n  SHELL_CARD_OK')
  assert.doesNotMatch(text, /tools\.shell|const result|exitCode|foreground/)
})

test('shell cards keep printf escapes on one semantic command row', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-printf', kind: 'tool.terminal', lifecycle: 'settled',
    value: { name: 'shell', arguments: "printf '\n STATUS\n'", status: 'completed' },
  }, parser)
  const text = card.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? ''
  assert.equal(text, "● Ran printf '\\n STATUS\\n'")
  assert.equal(text.includes('\n'), false)
})

test('plain shell cards never flood git or package-manager output', () => {
  const git = _internal.projectCard({
    nodeId: 'tool-git-output', kind: 'tool.terminal', lifecycle: 'settled',
    value: { name: 'shell', arguments: 'git status --short', status: 'completed', result: ' M one.ts\n M two.ts\n M three.ts' },
  }, parser)
  const npm = _internal.projectCard({
    nodeId: 'tool-npm-output', kind: 'tool.terminal', lifecycle: 'settled',
    value: { name: 'shell', arguments: 'npm test -- --runInBand', status: 'failed', result: 'thousands of test lines', error: 'internal runner dump' },
  }, parser)
  const gitText = git.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? ''
  const npmText = npm.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? ''
  assert.equal(gitText, '● Ran git status --short')
  assert.equal(npmText, '● Ran npm test -- --runInBand')
  assert.doesNotMatch(`${gitText}${npmText}`, /one\.ts|thousands|runner dump/)
})

test('search and generic cards render semantic labels without dumping raw arguments', () => {
  const search = _internal.projectCard({
    nodeId: 'tool-search', kind: 'tool.search', lifecycle: 'settled',
    value: { name: 'search', arguments: 'publish|relay|updates', status: 'completed', callRenderIntent: { kind: 'search' } },
  }, parser)
  assert.equal(search.children?.map(child => child.props?.['text']).join(''), '● Search publish|relay|updates')
  assert.equal(search.children?.[1]?.props?.['color'], 'tool')
  assert.equal(search.children?.[2]?.props?.['color'], 'blue')

  const called = _internal.projectCard({
    nodeId: 'tool-called', kind: 'tool.generic', lifecycle: 'settled',
    value: { name: 'agy-review.review_start', arguments: '{"repo":"/private","metadata":"hidden"}', status: 'completed' },
  }, parser)
  assert.equal(called.children?.map(child => child.props?.['text']).join(''), '● Called agy-review.review_start')
  assert.doesNotMatch(called.children?.map(child => String(child.props?.['text'])).join('') ?? '', /metadata|private/)
})

test('skill cards parse the public requested skill name and keep it separate from the label', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-skill', kind: 'tool.skill', lifecycle: 'settled',
    value: { name: 'skill', arguments: '{"name":"dsh-manage-issues"}', status: 'completed' },
  }, parser)
  assert.deepEqual(card.children?.map(child => child.props?.['text']), ['● ', 'Called skill', ' dsh-manage-issues'])
  assert.equal(card.children?.[2]?.props?.['color'], 'blue')
  assert.doesNotMatch(card.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? '', /arguments|metadata/)
})

test('skill cards recover a truncated public name without exposing the raw argument record', () => {
  assert.equal(_internal.skillName('{"name":"dsh-architecture-review'), 'dsh-architecture-review')
})

test('grep and glob cards project their public query without JSON field names', () => {
  const grep = _internal.projectCard({
    nodeId: 'tool-grep-arguments', kind: 'tool.search', lifecycle: 'settled',
    value: {
      name: 'grep',
      arguments: '{"path":"/Volumes/extension/code/dsh","include":"*.ts","pattern":"TODO|FIXME"}',
      status: 'completed',
    },
  }, parser)
  const grepText = grep.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? ''
  assert.equal(grepText, '● Search TODO|FIXME')
  assert.doesNotMatch(grepText, /"path"|"include"|"pattern"|Volumes/)

  const glob = _internal.projectCard({
    nodeId: 'tool-glob-arguments', kind: 'tool.search', lifecycle: 'settled',
    value: {
      name: 'glob',
      arguments: '{"path":"packages","pattern":"**/*.ts"}',
      status: 'completed',
    },
  }, parser)
  const globText = glob.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? ''
  assert.equal(globText, '● Search **/*.ts')
  assert.doesNotMatch(globText, /"path"|"pattern"|packages/)
})

test('background job controls use public semantic labels without raw control output', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-job-output', kind: 'tool.generic', lifecycle: 'settled',
    value: {
      name: 'job_output',
      arguments: '{"job_id":"bash-15","wait":true}',
      status: 'completed',
      result: 'POLL 1: {"jsonrpc":"2.0","id":5,"result":{"taskId":"review-1","status":"running","statusPath":"/tmp/review/status.json"}}',
    },
  }, parser)
  const visible = card.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? ''
  assert.equal(visible, '● Checked background output')
  assert.doesNotMatch(visible, /job_output|job_id|jsonrpc|taskId|status\.json|bash-15/)
})

test('failed cards use the red status point without exposing raw errors', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-3', kind: 'tool.generic', lifecycle: 'failed',
    value: { name: 'write', arguments: 'app.ts', status: 'failed', error: 'permission denied' },
  }, parser)
  assert.equal(card.children?.[0]?.props?.['color'], 'red')
  assert.equal(card.children?.map(child => child.props?.['text']).join(''), '● Called write')
  assert.doesNotMatch(card.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? '', /permission denied/)
})

test('generic textual tool output is denied before reaching the Markdown parser', () => {
  let calls = 0
  const markdownParser = {
    parse({ text }: { text: string }) {
      calls += 1
      return ['paragraph:start', 'strong:start', `text\t${text}`, 'strong:end', 'paragraph:end']
    },
  } as any
  const card = _internal.projectCard({
    nodeId: 'tool-markdown', kind: 'tool.generic', lifecycle: 'settled',
    value: { name: 'inspect', status: 'completed', result: '**result** with metadata and code' },
  }, markdownParser)
  assert.equal(calls, 0)
  assert.equal(card.children?.map(child => child.props?.['text']).join(''), '● Called inspect')
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

test('direct edit dispatch arguments render a filename and colored diff', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-direct-edit', kind: 'tool.diff', lifecycle: 'settled',
    value: {
      name: 'edit', status: 'completed',
      arguments: JSON.stringify({
        file_path: 'app.ts',
        old_string: 'before\nold\nafter',
        new_string: 'before\nnew\nafter',
      }),
      result: 'updated successfully',
    },
  }, parser)
  assert.equal(card.children?.[1]?.props?.['text'], 'app.ts')
  assert.deepEqual(card.children?.slice(2).map(child => [child.props?.['text'], child.props?.['color']]), [
    ['\n   1 │  before', 'white'],
    ['\n   2 │ -old', 'red'],
    ['\n   2 │ +new', 'green'],
    ['\n   3 │  after', 'white'],
  ])
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

test('unstructured search output is suppressed instead of rendered as code', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-search-unstructured', kind: 'tool.search', lifecycle: 'settled',
    value: {
      name: 'grep', arguments: '{"pattern":"needle","path":"src"}', status: 'completed',
      result: '{"metadata":{"query":"needle"},"stdout":"src/app.ts:7:needle","context":"private"}',
    },
  }, parser)
  const visible = card.children?.map(child => String(child.props?.['text'] ?? '')).join('') ?? ''
  assert.equal(visible, '● Search needle')
  assert.doesNotMatch(visible, /metadata|stdout|context|app\.ts/)
})

test('diff cards keep at most one context line around changes', () => {
  const card = _internal.projectCard({
    nodeId: 'tool-5', kind: 'tool.diff', lifecycle: 'settled',
    value: { name: 'edit', arguments: 'app.ts', status: 'completed', result: ' one\n two\n-three\n+four\n five\n six\n seven' },
  }, parser)
  const lines = card.children?.slice(2).map(child => String(child.props?.['text'])) ?? []
  assert.deepEqual(lines, ['\n   2 │  two', '\n   3 │ -three', '\n   3 │ +four', '\n   4 │  five'])
})
