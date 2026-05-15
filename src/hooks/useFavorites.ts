/**
 * useFavorites — read/write the persistent favorites list.
 *
 * Favorites are a flat ordered list of mode names. The launcher uses
 * them to sort the Quick Start grid and the project mode-tile picker
 * (favorites always render first, original order preserved within and
 * across the groups). Server-backed at `~/.pneuma/favorites.json` so
 * the list survives across browser resets and is shared across all
 * launcher tabs on the same machine.
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

export function useFavorites(): {
  /** Ordered list — render in this order when surfacing favorites. */
  favorites: string[];
  /** Membership check (O(1)). */
  isFavorite: (modeName: string) => boolean;
  /** Add if absent, remove if present. Optimistic + server-backed. */
  toggle: (modeName: string) => void;
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
    (name: string) => favoriteSet.has(name),
    [favoriteSet],
  );

  const toggle = useCallback(
    (modeName: string) => {
      const seq = ++writeSeq.current;
      const next = favoriteSet.has(modeName)
        ? favorites.filter((n) => n !== modeName)
        : [...favorites, modeName];
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
 * @param favorites Ordered list of favorite mode names.
 * @param getName Extractor — caller's mode shape may vary (BuiltinMode,
 *   ResolvedMode, LocalMode, etc.). Falls back to `(m as any).name`.
 */
export function sortFavoritesFirst<T>(
  modes: T[],
  favorites: string[],
  getName: (m: T) => string,
): T[] {
  if (favorites.length === 0) return modes;
  const favIndex = new Map(favorites.map((name, i) => [name, i] as const));
  const sorted = modes.slice();
  sorted.sort((a, b) => {
    const ai = favIndex.get(getName(a));
    const bi = favIndex.get(getName(b));
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return 0; // stable for non-favorites — preserves caller's original order
  });
  return sorted;
}
