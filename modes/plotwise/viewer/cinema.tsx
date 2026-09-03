/**
 * The cinema frame — the one layout every pre-course screen shares.
 *
 * A course begins with a picture, not a form: the style sample the
 * learner confirms is literally the opening look, so it stays on the big
 * screen from the moment it lands until the first segment replaces it.
 * Every screen before the stage is therefore the same shape — a step
 * label, a width-filling 16:9 screen capped by the viewport (the stage
 * uses the same rule, so the picture never jumps when the course
 * starts), a one-line caption, and a card underneath that carries what
 * changes between steps: the style decision, then the director's
 * progress.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Same sizing rule as the stage: fill the width, cap by the viewport so
 * the caption and the card below always fit without scrolling. */
export const CINEMA_WIDTH = "min(100%, calc((100dvh - 380px) * 16 / 9))";

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 animate-spin ${className}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

export function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${className}`} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function CinemaShell({ step, aside, children }: { step: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full w-full overflow-y-auto bg-cc-bg text-cc-fg">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-8 py-6">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.2em] text-cc-muted">{step}</div>
          {aside}
        </div>
        <div className="flex flex-1 flex-col items-center justify-center py-5">
          <div className="flex max-w-full flex-col items-center" style={{ width: CINEMA_WIDTH }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * The screen itself: a looping, muted-by-default sample with a sound
 * toggle, or a still while the clip is on its way. Children overlay it
 * (a progress bar along the bottom edge).
 *
 * Playback is started explicitly, never left to the `autoplay`
 * attribute alone: React sets `muted` as a property, not an attribute,
 * and a clip that has just been written can answer its first request
 * with a transient decode error — either way the learner would face a
 * still poster with nothing to press. So the element is told to play
 * on mount, a failed load is retried once, and whenever the clip is not
 * actually running a play button sits in the middle of the picture
 * (that press is a user gesture, so it starts the clip WITH sound).
 */
export function CinemaScreen({
  video,
  poster,
  dim = false,
  alt = "",
  children,
}: {
  video?: string | null;
  poster?: string | null;
  dim?: boolean;
  alt?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const retriedRef = useRef(false);
  const [sound, setSound] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSound(false);
    setPlaying(false);
    setFailed(false);
    retriedRef.current = false;
    const el = ref.current;
    if (!el || !video) return;
    el.muted = true;
    const attempt = el.play?.();
    if (attempt && typeof attempt.then === "function") {
      attempt.then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }, [video]);

  const startWithSound = () => {
    const el = ref.current;
    if (!el) return;
    setSound(true);
    setFailed(false);
    el.muted = false;
    if (el.error) el.load();
    el.currentTime = 0;
    const attempt = el.play?.();
    if (attempt && typeof attempt.then === "function") {
      attempt.then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-cc-border bg-black shadow-xl shadow-black/10">
      {video ? (
        <video
          ref={ref}
          key={video}
          src={video}
          poster={poster ?? undefined}
          autoPlay
          muted={!sound}
          loop
          playsInline
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => {
            const el = ref.current;
            if (el && !retriedRef.current) {
              // A clip requested in the same instant it finished writing
              // can fail to decode once; the file is whole on the retry.
              retriedRef.current = true;
              window.setTimeout(() => {
                el.load();
                el.muted = !sound;
                void el.play?.()?.catch?.(() => {});
              }, 800);
              return;
            }
            setPlaying(false);
            setFailed(true);
          }}
          className="h-full w-full object-cover"
        />
      ) : poster ? (
        <img src={poster} alt={alt} className={`h-full w-full object-cover ${dim ? "opacity-40" : ""}`} />
      ) : null}
      {children}
      {video && !playing && (
        <button
          onClick={startWithSound}
          data-plotwise-play
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/30 text-white transition-colors hover:bg-black/40"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-cc-primary shadow-lg shadow-cc-glow">
            <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          <span className="text-sm">{failed ? "样片加载失败,点击重试" : "播放样片"}</span>
        </button>
      )}
      {video && playing && !sound && (
        <button
          onClick={startWithSound}
          className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur transition-colors hover:bg-black/80"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H2v6h4l5 4V5z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          </svg>
          有声播放
        </button>
      )}
    </div>
  );
}

/** The one-line caption under the screen (the sample's spoken line). */
export function CinemaCaption({ children }: { children: ReactNode }) {
  return <div className="mt-3 min-h-6 max-w-3xl text-center text-sm leading-relaxed text-cc-muted">{children}</div>;
}

/** The card under the caption. */
export function CinemaCard({ children }: { children: ReactNode }) {
  return <div className="mt-4 w-full rounded-xl border border-cc-border bg-cc-card px-5 py-4">{children}</div>;
}
