/**
 * Transport + frame strip — the timeline of one motion.
 *
 * The strip is the only place a human can see the frames as a SEQUENCE rather
 * than as an animation, which is how misalignment is actually spotted: a foot
 * that jumps or a body that changes size shows up as a jitter down the row of
 * thumbnails long before anyone can name it while it plays.
 *
 * fps and loop here are LOCAL overrides. They change how the stage plays right
 * now and never touch `project.json` — the motion's stored values belong to
 * the agent's scripts, and a viewer that silently rewrote them would put the
 * atlas (which bakes `duration` per frame) out of step with the file it came
 * from. The stored value is shown next to the override so the difference is
 * never invisible.
 */

import { useEffect, useRef } from "react";

import { frameRect, type StageImages } from "./frame-render.js";
import {
  LoopIcon,
  OnceIcon,
  PauseIcon,
  PlayIcon,
  StepBackIcon,
  StepForwardIcon,
} from "./icons.js";
import type { FrameSource } from "./playback.js";
import type { SpriteStrings } from "./strings.js";

const MIN_FPS = 1;
const MAX_FPS = 60;

export interface FrameStripProps {
  source: FrameSource;
  images: StageImages;
  frame: number;
  playing: boolean;
  count: number;
  /** Effective values (override, else the motion's own). */
  fps: number;
  loop: boolean;
  /** The motion's stored values, for the "differs from the file" hint. */
  motionFps: number;
  motionLoop: boolean;
  onTogglePlay: () => void;
  onStep: (delta: number) => void;
  onSeek: (frame: number) => void;
  onFps: (fps: number | null) => void;
  /** `null` clears the override and hands the motion back to the file. */
  onLoop: (loop: boolean | null) => void;
  t: SpriteStrings;
}

export function FrameStrip(props: FrameStripProps) {
  const { count, frame, t } = props;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Keep the playhead visible without dragging any ancestor around
  // (`scrollIntoView` scrolls every scrollable ancestor, including the pane).
  useEffect(() => {
    const scroller = scrollerRef.current;
    const active = activeRef.current;
    if (!scroller || !active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < scroller.scrollLeft) {
      scroller.scrollLeft = Math.max(0, left - 24);
    } else if (right > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = right - scroller.clientWidth + 24;
    }
  }, [frame]);

  const disabled = count === 0;
  const fpsDiffers = props.fps !== props.motionFps;
  const loopDiffers = props.loop !== props.motionLoop;

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-cc-border bg-cc-surface/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <TransportButton
          onClick={props.onTogglePlay}
          disabled={disabled}
          title={props.playing ? t.pause : t.play}
          primary
        >
          {props.playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
        </TransportButton>
        <TransportButton
          onClick={() => props.onStep(-1)}
          disabled={disabled}
          title={t.previousFrame}
        >
          <StepBackIcon size={13} />
        </TransportButton>
        <TransportButton
          onClick={() => props.onStep(1)}
          disabled={disabled}
          title={t.nextFrame}
        >
          <StepForwardIcon size={13} />
        </TransportButton>

        <span className="ml-1 font-mono text-xs tabular-nums text-cc-fg">
          {String(disabled ? 0 : frame).padStart(2, "0")}
          <span className="text-cc-muted"> / {String(count).padStart(2, "0")}</span>
        </span>

        <span className="mx-1 h-4 w-px bg-cc-border" />

        <div className="flex items-center gap-1" title={t.playbackFps}>
          <TransportButton
            onClick={() => props.onFps(Math.max(MIN_FPS, props.fps - 1))}
            disabled={disabled || props.fps <= MIN_FPS}
            title={t.slower}
          >
            <span className="px-0.5 text-[13px] leading-none">−</span>
          </TransportButton>
          <span className="min-w-[3.5rem] text-center font-mono text-xs tabular-nums text-cc-fg">
            {t.fps(props.fps)}
          </span>
          <TransportButton
            onClick={() => props.onFps(Math.min(MAX_FPS, props.fps + 1))}
            disabled={disabled || props.fps >= MAX_FPS}
            title={t.faster}
          >
            <span className="px-0.5 text-[13px] leading-none">+</span>
          </TransportButton>
        </div>

        <button
          type="button"
          onClick={() => props.onLoop(!props.loop)}
          disabled={disabled}
          title={props.loop ? t.looping : t.playsOnce}
          className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 disabled:opacity-40 ${
            props.loop
              ? "border-cc-primary/40 bg-cc-primary/15 text-cc-primary"
              : "border-cc-border text-cc-muted hover:text-cc-fg"
          }`}
        >
          {props.loop ? <LoopIcon size={12} /> : <OnceIcon size={12} />}
          {props.loop ? t.loopShort : t.onceShort}
        </button>

        {fpsDiffers || loopDiffers ? (
          <button
            type="button"
            onClick={() => {
              // Both halves clear the OVERRIDE rather than writing the file's
              // current value into it: writing it back looks identical right
              // now and pins the stage to a stale value the moment the agent
              // edits `motion.loop` in project.json.
              props.onFps(null);
              props.onLoop(null);
            }}
            className="rounded border border-cc-warning/40 px-2 py-1 text-[11px] text-cc-warning transition-colors hover:bg-cc-warning/10"
            title={t.storedPlaybackTitle}
          >
            {t.storedPlayback(props.motionFps, props.motionLoop)}
          </button>
        ) : null}
      </div>

      <div
        ref={scrollerRef}
        className="flex gap-1.5 overflow-x-auto pb-1"
        role="listbox"
        aria-label={t.framesList}
      >
        {disabled ? (
          <span className="px-1 py-3 text-[11px] text-cc-muted">
            {t.noFramesYet}
          </span>
        ) : (
          Array.from({ length: count }, (_, index) => (
            <FrameThumb
              key={index}
              ref={index === frame ? activeRef : undefined}
              index={index}
              active={index === frame}
              source={props.source}
              images={props.images}
              t={t}
              onClick={() => props.onSeek(index)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TransportButton({
  onClick,
  disabled,
  title,
  primary,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 disabled:opacity-40 ${
        primary
          ? "border-cc-primary/40 bg-cc-primary/15 text-cc-primary hover:bg-cc-primary/25"
          : "border-cc-border text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      }`}
    >
      {children}
    </button>
  );
}

const THUMB_PX = 46;

/** One frame, drawn from whichever source the stage is using. */
const FrameThumb = ({
  ref,
  index,
  active,
  source,
  images,
  t,
  onClick,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  index: number;
  active: boolean;
  source: FrameSource;
  images: StageImages;
  t: SpriteStrings;
  onClick: () => void;
}) => {
  const rect = frameRect(source, images, index);
  const aspect = rect ? rect.sw / rect.sh : 1;
  const width = Math.max(24, Math.min(96, Math.round(THUMB_PX * aspect)));

  // A sheet frame is a crop, so it is positioned as a background rather than
  // rendered as its own <img> — same pixels, no second decode.
  const sheetStyle =
    source.kind === "raw-sheet" && rect
      ? {
          backgroundImage: `url("${source.url}")`,
          backgroundSize: `${source.cols * 100}% ${source.rows * 100}%`,
          backgroundPosition: `${(index % source.cols) * (100 / Math.max(1, source.cols - 1))}% ${
            Math.floor(index / source.cols) * (100 / Math.max(1, source.rows - 1))
          }%`,
          imageRendering: "pixelated" as const,
        }
      : undefined;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      role="option"
      aria-selected={active}
      title={t.frameTitle(String(index).padStart(2, "0"))}
      style={{ width }}
      className={`group relative shrink-0 overflow-hidden rounded border transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
        active
          ? "border-cc-primary bg-cc-primary/10"
          : "border-cc-border bg-cc-bg/40 hover:border-cc-primary/50"
      }`}
    >
      <span
        className="flex items-center justify-center"
        style={{
          height: THUMB_PX,
          backgroundImage:
            "linear-gradient(45deg, rgba(128,128,128,0.16) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.16) 75%), linear-gradient(45deg, rgba(128,128,128,0.16) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.16) 75%)",
          backgroundSize: "10px 10px",
          backgroundPosition: "0 0, 5px 5px",
        }}
      >
        {source.kind === "frames" ? (
          source.frames[index] ? (
            <img
              src={source.frames[index] as string}
              alt=""
              className="max-h-full max-w-full object-contain"
              style={{ imageRendering: "pixelated" }}
              draggable={false}
            />
          ) : (
            <span className="text-[9px] text-cc-error">{t.noAsset}</span>
          )
        ) : (
          <span className="h-full w-full" style={sheetStyle} />
        )}
      </span>
      <span
        className={`block border-t px-1 text-center font-mono text-[9px] tabular-nums ${
          active
            ? "border-cc-primary/40 text-cc-primary"
            : "border-cc-border text-cc-muted"
        }`}
      >
        {String(index).padStart(2, "0")}
      </span>
    </button>
  );
};
