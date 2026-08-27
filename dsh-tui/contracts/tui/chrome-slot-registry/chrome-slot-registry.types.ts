import type { LogicControlKind, LogicControlProjection } from "../logic-controls/logic-controls.types.ts"

export const TUI_CHROME_SLOT_IDS = Object.freeze([
  "header.logo",
  "header.connection",
  "header.session",
  "header.status",
  "execution",
] as const)

export type TuiChromeSlotId = typeof TUI_CHROME_SLOT_IDS[number]

export type TuiChromeRevision = number

export interface TuiChromeSlotModelBase {
  readonly slotId: TuiChromeSlotId
  readonly revision: TuiChromeRevision
  readonly publicationRevision: TuiChromeRevision
  readonly displayMode: "persistent" | "live"
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
  readonly logicControls: TuiLogicControlProjector
}

export interface TuiLogicControlProjector {
  project(control: LogicControlKind): LogicControlProjection
}

export interface TuiChromeProjectionState {
  readonly logoVariant: "full" | "compact"
  readonly logoVisible: boolean
  readonly logoDisplayMode: "persistent" | "live"
  readonly connectionState: "connecting" | "connected" | "disconnected" | "failed"
  readonly connectionDisplayMode: "persistent" | "live"
  readonly executionState: "idle" | "running" | "completed" | "failed"
  readonly executionDisplayMode: "persistent" | "live"
  readonly headerSession: string
  readonly sessionDisplayMode: "persistent" | "live"
  readonly headerStatus: string
  readonly statusDisplayMode: "persistent" | "live"
}

export function chromeControlProjection(
  input: TuiChromeSlotProjectionInput,
  control: LogicControlKind,
): LogicControlProjection {
  return input.logicControls.project(control)
}

export interface TuiChromeSlotProducer<S extends TuiChromeSlotModel = TuiChromeSlotModel> {
  readonly slotId: S["slotId"]
  project(input: TuiChromeSlotProjectionInput): S
}

export interface TuiChromeDisplayPlugin {
  readonly name: string
  readonly slotId: TuiChromeSlotId
  apply(ctx: { readonly tuiChromeSlotRegistry: TuiChromeSlotRegistryFace }): void
}

export interface TuiChromeSlotRegistryFace {
  readonly registeredSlots: ReadonlyArray<TuiChromeSlotId>
  register(ownerContext: unknown, producer: TuiChromeSlotProducer): () => void
  project(input: TuiChromeSlotProjectionInput): ReadonlyArray<TuiChromeSlotModel>
  projectState(input: { readonly publicationRevision: TuiChromeRevision }): TuiChromeProjectionState
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiChromeSlotRegistry: TuiChromeSlotRegistryFace
  }
}

export interface TuiChromeComposition {
  readonly slotId: TuiChromeSlotId
  readonly model: TuiChromeSlotModel
}

export function assertChromeRevision(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`chrome-slot-registry: ${label} must be a non-negative integer`)
  }
  return value
}

function assertClosedInput(
  value: unknown,
  allowed: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(`chrome-slot-registry: ${label} must be a plain object`)
  }
  const ownKeys = Reflect.ownKeys(value as object)
  const expected = [...allowed].sort().join(",")
  if (ownKeys.some(key => typeof key !== "string")
    || ownKeys.map(key => String(key)).sort().join(",") !== expected) {
    throw new TypeError(`chrome-slot-registry: ${label} has an invalid closed input contract`)
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined
      || descriptor.enumerable === false || descriptor.value === undefined) {
      throw new TypeError(`chrome-slot-registry: ${label} has an invalid ${String(key)} property`)
    }
  }
}

export function assertChromeProjectionInput(value: TuiChromeSlotProjectionInput): void {
  assertClosedInput(value, ["publicationRevision", "logicControls"], "projection input")
  assertChromeRevision(value.publicationRevision, "publicationRevision")
  if (typeof value.logicControls?.project !== "function") {
    throw new TypeError("chrome-slot-registry: tuiLogicControls does not implement project()")
  }
}

export function assertChromeStateInput(value: { readonly publicationRevision: TuiChromeRevision }): void {
  assertClosedInput(value, ["publicationRevision"], "state input")
  assertChromeRevision(value.publicationRevision, "publicationRevision")
}

export function isChromeSlotId(value: string): value is TuiChromeSlotId {
  return TUI_CHROME_SLOT_IDS.some(slotId => slotId === value)
}

const CHROME_SLOT_CONTRACTS: Readonly<
  Record<TuiChromeSlotId, readonly string[]>
> = Object.freeze({
  "header.logo": Object.freeze(["slotId", "revision", "publicationRevision", "displayMode", "variant", "visible"]),
  "header.connection": Object.freeze(["slotId", "revision", "publicationRevision", "displayMode", "state"]),
  "header.session": Object.freeze(["slotId", "revision", "publicationRevision", "displayMode", "text"]),
  "header.status": Object.freeze(["slotId", "revision", "publicationRevision", "displayMode", "text"]),
  execution: Object.freeze(["slotId", "revision", "publicationRevision", "displayMode", "state"]),
})

export function assertChromeSlotModel(value: unknown): asserts value is TuiChromeSlotModel {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError("chrome-slot-registry: slot model must be a plain object")
  }
  const model = value as Record<string, unknown>
  if (!isChromeSlotId(String(model.slotId))) {
    throw new TypeError(`chrome-slot-registry: unknown slot ${String(model.slotId)}`)
  }
  const slotId = model.slotId as TuiChromeSlotId
  const expectedKeys = [...CHROME_SLOT_CONTRACTS[slotId]].sort().join(",")
  const ownKeys = Reflect.ownKeys(model)
  if (ownKeys.some(key => typeof key !== "string")
    || ownKeys.map(key => String(key)).sort().join(",") !== expectedKeys) {
    throw new TypeError(`chrome-slot-registry: slot ${slotId} has an invalid closed output contract`)
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(model, key)
    if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined
      || descriptor.enumerable === false || descriptor.value === undefined) {
      throw new TypeError(`chrome-slot-registry: slot ${slotId} has an invalid ${String(key)} property`)
    }
  }
  assertChromeRevision(model.revision as number, `${slotId} revision`)
  assertChromeRevision(model.publicationRevision as number, `${slotId} publicationRevision`)
  if (model.displayMode !== "persistent" && model.displayMode !== "live") {
    throw new TypeError(`chrome-slot-registry: slot ${slotId} has an invalid displayMode`)
  }
  switch (slotId) {
    case "header.logo":
      if ((model.variant !== "full" && model.variant !== "compact") || typeof model.visible !== "boolean") {
        throw new TypeError("chrome-slot-registry: invalid header.logo output")
      }
      return
    case "header.connection":
      if (model.state !== "connecting" && model.state !== "connected" && model.state !== "disconnected" && model.state !== "failed") {
        throw new TypeError("chrome-slot-registry: invalid header.connection output")
      }
      return
    case "header.session":
    case "header.status":
      if (typeof model.text !== "string") throw new TypeError(`chrome-slot-registry: invalid ${slotId} output`)
      return
    case "execution":
      if (model.state !== "idle" && model.state !== "running" && model.state !== "completed" && model.state !== "failed") {
        throw new TypeError("chrome-slot-registry: invalid execution output")
      }
      return
  }
}
