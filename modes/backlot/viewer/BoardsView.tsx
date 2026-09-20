/**
 * The boards — the shot list as a strip of frames.
 *
 * One card per shot in `backlot.json` order: the board frame (or a grey card
 * saying what is missing — never nothing), the scene it belongs to, the
 * title, its length, and a badge saying how far that shot has actually got.
 * The badge is read from the same helpers the shots rail and the Checks tab
 * use, so a shot cannot look accepted here and fail there.
 *
 * Clicking a card opens that shot on the previz stage, which is where the
 * work continues.
 */

import type { Project, Shot } from "../domain.js";
import { checkTally, selectedTake, shotStages } from "../domain.js";
import { ImageIcon } from "./icons.js";
import { StageEmpty } from "./StageEmpty.js";

export interface BoardsViewProps {
  project: Project;
  selected: string | null;
  /** Open the shot on the previz stage. */
  onOpenShot: (shot: string) => void;
  /** Shot-relative path → `/content/…` URL for that shot. */
  urlFor: (shot: Shot, path: string | null, rev: number | string) => string | null;
}

export function BoardsView({ project, selected, onOpenShot, urlFor }: BoardsViewProps) {
  if (project.shots.length === 0) {
    return <StageEmpty stage="boards" />;
  }
  const sceneOf = (shot: Shot): string | null => {
    const scene = project.scenes.find((s) => s.id === shot.scene);
    return scene ? String(scene.number).padStart(2, "0") : shot.scene;
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        {project.shots.map((shot, index) => (
          <li key={shot.id}>
            <BoardCard
              shot={shot}
              index={index}
              scene={sceneOf(shot)}
              active={shot.id === selected}
              onOpen={() => onOpenShot(shot.id)}
              urlFor={urlFor}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BoardCard({
  shot,
  index,
  scene,
  active,
  onOpen,
  urlFor,
}: {
  shot: Shot;
  index: number;
  scene: string | null;
  active: boolean;
  onOpen: () => void;
  urlFor: BoardsViewProps["urlFor"];
}) {
  const board = shot.board;
  const url = board ? urlFor(shot, board.file, board.revision) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={active}
      title={`${shot.title} — open on the previz stage`}
      className={`flex w-full flex-col overflow-hidden rounded-md border text-left transition-colors ${
        active ? "border-cc-primary/50 bg-cc-primary/10" : "border-cc-border bg-cc-card hover:border-cc-primary/30"
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-black/45">
        {url ? (
          <img src={url} alt={shot.title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-4 text-center text-cc-muted">
            <ImageIcon size={16} />
            <span className="text-[9px] leading-relaxed">
              No board frame yet — one concept frame per shot, generated from the bible.
            </span>
          </span>
        )}
        <span className="absolute left-1 top-1 rounded bg-black/65 px-1 text-[9px] tabular-nums text-white/90">
          {String(index + 1).padStart(2, "0")}
          {scene ? ` · sc ${scene}` : ""}
        </span>
        <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1 text-[9px] tabular-nums text-white/90">
          {shot.spec.seconds.toFixed(1)} s
        </span>
      </div>
      <div className="px-2.5 py-2">
        <p className="truncate text-[12px] leading-tight text-cc-fg">{shot.title}</p>
        <p className="truncate text-[9px] text-cc-muted">{shot.id}</p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <ShotBadge shot={shot} />
          {shot.lines.length > 0 ? (
            <span className="text-[9px] text-cc-muted">
              {shot.lines.length} line{shot.lines.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/**
 * How far this shot has got, in one chip.
 *
 * The rungs are the pipeline's own: planned → greybox with its check tally →
 * a take selected. `n/m checks` counts only the PASSES, because a check
 * nobody looked at is not a pass (invariant 4).
 */
export function ShotBadge({ shot }: { shot: Shot }) {
  const stages = shotStages(shot);
  const delivered = shot.takes.find((t) => t.selected && t.status === "done") ?? null;
  const pending = shot.takes.some((t) => t.status === "submitted");

  if (delivered) {
    return <Chip tone="success">{selectedTake(shot)?.id ?? "take"} selected</Chip>;
  }
  if (pending) return <Chip tone="primary">take in flight</Chip>;
  if (stages.greybox) {
    const tally = checkTally(shot.checks.filter((c) => c.target === "greybox"));
    const total = tally.pass + tally.fail + tally.unverified;
    return (
      <Chip tone={shot.stuck.length > 0 ? "error" : tally.fail > 0 ? "error" : "muted"}>
        greybox {tally.pass}/{total} checks
      </Chip>
    );
  }
  return <Chip tone="muted">{stages.plan ? "planned" : "not planned"}</Chip>;
}

function Chip({
  tone,
  children,
}: {
  tone: "success" | "primary" | "error" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "success"
      ? "border-cc-success/40 bg-cc-success/10 text-cc-success"
      : tone === "primary"
        ? "border-cc-primary/50 bg-cc-primary/10 text-cc-primary"
        : tone === "error"
          ? "border-cc-error/50 bg-cc-error/10 text-cc-error"
          : "border-cc-border text-cc-muted";
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${cls}`}
    >
      {children}
    </span>
  );
}

export default BoardsView;
