import type { SurfaceForm, FloatRect } from "./agent-surface-slice.js";

/**
 * The user's Agent Surface *layout habit* (which form, where the floating
 * panel sits) is a cross-session UI preference, so it lives in localStorage —
 * NOT in session.json. It is keyed per-mode with a global fallback: a user who
 * always floats chat in `diagram` but docks it in `doc` gets each remembered,
 * and a brand-new mode inherits their most recent global choice.
 *
 * The agent conversation itself is never persisted here — that stays
 * session-owned.
 */
const PREFIX = "pneuma:agent-surface:";
const GLOBAL_KEY = `${PREFIX}__global__`;

export interface PersistedSurface {
  form?: SurfaceForm;
  floatRect?: FloatRect;
  lastExpandedForm?: "docked" | "floating";
}

function readKey(key: string): PersistedSurface | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as PersistedSurface) : null;
  } catch {
    return null;
  }
}

/** Per-mode preference first, then the global fallback. */
export function loadSurfacePrefs(modeName: string | undefined): PersistedSurface | null {
  if (typeof localStorage === "undefined") return null;
  return (modeName ? readKey(PREFIX + modeName) : null) ?? readKey(GLOBAL_KEY);
}

export function saveSurfacePrefs(modeName: string | undefined, prefs: PersistedSurface): void {
  if (typeof localStorage === "undefined") return;
  const payload = JSON.stringify(prefs);
  try {
    if (modeName) localStorage.setItem(PREFIX + modeName, payload);
    // The most recent choice is always mirrored to the global key so unseen
    // modes inherit it.
    localStorage.setItem(GLOBAL_KEY, payload);
  } catch {
    /* quota / private mode — habit just won't persist */
  }
}
