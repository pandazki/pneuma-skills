# Next plans for ClipCraft × Pneuma-Craft

## Completed

- **Plan 1 — Bootstrap** (`2026-04-12-clipcraft-craft-bootstrap.md`) — rename legacy, scaffold new `clipcraft` mode on `@pneuma-craft/*`, verify end-to-end launch with a stub viewer, baseline contract test.
- **Plan 2 — Domain + store** (`2026-04-12-clipcraft-plan2-domain-store.md`) — `AssetStatus` first-class in craft-core (async AIGC lifecycle), `project.json` schema with validator, hydration-via-events loader, `StateDump` text renderer, E2E agent-edit simulation.
- **Plan 3a — ID stability** (`2026-04-12-clipcraft-plan3a-id-stability.md`) — `asset:register` / `composition:add-track` / `composition:add-clip` accept optional explicit id with duplicate rejection; persistence layer passes on-disk ids through; full-stack hydration integration test.
- **Plan 3b — Write path + loop protection** (`2026-04-13-clipcraft-plan3b-write-path.md`) — `serializeProject` + `formatProjectJson`, round-trip fidelity tests, `writeProjectFile` client using existing `POST /api/files`, `useProjectSync` bidirectional hook with debounced autosave, parent-owned `lastAppliedRef` + state-based `providerKey` for loop protection.

## Known limitations (to address in Plan 3c)

- **`asset.createdAt` cannot round-trip cleanly.** Craft's `store.dispatch(actor, command)` in `@pneuma-craft/react` builds its own `CommandEnvelope` with `timestamp: Date.now()`, and craft-core's `asset:register` handler derives `asset.createdAt` from `envelope.timestamp`. The on-disk `createdAt` is dropped on every hydration. Observable effect: exactly one `POST /api/files` per fresh provider mount, re-writing `project.json` with an updated `createdAt`. The loop-protection invariant is still intact (the echo of that POST matches `lastAppliedRef.current` and is skipped), so there is no infinite cycle — just a single no-op-semantics write on startup.
- **Plan 3b's loop protection has a load-bearing coupling**: `ClipCraftPreview`'s `onExternalEdit` handler must reset `lastAppliedRef.current = null` for the hook's "fresh instance, go ahead and hydrate" sentinel to work. Flagged in the commit message; a future Plan 3c refactor should move this into the hook or add a regression test.
- **"Full re-dispatch on external edit"** still kills in-memory state (undo history, PlaybackEngine once it exists) on every agent-originated file change. Plan 3b uses `providerKey` remount as the big hammer. Plan 3c replaces it with diff-and-dispatch.

## Upcoming

To be written one at a time. Each plan should produce working software on its own and land on top of the previous one.

- **Plan 3c — Diff-and-dispatch + craft envelope API** — the final piece of the persistence story. Introduces a partial-update path that replaces "provider remount on external edit" with a diff algorithm that computes the minimal command sequence to reconcile in-memory state with disk state. Prerequisite: expose `dispatchEnvelope(envelope)` (or similar) in craft-core so callers can preserve timestamps, which eliminates the `createdAt` round-trip issue. Also removes the Plan 3b `lastAppliedRef` + `providerKey` band-aids once the diff path is reliable.
- **Plan 4 — Playback + preview** — integrate `@pneuma-craft/video`'s `PlaybackEngine`; render the canvas into a `VideoPreview` component; prove a single clip can load and play. Introduces real `AssetResolver` usage. First real user-initiated dispatch (play/pause/seek) — exercises Plan 3b's write path end-to-end for the first time.
- **Plan 5 — Timeline UI** — port the legacy `Timeline` / track / clip components to read from craft's composition selectors; drop anything that still references the legacy reducer pattern.
- **Plan 6 — TimelineOverview3D on craft** — re-implement the legacy 3D overview reading from craft's composition + provenance; keep the visual design, replace the underlying data.
- **Plan 7 — DiveCanvas on craft** — re-implement the legacy dive canvas reading from craft provenance (`useLineage` / `useVariants`).
- **Plan 8 — Export** — replace `server/ffmpeg.ts` with `@pneuma-craft/video`'s `ExportEngine` in the browser; decide fallback strategy for long videos or large assets.
- **Plan 9 — MCP tool integration** — wire the existing MCP scripts (imagegen / videogen / tts / bgm) into craft's `generate` / `derive` provenance operations. `storyboard.json` / `graph.json` stop being first-class and become projections of craft state (if kept at all).
- **Plan 10 — Skill rewrite** — rewrite `modes/clipcraft/skill/SKILL.md` against the real craft domain model and agent workflow (action vocabulary, locator format, constraint set).

## Rules of engagement

Before each plan:

1. Survey what `clipcraft-legacy` does for the relevant surface.
2. Decide if a new concept belongs in the mode or upstream in `@pneuma-craft/*`. Discuss with the user.
3. Write the plan, verifying all referenced types against real `.d.ts` files (not the survey).
4. Use subagent-driven execution with combined spec + quality reviews between tasks.

`@pneuma-craft/*` lives at `/Users/pandazki/Codes/pneuma-craft-headless-stable` and is under active development (`0.1.0`, "not yet stable"). Patches to the packages land there on branch `feat/clipcraft-aigc-status`, not in this repo.
