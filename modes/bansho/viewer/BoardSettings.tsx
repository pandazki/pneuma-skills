/** @jsxImportSource react */
/**
 * The board's settings — one gear, two groups, and the line between them.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The top-right corner used to stack four unlike things at the same weight:
 * the projection switch, a parallax toggle, a theme button and the warning
 * chips. The product owner's note was to make the layout answer the obvious
 * question —「哪些是设置，哪些是常用功能的开关」— and the axis that answers it
 * is not frequency but WHAT PERSISTS, AND WHO IT AFFECTS.
 *
 *   · **This lecture** — the theme. It writes `{set}/theme.css`; the agent
 *     reads that file, an export carries it, and everyone who ever opens
 *     this lecture sees the result. It is a decision about the LECTURE, not
 *     a knob on the reader's remote — which is why it was never in the
 *     transport, and is why it is filed under the lecture here.
 *   · **Your view** — parallax. The css3d brief's §5.2 depth probe: with it
 *     on, the pointer rocks the board a few degrees and real depth answers
 *     while painted-on perspective falls apart. Ephemeral, local, this
 *     reader only; nothing is written and nobody else is affected. Folding a
 *     viewing pose into a projection choice would say the two are the same
 *     kind of decision, and they are not.
 *
 * ── WHAT STAYED OUTSIDE, AND WHY ────────────────────────────────────────────
 * The board ↔ notes switch is the projection — *what you are reading* — and
 * the most common decision on this board; it stays in the open. The warning
 * chips (font fallback, blocked audio, a stale narration track) are SIGNALS,
 * not controls: a degradation that has to be clicked open to be discovered
 * is a silent degradation. Neither can be handed to this component — it has
 * no input for them — and `board-settings.test.tsx` asserts the panel's
 * whole inventory so nothing drifts in later.
 *
 * ── STACKING ────────────────────────────────────────────────────────────────
 * The panel is a plain `absolute` child of the chrome column, and that is
 * enough here BECAUSE the column itself already wins the parent ordering
 * (`absolute … z-30` in BanshoPreview, above the wall map's z-10). Note what
 * is deliberately NOT done: no `backdrop-blur` on any ancestor of the panel
 * inside this component — the blurred surface is the panel and the trigger
 * themselves, never a wrapper — since `backdrop-filter` opens a stacking
 * context and would seal any z-index used inside it. Same trap as the
 * transport's rate menu, and the same discipline.
 */

import { useEffect, useRef, useState } from "react";

/** Verbatim from the pre-reorg chrome — pinned in board-settings.test.tsx. */
const THEME_TITLE =
  "The board's look — paper or slate, and the hand it is written in. Writes this lecture's own theme.css";
const PARALLAX_TITLE =
  "Rock the board with the pointer. Real depth answers with parallax; a board that only looks tilted does not";
const PARALLAX_TITLE_REDUCED =
  "Your system asks for reduced motion, so the board stays still — transitions keep their existing flat glide";
const GEAR_TITLE =
  "Board settings — this lecture's look, and how you are looking at it";

/** The lecture's own look. Absent when no content set can be written to. */
export interface ThemeSetting {
  /** The shipped preset this lecture wears, or null if it wrote its own. */
  installedLabel: string | null;
  /** Whether the picker is on screen — the row reports it. */
  pickerOpen: boolean;
  onOpenPicker(): void;
}

/** The reader's own viewing pose. Absent when there is no board to rock. */
export interface ParallaxSetting {
  active: boolean;
  /** The OS asked for reduced motion: the switch stays, and stays off. */
  reduceMotion: boolean;
  onToggle(): void;
}

export interface BoardSettingsProps {
  theme: ThemeSetting | null;
  parallax: ParallaxSetting | null;
}

export default function BoardSettings({
  theme,
  parallax,
}: BoardSettingsProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss on Escape or on a click anywhere else — the panel sits over the
  // board, so leaving it must not require finding a close button. `pointerdown`
  // rather than `click` so a drag that starts on the board (scrubbing, grabbing
  // a step) closes the panel at the moment it begins.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: Event): void => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  // Nothing to set on this board: no gear. A gear that opens an empty panel
  // promises a control that does not exist.
  if (!theme && !parallax) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-bansho-settings-trigger=""
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Board settings"
        onClick={() => setOpen((v) => !v)}
        className={[
          "grid place-items-center w-[26px] h-[26px] rounded-md border backdrop-blur transition-colors cursor-pointer",
          "focus-visible:ring-2 focus-visible:ring-cc-primary/60",
          open
            ? "border-cc-primary/40 bg-cc-primary/20 text-cc-primary"
            : "border-cc-border bg-cc-surface/70 text-cc-muted hover:text-cc-fg hover:bg-cc-surface",
        ].join(" ")}
        title={GEAR_TITLE}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-[13px] h-[13px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open ? (
        <div
          data-bansho-settings-panel=""
          role="dialog"
          aria-label="Board settings"
          className="absolute right-0 top-full mt-1.5 w-[248px] rounded-lg border border-cc-border bg-cc-surface/95 backdrop-blur shadow-xl overflow-hidden text-left"
        >
          {theme ? (
            <Group
              name="lecture"
              label="This lecture"
              hint="Written into this lecture's own files — everyone who opens it sees this."
            >
              <button
                type="button"
                data-bansho-setting="theme"
                aria-expanded={theme.pickerOpen}
                onClick={() => {
                  setOpen(false);
                  theme.onOpenPicker();
                }}
                title={THEME_TITLE}
                className={[
                  "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer",
                  "focus-visible:ring-2 focus-visible:ring-cc-primary/60",
                  theme.pickerOpen
                    ? "bg-cc-primary/20 text-cc-primary"
                    : "text-cc-fg hover:bg-cc-surface",
                ].join(" ")}
              >
                <span>Theme</span>
                <span className="flex items-center gap-1 text-cc-muted">
                  {theme.installedLabel ? (
                    <span className="opacity-80">{theme.installedLabel}</span>
                  ) : null}
                  <svg
                    viewBox="0 0 12 12"
                    className="w-2.5 h-2.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4.5 2.5 8 6l-3.5 3.5" />
                  </svg>
                </span>
              </button>
            </Group>
          ) : null}

          {parallax ? (
            <Group
              name="view"
              label="Your view"
              hint="Only on your screen, only now — nothing is written, nobody else is affected."
              divided={!!theme}
            >
              <button
                type="button"
                data-bansho-setting="parallax"
                aria-pressed={parallax.active}
                disabled={parallax.reduceMotion}
                onClick={parallax.onToggle}
                title={
                  parallax.reduceMotion
                    ? PARALLAX_TITLE_REDUCED
                    : PARALLAX_TITLE
                }
                className={[
                  "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-cc-primary/60",
                  parallax.reduceMotion
                    ? "text-cc-muted/60 cursor-not-allowed"
                    : "text-cc-fg hover:bg-cc-surface cursor-pointer",
                ].join(" ")}
              >
                <span>Parallax</span>
                <Switch on={parallax.active} muted={parallax.reduceMotion} />
              </button>
            </Group>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One labelled group. The label names the SCOPE of everything inside it, and
 * the hint states the consequence — which is the whole reorganisation: a
 * reader should be able to tell, without trying it, whether a switch changes
 * the lecture or only their own screen.
 */
function Group({
  name,
  label,
  hint,
  divided = false,
  children,
}: {
  name: string;
  label: string;
  hint: string;
  divided?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      data-bansho-settings-group={name}
      className={`px-2 py-2 ${divided ? "border-t border-cc-border" : ""}`}
    >
      <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-cc-muted/70">
        {label}
      </div>
      {children}
      <div className="px-1 pt-1 text-[10px] leading-snug text-cc-muted/60">
        {hint}
      </div>
    </div>
  );
}

/** The on/off face of a switch. Presentational — the button carries state. */
function Switch({
  on,
  muted,
}: {
  on: boolean;
  muted: boolean;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={[
        "relative inline-block w-7 h-4 rounded-full transition-colors",
        muted
          ? "bg-cc-border"
          : on
            ? "bg-cc-primary/70"
            : "bg-cc-border",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-0.5 w-3 h-3 rounded-full transition-all",
          muted ? "bg-cc-muted/50" : "bg-cc-fg",
          on ? "left-[14px]" : "left-0.5",
        ].join(" ")}
      />
    </span>
  );
}
