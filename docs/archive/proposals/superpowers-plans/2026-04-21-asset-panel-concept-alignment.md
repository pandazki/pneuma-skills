# Asset Panel Concept Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the clipcraft AssetPanel the union of the workspace's `assets/` directory and `project.json.assets[]`, so agent-generated-but-unregistered files and human-dropped files are both visible, with a clear "Import" affordance that closes the file-to-asset gap. Fix adjacent concept drift: remove the dead "Text" group, surface audio waveforms for visual parity with video thumbnails.

**Architecture:**
- Server exposes a new read-only route that returns a flat listing of media files under `assets/**` (size + mtime). Pure filesystem scan, no reconciliation on the server.
- Client does reconciliation: diffs the listing against `coreState.registry` (the in-memory `project.json.assets[]`), classifying each URI as **registered** (both), **orphaned** (on disk only), or **missing** (in registry only).
- AssetPanel renders all three states. Orphaned rows carry an "Import" button that dispatches the existing `asset:register` command with a URI-only payload (no file re-upload). Missing rows get a warning badge.
- "Text" group is removed from `GROUPS` — subtitle creation stays agent-only via direct `project.json` edits.
- Audio thumbnails render a peaked-downsampled waveform (Web Audio API, in-memory cache per URL).

**Tech Stack:** Bun (server), Hono (routes), React 19 (viewer), `bun:test` for unit tests, chokidar is already wired for `project.json` (no change), Web Audio API for waveform decode.

**Not in scope** (separate follow-up plans):
- Overlay track + keyframe support for image clips.
- Subtitle clips becoming asset-backed.
- Server-push of filesystem change events (client re-fetches on mount + after uploads / imports instead).

---

## File Structure

**New files:**
- `server/routes/asset-fs.ts` — registers `GET /api/assets/fs-listing`. Mirrors the style of `server/routes/export.ts` (takes `{ workspace }` option).
- `modes/clipcraft/viewer/assets/reconcile.ts` — pure function `reconcileAssets(fs, registered)` returning `ReconcileReport`.
- `modes/clipcraft/viewer/assets/__tests__/reconcile.test.ts` — unit tests for reconcile.
- `modes/clipcraft/viewer/assets/useAssetFsListing.ts` — client hook: fetches listing, exposes `{ listing, refetch }`.
- `modes/clipcraft/viewer/assets/waveform.ts` — decode audio file to a peaked-downsampled Float32Array; in-memory cache keyed by URL.

**Modified files:**
- `server/index.ts` — import and mount `registerAssetFsRoutes` alongside the existing export routes.
- `modes/clipcraft/viewer/assets/AssetPanel.tsx` — plug reconcile, remove "Text" group, render three states.
- `modes/clipcraft/viewer/assets/AssetGroup.tsx` — render orphan rows (new prop).
- `modes/clipcraft/viewer/assets/AssetThumbnail.tsx` — render waveform for audio assets; render "missing" badge when file is absent.
- `modes/clipcraft/viewer/assets/useAssetActions.ts` — add `importOrphan(fsEntry)` that dispatches `asset:register` for a URI already on disk (no upload body).
- `modes/clipcraft/skill/references/workflows.md` — add a short "Agents can just write files into `assets/<type>/`; the user can Import via the panel, or the agent can pre-register with `composition:register-asset`" note.

---

### Task 1: Reconcile utility + unit tests

**Files:**
- Create: `modes/clipcraft/viewer/assets/reconcile.ts`
- Create: `modes/clipcraft/viewer/assets/__tests__/reconcile.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `modes/clipcraft/viewer/assets/__tests__/reconcile.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { reconcileAssets, type FsEntry, type RegisteredEntry } from "../reconcile.js";

function fs(uri: string, size = 1234, mtime = 1_700_000_000_000): FsEntry {
  return { uri, size, mtime };
}

function reg(assetId: string, uri: string): RegisteredEntry {
  return { assetId, uri };
}

describe("reconcileAssets", () => {
  test("empty inputs produce an empty report", () => {
    expect(reconcileAssets([], [])).toEqual({
      registered: [],
      orphaned: [],
      missing: [],
    });
  });

  test("file on disk with no matching registry entry is orphaned", () => {
    const fsList = [fs("assets/video/foo.mp4")];
    const regList: RegisteredEntry[] = [];
    expect(reconcileAssets(fsList, regList)).toEqual({
      registered: [],
      orphaned: [fs("assets/video/foo.mp4")],
      missing: [],
    });
  });

  test("registry entry with no file on disk is missing", () => {
    const fsList: FsEntry[] = [];
    const regList = [reg("asset-a", "assets/video/foo.mp4")];
    expect(reconcileAssets(fsList, regList)).toEqual({
      registered: [],
      orphaned: [],
      missing: [reg("asset-a", "assets/video/foo.mp4")],
    });
  });

  test("matching URI classifies as registered and carries both views", () => {
    const fsList = [fs("assets/video/foo.mp4", 5000, 9999)];
    const regList = [reg("asset-a", "assets/video/foo.mp4")];
    const report = reconcileAssets(fsList, regList);
    expect(report.orphaned).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(report.registered).toEqual([
      { assetId: "asset-a", uri: "assets/video/foo.mp4", size: 5000, mtime: 9999 },
    ]);
  });

  test("URI comparison is case-sensitive and normalizes forward slashes only", () => {
    const fsList = [fs("assets/video/Foo.mp4")];
    const regList = [reg("asset-a", "assets/video/foo.mp4")];
    const report = reconcileAssets(fsList, regList);
    expect(report.orphaned.map((e) => e.uri)).toEqual(["assets/video/Foo.mp4"]);
    expect(report.missing.map((e) => e.uri)).toEqual(["assets/video/foo.mp4"]);
    expect(report.registered).toEqual([]);
  });

  test("handles mixed sets without cross-contamination", () => {
    const fsList = [
      fs("assets/video/a.mp4"),
      fs("assets/image/b.png"),
      fs("assets/audio/c.mp3"),
    ];
    const regList = [
      reg("asset-a", "assets/video/a.mp4"),
      reg("asset-dead", "assets/video/gone.mp4"),
    ];
    const report = reconcileAssets(fsList, regList);
    expect(report.registered.map((e) => e.uri).sort()).toEqual(["assets/video/a.mp4"]);
    expect(report.orphaned.map((e) => e.uri).sort()).toEqual([
      "assets/audio/c.mp3",
      "assets/image/b.png",
    ]);
    expect(report.missing.map((e) => e.uri)).toEqual(["assets/video/gone.mp4"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun test modes/clipcraft/viewer/assets/__tests__/reconcile.test.ts`

Expected: FAIL with `Cannot find module '../reconcile.js'` or similar.

- [ ] **Step 3: Write the minimal implementation**

Create `modes/clipcraft/viewer/assets/reconcile.ts`:

```ts
/**
 * Pure reconciliation of the workspace `assets/` directory listing
 * against the in-memory `project.json.assets[]` registry. No I/O here;
 * the caller fetches the filesystem listing (e.g. from the server
 * `/api/assets/fs-listing` route) and hands the registry view in.
 *
 * URIs are compared literally (byte-for-byte) — callers are expected
 * to normalize both sides to workspace-relative forward-slash paths.
 */

export interface FsEntry {
  /** Workspace-relative path with forward slashes, e.g. "assets/video/foo.mp4". */
  uri: string;
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
}

export interface RegisteredEntry {
  assetId: string;
  uri: string;
}

export interface RegisteredReconciled extends RegisteredEntry {
  size: number;
  mtime: number;
}

export interface ReconcileReport {
  registered: RegisteredReconciled[];
  orphaned: FsEntry[];
  missing: RegisteredEntry[];
}

export function reconcileAssets(
  fsList: FsEntry[],
  registered: RegisteredEntry[],
): ReconcileReport {
  const fsByUri = new Map<string, FsEntry>();
  for (const entry of fsList) fsByUri.set(entry.uri, entry);

  const registeredUris = new Set<string>();
  const registeredOut: RegisteredReconciled[] = [];
  const missing: RegisteredEntry[] = [];

  for (const entry of registered) {
    registeredUris.add(entry.uri);
    const fs = fsByUri.get(entry.uri);
    if (fs) {
      registeredOut.push({ ...entry, size: fs.size, mtime: fs.mtime });
    } else {
      missing.push(entry);
    }
  }

  const orphaned: FsEntry[] = [];
  for (const entry of fsList) {
    if (!registeredUris.has(entry.uri)) orphaned.push(entry);
  }

  return { registered: registeredOut, orphaned, missing };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft && bun test modes/clipcraft/viewer/assets/__tests__/reconcile.test.ts`

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft
git add modes/clipcraft/viewer/assets/reconcile.ts modes/clipcraft/viewer/assets/__tests__/reconcile.test.ts
git commit -m "feat(clipcraft/assets): add reconcile utility + unit tests"
```

---

### Task 2: Server FS listing route

**Files:**
- Create: `server/routes/asset-fs.ts`
- Modify: `server/index.ts` (import + mount the new route)

- [ ] **Step 1: Write the route module**

Create `server/routes/asset-fs.ts`:

```ts
/**
 * Asset filesystem listing route.
 *
 * Registered for clipcraft-style modes. Returns a flat listing of
 * media files under `<workspace>/assets/**` with size + mtime. Pure
 * filesystem scan — no project.json parsing, no reconciliation. The
 * client does the diff against its in-memory asset registry.
 *
 * Includes: GET /api/assets/fs-listing.
 */

import type { Hono } from "hono";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";

export interface AssetFsOptions {
  workspace: string;
}

const MEDIA_EXTS = new Set([
  // video
  ".mp4", ".mov", ".webm", ".mkv", ".m4v",
  // image
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp",
  // audio
  ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".opus",
]);

interface FsEntry {
  uri: string;
  size: number;
  mtime: number;
}

function walk(root: string, out: FsEntry[]) {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue; // skip dotfiles / dotdirs
    const abs = join(root, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(abs, out);
    } else if (st.isFile()) {
      const ext = extname(name).toLowerCase();
      if (!MEDIA_EXTS.has(ext)) continue;
      out.push({ abs, size: st.size, mtime: Math.floor(st.mtimeMs) } as unknown as FsEntry);
    }
  }
}

export function registerAssetFsRoutes(app: Hono, options: AssetFsOptions) {
  const { workspace } = options;

  app.get("/api/assets/fs-listing", (c) => {
    const assetsDir = join(workspace, "assets");
    if (!existsSync(assetsDir)) {
      return c.json({ entries: [] });
    }
    const absEntries: Array<{ abs: string; size: number; mtime: number }> = [];
    walk(assetsDir, absEntries as unknown as FsEntry[]);
    const entries: FsEntry[] = absEntries.map((e) => ({
      uri: relative(workspace, e.abs).split(sep).join("/"),
      size: e.size,
      mtime: e.mtime,
    }));
    entries.sort((a, b) => a.uri.localeCompare(b.uri));
    return c.json({ entries });
  });
}
```

- [ ] **Step 2: Mount the route in server/index.ts**

Find the block that calls `registerExportRoutes(app, { workspace, ... })`. Directly after that call, add:

```ts
import { registerAssetFsRoutes } from "./routes/asset-fs.js";
// ...
registerAssetFsRoutes(app, { workspace });
```

Make sure the import line sits with the other route imports near the top of `server/index.ts`, and the call sits in the same conditional block that already registers `registerExportRoutes` (i.e. for non-launcher modes). If `server/index.ts` conditionally registers export routes with something like `if (mode)` or `if (modeManifest)`, mirror the same guard.

- [ ] **Step 3: Manual smoke test via curl**

With the dev server running (`bun run dev clipcraft --workspace /tmp/clipcraft-playground --dev --no-prompt`):

Run (replace port if different):
```bash
curl -s http://localhost:17007/api/assets/fs-listing | head -c 600
```

Expected: a JSON object `{"entries":[...]}`. If the workspace has no `assets/` dir, `{"entries":[]}`. If it has a `panda-sad-v1.mp4` and similar seed assets, those appear with workspace-relative URIs using forward slashes.

Edge case to verify manually: create `/tmp/clipcraft-playground/assets/test.mp4` (touch a zero-byte file) and curl again — it should appear in `entries`.

- [ ] **Step 4: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft
git add server/routes/asset-fs.ts server/index.ts
git commit -m "feat(server): add GET /api/assets/fs-listing route"
```

---

### Task 3: Client hook `useAssetFsListing`

**Files:**
- Create: `modes/clipcraft/viewer/assets/useAssetFsListing.ts`

- [ ] **Step 1: Write the hook**

Create `modes/clipcraft/viewer/assets/useAssetFsListing.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { FsEntry } from "./reconcile.js";

interface Response {
  entries: FsEntry[];
}

interface State {
  entries: FsEntry[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the `/api/assets/fs-listing` route and exposes the result
 * as React state. Callers should call `refetch()` after any action
 * that is likely to change the filesystem (upload success, orphan
 * import, etc.). No polling — users who need instant reflection of
 * direct-to-disk writes can trigger a refetch via the panel's
 * refresh button.
 */
export function useAssetFsListing(): State & { refetch: () => void } {
  const [state, setState] = useState<State>({
    entries: [],
    loading: true,
    error: null,
  });

  const refetch = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    fetch("/api/assets/fs-listing")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Response>;
      })
      .then((data) => {
        setState({ entries: data.entries ?? [], loading: false, error: null });
      })
      .catch((err) => {
        setState({
          entries: [],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { ...state, refetch };
}
```

- [ ] **Step 2: Verify type-check**

Run (in the worktree):
```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft
bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "useAssetFsListing|reconcile" | head -10
```

Expected: no errors referencing either file. If `tsc` flags unrelated pre-existing errors they're outside this task's scope — the grep above narrows the output.

- [ ] **Step 3: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft
git add modes/clipcraft/viewer/assets/useAssetFsListing.ts
git commit -m "feat(clipcraft/assets): add useAssetFsListing hook"
```

---

### Task 4: Import-orphan action

**Files:**
- Modify: `modes/clipcraft/viewer/assets/useAssetActions.ts`

Context: `useAssetActions` currently has an `upload(file)` function that reads a File via FileReader, POSTs to `/api/files`, then dispatches `asset:register`. Orphans already exist on disk, so we only need the dispatch step — skip the File read and the upload POST.

- [ ] **Step 1: Read the existing useAssetActions.ts**

Open `modes/clipcraft/viewer/assets/useAssetActions.ts`. Find the `classifyAssetType(filenameOrUri)` function and the `upload` method. Both are used as the model for `importOrphan`.

- [ ] **Step 2: Add importOrphan method**

Add (inside the same returned object as `upload`; keep existing code unchanged):

```ts
import type { FsEntry } from "./reconcile.js";

// ... inside useAssetActions ...

const importOrphan = useCallback(
  (entry: FsEntry) => {
    const type = classifyAssetType(entry.uri);
    if (!type) {
      console.warn(`[asset-import] unknown file type for ${entry.uri}`);
      return;
    }
    const assetId = generateAssetId(entry.uri); // reuse whatever id helper upload uses
    dispatch("human", {
      type: "asset:register",
      asset: {
        id: assetId,
        type,
        uri: entry.uri,
        name: entry.uri.split("/").pop() ?? entry.uri,
        status: "ready",
        metadata: {},
        createdAt: Date.now(),
      },
    });
    dispatch("human", {
      type: "provenance:add-edge",
      edge: {
        toAssetId: assetId,
        fromAssetId: null,
        operation: {
          type: "import",
          actor: "human",
          timestamp: Date.now(),
          label: `imported ${entry.uri}`,
          params: {},
        },
      },
    });
  },
  [dispatch],
);

return { upload, importOrphan };
```

Replace `generateAssetId(entry.uri)` with whatever id-generation helper the existing `upload` uses. If `upload` inlines id generation (e.g. `crypto.randomUUID()`), use the same mechanism. If the existing code uses `nanoid`, use `nanoid`. Match exactly — do not introduce a new library.

If `classifyAssetType`, `dispatch`, or the command shapes don't match what's already in the file, adjust to match. The goal is: the new action produces the same shape as a successful `upload()`, minus the file-body POST.

- [ ] **Step 3: Run tests as sanity check**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft
bun test modes/clipcraft/ 2>&1 | tail -30
```

Expected: all existing clipcraft tests still pass (this task adds no new tests; it's guarded by the eventual UI wiring in Task 5).

- [ ] **Step 4: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft
git add modes/clipcraft/viewer/assets/useAssetActions.ts
git commit -m "feat(clipcraft/assets): add importOrphan action (registers pre-existing file)"
```

---

### Task 5: AssetPanel — render orphan / missing states, remove Text group

**Files:**
- Modify: `modes/clipcraft/viewer/assets/AssetPanel.tsx`
- Modify: `modes/clipcraft/viewer/assets/AssetGroup.tsx`
- Modify: `modes/clipcraft/viewer/assets/AssetThumbnail.tsx`

- [ ] **Step 1: Plug reconcile + remove Text group in AssetPanel.tsx**

Open `modes/clipcraft/viewer/assets/AssetPanel.tsx`. Locate the `GROUPS` array:

```ts
const GROUPS = [
  { label: "Images", type: "image", ... },
  { label: "Clips",  type: "video", ... },
  { label: "Audio",  type: "audio", ... },
  { label: "Text",   type: "text",  ... },  // REMOVE
];
```

Remove the `"Text"` entry entirely.

In the same file, import and call the new plumbing. Near the top, add:

```ts
import { useAssetFsListing } from "./useAssetFsListing.js";
import { reconcileAssets, type FsEntry } from "./reconcile.js";
```

Inside the panel component, replace the current `coreState.registry`-only data path with:

```ts
const { entries: fsEntries, refetch: refetchFs } = useAssetFsListing();

const registeredForReconcile = useMemo(
  () =>
    Array.from(registry.values()).map((a) => ({ assetId: a.id, uri: a.uri })),
  [registry],
);

const report = useMemo(
  () => reconcileAssets(fsEntries, registeredForReconcile),
  [fsEntries, registeredForReconcile],
);

// Orphans bucketed by asset type so each group can render its own.
const orphansByType: Record<string, FsEntry[]> = useMemo(() => {
  const bucket: Record<string, FsEntry[]> = { image: [], video: [], audio: [] };
  for (const o of report.orphaned) {
    const t = classifyAssetType(o.uri); // reuse from useAssetActions — extract to shared util if not already exported
    if (t && bucket[t]) bucket[t].push(o);
  }
  return bucket;
}, [report.orphaned]);

// Set of missing URIs (missing = registered but file gone) for badge rendering.
const missingUris = useMemo(
  () => new Set(report.missing.map((m) => m.uri)),
  [report.missing],
);
```

Pass `orphansByType[group.type]`, `missingUris`, and `refetchFs` down to `<AssetGroup>` so it can render orphan rows and trigger refetches after import. If `classifyAssetType` isn't already exported from `useAssetActions.ts`, extract it into a shared module (e.g. `modes/clipcraft/viewer/assets/classify.ts`) in this task and import from both places — matching patterns the codebase already uses for shared utilities.

Also call `refetchFs()` inside the existing `upload` flow's success path (both AssetGroup's drop handler and file-picker) so uploaded files are immediately reflected. If `upload` returns a promise, chain `.then(() => refetchFs())`. If it doesn't, propagate a callback from the panel.

- [ ] **Step 2: Render orphan rows in AssetGroup.tsx**

Open `modes/clipcraft/viewer/assets/AssetGroup.tsx`. Accept a new prop `orphans: FsEntry[]` and render them after the registered asset list. Each orphan row should:
- Display the filename (last path segment) at 70% opacity.
- Show a small "Import" button that calls the new `importOrphan` action passed down from the panel.
- On successful import, the row disappears (because reconcile re-runs — `useAssetFsListing.refetch` is called after import).

Minimal JSX (place after the existing asset list):

```tsx
{orphans.length > 0 && (
  <div style={{ marginTop: 4 }}>
    <div style={{ fontSize: 10, color: theme.color.ink4, padding: "0 6px" }}>
      NOT IMPORTED
    </div>
    {orphans.map((o) => (
      <div
        key={o.uri}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 6px",
          opacity: 0.7,
        }}
      >
        <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>
          {o.uri.split("/").pop()}
        </span>
        <button
          onClick={() => {
            importOrphan(o);
            onAfterChange?.();  // refetch listing
          }}
          style={{
            fontSize: 11,
            padding: "2px 6px",
            background: theme.color.accentSoft,
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Import
        </button>
      </div>
    ))}
  </div>
)}
```

Use whatever style tokens are already imported in AssetGroup.tsx. Don't introduce new tokens.

Threading: `AssetPanel` passes `importOrphan` and `refetchFs` (as `onAfterChange`) through `AssetGroup` props. Extend the props interface accordingly.

- [ ] **Step 3: Render "missing" badge in AssetThumbnail.tsx**

Open `modes/clipcraft/viewer/assets/AssetThumbnail.tsx`. Accept a new prop `isMissing?: boolean`. When true, overlay a small warning badge (WarningIcon — already imported in VideoTrack.tsx, so the icon module is present in the viewer) in a corner of the thumbnail, and dim the thumbnail to ~40% opacity:

```tsx
{isMissing && (
  <div
    style={{
      position: "absolute",
      top: 2,
      right: 2,
      background: theme.color.dangerSoft,
      borderRadius: 3,
      padding: "1px 4px",
      fontSize: 10,
      color: theme.color.dangerInk,
      display: "flex",
      alignItems: "center",
      gap: 2,
    }}
    title={`File not found on disk: ${uri}`}
  >
    <WarningIcon size={10} />
    missing
  </div>
)}
```

Thread `isMissing` from `AssetGroup` (checking `missingUris.has(asset.uri)`) to `AssetThumbnail`.

- [ ] **Step 4: Manual verification in the browser**

Restart the dev server if needed. In the running session:

1. Open the AssetPanel.
2. Verify there's no "Text" group anymore.
3. Create a test orphan: in a terminal, `cp /tmp/test-adult-portrait.jpg /tmp/clipcraft-playground/assets/image/orphan-test.jpg` (use any existing media file).
4. Reload the viewer (or hit a refresh button if the panel has one).
5. Verify the new file appears in the Images group under "NOT IMPORTED" at 70% opacity, with an "Import" button.
6. Click Import — row disappears, asset appears as a normal entry.
7. Create a missing state: delete the file `/tmp/clipcraft-playground/assets/image/orphan-test.jpg` from disk while keeping the project.json entry.
8. Reload — the asset should now have a "missing" badge.

This step is a manual check; record what you saw in the commit message if anything was off.

- [ ] **Step 5: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft
git add modes/clipcraft/viewer/assets/AssetPanel.tsx \
        modes/clipcraft/viewer/assets/AssetGroup.tsx \
        modes/clipcraft/viewer/assets/AssetThumbnail.tsx \
        modes/clipcraft/viewer/assets/classify.ts
git commit -m "feat(clipcraft/assets): render orphan/missing states, remove dead Text group"
```

(Only include `classify.ts` if you created it in Step 1 to share `classifyAssetType`.)

---

### Task 6: Audio waveform utility + AssetThumbnail integration

**Files:**
- Create: `modes/clipcraft/viewer/assets/waveform.ts`
- Modify: `modes/clipcraft/viewer/assets/AssetThumbnail.tsx`

- [ ] **Step 1: Write the waveform utility**

Create `modes/clipcraft/viewer/assets/waveform.ts`:

```ts
/**
 * Decode an audio file to a downsampled peaked waveform. Uses a
 * one-shot AudioContext per decode; results are cached in module
 * state keyed by URL so repeated AssetThumbnail mounts don't
 * re-decode. All zero values if decode fails.
 */

const cache = new Map<string, number[]>();
const inFlight = new Map<string, Promise<number[]>>();

const PEAK_COUNT = 128;

async function decodeAndPeak(url: string): Promise<number[]> {
  const existing = cache.get(url);
  if (existing) return existing;
  const pending = inFlight.get(url);
  if (pending) return pending;

  const task = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = await res.arrayBuffer();
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    try {
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      const channel = decoded.getChannelData(0);
      const bucketSize = Math.max(1, Math.floor(channel.length / PEAK_COUNT));
      const peaks: number[] = new Array(PEAK_COUNT).fill(0);
      for (let i = 0; i < PEAK_COUNT; i++) {
        let max = 0;
        const start = i * bucketSize;
        const end = Math.min(channel.length, start + bucketSize);
        for (let j = start; j < end; j++) {
          const v = Math.abs(channel[j]);
          if (v > max) max = v;
        }
        peaks[i] = max;
      }
      cache.set(url, peaks);
      return peaks;
    } finally {
      ctx.close().catch(() => {});
    }
  })();

  inFlight.set(url, task);
  try {
    return await task;
  } catch (err) {
    console.warn(`[waveform] decode failed for ${url}:`, err);
    const zeros = new Array(PEAK_COUNT).fill(0);
    cache.set(url, zeros);
    return zeros;
  } finally {
    inFlight.delete(url);
  }
}

export function peakCount(): number {
  return PEAK_COUNT;
}

/** Returns cached peaks if present, otherwise kicks off decoding and returns null. */
export function getOrLoadPeaks(url: string, onReady: (peaks: number[]) => void): number[] | null {
  const existing = cache.get(url);
  if (existing) return existing;
  decodeAndPeak(url).then(onReady);
  return null;
}
```

- [ ] **Step 2: Render waveform in AssetThumbnail.tsx for audio**

In `AssetThumbnail.tsx`, add a branch for `asset.type === "audio"`:

```tsx
import { getOrLoadPeaks, peakCount } from "./waveform.js";
// ...

function AudioWaveform({ url, width, height }: { url: string; width: number; height: number }) {
  const [peaks, setPeaks] = useState<number[] | null>(() => getOrLoadPeaks(url, setPeaks));
  useEffect(() => {
    if (peaks === null) {
      // already kicked off in the initializer; no-op.
    }
  }, [peaks]);

  if (peaks === null) {
    return (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: theme.color.ink4 }}>
        …
      </div>
    );
  }

  const barW = width / peakCount();
  const mid = height / 2;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {peaks.map((p, i) => {
        const h = Math.max(1, p * height * 0.9);
        return (
          <rect
            key={i}
            x={i * barW}
            y={mid - h / 2}
            width={Math.max(1, barW * 0.8)}
            height={h}
            fill={theme.color.ink3}
          />
        );
      })}
    </svg>
  );
}
```

In the main `AssetThumbnail` component's render switch, add the audio case:

```tsx
if (asset.type === "audio" && uri) {
  return <AudioWaveform url={contentUrl(uri)} width={width} height={height} />;
}
```

Use whatever URL helper the file already uses (likely `useWorkspaceAssetUrl` or a `contentUrl` helper). Don't reinvent URL construction.

- [ ] **Step 3: Manual verification**

1. Ensure an audio asset exists (the seed workspace has `assets/bgm/token-meme.mp3`).
2. Open AssetPanel.
3. Verify the Audio group shows the waveform thumbnail instead of the previous text-only row.
4. The decode happens once per URL; reopen the panel — waveform renders synchronously on the second view.

- [ ] **Step 4: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft
git add modes/clipcraft/viewer/assets/waveform.ts \
        modes/clipcraft/viewer/assets/AssetThumbnail.tsx
git commit -m "feat(clipcraft/assets): audio waveform preview in AssetPanel"
```

---

### Task 7: Skill doc guidance for the import path

**Files:**
- Modify: `modes/clipcraft/skill/references/workflows.md`

- [ ] **Step 1: Add a "Filesystem discovery" sub-section**

Open `modes/clipcraft/skill/references/workflows.md`. At the end of the file, before the Workflow 4 "Structured generation notifications from the viewer" section, add a new top-level heading:

```markdown
---

## Workflow 4 — Filesystem discovery (agent-generated files)

The AssetPanel reconciles `project.json.assets[]` against the actual
files under `<workspace>/assets/**`. Three states are visible to the
user:

- **Registered** — both: a proper entry in `project.json.assets[]`
  AND the file exists on disk. Normal thumbnail.
- **Orphan** — file on disk but no `project.json` entry. Shows up in
  the panel at 70% opacity under "NOT IMPORTED" with an "Import"
  button. Clicking Import adds an `asset:register` + provenance edge
  labeled "imported <path>".
- **Missing** — `project.json` entry with no file on disk. Shows a
  "missing" badge over the thumbnail.

This means **agents have two supported ways** to bring a generated
file into the project:

1. **Full registration (recommended for committed assets):** run the
   generator script, then edit `project.json` to add the `assets[]`
   entry + `provenance[]` edge yourself. Follow Workflow 1 for the
   exact shape. The file appears as a normal registered asset.
2. **File-only (lets the user decide):** run the generator script
   and stop. The file appears in the panel as an orphan and the user
   clicks Import when ready. Useful when you're not sure the user
   wants to keep the result.

Prefer option 1 unless the user explicitly asked for a one-off
experiment they may discard.

When you see a "missing" badge in a generation request's context, it
means the uri in `project.json` points at a file that has been moved
or deleted. Don't regenerate silently — ask the user whether to
remove the entry, regenerate, or locate the file.
```

Renumber the existing "Workflow 4" section that is about structured generation notifications to **Workflow 5**, updating its heading and any cross-references (a quick `grep -n "Workflow 4" modes/clipcraft/skill/references/workflows.md` from the worktree root catches them).

- [ ] **Step 2: Sanity-check the doc reads correctly**

Quickly skim the file top-to-bottom. Verify:
- Workflow headings are sequentially numbered 1 → 2 → 3 → 4 (new) → 5 (was 4).
- The new Workflow 4 section doesn't contradict anything earlier (it shouldn't — this is additive).

- [ ] **Step 3: Bump the skill manifest version so the next restart installs the updated docs**

Open `modes/clipcraft/manifest.ts`. Bump:

```ts
version: "0.2.0",
```

to:

```ts
version: "0.3.0",
```

(or the next minor increment if `0.2.0` has been superseded by the time this task runs).

- [ ] **Step 4: Commit**

```bash
cd /Users/pandazki/Codes/pneuma-skills-clipcraft-by-pneuma-craft
git add modes/clipcraft/skill/references/workflows.md modes/clipcraft/manifest.ts
git commit -m "docs(clipcraft/skill): document filesystem discovery + import flow; bump 0.3.0"
```

---

## Self-Review

**Spec coverage:**
- Filesystem discovery → Tasks 1, 2, 3, 5 (reconcile, server route, hook, UI).
- Import affordance → Task 4 (action) + Task 5 (UI).
- Missing badge → Task 5.
- Remove Text group → Task 5.
- Audio waveform parity → Task 6.
- Skill doc alignment → Task 7.

**Placeholder scan:**
- Task 4 references `generateAssetId(...)` and `classifyAssetType(...)` abstractly because the existing `useAssetActions.ts` shape needs to be read in situ; the step explicitly instructs the engineer to match whatever the current file uses (crypto.randomUUID / nanoid / inlined). This is the one intentional abstraction — pinned by instruction, not by a TBD.
- Task 5 Step 2 JSX shows complete code using `theme.color.*` tokens that already exist in the codebase (VideoTrack.tsx is the reference for these tokens).
- No "TBD", "implement later", or "similar to task N" patterns present.

**Type consistency:**
- `FsEntry { uri, size, mtime }` — stable from Task 1 through Task 5.
- `RegisteredEntry { assetId, uri }` and `RegisteredReconciled` — stable from Task 1 through Task 5.
- `reconcileAssets(fsList, registered)` signature — one definition in Task 1, consumed in Task 5.
- The `classifyAssetType` helper — either exists already in `useAssetActions.ts` (Task 4 reuses it) or is extracted to `classify.ts` in Task 5 (called out in Step 1 and in the commit file list).

**Commit hygiene:** Seven commits, one per task, conventional-commits-ish messages matching recent branch history (`feat(scope):` / `docs(scope):`).
