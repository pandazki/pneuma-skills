# ClipCraft × Pneuma-Craft Bootstrap Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the existing MVP `clipcraft` mode to `clipcraft-legacy` (kept as a runnable reference), scaffold a brand-new `clipcraft` mode from scratch, wire `@pneuma-craft/*` packages as local file deps, and verify a stub viewer launches end-to-end inside a pneuma session.

**Architecture:** Two modes coexist: `clipcraft-legacy` (untouched MVP, used only as a source-code reference) and `clipcraft` (new, minimal skeleton). The new mode wraps its viewer in `PneumaCraftProvider` from `@pneuma-craft/react` but renders nothing beyond a placeholder — no features yet. All video-editing concerns (domain model, state, playback, timeline, export) will live in the craft packages in subsequent plans; this plan only proves the pipes connect.

**Tech Stack:**
- Existing: Bun, Hono, React 19, Vite 7, Zustand, TypeScript strict
- New local file deps: `@pneuma-craft/core`, `@pneuma-craft/timeline`, `@pneuma-craft/video`, `@pneuma-craft/react` (from `/Users/pandazki/Codes/pneuma-craft-headless-stable/packages/*`)
- Skipped for now: `@pneuma-craft/react-ui`

**Out of scope for this plan (future plans):**
- Store replacement (legacy `ClipCraftContext` → craft `TimelineCore` + Zustand)
- Playback/audio replacement (`usePlayback`/`useAudioMixer` → craft `PlaybackEngine`)
- Timeline component re-implementation on craft composition model
- `TimelineOverview3D` / `DiveCanvas` re-implementation on craft provenance
- Export replacement (`server/ffmpeg.ts` → craft `ExportEngine` in browser via MediaBunny)
- On-disk format migration (`storyboard.json`/`graph.json`/`project.json` → craft event log projection)
- MCP tool wiring into craft provenance `generate`/`derive` operations
- Skill rewrite for the new domain model

---

## File Structure

**New files:**
- `modes/clipcraft/manifest.ts` — minimal `ModeManifest` (name, version, displayName, description, `skill: SkillConfig`, `viewer: ViewerConfig`, `supportedBackends: ['claude-code']`)
- `modes/clipcraft/pneuma-mode.ts` — default-exported `ModeDefinition` importing `ClipCraftPreview` and wiring `{ manifest, viewer: { PreviewComponent, extractContext, updateStrategy } }`
- `modes/clipcraft/types.ts` — empty re-export file (placeholder so future `import from "./types"` resolves)
- `modes/clipcraft/seed/project.json` — `{ "title": "Untitled", "fps": 30 }` (seeded via `init.seedFiles`)
- `modes/clipcraft/skill/SKILL.md` — stub skill with a TODO marker pointing to future plans
- `modes/clipcraft/viewer/ClipCraftPreview.tsx` — default-exported React component typed as `ComponentType<ViewerPreviewProps>`; wraps `PneumaCraftProvider`, renders a placeholder `<div>`
- `modes/clipcraft/viewer/assetResolver.ts` — minimal `AssetResolver` that maps asset ids to `/content/<id>` URLs (resolveUrl is sync per craft's type)
- `modes/clipcraft/__tests__/craft-imports.test.ts` — sanity test that imports from all 4 craft packages and constructs each top-level object

**Renamed (git mv):**
- `modes/clipcraft/` → `modes/clipcraft-legacy/` (all contents, preserving history)

**Modified:**
- `package.json` — add 4 `"@pneuma-craft/*": "file:../pneuma-craft-headless-stable/packages/*"` dependencies
- `core/mode-loader.ts` — rename `clipcraft:` entry to `clipcraft-legacy:`, paths to `../modes/clipcraft-legacy/...`, then add a new `clipcraft:` entry pointing to the new scaffold
- `server/index.ts` — update `builtinNames` arrays (both `launcherMode` and top-level registry blocks) to include both `clipcraft-legacy` and `clipcraft`
- `CLAUDE.md` — update `**Builtin Modes:**` line and the `modes/{...}/` tree entry to include both names

---

## Task 0: Pre-flight — craft package dev watch

**Purpose:** Run `@pneuma-craft/*` in watch mode so the `dist/` outputs (which our `file:` deps point at) are rebuilt on every edit to the headless repo. This lets us patch craft packages and see the fix immediately in the clipcraft worktree, without re-running `bun install`.

**Files:** none modified in this task.

- [ ] **Step 0.1: Ensure craft repo deps are installed**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun install
```

Expected: installs cleanly. If there are new deps since the last run, this picks them up.

- [ ] **Step 0.2: Build once to guarantee `dist/` exists**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run build
```

Expected: all 5 packages build via turbo. `packages/{core,timeline,video,react}/dist/index.js` exist. (`react-ui` is built but we don't consume it — no action needed.)

- [ ] **Step 0.3: Start watch mode in the background**

```bash
cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun run dev
```

Run this in a dedicated background process (use `run_in_background: true` if dispatching via the Bash tool; or open a separate terminal). Turbo runs `tsup --watch` across all packages. Keep this alive for the duration of plan execution.

Expected first output lines: `• Running dev in 5 packages`, then per-package `CLI Building ... DONE`, then it hangs waiting for file changes.

- [ ] **Step 0.4: Confirm watch is alive**

```bash
ls -la /Users/pandazki/Codes/pneuma-craft-headless-stable/packages/core/dist/index.js
```

Expected: file exists with a recent mtime (within the last minute).

No commit — this is environment setup, not a code change.

---

## Task 1: Rename legacy clipcraft

**Files:**
- Rename: `modes/clipcraft/` → `modes/clipcraft-legacy/`
- Modify: `core/mode-loader.ts`
- Modify: `server/index.ts` (two `builtinNames` arrays)
- Modify: `CLAUDE.md` (two lines)

- [ ] **Step 1.1: Inventory references to `clipcraft` in source**

Run: `grep -rn "clipcraft" --include="*.ts" --include="*.tsx" --include="*.md" core/ server/ bin/ CLAUDE.md modes/_shared/ 2>/dev/null | grep -v "modes/clipcraft/" | grep -v "modes/clipcraft-legacy/" | grep -v "docs/superpowers/"`

Expected: a finite list. Capture it. Every match must either (a) stay referring to `clipcraft-legacy`, or (b) stay referring to the new `clipcraft`, or (c) be a doc string we update by hand.

- [ ] **Step 1.2: `git mv` the mode directory**

```bash
git mv modes/clipcraft modes/clipcraft-legacy
```

- [ ] **Step 1.3: Update `core/mode-loader.ts`**

Locate the existing block:

```ts
  clipcraft: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/clipcraft/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/clipcraft/pneuma-mode.js").then((m) => m.default),
  },
```

Replace it with:

```ts
  "clipcraft-legacy": {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/clipcraft-legacy/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/clipcraft-legacy/pneuma-mode.js").then((m) => m.default),
  },
```

(The new `clipcraft:` entry gets added in Task 4. Don't add it yet.)

- [ ] **Step 1.4: Update `server/index.ts` `builtinNames`**

Find **both** occurrences of `builtinNames` arrays (one in launcherMode, one in the main registry block). In each, replace `"clipcraft"` with `"clipcraft-legacy"`:

```ts
const builtinNames = ["webcraft", "slide", "doc", "draw", "diagram", "illustrate", "remotion", "gridboard", "clipcraft-legacy"];
```

- [ ] **Step 1.5: Update `CLAUDE.md`**

Replace `clipcraft` with `clipcraft-legacy` in the two lines that list builtin modes (the `**Builtin Modes:**` bullet near the top and the `modes/{...}/` tree line in Project Structure).

- [ ] **Step 1.6: Update legacy mode's own internal name references**

The legacy manifest carries its own `name` and `skill.installName` fields. Update them so nothing clashes with the new mode:

```bash
grep -n '"clipcraft"\|"pneuma-clipcraft"\|installName' modes/clipcraft-legacy/manifest.ts
```

Then hand-edit the legacy manifest:
- `manifest.name: "clipcraft"` → `"clipcraft-legacy"`
- `manifest.skill.installName: "<whatever it was>"` → prefix with `-legacy` (e.g. `"pneuma-clipcraft"` → `"pneuma-clipcraft-legacy"`) so the two modes never overwrite each other's `.claude/skills/<name>/` directory when used in the same workspace.

Also grep `modes/clipcraft-legacy/pneuma-mode.ts` for any `"clipcraft"` string literal — there shouldn't be any hardcoded id, but confirm.

Do NOT rename symbols inside `modes/clipcraft-legacy/skill/SKILL.md` content — that's prose the agent reads at runtime, not a runtime identifier.

- [ ] **Step 1.7: Run typecheck**

Run: `bun run tsc --noEmit 2>&1 | head -40`
Expected: no errors, or only errors unrelated to the rename. If errors reference paths like `modes/clipcraft/...` they must be fixed here before moving on.

- [ ] **Step 1.8: Launch the legacy mode and confirm it still works**

Run in a separate terminal (do NOT background — user watches output):

```bash
bun run dev clipcraft-legacy --workspace /tmp/clipcraft-legacy-smoke --no-open --port 17996
```

Expected: server starts, prints `http://localhost:17996`, no red errors about missing modules. Kill with Ctrl-C.

- [ ] **Step 1.9: Commit**

```bash
git add -A
git commit -m "refactor(clipcraft): rename mvp mode to clipcraft-legacy"
```

---

## Task 2: Add pneuma-craft packages as local file deps

**Files:**
- Modify: `package.json`
- Modify: `bun.lock` (regenerated)

- [ ] **Step 2.1: Verify craft packages are built**

Run: `ls /Users/pandazki/Codes/pneuma-craft-headless-stable/packages/core/dist/index.js /Users/pandazki/Codes/pneuma-craft-headless-stable/packages/timeline/dist/index.js /Users/pandazki/Codes/pneuma-craft-headless-stable/packages/video/dist/index.js /Users/pandazki/Codes/pneuma-craft-headless-stable/packages/react/dist/index.js`

Expected: all 4 files exist. If any missing, run `cd /Users/pandazki/Codes/pneuma-craft-headless-stable && bun install && bun run build` first.

- [ ] **Step 2.2: Add deps to `package.json`**

In the `"dependencies"` block of `package.json`, insert (keeping alphabetical order if that's the existing convention — otherwise append):

```json
"@pneuma-craft/core": "file:../pneuma-craft-headless-stable/packages/core",
"@pneuma-craft/timeline": "file:../pneuma-craft-headless-stable/packages/timeline",
"@pneuma-craft/video": "file:../pneuma-craft-headless-stable/packages/video",
"@pneuma-craft/react": "file:../pneuma-craft-headless-stable/packages/react",
```

- [ ] **Step 2.3: Install**

Run: `bun install`
Expected: `bun.lock` updates, no resolution errors. Bun symlinks file-deps into `node_modules/@pneuma-craft/*`.

- [ ] **Step 2.4: Verify symlinks**

Run: `ls -la node_modules/@pneuma-craft/`
Expected: 4 symlinks pointing to `../../../pneuma-craft-headless-stable/packages/{core,timeline,video,react}`.

- [ ] **Step 2.5: Smoke-test an import from each package**

Create a throwaway file `/tmp/craft-smoke.ts`:

```ts
import { createCore } from "@pneuma-craft/core";
import { createTimelineCore } from "@pneuma-craft/timeline";
import { createPlaybackEngine } from "@pneuma-craft/video";
import { createPneumaCraftStore } from "@pneuma-craft/react";

console.log("core:", typeof createCore);
console.log("timeline:", typeof createTimelineCore);
console.log("video:", typeof createPlaybackEngine);
console.log("react:", typeof createPneumaCraftStore);
```

Run: `bun /tmp/craft-smoke.ts`
Expected output:
```
core: function
timeline: function
video: function
react: function
```

If any import fails, stop and report — likely a mismatch between the export names I listed above and what the packages actually export. Fix by reading `packages/<name>/src/index.ts` in the craft repo and using the real names.

- [ ] **Step 2.6: Commit**

```bash
rm /tmp/craft-smoke.ts
git add package.json bun.lock
git commit -m "feat(clipcraft): add @pneuma-craft/* as local file deps"
```

---

## Task 3: Scaffold new clipcraft mode directory

**Files:**
- Create: `modes/clipcraft/manifest.ts`
- Create: `modes/clipcraft/pneuma-mode.ts`
- Create: `modes/clipcraft/types.ts`
- Create: `modes/clipcraft/seed/project.json`
- Create: `modes/clipcraft/skill/SKILL.md`

- [ ] **Step 3.1: Create `modes/clipcraft/manifest.ts`**

```ts
/**
 * ClipCraft Mode Manifest (bootstrap).
 * Kept intentionally minimal — the real manifest (MCP servers, actions, commands,
 * locators, scaffold, evolution) will grow back as follow-up plans land.
 */

import type { ModeManifest } from "../../core/types/mode-manifest.js";

const clipcraftManifest: ModeManifest = {
  name: "clipcraft",
  version: "0.1.0-bootstrap",
  displayName: "ClipCraft",
  description: "AI-orchestrated video production, rebuilt on @pneuma-craft",

  supportedBackends: ["claude-code"],
  layout: "editor",

  skill: {
    sourceDir: "skill",
    installName: "pneuma-clipcraft",
    claudeMdSection: `## Pneuma ClipCraft Mode

You are running inside **Pneuma**, a co-creation workspace. This is **ClipCraft Mode** — AI-orchestrated video production rebuilt on the \`@pneuma-craft\` headless runtime.

**Status:** Bootstrap scaffold. The real skill (workflow, domain vocabulary, MCP tools) will be written in follow-up plans. For now, only minimal file editing inside \`project.json\` is supported.`,
  },

  viewer: {
    watchPatterns: ["project.json"],
    ignorePatterns: [],
    serveDir: ".",
    refreshStrategy: "auto",
  },

  init: {
    contentCheckPattern: "project.json",
    seedFiles: {
      "modes/clipcraft/seed/project.json": "project.json",
    },
  },
};

export default clipcraftManifest;
```

- [ ] **Step 3.2: Create `modes/clipcraft/pneuma-mode.ts`**

```ts
/**
 * ClipCraft Mode — ModeDefinition.
 * Wires the manifest together with the React viewer component.
 * Dynamically imported by mode-loader.ts via default export.
 */

import type { ModeDefinition } from "../../core/types/mode-definition.js";
import ClipCraftPreview from "./viewer/ClipCraftPreview.js";
import clipcraftManifest from "./manifest.js";

const clipcraftMode: ModeDefinition = {
  manifest: clipcraftManifest,

  viewer: {
    PreviewComponent: ClipCraftPreview,

    extractContext(_selection, files) {
      const fileCount = files.length;
      return `<viewer-context mode="clipcraft" files="${fileCount}">\nClipCraft bootstrap — ${fileCount} file(s) in workspace\n</viewer-context>`;
    },

    updateStrategy: "full-reload",
  },
};

export default clipcraftMode;
```

Note: `ModeDefinition` is imported from `core/types/mode-definition.js` (NOT `mode-manifest.js`). Its required fields are exactly `manifest` and `viewer`. `viewer` must provide `PreviewComponent`, `extractContext`, and `updateStrategy` at minimum — `workspace`, `actions`, `commands` are optional and deliberately omitted in the bootstrap. Reference: `core/types/mode-definition.ts` and `core/types/viewer-contract.ts`.

- [ ] **Step 3.3: Create `modes/clipcraft/types.ts`**

```ts
// Domain types for clipcraft. All real types will come from @pneuma-craft/*
// in subsequent plans. This file exists so future `import from "./types"`
// paths don't have to be invented twice.
export {};
```

- [ ] **Step 3.4: Create `modes/clipcraft/seed/project.json`**

```json
{
  "title": "Untitled",
  "fps": 30,
  "resolution": { "width": 1920, "height": 1080 }
}
```

- [ ] **Step 3.5: Create `modes/clipcraft/skill/SKILL.md`**

```markdown
---
name: clipcraft
description: AI-orchestrated video production on @pneuma-craft
---

# ClipCraft

> **Status:** Bootstrap scaffold. The real skill will be rewritten once the
> craft-based domain model is wired in (see `docs/superpowers/plans/`).

Workflow, commands, and domain vocabulary are TBD. For now, the mode launches
an empty craft-backed viewer so we can iterate on the underlying wiring.
```

- [ ] **Step 3.6: Verify the scaffold typechecks**

Run: `bun run tsc --noEmit 2>&1 | grep -E "clipcraft[^-]" | head -20`
Expected: no errors mentioning `modes/clipcraft/` (the new scaffold). Errors referencing `modes/clipcraft-legacy/` are fine.

If you see errors about missing fields on `ModeManifest` or `ModeDefinition`, read the actual type in `core/types/mode-manifest.ts` and fix the scaffold to match. Do NOT loosen the types.

- [ ] **Step 3.7: Commit**

```bash
git add modes/clipcraft/
git commit -m "feat(clipcraft): scaffold new mode directory"
```

---

## Task 4: Register new mode in mode-loader and server

**Files:**
- Modify: `core/mode-loader.ts`
- Modify: `server/index.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 4.1: Add `clipcraft` entry to `mode-loader.ts`**

Directly below the `"clipcraft-legacy":` block you created in Task 1.3, add:

```ts
  clipcraft: {
    type: "builtin",
    manifestLoader: () =>
      import("../modes/clipcraft/manifest.js").then((m) => m.default),
    definitionLoader: () =>
      import("../modes/clipcraft/pneuma-mode.js").then((m) => m.default),
  },
```

- [ ] **Step 4.2: Add `clipcraft` back to `server/index.ts` `builtinNames`**

In both `builtinNames` arrays, append `"clipcraft"` so the final list reads (order preserved, legacy already there from Task 1):

```ts
const builtinNames = ["webcraft", "slide", "doc", "draw", "diagram", "illustrate", "remotion", "gridboard", "clipcraft-legacy", "clipcraft"];
```

- [ ] **Step 4.3: Update `CLAUDE.md` builtin modes lists**

Add `clipcraft` back alongside `clipcraft-legacy` in both:
- The `**Builtin Modes:**` line
- The `modes/{...}/` tree entry in Project Structure

- [ ] **Step 4.4: Typecheck**

Run: `bun run tsc --noEmit 2>&1 | head -40`
Expected: no errors.

- [ ] **Step 4.5: Commit**

```bash
git add core/mode-loader.ts server/index.ts CLAUDE.md
git commit -m "feat(clipcraft): register new mode in loader and server"
```

---

## Task 5: Build the stub craft-backed viewer

**Files:**
- Create: `modes/clipcraft/viewer/ClipCraftPreview.tsx`
- Create: `modes/clipcraft/viewer/assetResolver.ts`

- [ ] **Step 5.1: Create `assetResolver.ts`**

```ts
import type { AssetResolver } from "@pneuma-craft/video";

/**
 * Minimal AssetResolver — resolves asset ids to URLs served by pneuma's
 * workspace file server (exposed at `/content/<path>`).
 *
 * Note: @pneuma-craft/video declares `resolveUrl` as SYNCHRONOUS
 * (returns string, not Promise<string>). Matching that signature exactly.
 *
 * Asset ids are treated as workspace-relative paths in the bootstrap —
 * real content addressing will land with the provenance layer in a later plan.
 */
export function createWorkspaceAssetResolver(): AssetResolver {
  return {
    resolveUrl(assetId: string): string {
      return `/content/${assetId}`;
    },
    async fetchBlob(assetId: string): Promise<Blob> {
      const res = await fetch(`/content/${assetId}`);
      if (!res.ok) throw new Error(`fetchBlob ${assetId}: ${res.status}`);
      return await res.blob();
    },
  };
}
```

Verification: after writing, confirm the shape still compiles against the real d.ts:

```bash
grep -A 4 "interface AssetResolver" node_modules/@pneuma-craft/video/dist/index.d.ts
```

Expected: `resolveUrl(assetId: string): string;` (NOT `Promise<string>`). If the packaged d.ts differs from what this plan assumes, stop and report — the discrepancy means the craft package version on disk is out of sync with the survey.

- [ ] **Step 5.2: Create `ClipCraftPreview.tsx`**

```tsx
import { useMemo } from "react";
import type { ComponentType } from "react";
import { PneumaCraftProvider } from "@pneuma-craft/react";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { createWorkspaceAssetResolver } from "./assetResolver.js";

/**
 * ClipCraft viewer (bootstrap).
 * Wraps the craft provider so all descendant craft hooks/components work,
 * but renders a placeholder — no real UI yet.
 */
const ClipCraftPreview: ComponentType<ViewerPreviewProps> = ({ files }) => {
  const assetResolver = useMemo(() => createWorkspaceAssetResolver(), []);

  return (
    <PneumaCraftProvider assetResolver={assetResolver}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#a1a1aa",
          fontFamily: "system-ui",
          fontSize: 14,
          background: "#09090b",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, marginBottom: 8, color: "#f97316" }}>
            ClipCraft
          </div>
          <div>craft-backed viewer bootstrap — {files.length} file(s) synced</div>
        </div>
      </div>
    </PneumaCraftProvider>
  );
};

export default ClipCraftPreview;
```

The component must be typed as `ComponentType<ViewerPreviewProps>` because that's what `ViewerContract.PreviewComponent` declares (`core/types/viewer-contract.ts`). `ViewerPreviewProps` has many optional fields (`selection`, `onSelect`, `mode`, `imageVersion`, `actionRequest`, etc.) — the bootstrap only uses `files`, which is fine because unused props don't need destructuring. Cross-reference `modes/doc/viewer/DocPreview.tsx` for the existing-mode convention (it also default-exports).

**Do not add a `workspaceUrl` prop** — pneuma serves workspace files at `/content/<path>` unconditionally; the resolver hardcodes that prefix.

- [ ] **Step 5.3: Typecheck**

Run: `bun run tsc --noEmit 2>&1 | grep -E "modes/clipcraft[^-]" | head -20`
Expected: no errors.

If TS complains that `@pneuma-craft/react` has no types, verify `dist/index.d.ts` exists in that package and that `tsconfig.json` in pneuma-skills does not exclude file-deps.

- [ ] **Step 5.4: Commit**

```bash
git add modes/clipcraft/viewer/
git commit -m "feat(clipcraft): stub viewer with PneumaCraftProvider"
```

---

## Task 6: End-to-end launch verification

**Files:** none modified; this is a manual verification step.

- [ ] **Step 6.1: Launch new clipcraft mode**

Run in a terminal the user can see:

```bash
bun run dev clipcraft --workspace /tmp/clipcraft-bootstrap-smoke --no-open --port 17996
```

Expected: server starts, prints `http://localhost:17996`, no red errors in console. The seed files (`project.json`) are copied into `/tmp/clipcraft-bootstrap-smoke/`.

- [ ] **Step 6.2: Open in Chrome and screenshot**

Use the `chrome-devtools-mcp` tool (per CLAUDE.md: "Visual verification for frontend changes") to open `http://localhost:17996` and take a screenshot.

Expected: the placeholder "ClipCraft / craft-backed viewer bootstrap — 1 file(s) synced" is visible. No red console errors.

- [ ] **Step 6.3: Capture any console errors**

Use `list_console_messages` from chrome-devtools-mcp. Report any errors to the reviewer before continuing. Warnings from React strict-mode or HMR are fine; real errors (missing module, undefined export, provider crash) are blockers.

- [ ] **Step 6.4: Kill the dev server**

Ctrl-C the session.

- [ ] **Step 6.5: No commit needed — verification only**

If fixups were required during verification, commit them separately:

```bash
git add -A
git commit -m "fix(clipcraft): bootstrap smoke-test fixups"
```

---

## Task 7: Baseline test for craft package imports

**Files:**
- Create: `modes/clipcraft/__tests__/craft-imports.test.ts`

- [ ] **Step 7.1: Write the test**

```ts
import { describe, expect, it } from "bun:test";
import { createCore } from "@pneuma-craft/core";
import { createTimelineCore } from "@pneuma-craft/timeline";
import { createPlaybackEngine } from "@pneuma-craft/video";
import { createPneumaCraftStore } from "@pneuma-craft/react";
import { createWorkspaceAssetResolver } from "../viewer/assetResolver.js";

describe("craft package imports", () => {
  it("exposes createCore from @pneuma-craft/core with expected methods", () => {
    expect(typeof createCore).toBe("function");
    const core = createCore();
    expect(typeof core.getState).toBe("function");
    expect(typeof core.dispatch).toBe("function");
    expect(typeof core.subscribe).toBe("function");
    expect(typeof core.undo).toBe("function");
    expect(typeof core.redo).toBe("function");
    expect(typeof core.canUndo).toBe("function");
    expect(typeof core.canRedo).toBe("function");
    expect(typeof core.getEvents).toBe("function");
    // Sanity: fresh state is non-null and has the expected shape
    const state = core.getState();
    expect(state).toBeDefined();
    expect(state.registry).toBeInstanceOf(Map);
  });

  it("exposes createTimelineCore from @pneuma-craft/timeline with expected methods", () => {
    expect(typeof createTimelineCore).toBe("function");
    const tl = createTimelineCore();
    // TimelineCore uses getCoreState (NOT getState) + getComposition
    expect(typeof tl.getCoreState).toBe("function");
    expect(typeof tl.getComposition).toBe("function");
    expect(typeof tl.dispatch).toBe("function");
    expect(typeof tl.subscribe).toBe("function");
    // No composition until one is created
    expect(tl.getComposition()).toBeNull();
  });

  it("exposes createPlaybackEngine from @pneuma-craft/video", () => {
    expect(typeof createPlaybackEngine).toBe("function");
    // Don't instantiate — it needs an AudioContext + Compositor, which are
    // browser-only. This test runs under bun/node so we only check the factory.
  });

  it("exposes createPneumaCraftStore from @pneuma-craft/react", () => {
    expect(typeof createPneumaCraftStore).toBe("function");
    // createPneumaCraftStore needs an AssetResolver; pass our mode's resolver.
    const store = createPneumaCraftStore(createWorkspaceAssetResolver());
    expect(store).toBeDefined();
    expect(typeof store.getState).toBe("function");
    const state = store.getState();
    expect(state.coreState).toBeDefined();
    expect(state.composition).toBeNull(); // empty until we create one
    // Cleanup lazy playback engine if it was started
    state.destroy?.();
  });
});
```

Assertions are grounded in the d.ts files:
- `CraftCore` has `{ getState, dispatch, subscribe, undo, redo, canUndo, canRedo, getEvents }` (`node_modules/@pneuma-craft/core/dist/index.d.ts`)
- `TimelineCore` has `{ getCoreState, getComposition, dispatch, subscribe, undo, redo, canUndo, canRedo, getEvents }` — it does NOT expose `getState`
- `createPneumaCraftStore(assetResolver)` returns a Zustand `StoreApi<PneumaCraftStore>`; calling `.getState()` on it yields `{ coreState, composition, ..., destroy, ... }`

If any assertion fails, fix the test against the real type rather than weakening the assertion. A failing test here means the plan's assumptions about the craft packages are wrong and downstream plans will inherit the error.

- [ ] **Step 7.2: Run the test**

Run: `bun test modes/clipcraft/__tests__/craft-imports.test.ts`
Expected: 4 passing assertions.

- [ ] **Step 7.3: Run the full test suite to catch regressions**

Run: `bun test 2>&1 | tail -20`
Expected: all previously-passing tests still pass. If a legacy-mode test now fails because its import path changed from `modes/clipcraft/` to `modes/clipcraft-legacy/`, fix the test's import and add it to the commit.

- [ ] **Step 7.4: Commit**

```bash
git add modes/clipcraft/__tests__/
git commit -m "test(clipcraft): baseline craft package import sanity"
```

---

## Task 8: Write follow-up plan stub

**Files:**
- Create: `docs/superpowers/plans/NEXT.md`

- [ ] **Step 8.1: Create a pointer to the next plan**

```markdown
# Next plans for ClipCraft × Pneuma-Craft

Completed:
- 2026-04-12-clipcraft-craft-bootstrap.md — rename legacy, scaffold new mode, wire craft packages

Upcoming (to be written one at a time, each producing working software):
- Plan 2: Domain + store — wire craft `TimelineCore` into the new mode; load/save `project.json` via craft's event log; no UI yet beyond showing the current state.
- Plan 3: Playback + preview — integrate craft `PlaybackEngine`; render the canvas into `VideoPreview`; prove a single clip can load and play.
- Plan 4: Timeline UI — port the legacy `Timeline` + tracks to read from craft's composition selectors; drop the legacy reducer.
- Plan 5: TimelineOverview3D on craft — re-implement the 3D overview reading from craft provenance / composition; keep the visual design.
- Plan 6: DiveCanvas on craft — re-implement the dive canvas reading from craft provenance lineage/variants.
- Plan 7: Export — replace `server/ffmpeg.ts` with craft `ExportEngine` in the browser; decide fallback strategy for long videos.
- Plan 8: On-disk format + MCP tool integration — `storyboard.json`/`graph.json` become projections of craft state; wire MCP scripts into craft `generate` / `derive` provenance operations.
- Plan 9: Skill rewrite — rewrite `modes/clipcraft/skill/SKILL.md` against the real craft domain model and agent workflow.

Before each plan: survey what legacy does, decide if a new concept belongs in the mode or upstream in a craft package, discuss with the user, then write the plan.
```

- [ ] **Step 8.2: Commit**

```bash
git add docs/superpowers/plans/NEXT.md
git commit -m "docs(clipcraft): roadmap for follow-up plans"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - Rename legacy → Task 1 ✓
  - Add craft file deps → Task 2 ✓
  - Scaffold new mode → Task 3 ✓
  - Register in loader/server → Task 4 ✓
  - Stub viewer with PneumaCraftProvider → Task 5 ✓
  - End-to-end launch verification → Task 6 ✓
  - Test baseline → Task 7 ✓
  - Roadmap for future plans → Task 8 ✓

- **Placeholder scan:** Every code step has a concrete code block. The few "if the real type differs, match it" notes are not placeholders — they're explicit fallbacks tied to fresh reads of real files in the repo.

- **Type consistency:** `ClipCraftPreview` default-exports a function; `manifest.ts` viewer entry points at `./viewer/ClipCraftPreview.tsx`; test file uses `createCore`/`createTimelineCore`/`createPlaybackEngine`/`createPneumaCraftStore`, matching the smoke test in Task 2.5 and the survey.

- **Types verified against `.d.ts`:** The plan's type assumptions were cross-checked against the real files before execution:
  - `@pneuma-craft/core` → `CraftCore` has `getState`/`dispatch`/`subscribe`/`undo`/`redo`/`canUndo`/`canRedo`/`getEvents`; `state.registry` is a `Map`
  - `@pneuma-craft/timeline` → `TimelineCore` has `getCoreState` (NOT `getState`) + `getComposition`; `getComposition()` returns null until `composition:create` is dispatched
  - `@pneuma-craft/video` → `AssetResolver.resolveUrl(id): string` is **synchronous**; `fetchBlob` is async
  - `@pneuma-craft/react` → `PneumaCraftProvider` requires a stable `assetResolver` prop; `createPneumaCraftStore(assetResolver)` returns a Zustand `StoreApi<PneumaCraftStore>`
  - `core/types/mode-manifest.ts` → `ModeManifest.skill` is a `SkillConfig` (`sourceDir`/`installName`/`claudeMdSection`), `ModeManifest.viewer` is a `ViewerConfig` with required `watchPatterns` + `ignorePatterns` (no `entry` field — viewer components are wired through `pneuma-mode.ts`)
  - `core/types/mode-definition.ts` → `ModeDefinition` is `{ manifest, viewer: ViewerContract }`; default-exported
  - `core/types/viewer-contract.ts` → `ViewerContract.PreviewComponent` is `ComponentType<ViewerPreviewProps>`; workspace files are served at `/content/<path>`
- **Remaining risk:** The craft package `dist/` may diverge from `src/` if the headless repo is in an inconsistent state. Task 2.1 verifies `dist/index.js` exists; Task 5.1 has a verification step that greps the d.ts for the real `resolveUrl` signature; Task 7.3 runs the full test suite to catch regressions from the rename. If any of these fail, stop and report.
