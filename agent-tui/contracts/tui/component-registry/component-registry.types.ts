export type TuiComponentProps =
  | {
      readonly contract: 'tui.presentation-node.v1'
      readonly node: {
        readonly nodeId: string
        readonly kind: string
        readonly publicationRevision: number
        readonly lifecycle: 'streaming' | 'settled' | 'interrupted' | 'failed'
        readonly value: Readonly<Record<string, unknown>>
      }
    }
  | {
      readonly contract: 'tui.interaction-state.v1'
      readonly state: Readonly<Record<string, unknown>>
    }

export type TuiElementDescriptor = {
  readonly contract: 'tui.element.v1'
  readonly elementType: string
  readonly props?: Readonly<Record<string, unknown>>
  readonly children?: ReadonlyArray<TuiElementDescriptor>
  readonly intents?: ReadonlyArray<TuiIntent>
  readonly collapsed?: boolean
}

export type TuiIntent = {
  readonly contract: 'tui.intent.v1'
  readonly intent: string
  readonly payload?: Readonly<Record<string, unknown>>
}

export type TuiRenderOutput = TuiElementDescriptor | TuiIntent | null

export type ComponentRender = (props: TuiComponentProps) => TuiRenderOutput

export interface ComponentRegistration {
  readonly groupId: string
  readonly kind: string
  readonly owner: string
  readonly validateProps: (props: TuiComponentProps) => boolean
  readonly render: ComponentRender
}

export interface ComponentGroup {
  readonly group_id: string
  readonly registry_face: string
  readonly zone: string
  readonly members: readonly string[]
}

export interface ComponentManifest {
  readonly schema_version: 1
  readonly groups: readonly ComponentGroup[]
}
