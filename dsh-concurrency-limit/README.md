# dsh-concurrency-limit

A standalone DeepSeek Harness plugin (out-of-tree bundle) that caps concurrent model requests per conversation window, adjustable live from the web GUI. It lives outside the dsh repository so the harness checkout stays clean; install it into a profile with `dsh plugin add`.

## What it does

- **Per-session model-request cap** (`llm/stream`): a FIFO semaphore bounds in-flight model requests per session; the deployment config value is the default and each session can override it live. `1` = one request at a time for that window; omitted = uncapped unless overridden.
- **Global tool-call cap** (`tools/execute`): a second FIFO semaphore bounds tool bodies process-wide from config only (the UI controls requests, per the product decision).
- **Live, per-window UI control**: a stepper in the conversation composer tool row (`conversation.input.right`) shows the current cap and adjusts it on the spot, independently for each conversation window.
- **Persisted per session**: the override is a session-log event (`concurrency/request-cap`), so resume and fork rebuild the same cap; the UI reads the `concurrencyLimits` projection and writes through the `/concurrency` command.

Both wrappers are abort-aware (a queued caller whose signal aborts is removed from the queue, never hung) and FIFO.

## Development

Install this repository's declared dependencies and build against the official
published DSH packages. The plugin does not resolve types or build tools from a
DSH source checkout or from a profile's shared `node_modules` tree.
The repository pins the public npm registry for the `@deepseek-ai` scope and
locks the exact DSH release-candidate versions used by development and CI.

```sh
pnpm install --frozen-lockfile
pnpm run check
```


## Install

Build the plugin first, then install the checkout into a development profile:

```sh
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add .
```

The profile init adds `@deepseek-ai/dsh-base` (and `@deepseek-ai/dsh-web-app` for a web profile) as its first bundles and appends this bundle. For a git install, pnpm runs the `prepare` script which builds `lib/` from source; allow the build in the profile's `pnpm-workspace.yaml` (`allowBuilds`) the first time. Stable profiles should install a prebuilt npm version or tarball instead of a mutable checkout.

Verify the layer, then boot:

```sh
dsh --profile web --dump-config   # shows a "# == dsh-concurrency-limit" layer
dsh --profile web
```

## Configuration

The bundle patch inserts the plugin row with neutral defaults; override by id in the profile's `cordis.patch.yml`:

```yaml
- id: concurrency-limit
  name: 'dsh-concurrency-limit'
  config:
    maxConcurrentToolCalls: 8      # tool bodies process-wide; 1 = fully serial
    maxConcurrentRequests: 4       # default per-session model-request cap
```

Both caps must be positive integers when present. The per-session override starts from `maxConcurrentRequests`; `reset` in the UI restores it.

## Usage

- Click the stepper in the composer tool row (beside the model selector): `−` / `+` adjust the current window's concurrent-request cap; `↺` restores the deployment default. Each conversation window has its own cap.
- Slash command: `/concurrency` (show), `/concurrency set N` (set), `/concurrency reset` (restore default).

## Model Experience

### Conditional call delay

#### What the model sees

This plugin adds no prompt, tool schema, or result content. Its only effect is timing: a model request may wait in the FIFO queue until a slot frees, and a request cancelled while queued settles with the canonical aborted finish instead of running.

#### Token effect

Zero direct tokens. Delayed requests consume no additional context.

#### KV Cache effect

Independent. The guard neither alters request prefixes nor injects content, so it does not invalidate existing KV-cache reuse.

## Known Limitations and Deferred Work

- **Process-local only** — the caps apply within one composition/process. Out-of-process subagent providers (ACP, Claude Code, Codex, dsh-sdk) run their own harness instances and are not throttled by this plugin.
- **No per-tool or per-provider differentiation** — both caps are flat ceilings; selective budgets are not implemented.
- **Session-less auxiliary requests share the global default** — `llm/stream` calls without a session id (e.g. session-title) use `maxConcurrentRequests`, never a window override.
- **No dynamic reconfiguration of the defaults** — the deployment defaults are fixed at load; the per-session override is the live knob.
