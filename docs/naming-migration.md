# Naming migration

## Canonical names

- Repository: `agent-plugins`
- Terminal client: `agent-tui`
- Memory plugin: `agent-memory` (not present in the current `origin/main` snapshot; its implementation remains in the separate memory worktree until an explicit integration change set is approved)
- Concurrency plugin: `agent-concurrency-limit`
- Host: OpenCode

## Compatibility boundary

Published third-party package identifiers under `@deepseek-ai/dsh-*`, immutable historical evidence, and old host reference URLs are not first-party names and remain unchanged until a separately versioned compatibility migration is approved.

The current branch removes old first-party directory paths, package IDs, CLI identity, workflow filenames, patch IDs, and active governance root paths. Historical plan text still requires a follow-up documentation-only cleanup before the migration can be called fully closed.
