/**
 * Small pieces the sticker viewer is built from: icons, chips, buttons,
 * a segmented control, the chat plate and token-styled text fields.
 *
 * Chrome uses the `cc-*` tokens only. The two chat plates (#EDEDED and
 * #111111) are CONTENT — the backgrounds the stickers are judged on — and
 * appear only inside the content area (`Plate`).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { StickerStatus } from "../domain.js";
import { PLATE_COLORS, type Plate as PlateKind } from "./view-model.js";

// ── Icons (single stroke, currentColor) ────────────────────────────────────

function Svg({ children, size = 14, className }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  Sticker: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M14 20.5H6a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 6 3.5h12A2.5 2.5 0 0 1 20.5 6v8z" />
      <path d="M14 20.5V17a3 3 0 0 1 3-3h3.5" />
      <path d="M8.5 12.5a3.5 3.5 0 0 0 5 0" />
      <path d="M9 8.5h.01M15 8.5h.01" />
    </Svg>
  ),
  Grid: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Svg>
  ),
  Chat: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M20.5 12a8 8 0 0 1-11.6 7.1L3.5 20.5l1.4-4.9A8 8 0 1 1 20.5 12z" />
    </Svg>
  ),
  Checklist: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M10 6.5h10M10 12h10M10 17.5h10" />
      <path d="M3.5 6.5l1.5 1.5 2.5-3M3.5 12l1.5 1.5 2.5-3M3.5 17.5l1.5 1.5 2.5-3" />
    </Svg>
  ),
  Sun: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
    </Svg>
  ),
  Moon: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </Svg>
  ),
  Close: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  ),
  Play: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M7 4.5v15l12-7.5z" />
    </Svg>
  ),
  Replay: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 3.5v4.5H8" />
    </Svg>
  ),
  Check: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Svg>
  ),
  Alert: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M12 3.5l9.5 16.5h-19z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </Svg>
  ),
  Cross: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </Svg>
  ),
  Spark: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z" />
    </Svg>
  ),
  Download: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M12 4v11M7 10.5l5 5 5-5M4.5 19.5h15" />
    </Svg>
  ),
  Link: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10" />
    </Svg>
  ),
  Lock: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </Svg>
  ),
  Send: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M20.5 3.5L10 14M20.5 3.5l-6.5 17-4-6.5-6.5-4z" />
    </Svg>
  ),
  Smile: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
    </Svg>
  ),
  Plus: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </Svg>
  ),
  Mic: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3" />
    </Svg>
  ),
  Back: (p: { size?: number; className?: string }) => (
    <Svg {...p}>
      <path d="M15 5l-7 7 7 7" />
    </Svg>
  ),
};

// ── Status ─────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<StickerStatus | "unknown", string> = {
  ready: "border-cc-success/30 bg-cc-success/10 text-cc-success",
  pick: "border-cc-primary/40 bg-cc-primary/12 text-cc-primary",
  stale: "border-cc-warning/40 bg-cc-warning/10 text-cc-warning",
  generating: "border-cc-primary/40 bg-cc-primary/10 text-cc-primary",
  failed: "border-cc-error/40 bg-cc-error/10 text-cc-error",
  empty: "border-dashed border-cc-border bg-cc-surface/60 text-cc-muted",
  unknown: "border-cc-border bg-cc-surface/60 text-cc-muted",
};

export function StatusChip({ status, children, title }: { status: StickerStatus | "unknown"; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-[1px] text-[10.5px] font-medium leading-[16px] backdrop-blur ${STATUS_TONE[status]}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${status === "generating" ? "motion-safe:animate-pulse" : ""} ${status === "empty" ? "opacity-50" : ""}`}
      />
      <span className="truncate">{children}</span>
    </span>
  );
}

export type Tone = "neutral" | "success" | "warning" | "error" | "primary";

const TONE: Record<Tone, string> = {
  neutral: "border-cc-border bg-cc-surface/70 text-cc-muted",
  success: "border-cc-success/30 bg-cc-success/10 text-cc-success",
  warning: "border-cc-warning/35 bg-cc-warning/10 text-cc-warning",
  error: "border-cc-error/35 bg-cc-error/10 text-cc-error",
  primary: "border-cc-primary/40 bg-cc-primary/10 text-cc-primary",
};

export function Chip({ tone = "neutral", children, title, mono }: { tone?: Tone; children: ReactNode; title?: string; mono?: boolean }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-[1px] text-[10.5px] leading-[16px] ${mono ? "font-mono" : ""} ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

// ── Controls ───────────────────────────────────────────────────────────────

export function Btn({
  children,
  onClick,
  primary,
  disabled,
  title,
  small,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
  small?: boolean;
} & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      {...rest}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border font-medium transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 disabled:cursor-not-allowed disabled:opacity-40 ${
        small ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-[12px]"
      } ${
        primary
          ? "border-cc-primary/60 bg-cc-primary/90 text-white shadow-[0_0_18px_var(--color-cc-glow)] hover:bg-cc-primary"
          : "border-cc-border bg-cc-surface/70 text-cc-fg hover:border-cc-primary/40 hover:bg-cc-hover"
      }`}
    >
      {children}
    </button>
  );
}

export function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:ring-2 focus-visible:ring-cc-primary/60"
    >
      {children}
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

/** A row of mutually exclusive buttons (no native radio chrome). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  dataName,
}: {
  value: T | null;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  label: string;
  dataName?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex shrink-0 items-center gap-0.5 rounded-[10px] border border-cc-border bg-cc-bg/60 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            data-segment={dataName ? `${dataName}:${o.value}` : undefined}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
              on ? "bg-cc-surface text-cc-fg shadow-[inset_0_0_0_1px_var(--color-cc-border)]" : "text-cc-muted hover:text-cc-fg"
            }`}
          >
            {o.icon ? <span className={on ? "text-cc-primary" : ""}>{o.icon}</span> : null}
            {o.label}
            {o.badge}
          </button>
        );
      })}
    </div>
  );
}

// ── Layout bits ────────────────────────────────────────────────────────────

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <h3 className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-cc-muted">{children}</h3>
      {aside ? <div className="ml-auto flex items-center gap-1.5">{aside}</div> : null}
    </div>
  );
}

/** A chat background: the content plate the stickers are judged on. */
export function Plate({
  plate,
  className = "",
  children,
  style,
  checker,
}: {
  plate: PlateKind;
  className?: string;
  children?: ReactNode;
  style?: React.CSSProperties;
  /** A faint grid on the plate, for a file whose transparent margins should read. */
  checker?: boolean;
}) {
  const grid =
    plate === "light"
      ? "linear-gradient(45deg, rgba(0,0,0,0.035) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.035) 75%), linear-gradient(45deg, rgba(0,0,0,0.035) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.035) 75%)"
      : "linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.03) 75%), linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.03) 75%)";
  return (
    <div
      data-plate={plate}
      className={className}
      style={{
        backgroundColor: PLATE_COLORS[plate],
        ...(checker ? { backgroundImage: grid, backgroundSize: "12px 12px", backgroundPosition: "0 0, 6px 6px" } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Text on a plate: dark ink on the light plate, light ink on the dark one. */
export function plateInk(plate: PlateKind, strength: "strong" | "soft" = "soft"): string {
  if (plate === "light") return strength === "strong" ? "#3f3f46" : "#71717a";
  return strength === "strong" ? "#d4d4d8" : "#8a8a93";
}

// ── Text fields ────────────────────────────────────────────────────────────

const FIELD =
  "w-full appearance-none rounded-lg border border-cc-border bg-cc-input-bg px-2.5 py-1.5 text-[12.5px] text-cc-fg placeholder:text-cc-muted/60 transition-colors focus:border-cc-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/25";

/**
 * A field that keeps its own draft and commits on blur or Enter (Escape
 * cancels: the draft is dropped and nothing is written), so typing does not
 * write pack.json once per keystroke. A new value from the file replaces
 * the draft unless the field is being edited.
 */
export function DraftField({
  value,
  onCommit,
  multiline,
  placeholder,
  label,
  dataField,
  maxLength,
  className = "",
}: {
  value: string;
  onCommit: (next: string) => void;
  multiline?: boolean;
  placeholder?: string;
  label: string;
  dataField?: string;
  maxLength?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  // Set by Escape for the blur it causes: that blur's handler still holds
  // the typed draft, and must not save it.
  const cancelled = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  const commit = () => {
    editing.current = false;
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft !== value) onCommit(draft);
  };
  const cancel = (el: HTMLInputElement | HTMLTextAreaElement) => {
    cancelled.current = true;
    editing.current = false;
    setDraft(value);
    el.blur();
  };
  const common = {
    "aria-label": label,
    "data-field": dataField,
    value: draft,
    placeholder,
    maxLength,
    onFocus: () => {
      editing.current = true;
      cancelled.current = false;
    },
    onBlur: commit,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
  };
  if (multiline) {
    return (
      <textarea
        {...common}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel(e.currentTarget);
          else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
        }}
        className={`${FIELD} resize-none leading-[1.5] ${className}`}
      />
    );
  }
  return (
    <input
      {...common}
      type="text"
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") cancel(e.currentTarget);
      }}
      className={`${FIELD} ${className}`}
    />
  );
}

/** Read-only stand-in for a field when the viewer cannot write. */
export function ReadField({ value, empty, multiline }: { value: string; empty: string; multiline?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-transparent bg-cc-surface/40 px-2.5 py-1.5 text-[12.5px] ${value ? "text-cc-fg" : "italic text-cc-muted"} ${multiline ? "leading-[1.5]" : "truncate"}`}
    >
      {value || empty}
    </div>
  );
}

// ── Formatting ─────────────────────────────────────────────────────────────

export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "?";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1000) return `${Math.round(n / 1000)} KB`;
  return `${n} B`;
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2).replace(/\.?0+$/, "")} s`;
}
