/**
 * Design-only v4 contract. Runtime bindings remain pending until the atomic
 * app-container ownership cutover.
 */

/** Scheme A base colors plus bounded tool-card and connection-lamp accents. */
export type TuiTerminalTextColor = 'red' | 'white' | 'tool' | 'thinking' | 'blue' | 'green' | 'yellow'
export type TuiTerminalBackgroundColor = 'black' | 'gray' | 'dark-gray'

export interface TuiTerminalTextStyle {
  readonly bold?: boolean
  readonly italic?: boolean
  readonly dimColor?: boolean
  readonly inverse?: boolean
  readonly color?: TuiTerminalTextColor
  readonly backgroundColor?: TuiTerminalBackgroundColor
}

export interface TuiTerminalBoxStyle {
  readonly flexDirection: 'row' | 'column'
  readonly width?: number
  readonly height?: number
  readonly minHeight?: number
  readonly flexGrow?: number
  readonly flexShrink?: number
  readonly overflow?: 'hidden'
  readonly borderStyle?: 'round'
  readonly borderColor?: TuiTerminalTextColor
  readonly backgroundColor?: TuiTerminalBackgroundColor
  readonly paddingX?: number
}

export interface TuiTerminalTextNode {
  readonly kind: 'text'
  readonly key: string
  readonly text: string
  readonly style: TuiTerminalTextStyle
}

export interface TuiTerminalBoxNode {
  readonly kind: 'box'
  readonly key: string
  readonly style: TuiTerminalBoxStyle
  readonly children: ReadonlyArray<TuiTerminalPrimitiveNode>
}

export type TuiTerminalPrimitiveNode = TuiTerminalBoxNode | TuiTerminalTextNode

export interface TuiTerminalFrameTree {
  readonly contract: 'tui.terminal-frame-tree.v1'
  readonly publicationRevision: number
  readonly root: TuiTerminalBoxNode
}
