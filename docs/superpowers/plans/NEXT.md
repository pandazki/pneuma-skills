# Next plans for ClipCraft × Pneuma-Craft

## Completed

- **Plan 1 — Bootstrap** (`2026-04-12-clipcraft-craft-bootstrap.md`) — rename legacy, scaffold new `clipcraft` mode on `@pneuma-craft/*`, verify end-to-end launch with a stub viewer, baseline contract test.
- **Plan 2 — Domain + store** (`2026-04-12-clipcraft-plan2-domain-store.md`) — `AssetStatus` first-class in craft-core (async AIGC lifecycle), `project.json` schema with validator, hydration-via-events loader, `StateDump` text renderer, E2E agent-edit simulation.
- **Plan 3a — ID stability** (`2026-04-12-clipcraft-plan3a-id-stability.md`) — `asset:register` / `composition:add-track` / `composition:add-clip` accept optional explicit id with duplicate rejection; persistence layer passes on-disk ids through; full-stack hydration integration test.
- **Plan 3b — Write path + loop protection** (`2026-04-13-clipcraft-plan3b-write-path.md`) — `serializeProject` + `formatProjectJson`, round-trip fidelity tests, `writeProjectFile` client using existing `POST /api/files`, `useProjectSync` bidirectional hook with debounced autosave, parent-owned `lastAppliedRef` + state-based `providerKey` for loop protection.
- **Plan 3c — dispatchEnvelope + createdAt round-trip** (`2026-04-13-clipcraft-plan3c-dispatch-envelope.md`) — expose `dispatchEnvelope(envelope)` on `CraftCore`, `TimelineCore`, and the Zustand `PneumaCraftStore`; wire clipcraft's persistence loader + the bidirectional sync hook to use it so `asset.createdAt` survives hydration. Also fixed a hidden `title` round-trip bug exposed once `createdAt` no longer dominated drift. **Zero-POST invariant verified E2E** on fresh mount (was 1 in Plan 3b) — 592/592 tests pass.

## Superseded

- **Plan 3d — Bidirectional sync transport (originally scoped, now absorbed upstream)** — Plan 3d would have hardened the mode-local `useProjectSync` hook with a proper transport contract. Instead, the upstream `feat/source-abstraction` work landed on `main` and introduced a first-class `Source<T>` abstraction with a `json-file` provider and server-side `pendingSelfWrites` origin tagging. ClipCraft was migrated to consume `sources.project` via `useSource` (commits `5319436`, `7582009`, `42bca41`, `06204f6`), deleting the entire mode-local sync layer (the bidirectional sync hook, the `externalEdit` helper, the `api-client`, and their tests). The "three-ref dance" is gone, and Plan 3b's load-bearing coupling between parent ref reset and provider remount no longer exists. See `docs/superpowers/plans/clipcraft-source-migration.md` and `docs/migration/2.29-source-abstraction.md`.

## Known limitations (to address in later plans)

- **"Full re-dispatch on external edit"** still kills in-memory state (undo history, PlaybackEngine once it exists) on every agent-originated file change. The source migration tags origin precisely (so the viewer knows *that* a change is external), but the response is still "bump providerKey, remount the craft store, re-hydrate from scratch". This is a craft-store-level concern — `Source<T>` cannot solve it. Will be replaced with diff-and-dispatch when Plan 4's playback makes in-memory state loss actually painful.

## Upcoming

To be written one at a time. Each plan should produce working software on its own and land on top of the previous one.
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
