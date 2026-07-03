/**
 * font-theme — the reading surface as TWO independent axes.
 *
 * Pure, framework-free data + resolution logic so it unit-tests without React.
 *
 * The old "skin" bundled three things into one choice: a reading font, a color
 * palette, and a day/night mood. That coupling forced a Chinese literary essay
 * and an English literary essay to share one font, and made "the warm serif on a
 * night page" impossible to express. We split it into two orthogonal registries:
 *
 *   FONT axis    a reading FACE + its typographic geometry (measure, line). One
 *                face per writing SCRIPT register: a warm kami-style CJK face
 *                (霞鹭文楷 / LXGW WenKai) for Chinese, a soft literary serif
 *                (Newsreader) for English, plus a couple of alternates. The font
 *                is auto-picked from the DRAFT's script when the user hasn't
 *                chosen — Chinese content → WenKai, Latin content → the serif.
 *
 *   THEME axis   a color PALETTE + its day/night mood. The old skin palettes
 *                live on here, now free of any font binding. The user picks the
 *                theme directly (it is not auto-derived from content).
 *
 * The viewer OWNS both sets (the agent only *suggests* an id by register — see
 * SKILL.md). The reading surface is rendered by setting CSS custom properties
 * (`--wordtaste-font-*` from the font axis, `--wordtaste-theme-*` from the color
 * axis) on the article container, so the surface stays data-driven — no per-skin
 * CSS branch, and the two axes compose freely (WenKai on a light theme, the
 * serif on a night theme, any pairing).
 *
 * Persistence (`.pneuma/config.json`):
 *   - user choices       `font` + `theme`   (each wins for its axis)
 *   - agent hints        `fontSuggested` + `themeSuggested`
 *   - legacy fallback    `skin` / `skinSuggested` (pre-split single id) is mapped
 *                        to its `{ font, theme }` pair so an old config never
 *                        strands the surface (LEGACY_SKIN_MAP + resolveFont/Theme).
 *
 * The studio CHROME stays on the dark Ethereal Tech `cc-*` base; only the center
 * article reads these vars.
 */

// ── FONT axis ────────────────────────────────────────────────────────────────

/** Which writing script a reading face is built for. */
export type FontScript = "cjk" | "latin";

export interface ReadingFont {
  /** Stable id persisted to config.json as `font`. */
  id: string;
  /** Human label shown in the Font picker. */
  label: string;
  /** One-line description of the register the face fits. */
  blurb: string;
  /** The script this face is the preferred reading face for. */
  script: FontScript;
  /** Full CSS font stack — the face plus graceful fallbacks. */
  fontFamily: string;
  /** Optimal reading column width (a CSS length, e.g. "62ch"). */
  measure: string;
  /** Widest comfortable column when the studio pane has extra room. */
  maxMeasure: string;
  /** Body line-height (unitless). CJK reads best a touch looser. */
  lineHeight: number;
}

// Reading faces are loaded as web fonts from the viewer's own scoped <style>
// (see WordtastePreview STUDIO_CSS @import block) so the mode is self-contained
// and renders the same whether it runs in the launcher shell, a showcase, or as
// an installed external mode. The family names below MUST match those @font-face
// / Google-Fonts declarations exactly.
const WENKAI = '"LXGW WenKai Screen", "Lora", "Songti SC", "STSong", serif';
const NEWSREADER = '"Newsreader", "Lora", Georgia, serif';
const SOURCE_SERIF = '"Source Serif 4", "Lora", Georgia, serif';
const DM_SANS = '"DM Sans", "Inter", system-ui, sans-serif';

/**
 * The curated reading faces, one preferred face per script plus alternates:
 *   - wenkai      霞鹭文楷 — warm kami-style CJK face (Chinese default)
 *   - newsreader  soft literary serif — high-literary English (Latin default)
 *   - source-serif  cooler workhorse serif — neutral English longform
 *   - dm-sans     clean humanist sans — punchy / modern / technical
 */
export const FONTS: ReadingFont[] = [
  {
    id: "wenkai",
    label: "霞鹭文楷",
    blurb: "Warm kami-style brush serif — the Chinese reading face.",
    script: "cjk",
    fontFamily: WENKAI,
    measure: "48ch",
    maxMeasure: "82ch",
    lineHeight: 1.95,
  },
  {
    id: "newsreader",
    label: "Newsreader",
    blurb: "Soft literary serif — high-literary English longform.",
    script: "latin",
    fontFamily: NEWSREADER,
    measure: "62ch",
    maxMeasure: "76ch",
    lineHeight: 1.78,
  },
  {
    id: "source-serif",
    label: "Source Serif",
    blurb: "Cool workhorse serif — neutral, high-contrast English reading.",
    script: "latin",
    fontFamily: SOURCE_SERIF,
    measure: "60ch",
    maxMeasure: "74ch",
    lineHeight: 1.74,
  },
  {
    id: "dm-sans",
    label: "DM Sans",
    blurb: "Clean humanist sans — punchy, modern, technical.",
    script: "latin",
    fontFamily: DM_SANS,
    measure: "66ch",
    maxMeasure: "78ch",
    lineHeight: 1.7,
  },
];

/** The preferred face id for each script — what auto-pick resolves to. */
export const DEFAULT_FONT_BY_SCRIPT: Record<FontScript, string> = {
  cjk: "wenkai",
  latin: "newsreader",
};

/** The overall default when nothing — content or config — points anywhere. */
export const DEFAULT_FONT_ID = DEFAULT_FONT_BY_SCRIPT.latin;

/** Look up a reading face by id (undefined when unknown). */
export function fontById(id: string | undefined | null): ReadingFont | undefined {
  if (!id) return undefined;
  return FONTS.find((f) => f.id === id);
}

// ── THEME axis ─────────────────────────────────────────────────────────────--

export interface ThemePalette {
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

export interface ColorTheme {
  /** Stable id persisted to config.json as `theme`. */
  id: string;
  /** Human label shown in the Color-theme picker. */
  label: string;
  /** One-line description of the mood the theme fits. */
  blurb: string;
  /** Day = light reading surface, Night = dark reading surface. */
  mode: "day" | "night";
  palette: ThemePalette;
}

/**
 * The curated color themes (the old skin palettes, now font-free):
 *   - parchment   warm paper day
 *   - ivory       clean neutral day
 *   - quartz      cool blue-grey day
 *   - midnight    neutral zinc night (matches the studio frame)
 *   - dusk        warm sepia night
 */
export const THEMES: ColorTheme[] = [
  {
    id: "parchment",
    label: "Parchment",
    blurb: "Warm paper — literary, thoughtful daylight.",
    mode: "day",
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
    blurb: "Clean neutral — bright, modern daylight.",
    mode: "day",
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
    blurb: "Cool blue-grey — neutral, high-contrast daylight.",
    mode: "day",
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

/** A sensible default — the neutral night page closest to the dark app frame. */
export const DEFAULT_THEME_ID = "midnight";

/** Look up a color theme by id (undefined when unknown). */
export function themeById(id: string | undefined | null): ColorTheme | undefined {
  if (!id) return undefined;
  return THEMES.find((t) => t.id === id);
}

// ── Legacy skin → { font, theme } compatibility map ──────────────────────────

/**
 * Pre-split, a single skin id bundled a font + a palette. An existing
 * `.pneuma/config.json` may still carry `skin`/`skinSuggested`. Map each legacy
 * id to the { font, theme } pair that best reproduces its look so a one-version
 * upgrade never strands the surface. The palette ids survived the split, so the
 * theme is just the same id; the font is the old skin's serif-vs-sans register.
 */
export const LEGACY_SKIN_MAP: Record<string, { font: string; theme: string }> = {
  parchment: { font: "newsreader", theme: "parchment" },
  ivory: { font: "dm-sans", theme: "ivory" },
  quartz: { font: "source-serif", theme: "quartz" },
  midnight: { font: "newsreader", theme: "midnight" },
  dusk: { font: "newsreader", theme: "dusk" },
};

// ── Content-language detection (drives font auto-pick) ───────────────────────

/**
 * Decide whether content reads as CJK or Latin by counting CJK ideographs (plus
 * kana) against ASCII letters. CJK wins on a low bar (≥ ~12% of letter-class
 * characters) because a Chinese essay routinely carries Latin proper nouns,
 * code, and punctuation; a genuinely English piece has ~0 CJK. Empty / symbol-
 * only content falls back to Latin (the safe literary default).
 */
export function detectScript(content: string | null | undefined): FontScript {
  if (!content) return "latin";
  // CJK Unified Ideographs + Extension A + Hiragana/Katakana + CJK punctuation.
  const cjkMatches = content.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/g);
  const cjk = cjkMatches ? cjkMatches.length : 0;
  const latinMatches = content.match(/[A-Za-z]/g);
  const latin = latinMatches ? latinMatches.length : 0;
  if (cjk === 0) return "latin";
  if (latin === 0) return "cjk";
  return cjk / (cjk + latin) >= 0.12 ? "cjk" : "latin";
}

// ── Resolution ───────────────────────────────────────────────────────────────

export interface SurfaceConfig {
  // New split axes.
  font?: unknown;
  theme?: unknown;
  fontSuggested?: unknown;
  themeSuggested?: unknown;
  // Legacy bundled skin (pre-split).
  skin?: unknown;
  skinSuggested?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Resolve the active reading FONT. Order: user `font` → agent `fontSuggested` →
 * legacy `skin`'s font → legacy `skinSuggested`'s font → auto-pick from the
 * draft's script → the script's default face. Each source is skipped when it
 * names an unknown id, so a stale id never strands the surface.
 *
 * `content` is the active draft's text — when no explicit choice survives, the
 * font is auto-picked by detecting CJK vs Latin in it (Chinese → WenKai, English
 * → the literary serif), which is the headline behavior of the split.
 */
export function resolveFont(
  content: string | null | undefined,
  config: SurfaceConfig | null | undefined,
): ReadingFont {
  const fromUser = fontById(str(config?.font));
  if (fromUser) return fromUser;
  const fromAgent = fontById(str(config?.fontSuggested));
  if (fromAgent) return fromAgent;

  const legacyUser = LEGACY_SKIN_MAP[str(config?.skin) ?? ""];
  const fromLegacyUser = fontById(legacyUser?.font);
  if (fromLegacyUser) return fromLegacyUser;
  const legacyAgent = LEGACY_SKIN_MAP[str(config?.skinSuggested) ?? ""];
  const fromLegacyAgent = fontById(legacyAgent?.font);
  if (fromLegacyAgent) return fromLegacyAgent;

  const script = detectScript(content);
  return fontById(DEFAULT_FONT_BY_SCRIPT[script]) ?? FONTS[0];
}

/**
 * Resolve the active color THEME. Order: user `theme` → agent `themeSuggested` →
 * legacy `skin`'s theme → legacy `skinSuggested`'s theme → DEFAULT_THEME_ID. The
 * theme is NOT content-derived — the user owns the color mood; only the font
 * follows the script.
 */
export function resolveTheme(config: SurfaceConfig | null | undefined): ColorTheme {
  const fromUser = themeById(str(config?.theme));
  if (fromUser) return fromUser;
  const fromAgent = themeById(str(config?.themeSuggested));
  if (fromAgent) return fromAgent;

  const legacyUser = LEGACY_SKIN_MAP[str(config?.skin) ?? ""];
  const fromLegacyUser = themeById(legacyUser?.theme);
  if (fromLegacyUser) return fromLegacyUser;
  const legacyAgent = LEGACY_SKIN_MAP[str(config?.skinSuggested) ?? ""];
  const fromLegacyAgent = themeById(legacyAgent?.theme);
  if (fromLegacyAgent) return fromLegacyAgent;

  return themeById(DEFAULT_THEME_ID) ?? THEMES[0];
}

// ── CSS projection (two independent var groups, composed on the surface) ─────

/** Project the font axis into the `--wordtaste-font-*` custom properties. */
export function fontCssVars(font: ReadingFont): Record<string, string> {
  return {
    "--wordtaste-font-family": font.fontFamily,
    "--wordtaste-font-measure": font.measure,
    "--wordtaste-font-max-measure": font.maxMeasure,
    "--wordtaste-font-line": String(font.lineHeight),
    "--wordtaste-font-script": font.script,
  };
}

/** Project the color theme into the `--wordtaste-theme-*` custom properties. */
export function themeCssVars(theme: ColorTheme): Record<string, string> {
  return {
    "--wordtaste-theme-mode": theme.mode,
    "--wordtaste-theme-bg": theme.palette.bg,
    "--wordtaste-theme-fg": theme.palette.fg,
    "--wordtaste-theme-muted": theme.palette.muted,
    "--wordtaste-theme-heading": theme.palette.heading,
    "--wordtaste-theme-accent": theme.palette.accent,
    "--wordtaste-theme-rule": theme.palette.rule,
    "--wordtaste-theme-wash": theme.palette.wash,
  };
}

/**
 * Compose both axes into one CSS-custom-property bag for the article container.
 * The two groups are independent — any font pairs with any theme.
 */
export function surfaceCssVars(font: ReadingFont, theme: ColorTheme): Record<string, string> {
  return { ...fontCssVars(font), ...themeCssVars(theme) };
}
