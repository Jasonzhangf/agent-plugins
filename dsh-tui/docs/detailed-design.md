# dsh-tui detailed design

Status: revision 5, disposition-approved design correction. Runtime implementation and codec work remain blocked until every required owner export is installable from a verified registry release.

The current binding evidence comes from the local DSH `0.1.0-rc.5` built checkout. Registry queries on 2026-08-16 returned `E404` for the bound DSH packages. Therefore `bound` in the design manifest means source-artifact binding only; implementation admission additionally requires an installable registry release with the same versioned exports.

The implementation admission order is fixed: record the eight approved dispositions, publish each missing owner export, publish installable DSH RC packages, install only those registry packages in a clean environment, and rerun the design gate against that installation. The unlock signal is 50 verified Host capability bindings, 7 verified projection capability bindings, 1 Jason-approved N/A, zero blocked prerequisites, a verified clean registry installation, and `DESIGN_MAPS: PASS`. No local checkout artifact, private import, blocked stub, fake success, or empty projection substitutes for a step.

Release admission is separate. It requires completed implementation, mapped tests/build/install/online verification, an exact staged review tree and binary full-index diff, DSH Review of that uncommitted state after the installed real-session proof, and an uploaded commit whose tree and commit-versus-parent diff match the reviewed evidence. After staging the exact review scope, `git write-tree` produces `reviewed_tree_sha` and the SHA-256 of `git diff --cached --binary --full-index HEAD` produces `reviewed_diff_sha256`; the DSH Review prompt records both values. The checker reads the DSH Review final report, run metadata, status, and exit evidence; a status field alone cannot establish PASS. It also requires a fetched remote-tracking ref containing the uploaded commit. DSH Review and commit/upload cannot block implementation admission because they occur only after runtime implementation and verification.

## Delivery order

Implementation is one independent plugin under `~/code/dsh-plugins/dsh-tui`. Installed DSH packages remain external peer dependencies; no source or package is added to the DSH monorepo. Release builds resolve declared peers from a packed or installed DSH distribution, never from a checkout-relative path. The plugin cannot import DSH checkout-relative `src/*` files.

```text
DSH Session and Host owners
  -> platform-neutral Conversation registries
  -> business-owned presentation contributions
  -> canonical target and display-AST projectors
  -> dsh-tui Node projection adapter
  -> BusinessProjection pipe
  -> dsh-tui Rust render model

dsh-tui Rust typed action
  -> BusinessAction pipe
  -> dsh-tui Node action dispatcher
  -> existing DSH Host owner
```

## Plugin-owned presentation composition

`src/presentation/` owns the plugin's platform-neutral composition adapter: per-session runtime assembly, canonical target contracts, display AST normalization, and semantic fixture harness. It consumes only published DSH package entrypoints and imports no React renderer or browser runtime. The plugin does not create a second installable presentation plugin.

DSH business packages expose platform-neutral `./presentation` entrypoints beside their React entrypoints. The TUI package consumes those entrypoints as ordinary versioned peer dependencies. The required first set is `ui-conversation`, `ui-tool`, `ui-workflow-run`, `ui-trajectory`, `ui-goal`, and `ui-deliverables`. A missing public entrypoint blocks the affected capability; this plugin neither copies the owner implementation nor writes into the DSH repository.

The Web bundle and TUI plugin mount the same published contribution entrypoints for the approved capability matrix. React renderers remain external and are never installed into the TUI process. No definition, target builder, Markdown grammar, or tool-name dispatcher has a plugin-local duplicate.

The plugin presentation module owns:

- construction of the published `ConversationEventRegistry`, `ConversationViewRegistry`, and `ConversationNodeAssembler` faces;
- contribution registration and lifecycle disposal from an explicit plugin manifest, with no switch on business node kinds;
- canonical transcript and domain-view target contracts;
- stable canonical cell identity derived from Conversation Node keys;
- Web-equivalent streaming GFM and settled GFM plus math parsing;
- normalization from mdast to the closed display AST;
- semantic fixture projection shared by Web parity tests and TUI adapter tests.

`ui-conversation/presentation` retains Chat business definitions and `ChatSnapshotBuilder`. `ui-trajectory/presentation` retains its independent definitions and target builder. The TUI adapter never switches on every business `kind`; adding a business node requires its owner to publish a contribution and this plugin to declare that dependency.

The plugin does not expose raw mutable assembler state. Its internal runtime interface is:

```ts
interface CanonicalPresentationRuntime {
  register(contribution: CanonicalPresentationContribution): () => void
  replaceWindow(entries: readonly ConversationEventInput[], hasMore: boolean): Publication
  append(entry: ConversationEventInput): Publication
  prepend(entries: readonly ConversationEventInput[], hasMore: boolean): Publication
  currentProjection(): CanonicalPresentationProjection
}
```

`Publication` remains `none | animation-frame | immediate`. `currentProjection()` produces immutable terminal-neutral cells and projection values. Business errors appear only when the registered definition or owning projection publishes them. Registry changes rebuild affected session runtimes through the same low-frequency lifecycle used by Web; ordinary events remain incremental.

## Tool presentation ownership

The published `ui-conversation/presentation` entrypoint owns call/result pairing, interruption, and nested Code Dispatch topology and publishes paired `ToolCallBlock` trees. It never dispatches concrete tool names.

The existing `@deepseek-ai/dsh-tools/presentation` tagged `ToolCallView` and `ToolResultView` unions remain the provider-neutral render-intent source. The published `ui-tool/presentation` entrypoint owns `ToolPresentationModel`, generic render-intent mapping, its tool-name projector registry, and generic fallback. Web cards and TUI cells consume that same model; this plugin owns only terminal rendering.

Rust receives the paired tree and resolved `ToolPresentationModel`. It holds no call-id join table, tool-name switch, argument parser, or result-state machine.

## Node host modules

`src/startup.ts` parses immutable app arguments through `parseCmdline`. The first detailed grammar is:

```text
dsh --profile tui [--session <id>] [--workspace <id>] [--fps <1..60>]
```

`--session` and `--workspace` are mutually exclusive. The default frame rate is 30. Invalid arguments request launcher-owned exit before any child is spawned or terminal mode is changed.

`src/index.ts` waits for the required DSH services, constructs `src/presentation/` from approved published contributions, resolves the exact packaged binary, creates four inherited channels, spawns one child, performs the handshake, sends the initial windowed projection publication, and owns bounded shutdown.

`src/actions.ts` contains only adapters from `BusinessAction` variants to published DSH owners. It does not mutate Session logs or client stores. The TUI host uses the transport-neutral `ApiProxyService` mounted in the same Cordis process. Payload-direct calls use the existing public `InProcessApiClient(toFetchHandler(ctx.apiProxy))`; this invokes the same schemas and business owners as Web without a socket, HTTP listener, SDK JSON-RPC server, or second DSH runtime.

Every direct public binding is specified separately in `architecture/capability-bindings.yaml`. Host API operations use `@deepseek-ai/dsh-host-apiproxy/client` and the exact `IApiClient` method. Session switching and subagent navigation change only the TUI host's selected projection target after an authoritative list/history result; they do not call a Web client object layer or perform an invented DSH mutation. `ISessions`, `ISession`, `SessionFace`, and `IWorkspaces` are not executable TUI owners.

Other public owners are:

- `CommandRuntime.execute()` from `@deepseek-ai/dsh-commands` — the shared slash-command service that every UI adapter uses — for `/permission`, `/plan`, `/compact`, `/export`, and any other registered command. The TUI adapter resolves the current `Session` for the active session, then calls `execute(session, line, signal)` with the slash line the user typed. This is the same call path the browser's `ui-permission`, `ui-plan`, and `ui-commands` adapters use; there is no separate permission command or plan command — only `commands.execute()`.
- Exported `MessageFeedbackService`, `PluginInventoryGateway`, and `DynamicCordisRunnerService` for same-process Typert-owned capabilities that are not ApiProxy domains.

The required host-only Web rows are composed in the future TUI bundle: workspace, storage, message feedback, session projection/cache/stats, API gateway, plugin inventory, and Cordis host runner. Browser modules, client connection, webserver, React packages, and client runner are not mounted.

Every capability matrix row receives one typed action or is read-only projection. A missing public package entrypoint blocks that row's implementation until a compatible DSH distribution provides it; the plugin cannot call a private class or reproduce the mutation.

`src/projection/adapter.ts` maps upstream canonical presentation values to bridge DTOs. It may assign presentation-local cell revisions but cannot reinterpret tool or turn semantics. `src/projection/diff.ts` compares ordered cells by `cellId` and semantic equality. A changed cell increments only that cell's revision. Transfer sequence, resync, acknowledgement, capacity, and protocol version never enter these DTOs.

## Pipe topology

The child retains terminal stdin, stdout, and stderr. Protocol bytes use inherited anonymous pipes only:

| Logical channel | Direction | Unix child fd | Purpose |
| --- | --- | ---: | --- |
| `BusinessProjection` | host to child | 3, readable | Windowed projection publications and revision-fenced business patches |
| `BusinessAction` | child to host | 4, writable | Typed user intents |
| `HostControl` | host to child | 5, readable | Hello, acknowledgements, capacity, shutdown, fatal |
| `ChildControl` | child to host | 6, writable | Ready, acknowledgements, resync, capacity, shutdown, fatal |

Node `spawn()` stdio indexes 3 through 6 are the channel identities on every supported platform. The Rust child opens descriptors 3 through 6 directly; no environment variable carries a raw Windows handle. On Windows the four entries use Node's `overlapped` stdio mode when asynchronous Rust reads/writes require overlapped handles. The Windows target remains inactive until a Node 22 plus Rust proof binary exchanges data in both directions over all four indexes and proves terminal stdin/stdout/stderr stay independent.

Terminal stderr is diagnostic text only. It is never parsed. Terminal stdin/stdout never contain JSON records.

## Record framing

Each channel uses unsigned 32-bit big-endian length followed by one UTF-8 JSON object. Newline has no framing meaning. Maximum encoded record size is 8 MiB. Decoders allocate only after validating the length against the channel limit. EOF with an incomplete prefix or body is fatal.

Every record contains exactly `protocolVersion`, `type`, and the fields declared for that closed variant. Unknown fields are rejected at this process boundary. Generic `metadata`, `data`, and `payload` escape hatches are forbidden.

```ts
type BusinessProjectionRecord =
  | { protocolVersion: 1; type: 'projection_window'; publicationRevision: number; index: number; cells: CanonicalTranscriptCell[]; views: CanonicalDomainView[] }
  | { protocolVersion: 1; type: 'projection_commit'; publicationRevision: number; totalWindows: number }
  | { protocolVersion: 1; type: 'transcript_patch'; baseRevision: number; revision: number; upserts: CanonicalTranscriptCell[]; removes: string[] }
  | { protocolVersion: 1; type: 'view_update'; baseRevision: number; revision: number; view: CanonicalDomainView }

type BusinessActionRecord =
  | { protocolVersion: 1; type: 'submit'; actionId: string; sessionId: string; text: string; attachments: AttachmentInput[]; mode: 'queue' | 'steer' }
  | { protocolVersion: 1; type: 'cancel'; actionId: string; sessionId: string }
  | { protocolVersion: 1; type: 'session_action'; actionId: string; action: SessionAction }
  | { protocolVersion: 1; type: 'queue_action'; actionId: string; sessionId: string; itemId: string; action: QueueAction }
  | { protocolVersion: 1; type: 'command'; actionId: string; sessionId: string; line: string }
  | { protocolVersion: 1; type: 'selection_action'; actionId: string; action: SelectionAction }
  | { protocolVersion: 1; type: 'interaction_response'; actionId: string; response: InteractionResponse }
  | { protocolVersion: 1; type: 'settings_action'; actionId: string; action: SettingsAction }

type HostControlRecord =
  | { protocolVersion: 1; type: 'hello'; hostVersion: string; minProtocolVersion: 1; maxProtocolVersion: 1; maxRecordBytes: number; maxQueuedBytes: number }
  | { protocolVersion: 1; type: 'delivery_ledger'; channel: 'projection'; sequence: number; recordBytes: number }
  | { protocolVersion: 1; type: 'ack'; channel: 'action'; sequence: number }
  | { protocolVersion: 1; type: 'capacity'; channel: 'action'; availableBytes: number }
  | { protocolVersion: 1; type: 'shutdown'; reason: 'user' | 'host' | 'signal' }
  | { protocolVersion: 1; type: 'fatal'; code: ControlErrorCode; message: string }

type ChildControlRecord =
  | { protocolVersion: 1; type: 'ready'; childVersion: string; selectedProtocolVersion: 1; target: string }
  | { protocolVersion: 1; type: 'delivery_ledger'; channel: 'action'; sequence: number; recordBytes: number }
  | { protocolVersion: 1; type: 'ack'; channel: 'projection'; sequence: number; projectionRevision: number }
  | { protocolVersion: 1; type: 'request_resync'; expectedSequence: number; observedSequence: number; observedProjectionRevision: number; reason: 'sequence_gap' | 'revision_mismatch' | 'child_restart' }
  | { protocolVersion: 1; type: 'capacity'; channel: 'projection'; availableBytes: number }
  | { protocolVersion: 1; type: 'shutdown'; reason: 'user' | 'host' | 'signal' }
  | { protocolVersion: 1; type: 'fatal'; code: ControlErrorCode; message: string }
```

`delivery_ledger` contains only the fixed discriminator plus `channel`, `sequence`, and `recordBytes`. `recordBytes` is the UTF-8 byte length of the business JSON body without the four-byte prefix. HostControl may send only a projection ledger; ChildControl may send only an action ledger. Sequence starts at 1 per business channel and child lifetime, remains a positive safe integer, and never wraps.

The sender writes one business record and then its same-direction ledger. Each pipe is decoded FIFO; the receiver pairs the earliest pending business record with the earliest pending ledger for that channel. A forward sequence gap discards staged state and requests resync without applying the pair. Rewind, duplicate, wrong direction, byte mismatch, extra ledger, pending overflow, partial EOF, or unpaired data at shutdown/fatal/EOF is fatal. A missing ledger has no timer; it fails only at a deterministic pending limit or channel termination. Fatal and `request_resync` are mutually exclusive.

## Projection publication and patch rules

One projection publication has a monotonic `publicationRevision` scoped to the child lifetime. The host sends `projection_window` records with unique contiguous indexes starting at zero, followed by `projection_commit` with `totalWindows`. Empty state still sends one empty window and `projection_commit(totalWindows: 1)`. Windows contain business projections only and carry no sequence, acknowledgement, retry, routing, health, debug, or lifecycle fields.

`architecture/projection-window-budget.yaml` owns the per-window, per-publication, history, catalog, and staged-byte limits. The protocol schema, verification map, and test design reference that single budget manifest.

Rust stages one publication revision while leaving the previous render model visible. It atomically replaces the model only after all indexes in `[0, totalWindows)` are present exactly once and `projection_commit` agrees. A new publication cannot replace an incomplete stage, and a patch cannot arrive while staging. Missing windows at commit, duplicate indexes, mixed publication revisions, or a legal forward sequence gap discard the stage and request resync. Malformed records, wrong family or direction, one oversized window, aggregate budget overflow, or partial EOF are fatal. Child restart discards staging and starts with a new full projection window sequence.

`transcript_patch` is applied atomically only when its paired control sequence is the next expected value and `baseRevision` equals the current publication revision. Otherwise the child applies nothing and sends `request_resync`. The host then stops patch generation and sends one fresh windowed projection publication after available capacity is acknowledged.

The host queue limits are 256 records and 16 MiB per channel. A projection queue reaching either limit becomes saturated. While saturated, the scheduler marks one pending windowed projection publication and produces no further patches. Existing queued records are not dropped or treated as acknowledged. Business actions are never coalesced or dropped; saturation disables submit controls and is visible as bridge backpressure until capacity returns.

## Canonical cells and display AST

The first canonical cell header is:

```ts
interface CanonicalCellHeader {
  cellId: string
  revision: number
  anchorSeq: number
  turn?: number
  step?: number
}
```

Cell variants are `user`, `context`, `assistant`, `reasoning`, `tool`, `command`, `retry`, `compaction`, `turn_error`, `max_tokens`, `workflow`, `trajectory`, and `unknown`. `tool` is already paired and includes nested calls plus presentation intent. Rust has no call-id join table.

`revision` above is presentation data: it identifies semantic replacement of one cell. It is not a bridge sequence, retry counter, acknowledgement, or connection state.

Display AST variants are `paragraph`, `heading`, `text`, `emphasis`, `strong`, `delete`, `link`, `inline_code`, `code`, `list`, `list_item`, `quote`, `thematic_break`, `table`, `table_row`, `table_cell`, `math`, `image`, and `line_break`. Each variant has explicit fields. An unknown variant is a protocol incompatibility, not plain-text fallback.

Images are represented as attachment references and alt text. The first renderer displays a stable attachment row and can invoke the Host open/read action. Terminal graphics protocols are not required for v1 semantic parity.

## Rust renderer

The Rust workspace contains one `dsh-tui` binary. Initial dependencies are `ratatui`, `crossterm` with bracketed paste and event stream, `serde`, `serde_json`, `thiserror`, `tokio`, `unicode-segmentation`, and `unicode-width`. It does not depend on a Markdown parser, HTTP client, DSH SDK, or Codex crates.

Modules:

- `app.rs`: event loop and orthogonal local UI state;
- `model.rs`: revision-fenced business model;
- `action.rs`: key-to-intent resolution independent of bridge encoding;
- `history_cell.rs`: canonical cell and display AST rendering;
- `chat_widget.rs`: transcript viewport and reflow cache;
- `bottom_pane/`: composer, interaction, queue, command and picker modes;
- `status_bar.rs`: composed DSH facts and bridge state;
- `session_picker.rs`: session/workspace navigation;
- `terminal_guard.rs`: enter, suspend, resume, panic-hook restoration, and idempotent drop;
- `protocol/`: four channel codecs only.

Codex TUI is a layout and terminal-lifecycle reference. Its app-server protocol, business state, Markdown parser, login, configuration, and approval vocabulary are not imported.

The render cache key is `(cellId, cellRevision, width, disclosureRevision)`. Resize invalidates width-specific lines but never business cells. Streaming changes invalidate only the changed cell. Scroll anchoring retains the top visible cell and wrapped-line offset unless follow-tail is active.

## Terminal lifecycle

Binary and pipe validation complete before raw mode. `TerminalGuard` then enables raw mode, alternate screen, bracketed paste, focus change events, and hides the cursor. Restoration runs idempotently on normal return, handled signal, host EOF, protocol fatal, panic hook, suspend, and destructor cleanup.

On Unix suspend, the app restores terminal state, raises `SIGTSTP` for its own PID, then re-enters modes and requests a full redraw after resume. On Windows, saved console modes and exact restoration are covered by the target-specific PTY/console lane.

## Package and release

Contributor builds use the checked-in `native/Cargo.lock`. Published packages include prebuilt binaries and no install script. Detailed design activates these targets only after their package and PTY lanes exist:

- phase 1: `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`;
- phase 2: `aarch64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`.

Each `bin/<target>/manifest.json` contains package version, protocol range, target, filename, byte length, and SHA-256. `select-binary.mjs` maps exact `process.platform/process.arch` pairs, verifies the manifest and hash, and returns one absolute path. Unsupported targets fail before child spawn. There is no source build or alternate renderer fallback. CI builds each target in an isolated job, runs its native unit/package lane, emits the manifest beside the binary, and assembles the npm artifact only from those verified outputs. This plugin has its own `package.json`, lockfiles, tests, CI, release artifacts, and version; it is not a workspace package of DSH or another plugin.

## Implementation gates

Implementation starts only after `gate.implementation.admission` passes: this document and the architecture maps pass `pnpm run check:design`, all seven projection owner entrypoints are verified from a clean registry installation, the 50 Host bindings remain verified, the approved N/A remains exact, and no capability is blocked. Runtime completion additionally requires Node tests, Rust tests/clippy/fmt, semantic fixture replay, real PTY restoration, `npm pack` inspection, isolated-profile install, and one installed real-provider session. `cordis.patch.yml` remains empty until the plugin-owned presentation and bridge contract tests exist.

## Design approval state

- [x] Eight capability dispositions approved by Jason
- [ ] Required owner exports published in an installable DSH RC
- [ ] Clean registry-only installation passes `check:design`
- [ ] Codec/runtime admitted: 50 Host bound + 7 projection bound + 1 approved N/A + 0 blocked
- [ ] Implementation passes tests/build/install/online verification
- [ ] DSH Review passes after installed real-session verification
- [ ] Uploaded tree and commit-versus-parent diff match the reviewed tree and diff evidence
