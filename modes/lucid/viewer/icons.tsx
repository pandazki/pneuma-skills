/**
 * Lucide-style stroke icons for the lucid viewer.
 *
 * Inline SVG, 24×24 viewBox, `currentColor` — no emoji anywhere in this
 * viewer (the repository's frontend rule), and no icon font to load inside a
 * panel that already carries a WebGL iframe.
 */

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function ReloadIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1.06 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export function LayersIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  );
}

export function AlertIcon({ size = 12 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M12 4 2.5 20h19L12 4Z" />
      <path d="M12 10v4M12 17.5h.01" />
    </svg>
  );
}

export function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function SparkIcon({ size = 12 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9 12 3.5Z" />
    </svg>
  );
}
