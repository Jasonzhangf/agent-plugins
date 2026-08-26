# TUI transport contract

Status: design contract; runtime implementation not admitted.

## Endpoint truth

The transport owner resolves exactly one canonical loopback origin before constructing any API or Remote carrier. Precedence is deterministic:

1. CLI `--endpoint <origin>`;
2. environment variable `DSH_WEB_URL`;
3. the official composed Web default `http://127.0.0.1:3080`.

There is no port scan, browser-origin inference, config-file search, LAN discovery, alternate host retry, or fallback after a selected origin fails. `--endpoint` and `DSH_WEB_URL` must be absolute `http:` origins whose hostname is loopback (`127.0.0.1`, another `127/8` literal, `localhost`, or `[::1]`), with no username, password, query, fragment, or non-root pathname. Invalid input fails before terminal activation. The endpoint is a typed control resource and never enters Session requests, events, projections, fixtures, logs, or component props.

The default is justified only by the official Web composition's `127.0.0.1:3080` default. When `dsh --profile web` uses `--port`, including port `0`, the caller must pass the printed canonical URL through `--endpoint` or `DSH_WEB_URL`. Failure of `host.describe` at the selected origin is fatal and reports that exact origin; the TUI does not probe another port.

The installer installs the TUI command and profile but does not persist a live endpoint. Endpoint selection belongs to each invocation because the official Web port may change between boots.

## Node carrier

`NodeApiClient` is the sole HTTP/WebSocket ApiProxy carrier:

```ts
class NodeApiClient extends AbstractApiClient {
  constructor(private readonly endpoint: URL, timeoutMs?: number)
  protected override resolveBase(): string
  protected override doFetch(input: URL, init?: RequestInit): Promise<Response>
  protected override openMux(...): AsyncIterable<RpcRequest<MuxFrame>>
  protected override openHost(...): AsyncIterable<RpcRequest<HostFrame>>
}
```

It imports `AbstractApiClient` only from the clean-registry public export `@deepseek-ai/dsh-host-apiproxy/client`. `resolveBase()` returns the validated endpoint origin. `doFetch()` delegates to Node's global `fetch`. `openMux()` and `openHost()` use the published frame schemas and one downlink WebSocket each. The generic Remote carrier uses the same endpoint resource and RPC envelope schemas; it cannot call the browser-only `createWebConnectionRpc()` because that function resolves `globalThis.location`.

Clean-registry admission must prove `AbstractApiClient`, `IApiClient`, the required API/frame/RPC schemas, and the protected override points exist in installed `.d.ts` and build artifacts.

## Selected Remote contributions

The TUI does not mount `@deepseek-ai/dsh-api-remotes/client`; that assembly would also mount the unrelated dynamic Cordis namespace. The TUI generic Remote service mounts only these owner exports:

- `@deepseek-ai/dsh-commands/remote`;
- `@deepseek-ai/dsh-goal/remote`;
- `@deepseek-ai/dsh-message-feedback/remote`;
- `@deepseek-ai/dsh-host-plugin-inventory/remote` when the inventory overlay is composed.

Every contribution is a separate Cordis row with effect-owned disposal. Absence of a selected public export blocks only its capability. No private import or flattened replacement Remote is permitted.

## Current-cwd resume fence

The canonical cwd is `realpath(process.cwd())`. A resume candidate is eligible only when `SessionSummary.cwd` is present and `realpath(summary.cwd)` equals it exactly. The official field is a `header.cwd` passthrough and may be absent when unrecorded; absence is therefore an explicit rejection, not an invitation to inspect logs, infer a workspace, compare titles, or attach optimistically.

An unknown Session ID, absent cwd, invalid cwd, failed realpath, or different canonical cwd fails the resume request without creating a replacement Session. Startup without `--resume` remains the only path that creates a new current-cwd Session.
