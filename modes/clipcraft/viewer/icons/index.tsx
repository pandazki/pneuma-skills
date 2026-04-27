// ClipCraft icon set — a consistent stroke-based SVG family.
//
// Every icon uses a 16x16 viewBox, stroke="currentColor", and
// strokeWidth 1.5 by default, so colors track the parent font color
// and sizing tracks the parent font size. No emoji, no unicode
// glyphs, no mixed visual languages.
//
// Rationale: impeccable.style flags emoji and raw unicode glyphs as
// AI-slop tells — they render inconsistently across platforms, can't
// be tinted, and break hierarchy at small sizes. One family + one
// stroke weight = one voice.

import type { SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "stroke" | "fill"> {
  size?: number;
  strokeWidth?: number;
}

function Svg({
  size = 16,
  strokeWidth = 1.5,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ────────────────────────── transport ─────────────────────────── */

export function PlayIcon(props: IconProps) {
  // Triangle shifted 0.5px right for optical centering.
  return (
    <Svg {...props}>
      <path
        d="M5.5 3.25 L12.5 8 L5.5 12.75 Z"
        fill="currentColor"
        stroke="currentColor"
      />
    </Svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="3" width="2" height="10" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="9.5" y="3" width="2" height="10" rx="0.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function SkipBackIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.75 3 V13" />
      <path d="M13 3 L6 8 L13 13 Z" fill="currentColor" />
    </Svg>
  );
}

export function SkipForwardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12.25 3 V13" />
      <path d="M3 3 L10 8 L3 13 Z" fill="currentColor" />
    </Svg>
  );
}

/* ────────────────────────── tools ─────────────────────────────── */

export function ScissorsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="4" cy="4" r="2" />
      <circle cx="4" cy="12" r="2" />
      <path d="M5.4 5.4 L8 8" />
      <path d="M13.3 2.7 L5.4 10.6" />
      <path d="M9.9 9.9 L13.3 13.3" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 4 H13.5" />
      <path d="M5.5 4 V2.75 Q5.5 2 6.25 2 H9.75 Q10.5 2 10.5 2.75 V4" />
      <path d="M3.75 4 L4.5 13.2 Q4.55 14 5.3 14 H10.7 Q11.45 14 11.5 13.2 L12.25 4" />
      <path d="M6.75 7 V11.5" />
      <path d="M9.25 7 V11.5" />
    </Svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="5" width="8.5" height="9" rx="1.25" />
      <path d="M5.5 5 V3.25 Q5.5 2 6.75 2 H12.25 Q13.5 2 13.5 3.25 V9.5 Q13.5 10.75 12.25 10.75 H11" />
    </Svg>
  );
}

export function ZapIcon(props: IconProps) {
  // Lightning bolt — used for "ripple delete" (destructive + fast).
  return (
    <Svg {...props}>
      <path
        d="M9 1.5 L3 9 H7 L6.5 14.5 L13 7 H9 Z"
        fill="currentColor"
        stroke="currentColor"
      />
    </Svg>
  );
}

export function CollapseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8 H7" />
      <path d="M5 6 L3 8 L5 10" />
      <path d="M13 8 H9" />
      <path d="M11 6 L13 8 L11 10" />
    </Svg>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8 H10 Q13 8 13 11 Q13 14 10 14 H6" />
      <path d="M6.5 5.5 L4 8 L6.5 10.5" />
    </Svg>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 8 H6 Q3 8 3 11 Q3 14 6 14 H10" />
      <path d="M9.5 5.5 L12 8 L9.5 10.5" />
    </Svg>
  );
}

/* ────────────────────────── tracks ────────────────────────────── */

export function ImageIcon(props: IconProps) {
  // Framed picture: rectangle + a mountain peak + a sun.
  return (
    <Svg {...props}>
      <rect x="1.5" y="3" width="13" height="10" rx="1.25" />
      <circle cx="5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <path d="M1.75 11.5 L6 7.5 L9 10 L11.5 7.75 L14.25 11" />
    </Svg>
  );
}

export function VideoIcon(props: IconProps) {
  // Camcorder: body + lens bump on the right.
  return (
    <Svg {...props}>
      <rect x="1.5" y="4.5" width="9" height="7" rx="1.25" />
      <path
        d="M10.5 6.5 L14.5 4 V12 L10.5 9.5 Z"
        fill="currentColor"
      />
    </Svg>
  );
}

export function AudioIcon(props: IconProps) {
  // Waveform: four bars of varying heights, uniform spacing.
  return (
    <Svg {...props}>
      <path d="M3 5.5 V10.5" />
      <path d="M6.5 3 V13" />
      <path d="M9.5 4.5 V11.5" />
      <path d="M13 6.5 V9.5" />
    </Svg>
  );
}

export function SubtitleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1.75" y="4" width="12.5" height="9" rx="1.5" />
      <path d="M4.75 8 H9.25" />
      <path d="M4.75 10.25 H11.25" />
    </Svg>
  );
}

/* ──────────────────────── track toggles ───────────────────────── */

export function SpeakerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M2.5 6 H4.5 L7.5 3.25 V12.75 L4.5 10 H2.5 Z"
        fill="currentColor"
        stroke="currentColor"
      />
      <path d="M10 6.25 Q11.5 8 10 9.75" />
      <path d="M12 4.5 Q14.5 8 12 11.5" />
    </Svg>
  );
}

export function MuteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M2.5 6 H4.5 L7.5 3.25 V12.75 L4.5 10 H2.5 Z"
        fill="currentColor"
        stroke="currentColor"
      />
      <path d="M10.5 6 L14 9.5" />
      <path d="M14 6 L10.5 9.5" />
    </Svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="7.5" width="10" height="6.5" rx="1.25" />
      <path d="M5.5 7.5 V5 Q5.5 2.5 8 2.5 Q10.5 2.5 10.5 5 V7.5" />
    </Svg>
  );
}

export function UnlockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="7.5" width="10" height="6.5" rx="1.25" />
      <path d="M5.5 7.5 V5 Q5.5 2.5 8 2.5 Q10.5 2.5 10.5 4.75" />
    </Svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.5 8 Q4.5 3.5 8 3.5 Q11.5 3.5 14.5 8 Q11.5 12.5 8 12.5 Q4.5 12.5 1.5 8 Z" />
      <circle cx="8" cy="8" r="1.9" />
    </Svg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.5 8 Q4.5 3.5 8 3.5 Q11.5 3.5 14.5 8 Q11.5 12.5 8 12.5 Q4.5 12.5 1.5 8 Z" />
      <circle cx="8" cy="8" r="1.9" />
      <path d="M2 2 L14 14" />
    </Svg>
  );
}

/* ────────────────────────── status ────────────────────────────── */

export function HourglassIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 2.5 H12.5" />
      <path d="M3.5 13.5 H12.5" />
      <path d="M4 2.5 Q4 6 8 8 Q12 6 12 2.5" />
      <path d="M4 13.5 Q4 10 8 8 Q12 10 12 13.5" />
    </Svg>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.25 L14 13 H2 Z" />
      <path d="M8 6 V9.75" />
      <circle cx="8" cy="11.5" r="0.55" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8.5 L6.5 12 L13 4.5" />
    </Svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 3.5 L12.5 12.5" />
      <path d="M12.5 3.5 L3.5 12.5" />
    </Svg>
  );
}

export function DotIcon(props: IconProps) {
  // Filled status dot — caller controls size + color.
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function CircleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="5.5" />
    </Svg>
  );
}

/* ──────────────────────── navigation ──────────────────────────── */

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 8 H3" />
      <path d="M6 5 L3 8 L6 11" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8 H13" />
      <path d="M10 5 L13 8 L10 11" />
    </Svg>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 13 V3" />
      <path d="M5 6 L8 3 L11 6" />
    </Svg>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3 V13" />
      <path d="M5 10 L8 13 L11 10" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 4 L10 8 L6 12" />
    </Svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 4 L6 8 L10 12" />
    </Svg>
  );
}

/* ────────────────────── 3D + camera ───────────────────────────── */

export function Layers3DIcon(props: IconProps) {
  // Three stacked parallelograms, back-to-front opacity.
  return (
    <Svg {...props}>
      <path d="M8 2 L14 5 L8 8 L2 5 Z" />
      <path d="M2 8 L8 11 L14 8" opacity="0.65" />
      <path d="M2 11 L8 14 L14 11" opacity="0.35" />
    </Svg>
  );
}

export function CameraFrontIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <circle cx="8" cy="8" r="2.25" />
    </Svg>
  );
}

export function CameraSideIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 5 L8 3 L13 5 V11 L8 13 L3 11 Z" />
      <path d="M3 5 L8 7 L13 5" />
      <path d="M8 7 V13" />
    </Svg>
  );
}

/* ────────────────────── dive / provenance ─────────────────────── */

export function UploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12 V13 Q3 14 4 14 H12 Q13 14 13 13 V12" />
      <path d="M8 10 V2" />
      <path d="M5 5 L8 2 L11 5" />
    </Svg>
  );
}

export function SparkleIcon(props: IconProps) {
  // Four-point star — used for AI-generated assets.
  return (
    <Svg {...props}>
      <path
        d="M8 2 L9 7 L14 8 L9 9 L8 14 L7 9 L2 8 L7 7 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.5 2.25 L13.75 5.5 L5.5 13.75 H2.25 V10.5 Z" />
      <path d="M9 3.75 L12.25 7" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.25 10.25 L13.75 13.75" />
    </Svg>
  );
}
