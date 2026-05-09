# ClipCraft Setup Tab — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development.

**Goal:** Ship the Setup tab specified in
`docs/superpowers/specs/2026-05-09-clipcraft-setup-tab-design.md` —
a third tab in the existing `AssetPanel` that surfaces project
bible / character cards / setting cards / storyboards by file
convention.

**Architecture:**

1. Server scans `setup/` and `storyboard/` directories on each
   `GET /api/setup/listing` request (no caching, no chokidar in v1).
   Mirrors the `asset-fs.ts` pattern.
2. React `useSetupListing` hook fetches that endpoint on mount and
   on tab activation.
3. `<SetupTab>` renders 4 collapsible sections (Bible / Cast /
   Settings / Storyboards) with section-specific renderers.
4. Tab toggle in `AssetPanel.tsx` extended from `assets|script` to
   `setup|assets|script`; smart-default selection on workspace open.
5. Card click → lightbox; storyboard panel click → seek + select
   on the existing playhead.

**Tech Stack:** Hono / Bun / React 19 / Zustand 5 / Tailwind 4 /
react-markdown 10 / rehype-raw 7 / remark-gfm 4. All deps are
already in `package.json`.

**Out-of-scope (per spec):** schema changes, inline editing,
WS-driven real-time updates, in-UI card creation, auto-registering
storyboard panels.

---

## File structure

| Status | Path |
|---|---|
| **Create** | `server/routes/setup-listing.ts` |
| **Create** | `server/routes/__tests__/setup-listing.test.ts` |
| **Create** | `modes/clipcraft/viewer/setup/useSetupListing.ts` |
| **Create** | `modes/clipcraft/viewer/setup/SetupTab.tsx` |
| **Create** | `modes/clipcraft/viewer/setup/BibleSection.tsx` |
| **Create** | `modes/clipcraft/viewer/setup/CardSection.tsx` |
| **Create** | `modes/clipcraft/viewer/setup/CardLightbox.tsx` |
| **Create** | `modes/clipcraft/viewer/setup/StoryboardSection.tsx` |
| **Create** | `modes/clipcraft/viewer/setup/storyboardPanelStatus.ts` |
| **Create** | `modes/clipcraft/viewer/setup/__tests__/SetupTab.test.tsx` |
| **Create** | `modes/clipcraft/viewer/setup/__tests__/storyboardPanelStatus.test.ts` |
| **Modify** | `modes/clipcraft/viewer/assets/AssetPanel.tsx` |
| **Modify** | `server/index.ts` (one import + one `registerSetupListing` call) |

---

## Task 1: server scanner + `/api/setup/listing` route

**Files:**
- Create: `server/routes/setup-listing.ts`
- Create: `server/routes/__tests__/setup-listing.test.ts`
- Modify: `server/index.ts` (register the route alongside `registerAssetFsRoutes`)

**Step 1 — write the failing test.** Set up a temporary workspace
fixture with the file shapes from the spec; assert the listing
shape matches.

```ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerSetupListing } from "../setup-listing.js";

let tmpRoot: string;
let app: Hono;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "setup-listing-test-"));
  app = new Hono();
  registerSetupListing(app, { workspace: tmpRoot });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/setup/listing", () => {
  test("returns empty shape for an empty workspace", async () => {
    const res = await app.request("/api/setup/listing");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ bible: null, cast: [], world: [], storyboards: [] });
  });

  test("detects bible.md", async () => {
    mkdirSync(join(tmpRoot, "setup"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "bible.md"), "# title\n");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.bible).toBeTruthy();
    expect(json.bible.path).toBe("setup/bible.md");
    expect(typeof json.bible.mtime).toBe("number");
  });

  test("detects flat character card with image", async () => {
    mkdirSync(join(tmpRoot, "setup", "cast"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.md"), "# Kira");
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.png"), "fake-png");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.cast).toHaveLength(1);
    expect(json.cast[0]).toMatchObject({
      name: "kira",
      mdPath: "setup/cast/kira.md",
      imagePath: "setup/cast/kira.png",
    });
  });

  test("detects nested character card", async () => {
    mkdirSync(join(tmpRoot, "setup", "cast", "anya"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "cast", "anya", "card.md"), "# Anya");
    writeFileSync(join(tmpRoot, "setup", "cast", "anya", "ref.png"), "fake");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.cast).toHaveLength(1);
    expect(json.cast[0]).toMatchObject({
      name: "anya",
      mdPath: "setup/cast/anya/card.md",
      imagePath: "setup/cast/anya/ref.png",
    });
  });

  test("character card without image is still surfaced (imagePath: null)", async () => {
    mkdirSync(join(tmpRoot, "setup", "cast"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.md"), "# K");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.cast[0]).toMatchObject({
      name: "kira",
      mdPath: "setup/cast/kira.md",
      imagePath: null,
    });
  });

  test("png > webp > jpg image preference for cards", async () => {
    mkdirSync(join(tmpRoot, "setup", "cast"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.md"), "# K");
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.jpg"), "j");
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.webp"), "w");
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.png"), "p");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.cast[0].imagePath).toBe("setup/cast/kira.png");
  });

  test("ignores prompt.md siblings", async () => {
    mkdirSync(join(tmpRoot, "setup", "cast"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.md"), "# K");
    writeFileSync(join(tmpRoot, "setup", "cast", "kira.prompt.md"), "...");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.cast).toHaveLength(1); // not 2
    expect(json.cast[0].name).toBe("kira");
  });

  test("detects setting cards in setup/world/", async () => {
    mkdirSync(join(tmpRoot, "setup", "world"), { recursive: true });
    writeFileSync(join(tmpRoot, "setup", "world", "desk.md"), "# D");
    writeFileSync(join(tmpRoot, "setup", "world", "desk.png"), "p");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.world).toHaveLength(1);
    expect(json.world[0].name).toBe("desk");
  });

  test("detects storyboards with stdout.json", async () => {
    const sbDir = join(tmpRoot, "storyboard", "the-bug");
    mkdirSync(sbDir, { recursive: true });
    writeFileSync(join(sbDir, "composite.png"), "c");
    writeFileSync(join(sbDir, "panel-01.png"), "p1");
    writeFileSync(join(sbDir, "panel-02.png"), "p2");
    writeFileSync(
      join(sbDir, "stdout.json"),
      JSON.stringify({
        grid: { rows: 1, cols: 2 },
        panels: [
          { index: 1, row: 0, col: 0, bbox: { x: 0, y: 0, w: 100, h: 100 }, path: "/abs/panel-01.png", assetId: "asset-p1" },
          { index: 2, row: 0, col: 1, bbox: { x: 100, y: 0, w: 100, h: 100 }, path: "/abs/panel-02.png", assetId: "asset-p2" },
        ],
      }),
    );
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.storyboards).toHaveLength(1);
    expect(json.storyboards[0]).toMatchObject({
      id: "the-bug",
      compositePath: "storyboard/the-bug/composite.png",
      grid: { rows: 1, cols: 2 },
      hasStdoutJson: true,
    });
    expect(json.storyboards[0].panels).toHaveLength(2);
    expect(json.storyboards[0].panels[0]).toMatchObject({
      index: 1,
      row: 0,
      col: 0,
      bbox: { x: 0, y: 0, w: 100, h: 100 },
    });
  });

  test("detects storyboard fallback (no stdout.json) by lex order of panel files", async () => {
    const sbDir = join(tmpRoot, "storyboard", "fallback");
    mkdirSync(sbDir, { recursive: true });
    writeFileSync(join(sbDir, "composite.png"), "c");
    writeFileSync(join(sbDir, "frame-01.png"), "1");
    writeFileSync(join(sbDir, "frame-02.png"), "2");
    writeFileSync(join(sbDir, "frame-03.png"), "3");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.storyboards).toHaveLength(1);
    expect(json.storyboards[0]).toMatchObject({
      id: "fallback",
      hasStdoutJson: false,
      grid: null,
    });
    expect(json.storyboards[0].panels).toHaveLength(3);
    expect(json.storyboards[0].panels.map((p: any) => p.index)).toEqual([1, 2, 3]);
  });

  test("ignores storyboards with no composite.png", async () => {
    const sbDir = join(tmpRoot, "storyboard", "no-composite");
    mkdirSync(sbDir, { recursive: true });
    writeFileSync(join(sbDir, "panel-01.png"), "1");
    const res = await app.request("/api/setup/listing");
    const json = await res.json();
    expect(json.storyboards).toHaveLength(0);
  });
});
```

**Step 2 — implement.** Create `setup-listing.ts`:

```ts
import type { Hono } from "hono";
import { existsSync, readFileSync, readdirSync, statSync, lstatSync } from "node:fs";
import { join, relative, sep } from "node:path";

interface BibleEntry { path: string; mtime: number; }
interface CardEntry { name: string; mdPath: string; imagePath: string | null; mtime: number; }
interface PanelEntry {
  index: number; row: number; col: number;
  bbox: { x: number; y: number; w: number; h: number };
  path: string; assetId?: string;
}
interface StoryboardEntry {
  id: string;
  compositePath: string;
  panels: PanelEntry[];
  grid: { rows: number; cols: number } | null;
  hasStdoutJson: boolean;
  mtime: number;
}

const IMAGE_PRIORITY = [".png", ".webp", ".jpg", ".jpeg"];

function safeStat(p: string) {
  try { return statSync(p); } catch { return null; }
}

function detectBible(workspace: string): BibleEntry | null {
  const p = join(workspace, "setup", "bible.md");
  const st = safeStat(p);
  if (!st || !st.isFile()) return null;
  return { path: "setup/bible.md", mtime: Math.floor(st.mtimeMs) };
}

function findCardImage(dir: string, baseName: string): string | null {
  // Skip the .md and .prompt.md siblings; only look at images.
  for (const ext of IMAGE_PRIORITY) {
    const candidate = join(dir, `${baseName}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function detectCardsIn(workspace: string, subdir: "cast" | "world"): CardEntry[] {
  const root = join(workspace, "setup", subdir);
  if (!existsSync(root)) return [];
  const cards: CardEntry[] = [];
  let entries: string[];
  try { entries = readdirSync(root); } catch { return []; }

  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const abs = join(root, name);
    let st;
    try { st = lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink()) continue;

    if (st.isDirectory()) {
      // Nested layout: <subdir>/<name>/card.md + <ref-image>
      const cardMd = join(abs, "card.md");
      if (!existsSync(cardMd)) continue;
      // image: any image file in the dir, picked by priority
      let imagePath: string | null = null;
      const inner = readdirSync(abs);
      for (const ext of IMAGE_PRIORITY) {
        const found = inner.find((n) => n.toLowerCase().endsWith(ext));
        if (found) { imagePath = join(abs, found); break; }
      }
      const cardSt = statSync(cardMd);
      cards.push({
        name,
        mdPath: relative(workspace, cardMd).split(sep).join("/"),
        imagePath: imagePath ? relative(workspace, imagePath).split(sep).join("/") : null,
        mtime: Math.floor(cardSt.mtimeMs),
      });
    } else if (st.isFile() && name.endsWith(".md") && !name.endsWith(".prompt.md")) {
      // Flat layout: <subdir>/<base>.md (+ optional image)
      const base = name.slice(0, -".md".length);
      const imageAbs = findCardImage(root, base);
      cards.push({
        name: base,
        mdPath: relative(workspace, abs).split(sep).join("/"),
        imagePath: imageAbs ? relative(workspace, imageAbs).split(sep).join("/") : null,
        mtime: Math.floor(st.mtimeMs),
      });
    }
  }

  cards.sort((a, b) => a.name.localeCompare(b.name));
  return cards;
}

function detectStoryboards(workspace: string): StoryboardEntry[] {
  const root = join(workspace, "storyboard");
  if (!existsSync(root)) return [];
  const out: StoryboardEntry[] = [];
  let entries: string[];
  try { entries = readdirSync(root); } catch { return []; }

  for (const id of entries) {
    if (id.startsWith(".")) continue;
    const sbDir = join(root, id);
    let st;
    try { st = lstatSync(sbDir); } catch { continue; }
    if (st.isSymbolicLink() || !st.isDirectory()) continue;

    // Find composite — use the first matching extension by priority.
    let compositeAbs: string | null = null;
    for (const ext of IMAGE_PRIORITY) {
      const cand = join(sbDir, `composite${ext}`);
      if (existsSync(cand)) { compositeAbs = cand; break; }
    }
    if (!compositeAbs) continue;

    // Try stdout.json first
    const stdoutJsonPath = join(sbDir, "stdout.json");
    let panels: PanelEntry[] = [];
    let grid: StoryboardEntry["grid"] = null;
    let hasStdoutJson = false;

    if (existsSync(stdoutJsonPath)) {
      try {
        const raw = readFileSync(stdoutJsonPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.panels)) {
          hasStdoutJson = true;
          grid = parsed.grid && typeof parsed.grid === "object" ? parsed.grid : null;
          panels = parsed.panels.map((p: any, i: number) => {
            // The stdout.json paths are absolute (from the run);
            // re-derive a workspace-relative URI from the basename.
            const basename = p.path ? String(p.path).split(/[/\\]/).pop() : `panel-${String(i + 1).padStart(2, "0")}.png`;
            const wsRel = relative(workspace, join(sbDir, basename)).split(sep).join("/");
            return {
              index: typeof p.index === "number" ? p.index : i + 1,
              row: typeof p.row === "number" ? p.row : 0,
              col: typeof p.col === "number" ? p.col : 0,
              bbox: p.bbox && typeof p.bbox === "object" ? p.bbox : { x: 0, y: 0, w: 0, h: 0 },
              path: wsRel,
              assetId: typeof p.assetId === "string" ? p.assetId : undefined,
            };
          });
        }
      } catch {
        // fall through to fallback
      }
    }

    if (panels.length === 0) {
      // Fallback: lexicographic listing of `*-NN.{png,jpg,jpeg,webp}` matching
      const dirEntries = readdirSync(sbDir);
      const panelFiles = dirEntries.filter((n) => /-(\d+)\.(png|jpg|jpeg|webp)$/i.test(n)).sort();
      panels = panelFiles.map((name, i) => {
        const m = name.match(/-(\d+)\.[a-zA-Z]+$/);
        const idx = m ? parseInt(m[1], 10) : i + 1;
        return {
          index: idx,
          row: 0, col: 0,
          bbox: { x: 0, y: 0, w: 0, h: 0 },
          path: relative(workspace, join(sbDir, name)).split(sep).join("/"),
        };
      });
    }

    if (panels.length === 0) continue; // composite alone is not a storyboard

    out.push({
      id,
      compositePath: relative(workspace, compositeAbs).split(sep).join("/"),
      panels,
      grid,
      hasStdoutJson,
      mtime: Math.floor(safeStat(compositeAbs)!.mtimeMs),
    });
  }

  out.sort((a, b) => b.mtime - a.mtime); // most-recent first
  return out;
}

export interface SetupListingOptions { workspace: string; }

export function registerSetupListing(app: Hono, options: SetupListingOptions) {
  const { workspace } = options;
  app.get("/api/setup/listing", (c) => {
    return c.json({
      bible: detectBible(workspace),
      cast: detectCardsIn(workspace, "cast"),
      world: detectCardsIn(workspace, "world"),
      storyboards: detectStoryboards(workspace),
    });
  });
}
```

**Step 3 — register in `server/index.ts`.** Find where `registerAssetFsRoutes(app, { workspace })` is called and add the matching call: `registerSetupListing(app, { workspace })`. Also import.

**Step 4 — run tests:**
```
bun test server/routes/__tests__/setup-listing.test.ts
```
All cases pass.

**Step 5 — commit:**
```
git add server/routes/setup-listing.ts server/routes/__tests__/setup-listing.test.ts server/index.ts
git commit -m "feat(setup-tab): server scanner + /api/setup/listing route"
```

---

## Task 2: useSetupListing hook

**Files:**
- Create: `modes/clipcraft/viewer/setup/useSetupListing.ts`

**Step 1 — implement** (mirror `useAssetFsListing` pattern):

```ts
import { useCallback, useEffect, useState } from "react";

interface BibleEntry { path: string; mtime: number; }
interface CardEntry { name: string; mdPath: string; imagePath: string | null; mtime: number; }
interface PanelEntry {
  index: number; row: number; col: number;
  bbox: { x: number; y: number; w: number; h: number };
  path: string; assetId?: string;
}
interface StoryboardEntry {
  id: string;
  compositePath: string;
  panels: PanelEntry[];
  grid: { rows: number; cols: number } | null;
  hasStdoutJson: boolean;
  mtime: number;
}

interface SetupListing {
  bible: BibleEntry | null;
  cast: CardEntry[];
  world: CardEntry[];
  storyboards: StoryboardEntry[];
}

interface State {
  data: SetupListing | null;
  loading: boolean;
  error: string | null;
}

export function useSetupListing(): State & { refetch: () => void } {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });

  const refetch = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    fetch("/api/setup/listing")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<SetupListing>;
      })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err) => setState({
        data: null, loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { ...state, refetch };
}

export type { SetupListing, BibleEntry, CardEntry, PanelEntry, StoryboardEntry };
```

**Step 2 — commit:**
```
git add modes/clipcraft/viewer/setup/useSetupListing.ts
git commit -m "feat(setup-tab): useSetupListing hook"
```

---

## Task 3: Setup tab in AssetPanel

**Files:**
- Modify: `modes/clipcraft/viewer/assets/AssetPanel.tsx`
- Create: `modes/clipcraft/viewer/setup/SetupTab.tsx` (placeholder shell — fleshed out in Tasks 4-7)

**Step 1 — extend the Tab union and toggle UI in AssetPanel.tsx.**
Find the `type Tab = "assets" | "script"` line. Change it to
`type Tab = "setup" | "assets" | "script"`. Update the tab toggle
UI to render three tabs in the order: **Setup, Assets, Script**.
Use the same styling as the existing tabs.

When `tab === "setup"`, render `<SetupTab />`. Other branches
unchanged.

**Smart-default selection logic.** At the top of `AssetPanel`,
add this just before the `useState<Tab>(...)`:

```tsx
import { useSetupListing } from "../setup/useSetupListing.js";
// ... inside AssetPanel():
const setupListing = useSetupListing();
const initialTab = useMemo<Tab>(() => {
  // If listing not yet fetched, default to assets (existing behavior).
  if (!setupListing.data) return "assets";
  const hasSetup = setupListing.data.bible !== null
    || setupListing.data.cast.length > 0
    || setupListing.data.world.length > 0
    || setupListing.data.storyboards.length > 0;
  const hasAssets = assets.length > 0;
  if (hasSetup && !hasAssets) return "setup";
  return "assets";
}, [setupListing.data, assets.length]);
const [tab, setTab] = useState<Tab>(initialTab);
useEffect(() => {
  // Update tab once the smart default settles, but don't overrule
  // the user once they've manually switched.
  if (tab === "assets" && initialTab === "setup" && !userTouchedTab.current) {
    setTab("setup");
  }
}, [initialTab, tab]);
```

Add a `userTouchedTab = useRef(false)` and set it to `true` in the
tab-toggle click handler. This prevents the smart-default from
fighting a user's explicit choice.

**Step 2 — Create `SetupTab.tsx` placeholder:**

```tsx
import { useSetupListing } from "./useSetupListing.js";

export function SetupTab() {
  const { data, loading, error, refetch } = useSetupListing();
  return (
    <div className="flex h-full flex-col">
      {/* TODO: Bible / Cast / Settings / Storyboards sections */}
      <div className="p-4 text-sm text-zinc-400">
        Setup tab placeholder. Bible: {data?.bible ? "present" : "none"}.
        Cast: {data?.cast.length ?? 0}. Settings: {data?.world.length ?? 0}.
        Storyboards: {data?.storyboards.length ?? 0}.
      </div>
      {error && <div className="p-4 text-red-500">Error: {error}</div>}
      {loading && <div className="p-4 text-zinc-500">Loading…</div>}
    </div>
  );
}
```

**Step 3 — manually verify in dev viewer:** `bun run dev` opens
the launcher; create a clipcraft session; the Setup tab is visible
and the placeholder renders. Defer screenshots until Task 7.

**Step 4 — commit:**
```
git add modes/clipcraft/viewer/assets/AssetPanel.tsx \
        modes/clipcraft/viewer/setup/SetupTab.tsx
git commit -m "feat(setup-tab): wire third tab into AssetPanel + smart-default selection"
```

---

## Task 4: BibleSection — markdown rendering

**Files:**
- Create: `modes/clipcraft/viewer/setup/BibleSection.tsx`
- Modify: `modes/clipcraft/viewer/setup/SetupTab.tsx`

**Step 1 — implement the section.** Use `react-markdown` (already
in deps) with `rehype-raw` + `remark-gfm`:

```tsx
import { useMemo, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { theme } from "../theme/tokens.js";
import type { BibleEntry } from "./useSetupListing.js";

interface Props {
  bible: BibleEntry | null;
  workspaceUrl: (path: string) => string; // e.g. (p) => `/content/${p}`
}

export function BibleSection({ bible, workspaceUrl }: Props) {
  const [body, setBody] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bible) { setBody(""); return; }
    let cancelled = false;
    fetch(workspaceUrl(bible.path))
      .then((r) => r.ok ? r.text() : Promise.reject(`HTTP ${r.status}`))
      .then((t) => { if (!cancelled) setBody(t); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [bible, workspaceUrl]);

  if (!bible) {
    return (
      <SectionShell title="Project Bible (0)" emptyHint={
        "No project bible yet. Ask the agent: \"set up the project bible\"."
      } />
    );
  }
  return (
    <SectionShell title="Project Bible (1)" defaultOpen>
      {error ? (
        <div className="p-3 text-xs text-red-400">Failed to load: {error}</div>
      ) : (
        <div className="prose prose-invert max-w-none p-3 text-xs">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
            {body}
          </ReactMarkdown>
        </div>
      )}
    </SectionShell>
  );
}

// SectionShell is a small disclosure-wrapper used by all four sections
// — extract to a helper file later, inline for now.
function SectionShell({ title, emptyHint, defaultOpen, children }: {
  title: string; emptyHint?: string; defaultOpen?: boolean; children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border-b border-zinc-800">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-xs uppercase tracking-wider text-zinc-300 hover:text-zinc-100"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{title}</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div>
          {children}
          {emptyHint && !children && (
            <div className="px-3 pb-3 text-xs text-zinc-400">{emptyHint}</div>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 2 — render BibleSection inside SetupTab:**

```tsx
import { BibleSection } from "./BibleSection.js";
// ...
const workspaceUrl = (p: string) => `/content/${p.split("/").map(encodeURIComponent).join("/")}`;
return (
  <div className="flex h-full flex-col overflow-y-auto">
    <BibleSection bible={data?.bible ?? null} workspaceUrl={workspaceUrl} />
    {/* other sections to come */}
  </div>
);
```

**Step 3 — manually verify** in `/tmp/clipcraft-the-bug/`: Setup tab
renders the bible.md with headings, code blocks, and lists.

**Step 4 — commit:**
```
git commit -am "feat(setup-tab): BibleSection — read-only markdown render"
```

---

## Task 5: CardSection — Cast and Settings

**Files:**
- Create: `modes/clipcraft/viewer/setup/CardSection.tsx`
- Create: `modes/clipcraft/viewer/setup/CardLightbox.tsx`
- Modify: `modes/clipcraft/viewer/setup/SetupTab.tsx`

**Step 1 — CardSection.** Generic component used for both Cast and
Settings. Renders the section header with count, a thumbnail grid of
80×80 tiles. Click → opens `CardLightbox`. Empty state with the
exact agent-prompt copy from the spec.

```tsx
interface Props {
  title: "Cast" | "Settings";
  emptyHint: string;
  cards: CardEntry[];
  workspaceUrl: (p: string) => string;
}
```

Each tile: `<button>` containing an `<img>` (or a placeholder
gradient if `imagePath` is null) + a label below. Hover state
adds the neon-orange ring (`border-cc-primary` from theme).

**Step 2 — CardLightbox.** Modal/overlay with two-column layout
on wide screens (collapses on narrow):

- Left: reference image (or placeholder)
- Right: rendered markdown
- Bottom: "Used by N clips" computed by reading `usePneumaCraftStore`'s
  provenance and counting edges where
  `operation.params.imageUrls?.includes(<this card's image path>)`
  OR `operation.params.imageUrls?.includes(<absolute file URL>)`.
  If `N === 0`, display: "Not yet referenced by any generation."
- Top right: close button + "Open prompt file" link if a sibling
  `<basename>.prompt.md` exists (use existing AssetLightbox styling).

**Step 3 — wire CardSections into SetupTab:**

```tsx
<CardSection
  title="Cast"
  emptyHint="No character cards yet. Ask the agent: \"add a character card for [name]\". A character card is the durable reference image + bible that every later shot prompt cites — the consistency engine for multi-shot work."
  cards={data?.cast ?? []}
  workspaceUrl={workspaceUrl}
/>
<CardSection
  title="Settings"
  emptyHint="No setting cards yet. Ask the agent: \"add a setting card for [location or signature prop]\". Used when a location or prop should look identical across multiple shots."
  cards={data?.world ?? []}
  workspaceUrl={workspaceUrl}
/>
```

**Step 4 — commit:**
```
git commit -am "feat(setup-tab): CardSection + CardLightbox for cast / settings"
```

---

## Task 6: storyboardPanelStatus helper + tests

**Files:**
- Create: `modes/clipcraft/viewer/setup/storyboardPanelStatus.ts`
- Create: `modes/clipcraft/viewer/setup/__tests__/storyboardPanelStatus.test.ts`

This is the pure helper that powers the click-panel logic.

**Step 1 — write failing tests:**

```ts
import { describe, expect, test } from "bun:test";
import { computePanelStatus } from "../storyboardPanelStatus.js";

const A = (id: string, uri: string) => ({ id, type: "image" as const, uri, name: id, metadata: {}, tags: [], status: "ready" as const, createdAt: 0 });
const PF = (id: string, trackId: string, time: number, assetId: string) => ({ id, trackId, time, assetId });

describe("computePanelStatus", () => {
  test("registered + on timeline → 'placed' with seek time", () => {
    const status = computePanelStatus({
      panelPath: "storyboard/the-bug/panel-01.png",
      panelAssetId: "asset-bug-01",
      assets: [A("asset-bug-01", "storyboard/the-bug/panel-01.png")],
      previewFrames: [PF("pf-1", "track-1", 1.5, "asset-bug-01")],
    });
    expect(status).toEqual({ kind: "placed", assetId: "asset-bug-01", trackId: "track-1", time: 1.5 });
  });

  test("registered but not on timeline → 'registered'", () => {
    const status = computePanelStatus({
      panelPath: "storyboard/the-bug/panel-02.png",
      panelAssetId: "asset-bug-02",
      assets: [A("asset-bug-02", "storyboard/the-bug/panel-02.png")],
      previewFrames: [],
    });
    expect(status).toEqual({ kind: "registered", assetId: "asset-bug-02" });
  });

  test("unregistered (asset not in registry) → 'unregistered'", () => {
    const status = computePanelStatus({
      panelPath: "storyboard/the-bug/panel-03.png",
      panelAssetId: "asset-bug-03",
      assets: [],
      previewFrames: [],
    });
    expect(status).toEqual({ kind: "unregistered", panelPath: "storyboard/the-bug/panel-03.png" });
  });

  test("matches by URI when assetId hint absent", () => {
    const status = computePanelStatus({
      panelPath: "storyboard/the-bug/panel-04.png",
      panelAssetId: undefined,
      assets: [A("some-other-id", "storyboard/the-bug/panel-04.png")],
      previewFrames: [PF("pf-2", "track-1", 2.0, "some-other-id")],
    });
    expect(status.kind).toBe("placed");
    expect((status as any).assetId).toBe("some-other-id");
  });
});
```

**Step 2 — implement:**

```ts
type Status =
  | { kind: "placed"; assetId: string; trackId: string; time: number }
  | { kind: "registered"; assetId: string }
  | { kind: "unregistered"; panelPath: string };

export function computePanelStatus({
  panelPath, panelAssetId, assets, previewFrames,
}: {
  panelPath: string;
  panelAssetId?: string;
  assets: ReadonlyArray<{ id: string; uri: string }>;
  previewFrames: ReadonlyArray<{ id: string; trackId: string; time: number; assetId: string }>;
}): Status {
  const assetMatch =
    (panelAssetId ? assets.find((a) => a.id === panelAssetId) : undefined)
    ?? assets.find((a) => a.uri === panelPath);

  if (!assetMatch) return { kind: "unregistered", panelPath };

  const pf = previewFrames.find((p) => p.assetId === assetMatch.id);
  if (pf) return { kind: "placed", assetId: assetMatch.id, trackId: pf.trackId, time: pf.time };
  return { kind: "registered", assetId: assetMatch.id };
}

export type { Status as PanelStatus };
```

**Step 3 — run tests, commit.**

```
bun test modes/clipcraft/viewer/setup/__tests__/storyboardPanelStatus.test.ts
git commit -am "feat(setup-tab): computePanelStatus helper + tests"
```

---

## Task 7: StoryboardSection

**Files:**
- Create: `modes/clipcraft/viewer/setup/StoryboardSection.tsx`
- Modify: `modes/clipcraft/viewer/setup/SetupTab.tsx`

**Step 1 — Implement.** Each storyboard renders as a row containing
the composite thumbnail + an SVG overlay drawn at panel boundaries.
On hover, the panel under the cursor highlights. On click, dispatch
based on `computePanelStatus`:

- `placed`: `dispatch({ type: "playhead:seek", payload: { time } })`
  + select asset (use the existing `composition:select-asset` or
  whatever the timeline uses).
- `registered`: select asset only; show toast "Panel not yet placed
  on the timeline."
- `unregistered`: toast "Panel not yet registered. Ask the agent to
  register storyboard panels."

For the SVG overlay: each panel's bbox is in composite-image
coordinates. Scale by the thumbnail-to-composite ratio (compute on
load using a hidden `<img>` to get composite intrinsic dimensions,
or fetch dimensions from `usePneumaCraftStore`'s asset metadata if
the composite was registered as an asset; otherwise scale by the
visible thumbnail width).

Below the thumbnail, render: storyboard id + summary
(`N panels · gridStr · aspect`). Click on the summary text → open a
full-size lightbox of the composite.

For the hover/click interaction code:

```tsx
function PanelOverlay({ panels, scaleX, scaleY, onClick }: {...}) {
  return (
    <svg className="absolute inset-0 pointer-events-none" viewBox={`0 0 ${composite.width} ${composite.height}`}>
      {panels.map((p) => (
        <rect
          key={p.index}
          x={p.bbox.x} y={p.bbox.y}
          width={p.bbox.w} height={p.bbox.h}
          className="fill-transparent stroke-cc-border/40 hover:stroke-cc-primary hover:fill-cc-primary/10 pointer-events-auto cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onClick(p); }}
        />
      ))}
    </svg>
  );
}
```

(Adjust `viewBox` to actual composite intrinsic size; you may need a
small effect to read `naturalWidth`/`naturalHeight` from the rendered
img. The fallback when `bbox.w === 0` (no stdout.json case) is to
not draw the overlay at all — the storyboard is still listed, but
panel-click is unavailable.)

**Step 2 — wire dispatch.** Find how the existing timeline handles
playhead seeks and asset selection (likely a hook around `useDispatch`
from `@pneuma-craft/react`). For toasts, check whether the existing
viewer has a toast system; if so use it, otherwise console.warn for
v1 and use `<div className="...">` overlay.

**Step 3 — register in SetupTab.** Add the section after Settings.
Empty hint:
> "No storyboards yet. Ask the agent: \"storyboard the next 4-12 beats\". The agent will generate a single composite image with all panels and slice it into individual references — one $0.16 generation, dramatically higher internal consistency than independent panel generations."

**Step 4 — commit:**
```
git commit -am "feat(setup-tab): StoryboardSection with panel-click → seek + select"
```

---

## Task 8: SetupTab integration test (component-level)

**Files:**
- Create: `modes/clipcraft/viewer/setup/__tests__/SetupTab.test.tsx`

Use `@testing-library/react` if it's already a dep, otherwise lean
on `bun:test` + JSDOM-style DOM checks via an explicit React render
helper. Cases:

- Empty listing → all four sections show their empty hints.
- Listing with bible → BibleSection renders.
- Listing with one cast card → CardSection shows 1 thumbnail,
  click → CardLightbox opens with image + markdown.

**Step 4 — run + commit:**
```
bun test modes/clipcraft/viewer/setup/__tests__/SetupTab.test.tsx
git commit -am "feat(setup-tab): SetupTab integration test"
```

---

## Task 9: end-to-end visual verification

**Files:** none (manual verification)

**Step 1 — start dev server:**
```
bun run dev clipcraft --workspace /tmp/clipcraft-the-bug --port 17996
```

**Step 2 — open `http://localhost:17996/`** in a Chromium-based
browser via the chrome-devtools MCP.

**Step 3 — verify:**
- Setup tab is leftmost in the AssetPanel header.
- Setup tab is selected by default (workspace has `setup/bible.md`
  and `setup/cast/kira.md` but no assets in `project.json` yet).
- Bible section renders the markdown.
- Cast section shows "KIRA" tile with the kira.png thumbnail.
- Click KIRA → lightbox shows kira.png on the left + kira.md on
  the right; "Used by N clips" reads "Not yet referenced by any
  generation."
- Settings section shows "No setting cards yet. Ask the agent: …"
- Storyboards section shows "No storyboards yet. …"
- Take a screenshot via `mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot`.

**Step 4 — generate a storyboard (optional, ~$0.16):**
```
cd /tmp/clipcraft-the-bug
export FAL_KEY=...
node /Users/pandazki/Codes/pneuma-skills/.claude/worktrees/clipcraft-setup-tab/modes/_shared/scripts/storyboard.mjs \
  --aspect 9:16 --panels 6 --prompt-file storyboard/the-bug/prompt.md \
  --out-dir storyboard/the-bug --name panel
```

(Note: `storyboard.mjs` lives on the PR #104 branch, not on this
worktree's branch. Use the absolute path from the other worktree.)

Then refresh the Setup tab → Storyboards section now has one entry.
Click a panel → toast "Panel not yet registered."

**Step 5 — compose a final summary screenshot** showing all four
sections populated.

**Step 6 — no commit; this is verification.**

---

## Self-Review

- [ ] Spec coverage: every section in
  `2026-05-09-clipcraft-setup-tab-design.md` "Acceptance criteria"
  has a matching task that delivers it.
- [ ] No placeholders in the implementation files.
- [ ] All tests pass: `bun test server/routes modes/clipcraft modes/clipcraft/viewer/setup`.
- [ ] Visual baseline matches the Ethereal Tech theme.
- [ ] No regression on existing AssetPanel functionality.

## Acceptance gates

After all tasks: dispatch a final code-review subagent for the whole
diff, then push and open a PR off `origin/main` (separate from PR
#104).
