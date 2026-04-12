# Next plans for ClipCraft × Pneuma-Craft

## Completed

- `2026-04-12-clipcraft-craft-bootstrap.md` — rename legacy, scaffold new `clipcraft` mode on `@pneuma-craft/*`, verify end-to-end launch with a stub viewer, baseline contract test

## Upcoming

To be written one at a time. Each plan should produce working software on its own and land on top of the previous one.

- **Plan 2: Domain + store** — wire `@pneuma-craft/timeline`'s `TimelineCore` into the new mode; load/save `project.json` via craft's event log; render the current state (composition, asset list, selection) as readable JSON-ish output in the viewer. Still no real UI beyond text.
- **Plan 3: Playback + preview** — integrate `@pneuma-craft/video`'s `PlaybackEngine`; render the canvas into a `VideoPreview` component; prove a single clip can load and play. Introduces `AssetResolver` usage for real.
- **Plan 4: Timeline UI** — port the legacy `Timeline` / track / clip components to read from craft's composition selectors; drop anything that still references the legacy reducer pattern.
- **Plan 5: TimelineOverview3D on craft** — re-implement the legacy 3D overview reading from craft's composition + provenance; keep the visual design, replace the underlying data.
- **Plan 6: DiveCanvas on craft** — re-implement the legacy dive canvas reading from craft provenance (`useLineage` / `useVariants`).
- **Plan 7: Export** — replace `server/ffmpeg.ts` with `@pneuma-craft/video`'s `ExportEngine` in the browser; decide fallback strategy for long videos or large assets.
- **Plan 8: On-disk format + MCP tool integration** — `storyboard.json` / `graph.json` / `project.json` become projections of craft state; wire the existing MCP scripts (imagegen / videogen / tts / bgm) into craft's `generate` / `derive` provenance operations.
- **Plan 9: Skill rewrite** — rewrite `modes/clipcraft/skill/SKILL.md` against the real craft domain model and agent workflow (action vocabulary, locator format, constraint set).

## Rules of engagement

Before each plan:

1. Survey what `clipcraft-legacy` does for the relevant surface.
2. Decide if a new concept belongs in the mode or upstream in `@pneuma-craft/*`. Discuss with the user.
3. Write the plan, verifying all referenced types against real `.d.ts` files (not the survey).
4. Use the bootstrap's subagent-driven execution style.

`@pneuma-craft/*` lives at `/Users/pandazki/Codes/pneuma-craft-headless-stable` and is under active development (`0.1.0`, "not yet stable"). Patches to the packages land there, not in this repo.
