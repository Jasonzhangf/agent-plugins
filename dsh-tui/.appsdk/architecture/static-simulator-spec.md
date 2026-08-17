# Static TUI simulator specification

The simulator is a review artifact for the TUI, not a replacement WebUI. It has no network client, credentials, Session mutation, local persistence or runtime plugin discovery.

## Inputs and render boundary

Its only input is a versioned fixture bundle containing canonical `TuiViewNode` values, typed BottomPane state, status selectors and viewport dimensions. The fixture is shared with terminal snapshot tests. Browser renderer plugins are separate from Ink renderer plugins and are registered by the same stable component kind IDs.

The simulator must visibly label fixture ID, viewport columns/rows, theme token set, node revision and interaction state. It may provide review controls for fixture and viewport selection, but those controls are outside the simulated terminal frame.

## Required fixture matrix

Every first-release component has cases at 40x12, 80x24 and 120x36. The initial approval set includes:

- empty new Session and focused multiline composer;
- user, context and steering messages;
- streaming and settled assistant text, reasoning collapsed/expanded and mixed CJK/emoji;
- Markdown headings, lists, tables, quotes, links, inline code, fenced code and math fallback tokens;
- generic, terminal, read, search, diff, workflow, skill and failed tool cards;
- root tool with subcalls, interrupted tool and large collapsed result;
- retry scheduled/started/cancelled, turn error, max tokens, compaction and unknown event;
- queue and steer state;
- approval, single/multi question, command picker and current-cwd resume selector;
- model, permission, agent preset and settings selectors;
- plan, goal, jobs, compact trajectory and plugin-inventory overlays;
- connecting, live, reconnecting, stale/rebaseline, fatal and host-EOF status;
- scrolled-away anchor, follow-tail, terminal resize and streaming reflow.

## Visual gates

The build emits deterministic HTML plus PNG captures for the required matrix. Fixture JSON schema validation, component-kind coverage and terminal/browser fixture parity run before visual review. Jason's approval records the fixture bundle hash; any later change to canonical nodes, theme tokens, layout rules or captures invalidates that approval.

Browser CSS may emulate terminal cells but cannot introduce browser-only business affordances. Accessibility labels and semantic DOM are review conveniences; they are not runtime requirements for the terminal carrier.
