/**
 * skins — the curated reading-surface theme set for the Wordtaste draft column.
 *
 * Pure, framework-free data + resolution logic so it unit-tests without React.
 * The viewer OWNS the skin set (the agent only *suggests* an id by register —
 * see SKILL.md "Skin auto-selection"); the skill never hardcodes the list.
 *
 * A skin layers ONLY on the reading surface (the center article). The studio
 * chrome — TopBar, rail, taste/materials panels — stays on the dark Ethereal
 * Tech `cc-*` base. Each skin is a reading-optimized look: a curated palette, an
 * article-grade font (serif OR sans), and the typographic geometry that makes a
 * column comfortable to read (measure + line-height). Skins are rendered by
 * setting CSS custom properties on the article container (skinCssVars), so the
 * surface is data-driven — no per-skin CSS branch.
 *
 * Persistence: the active skin id is stored in `.pneuma/config.json` as `skin`
 * (user choice). The agent may write `skinSuggested` (a content-register hint).
 * Resolution order is user `skin` → agent `skinSuggested` → DEFAULT_SKIN_ID,
 * each falling through if it names an unknown id (resolveSkin).
 */

export interface SkinPalette {
  /** Reading-surface background. */
  bg: string;
  /** Body text color. */
  fg: string;
  /** Muted/secondary text (captions, frozen blocks). */
  muted: string;
  /** Headings color. */
  heading: string;
  /** The reading-surface accent (links, blockquote rule, selection). */
  accent: string;
  /** Subtle hairline color for rules inside the article. */
  rule: string;
  /** Block hover/selection wash on the surface. */
  wash: string;
}

export interface Skin {
  /** Stable id persisted to config.json. */
  id: string;
  /** Human label shown in the Theme panel. */
  label: string;
  /** One-line description of the register the skin fits. */
  blurb: string;
  /** Day = light reading surface, Night = dark reading surface. */
  mode: "day" | "night";
  /** Article-grade font stack — serif for literary, sans for modern/technical. */
  fontFamily: string;
  palette: SkinPalette;
  /** Optimal reading column width (a CSS length, e.g. "64ch"). */
  measure: string;
  /** Body line-height (unitless). */
  lineHeight: number;
}

const SERIF = '"Lora", "Newsreader", Georgia, serif';
const SERIF_DISPLAY = '"Fraunces", "Playfair Display", Georgia, serif';
const SANS = '"DM Sans", "Inter", system-ui, sans-serif';

/**
 * The curated set. Five reading-optimized skins:
 *   - parchment    warm serif day   — literary / thoughtful longform
 *   - ivory        clean sans day   — punchy / modern / technical
 *   - quartz       cool serif day   — neutral, high-contrast reading
 *   - midnight     neutral night    — zinc-dark page, fits the studio frame
 *   - dusk         warm night       — sepia-dark "paper at night" for long sessions
 */
export const SKINS: Skin[] = [
  {
    id: "parchment",
    label: "Parchment",
    blurb: "Warm serif — literary, thoughtful longform.",
    mode: "day",
    fontFamily: SERIF,
    measure: "62ch",
    lineHeight: 1.78,
    palette: {
      bg: "#f7f2e9",
      fg: "#2b2620",
      muted: "#6b6253",
      heading: "#1f1b15",
      accent: "#b4541f",
      rule: "rgba(43,38,32,0.14)",
      wash: "rgba(43,38,32,0.05)",
    },
  },
  {
    id: "ivory",
    label: "Ivory",
    blurb: "Clean sans — punchy, modern, technical.",
    mode: "day",
    fontFamily: SANS,
    measure: "66ch",
    lineHeight: 1.7,
    palette: {
      bg: "#fbfbfa",
      fg: "#26272b",
      muted: "#71717a",
      heading: "#18181b",
      accent: "#ea580c",
      rule: "rgba(24,24,27,0.12)",
      wash: "rgba(24,24,27,0.04)",
    },
  },
  {
    id: "quartz",
    label: "Quartz",
    blurb: "Cool serif — neutral, high-contrast reading.",
    mode: "day",
    fontFamily: SERIF_DISPLAY,
    measure: "60ch",
    lineHeight: 1.74,
    palette: {
      bg: "#eef1f4",
      fg: "#1d2530",
      muted: "#5b6675",
      heading: "#11161e",
      accent: "#2563a8",
      rule: "rgba(29,37,48,0.14)",
      wash: "rgba(29,37,48,0.05)",
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    blurb: "Neutral night — zinc-dark page, matches the studio.",
    mode: "night",
    fontFamily: SERIF,
    measure: "62ch",
    lineHeight: 1.8,
    palette: {
      bg: "#0e0e11",
      fg: "#e6e5e2",
      muted: "#9a9a9f",
      heading: "#fafafa",
      accent: "#f97316",
      rule: "rgba(255,255,255,0.1)",
      wash: "rgba(255,255,255,0.045)",
    },
  },
  {
    id: "dusk",
    label: "Dusk",
    blurb: "Warm night — sepia-dark paper for long sessions.",
    mode: "night",
    fontFamily: SERIF,
    measure: "62ch",
    lineHeight: 1.8,
    palette: {
      bg: "#201b16",
      fg: "#e7ddcd",
      muted: "#a3957f",
      heading: "#f4ecdd",
      accent: "#e2924a",
      rule: "rgba(231,221,205,0.13)",
      wash: "rgba(231,221,205,0.05)",
    },
  },
];

/** A sensible default — the neutral night page that sits closest to the dark app frame. */
export const DEFAULT_SKIN_ID = "midnight";

/** Look up a skin by id (undefined when unknown). */
export function skinById(id: string | undefined | null): Skin | undefined {
  if (!id) return undefined;
  return SKINS.find((s) => s.id === id);
}

/**
 * Resolve the active skin: user `skin` wins, then the agent's `skinSuggested`,
 * then DEFAULT_SKIN_ID. Each source is skipped when it names an unknown id, so
 * a stale id in config never strands the reading surface on a missing skin.
 */
export function resolveSkin(
  config: { skin?: unknown; skinSuggested?: unknown } | null | undefined,
): Skin {
  const fromUser = skinById(typeof config?.skin === "string" ? config.skin : undefined);
  if (fromUser) return fromUser;
  const fromAgent = skinById(
    typeof config?.skinSuggested === "string" ? config.skinSuggested : undefined,
  );
  if (fromAgent) return fromAgent;
  return skinById(DEFAULT_SKIN_ID) ?? SKINS[0];
}

/**
 * Project a skin into the CSS custom properties the article surface reads. The
 * reading surface is then a pure function of the active skin — no per-skin CSS
 * branch, so adding a skin is a data edit, not a stylesheet edit.
 */
export function skinCssVars(skin: Skin): Record<string, string> {
  return {
    "--wordtaste-skin-mode": skin.mode,
    "--wordtaste-skin-bg": skin.palette.bg,
    "--wordtaste-skin-fg": skin.palette.fg,
    "--wordtaste-skin-muted": skin.palette.muted,
    "--wordtaste-skin-heading": skin.palette.heading,
    "--wordtaste-skin-accent": skin.palette.accent,
    "--wordtaste-skin-rule": skin.palette.rule,
    "--wordtaste-skin-wash": skin.palette.wash,
    "--wordtaste-skin-font": skin.fontFamily,
    "--wordtaste-skin-measure": skin.measure,
    "--wordtaste-skin-line": String(skin.lineHeight),
  };
}
