/**
 * The stage rail — the film's eight stages, across the top of everything.
 *
 * It is the only navigation between stages, and the only place approval is
 * asked for. Three things are drawn per stage and all three come from the
 * SAME derivation the scripts gate their spending with (`stage-state.mjs`
 * through `domain.ts`): the status, when it was approved, and what it cost.
 * A rail that computed its own idea of "approved" would eventually disagree
 * with the script that refuses to spend.
 *
 * `changed` is the status this rail exists for: the creator approved a
 * version, the files moved since, and nobody has looked at the new one. It is
 * drawn in the warning colour and offers the Approve button again.
 *
 * NOTHING HERE WRITES. Approve sends the agent a command; `backlot.mjs`
 * records the approval with the stage's content hash.
 */

import { useCallback, useRef } from "react";

import type { StageId, StageState } from "../domain.js";
import { stageLabel } from "../domain.js";
import { CheckIcon } from "./icons.js";

export interface StageRailProps {
  stages: StageState[];
  current: StageId;
  onSelect: (stage: StageId) => void;
  /** null when the session cannot send commands (replay, static player). */
  onApprove: ((stage: StageId) => void) | null;
  gates: "open" | "closed";
  title: string;
  /** Every paid call in the film, summed. */
  total: number;
}

const STATUS_LABEL: Record<StageState["status"], string> = {
  empty: "empty",
  draft: "draft",
  approved: "approved",
  changed: "changed",
};

const STATUS_CLASS: Record<StageState["status"], string> = {
  empty: "border-cc-border text-cc-muted",
  draft: "border-cc-primary/50 bg-cc-primary/10 text-cc-primary",
  approved: "border-cc-success/40 bg-cc-success/10 text-cc-success",
  changed: "border-cc-warning/55 bg-cc-warning/15 text-cc-warning",
};

export function StageRail({
  stages,
  current,
  onSelect,
  onApprove,
  gates,
  title,
  total,
}: StageRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);

  /**
   * Left / right move between stages.
   *
   * The handler sits on the rail, not on `window`: the player binds the same
   * two keys to stepping a frame, and a viewer with two window-level owners
   * of ArrowRight is a coin toss. `stopPropagation` keeps the event from
   * reaching the player's listener while a rail tab has focus.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const index = stages.findIndex((s) => s.id === current);
      if (index < 0) return;
      const next = event.key === "ArrowLeft" ? index - 1 : index + 1;
      if (next < 0 || next >= stages.length) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect(stages[next].id);
      const tabs = railRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      tabs?.[next]?.focus();
    },
    [current, onSelect, stages],
  );

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-cc-border bg-cc-surface/40 px-3 py-1.5 backdrop-blur">
      <div className="min-w-0 max-w-[12rem] shrink-0">
        <h1 className="truncate text-[12px] font-medium text-cc-fg" title={title}>
          {title}
        </h1>
        <p className="text-[9px] uppercase tracking-wide text-cc-muted">
          {gates === "open" ? "gates open" : "gates closed"}
        </p>
      </div>

      <div
        ref={railRef}
        role="tablist"
        aria-label="Film stages"
        onKeyDown={onKeyDown}
        className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto"
      >
        {stages.map((stage, index) => (
          <StageChip
            key={stage.id}
            stage={stage}
            index={index}
            active={stage.id === current}
            onSelect={onSelect}
            onApprove={onApprove}
          />
        ))}
      </div>

      <div className="shrink-0 text-right">
        <p className="text-[11px] tabular-nums text-cc-fg">${total.toFixed(2)}</p>
        <p className="text-[9px] uppercase tracking-wide text-cc-muted">spent</p>
      </div>
    </header>
  );
}

function StageChip({
  stage,
  index,
  active,
  onSelect,
  onApprove,
}: {
  stage: StageState;
  index: number;
  active: boolean;
  onSelect: (stage: StageId) => void;
  onApprove: ((stage: StageId) => void) | null;
}) {
  const label = stageLabel(stage.id);
  const approvable = stage.status === "draft" || stage.status === "changed";
  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-1 transition-colors ${
        active ? "border-cc-primary/50 bg-cc-primary/10" : "border-transparent hover:bg-cc-hover"
      }`}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        onClick={() => onSelect(stage.id)}
        title={
          stage.approvedAt
            ? `${label} · ${STATUS_LABEL[stage.status]} · approved ${new Date(stage.approvedAt).toLocaleString()}`
            : `${label} · ${STATUS_LABEL[stage.status]}`
        }
        className="flex flex-col items-start gap-0.5 text-left"
      >
        <span className="flex items-center gap-1 text-[11px] leading-none">
          <span className="tabular-nums text-cc-muted">{index + 1}</span>
          <span className={active ? "text-cc-fg" : "text-cc-muted"}>{label}</span>
        </span>
        <span className="flex items-center gap-1">
          <span
            className={`rounded-full border px-1 py-px text-[8px] uppercase tracking-wide ${STATUS_CLASS[stage.status]}`}
          >
            {STATUS_LABEL[stage.status]}
          </span>
          {stage.usd > 0 ? (
            <span className="text-[9px] tabular-nums text-cc-muted">${stage.usd.toFixed(2)}</span>
          ) : null}
        </span>
      </button>

      {approvable && onApprove ? (
        active ? (
          <button
            type="button"
            onClick={() => onApprove(stage.id)}
            title={`Tell the agent you approve the ${label} stage`}
            className="shrink-0 rounded-full border border-cc-success/50 bg-cc-success/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-cc-success transition-colors hover:bg-cc-success/20 focus-visible:ring-2 focus-visible:ring-cc-success/60"
          >
            Approve
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onApprove(stage.id)}
            title={`Approve the ${label} stage`}
            aria-label={`Approve the ${label} stage`}
            className="shrink-0 rounded-full border border-cc-border p-1 text-cc-muted transition-colors hover:border-cc-success/50 hover:text-cc-success focus-visible:ring-2 focus-visible:ring-cc-success/60"
          >
            <CheckIcon size={9} />
          </button>
        )
      ) : null}
    </div>
  );
}

export default StageRail;
