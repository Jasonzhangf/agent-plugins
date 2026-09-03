# agent-memory OpenCode adapter

This package is a thin OpenCode-facing adapter. It transports tool-call, end-turn,
compaction-summary, recall, and organization requests to the typed Rust Core
bridge. It does not validate memory entries, organize knowledge, or implement
fallback behavior. Missing or malformed memory responses remain Core-owned soft
admission outcomes.
