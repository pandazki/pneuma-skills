---
paths:
  - "src/**"
  - "modes/*/viewer/**"
  - "index.html"
  - "player.html"
---

# Frontend Rules (React / Vite / viewers)

## Baseline

- **Zustand** sliced store (`src/store/`, 10 protocol-aligned slices); mode viewers live in `modes/<mode>/viewer/`.
- **Design tokens**: "Ethereal Tech" theme via `cc-*` CSS custom properties (deep zinc bg `#09090b`, neon orange primary `#f97316`, glassmorphism surfaces with `backdrop-blur`). New UI must use the tokens, not ad-hoc colors.
- **Visual verification is mandatory**: after modifying viewer components, CSS, or any UI-facing code, use an available browser tool (such as `chrome-devtools-mcp`) to screenshot the running dev server and verify before reporting completion. Do not judge visual correctness by reading code alone.
- **No emoji in UI elements** — use SVG icons or text labels.
- **No native form-control chrome in any user-facing surface** (viewers, session UI, launcher): a bare `<select>`, default-styled `<input>` (checkbox/radio/range/date), `<progress>` etc. renders OS-native widgetry that clashes with the Ethereal Tech theme. Either fully restyle the element (`appearance-none` + `cc-*` tokens, including the popup where the platform allows) or build a custom component styled with the tokens; when the platform popup cannot be styled (classic `<select>` dropdown), build the custom component. A default-styled control shipping to users is a defect, not a polish item. (Rule set 2026-08-25 — eli5's compare picker shipped a native `<select>` and was called out on first user contact.)

## Before changing a viewer or shared UI

- Read the root product and architecture guidance and Engineering Judgment.
  Check the affected `ViewerContract`, Source, and `ViewerAddress` boundaries.
- Use `sources` + `fileChannel`; `ViewerPreviewProps.files` is a compatibility
  shim. Report unresolved navigation through `onNavigateComplete(result)`.
- For observation and visual verification, use your own `--viewing` session.
  Flipping editing on can resume an agent that reacts to queued notifications
  and modifies files. Do not use another session as a test fixture.
- Account for the shared shell, empty sessions, and the selected backend's
  capabilities. A missing `modeViewer` is a normal empty-shell state.

## Read the matching implementation records

Read the linked section before changing or verifying that concern. These records
include concrete incidents and later corrections; use the current contract and
implementation to assess an older diagnosis. They live outside `.claude/rules/`
so unrelated work does not automatically load every incident.

| When working on | Read |
|-----------------|------|
| Vite/HMR, worktrees, entry assets, fonts, panel APIs, service workers | [Build and asset delivery](../references/frontend-gotchas.md#build-and-asset-delivery) |
| Overlays, stacking, pointer targets, shell controls, galleries, focus | [Layout and interaction](../references/frontend-gotchas.md#layout-and-interaction) |
| Animation, typography, canvas/SVG geometry, masks, rendering performance | [Rendering and measurement](../references/frontend-gotchas.md#rendering-and-measurement) |
| Screenshots, iframe capture, thumbnails, browser automation | [Capture and browser verification](../references/frontend-gotchas.md#capture-and-browser-verification) |
| Source data, mode identity, chat/cost display, navigation, video, notifications | [Viewer and session contracts](../references/frontend-gotchas.md#viewer-and-session-contracts) |
| GridBoard compilation or Diagram rendering | [GridBoard and Diagram](../references/frontend-gotchas.md#gridboard-and-diagram) |

Keep this file focused on shared rules and routing. Add detailed evidence to the
matching reference section; add a new trigger here when an existing row would
not lead a reader to it.
