# DSH Multi-Key Provider

- The runtime deliverable is the standalone package `dsh-llm-pi-ai-multikey`.
  It manages the installed DSH profile and does not require a Harness source
  checkout at runtime.
- Cordis patch `name` is a target-entry guard. Replacement composition must
  disable `llm-pi-ai` and `ui-settings-models` by their exact official names,
  then insert the independent `llm-pi-ai-multikey` entry.
- The replacement owns the original pi-ai Provider routes, `llm-pi-ai`
  settings namespace, and `settings.section:models`. It must not add
  `multikey/*` Provider routes or intercept `llm/stream`.
- Multi-key controls belong only inside the configured pi-ai
  `ProviderEditor`. Unconfigured Providers remain absent from the Models list
  and appear through the official add-Provider flow.
- `apiKeyEnv` remains the primary credential. Optional `apiKeyPool` contains
  only credential references and policy. Credential values are written and
  resolved through the credential service and never enter settings, model
  requests, response chunks, metadata, logs, or control projections.
- Key advancement is allowed only for explicit credential/account failures
  before the first business output. Output commitment, server, timeout,
  transport, abort, request, context, model, and unknown failures never switch.
- Session-scoped `QUOTA` and `RATE_LIMIT` failures must release the process-wide
  trial reservation before recording session-local health; otherwise later
  requests without a session cannot select the key.
- Removing the last alternate unsets `apiKeyPool`, restoring the official
  single-key posture. Sequential settings mutations must use the revision
  returned by the previous mutation.
- Recovery evidence requires uninstalling the bundle, removing it from the
  profile bundle list, an exact PID/service restart, dump-config proof that
  official Provider/Models owners are active, and original-path replay.
- Verified package baseline: `dsh-llm-pi-ai-multikey@0.1.4`, 39 tests,
  `REGISTRY_GATE: PASS`, build pass, and `PACK_GATE: PASS (38 files)`.
- Installed and restored profile verifiers require explicit
  `unique_owner_counts` runtime evidence; a live YAML dump alone does not prove
  unique route, namespace, or Models-section ownership.
