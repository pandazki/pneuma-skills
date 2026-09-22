/**
 * Favorites — per-user pinned mode list.
 *
 * Persisted at `~/.pneuma/favorites.json`. A flat list of composite mode
 * keys shaped `"<source>::<specifier>"` — e.g. `"builtin::slide"`,
 * `"local::/Users/me/.pneuma/modes/slide-evolved-abc123"`,
 * `"published::https://.../slide-2.tar.gz"`. Display order in the
 * launcher reflects the file's order, so user-reordering is a future
 * extension that doesn't require schema migration.
 *
 * The composite key is required because evolved local forks preserve
 * the parent's `name` (per the React-key gotcha in CLAUDE.md), so
 * keying favorites by name alone made a builtin and its evolved fork
 * inseparable — pinning one pinned the other.
 *
 * Legacy compatibility: entries without a `::` separator are
 * interpreted as `"builtin::<entry>"` on read. A first-party mode's bucket
 * follows THIS release's `modes/distribution.json`, not the one that wrote
 * the file: a mode that moved out of the package keeps its star as
 * `"catalog::<name>"`, and one that moved back in returns to
 * `"builtin::<name>"` (see `rebucketFirstPartyKeys`). The next write persists
 * the normalized form, so legacy files migrate themselves the first
 * time the user toggles anything. All shipped defaults are builtins,
 * so the legacy → builtin coercion never mis-attributes a user's pin.
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

import { bundledModeNames, isCatalogMode, type CatalogEnv } from "./mode-catalog.js";

/**
 * First-run favorites. Order matters — these are surfaced in this order
 * in the Quick Start grid and the project mode-tile picker until the
 * user reorders. Keep this list small enough that all entries fit on
 * one row of the Quick Start grid at typical viewport widths. All
 * defaults are builtins, so they all carry the `builtin::` prefix.
 */
export const DEFAULT_FAVORITES: readonly string[] = [
  "builtin::webcraft",
  "builtin::slide",
  "builtin::diagram",
  "builtin::illustrate",
  "builtin::remotion",
  "builtin::kami",
  "builtin::cosmos",
];

/**
 * Normalize a single entry. Legacy bare-name strings (no `::` separator)
 * are coerced to `"builtin::<entry>"` since every pre-migration default
 * was a builtin. New-format keys pass through unchanged. Empty / non-
 * string inputs return null so callers can drop them.
 */
function normalizeFavoriteKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes("::")) return trimmed;
  return `builtin::${trimmed}`;
}

/**
 * Re-bucket first-party keys against the current distribution.
 *
 * `builtin` and `catalog` are not properties of a mode — they are where THIS
 * release ships it (`modes/distribution.json`). A favorites file written by
 * an earlier release holds `"builtin::sprite"` for a mode this one downloads
 * on demand, and the launcher composes `"catalog::sprite"` for the same card,
 * so the star would silently vanish. Both directions are handled: a mode that
 * moves back into the package returns to `builtin::`.
 *
 * Only `builtin::` and `catalog::` keys are touched. `local::` and
 * `published::` carry a path or a URL, not a first-party mode name.
 */
export function rebucketFirstPartyKeys(keys: string[], env?: CatalogEnv): string[] {
  if (!keys.some((k) => k.startsWith("builtin::") || k.startsWith("catalog::"))) {
    return keys;
  }
  const bundled = new Set(bundledModeNames(env));
  return keys.map((key) => {
    const sep = key.indexOf("::");
    const source = key.slice(0, sep);
    const name = key.slice(sep + 2);
    if (source === "builtin" && !bundled.has(name) && isCatalogMode(name, env)) {
      return `catalog::${name}`;
    }
    if (source === "catalog" && bundled.has(name)) return `builtin::${name}`;
    return key;
  });
}

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
 * Legacy bare-name entries are migrated to composite keys on the fly
 * (see `normalizeFavoriteKey`); the next write persists the new form.
 */
export function readFavorites(): string[] {
  const path = getFavoritesPath();
  if (!existsSync(path)) return [...DEFAULT_FAVORITES];
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<FavoritesFile>;
    if (parsed && Array.isArray(parsed.modes)) {
      // Normalize legacy entries, re-bucket against this release's
      // distribution, drop invalid, dedupe while preserving order. Dedupe
      // runs last on purpose: an old `builtin::x` and a new `catalog::x`
      // collapse into one star rather than two rows for one mode.
      const seen = new Set<string>();
      const out: string[] = [];
      const normalized = parsed.modes
        .map(normalizeFavoriteKey)
        .filter((k): k is string => k !== null);
      for (const key of rebucketFirstPartyKeys(normalized)) {
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(key);
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
  // Normalize legacy bare names to composite keys, dedupe, drop invalid.
  // Empty list is valid (user explicitly cleared favorites — we honor that
  // instead of re-seeding defaults silently).
  const seen = new Set<string>();
  const cleaned: string[] = [];
  const normalized = modes
    .map(normalizeFavoriteKey)
    .filter((k): k is string => k !== null);
  for (const key of rebucketFirstPartyKeys(normalized)) {
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(key);
  }
  const payload: FavoritesFile = { version: 1, modes: cleaned };
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
  renameSync(tmp, path);
}
