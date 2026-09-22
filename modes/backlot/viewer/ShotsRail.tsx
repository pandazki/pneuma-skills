/**
 * The shots rail — the film, and the only navigation control.
 *
 * One card per shot with a poster frame, its title, its length and four
 * stage dots: plan · greybox · accepted · take. The dots are read from the
 * same helpers the panel uses (`shotStages`), so the rail cannot show a shot
 * as accepted while the Checks tab shows a failure.
 */

import type { Shot } from "../domain.js";
import { shotStages } from "../domain.js";
import { ConditioningChip } from "./ConditioningChip.js";
import { CheckIcon } from "./icons.js";

export interface ShotsRailProps {
  shots: Shot[];
  selected: string | null;
  onSelect: (shotId: string) => void;
  projectTitle: string;
  /** Shot-relative path → `/content/…` URL for that shot. */
  urlFor: (shot: Shot, path: string | null, revision: number) => string | null;
}

const STAGE_LABEL: Array<[keyof ReturnType<typeof shotStages>, string]> = [
  ["plan", "plan"],
  ["greybox", "greybox"],
  ["accepted", "accepted"],
  ["take", "take"],
];

export function ShotsRail({ shots, selected, onSelect, projectTitle, urlFor }: ShotsRailProps) {
  return (
    <nav className="flex w-44 shrink-0 flex-col border-r border-cc-border bg-cc-surface/30 backdrop-blur">
      <header className="shrink-0 border-b border-cc-border px-3 py-2">
        <h2 className="truncate text-[11px] font-medium text-cc-fg">{projectTitle}</h2>
        <p className="text-[10px] text-cc-muted">
          {shots.length} shot{shots.length === 1 ? "" : "s"}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {shots.length === 0 ? (
          <p className="px-1 text-[10px] leading-relaxed text-cc-muted">
            No shots yet. Ask the agent for one and it will scaffold the plan, the Blender script
            and the acceptance list together.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shots.map((shot, index) => (
              <li key={shot.id}>
                <ShotCard
                  shot={shot}
                  index={index}
                  active={shot.id === selected}
                  onSelect={onSelect}
                  urlFor={urlFor}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

function ShotCard({
  shot,
  index,
  active,
  onSelect,
  urlFor,
}: {
  shot: Shot;
  index: number;
  active: boolean;
  onSelect: (id: string) => void;
  urlFor: ShotsRailProps["urlFor"];
}) {
  const stages = shotStages(shot);
  const greybox = shot.greybox.final;
  // The poster is the greybox's own first second, asked for with a media
  // fragment and `preload="metadata"` — one range request, no second file to
  // generate, and it is a frame of the shot rather than a contact sheet cell
  // whose grid the rail would have to guess at.
  const posterUrl = greybox
    ? urlFor(shot, greybox.file, greybox.revision)
    : shot.reference
      ? urlFor(shot, shot.reference.file, shot.greybox.revision)
      : null;
  const sheetUrl = urlFor(shot, shot.greybox.sheet, shot.greybox.revision);

  return (
    <button
      type="button"
      onClick={() => onSelect(shot.id)}
      aria-pressed={active}
      className={`w-full overflow-hidden rounded-md border text-left transition-colors ${
        active
          ? "border-cc-primary/50 bg-cc-primary/10"
          : "border-cc-border bg-cc-card hover:border-cc-primary/30"
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-black/50">
        {posterUrl ? (
          <video
            src={`${posterUrl}#t=0.6`}
            preload="metadata"
            muted
            playsInline
            className="h-full w-full object-cover"
          />
        ) : sheetUrl ? (
          <img
            src={sheetUrl}
            alt=""
            className="h-full w-full object-cover object-left-top"
            loading="lazy"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[10px] text-cc-muted">
            not rendered
          </span>
        )}
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] tabular-nums text-white/90">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[9px] tabular-nums text-white/90">
          {shot.spec.seconds.toFixed(1)} s
        </span>
      </div>
      <div className="px-2 py-1.5">
        <p className="truncate text-[11px] leading-tight text-cc-fg">{shot.title}</p>
        <div className="flex items-center gap-1">
          <p className="min-w-0 truncate text-[9px] text-cc-muted">{shot.id}</p>
          {/* The plan's conditioning decision, where the rail can show it
              without another row: a free shot has no greybox lane to miss. */}
          <ConditioningChip shot={shot} />
        </div>
        <div className="mt-1 flex items-center gap-1">
          {STAGE_LABEL.map(([key, label]) => (
            <span
              key={key}
              title={`${label}: ${stages[key] ? "done" : "not yet"}`}
              className={`flex h-2 w-2 items-center justify-center rounded-full ${
                stages[key] ? "bg-cc-primary" : "bg-cc-border"
              }`}
            />
          ))}
          {shot.stuck.length > 0 ? (
            <span className="ml-auto text-[9px] text-cc-error">stuck</span>
          ) : stages.accepted ? (
            <span className="ml-auto text-cc-success">
              <CheckIcon size={10} />
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export default ShotsRail;
