# Markdown conformance contract

The TUI parser is independently implemented, but “aligned with WebUI” means fixture-level semantic equivalence, not a general claim of GFM compatibility.

## Pinned source corpus

Reference source is DSH commit `47f943859bef60e4160492346772ded9b24f765a`:

- `packages/client/ui-primitives/src/markdown/parse.ts`;
- `packages/client/ui-primitives/src/markdown/incremental.ts`;
- `packages/client/ui-primitives/src/markdown/mathCompatibility.ts`;
- `packages/client/ui-primitives/tests/markdown-dom-parity.client.spec.tsx`;
- `packages/client/ui-primitives/tests/markdown-incremental.client.spec.tsx`;
- `packages/client/ui-primitives/tests/fixtures/markdown-dom/*.settled.txt`;
- `packages/client/ui-primitives/tests/fixtures/markdown-dom/*.streaming.txt`.

The TUI repository will contain a provenance manifest with the pinned DSH commit, source paths and hashes, plus independently expressed input and expected semantic-token fixtures. It does not copy Web React renderers or CSS.

## Required parity

The conformance gate compares normalized semantic tokens, not DOM or terminal styling. It covers:

- headings, paragraphs, hard breaks and horizontal rules;
- tight, loose and nested lists;
- task-list checked state;
- tables and alignment;
- blockquotes;
- strikethrough, emphasis and CJK-adjacent strong text;
- inline code, fenced code, info strings and incomplete fences;
- links, autolinks, reference links and sanitized destinations;
- entities, escapes, images and footnotes;
- inline/display math and compatibility delimiters;
- raw HTML suppression;
- streaming partial constructs and settled reparse.

Streaming uses a GFM-only grammar so incomplete TeX does not flash a math error. Settled text reparses the full document with GFM plus math. A non-append update resets the incremental generation. Reference definitions or footnotes crossing the frozen boundary may remain literal while streaming but must self-heal on settled full parse, matching the documented official behavior.

User, context and steering messages remain literal text. Only assistant presentation blocks enter Markdown parsing.

## Gate outcome

Any missing fixture, token-kind mismatch, source corpus hash drift, or unapproved divergence blocks `presentation.markdown`. Rendering differences caused solely by terminal width or absence of browser affordances are recorded separately and cannot change parsed semantics.
