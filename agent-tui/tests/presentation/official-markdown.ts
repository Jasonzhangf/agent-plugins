interface SnapshotText {
  readonly kind: 'text'
  readonly value: string
}

interface SnapshotElement {
  readonly kind: 'element'
  readonly tag: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: SnapshotNode[]
}

type SnapshotNode = SnapshotText | SnapshotElement

interface TokenNode {
  readonly kind: string
  readonly values: readonly string[]
  readonly children: TokenNode[]
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of source.matchAll(/([\w:-]+)=("(?:\\.|[^"])*")/gu)) {
    attributes[match[1] ?? ''] = JSON.parse(match[2] ?? '""') as string
  }
  return attributes
}

export function parseOfficialSnapshot(source: string): SnapshotElement {
  const synthetic: SnapshotElement = { kind: 'element', tag: 'root', attributes: {}, children: [] }
  const stack: { readonly indent: number; readonly element: SnapshotElement }[] = [{ indent: -1, element: synthetic }]
  for (const line of source.split('\n')) {
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    while ((stack.at(-1)?.indent ?? -1) >= indent) stack.pop()
    const parent = stack.at(-1)?.element
    if (!parent) throw new Error(`invalid official Markdown snapshot indentation: ${line}`)
    const content = line.trimStart()
    if (content.startsWith('#text ')) {
      parent.children.push({ kind: 'text', value: JSON.parse(content.slice(6)) as string })
      continue
    }
    const match = content.match(/^<([\w-]+)(.*?)>$/u)
    if (!match) throw new Error(`invalid official Markdown snapshot line: ${line}`)
    const element: SnapshotElement = {
      kind: 'element',
      tag: match[1] ?? '',
      attributes: parseAttributes(match[2] ?? ''),
      children: [],
    }
    parent.children.push(element)
    stack.push({ indent, element })
  }
  const root = synthetic.children[0]
  if (root?.kind !== 'element') throw new Error('official Markdown snapshot has no root element')
  return root
}

function hasClass(node: SnapshotElement, name: string): boolean {
  return (node.attributes.class ?? '').split(' ').includes(name)
}

function descendants(node: SnapshotElement, predicate: (candidate: SnapshotElement) => boolean): SnapshotElement[] {
  const matches: SnapshotElement[] = []
  for (const child of node.children) {
    if (child.kind !== 'element') continue
    if (predicate(child)) matches.push(child)
    matches.push(...descendants(child, predicate))
  }
  return matches
}

function first(node: SnapshotElement, predicate: (candidate: SnapshotElement) => boolean): SnapshotElement | undefined {
  return descendants(node, predicate)[0]
}

function annotation(node: SnapshotElement): string {
  return visibleText(first(node, candidate => candidate.tag === 'annotation'))
}

function visibleText(node: SnapshotNode | undefined): string {
  if (!node) return ''
  if (node.kind === 'text') return node.value
  if (node.tag === 'img') return node.attributes.alt ?? ''
  if (node.tag === 'input') return ''
  if (node.tag === 'span' && hasClass(node, 'katex')) return annotation(node)
  return node.children.map(visibleText).join('')
}

function normalizeText(value: string): string {
  return value.replace(/[\t\r\n ]+/gu, ' ').trim()
}

function snapshotFacts(root: SnapshotElement): string[] {
  const facts: string[] = []
  const visit = (node: SnapshotElement, parents: readonly SnapshotElement[]): void => {
    const parent = parents.at(-1)
    const inCodeBlock = parents.some(candidate => hasClass(candidate, 'md-code-block'))
    const inDisplayMath = parents.some(candidate => hasClass(candidate, 'katex-display'))
    const inFootnotes = parents.some(candidate => candidate.tag === 'section' && hasClass(candidate, 'footnotes'))
    if (/^h[1-6]$/u.test(node.tag) && !hasClass(node, 'sr-only')) {
      facts.push(`heading\t${node.tag.slice(1)}\t${normalizeText(visibleText(node))}`)
    }
    if (node.tag === 'strong' || node.tag === 'em' || node.tag === 'del') {
      facts.push(`${node.tag}\t${normalizeText(visibleText(node))}`)
    }
    if (node.tag === 'blockquote') facts.push(`blockquote\t${normalizeText(visibleText(node))}`)
    if (node.tag === 'br') facts.push('break')
    if (node.tag === 'hr') facts.push('thematic-break')
    if (node.tag === 'a' && parent?.tag === 'code') {
      facts.push(`inline-code-link\t${node.attributes.href ?? ''}`)
    } else if (node.tag === 'a') {
      facts.push(`link\t${node.attributes.href ?? ''}\t${normalizeText(visibleText(node))}`)
    }
    if (node.tag === 'img') facts.push(`image\t${node.attributes.src ?? ''}\t${node.attributes.alt ?? ''}`)
    if (node.tag === 'code' && parent?.tag !== 'pre' && !inCodeBlock
      && !node.children.some(child => child.kind === 'element' && child.tag === 'a')) {
      facts.push(`inline-code\t${normalizeText(visibleText(node))}`)
    }
    if (node.tag === 'div' && hasClass(node, 'md-code-block')) {
      const info = first(node, candidate => (candidate.attributes.class ?? '').includes('_infostring_'))
      const pre = first(node, candidate => candidate.tag === 'pre')
      facts.push(`code\t${normalizeText(visibleText(info))}\t${visibleText(pre)}`)
    } else if (node.tag === 'pre' && !inCodeBlock) {
      facts.push(`code\t\t${visibleText(node)}`)
    }
    if (node.tag === 'span' && hasClass(node, 'katex-display')) {
      facts.push(`math:display\t${annotation(node).trimEnd()}`)
    } else if (node.tag === 'span' && hasClass(node, 'katex-error')) {
      facts.push(`math:error\t${visibleText(node)}`)
    } else if (node.tag === 'span' && hasClass(node, 'katex') && !inDisplayMath) {
      facts.push(`math:inline\t${annotation(node)}`)
    }
    if (!inFootnotes && (node.tag === 'ul' || node.tag === 'ol')) facts.push(`list\t${node.tag === 'ol' ? 'ordered' : 'unordered'}`)
    if (!inFootnotes && node.tag === 'li') {
      const checkbox = node.children.find(child => child.kind === 'element' && child.tag === 'input')
      facts.push(checkbox?.kind === 'element'
        ? `list-item\t${Object.hasOwn(checkbox.attributes, 'checked') ? 'true' : 'false'}`
        : 'list-item\tplain')
    }
    if (node.tag === 'th' || node.tag === 'td') {
      const align = node.attributes.style?.match(/text-align: (left|center|right)/u)?.[1] ?? 'none'
      facts.push(`table-cell\t${node.tag === 'th' ? 'header' : 'body'}\t${align}\t${normalizeText(visibleText(node))}`)
    }
    for (const child of node.children) {
      if (child.kind === 'element') visit(child, [...parents, node])
    }
  }
  visit(root, [])
  return facts
}

function parseTokenTree(tokens: readonly string[]): TokenNode {
  const root: TokenNode = { kind: 'root', values: [], children: [] }
  const stack: TokenNode[] = [root]
  for (const token of tokens) {
    const [kind = '', ...values] = token.split('\t')
    if (kind.endsWith(':end') || ['paragraph:end', 'blockquote:end', 'list:end', 'list-item:end', 'table:end', 'table-row:end', 'table-cell:end', 'footnote:end'].includes(kind)) {
      if (stack.length === 1) throw new Error(`unbalanced Markdown token: ${token}`)
      stack.pop()
      continue
    }
    const node: TokenNode = { kind, values, children: [] }
    stack.at(-1)?.children.push(node)
    if (kind.endsWith(':start') || ['paragraph:start', 'blockquote:start', 'list:start', 'list-item:start', 'table:start', 'table-row:start', 'table-cell:start', 'footnote:start'].includes(kind)) {
      stack.push(node)
    }
  }
  if (stack.length !== 1) throw new Error('unclosed Markdown semantic token')
  return root
}

function tokenText(node: TokenNode): string {
  if (node.kind === 'text' || node.kind === 'inline-code' || node.kind === 'inline-code-link') return node.values[0] ?? ''
  if (node.kind === 'math:inline' || node.kind === 'math:display') return node.values[0] ?? ''
  if (node.kind === 'image') return node.values[1] ?? ''
  return node.children.map(tokenText).join('')
}

function tokenFacts(tokens: readonly string[]): string[] {
  const root = parseTokenTree(tokens)
  const facts: string[] = []
  const visit = (node: TokenNode, parents: readonly TokenNode[]): void => {
    if (node.kind === 'heading:start') facts.push(`heading\t${node.values[0] ?? ''}\t${normalizeText(tokenText(node))}`)
    if (node.kind === 'strong:start') facts.push(`strong\t${normalizeText(tokenText(node))}`)
    if (node.kind === 'emphasis:start') facts.push(`em\t${normalizeText(tokenText(node))}`)
    if (node.kind === 'delete:start') facts.push(`del\t${normalizeText(tokenText(node))}`)
    if (node.kind === 'blockquote:start') facts.push(`blockquote\t${normalizeText(tokenText(node))}`)
    if (node.kind === 'break' || node.kind === 'thematic-break') facts.push(node.kind)
    if (node.kind === 'link:start') facts.push(`link\t${node.values[0] ?? ''}\t${normalizeText(tokenText(node))}`)
    if (node.kind === 'inline-code-link') facts.push(`inline-code-link\t${node.values[0] ?? ''}`)
    if (node.kind === 'image') facts.push(`image\t${node.values[0] ?? ''}\t${node.values[1] ?? ''}`)
    if (node.kind === 'inline-code') facts.push(`inline-code\t${normalizeText(node.values[0] ?? '')}`)
    if (node.kind === 'code') facts.push(`code\t${node.values[0] ?? ''}\t${node.values[1] ?? ''}`)
    if (node.kind === 'math:inline' || node.kind === 'math:display' || node.kind === 'math:error') {
      facts.push(`${node.kind}\t${node.values[0] ?? ''}`)
    }
    if (node.kind === 'list:start') facts.push(`list\t${node.values[0] ?? ''}`)
    if (node.kind === 'list-item:start') facts.push(`list-item\t${node.values[0] ?? ''}`)
    if (node.kind === 'table-cell:start') {
      const row = [...parents].reverse().find(candidate => candidate.kind === 'table-row:start')
      facts.push(`table-cell\t${row?.values[0] ?? ''}\t${node.values[0] ?? ''}\t${normalizeText(tokenText(node))}`)
    }
    for (const child of node.children) visit(child, [...parents, node])
  }
  visit(root, [])
  return facts
}

export function officialSemanticFacts(snapshot: string): readonly string[] {
  return snapshotFacts(parseOfficialSnapshot(snapshot))
}

export function tokenSemanticFacts(tokens: readonly string[]): readonly string[] {
  return tokenFacts(tokens)
}
