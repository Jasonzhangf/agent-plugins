# Cairn 源码固定

## Source identity

- Remote: `https://github.com/chenhw7/dsh-memory.git`
- Exact HEAD: `016d2ca272c57ee5fbc0923da34a75965639abd0`
- Tag ancestry: `v0.8.0-25-g016d2ca`（HEAD 不在 release tag）
- Package identity: `@chenhw7/dsh-memory@0.8.0`
- License: MIT

## Reusable design reference

- `src/store/index.ts:46-122` defines durable memory entry/domain shapes and the `memory` service.
- `src/store/bm25.ts:1-247` provides dependency-free BM25 ranking.
- `src/tool/index.ts:1-93` registers model-facing memory tools.
- `src/remote/index.ts:1-90` exposes a UI-facing remote service over the same memory service.

## Boundary

Cairn is a reference for store/index/search/tool composition only. Its implementation is not copied into dsh-memory. Our Pending Index, append-only revision/evidence ledger, organization epochs, mandatory emission contract, and DSH compaction transaction are new semantics and remain owned by dsh-memory-core.

