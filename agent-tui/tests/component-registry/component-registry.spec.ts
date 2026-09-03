import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import manifest from '../../contracts/tui/component-registry/manifest.json' with { type: 'json' }
import {
  apply,
  componentRegistryServiceName,
  type TuiComponentProps,
  type TuiElementDescriptor,
} from '../../src/experiments/component-registry/src/component-registry.ts'

function install(): Context {
  const ctx = new Context()
  apply(ctx)
  return ctx
}

function nodeProps(value: Readonly<Record<string, unknown>> = { text: 'hello' }): TuiComponentProps {
  return {
    contract: 'tui.presentation-node.v1',
    node: {
      nodeId: 'node-1',
      kind: 'conversation.user',
      publicationRevision: 1,
      lifecycle: 'settled',
      value,
    },
  }
}

function interactionProps(value: Readonly<Record<string, unknown>> = { focused: true }): TuiComponentProps {
  return {
    contract: 'tui.interaction-state.v1',
    state: value,
  }
}

function textElement(props: TuiComponentProps): TuiElementDescriptor {
  return { contract: 'tui.element.v1', elementType: 'text', props }
}

function unsafeProps(value: unknown): TuiComponentProps {
  return value as TuiComponentProps
}

test('registers and resolves one exact effect-owned component', () => {
  const ctx = install()
  const render = (props: TuiComponentProps) => textElement(props)
  const dispose = ctx.tuiComponentRegistry.register(ctx, {
    groupId: 'conversation.cells',
    kind: 'conversation.user',
    owner: 'test.user-cell',
    validateProps: value => value.contract === 'tui.presentation-node.v1',
    render,
  })
  const registration = ctx.tuiComponentRegistry.resolve('conversation.cells', 'conversation.user')
  assert.equal(registration.owner, 'test.user-cell')
  assert.equal(registration.render, render)
  const props = nodeProps()
  assert.deepEqual(ctx.tuiComponentRegistry.render('conversation.cells', 'conversation.user', props), textElement(props))
  dispose()
  assert.throws(() => ctx.tuiComponentRegistry.resolve('conversation.cells', 'conversation.user'), /not registered/)
})

test('rejects duplicate active owners and preserves the original registration', () => {
  const ctx = install()
  const first = {
    groupId: 'conversation.cells',
    kind: 'conversation.assistant',
    owner: 'test.first',
    validateProps: (_value: TuiComponentProps) => true,
    render: (_props: TuiComponentProps) => null,
  } as const
  ctx.tuiComponentRegistry.register(ctx, first)
  assert.throws(() => ctx.tuiComponentRegistry.register(ctx, { ...first, owner: 'test.second' }), /duplicate owner/)
  assert.equal(ctx.tuiComponentRegistry.resolve('conversation.cells', 'conversation.assistant').owner, 'test.first')
})

test('rejects unknown groups and kinds without family fallback', () => {
  const ctx = install()
  const registration = {
    groupId: 'conversation.cells',
    kind: 'conversation.typo',
    owner: 'test.typo',
    validateProps: (_value: TuiComponentProps) => true,
    render: (_props: TuiComponentProps) => null,
  } as const
  assert.throws(() => ctx.tuiComponentRegistry.register(ctx, registration), /unknown component kind/)
  assert.throws(() => ctx.tuiComponentRegistry.resolve('conversation.cells', 'conversation.typo'), /unknown component kind/)
  assert.throws(() => ctx.tuiComponentRegistry.resolve('missing.group', 'conversation.user'), /unknown component group/)
})

test('rejects raw Session events, transport frames, and API clients as untyped props', () => {
  const ctx = install()
  ctx.tuiComponentRegistry.register(ctx, {
    groupId: 'conversation.cells',
    kind: 'conversation.user',
    owner: 'test.user-cell',
    validateProps: (_value: TuiComponentProps) => true,
    render: () => null,
  })
  assert.throws(() => ctx.tuiComponentRegistry.render('conversation.cells', 'conversation.user', unsafeProps({
    type: 'user/message', seq: 1, time: 1, data: {},
  })), /typed TUI component contract/)
  assert.throws(() => ctx.tuiComponentRegistry.render('conversation.cells', 'conversation.user', unsafeProps({
    rpcId: 'rpc-1', payload: { type: 'session/event' },
  })), /typed TUI component contract/)
  assert.throws(() => ctx.tuiComponentRegistry.render('conversation.cells', 'conversation.user', unsafeProps({
    sessions: {}, events: {},
  })), /typed TUI component contract/)
  assert.throws(() => ctx.tuiComponentRegistry.render('conversation.cells', 'conversation.user', unsafeProps({
    metadata: { source: 'control' },
  })), /typed TUI component contract/)
  assert.throws(() => ctx.tuiComponentRegistry.render('conversation.cells', 'conversation.user', unsafeProps({
    event: { type: 'user/message', seq: 1, time: 1, data: {} },
  })), /typed TUI component contract/)
  assert.throws(() => ctx.tuiComponentRegistry.render('conversation.cells', 'conversation.user', nodeProps({
    value: new Date(),
  })), /plain objects or arrays/)
})

test('keeps control semantics outside the closed component envelope', () => {
  const ctx = install()
  ctx.tuiComponentRegistry.register(ctx, {
    groupId: 'conversation.cells',
    kind: 'conversation.user',
    owner: 'test.control-boundary',
    validateProps: () => true,
    render: () => null,
  })
  assert.throws(() => ctx.tuiComponentRegistry.render(
    'conversation.cells',
    'conversation.user',
    unsafeProps({ contract: 'tui.presentation-node.v1', node: { nodeId: 'x' } }),
  ), /invalid node/)
  assert.throws(() => ctx.tuiComponentRegistry.render(
    'conversation.cells',
    'conversation.user',
    unsafeProps({ contract: 'tui.presentation-node.v1', node: { nodeId: 'x', kind: 'conversation.user', publicationRevision: 1, lifecycle: 'settled', value: { control: true } }, control: true }),
  ), /unknown fields/)
})

test('accepts a canonical tool error value containing a business error field', () => {
  const ctx = install()
  ctx.tuiComponentRegistry.register(ctx, {
    groupId: 'tool.cards',
    kind: 'tool.error',
    owner: 'test.tool-error',
    validateProps: value => value.contract === 'tui.presentation-node.v1',
    render: props => textElement(props),
  })
  const props = nodeProps({ name: 'shell', status: 'failed', error: 'command failed' })
  assert.deepEqual(ctx.tuiComponentRegistry.render('tool.cards', 'tool.error', props), textElement(props))
})

test('rejects untyped props and untyped renderer output', () => {
  const ctx = install()
  ctx.tuiComponentRegistry.register(ctx, {
    groupId: 'conversation.cells',
    kind: 'conversation.user',
    owner: 'test.output-boundary',
    validateProps: () => true,
    render: (() => ({ arbitrary: true })) as never,
  })
  assert.throws(() => ctx.tuiComponentRegistry.render(
    'conversation.cells',
    'conversation.user',
    unsafeProps({ text: 'untyped' }),
  ), /typed TUI component contract/)
  assert.throws(() => ctx.tuiComponentRegistry.render(
    'conversation.cells',
    'conversation.user',
    nodeProps(),
  ), /typed TUI output contract/)
})

test('renders the closed interaction-state contract to terminal-neutral output', () => {
  const ctx = install()
  ctx.tuiComponentRegistry.register(ctx, {
    groupId: 'bottom-pane.views',
    kind: 'composer.editor',
    owner: 'test.composer-editor',
    validateProps: value => value.contract === 'tui.interaction-state.v1',
    render: props => textElement(props),
  })
  const props = interactionProps()
  assert.deepEqual(
    ctx.tuiComponentRegistry.render('bottom-pane.views', 'composer.editor', props),
    textElement(props),
  )
})

test('registration is removed when its owning Cordis plugin unloads', async () => {
  const ctx = install()
  const plugin = {
    name: 'test.component-plugin',
    apply(pluginContext: Context) {
      pluginContext.tuiComponentRegistry.register(pluginContext, {
        groupId: 'conversation.cells',
        kind: 'conversation.context',
        owner: 'test.plugin-context-cell',
        validateProps: () => true,
        render: () => null,
      })
    },
  }
  const fiber = ctx.plugin(plugin)
  await fiber
  assert.equal(ctx.tuiComponentRegistry.resolve('conversation.cells', 'conversation.context').owner, 'test.plugin-context-cell')
  await fiber.dispose()
  assert.throws(() => ctx.tuiComponentRegistry.resolve('conversation.cells', 'conversation.context'), /not registered/)
})

test('compiled manifest is deterministic and matches the contract member order', () => {
  const ctx = install()
  const compiled = ctx.tuiComponentRegistry.compileManifest()
  assert.equal(Object.isFrozen(compiled), true)
  assert.deepEqual(compiled.groups, manifest.groups)
  assert.deepEqual(ctx.tuiComponentRegistry.compileManifest(), compiled)
})

test('service is installed under its canonical Cordis name', () => {
  const ctx = install()
  assert.equal(ctx.tuiComponentRegistry.name, componentRegistryServiceName)
  assert.equal(ctx.get(componentRegistryServiceName)?.name, componentRegistryServiceName)
})
