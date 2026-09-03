/**
 * The interlude — what the stage shows between a scene that has ended
 * and one that is still being made.
 *
 * A wait on a dashed placeholder is dead time; a wait on a recap is the
 * course still teaching. The picture the last scene ended on stays up
 * (slowly drifting, so the screen is alive without pretending to play),
 * the sentences the learner just heard pass one by one over it — the
 * rehearsal that makes a point stick — and the bottom edge says what is
 * coming and how far along it is ("拍摄中 2/3", a clock, one bar per
 * shot). When production is stuck or has failed, the same screen says so
 * and offers 再拍一次; a wait that cannot fail is a lie.
 */

import { useEffect, useRef, useState } from "react";
import type { CourseNode, CourseSet } from "../domain.js";
import { Spinner } from "./cinema.js";
import { fmtElapsed, productionLabel, type ProductionState } from "./waiting.js";

/** How long each recap sentence stays up. */
export const RECAP_LINE_MS = 7_000;

const KEYFRAMES = `
@keyframes pw-drift { from { transform: scale(1.03) translate(0, 0); } to { transform: scale(1.14) translate(-1.5%, -1%); } }
@keyframes pw-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
`;

/** The sentences of the scene the learner just watched: one per shot,
 * or the script's lines when the scene predates shots. */
export function recapLines(prev: Pick<CourseNode, "shots" | "script"> | null | undefined): string[] {
  if (!prev) return [];
  const fromShots = prev.shots.map((s) => s.script.trim()).filter(Boolean);
  if (fromShots.length) return fromShots;
  return prev.script
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** The still to hold: the last frame of the previous scene's last shot
 * when the manager extracted one, otherwise the course's style anchor. */
export function interludeBackdrop(
  set: Pick<CourseSet, "style">,
  prefix: string,
  prev: Pick<CourseNode, "id" | "shots"> | null | undefined,
): { image: string | null; fallback: string | null } {
  const asset = (file?: string | null) => (file ? `/content/${prefix ? `${prefix}/` : ""}${file}` : null);
  const fallback = asset(set.style.refImages?.[0]) ?? asset(set.style.sample?.image);
  const last = prev ? [...prev.shots].reverse().find((s) => s.video) : undefined;
  const image = prev && last ? asset(`nodes/${prev.id}/${last.id}.last.png`) : null;
  return { image: image ?? fallback, fallback };
}

export default function Interlude({
  set,
  prefix,
  prev,
  next,
  state,
  now,
  onRetry,
}: {
  set: CourseSet;
  prefix: string;
  /** The scene the learner came from, when there is one. */
  prev: CourseNode | null;
  /** The scene being waited for. */
  next: CourseNode;
  state: ProductionState;
  now: number;
  onRetry: () => void;
}) {
  const lines = recapLines(prev);
  const beat = set.outline.find((b) => b.id === next.beat);
  const mountedRef = useRef(now);
  const backdrop = interludeBackdrop(set, prefix, prev);
  const [image, setImage] = useState<string | null>(backdrop.image);
  useEffect(() => {
    setImage(interludeBackdrop(set, prefix, prev).image);
  }, [set, prefix, prev?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lineIdx = lines.length ? Math.floor(Math.max(0, now - mountedRef.current) / RECAP_LINE_MS) % lines.length : 0;
  const total = next.shotCount ?? next.shots.length;
  const done = next.shots.filter((s) => s.status === "ready").length;
  const running = state.kind === "running" && !state.stale;
  const trouble = state.kind === "failed" || (state.kind === "running" && state.stale);

  return (
    <div
      data-plotwise-interlude
      className="relative aspect-video w-full overflow-hidden rounded-lg border border-cc-border bg-black shadow-2xl"
    >
      <style>{KEYFRAMES}</style>
      {image && (
        <img
          src={image}
          alt=""
          onError={() => setImage((cur) => (cur !== backdrop.fallback ? backdrop.fallback : null))}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ animation: "pw-drift 45s ease-in-out infinite alternate" }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/35" />
      <div className="absolute inset-0 flex flex-col justify-between p-6 text-white">
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/60">{lines.length ? "刚才讲到" : "接下来"}</div>
        <div className="flex flex-1 items-center justify-center px-4">
          {lines.length ? (
            <p
              key={lineIdx}
              data-plotwise-recap
              className="max-w-2xl text-center text-lg leading-relaxed text-white/95 md:text-xl"
              style={{ animation: "pw-rise 700ms ease-out" }}
            >
              {lines[lineIdx]}
            </p>
          ) : (
            <div className="text-center">
              <div className="text-lg text-white/95 md:text-xl">{beat?.title ?? next.choiceLabel ?? next.id}</div>
              {beat?.summary && <div className="mt-2 max-w-xl text-sm leading-relaxed text-white/70">{beat.summary}</div>}
            </div>
          )}
        </div>
        <div>
          <div className="flex items-end justify-between gap-6">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/60">接下来</div>
              <div className="truncate text-base font-medium">{next.choiceLabel ?? beat?.title ?? next.id}</div>
              {next.brief && <div className="mt-1 line-clamp-2 max-w-xl text-xs leading-relaxed text-white/70">{next.brief}</div>}
            </div>
            <div className="shrink-0 text-right text-sm tabular-nums">
              {running && (
                <span className="flex items-center gap-2 text-white/85" data-plotwise-interlude-state="running">
                  <Spinner className="h-3.5 w-3.5" />
                  {productionLabel(next)}
                  {state.elapsedMs != null && <span className="text-white/55">{fmtElapsed(state.elapsedMs)}</span>}
                </span>
              )}
              {trouble && (
                <div className="flex flex-col items-end gap-1.5" data-plotwise-interlude-state={state.kind === "failed" ? "failed" : "stale"}>
                  <span className="text-white/85">
                    {state.kind === "failed" ? "这一段没拍成" : `拍了 ${fmtElapsed(state.elapsedMs ?? 0)} 还没有结果`}
                  </span>
                  {state.kind === "failed" && state.error && (
                    <span className="max-w-xs truncate text-xs text-white/55">{state.error}</span>
                  )}
                  <button
                    onClick={onRetry}
                    className="rounded-full border border-white/40 bg-white/10 px-4 py-1 text-sm text-white backdrop-blur transition-colors hover:bg-white/20"
                  >
                    再拍一次
                  </button>
                </div>
              )}
              {state.kind === "idle" && <span className="text-white/60">{next.video ? "马上开始" : "排队中"}</span>}
            </div>
          </div>
          {total > 1 && (
            <div className="mt-3 flex gap-1" aria-hidden="true">
              {Array.from({ length: total }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full ${
                    i < done ? "bg-white/90" : i === done && running ? "animate-pulse bg-white/50" : "bg-white/20"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
