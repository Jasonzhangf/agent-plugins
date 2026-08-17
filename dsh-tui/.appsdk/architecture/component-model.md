# DSH TUI component model

Status: design complete for implementation review. Runtime remains unimplemented.

## Chosen carrier and architectural boundary

The terminal carrier is exactly `ink@7.1.1` with Node 22 or newer and React 19.2 or newer. Ink owns terminal layout and React reconciliation. Cordis owns discovery, registration, dependency injection, lifecycle and module disposal. The TUI owns canonical presentation nodes. DSH owns Session truth and mutations.

This division is deliberate:

```text
official DSH public contracts
        │
        ▼
Cordis projector plugins ──> immutable TUI view nodes
        │                           │
        │                           ├─> Cordis terminal renderer registry ─> Ink
        │                           └─> simulator fixtures ─> browser renderer
        ▼
typed TUI action handlers ──> official DSH public owners
```

React components do not call DSH, parse raw Session events, pair tools, decide retry state, or own Cordis registrations. A projector does not render ANSI or import Ink. The static simulator does not connect to DSH.

## What is adopted from Codex TUI

The pinned Codex source audit is recorded in `codex-tui-selection-audit.json`. The implementation translates these contracts, not its Rust code:

- one typed application event bus between components and the app owner;
- a conversation orchestrator distinct from individual history cells;
- committed history cells separated from mutable streaming cells;
- stable cell identity during streaming and reflow;
- a BottomPane view stack with one focus owner;
- cursor ownership declared by the active editor or interaction view;
- invalidation-driven frames, with bounded ticks only for animations;
- one terminal lifecycle owner covering alternate screen, raw input, bracketed paste, resize, suspend, signals and restoration;
- snapshot/golden tests plus real PTY lifecycle tests.

Codex's Rust/Ratatui runtime, custom terminal buffer, and process layout are not adopted. Ink supplies the carrier-level equivalents.

## Canonical node contract

Every transcript node has this envelope:

```ts
interface TuiViewNode<K extends keyof TuiViewNodeMap> {
  nodeId: string
  kind: K
  publicationRevision: number
  lifecycle: 'streaming' | 'settled' | 'interrupted' | 'failed'
  turnId?: string
  stepId?: string
  timestamp?: number
  value: TuiViewNodeMap[K]
}
```

`nodeId` is stable across streaming updates. `publicationRevision` increases only when the node value changes. Projectors produce immutable replacements. Renderers may retain local view state such as expansion, but never business state.

The node map is TypeScript declaration-mergeable. A plugin that adds a kind must provide all of the following in one change set:

1. node-map augmentation;
2. exactly one projector owner or an explicit external projection binding;
3. exactly one renderer registration;
4. positive, negative and unknown-input fixtures;
5. component snapshot cases at required widths;
6. registry and import-edge declarations.

Unknown public Session events become an explicit `conversation.unknown` node. Unknown canonical node kinds fail registry resolution; they are not silently rendered as text.

## Registries and ownership

The machine-readable group list lives in `component-registry.json`. Each registry is a Cordis service with effect-owned registration:

```ts
const dispose = ctx.tuiConversationCells.register({
  kind: 'conversation.assistant',
  owner: 'dsh-tui.component.assistant',
  component: AssistantCell,
})
ctx.effect(() => dispose)
```

Duplicate active owners fail during plugin activation. Registration order never decides ownership. Each registry compiles to a deterministic manifest; runtime does not scan source directories.

### Projector plugins

Projectors independently reproduce audited official WebUI behavior from public inputs. They are stateful only where correlation is required: assistant chunks, tool call/result trees, command completion, compaction checkpoints, retry suppression, turn tails and workflow runs. Their state is re-created from `session.history` after reconnect; transport generation and backoff never enter the projection.

### Conversation cell plugins

Conversation cells render one canonical node. Assistant text and reasoning are separate child blocks under one assistant cell so reasoning visibility can change without reinterpreting events. Markdown is parsed in the TUI presentation layer into terminal-neutral inline/block tokens; the renderer only lays out those tokens.

### Tool card plugins

The tool projector consumes public tool events and Host-provided `ToolEventView`. It owns root/subcall correlation and lifecycle. Tool renderer plugins select by an explicit TUI render intent (`generic`, `terminal`, `read`, `search`, `diff`, `workflow`, `skill`, `error`). A missing specialized renderer is a design error caught by fixture coverage, not a runtime fallback to guessed semantics.

### BottomPane plugins

BottomPane is a stack, not a collection of simultaneously active inputs. The top view owns keyboard input and cursor placement. Composer state remains mounted underneath approval, question and selector views. Typed completion results are delivered to the app event bus, which dispatches through action-handler plugins.

Priority is fixed:

```text
fatal notice > approval/question > explicit selector > command picker > queue > composer
```

`Ctrl+C` cancels an active turn, otherwise requests exit. `Ctrl+D` exits only when the composer is empty and the Session is idle. `/quit` is explicit. `/resume` opens only the current-cwd resume selector. No `q` exit binding is active while an editor owns focus.

### Status and overlay plugins

Status items read typed projection or control selectors, never transport envelopes. The status bar keeps orthogonal states: connection, Session, turn, model, context, tools, queue and interaction. Overlays own full-viewport inspection for compact trajectory, plan, goal, jobs, settings, plugin inventory and help; they do not change the selected Session.

## Shell layout and scroll model

```text
┌ transcript viewport ─────────────────────────────┐
│ committed cells                                  │
│ active streaming cells                          │
│                                                  │
│ user scroll => anchored; end => follow-tail      │
└──────────────────────────────────────────────────┘
┌ BottomPane: exactly one active view ─────────────┐
│ composer | queue | command | approval | question │
└──────────────────────────────────────────────────┘
┌ status: connection/session/turn/model/context ───┐
└──────────────────────────────────────────────────┘
                 optional overlay
```

Width changes reflow cells while preserving the visible anchor by `nodeId` and intra-node line offset. Appended output follows the tail only when the user has not scrolled away. Large tool results are collapsed by view policy but remain semantically available through expansion; the projector never truncates the underlying business record.

## Terminal lifecycle

One `terminal-lifecycle` Cordis plugin owns Ink's `alternateScreen` render instance and terminal input resources. It must restore the primary screen and cursor on normal exit, `/quit`, idle `Ctrl+C`, empty-idle `Ctrl+D`, host EOF, connection fatal, `SIGINT`, `SIGTERM`, suspend/resume, unhandled rejection and render exception. No child component may call raw-mode or process-exit APIs.

## Implementation slices

1. Contracts and deterministic registries.
2. Terminal lifecycle, app event bus, focus manager and empty shell.
3. Public transport and one-current-cwd Session controller.
4. Core conversation projectors and fixture corpus.
5. Core cells, scrolling, composer and status.
6. Tools, workflow, plan/goal/jobs and interactions.
7. Settings, commands, attachments, skills/subagents and feedback.
8. Static simulator and visual approval.
9. Installer, clean-registry, official-Web zero-diff and same-Session dual-client tests.

No slice may skip its registered gates or be promoted directly from Playground to a consumer path.
