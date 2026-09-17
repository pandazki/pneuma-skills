/**
 * The status strip — what the loop and the scene each say about themselves.
 *
 * The exit verdict is `lucid.mjs`'s, shown verbatim; the vitals are the
 * scene bridge's; the clock is the only number this viewer derives. Nothing
 * here is recomputed from the round history, because two authorities for
 * "are we done" is how a viewer starts contradicting the agent.
 */

import { AlertIcon } from "./icons.js";
import type { StatusChip, StatusTone } from "./stage.js";

const TONE_CLASS: Record<StatusTone, string> = {
  idle: "border-cc-border text-cc-muted",
  active: "border-cc-primary/40 bg-cc-primary/10 text-cc-primary",
  good: "border-cc-success/40 bg-cc-success/10 text-cc-success",
  warn: "border-cc-warning/40 bg-cc-warning/10 text-cc-warning",
  bad: "border-cc-error/40 bg-cc-error/10 text-cc-error",
};

export interface StatusStripProps {
  chip: StatusChip;
  /** `"58 fps · 17.2 ms · 84k tris · 6 textures"`, or "" when unmeasured. */
  vitals: string;
  /** `"42 min left"`, or null when no budget is running. */
  budget: string | null;
  warnings: string[];
  /** The verdict is withheld for the first seconds after a load. */
  bridgeKnown: boolean;
  bridgeOk: boolean;
}

export function StatusStrip({
  chip,
  vitals,
  budget,
  warnings,
  bridgeKnown,
  bridgeOk,
}: StatusStripProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-cc-border bg-cc-surface/40 px-3 py-1.5 text-[11px] backdrop-blur">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${TONE_CLASS[chip.tone]}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {chip.label}
      </span>

      {vitals ? (
        <span className="tabular-nums text-cc-muted">{vitals}</span>
      ) : (
        <span className="text-cc-muted">
          {bridgeKnown && !bridgeOk ? "unmeasured" : "measuring…"}
        </span>
      )}

      {budget ? <span className="tabular-nums text-cc-muted">{budget}</span> : null}

      {warnings.length > 0 ? (
        <span
          className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-cc-warning"
          title={warnings.join("\n")}
        >
          <AlertIcon size={12} />
          <span className="truncate">{warnings[0]}</span>
          {warnings.length > 1 ? (
            <span className="shrink-0 text-cc-muted">+{warnings.length - 1}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export default StatusStrip;
