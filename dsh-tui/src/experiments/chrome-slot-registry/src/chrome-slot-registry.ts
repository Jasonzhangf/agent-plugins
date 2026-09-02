import { Service, type Context } from '@deepseek-ai/cordis'
import {
  assertChromeProjectionInput,
  assertChromeRevision,
  assertChromeSlotModel,
  assertChromeStateInput,
  isChromeSlotId,
  TUI_CHROME_SLOT_IDS,
  type TuiChromeSlotId,
  type TuiChromeSlotModel,
  type TuiChromeSlotProducer,
  type TuiChromeSlotProjectionInput,
  type TuiChromeProjectionState,
  type TuiChromeSlotRegistryFace,
} from '../../../../contracts/tui/chrome-slot-registry/chrome-slot-registry.types.ts'

export const tuiChromeSlotRegistryName = 'tuiChromeSlotRegistry' as const

function isSameOrDescendantContext(candidate: unknown, ancestor: Context): boolean {
  let current = candidate
  while (current !== undefined && current !== null) {
    if (current === ancestor) return true
    const parent = (current as Context).fiber?.parent
    if (parent === undefined || parent === null || parent === current) break
    current = parent
  }
  return false
}

export class TuiChromeSlotRegistry extends Service implements TuiChromeSlotRegistryFace {
  readonly name = tuiChromeSlotRegistryName
  private readonly producers = new Map<TuiChromeSlotId, TuiChromeSlotProducer>()
  private disposed = false
  constructor(private readonly context: Context) {
    super(context, tuiChromeSlotRegistryName)
    context.effect(() => () => this.dispose(), 'chrome-slot-registry.dispose')
  }

  get registeredSlots(): ReadonlyArray<TuiChromeSlotId> {
    return Object.freeze([...this.producers.keys()])
  }

  register(ownerContext: Context, producer: TuiChromeSlotProducer): () => void {
    if (this.disposed) throw new Error('chrome-slot-registry: registry disposed')
    if (!ownerContext || typeof ownerContext.effect !== 'function') {
      throw new Error('chrome-slot-registry: display registration requires an owning Cordis context')
    }
    if (!isSameOrDescendantContext(ownerContext, this.context)) {
      throw new Error('chrome-slot-registry: display owner must be the registry context or a descendant')
    }
    if (!isChromeSlotId(producer.slotId)) throw new TypeError(`chrome-slot-registry: unknown slot ${String(producer.slotId)}`)
    if (this.producers.has(producer.slotId)) throw new Error(`chrome-slot-registry: duplicate slot registration ${producer.slotId}`)
    this.producers.set(producer.slotId, producer)
    let active = true
    const remove = () => {
      if (!active) return
      active = false
      if (this.producers.get(producer.slotId) === producer) this.producers.delete(producer.slotId)
    }
    try {
      return ownerContext.effect(() => remove, `chrome-slot-registry.display.${producer.slotId}`)
    } catch (error) {
      remove()
      throw error
    }
  }

  project(input: TuiChromeSlotProjectionInput): ReadonlyArray<TuiChromeSlotModel> {
    if (this.disposed) throw new Error('chrome-slot-registry: registry disposed')
    assertChromeProjectionInput(input)
    const models: TuiChromeSlotModel[] = []
    for (const producer of this.producers.values()) {
      const model = producer.project({ ...input, publicationRevision: input.publicationRevision })
      assertChromeSlotModel(model)
      if (model.slotId !== producer.slotId) {
        throw new Error(`chrome-slot-registry: registered slot ${producer.slotId} projected ${model.slotId}`)
      }
      assertChromeRevision(model.revision, `${model.slotId} revision`)
      assertChromeRevision(model.publicationRevision, `${model.slotId} publicationRevision`)
      if (model.publicationRevision !== input.publicationRevision) {
        throw new Error(`chrome-slot-registry: slot ${model.slotId} revision mismatch ${String(model.publicationRevision)} != ${String(input.publicationRevision)}`)
      }
      models.push(Object.freeze(model))
    }
    const bySlot = new Map(models.map(model => [model.slotId, model]))
    const missing = TUI_CHROME_SLOT_IDS.filter(slotId => !bySlot.has(slotId))
    if (missing.length > 0) throw new Error(`chrome-slot-registry: missing required slots ${missing.join(', ')}`)
    if (models.length !== TUI_CHROME_SLOT_IDS.length || bySlot.size !== models.length) {
      throw new Error('chrome-slot-registry: duplicate projected slots')
    }
    return Object.freeze(TUI_CHROME_SLOT_IDS.map(slotId => bySlot.get(slotId)!))
  }

  projectState(input: { readonly publicationRevision: number }): TuiChromeProjectionState {
    assertChromeStateInput(input)
    const registry = (this.context as Context & { readonly tuiLogicControls?: TuiChromeSlotProjectionInput['logicControls'] }).tuiLogicControls
    if (registry === undefined) throw new Error('chrome-slot-registry: tuiLogicControls is not installed')
    const models = this.project({
      ...input,
      logicControls: registry,
    })
    const [logo, connection, session, status, execution] = models as [
      Extract<TuiChromeSlotModel, { slotId: 'header.logo' }>,
      Extract<TuiChromeSlotModel, { slotId: 'header.connection' }>,
      Extract<TuiChromeSlotModel, { slotId: 'header.session' }>,
      Extract<TuiChromeSlotModel, { slotId: 'header.status' }>,
      Extract<TuiChromeSlotModel, { slotId: 'execution' }>,
    ]
    if (logo.slotId !== 'header.logo' || connection.slotId !== 'header.connection'
      || session.slotId !== 'header.session' || status.slotId !== 'header.status'
      || execution.slotId !== 'execution') {
      throw new Error('chrome-slot-registry: canonical slot order drift')
    }
    return Object.freeze({
      logoVariant: logo.variant,
      logoVisible: logo.visible,
      logoDisplayMode: logo.displayMode,
      connectionState: connection.state,
      connectionDisplayMode: connection.displayMode,
      executionState: execution.state,
      executionDisplayMode: execution.displayMode,
      headerSession: session.text,
      sessionDisplayMode: session.displayMode,
      headerStatus: status.text,
      statusDisplayMode: status.displayMode,
    })
  }

  dispose(): void {
    this.disposed = true
    this.producers.clear()
  }
}

export function apply(ctx: Context): void {
  ctx.tuiChromeSlotRegistry = new TuiChromeSlotRegistry(ctx)
}
