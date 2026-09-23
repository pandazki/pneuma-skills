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
 * is then re-derived to match the one `/api/registry` reports in THIS
 * installation, not the one that wrote the file: a mode whose source left
 * the package keeps its star as `"catalog::<name>"`, and one whose source is
 * present — a bundled mode, or any mode in a repo checkout — is
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

import { getCatalogEntry, inTreeModeDir, type CatalogEnv } from "./mode-catalog.js";

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
 * Re-bucket first-party keys to the bucket `/api/registry` would report.
 *
 * `builtin` and `catalog` are not properties of a mode — they say how THIS
 * installation reaches it. A favorites file written by an earlier release
 * holds `"builtin::sprite"` for a mode this one downloads on demand, and the
 * launcher composes `"catalog::sprite"` for the same card, so without this
 * the star silently vanishes. Both directions are handled.
 *
 * The rule must be the registry's, not `modes/distribution.json` alone, and
 * the difference is the whole point:
 *
 * - Source under the package's `modes/<name>/` → **builtin**. That covers a
 *   bundled mode in a release AND every catalog mode in a repo checkout,
 *   where the source is in the tree and the registry reports it among the
 *   builtins. Keying those to `catalog::` un-stars them in development,
 *   which is exactly the regression this note exists to prevent.
 * - Only a catalog entry, no source → **catalog**. That is a catalog mode in
 *   a released package, installed or not: the registry keeps it in the
 *   `catalog` bucket either way, so the key does not move on download.
 * - Neither → left alone. A deleted mode, or a name from a newer release;
 *   renaming its bucket would be a guess, and the launcher already ignores
 *   keys that match no card.
 *
 * Only `builtin::` and `catalog::` keys are touched. `local::` and
 * `published::` carry a path or a URL, not a first-party mode name.
 */
export function rebucketFirstPartyKeys(keys: string[], env?: CatalogEnv): string[] {
  if (!keys.some((k) => k.startsWith("builtin::") || k.startsWith("catalog::"))) {
    return keys;
  }
  return keys.map((key) => {
    const sep = key.indexOf("::");
    const source = key.slice(0, sep);
    if (source !== "builtin" && source !== "catalog") return key;
    const name = key.slice(sep + 2);
    const bucket = inTreeModeDir(name, env)
      ? "builtin"
      : getCatalogEntry(name, env)
        ? "catalog"
        : null;
    if (bucket === null || bucket === source) return key;
    return `${bucket}::${name}`;
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
