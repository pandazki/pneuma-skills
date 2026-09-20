/**
 * One lane of the shot: its header and its surface.
 *
 * A lane is a file, and a file can be absent, still being generated, or the
 * record of a request that failed. All three are NAMED STATES with their own
 * text — never a black player the user has to interpret. The header states
 * what the lane is and what ffprobe measured, because "480p" written in a
 * request is not evidence and the take's own probe is (invariant 6).
 */

import { useEffect, useState } from "react";

import type { SceneMeta } from "../domain.js";
import { GreyboxScene } from "./GreyboxScene.js";
import { CameraIcon, CubeIcon, FilmIcon, OrbitIcon, SoundOffIcon, SoundOnIcon } from "./icons.js";
import type { GreyboxMode, CameraMode, LaneView } from "./stage-model.js";
import { useVideoClock, type Clock } from "./usePlayhead.js";

export interface LaneSurfaceProps {
  lane: LaneView;
  /** Resolved `/content/…` URL for the lane's media, or null. */
  url: string | null;
  clock: Clock;
  /** False for a lane that is off screen — a hidden decoder costs for nothing. */
  active: boolean;
  muted: boolean;
  /** Greybox lane only. */
  greyboxMode?: GreyboxMode;
  cameraMode?: CameraMode;
  glbUrl?: string | null;
  meta?: SceneMeta | null;
  aspect: number;
  onLoadedChange?: (laneId: string, loaded: boolean, error: string | null) => void;
}

export function LaneSurface({
  lane,
  url,
  clock,
  active,
  muted,
  greyboxMode = "render",
  cameraMode = "shot",
  glbUrl = null,
  meta = null,
  aspect,
  onLoadedChange,
}: LaneSurfaceProps) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const is3d = lane.id === "greybox" && greyboxMode === "3d";
  useVideoClock(clock, video, lane.duration, active && !is3d);

  useEffect(() => {
    if (!video) return;
    video.muted = muted;
  }, [video, muted]);

  if (is3d) {
    return (
      <GreyboxScene
        url={glbUrl}
        meta={meta}
        clock={clock}
        cameraMode={cameraMode}
        aspect={aspect}
        onLoadedChange={(loaded, error) => onLoadedChange?.(lane.id, loaded, error)}
      />
    );
  }

  if (lane.kind !== "video" || !url) {
    return <LaneState lane={lane} />;
  }

  return (
    <div className="relative h-full w-full bg-black/60">
      <video
        key={url}
        ref={setVideo}
        src={url}
        muted={muted}
        playsInline
        preload="auto"
        className="h-full w-full object-contain"
        onLoadedMetadata={() => onLoadedChange?.(lane.id, true, null)}
        onError={() => onLoadedChange?.(lane.id, false, `${lane.file} could not be decoded`)}
      />
    </div>
  );
}

/** Waiting, failed and empty — each said out loud. */
function LaneState({ lane }: { lane: LaneView }) {
  const tone =
    lane.kind === "failed"
      ? "border-cc-error/40 text-cc-error"
      : lane.kind === "waiting"
        ? "border-cc-primary/40 text-cc-primary"
        : "border-cc-border text-cc-muted";
  const title =
    lane.kind === "failed"
      ? "The request failed"
      : lane.kind === "waiting"
        ? "Waiting for the model"
        : "Nothing here yet";
  return (
    <div className="flex h-full w-full items-center justify-center bg-cc-bg/60 px-6 text-center">
      <div className="max-w-xs">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}
        >
          {lane.kind === "waiting" ? <PulseDot /> : null}
          {title}
        </span>
        <p className="mt-2 text-[11px] leading-relaxed text-cc-muted">{lane.note}</p>
        {lane.kind === "waiting" ? (
          <p className="mt-1.5 text-[10px] text-cc-muted/80">{lane.facts}</p>
        ) : null}
      </div>
    </div>
  );
}

function PulseDot() {
  return <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cc-primary" />;
}

// ── Header ──────────────────────────────────────────────────────────────────

export interface LaneHeaderProps {
  lane: LaneView;
  /** Greybox lane only: the Render | 3D switch and the camera mode. */
  greyboxMode?: GreyboxMode;
  onGreyboxMode?: (mode: GreyboxMode) => void;
  cameraMode?: CameraMode;
  onCameraMode?: (mode: CameraMode) => void;
  hasGlb?: boolean;
  /** Take lane only: which take plays, and whether it makes sound. */
  takeOptions?: Array<{ id: string; label: string; status: string }>;
  onSelectTake?: (id: string) => void;
  muted?: boolean;
  onToggleMuted?: () => void;
}

export function LaneHeader({
  lane,
  greyboxMode,
  onGreyboxMode,
  cameraMode,
  onCameraMode,
  hasGlb,
  takeOptions,
  onSelectTake,
  muted,
  onToggleMuted,
}: LaneHeaderProps) {
  // Two fixed rows — label + controls, then the probe facts. Every lane header
  // is the same height that way, so three cards side by side line their
  // pictures up instead of stepping down wherever a control wrapped.
  return (
    <header className="flex shrink-0 flex-col gap-0.5 border-b border-cc-border bg-cc-surface/40 px-2 py-1.5">
      <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium text-cc-fg">{lane.label}</span>

      {lane.id === "greybox" && onGreyboxMode ? (
        <div className="ml-auto flex items-center gap-1">
          <Segment
            active={greyboxMode === "render"}
            onClick={() => onGreyboxMode("render")}
            title="Play the MP4 the video model received"
          >
            <FilmIcon size={11} />
            Render
          </Segment>
          <Segment
            active={greyboxMode === "3d"}
            onClick={() => onGreyboxMode("3d")}
            disabled={!hasGlb}
            title={
              hasGlb
                ? "Inspect the exported scene in 3D — the model never saw this"
                : "This greybox has no scene.glb"
            }
          >
            <CubeIcon size={11} />
            3D
          </Segment>
          {greyboxMode === "3d" && onCameraMode ? (
            <>
              <span className="mx-0.5 h-3.5 w-px bg-cc-border" />
              <Segment
                active={cameraMode === "shot"}
                onClick={() => onCameraMode("shot")}
                title="Render through the exported camera, letterboxed to the shot"
              >
                <CameraIcon size={11} />
                Shot camera
              </Segment>
              <Segment
                active={cameraMode === "free"}
                onClick={() => onCameraMode("free")}
                title="Orbit freely: camera path, frustum, subject trails and a ground grid"
              >
                <OrbitIcon size={11} />
                Free
              </Segment>
            </>
          ) : null}
        </div>
      ) : null}

      {lane.id === "take" ? (
        <div className="ml-auto flex items-center gap-1">
          {takeOptions && takeOptions.length > 1 && onSelectTake
            ? takeOptions.map((option) => (
                <Segment
                  key={option.id}
                  active={option.id === lane.takeId}
                  onClick={() => onSelectTake(option.id)}
                  title={`${option.label} · ${option.status}`}
                >
                  {option.label}
                </Segment>
              ))
            : null}
          {lane.kind === "video" && onToggleMuted ? (
            <button
              type="button"
              onClick={onToggleMuted}
              aria-pressed={!muted}
              title={muted ? "Unmute this take" : "Mute this take"}
              className="rounded p-1 text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:ring-2 focus-visible:ring-cc-primary/60"
            >
              {muted ? <SoundOffIcon size={12} /> : <SoundOnIcon size={12} />}
            </button>
          ) : null}
        </div>
      ) : null}
      </div>
      <span
        className="min-w-0 truncate text-[10px] tabular-nums text-cc-muted"
        title={lane.facts}
      >
        {lane.facts}
      </span>
    </header>
  );
}

export function Segment({
  active,
  onClick,
  disabled,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
        active
          ? "border-cc-primary/50 bg-cc-primary/15 text-cc-primary"
          : "border-cc-border text-cc-muted hover:border-cc-primary/40 hover:text-cc-fg"
      } ${disabled ? "cursor-not-allowed opacity-40 hover:border-cc-border hover:text-cc-muted" : ""}`}
    >
      {children}
    </button>
  );
}
