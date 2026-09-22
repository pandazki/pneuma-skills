/**
 * Cost — what this shot cost, what the whole film has cost, and the table the
 * take prices were computed from.
 *
 * Every number here is one a script wrote down beside the artefact it paid
 * for — `domain.ts` only sums them. A panel that re-derived a price would
 * eventually disagree with the script that actually paid. It is an ESTIMATE
 * at list price unless the vendor reported its own figure, and a submitted
 * take counts: the job is charged whether or not its file ever arrives.
 */

import type { CostLine, Project, Shot, StageId } from "../../domain.js";
import { stageLabel, totalCost } from "../../domain.js";
import { PRICES_AS_OF, PRICE_BASIS, SEEDANCE_PRICE_TABLE } from "../prices.js";
import { takeLabel } from "../player-model.js";
import { TakeStatusChip } from "./TakesTab.js";

export interface CostTabProps {
  shot: Shot;
  /** Every shot in the project, for the film total. */
  allShots: Shot[];
  /** The whole project, for the by-stage summary. */
  project: Project;
}

const usd = (value: number): string => `$${value.toFixed(2)}`;

function shotTotal(shot: Shot): number {
  return (
    shot.takes.reduce((sum, take) => sum + (take.cost?.usd ?? 0), 0) +
    (shot.board?.cost?.usd ?? 0) +
    shot.lines.reduce((sum, line) => sum + (line.cost?.usd ?? 0), 0)
  );
}

export function CostTab({ shot, allShots, project }: CostTabProps) {
  const total = shotTotal(shot);
  const filmTotal = totalCost(project.cost);
  const unpriced = shot.takes.filter((t) => t.cost === null);
  const byStage = project.stages.filter((stage) => stage.usd > 0);

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-md border border-cc-border bg-cc-card px-2.5 py-2">
        <div className="flex items-baseline">
          <span className="text-[11px] text-cc-muted">This shot</span>
          <span className="ml-auto text-base font-semibold tabular-nums text-cc-fg">
            {usd(total)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline text-[11px]">
          <span className="text-cc-muted">
            The whole film · {allShots.length} shot{allShots.length === 1 ? "" : "s"}
          </span>
          <span className="ml-auto tabular-nums text-cc-fg">{usd(filmTotal)}</span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-cc-muted">
          Estimate at list price, from what the script priced before it submitted. A submitted
          take counts: the job is paid on acceptance, not on delivery.
          {unpriced.length > 0
            ? ` ${unpriced.length} take(s) carry no recorded price and are not in the total.`
            : ""}
        </p>
      </section>

      <section>
        <h3 className="text-[11px] font-medium text-cc-fg">By stage</h3>
        {byStage.length === 0 ? (
          <p className="mt-1 text-[10px] leading-relaxed text-cc-muted">
            Nothing has been paid for yet. Images, voices, takes and music are recorded here the
            moment they are requested.
          </p>
        ) : (
          <table className="mt-1 w-full text-[10px]">
            <tbody>
              {byStage.map((stage) => (
                <tr key={stage.id} className="border-t border-cc-border/60 text-cc-fg">
                  <td className="py-1">{stageLabel(stage.id as StageId)}</td>
                  <td className="py-1 text-right tabular-nums">{usd(stage.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {project.cost.length > 0 ? (
        <section>
          <h3 className="text-[11px] font-medium text-cc-fg">Every paid call</h3>
          <ul className="mt-1 flex flex-col gap-1">
            {project.cost.map((line, index) => (
              <CostRow key={`${line.ref}:${index}`} line={line} />
            ))}
          </ul>
        </section>
      ) : null}

      {shot.takes.length > 0 ? (
        <section>
          <h3 className="text-[11px] font-medium text-cc-fg">Per take</h3>
          <table className="mt-1 w-full text-[10px]">
            <thead>
              <tr className="text-left text-cc-muted">
                <th className="py-1 font-normal">Take</th>
                <th className="py-1 font-normal">Status</th>
                <th className="py-1 text-right font-normal">Res</th>
                <th className="py-1 text-right font-normal">Sec</th>
                <th className="py-1 text-right font-normal">$</th>
              </tr>
            </thead>
            <tbody>
              {shot.takes.map((take) => (
                <tr key={take.id} className="border-t border-cc-border/60 text-cc-fg">
                  <td className="py-1">{takeLabel(take.id)}</td>
                  <td className="py-1">
                    <TakeStatusChip status={take.status} />
                  </td>
                  <td className="py-1 text-right tabular-nums">{take.resolution || "—"}</td>
                  <td className="py-1 text-right tabular-nums">
                    {take.seconds ?? "—"}
                    {take.refSeconds ? ` +${take.refSeconds}` : ""}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {take.cost ? usd(take.cost.usd) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section>
        <h3 className="text-[11px] font-medium text-cc-fg">Seedance 2.5 · per second</h3>
        <table className="mt-1 w-full text-[10px]">
          <thead>
            <tr className="text-left text-cc-muted">
              <th className="py-1 font-normal">Resolution</th>
              <th className="py-1 text-right font-normal">with a reference</th>
              <th className="py-1 text-right font-normal">no reference</th>
            </tr>
          </thead>
          <tbody>
            {SEEDANCE_PRICE_TABLE.map((row) => (
              <tr key={row.resolution} className="border-t border-cc-border/60 text-cc-fg">
                <td className="py-1">{row.resolution}</td>
                <td className="py-1 text-right tabular-nums">
                  {row.withReference === null ? "—" : `$${row.withReference.toFixed(4)}`}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {row.withoutReference === null ? "—" : `$${row.withoutReference.toFixed(4)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-[10px] leading-relaxed text-cc-muted">
          {PRICE_BASIS}. Read {PRICES_AS_OF}; the script's own table is the authority.
        </p>
      </section>
    </div>
  );
}

/**
 * One paid call: what it was, what it cost, and where that figure came from.
 *
 * `usd: null` means UNPRICED — the call was made and recorded, but nobody
 * wrote down what it cost. It is shown as a dash and left out of every total,
 * because inventing a number for it would be the one thing a bill must not do.
 */
function CostRow({ line }: { line: CostLine }) {
  return (
    <li
      className="flex items-baseline gap-2 border-t border-cc-border/60 py-1 text-[10px]"
      title={line.ref}
    >
      <span className="shrink-0 rounded-full border border-cc-border px-1 text-[8px] uppercase tracking-wide text-cc-muted">
        {line.kind}
      </span>
      <span className="min-w-0 flex-1 truncate text-cc-fg">{line.label}</span>
      <span
        className={`shrink-0 tabular-nums ${line.usd === null ? "text-cc-muted" : "text-cc-fg"}`}
      >
        {line.usd === null ? "—" : usd(line.usd)}
      </span>
      <span className="shrink-0 text-[8px] uppercase tracking-wide text-cc-muted/80">
        {line.source ?? "unpriced"}
      </span>
    </li>
  );
}

export default CostTab;
