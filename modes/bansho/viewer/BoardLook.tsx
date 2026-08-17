/** @jsxImportSource react */
/**
 * The board's look — one button, wearing the answer.
 *
 * ── WHY THIS IS NOT A SETTINGS MENU ─────────────────────────────────────────
 * It was one, for about an hour: a gear in the board's top-right corner
 * opening a "settings" popover. The product owner killed it on sight —
 * 「你上面一个设置下面一个设置。。。是认真的吗？」— and the objection is
 * structural, not cosmetic. The Pneuma shell already owns a gear, thirty
 * pixels straight up in the TopBar, and it means APP settings. A second gear
 * below it means "settings" too, and the only thing separating them is a
 * scope you cannot see. There is exactly one gear in this window and it
 * belongs to the shell.
 *
 * So this control is named after what it actually is. Its face is the look
 * the board is currently wearing —「绿板 · 行楷」— which makes the entry point
 * a piece of VISIBLE STATE: you can read what the board has on before you
 * decide to open anything, and the button explains itself without a label
 * that says "settings".
 *
 * ── WHAT IS INSIDE, AND WHY THOSE TWO ───────────────────────────────────────
 * Two labelled groups, split by what persists and who it affects:
 *
 *   · **This lecture** — the theme picker. It writes `{set}/theme.css`; the
 *     agent reads that file, an export carries it, and everyone who ever
 *     opens this lecture sees the result. A decision about the LECTURE, not
 *     a knob on the reader's remote — which is why it was never in the
 *     transport, and why it is filed under the lecture here.
 *   · **Your view** — parallax. The css3d brief's §5.2 depth probe: with it
 *     on, the pointer rocks the board a few degrees and real depth answers
 *     while painted-on perspective falls apart. Ephemeral, local, this
 *     reader only; nothing is written and nobody else is affected. Folding a
 *     viewing pose into a projection choice would say the two are the same
 *     kind of decision, and they are not.
 *
 * What deliberately stays OUTSIDE: the board ↔ notes switch is the
 * projection — *what you are reading*, the most common decision here — and
 * the warning chips are SIGNALS, not controls, since a degradation you have
 * to click open to discover is a silent degradation. Neither can be handed
 * to this component; it has no input for them.
 *
 * ── STACKING ────────────────────────────────────────────────────────────────
 * The panel is a plain `absolute` child of the chrome column, and that is
 * enough here BECAUSE the column already wins the parent ordering
 * (`absolute … z-30` in BanshoPreview, above the wall map's z-10). Two rules
 * this file obeys so it stays enough:
 *
 *   1. Nothing inside the panel relies on a z-index. The panel carries
 *      `backdrop-blur`, and `backdrop-filter` opens a STACKING CONTEXT — any
 *      z-index used by a descendant would be sealed inside it and could not
 *      outrank anything outside. That is the trap that ate the transport's
 *      rate menu, and the one the App Settings popover was portaled out of.
 *   2. The panel is one opaque surface, not a stack of floating cards.
 *      Measured on 2026-08-17: with the groups floating separately, the wall
 *      map showed through the gaps between them. That was never a stacking
 *      failure — it was holes in the panel, and a panel with no holes shows
 *      nothing through.
 *
 * Verified with `document.elementFromPoint` over the panel's own corners,
 * not from a screenshot: CDP composites `backdrop-filter` wrongly, so a
 * correctly-stacked panel can photograph as if it were transparent.
 */

import { useEffect, useRef } from "react";

/** Verbatim from the pre-reorg chrome — pinned in board-look.test.tsx. */
const PARALLAX_TITLE =
  "Rock the board with the pointer. Real depth answers with parallax; a board that only looks tilted does not";
const PARALLAX_TITLE_REDUCED =
  "Your system asks for reduced motion, so the board stays still — transitions keep their existing flat glide";
const TRIGGER_TITLE =
  "The board's look — paper or slate, and the hand it is written in. Writes this lecture's own theme.css";
/** Used only when no shipped preset is installed, so there is no name to show. */
const UNNAMED_LOOK = "Board look";

/** The reader's own viewing pose. Absent when there is no board to rock. */
export interface ParallaxSetting {
  active: boolean;
  /** The OS asked for reduced motion: the switch stays, and stays off. */
  reduceMotion: boolean;
  onToggle(): void;
}

export interface BoardLookProps {
  /**
   * The look this lecture is wearing, in the name it was chosen under, or
   * null for a hand-written theme (no shipped preset to name).
   */
  label: string | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  /**
   * The theme picker, already built by the board — null when there is no
   * content set to write a theme into (a lecture nobody can restyle).
   */
  themePicker: React.ReactNode;
  parallax: ParallaxSetting | null;
}

export default function BoardLook({
  label,
  open,
  onOpenChange,
  themePicker,
  parallax,
}: BoardLookProps): React.ReactElement | null {
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss on Escape or on a click anywhere else — the panel covers the
  // board, so leaving it must not require finding a close button.
  // `pointerdown` rather than `click` so a drag that starts on the board
  // (scrubbing, grabbing a step) closes the panel at the moment it begins.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onOpenChange(false);
    };
    const onDown = (e: Event): void => {
      if (rootRef.current?.contains(e.target as Node)) return;
      onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, onOpenChange]);

  // Nothing to show and nothing to change: no button. A control that opens
  // an empty panel promises something that does not exist.
  if (!themePicker && !parallax) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-bansho-look-trigger=""
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        title={TRIGGER_TITLE}
        className={[
          "flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium backdrop-blur transition-colors cursor-pointer",
          "focus-visible:ring-2 focus-visible:ring-cc-primary/60",
          open
            ? "border-cc-primary/40 bg-cc-primary/20 text-cc-primary"
            : "border-cc-border bg-cc-surface/70 text-cc-muted hover:text-cc-fg hover:bg-cc-surface",
        ].join(" ")}
      >
        {label ?? UNNAMED_LOOK}
        <svg
          viewBox="0 0 12 12"
          className={`w-2.5 h-2.5 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>

      {open ? (
        <div
          data-bansho-look-panel=""
          role="dialog"
          aria-label="The board's look"
          // ONE surface, not a stack of floating cards. Measured, 2026-08-17:
          // with the groups floating separately, the wall map (z-10, inside
          // the canvas) showed through the gaps between them — not a
          // stacking failure, just holes in the panel. A panel that is one
          // opaque thing has no holes to show anything through.
          className="absolute right-0 top-full mt-1.5 w-[436px] max-w-[86vw] flex flex-col gap-2 p-2 rounded-lg border border-cc-border bg-cc-surface/95 backdrop-blur shadow-xl text-left"
        >
          {themePicker ? (
            <Group
              name="lecture"
              label="This lecture"
              // Stated where the decision is made, not in a tooltip: this is
              // the difference between the two groups, and it is the reason
              // they are two.
              hint="Written into this lecture's own files — everyone who opens it sees this."
            >
              {themePicker}
            </Group>
          ) : null}

          {parallax ? (
            <Group
              name="view"
              label="Your view"
              hint="Only on your screen, only now — nothing is written, nobody else is affected."
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
                  "w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                  "rounded-lg border border-cc-border",
                  "focus-visible:ring-2 focus-visible:ring-cc-primary/60 focus-visible:ring-inset",
                  parallax.reduceMotion
                    ? "cursor-not-allowed"
                    : "hover:bg-cc-hover cursor-pointer",
                ].join(" ")}
              >
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span
                    className={`text-[12px] font-medium ${parallax.reduceMotion ? "text-cc-muted/60" : "text-cc-fg"}`}
                  >
                    Parallax
                  </span>
                  <span className="text-[11px] leading-snug text-cc-muted/70">
                    {parallax.reduceMotion
                      ? "Your system asks for reduced motion, so the board stays still."
                      : "Rock the board with the pointer — real depth answers, a painted-on tilt does not."}
                  </span>
                </span>
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
 * One labelled group: a heading naming the SCOPE, a line stating the
 * consequence, and the control itself — so a reader can tell whether a
 * switch changes the lecture or only their own screen WITHOUT trying it.
 *
 * The heading rides its own small surface rather than sitting bare over the
 * board (on a parchment theme, bare chrome text lands on paper roughly its
 * own colour), and it deliberately does not wrap the content in a second
 * card: the theme picker already IS one, and a card inside a card is a
 * hairline that means nothing.
 */
function Group({
  name,
  label,
  hint,
  children,
}: {
  name: string;
  label: string;
  hint: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      data-bansho-look-group={name}
      className="flex flex-col items-stretch gap-1"
    >
      <div className="px-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-cc-muted/80">
          {label}
        </div>
        <div className="mt-0.5 text-[10px] leading-snug text-cc-muted/60">
          {hint}
        </div>
      </div>
      {children}
    </section>
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
        "shrink-0 relative inline-block w-7 h-4 rounded-full transition-colors",
        muted ? "bg-cc-border" : on ? "bg-cc-primary/70" : "bg-cc-border",
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
