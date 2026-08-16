# dsh-tui memory

## Runtime admission lock

- Runtime work is admitted only after the capability manifest dynamically reports 50 verified Host bindings, 7 verified projection bindings, 1 Jason-approved N/A, zero blocked prerequisites, and a clean registry installation of published DSH RC packages.
- Local DSH checkout `package.json`, source, `lib/`, or `.d.ts` files are source-audit evidence only. They cannot satisfy installable-release verification.
- The seven projection dispositions retain their current DSH owners and remain blocked only on owner artifact publication. `browser.theme-layout` is the sole approved N/A because it carries no DSH business operation.
- Blocked runtime stubs, private imports, fake success, empty projection, codec work, and runtime work are forbidden before admission.
- DSH Review and commit/upload belong to release admission after implementation, build, install, and online verification; they cannot block implementation admission.
- Clean-registry admission is established from each installed package realpath, package version, and lockfile registry integrity; `checkout_links_detected` is corroborating metadata, not proof.
- Release identity is the reviewed staged tree plus its binary full-index diff. The uploaded commit tree and commit-versus-parent diff must match, and DSH Review PASS is parsed from the review evidence directory rather than trusted from a manifest status field.
- `projection_window`, `projection_commit`, and `publicationRevision` are business projection terms. Snapshot, resync, sequence, acknowledgement, and lifecycle state remain control-only.
- Memory index maintenance is scoped: rebuild FTS5 only after a full archive, then apply stale cleanup to the exact wing/root. Global dry-run results containing unrelated intentional ignored files do not authorize global deletion.

## Config-driven runtime decision

- `dsh-tui` is an independent configuration-driven bundle. Its runtime composes the public Agent, Session, LLM, and persistence services already shipped by DSH; it does not require a DSH monorepo source change or a new upstream package release.
- Web client presentation packages are reference implementations, not runtime prerequisites. The first usable TUI projects the public `Session.deriveMessages()` result plus live `assistant/chunk` state in the Node host, parses Markdown there, and sends terminal-neutral display lines to Rust.
- The install boundary is `dsh plugin --profile tui add <dsh-tui package>` followed by `dsh --profile tui`. A design-only admission manifest cannot block this plugin-owned runtime.
