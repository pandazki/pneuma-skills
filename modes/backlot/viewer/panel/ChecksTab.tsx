/**
 * Checks — the acceptance record, grouped by what it is about.
 *
 * Three statuses and three visibly different chips. `unverified` is NOT
 * green and never reads as "fine": a check nobody looked at is the most
 * common way a bad greybox gets sent to a paid model (invariant 4). A check
 * with a range is clickable — it seeks the playhead to its start, marks the
 * span and switches the stage to the lane the check is about, so "the hand
 * stops 6 cm short" arrives with its own frame.
 */

import type { Check, Shot } from "../../domain.js";
import { checkTally, checkTargets } from "../../domain.js";
import { AlertIcon, CheckIcon, CrossIcon, QuestionIcon } from "../icons.js";
import { formatSeconds, takeLabel } from "../stage-model.js";

export interface ChecksTabProps {
  shot: Shot;
  onFocusCheck: (check: Check) => void;
}

export function ChecksTab({ shot, onFocusCheck }: ChecksTabProps) {
  const targets = checkTargets(shot.checks);

  return (
    <div className="flex flex-col gap-3">
      {shot.stuck.length > 0 ? (
        <section className="rounded-md border border-cc-error/50 bg-cc-error/10 px-2.5 py-2">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-cc-error">
            <AlertIcon size={11} />
            Stuck — the same defect on two revisions
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-cc-fg">
            {shot.stuck.join(", ")} failed again after a re-render. Another render is not the
            answer; the blocking needs a different approach.
          </p>
        </section>
      ) : null}

      {shot.checks.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-cc-muted">
          No acceptance list yet. Press <em>Check this greybox</em> and the agent will seed the
          standard checks and go through them.
        </p>
      ) : null}

      {targets.map((target) => {
        const checks = shot.checks.filter((c) => c.target === target);
        const tally = checkTally(checks);
        return (
          <section key={target}>
            <header className="flex items-baseline gap-2">
              <h3 className="text-[11px] font-medium text-cc-fg">
                {target === "greybox" ? "Greybox" : takeLabel(target)}
              </h3>
              <span className="text-[10px] tabular-nums text-cc-muted">
                {tally.pass} pass · {tally.fail} fail · {tally.unverified} unverified
              </span>
            </header>
            <ul className="mt-1 flex flex-col gap-1">
              {checks.map((check) => (
                <li key={check.id}>
                  <CheckRow check={check} onFocus={onFocusCheck} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function CheckRow({ check, onFocus }: { check: Check; onFocus: (check: Check) => void }) {
  const clickable = check.range !== null;
  return (
    <button
      type="button"
      onClick={() => onFocus(check)}
      disabled={!clickable}
      title={
        clickable
          ? `Seek to ${formatSeconds(check.range![0])} s and show ${check.target}`
          : "This check has no time range"
      }
      className={`w-full rounded-md border border-cc-border bg-cc-card px-2 py-1.5 text-left transition-colors ${
        clickable ? "hover:border-cc-primary/40" : "cursor-default"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <StatusChip status={check.status} />
        <span className="min-w-0 flex-1 truncate text-[11px] text-cc-fg">{check.label}</span>
        {check.range ? (
          <span className="shrink-0 text-[9px] tabular-nums text-cc-muted">
            {formatSeconds(check.range[0])}–{formatSeconds(check.range[1])} s
          </span>
        ) : null}
      </div>
      {check.note ? (
        <p className="mt-0.5 text-[10px] leading-relaxed text-cc-muted">{check.note}</p>
      ) : null}
      {check.history.length > 0 ? (
        <p className="mt-0.5 text-[9px] text-cc-muted/80">
          {check.history
            .map((entry) => `rev ${entry.revision}: ${entry.status}${entry.note ? ` — ${entry.note}` : ""}`)
            .join(" · ")}
        </p>
      ) : null}
    </button>
  );
}

export function StatusChip({ status }: { status: Check["status"] }) {
  if (status === "pass") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cc-success/40 bg-cc-success/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-cc-success">
        <CheckIcon size={9} />
        pass
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cc-error/50 bg-cc-error/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-cc-error">
        <CrossIcon size={9} />
        fail
      </span>
    );
  }
  // Deliberately loud-ish and deliberately not green: an unverified check is
  // an open question, not a pass with a different colour.
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cc-warning/50 bg-cc-warning/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-cc-warning">
      <QuestionIcon size={9} />
      unverified
    </span>
  );
}

export default ChecksTab;
