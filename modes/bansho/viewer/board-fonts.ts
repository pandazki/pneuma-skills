/**
 * The board's BUNDLED handwriting faces — the ones bansho ships rather than
 * hopes for.
 *
 * WHY BUNDLE AT ALL. Two of the three shipped themes (`parchment`,
 * `slate-cursive`) are built on macOS system faces — Bradley Hand, HanziPen
 * SC, Chalkduster, Xingkai SC. That is a deliberate trade: those faces are
 * beautiful and free on the platform this mode was designed on, and they
 * simply are not there on Linux or Windows, where the board degrades to
 * `cursive`. `kawaii-cream` is the theme that must NOT degrade — it is the
 * one a user picks for its face, so the face travels with the mode.
 *
 * LICENCE, and it is not a nit. `ZCOOL KuaiLe` is SIL OFL 1.1. The licence
 * requires the copyright notice and licence text to travel WITH the font in
 * any distribution, so `OFL.txt` sits in the same directory as the `.ttf`
 * and `themes.test.ts` asserts it is still there. Deleting it does not make
 * a lint warning, it makes a licence violation.
 *
 * HOW THE URL SURVIVES THREE BUILDS. `new URL(..., import.meta.url)` is the
 * one asset-reference form all three of this repo's consumers understand:
 * the app's Vite build (emits a hashed asset into `dist/`), the hosted
 * player's Vite build (`vite.player.config.ts` → `player-assets/`), and the
 * Bun test runtime (a plain `file://` URL nobody fetches). An `import x from
 * "./x.ttf"` would break the third; a hardcoded `/fonts/...` path would break
 * the second.
 */

/** Where the bundled `.ttf` lands in whichever build is asking. */
const ZCOOL_KUAI_LE_URL = new URL(
  "../assets/fonts/ZCOOLKuaiLe-Regular.ttf",
  import.meta.url,
).href;

/**
 * A face this mode ships, with the string that proves it is drawing.
 *
 * `sample` is what the availability probe measures (see
 * `engine/factories/env.ts::familyAvailable`) — it must contain characters
 * the face actually covers, or an installed face measures as missing.
 */
export interface BundledFace {
  readonly family: string;
  readonly sample: string;
  readonly licence: string;
}

export const BUNDLED_FACES: readonly BundledFace[] = [
  {
    family: "ZCOOL KuaiLe",
    // CJK + Latin: ZCOOL KuaiLe is one family covering both, which is the
    // whole reason `kawaii-cream` needs no second face in its stack.
    sample: "板书快乐 Aa",
    licence: "SIL OFL 1.1",
  },
];

/**
 * `@font-face` for every bundled face, injected once by the host next to
 * `BOARD_BASE_CSS`.
 *
 * `font-display: block` on purpose. Every measured geometry on this board —
 * ink overlays, back-reference anchors, aligned columns — is a measurement
 * of text in the CURRENT face, so a swap-in mid-life is the T8 defect by
 * another door: the board would measure against the fallback and then reflow
 * underneath its own overlays. `block` keeps the text invisible until the
 * face arrives, and the host additionally waits on `document.fonts` before
 * it re-measures (see `BoardCanvas`'s font-fingerprint invalidation), so the
 * board never measures a face it is about to lose.
 *
 * Unscoped by nature — an `@font-face` rule declares a family name, which is
 * global; nothing here selects an element, so it cannot restyle the app
 * chrome the way a stray `.foo { }` in a theme would.
 */
export const BUNDLED_FONT_FACE_CSS = `
@font-face {
  font-family: "ZCOOL KuaiLe";
  src: url("${ZCOOL_KUAI_LE_URL}") format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
`;

/**
 * Ask the browser to load every family named in a `--hand` stack, then
 * resolve. Unknown / system families resolve immediately (there is nothing
 * to fetch), so this is exactly "the webfonts this stack needs are in
 * memory" and nothing more.
 *
 * Callers use it as a GATE: measure after it resolves, never before. A
 * bundled face is only fetched when something on the page asks for it, so
 * the naive sequence — write the theme, re-measure, font arrives — measures
 * the fallback and reflows afterwards.
 *
 * Degrades to an immediately-resolved promise wherever `document.fonts` is
 * absent (happy-dom, the Bun test runtime), which is the honest answer
 * there: no font loading exists, so nothing can be pending.
 */
export function loadFamilies(
  doc: Document,
  families: readonly string[],
  size = 34,
): Promise<void> {
  const set = doc.fonts as FontFaceSet | undefined;
  if (!set || typeof set.load !== "function") return Promise.resolve();
  const sampleFor = (family: string): string =>
    BUNDLED_FACES.find((f) => f.family === family)?.sample ??
    "板书 Aa";
  const pending = families.map((family) =>
    // A family the platform does not have rejects on some engines and
    // resolves empty on others; neither is a failure of the board.
    set.load(`${size}px "${family}"`, sampleFor(family)).catch(() => []),
  );
  return Promise.all(pending).then(() => undefined);
}

/**
 * The family names in a CSS `font-family` list, unquoted and trimmed.
 * Generic keywords (`cursive`, `serif`, …) are dropped — they name a
 * platform choice, not a face, and asking `fonts.load` about them is
 * meaningless.
 */
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "inherit",
  "initial",
  "unset",
]);

export function familiesIn(stack: string): string[] {
  return stack
    .split(",")
    .map((part) => part.trim().replace(/^['"]|['"]$/g, "").trim())
    .filter((name) => name.length > 0 && !GENERIC_FAMILIES.has(name.toLowerCase()));
}
