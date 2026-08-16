---
schema_version: 1
status: design_review
feature_id: feature.tui.surface
owner: feature.tui.design
---

# dsh-tui Capability Matrix

Source audit date: 2026-08-16
DSH checkout: `/Volumes/extension/code/dsh` (branch: master)
DSH packages version: all `0.1.0-rc.5`

Legend:
- **bound**: public package entrypoint verified in the local built checkout `.d.ts`; `0.1.0-rc.5` is not published in the configured npm registry, so this is not runtime installability evidence
- **blocked**: disposition and owner scope are approved, but the required public owner artifact is not yet installable from the registry
- **N/A**: Jason-approved browser-only carrier with no DSH business operation

## Bound summary

All bound capabilities use the same in-process call path:
- **API calls**: `new InProcessApiClient(toFetchHandler(ctx.apiProxy))` — no network, no second runtime
- **Cordis services**: injected directly via `ctx.*` (commands, sessions, messageFeedback, pluginInventory)

## 1. Session capabilities

| capability_id | owner | face | package | direction | TUI status |
|---|---|---|---|---|---|
| session.new | upstream.host.apiproxy | IApiClient.sessions.create | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| session.list-open-switch | upstream.host.apiproxy | IApiClient.sessions.list + TUI-local projection selection | @deepseek-ai/dsh-host-apiproxy | read projection | bound |
| session.resume-history | upstream.host.apiproxy | IApiClient.sessions.history | @deepseek-ai/dsh-host-apiproxy | read | bound |
| session.rename | upstream.host.apiproxy | IApiClient.sessions.rename | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| session.archive | upstream.host.apiproxy | IApiClient.workspace.archiveSession | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| session.fork | upstream.host.apiproxy | IApiClient.sessions.fork | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| session.search | upstream.host.apiproxy | IApiClient.sessions.search | @deepseek-ai/dsh-host-apiproxy | read | bound |
| session.prompt | upstream.host.apiproxy | IApiClient.sessions.prompt | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| session.cancel | upstream.host.apiproxy | IApiClient.sessions.cancel | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| session.update-queue | upstream.host.apiproxy | IApiClient.sessions.updateQueue | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| session.attachment | upstream.host.apiproxy | IApiClient.sessions.attachment | @deepseek-ai/dsh-host-apiproxy | read | bound |
| session.models | upstream.host.apiproxy | IApiClient.sessions.models | @deepseek-ai/dsh-host-apiproxy | read | bound |
| session.select-model | upstream.host.apiproxy | IApiClient.sessions.selectModel | @deepseek-ai/dsh-host-apiproxy | mutation | bound |

## 2. Workspace capabilities

| capability_id | owner | face | package | direction | TUI status |
|---|---|---|---|---|---|
| workspace.list | upstream.host.apiproxy | IApiClient.workspace.list | @deepseek-ai/dsh-host-apiproxy | read | bound |
| workspace.create | upstream.host.apiproxy | IApiClient.workspace.create | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| workspace.rename | upstream.host.apiproxy | IApiClient.workspace.rename | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| workspace.delete | upstream.host.apiproxy | IApiClient.workspace.delete | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| workspace.reorder | upstream.host.apiproxy | IApiClient.workspace.insertBefore | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| workspace.move-session | upstream.host.apiproxy | IApiClient.workspace.insertSessionBefore | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| workspace.host-ops | upstream.host.apiproxy | IApiClient.host.* | @deepseek-ai/dsh-host-apiproxy | read+mutation | bound |
| subagent.navigate | upstream.host.apiproxy | IApiClient.subagents.list/history + TUI-local projection selection | @deepseek-ai/dsh-host-apiproxy | read projection | bound |

## 3. Conversation presentation

| capability_id | owner | face | package | direction | TUI status | note |
|---|---|---|---|---|---|---|
| transcript.projection | upstream.client.runtime.conversation | ConversationNodeAssembler + generic registries | @deepseek-ai/dsh-client-runtime | projection | **blocked** | Disposition approved; owner must publish platform-neutral ./presentation without moving the assembler or registry implementation. |
| transcript.markdown | upstream.client.ui_primitives | parseGfm, parseGfmWithMath, IncrementalMarkdownParser | @deepseek-ai/dsh-client-ui-primitives | projection | **blocked** | Disposition approved; parser implementation remains in ui-primitives and requires ./markdown. |
| transcript.core | upstream.client.ui_conversation | Chat definitions, owner-registered unknown-event definition, ChatSnapshotBuilder | @deepseek-ai/dsh-client-ui-conversation | projection | **blocked** | Disposition approved; no TUI fallback, and unknown protocol variants remain fatal. |
| transcript.tools | upstream.presentation.composition | dsh-tools intent + ui-conversation pairing/topology + ui-tool model | three owner packages | projection | **blocked** | Disposition approved; missing ui-conversation/ui-tool ./presentation exports. |
| transcript.workflow | upstream.client.ui_workflow_run | workflowRunDefinition | @deepseek-ai/dsh-client-ui-workflow-run | projection | **blocked** | No non-React ./presentation export. |
| transcript.trajectory | upstream.client.ui_trajectory | trajectoryViewDefinition | @deepseek-ai/dsh-client-ui-trajectory | projection | **blocked** | No non-React ./presentation export. |
| transcript.retry-errors | upstream.client.ui_conversation | Session-truth business failures via official projection | @deepseek-ai/dsh-client-ui-conversation | projection | **blocked** | Disposition approved; bridge/protocol/process errors remain Error/Control only. |
| conversation.commands | upstream.interaction.commands | CommandRuntime.execute | @deepseek-ai/dsh-commands | mutation | **bound** | ctx.commands.execute(agent, line, signal) |
| conversation.skills | upstream.host.apiproxy | IApiClient.skills.list | @deepseek-ai/dsh-host-apiproxy | read | bound |
| conversation.attachments | upstream.host.apiproxy | IApiClient.sessions.attachment | @deepseek-ai/dsh-host-apiproxy | read | bound |

## 4. Interaction capabilities

| capability_id | owner | face | package | direction | TUI status |
|---|---|---|---|---|---|
| interaction.approval | upstream.host.apiproxy | IApiClient.respond + ApiProxy.events.mux | @deepseek-ai/dsh-host-apiproxy | mutation+stream | bound |
| interaction.question | upstream.host.apiproxy | IApiClient.respond + ApiProxy.events.mux | @deepseek-ai/dsh-host-apiproxy | mutation+stream | bound |
| turn.plan-todo-goal | upstream.host.apiproxy | IApiClient.goals.* | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| interaction.plan-review | upstream.interaction.commands | CommandRuntime.execute(agent, '/plan', signal) | @deepseek-ai/dsh-commands | mutation | bound |
| selection.model-reasoning | upstream.host.apiproxy | IApiClient.sessions.selectModel | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| selection.permission | upstream.interaction.commands | CommandRuntime.execute(agent, '/permission', signal) | @deepseek-ai/dsh-commands | mutation | bound |
| selection.agent-preset | upstream.host.apiproxy | IApiClient.agentPresets.* | @deepseek-ai/dsh-host-apiproxy | read+mutation | bound |
| selection.preset-open-doc | upstream.host.apiproxy | IApiClient.agentPresets.openDocument | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| subagent.prompt | upstream.host.apiproxy | IApiClient.subagents.prompt | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| subagent.interrupt | upstream.host.apiproxy | IApiClient.subagents.interrupt | @deepseek-ai/dsh-host-apiproxy | mutation | bound |

## 5. Status, jobs, feedback

| capability_id | owner | face | package | direction | TUI status |
|---|---|---|---|---|---|
| status.session-turn-tools | upstream.host.apiproxy | ApiProxy.events.mux (stream) | @deepseek-ai/dsh-host-apiproxy | stream | bound |
| jobs.list | upstream.host.apiproxy | ApiProxy.events.mux (stream) | @deepseek-ai/dsh-host-apiproxy | stream | bound |
| message.feedback | upstream.feedback.message_feedback | MessageFeedbackService.@Remote(list/put/delete) | @deepseek-ai/dsh-message-feedback | read+mutation | bound |

## 6. Settings & configuration

| capability_id | owner | face | package | direction | TUI status |
|---|---|---|---|---|---|
| settings.describe | upstream.host.apiproxy | IApiClient.settings.describe | @deepseek-ai/dsh-host-apiproxy | read | bound |
| settings.update | upstream.host.apiproxy | IApiClient.settings.update | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| settings.replace | upstream.host.apiproxy | IApiClient.settings.replace | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| settings.mutate | upstream.host.apiproxy | IApiClient.settings.mutate | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| settings.open-document | upstream.host.apiproxy | IApiClient.settings.openDocument | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| credentials.describe | upstream.host.apiproxy | IApiClient.credentials.describe | @deepseek-ai/dsh-host-apiproxy | read | bound |
| credentials.set | upstream.host.apiproxy | IApiClient.credentials.set | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| credentials.unset | upstream.host.apiproxy | IApiClient.credentials.unset | @deepseek-ai/dsh-host-apiproxy | mutation | bound |
| llm.providers | upstream.host.apiproxy | IApiClient.llm.providers | @deepseek-ai/dsh-host-apiproxy | read | bound |
| llm.models | upstream.host.apiproxy | IApiClient.llm.models | @deepseek-ai/dsh-host-apiproxy | read | bound |
| llm.discover-models | upstream.host.apiproxy | IApiClient.llm.discoverModels | @deepseek-ai/dsh-host-apiproxy | read | bound |
| plugin.inventory | upstream.host.plugin_inventory | PluginInventoryGateway.@Remote(list) | @deepseek-ai/dsh-host-plugin-inventory | read | bound |
| plugin.cordis | upstream.extensions.cordis_host_runner | DynamicCordisRunnerService.@Remote(...) | @deepseek-ai/dsh-cordis-host-runner | mutation | bound |
| browser.theme-layout | feature.tui.renderer | terminal-local layout only | dsh-tui | presentation-local | **N/A** |

## Summary

The YAML binding manifest is the status truth. This table uses the same capability IDs and contains exactly one row per ID. Counts are computed by `pnpm run check:design`; no prose count is authoritative.

Current machine state: 50 Host capabilities are source-artifact bound, 7 projection capabilities are disposition-approved but owner-artifact blocked, and 1 capability is approved N/A. Implementation admission requires 50 Host bound + 7 projection bound + 1 approved N/A + 0 blocked from clean registry artifacts.

## Approved dispositions awaiting DSH owner artifacts

| capability_id | owner | expected export | approval | release prerequisite |
|---|---|---|---|---|
| transcript.projection | @deepseek-ai/dsh-client-runtime | `./presentation` | approved by Jason | Publish assembler and generic registries without mounting the Web object layer; implementation ownership does not move. |
| transcript.core | @deepseek-ai/dsh-client-ui-conversation | `./presentation` | approved by Jason | Publish existing Chat definitions, owner-registered unknown-event definition, and `ChatSnapshotBuilder`. |
| transcript.tools | dsh-tools + ui-conversation + ui-tool | existing `dsh-tools/presentation`; new `./presentation` on both UI packages | approved by Jason | Publish pairing/topology and terminal-neutral `ToolPresentationModel`; ownership remains split. |
| transcript.retry-errors | @deepseek-ai/dsh-client-ui-conversation | `./presentation` | approved by Jason | Publish only owner-written Session-truth business failure definitions. |
| transcript.workflow | @deepseek-ai/dsh-client-ui-workflow-run | `./presentation` | approved by Jason | Publish `workflowRunDefinition`. |
| transcript.trajectory | @deepseek-ai/dsh-client-ui-trajectory | `./presentation` | approved by Jason | Publish definitions and `trajectoryViewDefinition`. |
| transcript.markdown | @deepseek-ai/dsh-client-ui-primitives | `./markdown` | approved by Jason | Publish `parseGfm`, `parseGfmWithMath`, and `IncrementalMarkdownParser`; parser ownership remains in ui-primitives. |

Approved N/A: `browser.theme-layout`. Browser theme/sidebar/DOM layout carry no DSH business operation; terminal layout remains renderer-local.

## TUI host call pattern

```ts
import { InProcessApiClient, toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
// No network, no HTTP, no second runtime
const client = new InProcessApiClient(toFetchHandler(ctx.apiProxy))
await client.sessions.prompt({ sessionId, mode: 'queue', content: [...] })

// Cordis services are injectable directly
ctx.commands.execute(agent, '/plan', signal)
ctx.messageFeedback.list({ sessionId })
ctx.pluginInventory.list()
```
