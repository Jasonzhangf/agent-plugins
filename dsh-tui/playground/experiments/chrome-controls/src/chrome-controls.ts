import { Service, type Context } from '@deepseek-ai/cordis'
import {
  assertChromeProjectionInput,
  assertChromeRevision,
  assertChromeSlotModel,
  assertChromeStateInput,
  chromeControlProjection,
  isChromeSlotId,
  TUI_CHROME_SLOT_IDS,
  type TuiChromeSlotId,
  type TuiChromeSlotModel,
  type TuiChromeSlotProducer,
  type TuiChromeSlotProjectionInput,
  type TuiChromeProjectionState,
  type TuiChromeSlotRegistryFace,
} from '../../../../contracts/tui/chrome-controls/chrome-controls.types.ts'

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
    context.effect(() => () => this.dispose(), 'tui-chrome-controls.dispose')
  }

  get registeredSlots(): ReadonlyArray<TuiChromeSlotId> {
    return Object.freeze([...this.producers.keys()])
  }

  register(ownerContext: Context, producer: TuiChromeSlotProducer): () => void {
    if (this.disposed) throw new Error('chrome-controls: registry disposed')
    if (!ownerContext || typeof ownerContext.effect !== 'function') {
      throw new Error('chrome-controls: display registration requires an owning Cordis context')
    }
    if (!isSameOrDescendantContext(ownerContext, this.context)) {
      throw new Error('chrome-controls: display owner must be the registry context or a descendant')
    }
    if (!isChromeSlotId(producer.slotId)) throw new TypeError(`chrome-controls: unknown slot ${String(producer.slotId)}`)
    if (this.producers.has(producer.slotId)) throw new Error(`chrome-controls: duplicate slot registration ${producer.slotId}`)
    this.producers.set(producer.slotId, producer)
    let active = true
    const remove = () => {
      if (!active) return
      active = false
      if (this.producers.get(producer.slotId) === producer) this.producers.delete(producer.slotId)
    }
    try {
      return ownerContext.effect(() => remove, `chrome-controls.display.${producer.slotId}`)
    } catch (error) {
      remove()
      throw error
    }
  }

  project(input: TuiChromeSlotProjectionInput): ReadonlyArray<TuiChromeSlotModel> {
    if (this.disposed) throw new Error('chrome-controls: registry disposed')
    assertChromeProjectionInput(input)
    const models: TuiChromeSlotModel[] = []
    for (const producer of this.producers.values()) {
      const model = producer.project({ ...input, publicationRevision: input.publicationRevision })
      assertChromeSlotModel(model)
      if (model.slotId !== producer.slotId) {
        throw new Error(`chrome-controls: registered slot ${producer.slotId} projected ${model.slotId}`)
      }
      assertChromeRevision(model.revision, `${model.slotId} revision`)
      assertChromeRevision(model.publicationRevision, `${model.slotId} publicationRevision`)
      if (model.publicationRevision !== input.publicationRevision) {
        throw new Error(`chrome-controls: slot ${model.slotId} revision mismatch ${String(model.publicationRevision)} != ${String(input.publicationRevision)}`)
      }
      models.push(Object.freeze(model))
    }
    const bySlot = new Map(models.map(model => [model.slotId, model]))
    const missing = TUI_CHROME_SLOT_IDS.filter(slotId => !bySlot.has(slotId))
    if (missing.length > 0) throw new Error(`chrome-controls: missing required slots ${missing.join(', ')}`)
    if (models.length !== TUI_CHROME_SLOT_IDS.length || bySlot.size !== models.length) {
      throw new Error('chrome-controls: duplicate projected slots')
    }
    return Object.freeze(TUI_CHROME_SLOT_IDS.map(slotId => bySlot.get(slotId)!))
  }

  projectState(input: { readonly publicationRevision: number }): TuiChromeProjectionState {
    assertChromeStateInput(input)
    const registry = (this.context as Context & { readonly tuiLogicControls?: TuiChromeSlotProjectionInput['logicControls'] }).tuiLogicControls
    if (registry === undefined) throw new Error('chrome-controls: tuiLogicControls is not installed')
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
      throw new Error('chrome-controls: canonical slot order drift')
    }
    return Object.freeze({
      logoVariant: logo.variant,
      logoVisible: logo.visible,
      connectionState: connection.state,
      executionState: execution.state,
      headerSession: session.text,
      headerStatus: status.text,
    })
  }

  dispose(): void {
    this.disposed = true
    this.producers.clear()
  }
}

export function createLogoPlugin(): TuiChromeSlotProducer<{
  slotId: 'header.logo'; revision: number; publicationRevision: number; variant: 'full' | 'compact'; visible: boolean
}> {
  return {
    slotId: 'header.logo',
    project(input) {
      const control = chromeControlProjection(input, 'logo')
      if (control.control !== 'logo') throw new TypeError('chrome-controls: logo projection mismatch')
      return Object.freeze({
        slotId: 'header.logo',
        revision: control.revision,
        publicationRevision: input.publicationRevision,
        variant: control.variant,
        visible: control.visible,
      })
    },
  }
}

export function createConnectionPlugin(): TuiChromeSlotProducer<{
  slotId: 'header.connection'; revision: number; publicationRevision: number; state: 'connecting' | 'connected' | 'disconnected' | 'failed'
}> {
  return {
    slotId: 'header.connection',
    project(input) {
      const control = chromeControlProjection(input, 'connection')
      if (control.control !== 'connection') throw new TypeError('chrome-controls: connection projection mismatch')
      return Object.freeze({
        slotId: 'header.connection', revision: control.revision, publicationRevision: input.publicationRevision, state: control.state,
      })
    },
  }
}

export function createSessionPlugin(): TuiChromeSlotProducer<{
  slotId: 'header.session'; revision: number; publicationRevision: number; text: string
}> {
  return {
    slotId: 'header.session',
    project(input) {
      const control = chromeControlProjection(input, 'session')
      if (control.control !== 'session') throw new TypeError('chrome-controls: session projection mismatch')
      return Object.freeze({
        slotId: 'header.session', revision: control.revision, publicationRevision: input.publicationRevision,
        text: `Session ${control.selectedSessionId ?? 'no-session'}`,
      })
    },
  }
}

export function createStatusPlugin(): TuiChromeSlotProducer<{
  slotId: 'header.status'; revision: number; publicationRevision: number; text: string
}> {
  return {
    slotId: 'header.status',
    project(input) {
      const control = chromeControlProjection(input, 'status')
      if (control.control !== 'status') throw new TypeError('chrome-controls: status projection mismatch')
      return Object.freeze({
        slotId: 'header.status', revision: control.revision, publicationRevision: input.publicationRevision,
        text: `Status ${control.mode}`,
      })
    },
  }
}

export function createExecutionPlugin(): TuiChromeSlotProducer<{
  slotId: 'execution'; revision: number; publicationRevision: number; state: 'idle' | 'running' | 'completed' | 'failed'
}> {
  return {
    slotId: 'execution',
    project(input) {
      const control = chromeControlProjection(input, 'execution')
      if (control.control !== 'execution') throw new TypeError('chrome-controls: execution projection mismatch')
      return Object.freeze({
        slotId: 'execution', revision: control.revision, publicationRevision: input.publicationRevision, state: control.state,
      })
    },
  }
}

export interface TuiChromeDisplayPlugin {
  readonly name: 'tui.display.header-logo'
    | 'tui.display.header-connection'
    | 'tui.display.header-session'
    | 'tui.display.header-status'
    | 'tui.display.execution'
  readonly slotId: TuiChromeSlotId
  apply(ctx: Context): void
}

const CHROME_DISPLAY_PLUGIN_NAMES = Object.freeze({
  'header.logo': 'tui.display.header-logo',
  'header.connection': 'tui.display.header-connection',
  'header.session': 'tui.display.header-session',
  'header.status': 'tui.display.header-status',
  execution: 'tui.display.execution',
} as const satisfies Record<TuiChromeSlotId, TuiChromeDisplayPlugin['name']>)

function createChromeDisplayProducer(slotId: TuiChromeSlotId): TuiChromeSlotProducer {
  switch (slotId) {
    case 'header.logo': return createLogoPlugin()
    case 'header.connection': return createConnectionPlugin()
    case 'header.session': return createSessionPlugin()
    case 'header.status': return createStatusPlugin()
    case 'execution': return createExecutionPlugin()
  }
}

export function createChromeDisplayPlugin(slotId: TuiChromeSlotId): TuiChromeDisplayPlugin {
  if (!isChromeSlotId(slotId)) throw new TypeError(`chrome-controls: unknown display slot ${String(slotId)}`)
  const name = CHROME_DISPLAY_PLUGIN_NAMES[slotId]
  return Object.freeze({
    name,
    slotId,
    apply(ctx: Context): void {
      ctx.tuiChromeSlotRegistry.register(ctx, createChromeDisplayProducer(slotId))
    },
  })
}

export const chromeDisplayPlugins = Object.freeze(
  TUI_CHROME_SLOT_IDS.map(slotId => createChromeDisplayPlugin(slotId)),
) as readonly TuiChromeDisplayPlugin[]

export function apply(ctx: Context): void {
  ctx.tuiChromeSlotRegistry = new TuiChromeSlotRegistry(ctx)
}

export async function installChromeDisplayPlugins(ctx: Context): Promise<void> {
  apply(ctx)
  for (const plugin of chromeDisplayPlugins) await ctx.plugin(plugin)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiChromeSlotRegistry: TuiChromeSlotRegistry
  }
}
