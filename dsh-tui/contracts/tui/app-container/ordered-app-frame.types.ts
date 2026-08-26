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
export type TuiAppExecutionSlot = TuiAppChromeSlotNode<'slot.execution'>

export interface TuiAppChromeTerminalNodes {
  readonly contract: 'tui.app-container.chrome-terminal-nodes.v1'
  readonly publicationRevision: number
  readonly logo: TuiAppLogoSlot
  readonly connection: TuiAppConnectionSlot
  readonly session: TuiAppSessionSlot
  readonly status: TuiAppStatusSlot
  readonly execution: TuiAppExecutionSlot
}

export interface TuiAppRowRegionStyle {
  readonly flexDirection: 'row'
}

export interface TuiAppColumnRegionStyle {
  readonly flexDirection: 'column'
}

export interface TuiAppHeaderRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.header'
  readonly style: TuiAppRowRegionStyle
  readonly children: readonly [
    TuiAppLogoSlot,
    TuiAppConnectionSlot,
    TuiAppSessionSlot,
    TuiAppStatusSlot,
  ]
}

export interface TuiAppTranscriptRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.transcript'
  readonly style: TuiAppColumnRegionStyle
  readonly children: readonly [TuiTerminalTranscriptLeaf]
}

export interface TuiAppExecutionRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.execution'
  readonly style: TuiAppColumnRegionStyle
  readonly children: readonly [TuiAppExecutionSlot]
}

export interface TuiAppComposerRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.composer'
  readonly style: TuiAppColumnRegionStyle
  readonly children: readonly [TuiTerminalComposerLeaf]
}

export interface TuiAppOverlayRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.overlay'
  readonly style: TuiAppColumnRegionStyle
  readonly children: readonly [TuiTerminalOverlayLeaf]
}

export interface TuiAppFooterRegion extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'region.footer'
  readonly style: TuiAppColumnRegionStyle
  readonly children: readonly [TuiTerminalFooterLeaf]
}

export type TuiAppRootRegionNode =
  | TuiAppHeaderRegion
  | TuiAppTranscriptRegion
  | TuiAppExecutionRegion
  | TuiAppComposerRegion
  | TuiAppOverlayRegion
  | TuiAppFooterRegion

export interface TuiAppFrameRoot extends Omit<TuiTerminalBoxNode, 'key' | 'style' | 'children'> {
  readonly key: 'frame.root'
  readonly style: TuiTerminalBoxNode['style'] & { readonly flexDirection: 'column'; readonly height: number }
  readonly children: ReadonlyArray<TuiAppRootRegionNode>
}

export interface TuiAppContainerFrameV3 extends Omit<TuiTerminalFrameTree, 'root'> {
  readonly root: TuiAppFrameRoot
}
