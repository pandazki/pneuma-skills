/**
 * Favorites — per-user pinned mode list.
 *
 * Persisted at `~/.pneuma/favorites.json`. A flat list of mode names
 * (`["webcraft", "slide", …]`); display order in the launcher reflects
 * the file's order, so user-reordering is a future extension that
 * doesn't require schema migration.
 *
 * When the file is absent we fall back to a curated default set so
 * first-run users see a sensible Quick Start instead of an alphabetical
 * blob. Defaults are intentionally a strict subset of the builtins
 * shipped with Pneuma — a user-deleted builtin name will just no-op
 * (the launcher filters favorites against the current registry before
 * rendering).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

/**
 * First-run favorites. Order matters — these are surfaced in this order
 * in the Quick Start grid and the project mode-tile picker until the
 * user reorders. Keep this list small enough that all entries fit on
 * one row of the Quick Start grid at typical viewport widths.
 */
export const DEFAULT_FAVORITES: readonly string[] = [
  "webcraft",
  "slide",
  "diagram",
  "illustrate",
  "remotion",
  "kami",
];

export interface FavoritesFile {
  version: 1;
  modes: string[];
}

export function getFavoritesPath(): string {
  return join(homedir(), ".pneuma", "favorites.json");
}

/**
 * Read the persisted favorites list. Returns the default set when the
 * file is missing OR when it's malformed in any way — favorites are not
 * load-bearing state, so we degrade silently rather than throw.
 */
export function readFavorites(): string[] {
  const path = getFavoritesPath();
  if (!existsSync(path)) return [...DEFAULT_FAVORITES];
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<FavoritesFile>;
    if (parsed && Array.isArray(parsed.modes)) {
      // Filter to strings and dedupe while preserving order.
      const seen = new Set<string>();
      const out: string[] = [];
      for (const name of parsed.modes) {
        if (typeof name !== "string") continue;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push(name);
      }
      return out;
    }
  } catch {
    /* fall through to default */
  }
  return [...DEFAULT_FAVORITES];
}

/**
 * Atomic write (tmp + rename) so concurrent reads never see a torn
 * file. Creates the parent dir if needed; tolerates missing parent.
 */
export function writeFavorites(modes: string[]): void {
  const path = getFavoritesPath();
  mkdirSync(dirname(path), { recursive: true });
  // Dedupe + drop non-strings before persisting. Empty list is valid
  // (user explicitly cleared favorites — we honor that instead of
  // re-seeding defaults silently).
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const name of modes) {
    if (typeof name !== "string") continue;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    cleaned.push(name);
  }
  const payload: FavoritesFile = { version: 1, modes: cleaned };
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
  renameSync(tmp, path);
}
