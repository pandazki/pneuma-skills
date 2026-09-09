/**
 * The stage: one `<canvas>`, the motion on it, and the truth about what that
 * canvas is showing.
 *
 * Everything the user can see the sprite through is drawn INTO the canvas
 * (background, onion skin, pivot guides) so the `capture` action — which
 * hands the canvas back as a PNG — returns the same picture the human is
 * looking at rather than a transparent sprite on nothing.
 *
 * The overlays are the other half of that honesty. A motion that is still
 * generating, still processing, failed, or being previewed by slicing its
 * unprocessed sheet all look plausible on a canvas; each one says so in
 * words, and `get-playback-state` reports the same fact as `source`.
 */

import { useEffect, useRef, useState } from "react";

import type { Motion } from "../domain.js";
import {
  drawStage,
  type StageBackground,
  type StageImages,
  type StageZoom,
} from "./frame-render.js";
import { CheckerIcon, GroundIcon, OnionIcon, ZoomIcon } from "./icons.js";
import type { FrameSource } from "./playback.js";

const BACKGROUNDS: StageBackground[] = ["checker", "dark", "light"];
const ZOOMS: StageZoom[] = ["fit", "1x", "2x"];

export interface StageProps {
  source: FrameSource;
  images: StageImages;
  frame: number;
  motion: Motion | null;
  /** Set when a reference image, not a motion, is on the stage. */
  refLabel: string | null;
  theme: "light" | "dark";
  background: StageBackground;
  zoom: StageZoom;
  onion: boolean;
  ground: boolean;
  onBackground: (value: StageBackground) => void;
  onZoom: (value: StageZoom) => void;
  onOnion: (value: boolean) => void;
  onGround: (value: boolean) => void;
  /** Handed the live canvas so the shell can answer `capture` with it. */
  onCanvas: (canvas: HTMLCanvasElement | null) => void;
}

export function Stage(props: StageProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      });
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const { onCanvas } = props;
  useEffect(() => {
    onCanvas(canvasRef.current);
    return () => onCanvas(null);
  }, [onCanvas]);

  const anchor = props.motion?.anchor ?? "bottom";
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const result = drawStage(ctx, {
      source: props.source,
      images: props.images,
      frame: props.frame,
      width: size.width,
      height: size.height,
      background: props.background,
      zoom: props.zoom,
      onion: props.onion,
      ground: props.ground,
      anchor,
      theme: props.theme,
    });
    setScale(result.scale);
  }, [
    size, props.source, props.images, props.frame, props.background,
    props.zoom, props.onion, props.ground, props.theme, anchor,
  ]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={boxRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block h-full w-full" />
        <StageOverlays {...props} scale={scale} />
      </div>

      <div className="pointer-events-auto absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-cc-border bg-cc-surface/80 p-1 shadow-lg backdrop-blur">
        <Segmented
          icon={<CheckerIcon size={12} />}
          title="Stage background"
          options={BACKGROUNDS}
          value={props.background}
          onChange={props.onBackground}
        />
        <span className="h-4 w-px bg-cc-border" />
        <Segmented
          icon={<ZoomIcon size={12} />}
          title="Zoom"
          options={ZOOMS}
          value={props.zoom}
          onChange={props.onZoom}
        />
        <span className="h-4 w-px bg-cc-border" />
        <Toggle
          active={props.onion}
          onClick={() => props.onOnion(!props.onion)}
          title="Onion skin — previous frame in blue, next in red"
        >
          <OnionIcon size={12} />
        </Toggle>
        <Toggle
          active={props.ground}
          onClick={() => props.onGround(!props.ground)}
          title={`Pivot guides (anchor: ${anchor})`}
        >
          <GroundIcon size={12} />
        </Toggle>
      </div>
    </div>
  );
}

/** Status, provenance and scale, said in words over the canvas. */
function StageOverlays(props: StageProps & { scale: number }) {
  const { motion, source, refLabel, images } = props;

  if (refLabel) {
    return (
      <Corner>
        <span className="text-cc-fg">{refLabel}</span>
        <span className="text-cc-muted">reference</span>
        <ScaleTag scale={props.scale} />
      </Corner>
    );
  }

  if (!motion) {
    return (
      <Centered>
        <p className="text-sm text-cc-muted">
          Pick a motion on the left, or ask for a new one.
        </p>
      </Centered>
    );
  }

  if (source.kind === "none") {
    return (
      <Centered>
        <div className="max-w-sm text-center">
          {motion.status === "generating" ? (
            <>
              <div className="mx-auto mb-3 h-1 w-28 overflow-hidden rounded-full bg-cc-border">
                <div className="h-full w-1/3 rounded-full bg-cc-primary motion-safe:animate-[pulse-dot_1.6s_ease-in-out_infinite]" />
              </div>
              <p className="text-sm text-cc-fg">Drawing the sheet…</p>
            </>
          ) : motion.status === "processing" ? (
            <p className="text-sm text-cc-fg">Slicing and aligning…</p>
          ) : motion.status === "failed" ? (
            <p className="text-sm text-cc-error">This motion failed.</p>
          ) : (
            <p className="text-sm text-cc-fg">
              Planned — no sheet has been generated yet.
            </p>
          )}
          {motion.prompt ? (
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-cc-muted">
              {motion.prompt}
            </p>
          ) : null}
          {motion.notes ? (
            <p className="mt-3 rounded-lg border border-cc-warning/40 bg-cc-warning/10 px-3 py-2 text-left text-xs leading-relaxed text-cc-fg">
              {motion.notes}
            </p>
          ) : null}
        </div>
      </Centered>
    );
  }

  return (
    <>
      <Corner>
        <span className="text-cc-fg">{motion.label}</span>
        {source.kind === "raw-sheet" ? (
          <span className="rounded border border-cc-warning/50 px-1 py-px text-cc-warning">
            unprocessed sheet · sliced here
          </span>
        ) : null}
        {source.kind === "frames" && source.missing > 0 ? (
          <span className="rounded border border-cc-error/50 px-1 py-px text-cc-error">
            {source.missing} frame{source.missing === 1 ? "" : "s"} missing
          </span>
        ) : null}
        {!images.ready ? <span className="text-cc-muted">decoding…</span> : null}
        <ScaleTag scale={props.scale} />
      </Corner>
      {motion.status === "failed" && motion.notes ? (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-lg border border-cc-error/40 bg-cc-error/10 px-3 py-2 text-xs leading-relaxed text-cc-fg">
          {motion.notes}
        </div>
      ) : null}
    </>
  );
}

function ScaleTag({ scale }: { scale: number }) {
  return (
    <span className="text-cc-muted">
      {scale >= 1 ? `${Math.round(scale)}×` : `${Math.round(scale * 100)}%`}
    </span>
  );
}

function Corner({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-cc-border bg-cc-surface/70 px-2 py-1 text-[11px] backdrop-blur">
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  icon,
  title,
  options,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  options: T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-0.5" title={title}>
      <span className="px-1 text-cc-muted">{icon}</span>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded px-1.5 py-0.5 text-[11px] capitalize transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
            option === value
              ? "bg-cc-primary/20 text-cc-primary"
              : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded p-1 transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
        active
          ? "bg-cc-primary/20 text-cc-primary"
          : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      }`}
    >
      {children}
    </button>
  );
}
