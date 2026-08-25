/**
 * A topic name is a name, not a presentation variant.
 *
 * ELI5's content sets are SUBJECTS — `dark-matter/`, `light-refraction/`,
 * `en-passant/`. The shared directory resolver's default parser was written
 * for slide, whose directories really are `en-dark` / `zh-light` renditions
 * of one deck, so it reads `dark`, `light` and any known language code as
 * `ContentSetTraits`. Inheriting that here is not a cosmetic mislabelling:
 * `src/store/workspace-slice.ts` stands down from its own first-set default
 * the moment ANY set carries a locale or theme, precisely so that
 * `src/App.tsx::selectBestContentSet` can pick by the reader's UI theme and
 * language. A trait-bearing `dark-matter/` therefore decides which TOPIC
 * opens from whether the reader runs Pneuma in dark mode — two readers of
 * the same workspace land on different explainers, and nothing looks broken
 * to either of them.
 *
 * These tests pin the absence of traits, which is the load-bearing half.
 * The labels are checked alongside because that is the only thing the
 * parser is still allowed to derive.
 */

import { describe, expect, test } from "bun:test";

import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { resolveEli5ContentSets } from "../pneuma-mode.js";

function files(...paths: string[]): ViewerFileContent[] {
  return paths.map((path) => ({ path, content: "" }));
}

/** A workspace whose topic names collide with every trait the parser knows. */
const TRAP = files(
  "dark-matter/manifest.json",
  "dark-matter/pages/age-5.html",
  "light-refraction/manifest.json",
  "light-refraction/pages/age-5.html",
  "en-passant/manifest.json",
  "en-passant/pages/age-5.html",
);

describe("ELI5 content sets — topic names carry no traits", () => {
  test("every topic is surfaced, keyed by its directory", () => {
    expect(resolveEli5ContentSets(TRAP).map((set) => set.prefix)).toEqual([
      "dark-matter",
      "en-passant",
      "light-refraction",
    ]);
  });

  test("`dark-matter` and `light-refraction` are not a theme pair", () => {
    for (const set of resolveEli5ContentSets(TRAP)) {
      expect(set.traits?.theme).toBeUndefined();
    }
  });

  test("`en-passant` is not an English rendition", () => {
    for (const set of resolveEli5ContentSets(TRAP)) {
      expect(set.traits?.locale).toBeUndefined();
    }
  });

  test("no set carries any trait at all, so the store keeps its own default", () => {
    // The gate in `workspace-slice.ts` is `cs.traits?.locale || cs.traits?.theme`
    // over ALL sets — one trait-bearing topic is enough to hand the choice
    // to the theme matcher, so the invariant is about the whole list.
    for (const set of resolveEli5ContentSets(TRAP)) {
      expect(set.traits).toEqual({});
    }
  });

  test("the directory name still becomes a readable label", () => {
    expect(
      resolveEli5ContentSets(TRAP).map((set) => set.label),
    ).toEqual(["Dark Matter", "En Passant", "Light Refraction"]);
  });

  test("the shipped seed topics label cleanly", () => {
    const sets = resolveEli5ContentSets(
      files(
        "database-index/manifest.json",
        "database-index/pages/age-5.html",
        "how-llms-work/manifest.json",
        "how-llms-work/pages/kid-8.html",
      ),
    );
    expect(sets.map((set) => [set.prefix, set.label])).toEqual([
      ["database-index", "Database Index"],
      ["how-llms-work", "How Llms Work"],
    ]);
    for (const set of sets) expect(set.traits).toEqual({});
  });

  test("a lone topic is not a switchable set", () => {
    // Unchanged from the shared default, and `selectLadder`'s fallback
    // depends on it: a single-topic workspace surfaces no content set and
    // the viewer renders the only manifest it parsed.
    expect(
      resolveEli5ContentSets(
        files("database-index/manifest.json", "database-index/pages/age-5.html"),
      ),
    ).toEqual([]);
  });
});
