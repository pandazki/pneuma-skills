/**
 * How a shot is conditioned, in one chip.
 *
 * It is a SHOT-PLAN decision — greybox, free or hybrid — and it decides
 * what the take is made from: whether the block is sent at all, whether a
 * greybox is even expected, and what `take-camera` is judged against. The
 * creator has to be able to read it off a card without opening anything, so
 * the same chip appears on the shot plan, on the rail, on the cut's segment
 * strip and in the Plan tab, with one word and one sentence from
 * `domain.conditioningChip`.
 *
 * `greybox` is the default and wears the neutral tone: the chip is there to
 * make the EXCEPTIONS visible, and colouring the normal case would only
 * make three quarters of a shot list shout.
 */

import type { Shot, ShotConditioning } from "../domain.js";
import { conditioningChip } from "../domain.js";

export interface ConditioningChipProps {
  shot: Shot | ShotConditioning;
  /** For the cut's segment strip: no border, tighter, inline in a 24 px row. */
  compact?: boolean;
}

const TONE: Record<ShotConditioning, string> = {
  greybox: "border-cc-border text-cc-muted",
  free: "border-cc-primary/50 bg-cc-primary/10 text-cc-primary",
  hybrid: "border-cc-warning/45 bg-cc-warning/10 text-cc-warning",
};

const COMPACT_TONE: Record<ShotConditioning, string> = {
  greybox: "bg-black/40 text-white/70",
  free: "bg-cc-primary/30 text-cc-fg",
  hybrid: "bg-cc-warning/30 text-cc-fg",
};

export function ConditioningChip({ shot, compact = false }: ConditioningChipProps) {
  const chip = conditioningChip(shot);
  if (compact) {
    return (
      <span
        title={chip.title}
        className={`ml-1 shrink-0 rounded px-1 text-[8px] uppercase tracking-wide ${COMPACT_TONE[chip.id]}`}
      >
        {chip.label}
      </span>
    );
  }
  return (
    <span
      title={chip.title}
      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${TONE[chip.id]}`}
    >
      {chip.label}
    </span>
  );
}

export default ConditioningChip;
