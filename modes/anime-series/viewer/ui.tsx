/**
 * Small pieces every part of the series viewer draws with: chips, buttons,
 * cards, an inline text editor, palette swatches and the hatch that marks
 * work in flight. Styled only with the `cc-*` tokens.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import type { CraftFailure } from "../../_shared/scripts/craft-project.mjs";
import type { SeriesStrings } from "./strings.js";

export type Tone = "ok" | "warn" | "err" | "gen" | "dim" | "plain" | "stale";

const TONES: Record<Tone, string> = {
  ok: "border-cc-success/40 bg-cc-success/10 text-cc-success",
  warn: "border-cc-warning/55 bg-cc-warning/15 text-cc-warning",
  err: "border-cc-error/50 bg-cc-error/10 text-cc-error",
  gen: "border-cc-primary/50 bg-cc-primary-muted text-cc-primary",
  dim: "border-cc-border text-cc-muted",
  plain: "border-cc-border text-cc-fg",
  stale: "border-[#93a4bd]/40 bg-[#93a4bd]/10 text-[#93a4bd]",
};

export function Chip({
  tone = "dim",
  pulse = false,
  title,
  className = "",
  children,
}: {
  tone?: Tone;
  pulse?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border px-[7px] text-[10.5px] leading-4 ${TONES[tone]} ${className}`}
    >
      {pulse ? <Dot pulse /> : null}
      {children}
    </span>
  );
}

export function Dot({ pulse = false, color, size = 6 }: { pulse?: boolean; color?: string; size?: number }) {
  return (
    <i
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${pulse ? "animate-pulse" : ""}`}
      style={{ width: size, height: size, background: color ?? "currentColor" }}
    />
  );
}

export function Btn({
  primary = false,
  disabled = false,
  title,
  onClick,
  className = "",
  children,
}: {
  primary?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const base =
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border px-2.5 py-[5px] text-[11.5px] leading-[1.35] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/60";
  const look = primary
    ? "border-cc-primary bg-cc-primary font-semibold text-[#1c0a00] hover:bg-cc-primary-hover"
    : "border-cc-border bg-cc-card text-cc-fg hover:bg-cc-hover";
  return (
    <button
      type="button"
      title={title}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={`${base} ${look} ${disabled ? "cursor-not-allowed opacity-45 hover:bg-cc-card" : "cursor-pointer"} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({
  className = "",
  style,
  children,
  onClick,
  selected = false,
  warn = false,
  marker,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  warn?: boolean;
  /** A `data-series-<marker>` attribute, for code that has to find this card on the page. */
  marker?: string;
}) {
  const border = selected
    ? "border-cc-primary/60 shadow-[0_0_0_3px_var(--color-cc-glow)]"
    : warn
      ? "border-cc-warning/45"
      : "border-cc-border";
  return (
    <div
      onClick={onClick}
      style={style}
      {...(marker ? { [`data-series-${marker}`]: "" } : {})}
      className={`rounded-[10px] border bg-cc-card p-2 ${border} ${onClick ? "cursor-pointer" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function Tiny({ className = "", children }: { className?: string; children: ReactNode }) {
  return <span className={`text-[10px] tracking-[.02em] text-cc-muted ${className}`}>{children}</span>;
}

/** Diagonal stripes in the primary colour: something is being made here. */
export const HATCH: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-cc-primary) 30%, transparent) 0 5px, color-mix(in srgb, var(--color-cc-primary) 7%, transparent) 5px 10px)",
  backgroundSize: "14px 14px",
  animation: "anime-series-hatch 1.2s linear infinite",
};

/** The keyframes the hatch uses; rendered once at the viewer root. */
export function ViewerKeyframes() {
  return <style>{"@keyframes anime-series-hatch { to { background-position: 14px 0; } }"}</style>;
}

/** A palette is a list of colours or an object of label → colour. */
export function paletteEntries(palette: unknown): Array<{ label: string | null; color: string }> {
  if (Array.isArray(palette)) {
    return palette.filter((c): c is string => typeof c === "string").map((color) => ({ label: null, color }));
  }
  if (palette && typeof palette === "object") {
    return Object.entries(palette as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([label, color]) => ({ label, color }));
  }
  return [];
}

export function Swatches({ palette }: { palette: unknown }) {
  const entries = paletteEntries(palette);
  if (entries.length === 0) return null;
  return (
    <span className="ml-1 inline-flex items-center gap-[3px] align-middle">
      {entries.map((e, i) => (
        <i
          key={i}
          title={e.label ? `${e.label} ${e.color}` : e.color}
          className="inline-block h-2.5 w-2.5 rounded-[3px] border border-white/15"
          style={{ background: e.color }}
        />
      ))}
    </span>
  );
}

/**
 * Text the user may change in place. Shows the value; a click turns it into
 * a textarea; blur or Enter (⌘/Ctrl+Enter when `multiline`) commits, Escape
 * restores. Commits only a changed, trimmed value.
 */
export function EditableText({
  value,
  onCommit,
  disabled = false,
  multiline = true,
  placeholder,
  title,
  className = "",
}: {
  value: string;
  onCommit: (next: string) => void;
  disabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
  title?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing || !ref.current) return;
    const el = ref.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing]);

  if (!editing || disabled) {
    return (
      <span
        title={disabled ? undefined : title}
        onClick={
          disabled
            ? undefined
            : (e) => {
                e.stopPropagation();
                setEditing(true);
              }
        }
        className={`${disabled ? "" : "cursor-text border-b border-dashed border-transparent hover:border-cc-muted"} ${className}`}
      >
        {value || <span className="text-cc-muted/70">{placeholder}</span>}
      </span>
    );
  }

  const finish = (commit: boolean) => {
    setEditing(false);
    const next = draft.trim();
    if (commit && next !== value.trim() && next.length > 0) onCommit(next);
    else setDraft(value);
  };

  return (
    <textarea
      ref={ref}
      value={draft}
      rows={1}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        setDraft(e.target.value);
        e.target.style.height = "auto";
        e.target.style.height = `${e.target.scrollHeight}px`;
      }}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        } else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          finish(true);
        }
      }}
      className={`block w-full resize-none appearance-none rounded-[6px] border border-cc-primary/50 bg-cc-input-bg px-1.5 py-1 text-cc-fg outline-none ring-2 ring-cc-primary/20 ${className}`}
    />
  );
}

/** Play / pause triangle and bars. */
export function PlayIcon({ playing = false, size = 10 }: { playing?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden>
      {playing ? (
        <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" />
      ) : (
        <path d="M2 1.5v9l8-4.5z" fill="currentColor" />
      )}
    </svg>
  );
}

export function CloseIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden>
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function LockIcon({ size = 11 }: { size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
      <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
    </svg>
  );
}

/**
 * Why a call failed, said where the failure is shown — a hover title is not
 * a place anyone reads — with what craft knows about its billing.
 */
export function FailureNote({ failure, t, className = "" }: { failure: CraftFailure | null | undefined; t: SeriesStrings; className?: string }) {
  if (!failure?.reason) return null;
  return (
    <p className={`m-0 break-words text-[10px] leading-[1.45] text-cc-error/90 ${className}`}>
      {failure.reason}
      {failure.billing === "unknown" ? <span className="text-cc-warning"> · {t.billingUnknown}</span> : null}
      {failure.billing === "none" ? <span className="text-cc-muted"> · {t.billingNone}</span> : null}
    </p>
  );
}
