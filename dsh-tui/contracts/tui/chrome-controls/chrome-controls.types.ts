import type { LogicControlKind, LogicControlProjection } from "../logic-controls/logic-controls.types.ts"

export type TuiChromeSlotId =
  | "header.logo"
  | "header.connection"
  | "header.session"
  | "header.status"
  | "execution"

export type TuiChromeRevision = number

export interface TuiChromeSlotModelBase {
  readonly slotId: TuiChromeSlotId
  readonly revision: TuiChromeRevision
  readonly publicationRevision: TuiChromeRevision
}

export interface TuiChromeHeaderLogoSlot extends TuiChromeSlotModelBase {
  readonly slotId: "header.logo"
  readonly variant: "full" | "compact"
  readonly visible: boolean
}

export interface TuiChromeHeaderConnectionSlot extends TuiChromeSlotModelBase {
  readonly slotId: "header.connection"
  readonly state: "connecting" | "connected" | "disconnected" | "failed"
}

export interface TuiChromeHeaderSessionSlot extends TuiChromeSlotModelBase {
  readonly slotId: "header.session"
  readonly text: string
}

export interface TuiChromeHeaderStatusSlot extends TuiChromeSlotModelBase {
  readonly slotId: "header.status"
  readonly text: string
}

export interface TuiChromeExecutionSlot extends TuiChromeSlotModelBase {
  readonly slotId: "execution"
  readonly state: "idle" | "running" | "completed" | "failed"
}

export type TuiChromeSlotModel =
  | TuiChromeHeaderLogoSlot
  | TuiChromeHeaderConnectionSlot
  | TuiChromeHeaderSessionSlot
  | TuiChromeHeaderStatusSlot
  | TuiChromeExecutionSlot

export interface TuiChromeSlotProjectionInput {
  readonly publicationRevision: TuiChromeRevision
  readonly controls: ReadonlyArray<LogicControlProjection>
  readonly composer?: {
    readonly text: string
    readonly cursor: number
    readonly lines: ReadonlyArray<string>
    readonly cursorLine: number
    readonly cursorColumn: number
    readonly mode: "idle" | "streaming" | "tool" | "error"
  }
  readonly status?: {
    readonly sessionId: string | null
    readonly cwd: string | null
    readonly mode: "idle" | "streaming" | "tool" | "error"
    readonly publicationRevision: number
    readonly message?: string
  }
}

export function chromeControlProjection(
  input: TuiChromeSlotProjectionInput,
  control: LogicControlKind,
): LogicControlProjection {
  const found = input.controls.find(item => item.control === control)
  if (found === undefined) throw new Error(`chrome-controls: missing ${control} projection`)
  return found
}

export interface TuiChromeSlotProducer<S extends TuiChromeSlotModel = TuiChromeSlotModel> {
  readonly slotId: S["slotId"]
  project(input: TuiChromeSlotProjectionInput): S
}

export interface TuiChromeSlotRegistryFace {
  readonly registeredSlots: ReadonlyArray<TuiChromeSlotId>
  project(input: TuiChromeSlotProjectionInput): ReadonlyArray<TuiChromeSlotModel>
  dispose(): void
}

export interface TuiChromeComposition {
  readonly slotId: TuiChromeSlotId
  readonly model: TuiChromeSlotModel
}

export function assertChromeRevision(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`chrome-controls: ${label} must be a non-negative integer`)
  }
  return value
}

export function isChromeSlotId(value: string): value is TuiChromeSlotId {
  return value === "header.logo"
    || value === "header.connection"
    || value === "header.session"
    || value === "header.status"
    || value === "execution"
}
