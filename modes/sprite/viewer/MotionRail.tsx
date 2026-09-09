/**
 * The left rail: who this character is made of.
 *
 * Two lists, both in DECLARED order — the sidecar's order is the agent's
 * order, and sorting either one here would quietly disagree with every
 * `<viewer-locator>` card and every "the third motion" in the conversation.
 *
 * The rail is also where a motion's trouble is visible without opening it:
 * the status chip and, when `motion.inspect` came back with something to say,
 * an amber warning mark. That report is the cheap deterministic channel — the
 * user should not have to play a motion to find out the pipeline flagged it.
 */

import type { CharacterProject, Motion, MotionStatus } from "../domain.js";
import { resolveAssetUri } from "../domain.js";
import { WarnIcon } from "./icons.js";
import { contentUrl } from "./urls.js";

const STATUS_STYLE: Record<MotionStatus, string> = {
  planned: "border-cc-border text-cc-muted",
  generating: "border-cc-primary/40 text-cc-primary",
  processing: "border-cc-primary/40 text-cc-primary",
  ready: "border-cc-success/40 text-cc-success",
  failed: "border-cc-error/50 text-cc-error",
};

export function StatusChip({ status }: { status: MotionStatus }) {
  const pulsing = status === "generating" || status === "processing";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLE[status]}`}
    >
      {pulsing ? (
        <span className="h-1 w-1 rounded-full bg-current motion-safe:animate-pulse" />
      ) : null}
      {status}
    </span>
  );
}

/** A transparent asset needs a backing pattern or it reads as missing. */
const CHECKER_STYLE = {
  backgroundImage:
    "linear-gradient(45deg, rgba(128,128,128,0.18) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.18) 75%), linear-gradient(45deg, rgba(128,128,128,0.18) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.18) 75%)",
  backgroundSize: "12px 12px",
  backgroundPosition: "0 0, 6px 6px",
};

export interface MotionRailProps {
  project: CharacterProject;
  imageVersion: number;
  selectedMotionId: string | null;
  selectedRefId: string | null;
  onSelectMotion: (motionId: string) => void;
  onSelectRef: (refId: string) => void;
}

export function MotionRail({
  project,
  imageVersion,
  selectedMotionId,
  selectedRefId,
  onSelectMotion,
  onSelectRef,
}: MotionRailProps) {
  const { refs, motions } = project.sprite;

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-cc-border bg-cc-surface/30 px-3 py-3">
      <section>
        <h2 className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cc-muted">
          References
        </h2>
        {refs.length === 0 ? (
          <p className="px-1 text-xs leading-relaxed text-cc-muted">
            No identity references yet. They are what keeps every motion sheet
            on model.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {refs.map((ref) => {
              const uri = resolveAssetUri(project, ref.asset);
              const active = selectedRefId === ref.id;
              return (
                <li key={ref.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRef(ref.id)}
                    title={`${ref.label} — ${ref.role}`}
                    className={`group flex w-full flex-col gap-1 rounded-lg border p-1 text-left transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
                      active
                        ? "border-cc-primary/60 bg-cc-primary/10"
                        : "border-cc-border bg-cc-bg/40 hover:border-cc-primary/40"
                    }`}
                  >
                    <span
                      className="flex h-16 w-full items-center justify-center overflow-hidden rounded"
                      style={CHECKER_STYLE}
                    >
                      {uri ? (
                        <img
                          src={contentUrl(project.contentSet, uri, imageVersion)}
                          alt={ref.label}
                          className="max-h-16 max-w-full object-contain"
                          style={{ imageRendering: "pixelated" }}
                          draggable={false}
                        />
                      ) : (
                        <span className="text-[10px] text-cc-muted">missing</span>
                      )}
                    </span>
                    <span className="truncate px-0.5 text-[11px] text-cc-fg">
                      {ref.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="min-h-0">
        <h2 className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cc-muted">
          Motions
        </h2>
        {motions.length === 0 ? (
          <p className="px-1 text-xs leading-relaxed text-cc-muted">
            No motions yet. Ask for one — idle, walk, attack.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {motions.map((motion) => (
              <MotionRow
                key={motion.id}
                motion={motion}
                active={selectedMotionId === motion.id && !selectedRefId}
                onSelect={() => onSelectMotion(motion.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </nav>
  );
}

function MotionRow({
  motion,
  active,
  onSelect,
}: {
  motion: Motion;
  active: boolean;
  onSelect: () => void;
}) {
  const warnings = motion.inspect?.warnings.length ?? 0;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${
          active
            ? "border-cc-primary/60 bg-cc-primary/10"
            : "border-transparent hover:border-cc-border hover:bg-cc-hover"
        }`}
      >
        <span className="flex items-center gap-1.5">
          <span className="flex-1 truncate text-[13px] text-cc-fg">
            {motion.label}
          </span>
          {warnings > 0 ? (
            <span
              className="text-cc-warning"
              title={motion.inspect?.warnings.join("\n")}
            >
              <WarnIcon size={12} />
            </span>
          ) : null}
          <StatusChip status={motion.status} />
        </span>
        <span className="text-[11px] text-cc-muted">
          {motion.grid.cols}×{motion.grid.rows} · {motion.frames.length} frame
          {motion.frames.length === 1 ? "" : "s"} · {motion.fps} fps ·{" "}
          {motion.loop ? "loop" : "once"}
        </span>
      </button>
    </li>
  );
}
