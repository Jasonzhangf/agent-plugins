import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  IncrementalMarkdownTokenizer,
  tokenizeAssistantMarkdown,
} from '../../src/experiments/presentation/src/markdown.ts'
import { officialSemanticFacts, tokenSemanticFacts } from './official-markdown.ts'

const root = resolve(import.meta.dirname, '../..')

interface InputFixture {
  readonly id: string
  readonly markdown: string
  readonly streamingPrefixes?: readonly number[]
}

interface ExpectedFixtures {
  readonly status: 'admitted'
  readonly fixtures: Record<string, {
    readonly settled: readonly string[]
    readonly streaming: readonly string[]
  }>
}

const inputs = JSON.parse(readFileSync(
  resolve(root, 'contracts/tui/fixtures/markdown/inputs.json'),
  'utf8',
)) as { readonly fixtures: readonly InputFixture[] }
const expected = JSON.parse(readFileSync(
  resolve(root, 'contracts/tui/fixtures/markdown/semantic-tokens.json'),
  'utf8',
)) as ExpectedFixtures

test('settled and streaming semantic tokens match the admitted official corpus', () => {
  assert.equal(expected.status, 'admitted')
  assert.deepEqual(Object.keys(expected.fixtures).sort(), inputs.fixtures.map(fixture => fixture.id).sort())
  for (const fixture of inputs.fixtures) {
    const contract = expected.fixtures[fixture.id]
    assert.ok(contract, `missing expected tokens for ${fixture.id}`)
    assert.deepEqual(tokenizeAssistantMarkdown(fixture.markdown, 'settled'), contract.settled, `${fixture.id}: settled`)
    assert.deepEqual(tokenizeAssistantMarkdown(fixture.markdown, 'streaming'), contract.streaming, `${fixture.id}: streaming`)
  }
})

test('semantic facts match pinned official WebUI DOM fixtures', () => {
  for (const fixture of inputs.fixtures) {
    for (const mode of ['settled', 'streaming'] as const) {
      const official = readFileSync(resolve(
        root,
        `contracts/tui/fixtures/markdown/official/${fixture.id}.${mode}.txt`,
      ), 'utf8')
      assert.deepEqual(
        tokenSemanticFacts(tokenizeAssistantMarkdown(fixture.markdown, mode)),
        officialSemanticFacts(official),
        `${fixture.id}: ${mode}`,
      )
    }
  }
})

test('streaming prefixes remain parseable and settle with math enabled', () => {
  const fixture = inputs.fixtures.find(candidate => candidate.id === 'streaming-typical-partial')
  assert.ok(fixture?.streamingPrefixes)
  const tokenizer = new IncrementalMarkdownTokenizer()
  for (const end of fixture.streamingPrefixes) {
    const prefix = fixture.markdown.slice(0, end)
    assert.deepEqual(tokenizer.update(prefix), tokenizeAssistantMarkdown(prefix, 'streaming'))
  }
  assert.deepEqual(tokenizer.settle(fixture.markdown), tokenizeAssistantMarkdown(fixture.markdown, 'settled'))
})

test('incremental freezing remains equivalent to a one-shot streaming parse', () => {
  const paragraphs = Array.from({ length: 10 }, (_, index) => `Paragraph ${index} with **strong** text.`)
  const tokenizer = new IncrementalMarkdownTokenizer()
  let markdown = ''
  for (const paragraph of paragraphs) {
    markdown += `${paragraph}\n\n`
    assert.deepEqual(tokenizer.update(markdown), tokenizeAssistantMarkdown(markdown, 'streaming'))
  }
})

test('normalizes official GFM, CJK, safety, and math semantics', () => {
  assert.deepEqual(tokenizeAssistantMarkdown('**注意：**内容', 'settled'), [
    'paragraph:start',
    'strong:start',
    'text\t注意：',
    'strong:end',
    'text\t内容',
    'paragraph:end',
  ])
  assert.deepEqual(tokenizeAssistantMarkdown('[bad](javascript:alert(1))', 'settled'), [
    'paragraph:start',
    'text\tbad',
    'paragraph:end',
  ])
  assert.deepEqual(tokenizeAssistantMarkdown('[label][ref]\n\n[ref]: https://example.com', 'settled'), [
    'paragraph:start',
    'link:start\thttps://example.com',
    'text\tlabel',
    'link:end',
    'paragraph:end',
  ])
  assert.deepEqual(tokenizeAssistantMarkdown('`a\nb`', 'settled'), [
    'paragraph:start',
    'inline-code\ta b',
    'paragraph:end',
  ])
  assert.deepEqual(tokenizeAssistantMarkdown('Value \\(x\\).', 'streaming'), [
    'paragraph:start',
    'text\tValue (x).',
    'paragraph:end',
  ])
  assert.deepEqual(tokenizeAssistantMarkdown('Value \\(x\\).', 'settled'), [
    'paragraph:start',
    'text\tValue ',
    'math:inline\tx',
    'text\t.',
    'paragraph:end',
  ])
  assert.deepEqual(tokenizeAssistantMarkdown('Broken $\\frac{$', 'settled'), [
    'paragraph:start',
    'text\tBroken ',
    'math:error\t\\frac{',
    'paragraph:end',
  ])
})

test('non-append streaming input resets generation and raw HTML stays inert text', () => {
  const tokenizer = new IncrementalMarkdownTokenizer()
  tokenizer.update('first\n\nsecond\n\nthird')
  const generation = tokenizer.generation
  const tokens = tokenizer.update('<script>boom()</script>')
  assert.equal(tokenizer.generation, generation + 1)
  assert.ok(tokens.some(token => token === 'raw-html\t<script>boom()</script>'))
  assert.ok(tokens.every(token => !token.startsWith('control\t')))
})

test('user-facing literal content has no generic Markdown entry point', () => {
  const source = readFileSync(
    resolve(root, 'src/experiments/presentation/src/presentation.ts'),
    'utf8',
  )
  assert.doesNotMatch(source, /tokenizeAssistantMarkdown\([^)]*user/)
  assert.doesNotMatch(source, /tokenizeAssistantMarkdown\([^)]*context/)
  assert.doesNotMatch(source, /tokenizeAssistantMarkdown\([^)]*steering/)
})
