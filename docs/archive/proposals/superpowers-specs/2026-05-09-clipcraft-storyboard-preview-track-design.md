# ClipCraft Storyboard Preview Track — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring **progressive-fidelity storyboarding** to ClipCraft. Before any expensive video generation runs, the agent fills the timeline with cheap line-art sketches; the user scrubs to feel pacing; the agent then upgrades selected moments to photoreal anchor frames; the user signs off; only then does seedance run. The storyboard is *visible inline on the same track that will eventually carry the real footage*, not a side panel.

**Architecture:** Pure consumption of the upstream `PreviewFrame` capability landed in `@pneuma-craft/timeline ≥ 0.4.0` and `@pneuma-craft/video ≥ 0.5.0`. ClipCraft does no protocol design of its own; it wires the new craft data into `project.json`, the timeline render, the asset/preview resolver, and a new skill workflow. A handful of agent-facing scripts (sketch generation in line-art mode) and a "Export draft" toolbar entry (review-grade exports with previews baked in) round it out.

**Tech Stack:** `@pneuma-craft/timeline 0.4.0+`, `@pneuma-craft/video 0.5.0+`, existing ClipCraft viewer (React 19, Vite), existing `gpt-image-2` script for line-art mode, existing `seedance-2.0` for video.

**Upstream contract:** This spec is downstream of `pneuma-craft/docs/recipes/preview-frames.md` (PreviewFrame schema, four commands, `buildSetPreviewFrameCommand` helper, `resolveFrame` extension, PlaybackEngine/ExportEngine `includePreviewFrames` option). Read that recipe first; this spec assumes it.

**Dev cycle:** During implementation, the four `@pneuma-craft/*` packages are consumed via `bun link` from the sibling worktree at `~/Codes/pneuma-craft` (the upstream repo's `dist/` is the link target — re-run `bun run build` upstream after any source change). When implementation is complete and stable, upstream publishes the bumped versions and we swap the link for `^0.4.0` / `^0.5.0` published deps in one commit. See step 1 and the final cutover step in **Implementation order**.

---

## Scope

**In scope:**
- `project.json` schema migration to carry `track.previewFrames` (round-trip preserving with the existing `Source<T>` flow)
- ClipCraft viewer: `PreviewCanvas` consumes `ResolvedFrame.previewFrames` (auto via PlaybackEngine), timeline `VideoTrack` row renders the planning-layer thumbnail strip, missing/pending asset fallback rendering
- Locator card: new `previewFrameId` data shape, click → seek + select on timeline
- Skill: new `references/storyboard-workflow.md` + edits to `SKILL.md` and `mdScene` to teach the progressive-fidelity playbook
- `gpt-image-2` script flag for line-art / sketch mode (cheap satellite generation for stage-1 sketches)
- "Export draft" toolbar button (calls existing export pipeline with `includePreviewFrames: true`)
- Skill command `make-draft-export` that the agent can invoke in chat ("做个草样片让我看看")
- Lightweight dive integration: clicking an anchor preview frame on the timeline opens the existing asset-variant dive view for the referenced image asset
- Tests: persistence round-trip, render rule integration smoke, skill scenario doc

**Out of scope:**
- Audio / subtitle preview frames (upstream v1 is video-only; we follow)
- "Storyboard dive" — a dedicated dive mode that lays out all preview frames as a node graph. Deferred until the lightweight integration shows insufficient
- Bulk preview-frame commands or multi-frame undo collapse (upstream stays at 1 add per command; we adapt skill workflow to that)
- Explicit composition duration (`Composition.explicitDuration`) — upstream future work, ClipCraft picks it up when it lands
- Path B (single 15s seedance with N internal beats) is **purely a skill workflow** — no schema change. It piggy-backs on the same anchor-frame data shape; the skill teaches the agent to compose one prompt with embedded beat directives instead of N separate gens. No code change beyond the skill doc

---

## Why progressive fidelity needs to live on the same track

A typical ClipCraft project today is a 30–60s composition with 2–5 video clips. Without preview frames, the user has to commit to an expensive seedance run to see what a clip will look like at all. The whole-timeline pacing only becomes visible *after* every clip is generated, which is the worst possible time to discover the pacing is wrong.

The progressive-fidelity workflow inverts this: the user starts seeing a representation of the entire composition immediately, with each layer being a cheaper rehearsal of the next. The cost gradient is the design — sketch is ~$0.01 per panel, anchor is ~$0.10, seedance is ~$0.50–$1.00. The user can scrub between layers and approve at each gate.

Hosting all three layers on the same track (rather than parallel "preview tracks" the user toggles manually) is essential. The user's mental model is a single timeline; the agent's job is to upgrade the fidelity at each moment as work progresses. The auto-fallback rule (clip wins, then anchor preview, then sketch preview, then nothing) makes the upgrade transparent: when seedance finishes a clip, the planning layer underneath visually disappears without the user having to flip a switch.

This is why the upstream design lands `previewFrames` as a `Track` field rather than a separate object — it's the same track, semantically.

---

## Persistence (`modes/clipcraft/persistence.ts`)

### Schema

`ProjectFile` v1 currently has `composition.tracks[]` matching upstream `Track` (without `previewFrames`). We extend it to mirror the new upstream `Track` shape:

```typescript
interface PersistedTrack {
  id: string;
  type: 'video' | 'audio' | 'subtitle';
  name: string;
  clips: PersistedClip[];                    // unchanged
  previewFrames?: PersistedPreviewFrame[];   // new, optional in JSON
  muted: boolean;
  volume: number;
  locked: boolean;
  visible: boolean;
}

interface PersistedPreviewFrame {
  id: string;
  trackId: string;
  time: number;
  assetId: string;
}
```

`PersistedPreviewFrame.trackId` is denormalized (matches upstream); we keep it in the persisted shape too so an out-of-band manual editor can copy/move entries without losing the back-pointer.

### Migration

`parseProjectFile`: when reading a track, default `previewFrames` to `[]` if absent. Old project.json files (written before this feature) Just Work. No schema version bump — the new field is purely additive.

### Hydration

`projectFileToCommands` emits a `composition:add-preview-frame` envelope per persisted preview frame, **after** all `asset:register` commands (so the I3 invariant — referenced asset exists and is `type === 'image'` — is satisfied) and **after** the parent track is added. Order: assets → tracks → clips → preview frames.

Each emitted envelope uses the persisted `id` so hydration round-trip preserves identity (same pattern as Plan 3a's explicit-id `composition:add-clip`).

### Serialization

`serializeProject` reads `track.previewFrames` from craft's composition state and writes them out in `time`-ascending order (matches I5 invariant).

### Round-trip invariant

Add to `hydration-integration.test.ts`: a project file with a track carrying 3 preview frames at t=0, t=4, t=8 (mix of one referencing a `ready` asset and one referencing a `pending` asset) hydrates to craft state, serializes back, and the result is byte-identical to the source. Same guarantee that `clip` already has.

---

## Viewer changes

### `PreviewCanvas.tsx` (the central canvas)

No changes needed. `PreviewCanvas` mounts upstream's `<PreviewRoot>`, which uses `PlaybackEngine` internally. Once we set `includePreviewFrames: true` on engine creation (default upstream, but we declare it explicitly via the `PneumaCraftProvider` options for clarity), the engine handles preview frame rendering automatically: `resolveFrame` already does the per-track let-go, and the renderer draws the resolved preview frame's image via the existing image fast-path in the decoder.

Verify in browser smoke (DevTools): with two preview frames at 0s and 4s and a real clip at 4–8s, scrubbing the timeline should show the sketch at 0–4s, the real clip at 4–8s, and the second preview frame at 8s+.

### `VideoTrack.tsx` (the timeline-row preview strip)

This is the visible-in-timeline counterpart to the canvas render. The current implementation shows clips as filmstrip thumbnails (via `useFrameExtractor`) plus status badges for non-ready assets. We extend it to also show preview frames in any time range *not* covered by a clip:

1. Read `track.previewFrames` directly from the craft store via `useComposition()` — no new hook needed (confirmed by upstream's recipe).
2. Compute the "uncovered intervals" of the track — gaps between clip end times where preview frames live.
3. For each uncovered interval, find the segment-of-active preview frames (one per `time` boundary in that interval). Render each segment as a small thumbnail at its slot position, sized by the time-to-next-boundary distance.
4. Anchor previews and sketch previews look subtly different — sketches get a dashed border and a ~70% opacity tint; anchors render at full opacity with a thin solid border. We distinguish them by inspecting the referenced `Asset.metadata.fidelity` (set by the skill at registration time, not by craft). Default if `fidelity` is absent: render as anchor (full opacity).
5. Click on a preview frame thumbnail → dispatch `selection:set { type: 'previewFrame', id: previewFrame.id }` (new selection variant; see `Selection variant` below) and seek the playhead to `previewFrame.time`.

### Pending / missing asset fallback

When a preview frame's `assetId` references an asset whose `status` is not `ready` (e.g., the agent emitted `add-preview-frame` immediately and the gpt-image-2 generation is still running), the timeline-row renderer shows:

- `status === 'generating'` → `⏳` icon + the asset's `name` as label, faint background pulse
- `status === 'error'` → `⚠` icon + the asset's last error message tooltip
- asset doesn't exist in the registry at all (deleted by hand) → `?` icon + the assetId in tooltip

The PreviewCanvas (PlaybackEngine path) handles this differently — the decoder already returns nothing for missing/unloadable images, so the canvas just leaves that region transparent (the canvas background shows through). This split is acceptable: the timeline row needs an explicit hint for the agent to act on, while the canvas just shouldn't crash.

### Selection variant

`useSelection()` today supports `{ type: 'clip' | 'asset' | 'track', ids: string[] }`. We add `{ type: 'previewFrame', ids: string[] }`. Implications:

- `<viewer-context>` extracts the selected preview frame's id, time, trackId, and resolved asset metadata (name, fidelity, status, prompt from provenance)
- `<user-actions>` emits `previewFrame:select { previewFrameId }` when the user clicks one in the timeline row (informational hint to the agent)
- The agent can target the selection via locator cards, see below

### Locator card

New `data` shape:

```html
<viewer-locator data='{"previewFrameId":"pf-04"}'>panel 4 — opening sketch</viewer-locator>
```

Click behavior: scroll the timeline to bring the preview frame into view, select it, and seek the playhead to its `time`. Same affordance shape as `clipId` locators today.

Update `references/locator-cards.md` (or wherever locator card data shapes live in the skill) to register the new variant.

---

## "Export draft" toolbar entry + skill command

### Toolbar button

Add an entry to the viewer toolbar next to the existing Export button:

- Label: "Export draft"
- Tooltip: "Export with sketch + anchor previews baked in — for review before final generation"
- Icon: a wireframe / outline-box variant of the existing export icon (no emoji)
- Click behavior: invoke the existing export route but with `includePreviewFrames: true` passed through to `createExportEngine`

This requires adding a flag to the existing export endpoint (`POST /api/export` or whichever the current route is) so the request can declare draft vs final. The frontend export call site reads the toolbar variant.

### Skill command

`manifest.viewerApi.commands` adds a new entry:

```typescript
{
  id: 'export-draft',
  label: 'Make a draft export',
  description: "Export the current composition with all preview frames (sketch + anchor) baked in, so the user can review pacing before committing to expensive seedance generation. Use this proactively after stage-1 sketches are placed and after stage-2 anchors are placed, asking the user to review.",
}
```

Clicking it from the toolbar fires a chat message hint, the agent then calls the same export endpoint. Both paths converge on the same backend.

### Why both

Agent-initiated drafts (mid-workflow review checkpoints — agent says "let me show you what we have so far") and user-initiated drafts (peace-of-mind double-check — user clicks the toolbar mid-conversation) are both common entry points to the same workflow. Covering both costs almost nothing — same backend, same UI, two front doors.

---

## Skill changes

### `SKILL.md` — minor edits

Add a paragraph in the "Working with the viewer" section describing the progressive-fidelity workflow at a high level. Add the `previewFrameId` locator card example. Add `export-draft` to the command table.

`mdScene` (the system prompt prefix in `manifest.ts`): add one sentence about preview frames being a planning layer the agent can populate to give the user a scrubbable preview before generation.

### `references/storyboard-workflow.md` — new file

This is the agent-facing playbook. Sections:

1. **When to reach for this** — the user wants to make a video segment that's not a single trivial shot. If the request is "make me a 4-second clip of a panda rolling over", skip storyboarding and just generate. If the request is "make me a 15-second latte art musical sequence" or anything multi-beat, storyboard first.
2. **Stage 1: rough sketch the whole timeline** — call `generate_image.mjs` with `--style sketch` (see Script changes below) for each beat. Place at sequential timestamps. Don't try to be precise about timing yet; aim for evenly-spaced or vibe-driven density (one sketch per ~1–3 seconds is a good default; denser if the action is rapid, sparser if it's a long held shot).
3. **Stage 2: review with the user** — emit a draft export ("做个草样片让你看看节奏") so the user can scrub a real video file with the sketches baked in, not just the timeline. Wait for feedback. Iterate by removing/adding/replacing preview frames.
4. **Stage 3: upgrade to anchors** — pick the gen boundaries (typically the first frame of each seedance call). For each, run gpt-image-2 in normal photoreal mode at exact pixel dimensions matching the composition. Use `buildSetPreviewFrameCommand` to upsert — it will rebind the existing sketch's slot to the new anchor asset, preserving `id` so locator cards survive.
5. **Stage 4: review again, then generate** — second draft export checkpoint, then run seedance. The output asset becomes a real `Clip` on the same track at the same time range. The preview frames in that range silently let go.
6. **Stage 5: polish** — the user may want sketches/anchors *removed* from the data after final gen. The default is to leave them in place (audit trail, undo-friendly). Only remove on explicit user request.
7. **Density rules of thumb** — sparse (every ~3s) for slow shots, dense (every ~1s) for fast cuts. Match the user's energy from the brief.
8. **Bulk-undo expectation** — placing 8 sketches is 8 undo steps, not one. Tell the user this before satellite operations: "I'll plant 8 sketches; if you want to wipe them all, the undo is per-sketch — let me know and I'll remove the batch in one shot via dispatched `remove-preview-frame` calls." (Or, more practically, the user invokes the agent: "clear sketches from track X" and the agent handles it.)
9. **Move semantics** — agent moves a preview frame (e.g., reorganizing pacing) via `move-preview-frame` — id stays the same so locator-card references survive. If the destination `(trackId, time)` is already occupied by another preview frame, the command rejects on collision. Recovery: dispatch `remove-preview-frame` against the destination's id first (if you want to discard it) or move the destination elsewhere first (if you want to keep both). `buildSetPreviewFrameCommand` is for the *upsert* shape ("ensure asset X is the preview at this slot"), not move-conflict resolution.
10. **Time precision** — quantize `time` to milliseconds when generating: `Math.round(t * 1000) / 1000`. This avoids floating-point I1 collisions and matches the existing clip `startTime` convention.
11. **Path B (single-clip multi-beat) playbook** — when the user wants a 15s continuous shot with N internal beats, place anchors at the beat boundaries as usual, but at gen time issue *one* seedance call referencing the first and last anchors as the from-image / end-image-url, with the prompt embedding all the beat descriptions in order. Result is a single 15s clip; it auto-fallbacks all preview frames in [0, 15). Worked example in this doc.
12. **Worked examples** — three end-to-end stories:
    - 30s 2-segment (Kōda's latte art recipe, simplified): 3 anchors + 8 interleaved sketches + 2 seedance calls
    - 15s single long shot: 5 anchors + 0 interleaved (just the boundaries) + 1 seedance call (Path B)
    - 60s 3-cut narrative: 4 anchors + 12 interleaved sketches + 3 seedance calls

### Script changes — `modes/_shared/scripts/generate_image.mjs`

The script source lives at `modes/_shared/scripts/generate_image.mjs` (per `feedback_scripts_vs_skills`: shared script source, opted into per-mode via `manifest.skill.sharedScripts`, copied at install time into each mode's installed skill dir).

Add a `--style sketch | photo` flag (default `photo`, current behavior). When `--style sketch`, the script appends a fixed line-art prompt suffix to the user's prompt (e.g., "in clean black-and-white pencil sketch style, line art, no shading, white background") and sets the gpt-image-2 quality to `low` for cost reduction. Add the new flag to the script's help text.

The skill workflow doc tells the agent to invoke this script with `--style sketch` for stage 1 and without (or `--style photo`) for stage 2 anchors. The asset registered for each call should carry `metadata.fidelity = 'sketch'` or `'anchor'` accordingly — this is what the timeline row renderer reads to choose visual treatment. Other modes that opt into the script (currently none for `--style sketch`, but possible) can use the flag freely; the fidelity convention is ClipCraft's, not the script's.

---

## Dive integration (lightweight)

When a preview frame is selected (via timeline-row click or locator card), the existing dive-mode entry point (`dive` button in the toolbar, or the agent dispatches `viewer_action: 'dive:open'`) opens to the **referenced image asset's variant tree**. This is exactly what dive does today for any asset: shows the asset and its provenance ancestors/descendants.

For preview frames specifically, this means clicking an anchor → dive shows: the line-art sketch parent (if upstream from the anchor in provenance), the anchor itself, and any photoreal variants the agent generated alongside (siblings via shared parent). This is genuinely useful: the user can see what alternates were considered before the agent settled on this anchor, without us building a whole new dive mode.

No new dive UI. Just confirm the existing dive entry, when given a preview frame selection, derefs the assetId and opens the asset's variant view. Probably a one-line wiring change in `DiveCanvas.tsx`.

A future "storyboard dive" — laying out all preview frames as a time-axis node graph — is deferred. We'll know we need it when the lightweight version is consistently insufficient. Don't pre-build.

---

## Implementation order

1. **Local link to upstream pneuma-craft** — `bun link` the four `@pneuma-craft/*` packages from `~/Codes/pneuma-craft/packages/{core,timeline,video,react}` into the worktree's node_modules. Workflow: edit upstream → `bun run build` (or `bun run dev` watch mode) in pneuma-craft → restart the ClipCraft dev server to pick up the new dist. `package.json` keeps the existing version constraints (e.g. `^0.3.0`) — Bun's link resolves through node_modules and ignores the constraint while linked. Run `bun test` after linking to confirm the test baseline still passes (959 tests at link time). Surface upstream bugs back to the recipe / pneuma-craft as we encounter them — local link is precisely the loop that makes that fast.
2. **Persistence + hydration** — extend `persistence.ts` types, `parseProjectFile`, `projectFileToCommands`, `serializeProject`. Add round-trip test. This is the foundation; everything else assumes `project.json` round-trips with preview frames.
3. **PreviewCanvas / PlaybackEngine wiring** — declare `includePreviewFrames: true` on the engine creation. Browser smoke: scrub through a project with preview frames and verify they render.
4. **Timeline row rendering** — `VideoTrack.tsx` reads `track.previewFrames`, draws thumbnails in uncovered intervals. Pending/error/missing asset fallback. Sketch vs anchor visual distinction. Browser smoke.
5. **Selection + locator** — add `previewFrame` selection variant, wire `<viewer-context>` and `<user-actions>` extraction, register `previewFrameId` locator card data shape. Test with a hand-crafted project file.
6. **Export draft** — toolbar button + skill command + backend route flag. Test by exporting a project with sketches and confirming the output mp4 contains the sketches.
7. **Dive lightweight** — wire preview-frame selection to existing dive entry; verify clicking a preview frame on the timeline → dive button opens the asset's variant tree.
8. **Skill workflow doc** — write `references/storyboard-workflow.md` with the three worked examples. Edit `SKILL.md` and `mdScene` to point at it.
9. **Script: sketch mode** — add `--style sketch` flag to `generate_image.mjs`. Skill doc references it.
10. **End-to-end smoke test** — scenario from the worked examples: empty workspace → agent places 8 sketches → user scrubs → agent upgrades 2 to anchors → user requests draft export → user approves → agent runs seedance → real clip lands → preview frames let go visually but persist in data. Verify nothing crashes, locator cards work, dive works, export works.
11. **Mode version bump** — `manifest.ts` `0.7.2 → 0.8.0` (minor: new feature). Update CHANGELOG.
12. **Production cutover (final commit)** — once steps 1–11 are stable and upstream publishes `@pneuma-craft/timeline ≥ 0.4.0` and `@pneuma-craft/video ≥ 0.5.0` (and any matching `core` / `react` bumps): `bun unlink @pneuma-craft/{core,timeline,video,react}` in the worktree; update `package.json` version constraints to the published majors; `bun install` to restore the published packages; `bun test` to confirm parity. This commit is intentionally separate from feature commits so the dev-time link is clearly demarcated and the "we now ship against published upstream" moment is reviewable in isolation.

Each step is independently testable. The implementation plan should treat them as sequential tasks (each unblocks the next), with steps 8 and 9 parallelizable to anything after step 5.

---

## Tests

- **Persistence round-trip** (`hydration-integration.test.ts`): preview frames preserve id, trackId, time, assetId; sorting maintained; mixed `ready` / `generating` / `error` asset references all survive.
- **Selection state** (`selection.test.ts`): `previewFrame` selection variant set/clear/swap.
- **Locator card extraction** (`extractContext.test.ts`): selecting a preview frame produces a `<viewer-context>` with the resolved asset metadata.
- **Render smoke** (manual via chrome-devtools-mcp): a hand-crafted project with two preview frames + one clip + one ready asset + one generating asset. Verify timeline row, preview canvas, and draft export all render the expected thing.
- **Skill scenario** — the three worked examples in `storyboard-workflow.md` should be runnable end-to-end by an agent against a clean workspace. Capture as a "smoke story" in the skill review tooling.

---

## Edge cases / known risks

- **Preview frame at `time === composition.duration`** — upstream documents this as a zero-width tail (engine pauses before rendering). Skill doc tells the agent to add a sentinel frame past the last "real" preview to keep the visual tail visible during scrub. Acceptable workaround for v1.
- **Heavy density** — a 60s composition with 60 sketches at 1s spacing is 60 add-preview-frame events. Persistence and hydration scale linearly; render is O(log) per scrub tick, no concern. Undo to "before the satellite operation" is 60 steps — skill workflow tells the user to ask for a clean-up via the agent rather than mash undo.
- **Stale preview frames inflating duration** — `recomputeDuration` includes preview times. If the user removes the trailing clips but leaves preview frames behind, `composition.duration` stays at the last preview's time. Acceptable; user removes preview frames if they want a shorter timeline.
- **Track ordering and z-index** — preview frames render in `composition.tracks` order, same as clips. If the user reorders tracks, preview rendering follows. No special handling needed.
- **Asset deletion while referenced** — an `asset:remove` while a preview frame still points at the asset would leave a dangling reference. Upstream will likely add a referential-integrity check (it didn't show up in the recipe doc). For now, the timeline row's `?` fallback handles the visual case; we can revisit if upstream lands a different policy.
- **Cross-track move** — `move-preview-frame { trackId, time }` allows moving a preview frame across tracks. ClipCraft's skill workflow doesn't currently surface this as a common operation, but the underlying capability is there.

---

## Future work

- **Storyboard dive mode** — graph-layout view of all preview frames + their provenance. Build when lightweight dive is insufficient.
- **Preview frame audit report** — given a finished composition, surface "this region had 4 sketches, became 1 anchor, became 1 final clip" as a creative-history view. Would consume `Asset.metadata.fidelity` and provenance.
- **Bulk preview-frame command** — if we observe the per-frame undo experience genuinely hurting users, push a `composition:set-track-preview-frames` (full replace) request to upstream.
- **Audio-side previews** — narration sketches on audio tracks. Upstream deferred; we follow.
- **Path B richer authoring** — currently agent composes the multi-beat seedance prompt from natural language. A more structured authoring tool that takes anchors + per-beat descriptors and generates the prompt is plausible future work.
