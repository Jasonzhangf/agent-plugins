/**
 * Design-only v4 app-container contract. The live v2 metadata frame remains
 * current until Phase 2 atomically replaces it.
 */

import type {
  TuiTerminalBoxNode,
  TuiTerminalFrameTree,
  TuiTerminalTextNode,
} from '../terminal-ui/terminal-frame-tree.types.ts'
import type {
  TuiTerminalComposerLeaf,
  TuiTerminalExecutionLeaf,
  TuiTerminalFooterLeaf,
  TuiTerminalOverlayLeaf,
  TuiTerminalTranscriptLeaf,
} from '../terminal-ui/terminal-region-leaves.types.ts'

export type TuiAppChromeSlotNode<Key extends string> = Omit<TuiTerminalTextNode, 'key'> & {
  readonly key: Key
}

export type TuiAppLogoSlot = TuiAppChromeSlotNode<'slot.header.logo'>
export type TuiAppConnectionSlot = TuiAppChromeSlotNode<'slot.header.connection'>
export type TuiAppSessionSlot = TuiAppChromeSlotNode<'slot.header.session'>
export type TuiAppStatusSlot = TuiAppChromeSlotNode<'slot.header.status'>
export interface TuiAppChromeTerminalNodes {
  readonly contract: 'tui.app-container.chrome-terminal-nodes.v1'
  readonly publicationRevision: number
  readonly logo: TuiAppLogoSlot
  readonly connection: TuiAppConnectionSlot
  readonly session: TuiAppSessionSlot
  readonly status: TuiAppStatusSlot
}

export interface TuiAppRowRegionStyle {
  readonly flexDirection: 'row'
}

export interface TuiAppColumnRegionStyle {
  readonly flexDirection: 'column'
}

export interface TuiAppTranscriptRegionStyle {
  readonly flexDirection: 'column'
  readonly flexGrow: 0 | 1
  readonly flexShrink: 0 | 1
  readonly overflow: 'hidden'
}

export interface TuiAppFooterWorkspaceRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.footer.workspace'
  readonly style: TuiAppRowRegionStyle
  readonly children: readonly [
    TuiAppConnectionSlot,
    TuiAppSessionSlot,
    TuiAppStatusSlot,
  ]
}

export interface TuiAppHeaderRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.header'
  readonly style: TuiAppColumnRegionStyle
  readonly children: readonly []
}

export interface TuiAppTranscriptRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.transcript'
  readonly style: TuiAppTranscriptRegionStyle
  readonly children: readonly [TuiTerminalTranscriptLeaf]
}

export interface TuiAppExecutionRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.execution'
  readonly style: TuiAppColumnRegionStyle
  readonly children: readonly [TuiTerminalExecutionLeaf]
}

export interface TuiAppComposerRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.composer'
  readonly style: TuiAppColumnRegionStyle
  readonly children: readonly [TuiTerminalComposerLeaf]
}
export interface TuiAppSubagentStatusRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.subagent-status'
  readonly style: TuiAppColumnRegionStyle
  readonly children: readonly [TuiTerminalBoxNode]
}

export interface TuiAppOverlayRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.overlay'
  readonly style: TuiAppColumnRegionStyle
  readonly children: readonly [TuiTerminalOverlayLeaf]
}

export interface TuiAppFooterRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.footer'
  readonly style: TuiAppColumnRegionStyle
  readonly children: readonly [TuiAppFooterWorkspaceRegion, TuiTerminalFooterLeaf]
}

export type TuiAppRootRegionNode =
  | TuiAppHeaderRegion
  | TuiAppTranscriptRegion
  | TuiAppExecutionRegion
  | TuiAppComposerRegion
  | TuiAppSubagentStatusRegion
  | TuiAppOverlayRegion
  | TuiAppFooterRegion

export interface TuiAppFrameRoot extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'frame.root'
  readonly style: TuiTerminalBoxNode['style'] & { readonly flexDirection: 'column'; readonly height: number; readonly minHeight: number }
  readonly children: ReadonlyArray<TuiAppRootRegionNode>
}

export interface TuiAppContainerFrameV3 extends Omit<TuiTerminalFrameTree, 'root'> {
  readonly root: TuiAppFrameRoot
}
