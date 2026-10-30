/**
 * The 0.6.0 surfaces that are not a frame player: a cutscene's clip on the
 * stage, a custom motion's storyboard strip above it, and the family of looks
 * a character and its variants make.
 *
 * Read-only like the rest of the viewer: each one shows what `project.json`
 * says and the files it names, and asks nothing.
 */

import type { CharacterProject, Motion, Roster } from "../domain.js";
import { resolveAssetUri } from "../domain.js";
import type { SpriteStrings } from "./strings.js";
import { contentUrl } from "./urls.js";

/** The newest ready take of a motion, as a URL. */
function latestClip(project: CharacterProject, motion: Motion, imageVersion: number): string | null {
  const ready = [...motion.videos].reverse().find((v) => v.status === "ready");
  const uri = ready ? resolveAssetUri(project, ready.asset) : undefined;
  return uri ? contentUrl(project.contentSet, uri, imageVersion) : null;
}

/**
 * A cutscene on the stage: its newest ready take, playing, big. A cutscene
 * is a clip and nothing else — there are no frames to step through.
 */
export function CutsceneStage({
  project,
  motion,
  imageVersion,
  t,
}: {
  project: CharacterProject;
  motion: Motion;
  imageVersion: number;
  t: SpriteStrings;
}) {
  const url = latestClip(project, motion, imageVersion);
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/90 p-3">
      {url ? (
        <video
          key={url}
          src={url}
          className="max-h-full max-w-full rounded-lg shadow-2xl"
          autoPlay
          loop
          muted
          playsInline
          controls
        />
      ) : (
        <p className="text-sm text-white/70">{t.cutsceneNoClip}</p>
      )}
      <span className="pointer-events-none absolute left-3 top-3 rounded-lg border border-white/15 bg-black/50 px-2 py-1 text-[11px] text-white/90 backdrop-blur">
        {motion.label}
      </span>
    </div>
  );
}

/**
 * A custom motion's storyboard: one card per beat, in time order — the
 * keyframe when there is one, the second it lands on, and what happens.
 */
export function StoryboardStrip({
  project,
  motion,
  imageVersion,
  t,
}: {
  project: CharacterProject;
  motion: Motion;
  imageVersion: number;
  t: SpriteStrings;
}) {
  const beats = motion.storyboard?.beats ?? [];
  if (!beats.length) return null;
  return (
    <div className="flex shrink-0 items-stretch gap-2 overflow-x-auto border-b border-cc-border bg-cc-surface/30 px-3 py-2">
      <span className="self-center pr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cc-muted">
        {t.storyboard}
      </span>
      {beats.map((beat, index) => {
        const uri = beat.keyframe ? resolveAssetUri(project, beat.keyframe) : undefined;
        return (
          <div key={`${beat.at}-${index}`} className="flex w-36 shrink-0 flex-col gap-1 rounded-lg border border-cc-border bg-cc-bg/40 p-1.5" title={beat.text}>
            <div className="flex h-14 items-center justify-center overflow-hidden rounded bg-cc-hover/40">
              {uri ? (
                <img src={contentUrl(project.contentSet, uri, imageVersion)} alt="" className="max-h-14 max-w-full object-contain" draggable={false} />
              ) : (
                <span className="text-[10px] text-cc-muted">—</span>
              )}
            </div>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-[10px] text-cc-primary">{beat.at}s</span>
              <span className="line-clamp-2 text-[10px] leading-snug text-cc-fg">{beat.text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One look of a character: the original, or a variant of it. */
export interface Look {
  contentSet: string;
  name: string;
  note: string | null;
  /** A picture of it: its front anchor, else its turnaround, else any ref. */
  image: string | null;
}

/**
 * The family a character belongs to: its original and every variant of that
 * original in the workspace, original first. A character with no variants
 * and no original is a family of one — the rail shows nothing for it.
 */
export function lookFamily(roster: Roster | null, project: CharacterProject, imageVersion = 0): Look[] {
  if (!roster) return [];
  const root = project.sprite.character.variantOf?.contentSet ?? project.contentSet;
  const all = Object.values(roster.byContentSet);
  const members = all.filter(
    (p) => p.contentSet === root || p.sprite.character.variantOf?.contentSet === root,
  );
  if (members.length < 2) return [];
  members.sort((a, b) => (a.contentSet === root ? -1 : b.contentSet === root ? 1 : a.contentSet.localeCompare(b.contentSet)));
  return members.map((p) => {
    const refs = p.sprite.refs;
    const ref = refs.find((r) => r.role === "anchor" && r.direction === "front")
      ?? refs.find((r) => r.role === "turnaround")
      ?? refs[0];
    const uri = ref ? resolveAssetUri(p, ref.asset) : undefined;
    return {
      contentSet: p.contentSet,
      name: p.sprite.character.name,
      note: p.sprite.character.variantOf?.note ?? null,
      image: uri ? contentUrl(p.contentSet, uri, imageVersion) : null,
    };
  });
}
