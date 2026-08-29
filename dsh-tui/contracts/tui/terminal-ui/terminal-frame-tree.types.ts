/**
 * Design-only v4 contract. Runtime bindings remain pending until the atomic
 * app-container ownership cutover.
 */

/** Scheme A base colors plus tool-card-local blue/green semantic accents. */
export type TuiTerminalTextColor = 'red' | 'white' | 'blue' | 'green'
export type TuiTerminalBackgroundColor = 'black' | 'gray' | 'dark-gray'

export interface TuiTerminalTextStyle {
  readonly bold?: boolean
  readonly dimColor?: boolean
  readonly inverse?: boolean
  readonly color?: TuiTerminalTextColor
  readonly backgroundColor?: TuiTerminalBackgroundColor
}

export interface TuiTerminalBoxStyle {
  readonly flexDirection: 'row' | 'column'
  readonly width?: number
  readonly height?: number
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
