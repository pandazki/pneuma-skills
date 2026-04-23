// Editorial-dark design tokens for the ClipCraft viewer.
//
// Color values use OKLCH because it is perceptually uniform — sibling
// shades read as equal steps regardless of hue. All neutrals carry a
// faint amber tint (hue 55, chroma ~0.01) so dark surfaces feel warm
// rather than cold-blue; this is the "tinted neutral" rule from
// impeccable.style. Accent and layer colors are intentionally
// desaturated compared to a dashboard-default neon palette.

export const color = {
  // Surfaces — warm tinted grays, rising by ~4-5 L* per step.
  surface0: "oklch(13% 0.008 55)", // deepest bg
  surface1: "oklch(17% 0.010 55)", // panel bg
  surface2: "oklch(21% 0.012 55)", // raised panel / track row
  surface3: "oklch(26% 0.014 55)", // clip body
  surface4: "oklch(32% 0.016 55)", // hover / selected clip
  surface5: "oklch(38% 0.018 55)", // button hover

  // Ink — matching warm tint, high contrast for body.
  ink0: "oklch(96% 0.008 55)", // heading / bright text
  ink1: "oklch(86% 0.008 55)", // body
  ink2: "oklch(70% 0.008 55)", // secondary
  ink3: "oklch(55% 0.008 55)", // muted
  ink4: "oklch(42% 0.008 55)", // dim / placeholder
  ink5: "oklch(32% 0.008 55)", // faint / disabled

  // Borders — use sparingly, subtle by default.
  borderWeak: "oklch(22% 0.008 55)",
  border: "oklch(30% 0.010 55)",
  borderStrong: "oklch(40% 0.012 55)",

  // Accent — amber/orange, one color, no gradients.
  accent: "oklch(74% 0.16 55)",
  accentBright: "oklch(82% 0.17 55)",
  accentInk: "oklch(90% 0.10 55)",
  accentSoft: "oklch(74% 0.16 55 / 0.16)",
  accentBorder: "oklch(74% 0.16 55 / 0.55)",
  accentFaint: "oklch(74% 0.16 55 / 0.08)",

  // Layer palette — desaturated, one hue per track type.
  layerVideo: "oklch(78% 0.13 75)", // warm amber
  layerVideoSoft: "oklch(78% 0.13 75 / 0.14)",
  layerAudio: "oklch(70% 0.09 215)", // muted cyan
  layerAudioSoft: "oklch(70% 0.09 215 / 0.14)",
  layerSubtitle: "oklch(80% 0.07 155)", // sage
  layerSubtitleSoft: "oklch(80% 0.07 155 / 0.14)",

  // Semantic — for status, not decoration.
  danger: "oklch(66% 0.19 25)",
  dangerBright: "oklch(74% 0.20 25)",
  dangerInk: "oklch(88% 0.10 25)",
  dangerSoft: "oklch(66% 0.19 25 / 0.16)",
  dangerBorder: "oklch(66% 0.19 25 / 0.55)",

  warn: "oklch(78% 0.14 85)",
  warnInk: "oklch(90% 0.08 85)",
  warnSoft: "oklch(78% 0.14 85 / 0.16)",

  success: "oklch(72% 0.12 155)",
  successSoft: "oklch(72% 0.12 155 / 0.16)",

  // Playhead — distinct identity, slightly hotter than accent.
  playhead: "oklch(78% 0.19 48)",
  playheadSoft: "oklch(78% 0.19 48 / 0.35)",
} as const;

export const space = {
  px: 1,
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 24,
  space6: 32,
  space7: 48,
  space8: 64,
} as const;

export const radius = {
  none: 0,
  sm: 3,
  base: 5,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

export const text = {
  // 4-size scale, 1.25-ish ratio. Tight because this is dense app UI.
  xs: 10, // meta, ruler ticks, tiny labels
  sm: 11, // secondary labels, track names
  base: 13, // primary body UI
  lg: 16, // section headings
  xl: 22, // display (timecode)

  weightRegular: 400,
  weightMedium: 500,
  weightSemibold: 600,

  lineHeightTight: 1.15,
  lineHeightSnug: 1.35,
  lineHeightBody: 1.5,

  trackingTight: "-0.01em",
  trackingBase: "0em",
  trackingWide: "0.04em",
  trackingCaps: "0.08em", // for all-caps labels
} as const;

export const font = {
  ui: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
  display:
    '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif',
  mono: '"SF Mono", "JetBrains Mono", ui-monospace, "Menlo", monospace',
  // Tabular numerals for timecode — absolutely required.
  numeric: '"SF Mono", ui-monospace, "Menlo", monospace',
} as const;

export const duration = {
  instant: 80,
  quick: 120,
  base: 180,
  slow: 320,
  slower: 480,
} as const;

export const easing = {
  // ease-out-quart — natural deceleration, no bounce.
  out: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  // gentle ease-in-out for continuous transitions.
  inOut: "cubic-bezier(0.6, 0, 0.4, 1)",
  // sharp snap for state toggles.
  snap: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

export const elevation = {
  none: "none",
  // Subtle hairlines for raised elements. Impeccable says shadows
  // should be barely visible on dark UI — depth comes from surface
  // color contrast, not drop shadows.
  s1: "0 1px 2px oklch(0% 0 0 / 0.4)",
  s2: "0 2px 6px oklch(0% 0 0 / 0.42), 0 1px 2px oklch(0% 0 0 / 0.28)",
  s3: "0 8px 24px oklch(0% 0 0 / 0.48), 0 2px 6px oklch(0% 0 0 / 0.28)",
  // Used very sparingly — only for modal-like overlays.
  s4: "0 24px 48px oklch(0% 0 0 / 0.55), 0 4px 12px oklch(0% 0 0 / 0.32)",
} as const;

export const focusRing = `0 0 0 2px ${color.surface0}, 0 0 0 3px ${color.accent}`;

// One convenient namespace to import from consumers.
export const theme = {
  color,
  space,
  radius,
  text,
  font,
  duration,
  easing,
  elevation,
  focusRing,
} as const;

export type Theme = typeof theme;
