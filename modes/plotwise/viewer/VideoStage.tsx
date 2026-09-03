/**
 * Clip player, galgame rules:
 *
 * - A segment AUTOPLAYS the moment it is on stage (segment switches are
 *   user clicks, so sound is allowed; a blocked cold-load autoplay gets
 *   the full-picture start overlay).
 * - NO flash between segments, by construction: two stacked <video>
 *   elements double-buffer the stage; the visible element never changes
 *   src, and likely next clips (`preloadSrcs`) warm the cache.
 * - ONE soundtrack, by construction: the moment a switch starts, the
 *   outgoing layer is paused (its last frame stays up as the cut), and
 *   once the incoming clip plays, the outgoing layer is emptied. Only the
 *   layer on stage ever holds a source, so no retry, toggle or late
 *   promise can put a second clip on the air. The first live course
 *   played the same clip on both layers a few seconds apart — an echo —
 *   after a retry landed on the layer that had just been swapped out.
 * - Chrome is hover-only: the transport bar keeps its reserved space but
 *   stays invisible until the pointer is over the stage.
 */

import { useEffect, useRef, useState } from "react";

function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** `currentSrc` resolves asynchronously after `src` is set; read both. */
function holdsSource(v: HTMLVideoElement): boolean {
  return !!(v.currentSrc || v.getAttribute("src"));
}

function holds(v: HTMLVideoElement, src: string): boolean {
  return v.getAttribute("src") === src || (!!v.currentSrc && v.currentSrc.endsWith(src));
}

/** Drop the layer's media: a layer without a source cannot sound. */
function release(v: HTMLVideoElement) {
  v.pause();
  v.removeAttribute("src");
  v.load();
}

export default function VideoStage({
  src,
  preloadSrcs = [],
  onEnded,
  onTime,
  onFailed,
}: {
  src: string;
  preloadSrcs?: string[];
  onEnded?: () => void;
  /** Playback position of the clip on stage, in seconds, as it advances. */
  onTime?: (seconds: number) => void;
  /** The clip on stage failed to play and the one automatic retry did not help. */
  onFailed?: () => void;
}) {
  const vRefs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const loadTokenRef = useRef(0);
  // The layer on stage was paused for a cut whose clip is still loading.
  const cutRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [progress, setProgress] = useState(0);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const cur = vRefs[activeRef.current].current;
    if (!cur) return;
    const token = ++loadTokenRef.current;

    if (!holdsSource(cur)) {
      cur.src = src;
      cur.play().then(
        () => token === loadTokenRef.current && setBlocked(false),
        () => token === loadTokenRef.current && setBlocked(true),
      );
      return;
    }
    if (holds(cur, src)) {
      // Back to the clip on stage before its replacement arrived: the
      // replacement's promise sees a stale token and stands down; the
      // stage picks up where the cut froze it.
      if (cutRef.current) {
        cutRef.current = false;
        void cur.play();
      }
      return;
    }

    const idleIdx = 1 - activeRef.current;
    const idle = vRefs[idleIdx].current;
    if (!idle) return;
    // The cut: the outgoing picture freezes on its last frame while the
    // next clip loads. Pausing it now, not once the next clip plays, is
    // what keeps two soundtracks from overlapping on a slow load.
    cur.pause();
    cutRef.current = true;
    idle.src = src;
    const takeStage = () => {
      cutRef.current = false;
      activeRef.current = idleIdx;
      setActive(idleIdx);
      setProgress(0);
      setTime(0);
      setDuration(idle.duration || 0);
      release(cur);
    };
    idle.play().then(
      () => {
        if (token !== loadTokenRef.current) {
          idle.pause();
          return;
        }
        takeStage();
        setBlocked(false);
        setPlaying(!idle.paused);
      },
      () => {
        if (token !== loadTokenRef.current) return;
        // The requested clip is on the idle layer and refused to start.
        // It takes the stage anyway, so the start overlay plays THIS
        // clip rather than the one it replaced.
        takeStage();
        setPlaying(false);
        setBlocked(true);
      },
    );
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    const v = vRefs[activeRef.current].current;
    if (!v) return;
    if (v.error) {
      // A stuck failed load (e.g. the first request raced the file's
      // write) never recovers from play() alone — reload the source.
      v.load();
    }
    if (v.paused) {
      if (v.ended) v.currentTime = 0;
      void v.play();
      setBlocked(false);
    } else {
      v.pause();
    }
  };

  const isActiveEl = (el: HTMLVideoElement) =>
    el === vRefs[activeRef.current].current;

  // One automatic retry per source: a clip that 404s or half-loads while
  // the producer is still renaming it should heal itself moments later.
  const retriedRef = useRef<string>("");
  const handleError = (v: HTMLVideoElement) => {
    if (!isActiveEl(v) || !holdsSource(v)) return;
    const source = v.currentSrc || v.getAttribute("src") || "";
    if (retriedRef.current === source) {
      setBlocked(true); // second failure: surface the start overlay
      onFailed?.();
      return;
    }
    retriedRef.current = source;
    setTimeout(() => {
      // The stage may have moved on meanwhile. A retry on a layer that
      // was swapped out would put a second clip on the air.
      if (!isActiveEl(v) || !holds(v, source)) return;
      v.load();
      v.play().catch(() => {
        if (!isActiveEl(v)) return;
        setBlocked(true);
        onFailed?.();
      });
    }, 1200);
  };

  const videoEl = (idx: 0 | 1) => (
    <video
      ref={vRefs[idx]}
      data-plotwise-layer={idx}
      className={`absolute inset-0 h-full w-full cursor-pointer object-contain transition-opacity duration-300 ${
        active === idx ? "opacity-100" : "opacity-0"
      }`}
      onClick={toggle}
      onError={(e) => handleError(e.currentTarget)}
      onPlay={(e) => isActiveEl(e.currentTarget) && setPlaying(true)}
      onPause={(e) => isActiveEl(e.currentTarget) && setPlaying(false)}
      onEnded={(e) => {
        if (!isActiveEl(e.currentTarget)) return;
        setPlaying(false);
        onEnded?.();
      }}
      onLoadedMetadata={(e) =>
        isActiveEl(e.currentTarget) && setDuration(e.currentTarget.duration)
      }
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        if (!isActiveEl(v)) return;
        setTime(v.currentTime);
        setProgress(v.duration ? v.currentTime / v.duration : 0);
        onTime?.(v.currentTime);
      }}
    />
  );

  return (
    <div className="group/stage flex max-h-full w-full flex-col items-center gap-1.5">
      <div className="relative w-full overflow-hidden rounded-lg border border-cc-border bg-black shadow-2xl">
        <div className="relative aspect-video w-full">
          {videoEl(0)}
          {videoEl(1)}
        </div>
        {/* Start screen — only when the browser refused the cold-load
            autoplay (no user gesture yet). One click, gone for good. */}
        {blocked && (
          <button
            onClick={toggle}
            aria-label="Start"
            className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/45 backdrop-blur-[2px] transition-colors hover:bg-black/35"
          >
            <span className="flex h-20 w-20 items-center justify-center rounded-full border border-white/25 bg-black/60 text-zinc-100 shadow-2xl transition-transform hover:scale-105">
              <svg viewBox="0 0 24 24" className="ml-1 h-9 w-9" fill="currentColor">
                <path d="M7 4.5v15l13-7.5-13-7.5z" />
              </svg>
            </span>
          </button>
        )}
      </div>

      {/* Warm the cache for the clips the user can reach next */}
      <div hidden aria-hidden="true">
        {preloadSrcs
          .filter((p) => p !== src)
          .slice(0, 4)
          .map((p) => (
            <video key={p} src={p} preload="auto" muted playsInline />
          ))}
      </div>

      {/* Transport bar — outside the picture, space reserved, hover-only */}
      <div
        className={`flex w-full items-center gap-3 rounded-full border border-cc-border bg-cc-surface/80 px-3 py-1 backdrop-blur transition-opacity duration-200 ${
          blocked ? "opacity-100" : "opacity-0 group-hover/stage:opacity-100"
        }`}
      >
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-cc-fg transition-colors hover:bg-cc-hover ${
            blocked ? "bg-cc-primary/20 text-cc-primary" : "bg-cc-active"
          }`}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4" fill="currentColor">
              <path d="M7 4.5v15l13-7.5-13-7.5z" />
            </svg>
          )}
        </button>
        <div
          className="relative h-6 flex-1 cursor-pointer"
          onClick={(e) => {
            const v = vRefs[activeRef.current].current;
            if (!v || !v.duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            // Scrubbing back into a finished clip means "play it from
            // here"; a browser leaves an ended element paused after a seek.
            const wasEnded = v.ended;
            v.currentTime = ((e.clientX - rect.left) / rect.width) * v.duration;
            if (wasEnded) void v.play();
          }}
        >
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-cc-fg/15">
            <div
              className="h-full rounded-full bg-cc-primary transition-[width] duration-100"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-cc-muted">
          {fmtTime(time)} / {fmtTime(duration)}
        </span>
      </div>
    </div>
  );
}
