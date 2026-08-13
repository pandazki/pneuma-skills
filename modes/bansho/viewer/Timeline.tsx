/**
 * Timeline (T4) — the scrub transport: play/pause, a canonical-seconds
 * track with per-step ticks and section marks, the Live button (R7) and
 * the rate ladder (rate scales the clock only — the track is ALWAYS
 * canonical, so tick positions never move when the rate changes).
 *
 * The rate control is a MENU. It was a cycle button while the ladder had
 * four rungs; at eight (0.75 … 16) a forward-only cycle stops being a
 * control — reaching 16 to skim a wall would cost seven clicks, and one
 * more falls off the end back to 0.75. A menu is one click open and one
 * click to any rung, in either direction, which is the actual gesture:
 * jump out to judge the whole thing, jump back to study one stroke. The
 * button face keeps saying the current rate, and its `aria-label` keeps
 * carrying the value.
 *
 * Continuous updates (fill width, playhead x, clock text) write the DOM
 * directly through the player's frame subscription — no React render per
 * frame (hot-path discipline). The component is memoized: both props are
 * identity-stable during playback (`timeline` per compile, `player` per
 * discrete transport transition), so the shell's ~15/s 讲稿-highlight
 * renders skip the transport entirely, and the frame subscription is
 * re-established only when the player handle actually changes.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";

import type { BoardTimeline } from "../engine/types.js";
import { NARRATION_MAX_RATE } from "./clock-gate.js";
import { RATES, type Rate } from "./player-core.js";
import type { BoardPlayerHandle } from "./useBoardPlayer.js";

export interface TimelineProps {
  timeline: BoardTimeline | null;
  player: BoardPlayerHandle;
  /**
   * Whether this board has a recorded voice. Only then does the menu note
   * which rungs the voice steps aside at — on a silent board the note
   * would be true of every rate and mean nothing — and only then is there
   * a voice to silence.
   */
  narrated?: boolean;
  /** The listener's current silence (`viewer/voice-output.ts`). */
  muted?: boolean;
  /**
   * Flip it. Deliberately NOT on the player handle: mute is not a
   * transport transition — it changes no state the clock reads, which is
   * the whole point (a muted lecture is the same lecture). Omitted by a
   * host that owns no voice output, and then no button is drawn.
   */
  onToggleMute?: () => void;
}

/** Fastest first: in a list that opens upward, "up" reads as "faster". */
const RATE_MENU = [...RATES].reverse();

interface TickMark {
  /** Position as a fraction of canonical duration. */
  at: number;
  /** Section boundaries render stronger. */
  strong: boolean;
}

const ICON_PLAY = "M4 2.5v11l9-5.5z";
const ICON_PAUSE = "M4 2.5h3v11H4zM9 2.5h3v11H9z";
const ICON_REPLAY =
  "M8 3.2V.6L4.2 3.9 8 7.2V4.7a3.9 3.9 0 1 1-3.9 3.9H2.6A5.4 5.4 0 1 0 8 3.2z";

/** The speaker cone — the filled half of both voice glyphs. */
const ICON_SPEAKER_BODY = "M1.5 6h2.6L7.8 2.9v10.2L4.1 10H1.5z";
/** Sound coming out: two arcs, stroked (see the `<svg>` below). */
const ICON_SPEAKER_WAVES =
  "M10 5.9a3 3 0 0 1 0 4.2M12.2 3.9a6 6 0 0 1 0 8.2";
/** Silence: the cross that replaces the waves — a different SHAPE, not a tint. */
const ICON_SPEAKER_CROSS = "M10.4 6.2l4 3.6M14.4 6.2l-4 3.6";

function Timeline({
  timeline,
  player,
  narrated = false,
  muted = false,
  onToggleMute,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const draggingRef = useRef(false);
  const rateBoxRef = useRef<HTMLDivElement>(null);
  const rateTriggerRef = useRef<HTMLButtonElement>(null);
  const rateMenuRef = useRef<HTMLDivElement>(null);
  const [rateOpen, setRateOpen] = useState(false);

  const { ui } = player;
  const duration = timeline?.duration ?? 0;

  // Step ticks: one per step's FIRST unit; section headings mark strong.
  const ticks = useMemo<TickMark[]>(() => {
    if (!timeline || timeline.duration <= 0) return [];
    const out: TickMark[] = [];
    let lastStepKey = "";
    for (const entry of timeline.schedule) {
      const key = `${entry.step.section}:${entry.step.step}`;
      if (key === lastStepKey) continue;
      lastStepKey = key;
      out.push({
        at: entry.start / timeline.duration,
        strong: entry.step.step === -1, // a section heading opens here
      });
    }
    return out;
  }, [timeline]);

  // Whether the playhead sits at the end — a DISCRETE state derived from
  // the continuous one, kept in React state so the play/replay icon reacts
  // to a paused scrub-to-the-end (same-value setState bails, so the per-
  // frame call never renders).
  const [atEnd, setAtEnd] = useState(false);

  // Continuous transport state — direct DOM writes per frame.
  useEffect(() => {
    return player.onFrame((t, total) => {
      const pct = total > 0 ? Math.min(t / total, 1) * 100 : 0;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (headRef.current) headRef.current.style.left = `${pct}%`;
      if (clockRef.current) {
        clockRef.current.textContent = `${t.toFixed(1)}s / ${total.toFixed(1)}s`;
      }
      // The slider's value lives outside React state (hot path) — mirror
      // it for assistive tech alongside the visual writes, with a spoken
      // form (aria-valuetext) so the raw number is not the only surface.
      if (trackRef.current) {
        trackRef.current.setAttribute("aria-valuenow", t.toFixed(1));
        trackRef.current.setAttribute(
          "aria-valuetext",
          `${t.toFixed(1)} of ${total.toFixed(1)} seconds`,
        );
      }
      setAtEnd(total > 0 && t >= total - 1e-3);
    });
  }, [player]);

  // Opening the menu moves focus onto the rung that is CURRENTLY set, so
  // the keyboard reader starts where the mouse reader's eye already is and
  // one arrow press is one rung.
  useEffect(() => {
    if (!rateOpen) return;
    const menu = rateMenuRef.current;
    const items = rateItems();
    if (!menu || items.length === 0) return;
    const active = items.find(
      (item) => item.getAttribute("aria-checked") === "true",
    );
    (active ?? items[0]!).focus();
  }, [rateOpen]);

  // A press anywhere else closes it — the ordinary popover contract. Bound
  // only while open, so a closed transport listens to nothing.
  useEffect(() => {
    if (!rateOpen) return;
    const onDown = (e: Event): void => {
      const box = rateBoxRef.current;
      if (box && e.target instanceof Node && box.contains(e.target)) return;
      setRateOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [rateOpen]);

  function rateItems(): HTMLButtonElement[] {
    const menu = rateMenuRef.current;
    if (!menu) return [];
    return [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
  }

  /** Roving focus inside the open menu; `to` is an index or a step. */
  const focusRate = (to: number | "first" | "last" | "prev" | "next"): void => {
    const items = rateItems();
    if (items.length === 0) return;
    const here = items.findIndex((item) => item === document.activeElement);
    const index =
      to === "first"
        ? 0
        : to === "last"
          ? items.length - 1
          : to === "prev"
            ? Math.max(0, here - 1)
            : to === "next"
              ? Math.min(items.length - 1, here < 0 ? 0 : here + 1)
              : to;
    items[index]?.focus();
  };

  const closeRateMenu = (refocus: boolean): void => {
    setRateOpen(false);
    if (refocus) rateTriggerRef.current?.focus();
  };

  const chooseRate = (rate: Rate): void => {
    player.setRate(rate);
    closeRateMenu(true);
  };

  const seekFromPointer = (clientX: number): void => {
    const track = trackRef.current;
    if (!track || duration <= 0) return;
    // G8-J exemption (named in stage-measure.test.ts): the track lives in
    // the transport bar OUTSIDE the stage — this rect is never transformed.
    const rect = track.getBoundingClientRect();
    const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    player.scrubTo(frac * duration);
  };

  // An empty board has nothing to pause: `createPlayer` starts `playing:
  // true` so the broadcast autoplays when content lands, but the transport
  // must not claim playback is happening at 0.0s/0.0s — it waits with an
  // inert Play until there is a timeline.
  const empty = duration <= 0;
  const ended = !ui.playing && atEnd;
  const icon = empty || !ui.playing ? (ended ? ICON_REPLAY : ICON_PLAY) : ICON_PAUSE;

  return (
    // `relative z-30` is load-bearing for the rate menu, not decoration:
    // this bar's own `backdrop-blur` opens a STACKING CONTEXT, so the
    // popover's z-index is sealed inside it and the wall map (z-10, in the
    // board area above) painted straight over the menu. The bar has to win
    // the stacking order at the parent level. It never overlaps the board's
    // rect, so nothing else changes.
    <div className="relative z-30 flex items-center gap-3 px-4 py-2.5 bg-cc-surface/80 backdrop-blur border-t border-cc-border">
      <button
        type="button"
        aria-label={empty || !ui.playing ? (ended ? "Replay" : "Play") : "Pause"}
        disabled={empty}
        onClick={() => player.togglePlay()}
        className="w-9 h-9 grid place-items-center rounded-lg text-cc-fg hover:text-cc-primary hover:bg-cc-primary/10 transition-colors cursor-pointer disabled:text-cc-muted/40 disabled:hover:bg-transparent disabled:hover:text-cc-muted/40 disabled:cursor-default"
      >
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current">
          <path d={icon} />
        </svg>
      </button>

      <div
        ref={trackRef}
        role="slider"
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 10) / 10}
        tabIndex={0}
        // Ring, not outline: the app resets `*:focus { outline: none }` in
        // un-layered CSS, which beats any @layer utilities outline — the
        // box-shadow ring is the only focus affordance that survives it.
        className="relative flex-1 h-9 cursor-pointer touch-none select-none rounded-md focus-visible:ring-2 focus-visible:ring-cc-primary/70"
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) seekFromPointer(e.clientX);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        // A cancelled pointer (touch gesture takeover, lost capture) never
        // delivers pointerup — without these the drag flag stays latched
        // and a later buttonless pointermove scrubs (the same missed-
        // release class the old scroll latch handled explicitly).
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
        onLostPointerCapture={() => {
          draggingRef.current = false;
        }}
        onKeyDown={(e) => {
          // Same guard as the Play button's `disabled`: on an EMPTY board a
          // key scrub would reach scrubTo(0), detach + pause the player,
          // and the first appended block would then sit frozen at t=0
          // instead of autoplaying the broadcast.
          if (empty) return;
          const step = e.shiftKey ? 1 : 0.2;
          if (e.key === "ArrowRight") {
            player.scrubTo(Math.min(duration, player.getT() + step));
            e.preventDefault();
          } else if (e.key === "ArrowLeft") {
            player.scrubTo(Math.max(0, player.getT() - step));
            e.preventDefault();
          } else if (e.key === "Home") {
            player.scrubTo(0);
            e.preventDefault();
          } else if (e.key === "End") {
            player.scrubTo(duration);
            e.preventDefault();
          }
        }}
      >
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[5px] rounded-full bg-cc-border overflow-hidden">
          <div
            ref={fillRef}
            className="absolute inset-y-0 left-0 bg-cc-primary"
            style={{ width: "0%" }}
          />
        </div>
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[15px] pointer-events-none">
          {ticks.map((tick, i) => (
            <i
              key={i}
              className={
                tick.strong
                  ? "absolute top-0 h-full w-[2px] bg-cc-primary/80"
                  : "absolute top-0 h-full w-px bg-cc-muted/35"
              }
              style={{ left: `${tick.at * 100}%` }}
            />
          ))}
        </div>
        <div
          ref={headRef}
          className="absolute top-1/2 w-[13px] h-[13px] -mt-[6.5px] -ml-[6.5px] rounded-full bg-cc-primary shadow-[0_0_0_3px_var(--color-cc-surface)] pointer-events-none"
          style={{ left: "0%" }}
        />
      </div>

      {/* The voice switch, next to the rate control and wearing the same
          pill so the two read as one family: this pair is "how the lecture
          is delivered to me", as against the transport verbs on the left.
          Drawn only when there is a voice AND a host able to silence it —
          a lecture with no narration must not grow a dead control. */}
      {narrated && onToggleMute ? (
        <button
          type="button"
          data-voice-toggle=""
          // A glyph is invisible to a screen reader, so the state is
          // announced twice over: `aria-pressed` for the toggle's own
          // semantics, and a label that says which way pressing it goes.
          aria-pressed={muted}
          aria-label={muted ? "Unmute the narration" : "Mute the narration"}
          title={
            muted
              ? "The recorded voice is silenced — pacing is unchanged, so the board still waits for a long clip exactly as it does with sound on"
              : "Silence the recorded voice. Only the sound: the pacing, the schedule and where the pen is are untouched"
          }
          onClick={onToggleMute}
          className={
            (muted
              ? "text-cc-primary bg-cc-primary/10 "
              : "text-cc-muted hover:text-cc-primary hover:bg-cc-primary/10 ") +
            "w-8 h-8 grid place-items-center rounded-md transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-cc-primary/70"
          }
        >
          <svg viewBox="0 0 16 16" className="w-4 h-4" aria-hidden="true">
            <path d={ICON_SPEAKER_BODY} className="fill-current" />
            <path
              d={muted ? ICON_SPEAKER_CROSS : ICON_SPEAKER_WAVES}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}

      <div ref={rateBoxRef} className="relative">
        <button
          ref={rateTriggerRef}
          type="button"
          // The label must carry the value: a bare "Playback rate" overrides
          // the visible text and a screen reader can never tell what rate is
          // active or that choosing from the menu changed it.
          aria-label={`Playback rate, currently ${ui.rate} times`}
          aria-haspopup="menu"
          aria-expanded={rateOpen}
          onClick={() => setRateOpen((open) => !open)}
          onKeyDown={(e) => {
            // The menu-button pattern: either arrow opens, and the open
            // effect then puts focus on the rung that is set.
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              setRateOpen(true);
              e.preventDefault();
            } else if (e.key === "Escape" && rateOpen) {
              closeRateMenu(false);
              e.preventDefault();
            }
          }}
          className={
            rateOpen
              ? "min-w-[52px] px-2 py-1 rounded-md text-xs font-medium text-cc-primary bg-cc-primary/10 transition-colors cursor-pointer tabular-nums focus-visible:ring-2 focus-visible:ring-cc-primary/70"
              : "min-w-[52px] px-2 py-1 rounded-md text-xs font-medium text-cc-muted hover:text-cc-primary hover:bg-cc-primary/10 transition-colors cursor-pointer tabular-nums focus-visible:ring-2 focus-visible:ring-cc-primary/70"
          }
        >
          {`${ui.rate}×`}
        </button>
        {rateOpen ? (
          // Opens UPWARD: the transport is the bottom edge of the viewer.
          <div
            ref={rateMenuRef}
            role="menu"
            aria-label="Playback rate"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") focusRate("next");
              else if (e.key === "ArrowUp") focusRate("prev");
              else if (e.key === "Home") focusRate("first");
              else if (e.key === "End") focusRate("last");
              else if (e.key === "Escape") closeRateMenu(true);
              else if (e.key === "Tab") return; // let focus leave naturally
              else return;
              e.preventDefault();
            }}
            onBlur={(e) => {
              // Tabbing (or clicking) out of the menu closes it without
              // stealing focus back from wherever the reader went.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setRateOpen(false);
              }
            }}
            // Darker than the bar it rises from (the wall map can sit
            // behind it, and a list of values has to stay readable over
            // whatever the board is showing) — the same glass treatment
            // the map's own panel wears.
            className="absolute bottom-full right-0 mb-2 z-20 min-w-[132px] py-1 rounded-lg bg-cc-bg/95 backdrop-blur-md border border-cc-border shadow-lg shadow-black/40"
          >
            {RATE_MENU.map((rate) => {
              const active = rate === ui.rate;
              const silent = narrated && rate > NARRATION_MAX_RATE;
              return (
                <button
                  key={rate}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  aria-label={`${rate} times${silent ? ", narration silent" : ""}`}
                  data-rate={rate}
                  tabIndex={-1}
                  onClick={() => chooseRate(rate)}
                  className={
                    (active
                      ? "text-cc-primary bg-cc-primary/10 "
                      : "text-cc-fg hover:text-cc-primary hover:bg-cc-primary/10 ") +
                    "w-full flex items-baseline gap-2 px-3 py-1.5 text-xs font-medium text-left transition-colors cursor-pointer tabular-nums focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cc-primary/70"
                  }
                >
                  <span className="min-w-[34px]">{`${rate}×`}</span>
                  {silent ? (
                    // Said before the rung is chosen, not after: past this
                    // rate the recorded voice steps aside (clock-gate rule
                    // 6) and the board runs silent at exactly the speed
                    // asked for.
                    <span className="text-[10px] font-normal text-cc-muted">
                      silent
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => player.goLive()}
        aria-label="Back to live"
        className={
          ui.follow === "live"
            ? "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-cc-primary bg-cc-primary/15 cursor-default"
            : "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-cc-muted hover:text-cc-primary hover:bg-cc-primary/10 transition-colors cursor-pointer"
        }
      >
        <span
          className={
            ui.follow === "live"
              ? "w-1.5 h-1.5 rounded-full bg-cc-primary animate-pulse"
              : "w-1.5 h-1.5 rounded-full bg-cc-muted/50"
          }
        />
        LIVE
      </button>

      <span
        ref={clockRef}
        className="min-w-[96px] text-right text-xs text-cc-muted tabular-nums"
      >
        0.0s / 0.0s
      </span>
    </div>
  );
}

export default memo(Timeline);
