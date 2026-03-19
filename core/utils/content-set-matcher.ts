/**
 * Content Set Matcher — automatically selects the best content set based on system preferences.
 *
 * Locale weight is much higher than theme (language is a hard constraint, theme is a preference).
 */

import type { ContentSet } from "../types/viewer-contract.js";

export interface MatchPreferences {
  theme: "light" | "dark";
  locale: string;
  locales: string[];
}

/**
 * Score a content set against user preferences. Higher = better match.
 *
 * - Exact locale match:     +100
 * - Language-family match:  +50  (e.g. "en" matches "en-gb")
 * - Locale in fallback list: +25 (diminishing)
 * - Theme match:            +10
 * - No theme specified:     +5   (neutral)
 * - No locale specified:    +2   (neutral)
 */
function scoreContentSet(set: ContentSet, prefs: MatchPreferences): number {
  let score = 0;

  // Locale scoring
  if (set.traits.locale) {
    const vLocale = set.traits.locale.toLowerCase();
    const pLocale = prefs.locale.toLowerCase();

    if (vLocale === pLocale) {
      score += 100;
    } else if (vLocale.startsWith(pLocale) || pLocale.startsWith(vLocale)) {
      score += 50;
    } else {
      const idx = prefs.locales.findIndex(
        (l) => l === vLocale || l.startsWith(vLocale) || vLocale.startsWith(l),
      );
      if (idx >= 0) {
        score += Math.max(5, 25 - idx * 5);
      }
    }
  } else {
    score += 2;
  }

  // Theme scoring
  if (set.traits.theme) {
    if (set.traits.theme === prefs.theme) {
      score += 10;
    }
  } else {
    score += 5;
  }

  return score;
}

/**
 * Select the best matching content set based on user system preferences.
 * Returns null only if the array is empty.
 */
export function selectBestContentSet(
  sets: ContentSet[],
  prefs: MatchPreferences,
): ContentSet | null {
  if (sets.length === 0) return null;
  if (sets.length === 1) return sets[0];

  let best = sets[0];
  let bestScore = scoreContentSet(sets[0], prefs);

  for (let i = 1; i < sets.length; i++) {
    const s = scoreContentSet(sets[i], prefs);
    if (s > bestScore) {
      bestScore = s;
      best = sets[i];
    }
  }

  return best;
}
