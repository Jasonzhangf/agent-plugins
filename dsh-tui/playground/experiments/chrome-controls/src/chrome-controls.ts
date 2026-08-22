import { Service, type Context } from '@deepseek-ai/cordis'
import {
  assertChromeRevision,
  assertChromeSlotModel,
  chromeControlProjection,
  isChromeSlotId,
  TUI_CHROME_SLOT_IDS,
  type TuiChromeSlotId,
  type TuiChromeSlotModel,
  type TuiChromeSlotProducer,
  type TuiChromeSlotProjectionInput,
  type TuiChromeSlotRegistryFace,
} from '../../../../contracts/tui/chrome-controls/chrome-controls.types.ts'

export const tuiChromeSlotRegistryName = 'tuiChromeSlotRegistry' as const

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

  register(producer: TuiChromeSlotProducer): void {
    if (this.disposed) throw new Error('chrome-controls: registry disposed')
    if (!isChromeSlotId(producer.slotId)) throw new TypeError(`chrome-controls: unknown slot ${String(producer.slotId)}`)
    if (this.producers.has(producer.slotId)) throw new Error(`chrome-controls: duplicate slot registration ${producer.slotId}`)
    this.producers.set(producer.slotId, producer)
  }

  project(input: TuiChromeSlotProjectionInput): ReadonlyArray<TuiChromeSlotModel> {
    if (this.disposed) throw new Error('chrome-controls: registry disposed')
    assertChromeRevision(input.publicationRevision, 'publicationRevision')
    const models: TuiChromeSlotModel[] = []
    for (const producer of this.producers.values()) {
      const model = producer.project({ ...input, publicationRevision: input.publicationRevision })
      assertChromeSlotModel(model)
      assertChromeRevision(model.revision, `${model.slotId} revision`)
      assertChromeRevision(model.publicationRevision, `${model.slotId} publicationRevision`)
      if (model.publicationRevision !== input.publicationRevision) {
        throw new Error(`chrome-controls: slot ${model.slotId} revision mismatch ${String(model.publicationRevision)} != ${String(input.publicationRevision)}`)
      }
      models.push(Object.freeze(model))
    }
    const missing = TUI_CHROME_SLOT_IDS.filter(slotId => !models.some(model => model.slotId === slotId))
    if (missing.length > 0) {
      throw new Error(`chrome-controls: missing required slots ${missing.join(', ')}`)
    }
    if (models.length !== TUI_CHROME_SLOT_IDS.length) {
      throw new Error('chrome-controls: duplicate projected slots')
    }
    return Object.freeze(models)
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

export function apply(ctx: Context): void {
  ctx.tuiChromeSlotRegistry = new TuiChromeSlotRegistry(ctx)
  ctx.tuiChromeSlotRegistry.register(createLogoPlugin())
  ctx.tuiChromeSlotRegistry.register(createConnectionPlugin())
  ctx.tuiChromeSlotRegistry.register(createSessionPlugin())
  ctx.tuiChromeSlotRegistry.register(createStatusPlugin())
  ctx.tuiChromeSlotRegistry.register(createExecutionPlugin())
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiChromeSlotRegistry: TuiChromeSlotRegistry
  }
}
