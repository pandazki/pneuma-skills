/**
 * DefaultProjectCover — procedural fallback shown when a project has no
 * `<root>/.pneuma/cover.png`. Renders a soft zinc-to-orange gradient with
 * the project's first letter as a large stylized character, plus a subtle
 * grid-of-dots texture so the card never looks empty.
 *
 * The hue rotates deterministically on `seed` (the project id) so that two
 * cards next to each other don't share the exact same gradient.
 */

import React from "react";

interface DefaultProjectCoverProps {
  seed: string;
  displayName: string;
  className?: string;
}

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

function firstGrapheme(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "?";
  // Codepoint-aware first character so emoji and CJK both render correctly.
  const codepoints = Array.from(trimmed);
  return codepoints[0]?.toUpperCase() ?? "?";
}

export function DefaultProjectCover({
  seed,
  displayName,
  className,
}: DefaultProjectCoverProps) {
  const h = hashString(seed || displayName);
  // 0..359 hue, but biased toward warm (10°–60°) so cards stay on-theme.
  const hue = 10 + (h % 50);
  const accent = `hsl(${hue}deg 90% 56%)`;
  const accentSoft = `hsl(${hue}deg 80% 32% / 0.55)`;
  const letter = firstGrapheme(displayName);

  return (
    <div
      className={`relative w-full h-full overflow-hidden ${className || ""}`}
      aria-hidden="true"
    >
      {/* Base gradient — deep zinc with a warm pull toward the accent corner */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(140% 110% at 88% -10%, ${accentSoft} 0%, rgba(24,24,27,0) 55%), linear-gradient(135deg, #18181b 0%, #0c0c0f 100%)`,
        }}
      />
      {/* Dotted texture — stays subtle so the letter remains the focus */}
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)",
          backgroundSize: "14px 14px",
        }}
      />
      {/* Diagonal sheen */}
      <div
        className="absolute inset-0 opacity-60 mix-blend-screen"
        style={{
          background:
            "linear-gradient(115deg, transparent 0%, transparent 45%, rgba(255,255,255,0.04) 55%, transparent 70%)",
        }}
      />
      {/* Letter */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="font-semibold leading-none select-none"
          style={{
            fontSize: "clamp(48px, 32%, 96px)",
            color: accent,
            textShadow: "0 2px 30px rgba(0,0,0,0.55)",
            letterSpacing: "-0.02em",
            opacity: 0.92,
          }}
        >
          {letter}
        </span>
      </div>
      {/* Soft inner border to lift the card against the page */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      />
    </div>
  );
}
