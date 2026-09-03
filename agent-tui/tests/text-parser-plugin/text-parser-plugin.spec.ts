import assert from 'node:assert/strict'
import test from 'node:test'
import { tokenizeAssistantMarkdown, IncrementalMarkdownTokenizer } from '../../src/experiments/text-parser-plugin/src/text-parser-plugin.ts'

test('shared parser emits Markdown semantic tokens', () => {
  assert.deepEqual(tokenizeAssistantMarkdown('# title\n\n**body**', 'settled'), [
    'heading:start\t1', 'text\ttitle', 'heading:end\t1',
    'paragraph:start', 'strong:start', 'text\tbody', 'strong:end', 'paragraph:end',
  ])
})

test('incremental parser settles after streaming updates', () => {
  const tokenizer = new IncrementalMarkdownTokenizer()
  tokenizer.update('hello')
  assert.deepEqual(tokenizer.settle('hello **world**'), tokenizeAssistantMarkdown('hello **world**', 'settled'))
})

test('shared parser preserves fenced code as one explicit semantic block', () => {
  assert.deepEqual(tokenizeAssistantMarkdown('before\n\n```ts\nconst value = 1\nreturn value\n```\n\nafter', 'settled'), [
    'paragraph:start', 'text\tbefore', 'paragraph:end',
    'code\tts\tconst value = 1\nreturn value',
    'paragraph:start', 'text\tafter', 'paragraph:end',
  ])
})
