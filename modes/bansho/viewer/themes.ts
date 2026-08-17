/**
 * The board's shipped themes — three looks, chosen with the product owner in
 * front of real renders, and the CSS that writes one into a content set.
 *
 * ── WHERE A THEME LIVES ─────────────────────────────────────────────────────
 * A theme is a CONTENT-SET concern, not a viewer preference. A lecture
 * carries its look in its own `theme.css` next to its `board.md`
 * (`skill/references/themes.md`), which is why the picker WRITES one of these
 * presets to that file rather than holding a setting of its own. The
 * consequences are all the good ones: the look survives a reload, travels
 * with an exported or shared lecture, is visible to the agent as a file it
 * can read and hand-edit afterwards, and a lecture that already chose a look
 * is never overridden by whatever the last reader clicked.
 *
 * ── WHY THE PALETTE IS WRITTEN TWICE ────────────────────────────────────────
 * `BOARD_BASE_CSS` declares the stock dark palette at
 * `.bansho-board-surface[data-bansho-theme="dark"]` — specificity (0,2,0). A
 * preset that wrote only `.bansho-board-surface { … }` (0,1,0) would be
 * overridden outright the moment the reader's app chrome is dark, no matter
 * what order the sheets land in: `parchment` would silently become the stock
 * green slate. So each preset states its palette on BOTH selectors. That is
 * not a style choice — it is the only way the contract's colours reach the
 * board at all.
 *
 * `--hand` is the opposite and gets exactly ONE rule. The base sheet declares
 * the dark board's hand behind `:where(…)` (weighing nothing, so (0,1,0))
 * precisely so a single later `.bansho-board-surface { --hand: … }` rethemes
 * both boards — see board-css.ts's comment on that selector. Writing `--hand`
 * twice would work but would quietly retire the seam the docs teach.
 *
 * ── THE CHALK SEAM ──────────────────────────────────────────────────────────
 * Every preset states `--bansho-chalk` (0 or 1). That token is the ENTIRE
 * interface between a board's look and the chalk-texture / hand-wipe effects
 * built on top of it: 1 means "this board is chalk on slate", 0 means ink on
 * paper, which must stay byte-identical to a board with no chalk work in it
 * at all. Nothing here implements an effect, and nothing here should.
 */

import { familiesIn } from "./board-fonts.js";

/** A face a preset needs, and the string that proves it is drawing. */
export interface RequiredFace {
  readonly family: string;
  /**
   * Characters this face is being asked to draw. The availability probe
   * measures THIS string, so it has to be script-appropriate: measuring a
   * CJK face with Latin text answers a question about the fallback.
   */
  readonly sample: string;
  /** `true` when bansho ships the face itself (see viewer/board-fonts.ts). */
  readonly bundled: boolean;
}

export interface BoardThemePreset {
  /** Stable id — the value written into the marker header, never displayed. */
  readonly id: string;
  /** The name the look was chosen under. */
  readonly labelZh: string;
  readonly label: string;
  /** One line about the hand, shown under the name in the picker. */
  readonly hand: string;
  /** The `--hand` stack, verbatim CSS. */
  readonly handStack: string;
  /** Faces whose absence changes what the reader sees. */
  readonly faces: readonly RequiredFace[];
  /**
   * `1` = chalk on slate. The one token the chalk-texture and hand-wipe
   * effects read; see this file's header.
   */
  readonly chalk: 0 | 1;
  /** Board tokens, exactly as chosen. Written on both theme selectors. */
  readonly tokens: Readonly<Record<string, string>>;
}

/**
 * The `--hl-a`, `--s1`, `--s2` and `--wall` companions are NOT decoration:
 * each has a different default on the light and the dark base rule, so a
 * preset that left them alone would have them flip with the reader's app
 * chrome while the board stayed put — `slate-cursive` would draw the light
 * board's dark-green chart series onto its own dark-green slate. Each preset
 * therefore adopts the companion set that belongs to the board it IS: the
 * two paper boards take the light defaults, the slate takes the dark ones.
 *
 * `--bansho-flaw` is deliberately absent from all three. It is the 瑕疵 knob,
 * an author's decision about how much of a hand the board has, orthogonal to
 * which look it wears — a preset that pinned it would silently undo whatever
 * the author had tuned.
 */
const LIGHT_COMPANIONS = {
  "--hl-a": "0.62",
  "--s1": "#2e9e4f",
  "--s2": "#3b7dd8",
  "--wall": "#cfc7ba",
} as const;

const DARK_COMPANIONS = {
  "--hl-a": "0.32",
  "--s1": "#6fd98d",
  "--s2": "#7fb2f0",
  "--wall": "#2b302e",
} as const;

/** Latin probe: what a Latin handwriting face is actually asked to draw. */
const LATIN_SAMPLE = "Handwriting";
/** CJK probe — a face that covers Latin but not CJK must not pass. */
const CJK_SAMPLE = "板书手写";

export const BOARD_THEMES: readonly BoardThemePreset[] = [
  {
    id: "parchment",
    labelZh: "牛皮纸",
    label: "Parchment",
    hand: "Bradley Hand + HanziPen SC",
    handStack:
      '"Bradley Hand", "HanziPen SC", "Chalkboard SE", "Segoe Print", cursive',
    faces: [
      { family: "Bradley Hand", sample: LATIN_SAMPLE, bundled: false },
      { family: "HanziPen SC", sample: CJK_SAMPLE, bundled: false },
    ],
    chalk: 0,
    tokens: {
      "--board": "#f3ece0",
      "--board-fg": "#1c1b19",
      "--accent": "#c2571e",
      "--hl": "#ffe072",
      ...LIGHT_COMPANIONS,
    },
  },
  {
    id: "slate-cursive",
    labelZh: "绿板 · 行楷",
    label: "Slate · Cursive",
    hand: "Chalkduster + Xingkai SC",
    // `STXingkai` is the same face under the name older macOS releases
    // report; naming both costs nothing and is the difference between a
    // 行楷 board and a fallback on a machine one release behind.
    handStack:
      '"Chalkduster", "Xingkai SC", "STXingkai", "HanziPen SC", cursive',
    faces: [
      { family: "Chalkduster", sample: LATIN_SAMPLE, bundled: false },
      { family: "Xingkai SC", sample: CJK_SAMPLE, bundled: false },
    ],
    chalk: 1,
    tokens: {
      "--board": "#22302a",
      "--board-fg": "#f2efe6",
      "--accent": "#e8894b",
      "--hl": "#e8c24a",
      ...DARK_COMPANIONS,
    },
  },
  {
    id: "kawaii-cream",
    labelZh: "可爱 · 奶油",
    label: "Kawaii · Cream",
    hand: "ZCOOL KuaiLe",
    // One family covering CJK and Latin, and the only stack here with no
    // second face behind it — because it is the one bansho ships, so there
    // is nothing to fall back FROM (see viewer/board-fonts.ts).
    handStack: '"ZCOOL KuaiLe", cursive',
    faces: [
      { family: "ZCOOL KuaiLe", sample: "板书快乐 Aa", bundled: true },
    ],
    chalk: 0,
    tokens: {
      "--board": "#faf3e6",
      "--board-fg": "#3a332b",
      "--accent": "#e0714a",
      "--hl": "#ffd98e",
      ...LIGHT_COMPANIONS,
    },
  },
];

export const themeById = (id: string): BoardThemePreset | null =>
  BOARD_THEMES.find((t) => t.id === id) ?? null;

/**
 * First line of any `theme.css` the picker wrote. Its presence is the ONLY
 * way to tell a picked theme from one an author (or the agent) hand-wrote,
 * and the picker uses it to decide whether replacing the file needs the
 * reader's confirmation. Absent marker = someone else's work = ask first.
 */
const MARKER = "/* pneuma:bansho-theme preset=";

export const markerFor = (id: string): string => `${MARKER}${id} */`;

/**
 * Which preset wrote this stylesheet, or `null` for a file the picker did
 * not write (hand-authored, agent-authored, or from a version of the picker
 * that used another preset id — all three mean "not mine to overwrite
 * silently").
 */
export function presetIdOf(css: string | undefined): string | null {
  if (!css) return null;
  const line = css.slice(0, 200);
  const at = line.indexOf(MARKER);
  if (at === -1) return null;
  const rest = line.slice(at + MARKER.length);
  const end = rest.indexOf(" */");
  if (end === -1) return null;
  const id = rest.slice(0, end).trim();
  return id.length > 0 ? id : null;
}

/**
 * Where a content set's theme lives. Mirrors `domain.ts::loadBoard`, which
 * pairs each `board.md` with the `theme.css` beside it — the root set's board
 * is `board.md`, so its theme is `theme.css` with no prefix.
 */
export const themePathFor = (setKey: string): string =>
  setKey === "" ? "theme.css" : `${setKey}/theme.css`;

/**
 * Everything in a `theme.css` that can move a glyph — the fingerprint the
 * canvas watches to decide whether a stylesheet edit invalidated its
 * MEASUREMENTS or merely repainted.
 *
 * The distinction is the whole point. `themeCss` already reaches the canvas
 * as "a board token may have changed", and the 瑕疵 knob rides that same
 * signal — but a knob edit is paint-only and must NOT re-fold the board
 * (BoardCanvas states this explicitly). A `--hand` edit is the opposite: the
 * new face has different metrics, every line re-flows, and every ink overlay,
 * back-reference anchor and aligned column was measured against the old one.
 * Reconcile cannot see either — the board's bytes did not move, so every
 * content hash still matches and the plan is a no-op — which is precisely why
 * this has to be watched rather than inferred.
 *
 * Matched textually rather than through computed style on purpose: the answer
 * is then a pure function of the stylesheet, testable without a layout engine
 * and identical in every host. It over-reports at worst (a comment mentioning
 * `font-size` costs one rebuild), never under-reports, which is the right
 * direction for an invalidation.
 */
const GLYPH_MOVING = new RegExp(
  [
    // Custom property carrying the hand, plus the CSS properties that can
    // change the face or the advance of any glyph on the board.
    String.raw`--hand\s*:[^;}]*`,
    String.raw`font-family\s*:[^;}]*`,
    String.raw`font-size\s*:[^;}]*`,
    String.raw`font-weight\s*:[^;}]*`,
    String.raw`font-stretch\s*:[^;}]*`,
    String.raw`font-style\s*:[^;}]*`,
    String.raw`line-height\s*:[^;}]*`,
    String.raw`letter-spacing\s*:[^;}]*`,
    String.raw`word-spacing\s*:[^;}]*`,
    // A theme may bring its own webfont; a changed `src` is a changed face.
    String.raw`@font-face\s*\{[^}]*\}`,
  ].join("|"),
  "g",
);

export function fontFingerprint(css: string | undefined): string {
  if (!css) return "";
  return (css.match(GLYPH_MOVING) ?? [])
    .map((m) => m.replace(/\s+/g, " ").trim())
    .join("|");
}

/**
 * The families a stylesheet asks the board to write in — the argument to a
 * font preload before re-measuring. Reads the LAST `--hand` declaration,
 * which is the one that wins for a sheet written by `presetCss` (one rule)
 * and the best available guess for a hand-written one.
 */
export function handFamiliesIn(css: string | undefined): string[] {
  if (!css) return [];
  const matches = [...css.matchAll(/--hand\s*:([^;}]*)/g)];
  const last = matches.at(-1)?.[1];
  return last ? familiesIn(last) : [];
}

const declarations = (entries: readonly (readonly [string, string])[]): string =>
  entries.map(([k, v]) => `  ${k}: ${v};`).join("\n");

/**
 * The stylesheet for a preset.
 *
 * `scope` turns the same preset into a PREVIEW sheet: every selector is
 * prefixed, so the rules reach one subtree and cannot touch the board the
 * reader is actually watching. The prefixed dark selector weighs (0,3,0)
 * against the base and live sheets' (0,2,0), so a preview wins on
 * specificity alone and never depends on which `<style>` tag landed last.
 */
export function presetCss(preset: BoardThemePreset, scope?: string): string {
  const prefix = scope ? `${scope} ` : "";
  const palette = Object.entries(preset.tokens);
  const light = declarations([
    ...palette,
    ["--bansho-chalk", String(preset.chalk)],
    // ONE rule, on the base selector only — see this file's header.
    ["--hand", preset.handStack],
  ]);
  const dark = declarations([
    ...palette,
    ["--bansho-chalk", String(preset.chalk)],
  ]);
  return `${markerFor(preset.id)}
/* ${preset.labelZh} · ${preset.label} — ${preset.hand}.
   Written by the board theme picker. Edit it freely: it is this lecture's
   own stylesheet, and every rule below is scoped to the board surface.
   Removing the marker line above only means the picker will ask before it
   replaces your edits. */
${prefix}.bansho-board-surface {
${light}
}
${prefix}.bansho-board-surface[data-bansho-theme="dark"] {
${dark}
}
`;
}
