import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyComponentRegistry } from '../../playground/experiments/component-registry/src/component-registry.ts'
import { apply as applyChromeControls } from '../../playground/experiments/chrome-controls/src/chrome-controls.ts'
import {
  apply as applyLogicControls,
  applyConnection,
  applyExecution,
  applyLogo,
  applySession as applySessionControl,
  applyStatus,
} from '../../playground/experiments/logic-controls/src/logic-controls.ts'
import { apply as applyTerminalUi } from '../../playground/experiments/terminal-ui/src/terminal-ui.ts'
import { apply as applyAppContainer } from '../../playground/experiments/app-container/src/app-container.ts'
import { composeAppContainer } from '../../playground/experiments/app-container/src/app-container.ts'
import type { TuiAppViewModel } from '../../contracts/tui/app-container/app-container.types.ts'
import type { TuiTerminalUi } from '../../playground/experiments/terminal-ui/src/terminal-ui.ts'

function viewModel(): TuiAppViewModel {
  return {
    publicationRevision: 3,
    model: { publicationRevision: 3, nodes: [] },
    controls: [
      { control: 'input', stableKey: 'control.input', text: '', cursor: 0, mode: 'idle', revision: 1 },
      { control: 'status', stableKey: 'control.status', sessionId: 'session-a', cwd: '/tmp', mode: 'idle', revision: 1 },
      { control: 'logo', stableKey: 'control.logo', variant: 'full', visible: true, revision: 1 },
      { control: 'connection', stableKey: 'control.connection', state: 'connected', revision: 2 },
      { control: 'execution', stableKey: 'control.execution', state: 'idle', turnId: null, revision: 1 },
      { control: 'session', stableKey: 'control.session', selectedSessionId: 'session-a', availableSessionIds: ['session-a'], cwd: '/tmp', lifecycle: 'active', requestedSessionId: null, revision: 1 },
      { control: 'slash-command', stableKey: 'control.slash-command', command: null, args: [], accepted: false, revision: 1 },
    ],
    chrome: { logoVariant: 'full', logoVisible: true, connectionState: 'connected', executionState: 'idle', headerSession: 'Session session-a', headerStatus: 'Status idle' },
    composer: { text: '', cursor: 0, lines: [''], cursorLine: 0, cursorColumn: 0, mode: 'idle' },
    status: { sessionId: 'session-a', cwd: '/tmp', mode: 'idle', publicationRevision: 3 },
    localEchoes: [],
  }
}

function terminalUi(): TuiTerminalUi {
  return {
    composeInkTree(input: Parameters<TuiTerminalUi['composeInkTree']>[0]) {
      return {
        nodeId: 'tui.shell', kind: 'tui.shell', publicationRevision: input.model.publicationRevision, lifecycle: 'settled',
        descriptor: {
          contract: 'tui.terminal-shell.v1', width: input.width ?? 80, scrollOffset: input.scrollOffset ?? 0,
          transcript: [], localEchoes: input.localEchoes ?? [], composer: input.composer!, status: input.status!,
        },
      }
    },
  } as unknown as TuiTerminalUi
}

function installLogicControls(ctx: Context): void {
  applyLogicControls(ctx)
  applyLogo(ctx)
  applyConnection(ctx)
  applySessionControl(ctx)
  applyStatus(ctx)
  applyExecution(ctx)
}

test('default and compact layouts consume the same view model with distinct slot policies', () => {
  const model = viewModel()
  const defaultFrame = composeAppContainer(terminalUi(), { viewModel: model, width: 80, scrollOffset: 0, layout: 'default' })
  const compactFrame = composeAppContainer(terminalUi(), { viewModel: model, width: 80, scrollOffset: 0, layout: 'compact' })
  assert.equal(defaultFrame.descriptor.appContainer.contract, 'tui.app-container.v2')
  assert.notDeepEqual(defaultFrame.descriptor.appContainer.slots, compactFrame.descriptor.appContainer.slots)
  assert.equal(defaultFrame.publicationRevision, compactFrame.publicationRevision)
  assert.equal(defaultFrame.descriptor.appContainer.logoVariant, 'full')
})

test('container rejects duplicate control projections and invalid dimensions', () => {
  const model = viewModel()
  const duplicate = { ...model, controls: [...model.controls, model.controls[0]!] }
  assert.throws(() => composeAppContainer(terminalUi(), { viewModel: duplicate, width: 80, scrollOffset: 0 }), /duplicate control projection key/)
  assert.throws(() => composeAppContainer(terminalUi(), { viewModel: model, width: 0, scrollOffset: 0 }), /width must be positive/)
  assert.throws(() => composeAppContainer(terminalUi(), { viewModel: model, width: 80, scrollOffset: -1 }), /invalid scrollOffset/)
  assert.throws(() => composeAppContainer(terminalUi(), { viewModel: { ...model, model: { ...model.model, publicationRevision: 2 } }, width: 80, scrollOffset: 0 }), /revisions must match/)
})

test('container rejects unknown layouts and preserves control side-channel separation', () => {
  const model = viewModel()
  assert.throws(() => composeAppContainer(terminalUi(), { viewModel: model, width: 80, scrollOffset: 0, layout: 'wide' as never }), /unknown layout/)
  const frame = composeAppContainer(terminalUi(), { viewModel: model, width: 80, scrollOffset: 0 })
  assert.equal('metadata' in frame.descriptor, false)
  assert.equal('control' in frame.descriptor, false)
})

test('container rejects view models with incomplete chrome header projections', () => {
  const model = viewModel()
  const missingSession = { ...model, chrome: { ...model.chrome, headerSession: undefined } } as unknown as TuiAppViewModel
  const missingStatus = { ...model, chrome: { ...model.chrome, headerStatus: undefined } } as unknown as TuiAppViewModel
  assert.throws(() => composeAppContainer(terminalUi(), { viewModel: missingSession, width: 80, scrollOffset: 0 }), /chrome header projections are required/)
  assert.throws(() => composeAppContainer(terminalUi(), { viewModel: missingStatus, width: 80, scrollOffset: 0 }), /chrome header projections are required/)
})

test('Cordis app-container consumes typed chrome through the terminal-ui seam', () => {
  const ctx = new Context()
  installLogicControls(ctx)
  applyComponentRegistry(ctx)
  applyTerminalUi(ctx)
  applyChromeControls(ctx)
  applyAppContainer(ctx)
  const frame = ctx.tuiAppContainer.composeInkTree({
    model: { publicationRevision: 0, nodes: [] },
    width: 80,
    scrollOffset: 0,
  })
  assert.equal(frame.descriptor.appContainer?.contract, 'tui.app-container.v2')
  assert.equal(frame.descriptor.appContainer?.connectionState, 'disconnected')
  assert.equal(frame.descriptor.appContainer?.headerSession, 'Session no-session')
  assert.equal(frame.descriptor.appContainer?.headerStatus, 'Status idle')
  assert.equal(frame.descriptor.appContainer?.executionState, 'idle')
  assert.equal(frame.descriptor.contract, 'tui.terminal-shell.v1')
  assert.equal(frame.descriptor.transcript.length, 0)
  ctx.tuiAppContainer.setLayout('compact')
  const compactFrame = ctx.tuiAppContainer.composeInkTree({
    model: { publicationRevision: 0, nodes: [] },
    width: 80,
    scrollOffset: 0,
  })
  assert.equal(compactFrame.descriptor.appContainer?.layout, 'compact')
  assert.equal(compactFrame.publicationRevision, frame.publicationRevision)
  const nextViewModel = viewModel()
  const nextRevisionViewModel: TuiAppViewModel = {
    ...nextViewModel,
    publicationRevision: 1,
    model: { ...nextViewModel.model, publicationRevision: 1 },
  }
  const refreshed = ctx.tuiAppContainer.refresh({
    viewModel: nextRevisionViewModel,
    width: 80,
    scrollOffset: 0,
    layout: 'default',
  })
  assert.equal(refreshed.publicationRevision, 1)
  assert.equal(refreshed.descriptor.appContainer.layout, 'default')
  assert.doesNotThrow(() => ctx.tuiAppContainer.refresh({
    viewModel: nextRevisionViewModel,
    width: 80,
    scrollOffset: 0,
    layout: 'default',
  }))
  const compactRefresh = ctx.tuiAppContainer.refresh({
    viewModel: nextRevisionViewModel,
    width: 80,
    scrollOffset: 0,
    layout: 'compact',
  })
  assert.equal(compactRefresh.descriptor.appContainer.layout, 'compact')
  assert.notDeepEqual(compactRefresh.descriptor.appContainer.slots, refreshed.descriptor.appContainer.slots)
  const staleViewModel = viewModel()
  assert.throws(() => ctx.tuiAppContainer.refresh({
    viewModel: {
      ...staleViewModel,
      publicationRevision: 0,
      model: { ...staleViewModel.model, publicationRevision: 0 },
    },
    width: 80,
    scrollOffset: 0,
  }), /stale frame revision/)
  ctx.tuiAppContainer.dispose()
  assert.throws(() => ctx.tuiAppContainer.setLayout('default'), /disposed/)
  assert.throws(() => ctx.tuiAppContainer.refresh({
    viewModel: nextRevisionViewModel,
    width: 80,
    scrollOffset: 0,
  }), /disposed/)
  assert.throws(() => ctx.tuiAppContainer.compose({
    viewModel: nextRevisionViewModel,
    width: 80,
    scrollOffset: 0,
  }), /disposed/)
  assert.throws(() => ctx.tuiAppContainer.composeInkTree({ model: { publicationRevision: 0, nodes: [] }, width: 80, scrollOffset: 0 }), /disposed/)
})

test('Cordis app-container requires the chrome slot registry', () => {
  const ctx = new Context()
  installLogicControls(ctx)
  applyComponentRegistry(ctx)
  applyTerminalUi(ctx)
  applyAppContainer(ctx)
  assert.throws(() => ctx.tuiAppContainer.composeInkTree({
    model: { publicationRevision: 0, nodes: [] },
    width: 80,
    scrollOffset: 0,
  }), /tuiChromeSlotRegistry is not installed/)
})
