/**
 * Setup tab filesystem listing route.
 *
 * GET /api/setup/listing — scans `<workspace>/setup/` and
 * `<workspace>/storyboard/` for ClipCraft production-bible artifacts:
 *   - bible:        setup/bible.md
 *   - cast:         setup/cast/<name>.md (+ optional <name>.<ext>)  OR
 *                   setup/cast/<name>/card.md (+ any image inside)
 *   - world:        same shape as cast, under setup/world/
 *   - storyboards:  storyboard/<id>/composite.<ext>
 *                   + panels (from stdout.json if present, otherwise
 *                     a lex-sorted listing of `*-NN.{png,jpg,jpeg,webp}`)
 *
 * Pure synchronous fs scan — small response (<5 KB typical), no
 * caching, no chokidar. Mirrors the asset-fs.ts pattern. Symlinks are
 * skipped; dotfiles are ignored.
 */

import type { Hono } from "hono";
import { existsSync, readFileSync, readdirSync, statSync, lstatSync } from "node:fs";
import { join, relative, sep } from "node:path";

interface BibleEntry {
  path: string;
  mtime: number;
}

interface CardEntry {
  name: string;
  mdPath: string;
  imagePath: string | null;
  mtime: number;
}

interface PanelEntry {
  index: number;
  row: number;
  col: number;
  bbox: { x: number; y: number; w: number; h: number };
  path: string;
  assetId?: string;
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
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

function toRelUri(workspace: string, abs: string): string {
  return relative(workspace, abs).split(sep).join("/");
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
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const abs = join(root, name);
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;

    if (st.isDirectory()) {
      // Nested layout: <subdir>/<name>/card.md + any reference image
      const cardMd = join(abs, "card.md");
      if (!existsSync(cardMd)) continue;
      let imagePath: string | null = null;
      let inner: string[] = [];
      try {
        inner = readdirSync(abs);
      } catch {
        inner = [];
      }
      for (const ext of IMAGE_PRIORITY) {
        const found = inner.find((n) => n.toLowerCase().endsWith(ext));
        if (found) {
          imagePath = join(abs, found);
          break;
        }
      }
      const cardSt = safeStat(cardMd);
      if (!cardSt) continue;
      cards.push({
        name,
        mdPath: toRelUri(workspace, cardMd),
        imagePath: imagePath ? toRelUri(workspace, imagePath) : null,
        mtime: Math.floor(cardSt.mtimeMs),
      });
    } else if (
      st.isFile() &&
      name.endsWith(".md") &&
      !name.endsWith(".prompt.md")
    ) {
      // Flat layout: <subdir>/<base>.md (+ optional sibling image)
      const base = name.slice(0, -".md".length);
      const imageAbs = findCardImage(root, base);
      cards.push({
        name: base,
        mdPath: toRelUri(workspace, abs),
        imagePath: imageAbs ? toRelUri(workspace, imageAbs) : null,
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
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  for (const id of entries) {
    if (id.startsWith(".")) continue;
    const sbDir = join(root, id);
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(sbDir);
    } catch {
      continue;
    }
    if (st.isSymbolicLink() || !st.isDirectory()) continue;

    // Find composite — use the first matching extension by priority.
    let compositeAbs: string | null = null;
    for (const ext of IMAGE_PRIORITY) {
      const cand = join(sbDir, `composite${ext}`);
      if (existsSync(cand)) {
        compositeAbs = cand;
        break;
      }
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
          grid =
            parsed.grid && typeof parsed.grid === "object"
              ? { rows: Number(parsed.grid.rows) || 0, cols: Number(parsed.grid.cols) || 0 }
              : null;
          panels = parsed.panels.map((p: any, i: number) => {
            // The stdout.json paths are absolute (from the run); re-derive
            // a workspace-relative URI from the basename so the client can
            // reach the slice via /content/<...>.
            const basename = p.path
              ? String(p.path).split(/[/\\]/).pop()
              : `panel-${String(i + 1).padStart(2, "0")}.png`;
            const wsRel = toRelUri(workspace, join(sbDir, basename ?? `panel-${i + 1}.png`));
            return {
              index: typeof p.index === "number" ? p.index : i + 1,
              row: typeof p.row === "number" ? p.row : 0,
              col: typeof p.col === "number" ? p.col : 0,
              bbox:
                p.bbox && typeof p.bbox === "object"
                  ? {
                      x: Number(p.bbox.x) || 0,
                      y: Number(p.bbox.y) || 0,
                      w: Number(p.bbox.w) || 0,
                      h: Number(p.bbox.h) || 0,
                    }
                  : { x: 0, y: 0, w: 0, h: 0 },
              path: wsRel,
              assetId: typeof p.assetId === "string" ? p.assetId : undefined,
            };
          });
        }
      } catch {
        // Bad JSON — fall through to lex fallback below.
      }
    }

    if (panels.length === 0) {
      // Fallback: lexicographic listing of `*-NN.{png,jpg,jpeg,webp}`
      let dirEntries: string[] = [];
      try {
        dirEntries = readdirSync(sbDir);
      } catch {
        dirEntries = [];
      }
      const panelFiles = dirEntries
        .filter((n) => /-(\d+)\.(png|jpg|jpeg|webp)$/i.test(n))
        .sort();
      panels = panelFiles.map((name, i) => {
        const m = name.match(/-(\d+)\.[a-zA-Z]+$/);
        const idx = m ? parseInt(m[1], 10) : i + 1;
        return {
          index: idx,
          row: 0,
          col: 0,
          bbox: { x: 0, y: 0, w: 0, h: 0 },
          path: toRelUri(workspace, join(sbDir, name)),
        };
      });
    }

    if (panels.length === 0) continue; // composite alone is not a storyboard

    const compSt = safeStat(compositeAbs);
    out.push({
      id,
      compositePath: toRelUri(workspace, compositeAbs),
      panels,
      grid,
      hasStdoutJson,
      mtime: compSt ? Math.floor(compSt.mtimeMs) : 0,
    });
  }

  // Most-recent first — agents iterate on the latest storyboard most often.
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

export interface SetupListingOptions {
  workspace: string;
}

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

export type { BibleEntry, CardEntry, PanelEntry, StoryboardEntry };
