export type TuiChromeRenderPlacement = 'header' | 'execution'

export interface TuiChromeRenderNode {
  readonly key: string
  readonly text: string
  readonly placement: TuiChromeRenderPlacement
  readonly bold?: boolean
  readonly dimColor?: boolean
  /** Scheme A text plus the bounded connection-lamp state accents. */
  readonly color?: 'red' | 'white' | 'green' | 'yellow'
}

const RENDER_NODE_KEYS = Object.freeze([
  'key', 'text', 'placement', 'bold', 'dimColor', 'color',
] as const)

export function assertTuiChromeRenderNodes(
  value: unknown,
): asserts value is ReadonlyArray<TuiChromeRenderNode> {
  if (!Array.isArray(value)) {
    throw new TypeError('terminal-ui: chromeNodes must be an array')
  }
  for (const node of value) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      throw new TypeError('terminal-ui: chrome node must be an object')
    }
    const record = node as Record<string, unknown>
    const ownKeys = Object.keys(record).sort()
    const requiredKeys = ['key', 'placement', 'text']
    if (ownKeys.some(key => !RENDER_NODE_KEYS.includes(key as never))
      || !requiredKeys.every(key => ownKeys.includes(key))) {
      throw new TypeError('terminal-ui: chrome node has an invalid closed contract')
    }
    if (typeof record['key'] !== 'string' || record['key'].length === 0
      || typeof record['text'] !== 'string') {
      throw new TypeError('terminal-ui: chrome node requires key and text')
    }
    if (record['placement'] !== 'header' && record['placement'] !== 'execution') {
      throw new TypeError('terminal-ui: invalid chrome node placement')
    }
    if (record['bold'] !== undefined && typeof record['bold'] !== 'boolean') {
      throw new TypeError('terminal-ui: invalid chrome node emphasis')
    }
    if (record['dimColor'] !== undefined && typeof record['dimColor'] !== 'boolean') {
      throw new TypeError('terminal-ui: invalid chrome node dimming')
    }
    if (record['color'] !== undefined
      && record['color'] !== 'red'
      && record['color'] !== 'white'
      && record['color'] !== 'green'
      && record['color'] !== 'yellow') {
      throw new TypeError('terminal-ui: invalid chrome node color')
    }
  }
}
