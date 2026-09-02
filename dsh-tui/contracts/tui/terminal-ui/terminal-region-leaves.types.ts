/**
 * Design-only v4 body-region output. Chrome remains an adjacent app-container
 * input and is not mirrored into this contract.
 */

import type { TuiTerminalBoxNode, TuiTerminalTextNode } from './terminal-frame-tree.types.ts'

export interface TuiTerminalTranscriptLeaf extends Omit<TuiTerminalBoxNode, 'key'> {
  readonly key: 'leaf.transcript'
}

export interface TuiTerminalComposerLeaf extends Omit<TuiTerminalBoxNode, 'key'> {
  readonly key: 'leaf.composer'
}

export interface TuiTerminalExecutionLeaf extends Omit<TuiTerminalBoxNode, 'key'> {
  readonly key: 'leaf.execution'
}

export interface TuiTerminalFooterStatusNode extends Omit<TuiTerminalTextNode, 'key'> {
  readonly key: 'footer.status'
}

export interface TuiTerminalFooterMarkerNode extends Omit<TuiTerminalTextNode, 'key'> {
  readonly key: 'footer.marker'
}

export interface TuiTerminalFooterNoticeNode extends Omit<TuiTerminalTextNode, 'key'> {
  readonly key: 'footer.notice'
}

export interface TuiTerminalFooterLeaf extends Omit<TuiTerminalBoxNode, 'key' | 'children'> {
  readonly key: 'leaf.footer'
  readonly children: readonly [TuiTerminalFooterStatusNode, ...(readonly (TuiTerminalFooterNoticeNode | TuiTerminalFooterMarkerNode)[])]
}

export interface TuiTerminalOverlayLeaf extends Omit<TuiTerminalBoxNode, 'key'> {
  readonly key: 'leaf.overlay'
}

export interface TuiTerminalRegionLeaves {
  readonly contract: 'tui.terminal-region-leaves.v1'
  readonly publicationRevision: number
  readonly transcript: TuiTerminalTranscriptLeaf
  readonly execution?: TuiTerminalExecutionLeaf
  readonly composer: TuiTerminalComposerLeaf
  readonly subagentStatusBar?: TuiTerminalBoxNode
  readonly footer: TuiTerminalFooterLeaf
  readonly overlay?: TuiTerminalOverlayLeaf
}
