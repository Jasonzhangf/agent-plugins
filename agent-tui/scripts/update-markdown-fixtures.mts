import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tokenizeAssistantMarkdown } from '../src/experiments/presentation/src/markdown.ts'

const root = resolve(import.meta.dirname, '..')
const input = JSON.parse(readFileSync(
  resolve(root, 'contracts/tui/fixtures/markdown/inputs.json'),
  'utf8',
)) as {
  readonly fixtures: readonly { readonly id: string; readonly markdown: string }[]
}

const fixtures = Object.fromEntries(input.fixtures.map(fixture => [fixture.id, {
  settled: tokenizeAssistantMarkdown(fixture.markdown, 'settled'),
  streaming: tokenizeAssistantMarkdown(fixture.markdown, 'streaming'),
}]))

writeFileSync(
  resolve(root, 'contracts/tui/fixtures/markdown/semantic-tokens.json'),
  `${JSON.stringify({ schema_version: 1, status: 'admitted', fixtures }, null, 2)}\n`,
)
