/**
 * The cut — the assembled film, and the edit list it was assembled from.
 *
 * Three claims are drawn here and each one is checkable against `edl.json`:
 *
 * 1. WHAT YOU ARE WATCHING. A cut with a greybox standing in for any shot is
 *    a REEL and says so in the loudest label on the page. `domain.parseCut`
 *    demotes a `final` whose segments still contain a stand-in, so the label
 *    cannot be more optimistic than the segment list.
 * 2. WHERE EACH SHOT IS. The segment strip is the EDL to scale; a stand-in
 *    is hatched and labelled `greybox`. Clicking seeks.
 * 3. WHERE THE SOUND LANDS. Voice-over marks and the music bed are drawn on
 *    the SAME time axis, so "the line arrives before the door opens" is
 *    visible rather than remembered.
 *
 * The transport is hand-built: `<video controls>` is native chrome, which
 * the repository's frontend rule bans in user-facing surfaces.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { CutState, Project } from "../domain.js";
import { segmentAt } from "../domain.js";
import { MusicIcon, PauseIcon, PlayIcon, VoiceIcon } from "./icons.js";
import { clamp, formatSeconds } from "./player-model.js";
import { StageEmpty } from "./StageEmpty.js";

export interface CutViewProps {
  project: Project;
  selectedSegment: string | null;
  onSelectSegment: (shot: string) => void;
  /** Seconds on the cut's clock, mirrored out for the address. */
  time: number;
  onTime: (seconds: number) => void;
  /** Workspace-relative path + cache buster → `/content/…` URL. */
  urlFor: (path: string, rev: number | string) => string | null;
}

export function CutView({
  project,
  selectedSegment,
  onSelectSegment,
  time,
  onTime,
  urlFor,
}: CutViewProps) {
  const cut = project.cut;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The address owns the playhead: a `navigate-to` that names a second has
  // to move the picture, not just the readout.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Math.abs(video.currentTime - time) > 0.25) video.currentTime = time;
  }, [time]);

  const onLoaded = useCallback(() => setError(null), []);

  if (!cut) return <StageEmpty stage="cut" />;

  const url = urlFor(
    project.dir ? `${project.dir}/cut/${cut.file}` : `cut/${cut.file}`,
    cut.builtAt ?? 0,
  );
  const duration = Math.max(cut.seconds, 0.001);
  const here = segmentAt(cut, time);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-cc-border bg-cc-surface/30 px-3 py-1.5">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] ${
            cut.kind === "reel"
              ? "border-cc-warning/55 bg-cc-warning/15 text-cc-warning"
              : "border-cc-success/45 bg-cc-success/10 text-cc-success"
          }`}
        >
          {cut.kind}
        </span>
        <span className="text-[11px] text-cc-fg">{cut.file}</span>
        <span className="text-[10px] tabular-nums text-cc-muted">
          {cut.seconds.toFixed(1)} s · {cut.segments.length} segment
          {cut.segments.length === 1 ? "" : "s"}
        </span>
        {cut.kind === "reel" ? (
          <span className="min-w-0 truncate text-[10px] text-cc-muted">
            — a story reel: greybox stands in wherever no take is selected, so this is timing and
            blocking, not the look.
          </span>
        ) : null}
        {cut.builtAt ? (
          <span className="ml-auto shrink-0 text-[9px] text-cc-muted">
            built {new Date(cut.builtAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center bg-black/40 p-3">
        {url ? (
          <video
            ref={videoRef}
            key={url}
            src={url}
            playsInline
            preload="metadata"
            className="max-h-full max-w-full object-contain"
            onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)}
            onLoadedMetadata={onLoaded}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setError(`${cut.file} could not be decoded`)}
          />
        ) : (
          <p className="text-[11px] text-cc-muted">The cut has no file on record.</p>
        )}
      </div>

      {error ? (
        <p className="shrink-0 border-t border-cc-error/40 bg-cc-error/10 px-3 py-1 text-[10px] text-cc-error">
          {error}
        </p>
      ) : null}

      <div className="flex shrink-0 items-center gap-2 border-t border-cc-border bg-cc-surface/30 px-3 py-1.5">
        <button
          type="button"
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            if (video.paused) void video.play().catch(() => setError("playback was refused"));
            else video.pause();
          }}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-cc-primary/50 bg-cc-primary/15 text-cc-primary transition-colors hover:bg-cc-primary/25 focus-visible:ring-2 focus-visible:ring-cc-primary/60"
        >
          {playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
        </button>
        <span className="text-[11px] tabular-nums text-cc-fg">
          {formatSeconds(time)} / {formatSeconds(cut.seconds)} s
        </span>
        <span className="min-w-0 truncate text-[10px] text-cc-muted">
          {here ? `${here.shot} · ${here.source}` : "between segments"}
        </span>
      </div>

      <EdlStrip
        cut={cut}
        duration={duration}
        time={time}
        selected={selectedSegment}
        onSeek={(seconds, shot) => {
          onTime(seconds);
          const video = videoRef.current;
          if (video) video.currentTime = seconds;
          if (shot) onSelectSegment(shot);
        }}
      />
    </div>
  );
}

function EdlStrip({
  cut,
  duration,
  time,
  selected,
  onSeek,
}: {
  cut: CutState;
  duration: number;
  time: number;
  selected: string | null;
  onSeek: (seconds: number, shot: string | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pct = (t: number) => `${(clamp(t, 0, duration) / duration) * 100}%`;

  const seekTo = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const seconds = clamp(((clientX - box.left) / box.width) * duration, 0, duration);
    onSeek(seconds, null);
  };

  return (
    <div className="shrink-0 border-t border-cc-border bg-cc-surface/20 px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="flex w-12 shrink-0 flex-col gap-1 pt-px text-[9px] uppercase tracking-wide text-cc-muted">
          <span className="flex h-6 items-center">shots</span>
          {cut.vo.length > 0 ? (
            <span className="flex h-3 items-center gap-1">
              <VoiceIcon size={9} />
              vo
            </span>
          ) : null}
          {cut.music ? (
            <span className="flex h-3 items-center gap-1">
              <MusicIcon size={9} />
              mus
            </span>
          ) : null}
        </div>

        <div className="relative min-w-0 flex-1">
          <div ref={trackRef} className="relative h-6 w-full overflow-hidden rounded-sm bg-cc-hover">
            {cut.segments.map((segment) => {
              const standIn = segment.source === "greybox";
              const active = segment.shot === selected;
              return (
                <button
                  key={`${segment.shot}:${segment.offset}`}
                  type="button"
                  onClick={() => onSeek(segment.offset, segment.shot)}
                  title={`${segment.shot} · ${segment.source} · ${segment.offset.toFixed(1)}–${(segment.offset + segment.seconds).toFixed(1)} s`}
                  className={`absolute inset-y-0 overflow-hidden border-r border-cc-bg/70 px-1 text-left text-[9px] leading-6 transition-colors ${
                    active ? "ring-1 ring-inset ring-cc-primary" : ""
                  } ${
                    standIn
                      ? "text-cc-warning hover:brightness-125"
                      : "bg-cc-primary/25 text-cc-fg hover:bg-cc-primary/40"
                  }`}
                  style={{
                    left: pct(segment.offset),
                    width: `calc(${pct(segment.seconds)} + 1px)`,
                    // A stand-in is hatched: the strip must not let a greybox
                    // pass for a rendered take at a glance.
                    ...(standIn
                      ? {
                          backgroundImage:
                            "repeating-linear-gradient(45deg, rgba(250,204,21,0.30) 0 4px, rgba(250,204,21,0.08) 4px 8px)",
                        }
                      : {}),
                  }}
                >
                  <span className="block truncate">
                    {segment.shot}
                    {standIn ? " · greybox" : ""}
                  </span>
                </button>
              );
            })}
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-cc-fg"
              style={{ left: pct(time) }}
            />
            {/* The seek surface sits over the segments but under their text:
                a click anywhere on the strip is a seek, a click on a segment
                is also a selection. */}
            <div
              className="absolute inset-0 cursor-crosshair"
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).tagName === "BUTTON") return;
                seekTo(event.clientX);
              }}
              role="presentation"
            />
          </div>

          {cut.vo.length > 0 ? (
            <div className="relative mt-1 h-3 w-full rounded-sm bg-cc-hover/60">
              {cut.vo.map((vo) => (
                <span
                  key={`${vo.shot}:${vo.line}`}
                  title={`${vo.line} (${vo.shot}) at ${vo.at.toFixed(1)} s`}
                  className="absolute inset-y-0 w-0.5 rounded-sm bg-cc-warning"
                  style={{ left: pct(vo.at) }}
                />
              ))}
            </div>
          ) : null}

          {cut.music ? (
            <div
              className="relative mt-1 h-3 w-full overflow-hidden rounded-sm bg-cc-primary/15"
              title={`${cut.music.file} at ${cut.music.gainDb} dB, ${cut.music.fadeOutSeconds} s fade-out`}
            >
              <span className="absolute inset-y-0 left-0 right-0 flex items-center px-1 text-[8px] text-cc-muted">
                {cut.music.file} · {cut.music.gainDb} dB
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default CutView;
