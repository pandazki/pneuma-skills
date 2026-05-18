/**
 * useFavorites — read/write the persistent favorites list.
 *
 * Favorites are a flat ordered list of composite mode keys shaped
 * `"<source>::<specifier>"` (see `favoriteKey` below + `core/favorites.ts`).
 * The launcher uses them to sort the Quick Start grid and the project
 * mode-tile picker (favorites always render first, original order
 * preserved within and across the groups). Server-backed at
 * `~/.pneuma/favorites.json` so the list survives across browser
 * resets and is shared across all launcher tabs on the same machine.
 *
 * Optimistic UI: `toggle` flips state locally immediately, then POSTs.
 * On failure we revert and log. Concurrent toggles dedupe via the
 * latest write (last writer wins — fine for a personal preference
 * file with no contention).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBase } from "../utils/api.js";

interface FavoritesResponse {
  favorites: string[];
  defaults?: string[];
}

/**
 * Shape a favorites caller can derive a composite key from. Matches
 * the launcher's `AnyMode` and the registry's mode entries — `source`
 * is required, and we pick the best stable specifier in this order:
 * explicit `specifier` (launcher's launch key) → `path` (local /
 * library modes) → `archiveUrl` (published) → `name` (builtins).
 */
export interface FavoriteKeyInput {
  source: "builtin" | "local" | "published";
  name: string;
  specifier?: string;
  path?: string;
  archiveUrl?: string;
}

/**
 * Compose the favorites key for a mode. Two modes that share `name`
 * (e.g. builtin `slide` and its locally-evolved fork that also
 * manifests as `slide`) produce distinct keys because the local fork
 * has a different `path`. Always go through this helper rather than
 * concatenating `${source}::${name}` by hand — local forks would
 * collide with their builtin parent otherwise.
 */
export function favoriteKey(mode: FavoriteKeyInput): string {
  const specifier =
    mode.specifier ?? mode.path ?? mode.archiveUrl ?? mode.name;
  return `${mode.source}::${specifier}`;
}

export function useFavorites(): {
  /** Ordered list of composite keys — render in this order when surfacing favorites. */
  favorites: string[];
  /** Membership check (O(1)). Pass a composite key (see `favoriteKey`). */
  isFavorite: (key: string) => boolean;
  /** Add if absent, remove if present. Pass a composite key. Optimistic + server-backed. */
  toggle: (key: string) => void;
  /** True until the first fetch resolves (use to avoid flicker). */
  loading: boolean;
} {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Tracks the latest write so a slow earlier POST can't clobber a
  // later state once it lands. Increment per local mutation.
  const writeSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`${getApiBase()}/api/favorites`)
      .then((r) => r.json() as Promise<FavoritesResponse>)
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.favorites)) setFavorites(data.favorites);
      })
      .catch(() => { /* leave empty; reverts to "no favorites yet" gracefully */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const isFavorite = useCallback(
    (key: string) => favoriteSet.has(key),
    [favoriteSet],
  );

  const toggle = useCallback(
    (key: string) => {
      const seq = ++writeSeq.current;
      const next = favoriteSet.has(key)
        ? favorites.filter((n) => n !== key)
        : [...favorites, key];
      setFavorites(next);
      fetch(`${getApiBase()}/api/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorites: next }),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = (await r.json()) as FavoritesResponse;
          // Only adopt the server response if no newer write has started.
          // Otherwise the local optimistic state is the more recent truth.
          if (writeSeq.current === seq && Array.isArray(data.favorites)) {
            setFavorites(data.favorites);
          }
        })
        .catch((err) => {
          console.warn(`[favorites] toggle failed: ${err}`);
          // Revert only if this was the latest write — a later toggle
          // already moved the state forward.
          if (writeSeq.current === seq) setFavorites(favorites);
        });
    },
    [favorites, favoriteSet],
  );

  return { favorites, isFavorite, toggle, loading };
}

/**
 * Sort a mode list with favorites first. Preserves the original relative
 * order WITHIN favorites (matching the persisted file order) and WITHIN
 * non-favorites. Used by Quick Start + the project mode-tile picker.
 *
 * @param modes The list to sort; mutated copy returned, input untouched.
 * @param favorites Ordered list of favorite composite keys.
 * @param getKey Extractor — return the favorites composite key for a
 *   mode. Pass `favoriteKey` (it adapts to the launcher's mode shape).
 *   Caller is responsible for ensuring the extractor produces the same
 *   key shape that `toggle`/`isFavorite` writes; mismatching key shapes
 *   silently make the sort a no-op for that group.
 */
export function sortFavoritesFirst<T>(
  modes: T[],
  favorites: string[],
  getKey: (m: T) => string,
): T[] {
  if (favorites.length === 0) return modes;
  const favIndex = new Map(favorites.map((key, i) => [key, i] as const));
  const sorted = modes.slice();
  sorted.sort((a, b) => {
    const ai = favIndex.get(getKey(a));
    const bi = favIndex.get(getKey(b));
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return 0; // stable for non-favorites — preserves caller's original order
  });
  return sorted;
}
