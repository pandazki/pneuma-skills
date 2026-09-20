/**
 * Stroke icons for the previz viewer.
 *
 * Inline SVG, 24×24 viewBox, `currentColor` — no emoji anywhere in this
 * viewer (the repository's frontend rule) and no icon font to load beside a
 * stage that already carries video decoders and a WebGL canvas.
 */

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function PlayIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M7 4.5 19 12 7 19.5z" />
    </svg>
  );
}

export function PauseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M8.5 5v14M15.5 5v14" />
    </svg>
  );
}

export function StepBackIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M17 5.5 8.5 12 17 18.5z" />
      <path d="M6 5v14" />
    </svg>
  );
}

export function StepForwardIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M7 5.5 15.5 12 7 18.5z" />
      <path d="M18 5v14" />
    </svg>
  );
}

export function LoopIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M3 9.5A4.5 4.5 0 0 1 7.5 5H19" />
      <path d="m16 2 3 3-3 3" />
      <path d="M21 14.5A4.5 4.5 0 0 1 16.5 19H5" />
      <path d="m8 22-3-3 3-3" />
    </svg>
  );
}

export function SoundOnIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M4 9.5h3L11 6v12L7 14.5H4z" />
      <path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" />
    </svg>
  );
}

export function SoundOffIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M4 9.5h3L11 6v12L7 14.5H4z" />
      <path d="m15.5 9.5 5 5M20.5 9.5l-5 5" />
    </svg>
  );
}

export function CubeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="m12 3 8 4.5-8 4.5-8-4.5z" />
      <path d="M4 7.5v9l8 4.5 8-4.5v-9" />
      <path d="M12 12v9" />
    </svg>
  );
}

export function FilmIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
      <path d="M7.5 4.5v15M16.5 4.5v15M3 12h18M3 8.25h4.5M3 15.75h4.5M16.5 8.25H21M16.5 15.75H21" />
    </svg>
  );
}

export function CameraIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M2.5 8.5h11v7h-11z" />
      <path d="m13.5 12 5-3v9l-5-3z" />
    </svg>
  );
}

export function OrbitIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-25 12 12)" />
    </svg>
  );
}

export function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </svg>
  );
}

export function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

export function CrossIcon({ size = 12 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function QuestionIcon({ size = 12 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M9 9a3 3 0 1 1 4.2 2.75c-.75.36-1.2 1.1-1.2 1.95v.8" />
      <path d="M12 17.5h.01" />
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

export function CoinsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <ellipse cx="9" cy="7" rx="6" ry="2.5" />
      <path d="M3 7v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7" />
      <path d="M9 13.5v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4" />
      <path d="M15 11c3.3 0 6 1.1 6 2.5S18.3 16 15 16s-6-1.1-6-2.5" />
    </svg>
  );
}
