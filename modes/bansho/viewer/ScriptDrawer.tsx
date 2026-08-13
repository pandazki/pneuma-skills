/**
 * The 讲稿 drawer — the script as an AUTHOR'S INSTRUMENT, folded away by
 * default so the wall gets the room.
 *
 * Why a drawer and not a third segment of the projection switch. Board and
 * notes are two projections of one lecture, and picking between them is a
 * READER'S choice: which rendering of the same words am I reading. The
 * script is not a third one of those — it is what the author typed, and it
 * is read WHILE the board performs: `script-sync.ts` exists to correlate the
 * two in real time (the highlight tracks the pen). An exclusive third tab
 * would make that impossible by construction — you could never see both
 * again — so it would not be a layout tidy-up, it would delete a feature.
 * Same category line the Parallax control draws next door.
 *
 * Why it PUSHES rather than floats. Open, the drawer takes its width out of
 * the row and the board re-fits into what is left, so nothing on the wall is
 * ever hidden behind it — which is the whole point of reading the two
 * together. A floating panel would cover the left column of a 2×2 wall,
 * and would land on `backdrop-filter`'s stacking trap (frontend rules) that
 * this very mode paid for once already.
 *
 * What the fold may NOT touch: the lecture. A board has a fixed canonical
 * size (`engine/layout.ts::PANEL_WIDTH`), so opening the drawer changes the
 * viewport and nothing else — the wraps, the fold and every ink path stay
 * byte-identical. That is a MEASUREMENT, not a hope: `harness/two-width.sh`
 * run drawer-open and drawer-closed is the instrument.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { SrcSpan } from "../engine/types.js";
import { decorateScript, lineSpanOf, splitAtLine } from "./script-sync.js";

/** Open width of the pane. Fixed, so the slide has one number to animate. */
const PANE_WIDTH = 320;

/** Slide duration — one constant for the CSS and for the unmount that trails it. */
const SLIDE_MS = 200;

/**
 * The author's choice, remembered. Opening the script is a working posture,
 * not a per-page whim: an author who opens it should not have to re-open it
 * on every reload, and a reader who never touches it never sees it.
 */
export const SCRIPT_OPEN_LS_KEY = "bansho:script-open";

/** `false` unless the author explicitly opened it — including when storage throws. */
export function readScriptOpen(): boolean {
  try {
    return window.localStorage.getItem(SCRIPT_OPEN_LS_KEY) === "1";
  } catch {
    // Private mode / storage disabled — a remembered posture is a nicety,
    // and losing it must never cost the drawer itself.
    return false;
  }
}

export function writeScriptOpen(open: boolean): void {
  try {
    window.localStorage.setItem(SCRIPT_OPEN_LS_KEY, open ? "1" : "0");
  } catch {
    /* storage unavailable — the session keeps the choice in memory */
  }
}

export interface ScriptDrawerProps {
  source: string;
  /** Precise source span being performed — expanded to full lines inside. */
  activeSpan: SrcSpan | null;
  issueCount: number;
  /** OS-level motion preference, already resolved by the shell. */
  reduceMotion?: boolean;
}

export default function ScriptDrawer({
  source,
  activeSpan,
  issueCount,
  reduceMotion = false,
}: ScriptDrawerProps) {
  const [open, setOpen] = useState(readScriptOpen);
  const paneId = useId();

  // The pane is torn down when the drawer is shut, not merely clipped: its
  // line split re-renders the whole script's segments every time the pen
  // crosses a line (~15×/s during playback), and paying that for a pane
  // nobody can see is exactly the jank this component's neighbours forbid.
  // On the way shut it outlives the slide by design — an empty box sliding
  // closed reads as a bug.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (reduceMotion) {
      setMounted(false);
      return;
    }
    const timer = setTimeout(() => setMounted(false), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [open, reduceMotion]);

  const toggle = (): void => {
    setOpen((was) => {
      const next = !was;
      writeScriptOpen(next);
      return next;
    });
  };

  return (
    <div className="shrink-0 min-h-0 flex items-stretch">
      {/* The way back in. A drawer nobody can find is a deleted feature, so
          the handle is a permanent 32px spine rather than a hover target or
          a corner glyph — it costs ~2% of the row where the pane cost a
          quarter of it, and it never covers a word of the board. */}
      <button
        type="button"
        data-testid="bansho-script-toggle"
        aria-expanded={open}
        aria-controls={paneId}
        onClick={toggle}
        title={
          open
            ? "Fold the script away and give the wall the room"
            : "The lecture script — what the agent wrote. The line being performed lights up as the pen reaches it"
        }
        className={[
          "group relative w-8 shrink-0 flex flex-col items-center justify-center gap-2",
          "border border-cc-border bg-cc-surface/60 backdrop-blur cursor-pointer",
          "text-cc-muted hover:text-cc-fg hover:bg-cc-surface/80 transition-colors",
          "focus-visible:ring-2 focus-visible:ring-cc-primary/60 focus-visible:z-10",
          open ? "rounded-l-lg border-r-0" : "rounded-lg",
        ].join(" ")}
      >
        {/* Collapsed, this spine is the only place the board's issue count
            can be read — folding the pane away must not fold away the fact
            that something on the board could not be drawn. */}
        {issueCount > 0 && !open ? (
          <span
            data-testid="bansho-script-issues"
            className="absolute top-1.5 left-1/2 -translate-x-1/2 min-w-[1.1rem] px-1 py-px rounded text-[10px] font-semibold leading-tight text-center bg-cc-warning/20 text-cc-warning"
            title={`${issueCount} issue${issueCount > 1 ? "s" : ""} on the board — open the script to read them`}
          >
            {issueCount}
          </span>
        ) : null}
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="w-3 h-3 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={open ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6"} />
        </svg>
        <span
          className="text-[10px] uppercase tracking-[0.16em] font-medium select-none"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          Script
        </span>
      </button>

      {/* Outer clip animates the width; the pane inside keeps its own, so
          the script never re-wraps mid-slide. */}
      <div
        id={paneId}
        aria-hidden={!open}
        className="min-h-0 overflow-hidden"
        style={{
          width: open ? PANE_WIDTH : 0,
          transitionProperty: reduceMotion ? "none" : "width",
          transitionDuration: `${SLIDE_MS}ms`,
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {mounted ? (
          <div style={{ width: PANE_WIDTH }} className="h-full min-h-0">
            <ScriptPane
              source={source}
              activeSpan={activeSpan}
              issueCount={issueCount}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── 讲稿 pane ────────────────────────────────────────────────────────────────

interface ScriptPaneProps {
  source: string;
  activeSpan: SrcSpan | null;
  issueCount: number;
}

function ScriptPane({ source, activeSpan, issueCount }: ScriptPaneProps) {
  const activeRef = useRef<HTMLSpanElement>(null);

  // Dialect decoration depends on the source ALONE — the full-text regex
  // scan runs once per agent edit, never per reveal unit (script-sync.ts).
  const decorated = useMemo(() => decorateScript(source), [source]);

  // Value-stable line span: `activeSpan` is a fresh object per reveal unit
  // (~15×/s during playback), but the LINE it lands on changes far less
  // often — stabilizing identity by value keeps the parts memo from
  // re-splitting hundreds of segments on every unit. Render-phase ref
  // write (React's derived-state pattern, idempotent across re-renders).
  const rawLine = activeSpan ? lineSpanOf(source, activeSpan) : null;
  const lineSpanRef = useRef<SrcSpan | null>(null);
  const prevLine = lineSpanRef.current;
  if (
    rawLine === null
      ? prevLine !== null
      : !prevLine ||
        prevLine.start !== rawLine.start ||
        prevLine.end !== rawLine.end
  ) {
    lineSpanRef.current = rawLine;
  }
  const lineSpan = lineSpanRef.current;

  // Active-line split: dialect marks dimmed/tinted, active line highlighted
  // — chart blocks highlight per ROW, never as a whole (G6).
  const parts = useMemo(
    () => splitAtLine(source, decorated, lineSpan),
    [source, decorated, lineSpan],
  );

  // Keep the performed line in view.
  const activeKey = lineSpan ? `${lineSpan.start}:${lineSpan.end}` : "";
  useEffect(() => {
    if (!activeKey || !activeRef.current) return;
    activeRef.current.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  return (
    <div className="h-full min-h-0 flex flex-col rounded-lg rounded-l-none border border-cc-border bg-cc-surface/60 backdrop-blur overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-cc-border text-[11px] uppercase tracking-[0.09em] text-cc-muted">
        <span>Script</span>
        <span className="normal-case tracking-normal text-cc-muted/70">
          what the agent wrote
        </span>
        <span className="flex-1" />
        {issueCount > 0 ? (
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cc-warning/15 text-cc-warning"
            title="Blocks that could not be read, formulas that failed to render, and placements standing on each other (marked on the board) — the rest of the board plays on"
          >
            {issueCount} issue{issueCount > 1 ? "s" : ""}
          </span>
        ) : null}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-[1.85] whitespace-pre-wrap break-words text-cc-fg/90">
        {source ? (
          parts.map((part) => (
            <span
              key={part.key}
              ref={part.now ? activeRef : undefined}
              className={[
                part.cls === "m" ? "text-cc-primary" : "",
                part.cls === "blk" ? "text-cc-muted" : "",
                part.now
                  ? "bg-cc-primary/20 rounded-[3px] shadow-[0_0_0_2px_var(--color-cc-primary-muted)]"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {part.text}
            </span>
          ))
        ) : (
          <span className="text-cc-muted/70">
            The lecture script will appear here as the agent writes it.
          </span>
        )}
      </div>
    </div>
  );
}
