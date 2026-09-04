---
name: agent-plugins-governance
description: Shared advisory Guidance procedure for the four first-party agent-plugins projects.
---

# agent-plugins Guidance

Use this Skill for repository-level feature work, debugging, validation, and
closeout across `agent-tui`, `agent-memory`, `Teams`, and
`dsh-concurrency-limit`. It complements the installed AppSDK governance Skill;
it does not create a second lifecycle or record store.

## Start with declared context

Resolve the current repository root from the inherited working directory. Read
the root `AGENTS.md`, `note.md`, `MEMORY.md`, current worker run notes, root
resource/function/mainline/verification/module maps, relevant records, and the
selected child project's own `AGENTS.md`, notes, memory, maps, and contracts.
Read only rule sources declared by the root and selected child project contracts;
RouteCodex is a generic Guidance reference, not an additional rule source.
Run `appsdk guide status <project>` and use only its declared next command.

Bind the current goal, project, module, owner, allowed/forbidden paths, adjacent
call edges, environment, and required gates before source edits. Search prior
run notes, records, and retry decisions before repeating an experiment or failed
command. If any bound project, goal, source, scope, owner, rule, gate,
dependency, or environment context changes, revise the AppSDK plan; never edit
plan or event history by hand.

The root maps describe cross-project ownership. The selected child's maps are
the source of truth for implementation edges. `agent-memory` is a required
fourth project but is pending while it is absent from the current root
baseline; do not invent a path, owner, or active module for it.

## Feature procedure

The feature workflow has a mandatory spine and explicit optional bypasses:

```text
requirements -> map_check -> [architecture] -> implementation -> candidate
-> validation -> [map_update] -> review -> [effectiveness] -> integration
-> [promotion] -> cleanup
```

`requirements`, `map_check`, `implementation`, `candidate`, `validation`,
`review`, `integration`, and `cleanup` cannot be skipped. `map_check` reads the
selected project's actual function and verification maps before source edits;
when the project declares the v3 architecture surface, that includes
`docs/architecture/v3-function-map.yml` and
`docs/architecture/v3-verification-map.yml`. `architecture` is optional when
the existing design and map already cover a small change. `map_update` is
required only when feature, owner, path, or gate bindings change.

`effectiveness` is selected for runtime or higher-risk changes, and `promotion`
is selected when immutable Active/Protected delivery is required. A bypass is
an explicit one-line decision in the run notes; advisory mode permits choosing
the minimum depth, not omitting the mandatory spine.

Before implementation, bind the goal, module, unique owner, allowed paths,
forbidden paths, adjacent call edges, and required gates. Use one clean owner
worktree from the latest `origin/main`.

Before adding behavior, perform the ablation check: confirm the behavior is
necessary, no declared owner already provides it, and common semantics can use
an existing shared function. Prefer declared operation, hook, gate, or shared
configuration over inline branching or duplicate helpers.

## Debug procedure

Every debug task uses this chain:

```text
orient -> explore -> resolve -> candidate -> validation -> review -> integration -> cleanup
```

`orient` is mandatory: locate the problem in the real function map and its
verification gates before changing code. If the function map is missing, record
that governance gap and add the binding after the fix through its unique owner.
Read the relevant resource map before the function map, then the mainline call
map, verification map, source, notes, records, and historical results.

`explore` must append each meaningful reproduction, hypothesis, experiment,
first divergence, falsification, and causal result to the current worker's
`.agent-collab/runs/<run_id>/notes.jsonl`. Keep one active hypothesis at a time.
When feasible, prove the cause with both forward and reversal interventions.

`resolve` changes only the unique owner and adds paired positive/negative
regression coverage for state, stream, timeout, retry, or error behavior. If a
verified change alters a function edge, resource relation, or required gate,
update every affected root/child declaration in the same owner scope. Never
patch an output layer to compensate for an upstream contract error.

Control truth (routing, retry, provider selection, lifecycle, diagnostics,
environment, snapshots, and governance) stays in typed control resources,
declared configuration, error chains, or records. It never enters business
payloads, metadata, logs, or implicit context. New implementations are reviewed
against this boundary, unique ownership, no-fallback, ablation, and
configuration-first rules; untouched historical violations are not silently
rewritten.

## Validation and closeout

Choose focused tests first, then the affected project gates, build, install,
restart, and real public-entrypoint replay when the change is runtime-visible.
Source tests or a worktree binary are not user-entry evidence. Bind each passing
required step to its own evidence; do not infer install, restart, review,
integration, promotion, freeze, or cleanup from an earlier level. Use the
declared `review`, `delivery`, `integration`, `promotion`, `freeze`, and
`cleanup` workflows when their scope requires them. Do not claim a lifecycle
stage before its canonical records and receipts exist.

At task end, re-read the applicable `AGENTS.md`, project-local Skills, and
`MEMORY.md`. Append only verified reusable project facts to `MEMORY.md`; leave
raw run notes append-only. Review whether the task exposed a reusable rule or a
missing hard boundary; update the unique owning Skill or AGENTS file only when
the evidence supports it. After the required delivery/remote receipt, remove
only this task's clean owner worktree and release only this task's claim.

## Hard boundaries

- Enforcement is advisory; `guide plan`, `guide update`, and `guide next` are
  status/recommendation state, not a mandatory evidence loop for every tiny edit.
- Prefer adjacent transitions. Optional architecture, map_update,
  effectiveness, and promotion nodes require an explicit bypass decision; the
  mandatory feature/debug spine remains intact.
- Use the local AppSDK; its binary byte digest is not a governance admission
  condition.
- Preserve child maps, lifecycle records, Active, Protected, evidence, claims,
  mailboxes, journals, and other workers' worktrees.
- Keep control data (routing, retry, provider choice, lifecycle, diagnostics,
  environment, snapshots, and governance) out of business payloads.
- No fallback, silent downgrade, fabricated record/hash/receipt/timestamp, or
  remote CI AppSDK gate as a substitute for local verification.
