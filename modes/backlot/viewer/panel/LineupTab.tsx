/**
 * Lineup — an OPTIONAL look at what a shot will become.
 *
 * The pictures of this shot, in the order `previz.mjs lineup` stacks them:
 *
 *   KEY FRAME(S)  an optional rendering of one second in the film's look,
 *                 made from the greybox frame at that second. A picture for
 *                 the creator; the take does not receive it unless it was
 *                 generated with `--with-anchors`
 *   GREYBOX       what was actually built, and the one picture of layout,
 *                 behaviour and camera every take IS conditioned on
 *   BOARD         a drawing from before the key frames existed; shown only
 *                 when an old film has one
 *
 * Side by side, because the question a key frame answers is whether the two
 * are the same picture. The greybox can carry geometry and a clock and
 * nothing else, so a mismatch here is either a blocking defect to fix before
 * a paid take, or a design the prompt will have to carry on its own — and
 * the creator is the one who decides which.
 *
 * Under them, the beats with the DESIGN written under each label, and the
 * hand-off this shot declares. Same three things the agent is briefed on, in
 * the order a person reads them.
 */

import { useCallback, useState } from "react";

import type { AnchorRecord, Beat, Shot } from "../../domain.js";
import { primaryAnchor } from "../../domain.js";
import { CubeIcon, ImageIcon } from "../icons.js";
import { formatSeconds } from "../player-model.js";
import { useVideoClock, type Clock } from "../usePlayhead.js";
import { ContinuityNote } from "./ContinuityNote.js";

/** `first` leads — it is the frame the take opens on — then the rest in the
 *  order the agent wrote them. Same order as `previz.mjs lineup`. */
function orderedAnchors(shot: Shot): AnchorRecord[] {
  const lead = primaryAnchor(shot);
  if (!lead) return [];
  return [lead, ...shot.anchors.filter((a) => a !== lead)];
}

export interface LineupTabProps {
  shot: Shot;
  /** Shot-relative path + cache buster → `/content/…` URL. */
  urlFor: (path: string, rev: number | string) => string | null;
  /** The shot's one clock — the greybox tile follows it when unanchored. */
  clock: Clock;
  /** Click a beat: park the playhead on it. */
  onSeek: (seconds: number) => void;
}

export function LineupTab({ shot, urlFor, clock, onSeek }: LineupTabProps) {
  const anchors = orderedAnchors(shot);
  const lead = anchors[0] ?? null;
  const final = shot.greybox.final;
  const at = lead?.at ?? null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] leading-relaxed text-cc-muted">
        {anchors.length === 0
          ? "No key frame — optional. The greybox is the picture this take is made from; a key frame is rendered from it only when somebody wants to see the look first."
          : `${anchors.length > 1 ? "Key frames" : "A key frame"} and the greybox at ${
              at === null ? "the playhead" : `${formatSeconds(at)} s`
            }. Optional pictures: the take receives the greybox, and a key frame only when it was generated with --with-anchors.`}
      </p>

      <div className="flex gap-1">
        {anchors.length === 0 ? (
          <Tile label="Key frame" note="optional">
            <Missing>none — the greybox is the picture</Missing>
          </Tile>
        ) : (
          anchors.map((anchor) => (
            <Tile
              key={anchor.id}
              label={`Key frame ${anchor.id}`}
              note={anchor.at === null ? `rev ${anchor.revision}` : `${formatSeconds(anchor.at)} s · rev ${anchor.revision}`}
            >
              <Still url={urlFor(anchor.file, anchor.revision)} alt={anchorAlt(anchor, shot)} />
            </Tile>
          ))
        )}

        <Tile
          label="Greybox"
          note={final ? `rev ${final.revision}` : "not rendered"}
          icon={<CubeIcon size={9} />}
        >
          {final ? (
            <GreyboxFrame
              url={urlFor(final.file, final.revision)}
              at={at}
              clock={clock}
              duration={final.probe?.seconds ?? null}
            />
          ) : (
            <Missing>not rendered</Missing>
          )}
        </Tile>

        {/* Only a film shot before the key frames existed has one, and it is
            never expected: an absent board is not a gap. */}
        {shot.board ? (
          <Tile label="Board" note="legacy drawing">
            <Still
              url={urlFor(shot.board.file, shot.board.revision)}
              alt={`Board frame for ${shot.title}`}
            />
          </Tile>
        ) : null}
      </div>

      {lead?.prompt ? (
        <p className="rounded-md border border-cc-border bg-cc-card px-2 py-1.5 text-[10px] leading-relaxed text-cc-muted">
          <span className="text-cc-fg">Key frame prompt · </span>
          {lead.prompt}
        </p>
      ) : null}

      <ContinuityNote continuity={shot.continuity} />

      <section>
        <h3 className="text-[11px] font-medium text-cc-fg">Beats</h3>
        {shot.beats.length === 0 ? (
          <p className="mt-1 text-[11px] leading-relaxed text-cc-muted">
            No beats yet. They are the shot&rsquo;s clock — the greybox is built to them and the
            prompt&rsquo;s timeline is read off them.
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {[...shot.beats]
              .sort((a, b) => a.from - b.from)
              .map((beat) => (
                <li key={beat.id}>
                  <BeatRow beat={beat} onSeek={onSeek} />
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function anchorAlt(anchor: AnchorRecord, shot: Shot): string {
  return anchor.at === null
    ? `Key frame "${anchor.id}" of ${shot.title}`
    : `Key frame "${anchor.id}" of ${shot.title} at ${anchor.at} s`;
}

function Tile({
  label,
  note,
  icon,
  children,
}: {
  label: string;
  note: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-cc-border bg-cc-card">
      <div className="relative aspect-video w-full bg-black/55">{children}</div>
      {/* Two lines: three tiles across a 320 px panel have no room for a
          name and a note side by side, and a truncated name is a tile
          nobody can identify. */}
      <div className="px-1.5 py-1">
        <p className="flex items-center gap-1 truncate text-[9px] text-cc-fg">
          {icon ? <span className="shrink-0 text-cc-muted">{icon}</span> : null}
          {label}
        </p>
        <p className="truncate text-[8px] tabular-nums text-cc-muted">{note}</p>
      </div>
    </div>
  );
}

function Still({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <Missing>{url ? "could not be loaded" : "no file"}</Missing>;
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className="h-full w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * The greybox at the anchor's second — or, with no anchor to stand at, the
 * frame the player itself is parked on.
 *
 * Following the clock is the honest default: "the greybox at this moment" is
 * a moving target while the user scrubs, and a tile frozen at 0 s beside a
 * playhead at 5 s would invite a comparison of two different seconds.
 */
function GreyboxFrame({
  url,
  at,
  clock,
  duration,
}: {
  url: string | null;
  at: number | null;
  clock: Clock;
  duration: number | null;
}) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  useVideoClock(clock, video, duration, at === null);

  const seekOnce = useCallback(
    (element: HTMLVideoElement) => {
      if (at === null) return;
      // A hair past the target: seeking to exactly 0 on a fresh element is a
      // no-op, and a no-op leaves the tile showing nothing at all.
      element.currentTime = Math.max(at, 1e-3);
    },
    [at],
  );

  if (!url || failed) return <Missing>{url ? "could not be decoded" : "no file"}</Missing>;
  return (
    <video
      key={url}
      ref={setVideo}
      src={url}
      muted
      playsInline
      preload="metadata"
      className="h-full w-full object-cover"
      onLoadedMetadata={(event) => seekOnce(event.currentTarget)}
      onError={() => setFailed(true)}
    />
  );
}

function Missing({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-center text-cc-muted">
      <ImageIcon size={12} />
      <span className="text-[8px] leading-tight">{children}</span>
    </span>
  );
}

/**
 * One beat, with its design under its label.
 *
 * `label` is the short handle every rail and sheet shows; `detail` is the
 * picture the boards stage designed, and the previz gate is where somebody
 * checks the greybox against it rather than against the handle.
 */
function BeatRow({ beat, onSeek }: { beat: Beat; onSeek: (seconds: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSeek(beat.from)}
      title={`Seek to ${formatSeconds(beat.from)} s`}
      className="w-full rounded-md border border-cc-border bg-cc-card px-2 py-1.5 text-left transition-colors hover:border-cc-primary/40"
    >
      <div className="flex items-baseline gap-1.5">
        <span className="shrink-0 rounded-full border border-cc-border px-1 text-[8px] uppercase tracking-wide text-cc-muted">
          {beat.kind}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-cc-fg">{beat.label}</span>
        <span className="shrink-0 text-[9px] tabular-nums text-cc-muted">
          {formatSeconds(beat.from)}–{formatSeconds(beat.to)} s
        </span>
      </div>
      {beat.detail ? (
        <p className="mt-0.5 text-[10px] leading-relaxed text-cc-muted">{beat.detail}</p>
      ) : (
        <p className="mt-0.5 text-[10px] italic leading-relaxed text-cc-muted/70">
          no design written for this beat
        </p>
      )}
      {beat.causedBy ? (
        <p className="mt-0.5 text-[9px] text-cc-warning/90">caused by &ldquo;{beat.causedBy}&rdquo;</p>
      ) : null}
    </button>
  );
}

export default LineupTab;
