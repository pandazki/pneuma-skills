/**
 * ModeIcon — tiny wrapper that renders a mode's inline SVG icon (from
 * `manifest.icon`) with a generic fallback when the SVG is missing or
 * malformed. Sized via `className` (e.g. `w-6 h-6 text-cc-primary`).
 *
 * Extracted from `Launcher.tsx` so the project panel + future surfaces can
 * reuse the exact same lookup + fallback logic. Keeping the prop signature
 * unchanged (`{ svg?: string; className?: string }`) means the original
 * Launcher mode card markup is untouched.
 */

const FALLBACK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/></svg>`;

export function ModeIcon({ svg, className }: { svg?: string; className?: string }) {
  const hasSvg = svg && svg.trim().startsWith("<svg");
  return (
    <div
      className={`[&>svg]:w-full [&>svg]:h-full ${className || ""}`}
      dangerouslySetInnerHTML={{ __html: hasSvg ? svg : FALLBACK_SVG }}
    />
  );
}

export { FALLBACK_SVG };
