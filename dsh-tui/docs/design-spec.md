# dsh-tui base architecture specification

Status: revision 1, base architecture and eight capability dispositions approved by Jason. This document defines architecture and verification obligations only. Implementation admission remains blocked and it does not authorize codec or runtime work.

## Objective

Build an installable DSH bundle whose terminal interface follows Codex TUI's interaction and layout language while preserving DSH Web UI behavior. Functional alignment means that every applicable Web capability has an explicit TUI status and the same DSH business owner. It does not mean copying React components or Codex business state.

## Source audit

This revision is bound to the current local DSH checkout at `/Volumes/extension/code/dsh`.

| Fact | Current source evidence | Consequence |
| --- | --- | --- |
| Profiles are ordered bundle patch layers. `web` is a shipped template containing `dsh-base` and `dsh-web-app`. | `packages/boot/app-boot/src/profile.ts`: `PROFILE_TEMPLATES`; `apps/cli/src/plugin.ts` | `dsh-tui` is installed once as the final bundle layer of the existing `web` profile; later starts require no overlay. |
| App arguments belong to the mounted surface. | `packages/boot/cmdline/README.md`; `packages/bundle/headless/src/startup.ts` | `dsh-tui/startup` parses `ctx.cmdlineArgs`; no launcher change. |
| `Session.deriveMessages()` is the model-history projection, not the Web transcript projection. | `packages/core/session/src/surface.ts`; `packages/core/session/src/index.ts` | TUI must not use `deriveMessages()` as a Web parity claim. |
| Web transcript semantics are assembled incrementally by `ConversationNodeAssembler` plus registered `ConversationNodeDefinition`s and the `chat` view builder. | `packages/client/runtime/src/client/sessions/conversation-assembler.ts`; `packages/client/ui-conversation/src/client/conversation-nodes/register.ts`; `chat-snapshot-builder.ts` | The canonical transcript projection must reuse this machinery through a platform-neutral owner; Rust never pairs raw events. |
| Tool call/result and nested subcall pairing are owned by the current Conversation Tool Definition. | `packages/client/ui-conversation/src/client/conversation-nodes/tool.ts`; `.agents/notes/implemented/architecture/2026-08-08-client-tool-presentation-ownership.md` | `HistoryCell::from_event` is forbidden. Rust receives already paired tool cells. The older `tool-call-tree.ts` is not a current projection entrypoint. |
| Web Markdown has two exact grammars: streaming GFM and settled GFM+math, with an incremental parser. | `packages/client/ui-primitives/src/markdown/parse.ts`; `incremental.ts` | The Node host uses these parsers and serializes a display AST. Rust does not use `pulldown-cmark`. |
| Web prompt/cancel/history behavior goes through the Session client/object layer. | `packages/client/ui-conversation/src/client/service.ts`; `packages/client/runtime/src/client/sessions/session.ts` | TUI host actions use the matching Host owners; no business state in Rust. |
| The prior `packages/ui/tui` implementation was intentionally deleted after losing its product composition. | `.agents/notes/implemented/simplification/2026-08-04-remove-tui-package.md`; Git parent of `10bb9cbf4a` | The old raw-event fold and pi-tui package are historical evidence only. Reintroduction requires a named deployment, explicit package boundary, interaction provider, and assembled lifecycle/transcript acceptance. |
| The current Conversation Node architecture landed after the old TUI was removed. | `.agents/notes/implemented/architecture/2026-08-09-client-conversation-node-assembly.md`; current runtime sources | The plugin must bind to current Conversation definitions rather than resurrecting the deleted TUI projection. |
| The generic assembler is exported by the browser runtime client face, but the registered Chat definitions/builders and Markdown parsers are not exported from public platform-neutral entrypoints today. | `packages/client/runtime/src/client/index.ts`; `ui-conversation/src/client/index.ts`; `ui-primitives/src/index.ts`; package `exports`/`files`; `packages/client/AGENTS.md` export discipline | The independent TUI package can consume only compatible published entrypoints. A missing entrypoint blocks that capability; it does not authorize checkout-relative imports or a copied implementation. |

## Architecture decision

Select Node host + Rust Ratatui child process.

```text
dsh CLI / Cordis / Node
  |- dsh-tui startup plugin
  |- DSH services and official domain owners
  |- canonical TUI projection adapter
  |- Web Markdown parser -> display AST
  `- versioned inherited-pipe bridge
       |- host -> child: BusinessProjection channel
       |- child -> host: BusinessAction channel
       |- host -> child: HostControl channel
       `- child -> host: ChildControl channel

Rust child
  |- App
  |- ChatWidget
  |- HistoryCell::from_projection
  |- BottomPane
  |- StatusBar
  |- SessionPicker
  `- TerminalGuard
```

The Node and Rust components are separate processes. Inherited anonymous pipes are IPC. The child inherits the controlling terminal as stdin/stdout; terminal bytes never share a pipe with bridge records. Business projection/actions and control traffic use four logically and physically separate unidirectional channels. Detailed design must choose the Unix fd and Windows inherited-handle layout and prove each channel is single-purpose. Stderr is diagnostic-only and never carries protocol or business records.

No socket, TCP listener, HTTP server, SDK JSON-RPC route, or second DSH runtime is introduced.

## Ownership and data separation

The Session event log remains durable business truth. Web/TUI presentation is a projection, not truth. The TUI bridge has physically separate channel families:

- `BusinessProjection`: host-to-child canonical transcript cells, session summaries, projection values, model catalog views, pending interaction views, and tool presentation models.
- `BusinessAction`: child-to-host prompt, cancel, session, selection, command, queue, settings, and interaction operations dispatched to existing DSH owners.
- `HostControl` and `ChildControl`: direction-specific handshake, delivery ledger, ack, resync, backpressure, lifecycle, shutdown, and fatal diagnostics on dedicated pipes.

Control fields are forbidden inside `BusinessProjection` and `BusinessAction`, including generic `metadata`. Business values are forbidden as the source of connection, retry, resync, or shutdown state. A decoder receiving the wrong family or direction fails the bridge.

## Canonical presentation owner

The current Web transcript projection is browser-bound even though its assembler is React-free. The independent plugin consumes platform-neutral registries, contracts, and business contribution entrypoints only after they exist in a compatible published DSH release:

```text
SessionEvent + ToolEventView + registered Definitions
  -> ConversationNodeAssembler
  -> ChatSnapshot / projection values
  -> TuiProjectionAdapter
  -> CanonicalTranscriptCell[]
  -> Web semantic fixture comparison
  -> Rust renderer
```

`dsh-tui/src/presentation/` is the plugin-local adapter and contains no copied business roster. Each DSH business package retains its Definitions and target builders behind a published `./presentation` contribution; Web and TUI mount the same contribution set. The plugin consumes only published package exports and cannot import React, DOM, browser storage, Web components, or DSH checkout-relative source files. It does not add packages or source files to the DSH monorepo.

Every cell carries:

- stable `cellId`, derived from the existing Conversation Node key;
- monotonic `revision` scoped to that id;
- `anchorSeq` and optional turn/step coordinates;
- one closed semantic variant such as user, context, assistant, reasoning, tool, retry, command, compaction, turn-error, max-tokens, workflow, or unknown;
- structured blocks; raw Markdown is allowed only inside a markdown block that also carries the canonical display AST produced by the host.

Rust owns only viewport, wrapping cache, local disclosure state, selection, composer draft, modal focus, and terminal lifecycle.

## Projection scheduling

The official `ConversationNodeAssembler.append()` already applies contiguous events incrementally, and the current Session object layer routes `animation-frame` publication through `Notifier.markFrameDirty()`. The host must reuse the extracted projection owner's equivalent publication contract rather than calling `Session.deriveMessages()` for every chunk.

- Live events append through the platform-neutral projection owner.
- `animation-frame` changes coalesce to a configurable maximum of 60 FPS; default 30 FPS.
- Immediate changes flush in the same event-loop turn.
- The adapter diffs stable cell id + revision and emits `transcript_patch`.
- Initial open, resume, child restart, definition-registry rebuild, or detected sequence gap emits contiguous `projection_window` records followed by `projection_commit` for one `publicationRevision`.
- A patch references `baseRevision`; mismatch makes the child send `request_resync` and apply no partial data.
- Bridge queues have fixed byte and frame limits. Saturation stops patch production and schedules one windowed projection publication after the child acknowledges capacity; it never drops a business patch and continues as if applied.

## Markdown

The platform-neutral DSH owner owns and exports the exact Web parsers, and the Web Markdown component imports them from that owner:

- streaming: `parseGfm()` plus `IncrementalMarkdownParser`;
- settled: `parseGfmWithMath()`.

The Node host normalizes the resulting mdast into a versioned terminal display AST. The AST covers paragraphs, headings, text spans, links, inline code, code blocks, lists, task items, quotes, thematic breaks, tables, math, images/attachments, and explicit unknown nodes. Rust renders that AST to Ratatui lines and spans. Unknown AST variants fail the protocol version handshake; they are not silently flattened.

## Complete Web capability matrix

The first product release cannot defer an applicable row without Jason approving the exact exception. `N/A` means the browser-only carrier has no terminal equivalent, while the underlying business operation still remains reachable where applicable.

| capability_id | Web owner/evidence | TUI release requirement | Business owner |
| --- | --- | --- | --- |
| `session.new` | `ui-sidebar`, `ui-workspace` | New session from current/selected workspace | DSH workspace/session APIs |
| `session.list-open-switch` | `ui-workspace` | Session picker, grouped workspace list, open/switch | DSH workspace/session APIs |
| `session.resume-history` | runtime history pages | Cold resume, paged history, windowed resync | session persistence + official conversation projection |
| `session.rename-archive-fork` | `ui-workspace` | Rename, archive, fork at completed turn | DSH Host operations |
| `session.search` | `ui-workspace` | Metadata and content search, open result | DSH session query |
| `workspace.manage` | `ui-workspace` | Select/add/rename/reorder/delete workspace where Host supports it | DSH workspace service |
| `conversation.prompt` | `ui-conversation` | Multiline draft, queue/steer policy, submit | DSH Session prompt owner |
| `conversation.cancel` | `ui-conversation` | Stop current turn without clearing queue | DSH Session cancel owner |
| `conversation.queue` | `ui-conversation` | View/edit/delete/strict-steer queued rows | DSH inbox/queue owner |
| `conversation.commands` | `ui-commands`, `ui-input-trigger` | Slash discovery, exact claim, execute/popup/leading-input | DSH command registry |
| `conversation.skills-subagent-reference` | `ui-skill`, `ui-subagent` | `@` candidates and selected literal insertion | Existing source owners |
| `conversation.attachments` | `ui-conversation`, `ui-attachment` | Paste/file-add/remove; terminal display for historical images | DSH attachment owner |
| `transcript.core` | `ui-conversation` definitions | user/context/assistant/reasoning/streaming/command/compaction/unknown | canonical projection owner |
| `transcript.tools` | `ui-conversation`, `ui-tool` | paired root/subcalls, args/result/error/cancel/interrupted, render intents | canonical projection + tool presentation owner |
| `transcript.retry-errors` | retry/error/max-token definitions | retry, terminal error, max-token, cancellation | canonical projection owner |
| `transcript.markdown` | `ui-primitives/markdown` | exact host parser and display AST | Web Markdown parser owner |
| `transcript.workflow` | `ui-workflow-run` | workflow nodes | workflow-run Conversation definition owner |
| `transcript.trajectory` | `ui-trajectory` | trajectory view/tab | trajectory Conversation definitions/view target owner |
| `turn.plan-todo-goal` | `ui-plan`, TodoDock, `ui-goal` | projection display and all available mutations | plan/todo/goal owners |
| `interaction.approval-question` | ApprovalPanel, `ui-user-questions` | composer takeover, complete answer/reject/cancel vocabulary | interaction/approval/question owners |
| `selection.model-reasoning` | `ui-model-selection` | per-session provider/model/effort selection | DSH model directory/selection owner |
| `selection.permission` | `ui-permission-presets` | current permission selection and full-access confirmation | permission command/projection owner |
| `selection.agent-preset` | `ui-agent-preset` | future-session preset selection | agent preset/settings owner |
| `status.session-turn-tools` | runtime + UI headers | composed lifecycle status, active tool count, pending interaction | existing facts only |
| `status.stats-context` | StatsLine, token meter projections | token/cache/timing/context figures | session projection owners |
| `subagent.navigate-control` | `ui-subagent` | catalog tree, open child, continuation/stop rules | subagent owner |
| `jobs.list` | `ui-jobs` | live/settled job list | jobs mirror owner |
| `message.feedback` | `ui-message-feedback` | like/dislike/note/retract | message feedback Remote owner |
| `settings.general` | `ui-settings-general` | locale, appearance, busy-Enter, default permission/preset | settings owners |
| `settings.models-plugins` | settings model/plugin packages | same exposed settings mutations and credential protections | settings/credentials/adapter owners |
| `settings.open-document` | native Web host action | N/A in TUI; `/config` or existing shell command may expose owner operation only if already public | settings Host owner |
| `plugin.inventory-cordis` | settings inventory, `ui-cordis` | plugin inventory and Cordis inspection views | existing Host APIs |
| `browser.theme-layout` | theme/layout/sidebar shell | N/A; terminal theme/layout is presentation-local | Rust renderer |

## Lifecycle

State is orthogonal, never one linear enum:

- `AppLifecycle`: booting, ready, shutting_down, terminated.
- `Bridge`: spawning, handshaking, connected, draining, failed.
- `Turn`: idle, running, cancelling, failed.
- `Projection`: clean, dirty, flushing, resyncing.
- `Tools`: `activeCount`, `failedCount`.
- `Interaction`: none, approval, question, plan-review.

The status bar derives display from these facts. No business transition is inferred from terminal text.

## Keyboard and terminal safety

- Enter submits according to DSH busy-Enter policy; Shift+Enter inserts a newline.
- `Ctrl+C` while a turn runs requests cancellation. A later `Ctrl+C` while idle requests shutdown.
- `Ctrl+D` exits only when the composer is empty and the turn is idle.
- Escape closes the top modal/menu/disclosure mode; otherwise it does not exit.
- `q` exits only inside an explicit non-editing command/navigation mode.
- `/quit` requests orderly shutdown.
- `TerminalGuard` restores raw mode, bracketed paste, focus mode, cursor, and alternate screen on normal shutdown, bridge failure, Rust panic, host EOF, signal, and suspend/resume.

## Binary distribution

The approved release bundle contains prebuilt binaries and never compiles Rust during user installation. The current one-command release writes an immutable tarball to the global plugin release store and installs it into the shipped Web profile; cross-platform artifacts remain the proposed matrix below:

Proposed release targets:

- `aarch64-apple-darwin`
- `x86_64-apple-darwin`
- `x86_64-unknown-linux-gnu`
- `aarch64-unknown-linux-gnu`
- `x86_64-pc-windows-msvc`

Musl is unsupported until a dedicated artifact and PTY/console test lane exist. Package layout:

```text
dsh-tui/
  src/                 # Node Cordis host
  native/              # Rust workspace and committed Cargo.lock
  lib/native/dsh-tui[.exe]
  scripts/release-install.mjs
  tests/
  package.json
  cordis.patch.yml
```

Detailed design defines contributor builds, release-store integrity, profile installation, target selection, and CI producers. Published npm/tarball artifacts include the approved target binaries; the one-command release installer restores executable mode on the exact profile-installed binary. Startup resolves the exact target, checks bridge protocol range, and fails before entering raw mode when absent or incompatible. No alternate binary or Node renderer fallback is allowed.

## Bundle composition

Current DSH source proves the following future patch structure:

```yaml
- insert:
    - id: tui-startup
      name: dsh-tui/startup
    - id: tui-host
      name: dsh-tui
      inject: [tuiStartup]
```

The implementation may add DSH owners required by the approved capability matrix, but it must not copy the complete Web bundle: no Web server, browser modules, React roster, or API transport is needed in the same-process Node host. The exact rows remain part of detailed design. The current checked-in patch stays `[]` and is not runnable.

## Codex TUI reference boundary

Allowed current Codex references: App/ChatWidget division, bottom pane organization, history-cell rendering, Ratatui/Crossterm terminal lifecycle, resize reflow, frame limiting, alternate screen, and terminal restoration tests.

Allowed historical DSH references: archived TUI UX behavior, semantic terminal-state captures, PTY harness patterns, control-character neutralization, long-session render-cost evidence, and lifecycle failure cases. Archived code and notes are evidence, not current authority or a source-copy target.

Forbidden reuse: Codex app-server protocol, Codex business/session/tool state, onboarding/login, provider configuration, approval vocabulary, and source copying. DSH owners above remain authoritative.

## Approval gate

Detailed design may begin only after:

1. Jason approves this architecture and capability matrix. Satisfied on 2026-08-15.
2. Every active map row references a real source path and symbol; unimplemented capability rows remain blocked rather than represented by runtime stubs.
3. Platform-neutral DSH presentation entrypoints are external versioned dependencies; the plugin contains only its adapter and cannot copy missing owners.
4. The four-channel inherited-pipe layout, protocol schema, binary release targets, and release exceptions are selected in detailed design.
5. The current module registry and test design are approved as the ownership and verification baseline.

- [x] Approved by Jason
- Approval date: 2026-08-15
- Approved exceptions: none
