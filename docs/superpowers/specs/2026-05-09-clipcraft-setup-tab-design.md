# ClipCraft Setup Tab — surfacing the production bible / cast / settings / storyboards in the viewer

## The gap this fills

ClipCraft 0.9.0 ships a layered theory of AIGC video production
(Production Bible, Character Cards, Setting Cards, Storyboards,
Direction Notation). The theory lives in the agent's skill docs;
the artifacts the agent produces live as files on disk
(`setup/bible.md`, `setup/cast/<name>.{md,png}`, `setup/world/<name>.{md,png}`,
`storyboard/<id>/composite.png` + slices). **The viewer doesn't
recognize any of this.**

Today, when the agent generates a character card, the user sees:
- An untyped image asset in the asset library
- A markdown file invisible to the viewer
- No indication that this is a "character card" vs any other image

The strategic state of the project — *which layers are populated,
how many characters are cast, which storyboards exist* — is
unobservable in the UI. Only the agent (which has read the skill)
knows it. This spec adds a **Setup tab** that surfaces these
concepts as first-class content groups.

## Goals

1. **Detection by file convention** — surface bible / cards / storyboards from disk without changing `project.json` schema.
2. **A third tab in the existing AssetPanel** — alongside `assets` and `script`. Switching to `setup` shows the new content; existing tabs unchanged.
3. **Read-only rendering** — markdown rendered, images displayed. Editing flows through the agent (or the user's editor), not through this panel.
4. **Click → seek + select for storyboard panels** — clicking a panel slice in a storyboard seeks the playhead to that panel's previewFrame time (if registered) and selects the asset. Cards open a lightbox-style detail view.
5. **Empty states are agent prompts** — when a section is empty, the placeholder copy is exactly what the user could ask the agent to do.

## Non-goals

- **No project.json schema change.** No new asset type, no new top-level field. Setup content lives outside `project.json`.
- **No editing in v1.** Bible / cards are read-only renderings. Edits go through the agent or the user's external editor.
- **No upload / new-card UI in v1.** The "create" affordance is a prompt-the-agent hint in the empty state.
- **No real-time WS updates.** Manual refetch on tab activation + a refresh button. Agent-led changes typically arrive in a new turn anyway.
- **No multi-storyboard timeline overlay.** Storyboards section only LISTS storyboards; the timeline still renders previewFrames as today.

## File detection conventions

The viewer scans the workspace for these patterns:

| Concept | Pattern | Required files | Optional |
|---|---|---|---|
| Project Bible | `setup/bible.md` | the markdown file | none |
| Character Card | `setup/cast/<name>/` OR `setup/cast/<name>.md` + `setup/cast/<name>.<ext>` | `<name>.md` | `<name>.<ext>` (png/jpg/jpeg/webp), `<name>.prompt.md` |
| Setting Card | `setup/world/<name>/` OR `setup/world/<name>.md` + `setup/world/<name>.<ext>` | same shape as cast | same |
| Storyboard | `storyboard/<id>/` | `composite.<ext>` AND ≥1 `*.<ext>` matching `<basename>-<NN>.<ext>` | `stdout.json`, `prompt.md` |

Detection rules:

- **Card name** comes from the markdown filename (without `.md`).
- **Card image** is the file with the same basename as the md, in any image format. Multiple matches → prefer png > webp > jpg.
- **Storyboard id** is the directory name under `storyboard/`.
- **Storyboard panels** are detected by looking at the `stdout.json` if present (the `panels[]` array gives ordered slice paths). If no `stdout.json`, fall back to lexicographic listing of files matching `*-[0-9]+.{png,jpg,jpeg,webp}`.
- **Bible** must be exactly `setup/bible.md` — not `setup/BIBLE.md` or `setup/project-bible.md`. One per project. Future PRs can relax this.

Two card-layout shapes are accepted because the agent might write either:

```
# Flat (preferred for simple cards)
setup/cast/kira.md
setup/cast/kira.png

# Nested (preferred when cards have multiple supporting files)
setup/cast/kira/
  card.md
  ref.png
  prompt.md
```

For the nested layout, the parent directory name is the card name and the markdown is `card.md`.

## Server endpoint

```
GET /api/setup/listing

Response:
{
  bible: { path: "setup/bible.md", mtime: 1714... } | null,
  cast: [
    { name: "kira", mdPath: "setup/cast/kira.md", imagePath: "setup/cast/kira.png" | null, mtime: ... },
    ...
  ],
  world: [
    { name: "desk", mdPath: "setup/world/desk.md", imagePath: "setup/world/desk.png" | null, mtime: ... },
    ...
  ],
  storyboards: [
    {
      id: "the-bug-pathc",
      compositePath: "storyboard/the-bug-pathc/composite.png",
      panels: [
        { index: 1, path: "storyboard/the-bug-pathc/panel-01.png", row: 0, col: 0, bbox: {...}, assetId: "asset-...-01" },
        ...
      ],
      grid: { rows: 3, cols: 2 } | null,
      hasStdoutJson: true,
      mtime: ...,
    },
    ...
  ],
}
```

The server-side handler scans the workspace synchronously (or with `fs.promises.readdir`), reads `stdout.json` files for storyboard metadata, and assembles the JSON. Response is small (<5 KB for typical projects); no caching needed.

## React component layout

### Tab toggle in AssetPanel

`modes/clipcraft/viewer/assets/AssetPanel.tsx` already has:

```tsx
type Tab = "assets" | "script";
const [tab, setTab] = useState<Tab>("assets");
```

Add a third tab:

```tsx
type Tab = "assets" | "setup" | "script";
```

Tab order in the UI: **Setup | Assets | Script**. Setup is leftmost because it's the upstream (planning) artifact; the user reads left-to-right through the production phases.

When `tab === "setup"`, render `<SetupTab />` (new component). When `assets` or `script`, render existing content (unchanged).

Setup tab is the **default selected tab** when the workspace has bible content but no assets yet (cold-start fresh project). Otherwise default stays as `assets`.

### `<SetupTab />` component

Four collapsible sections (using the same disclosure pattern as `AssetGroup`):

```
┌─ Project Bible (1) ─────────────────────────┐
│ [bible.md rendered as markdown — first ~10 lines preview, "Open" expands] │
└─────────────────────────────────────────────┘

┌─ Cast (N) ─────────────────────────────────┐
│ ┌─────┐ ┌─────┐ ┌─────┐                    │
│ │KIRA │ │ANYA │ │ +   │  ← thumbnails 80×80 │
│ │     │ │     │ │ add │                    │
│ └─────┘ └─────┘ └─────┘                    │
│   click → CardLightbox                     │
└────────────────────────────────────────────┘

┌─ Settings (N) ─────────────────────────────┐
│ ┌─────┐ ┌─────┐                            │
│ │DESK │ │ +   │                            │
│ └─────┘ └─────┘                            │
└────────────────────────────────────────────┘

┌─ Storyboards (N) ──────────────────────────┐
│ ┌─────────────────┐                        │
│ │  composite png  │  the-bug-pathc          │
│ │   (with grid    │  6 panels · 3×2 · 9:16  │
│ │   overlay)      │  Click panel to seek    │
│ └─────────────────┘                        │
└────────────────────────────────────────────┘
```

Section headers show count `(N)`. Empty sections collapse to a 1-line "no items" with the agent prompt:

- `Cast (0)` collapsed → "Ask the agent: 'add a character card for [name]'"
- `Settings (0)` collapsed → "Ask the agent: 'add a setting card for [location/prop]'"
- `Storyboards (0)` collapsed → "Ask the agent: 'storyboard the next [N] beats'"
- `Project Bible` missing → "Ask the agent: 'set up the project bible'"

### CardLightbox

Reuses the existing `AssetLightbox` shell, but with an extended panel that renders:

- Reference image (left half)
- Markdown content rendered (right half)
- "Open prompt file" link if `<name>.prompt.md` exists
- "Used by N clips" counter (count of `provenance[].operation.params.imageUrls` containing this card's image — if not used: "Not yet referenced by any generation")

### StoryboardCard

A thumbnail of the composite, with an SVG grid overlay drawn at the panel boundaries (computed from the `panels[].bbox` data scaled to the thumbnail size). On hover, a panel lights up; on click:

- If the corresponding panel asset is registered in `project.json`'s `assets[]` AND has a previewFrame placement: dispatch `playhead:seek` to the previewFrame's time, dispatch `asset:select` to the panel's assetId.
- If the panel is registered but not on the timeline: just `asset:select`. Show a toast: "Panel not yet placed on the timeline."
- If the panel is not even in `assets[]`: show a toast: "Panel not yet registered. Ask the agent to register storyboard panels."

The "is this panel registered?" check looks at `assets[].uri` against the panel's path (relative to workspace).

Below the thumbnail: the storyboard `id` + summary (`N panels · grid · aspect`). Click on the summary text → opens a separate lightbox of the full composite at full size.

## State / data flow

```
useSetupListing()  ← new hook, mirrors useAssetFsListing pattern
       │
       ▼
GET /api/setup/listing  ← new server route
       │
       ▼
server reads filesystem under workspace/setup and workspace/storyboard
```

No Zustand slice needed — the listing is fetched on tab activation and held in `useState` inside `<SetupTab />`. A refresh button calls `refetch()`. Future enhancement: subscribe to chokidar events for setup/ + storyboard/ paths and auto-refetch.

The `usePneumaCraftStore()` reads `assets[]` and `composition.tracks[].previewFrames[]` to compute "is this panel registered?" — already available from craft store.

## Empty-state copy (agent prompts)

These appear when a section is empty. They double as documentation —
the user reads them and learns the methodology.

- **Bible missing:**
  > **No project bible yet.** Ask the agent: *"set up the project bible"*. The bible is where you lock the project's tone, palette, camera grammar, casting, and locations before any image generates.

- **Cast empty:**
  > **No character cards yet.** Ask the agent: *"add a character card for [name]"*. A character card is the durable reference image + bible that every later shot prompt cites — the consistency engine for multi-shot work.

- **Settings empty:**
  > **No setting cards yet.** Ask the agent: *"add a setting card for [location or signature prop]"*. Used when a location or prop should look identical across multiple shots.

- **Storyboards empty:**
  > **No storyboards yet.** Ask the agent: *"storyboard the next 4-12 beats"*. The agent will generate a single composite image with all panels and slice it into individual references — one $0.16 generation, dramatically higher internal consistency than independent panel generations.

## What this does NOT do (yet)

- **Inline editing of bible.md** — out of scope. The bible is the agent's writing surface; user edits via external editor.
- **Adding cards from the UI** — out of scope. Use the agent.
- **Storyboard timeline overlay** — Storyboards in this panel are listings + interaction; they don't change how the timeline renders.
- **Auto-detection of "this asset was generated from a card"** — out of scope. The provenance graph already supports this via `imageUrls`; future versions can compute the bidirectional mapping.
- **Real-time updates** — out of scope. Manual refresh button. Agent-led changes typically arrive within a fresh turn anyway.

## Risks / open questions

- **Card naming collision with workspace files** — what if the user has a `setup/` directory that isn't intended as a production bible? Mitigation: if `setup/bible.md` doesn't exist, the entire Setup tab shows "Empty" sections; we don't try to interpret arbitrary `setup/cast/foo.md` if the bible isn't there. (Future: relax this.)
- **Agent might write cards in different layouts** — spec accepts both flat (`<name>.md` + `<name>.png`) and nested (`<name>/card.md` + `<name>/ref.png`). Update production-bible.md skill doc to recommend the flat layout for simple cards.
- **Storyboard provenance not yet auto-registered** — `storyboard.mjs` emits `suggestedAssets` and `suggestedProvenance`, but the agent has to actually copy them into `project.json`. The Setup tab can detect orphaned storyboards (composite + panels exist on disk but no matching assets) and offer "Ask the agent to register". This UX nudge is in scope for v1.

## Acceptance criteria

1. **Tab switch works** — clicking "Setup" hides asset groups, shows Setup content. Clicking "Assets" returns. No regression on existing asset library.
2. **Bible renders** — `setup/bible.md` content renders as markdown, scrollable, monospace code blocks readable.
3. **Card thumbnails appear** — `setup/cast/kira.{md,png}` shows as a tile labeled "KIRA". Click → lightbox with image + md.
4. **Storyboard panels are clickable** — `storyboard/the-bug/{composite,panel-01..06}.png` shows as a thumbnail with grid overlay. Hover → panel highlight. Click panel → seek + select (or appropriate "not registered" toast).
5. **Empty states show agent-prompt copy** — fresh workspace with no setup/ → "Ask the agent: 'set up the project bible'".
6. **Refresh works** — refresh button calls `/api/setup/listing` and re-renders.
7. **Visual baseline** — matches the Ethereal Tech theme (deep zinc bg, neon-orange accents, glassmorphism surfaces).
8. **No regression** — existing AssetPanel functionality (assets tab, script tab, lightbox, manager modal) unchanged.

## Estimated impact

- **New files:**
  - `server/setup-routes.ts` (~150 LOC) — the GET handler + workspace scanner
  - `modes/clipcraft/viewer/setup/SetupTab.tsx` (~300 LOC) — top-level tab
  - `modes/clipcraft/viewer/setup/CardSection.tsx` (~150 LOC) — Cast / Settings rendering
  - `modes/clipcraft/viewer/setup/StoryboardSection.tsx` (~150 LOC) — Storyboards listing with panel grid
  - `modes/clipcraft/viewer/setup/CardLightbox.tsx` (~120 LOC) — extended lightbox for cards
  - `modes/clipcraft/viewer/setup/useSetupListing.ts` (~50 LOC) — fetch hook
  - `modes/clipcraft/viewer/setup/__tests__/SetupTab.test.tsx` — component tests
  - `server/__tests__/setup-routes.test.ts` — server tests

- **Modified files:**
  - `modes/clipcraft/viewer/assets/AssetPanel.tsx` — add Setup tab to the tab toggle
  - `server/index.ts` — register the new `/api/setup/listing` route

- **No changes to:** `core/`, `bin/`, `backends/`, `modes/clipcraft/persistence.ts`, `modes/clipcraft/manifest.ts` (no schema change)

Total: ~1000 LOC + tests. ~1-2 days for an Opus subagent.

## See also

- `modes/clipcraft/skill/SKILL.md` — the 6-layer mental model the Setup tab makes legible
- `modes/clipcraft/skill/references/production-bible.md` — Layer 1 reference
- `modes/clipcraft/skill/references/storyboard-design.md` — Layer 2 / storyboard ID conventions
- `modes/_shared/scripts/storyboard.mjs` — produces the `storyboard/<id>/` directories this panel surfaces
- `docs/superpowers/specs/2026-04-01-clipcraft-mode-design.md` — the original ClipCraft mode design (for context on the asset library + tab pattern)
