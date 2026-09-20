/**
 * Cost — what this shot has cost, and the table it was computed from.
 *
 * Every number here is the one `previz.mjs` wrote into `shot.json` when it
 * priced the job, not a second calculation: a panel that re-derived the price
 * would eventually disagree with the script that actually paid. It is an
 * ESTIMATE at list price and the panel says so on every render — a submitted
 * take has been charged for whether or not its file ever arrives, which is
 * why it is counted here too.
 */

import type { Shot } from "../../domain.js";
import { PRICES_AS_OF, PRICE_BASIS, SEEDANCE_PRICE_TABLE } from "../prices.js";
import { takeLabel } from "../stage-model.js";
import { TakeStatusChip } from "./TakesTab.js";

export interface CostTabProps {
  shot: Shot;
  /** Every shot in the project, for the film total. */
  allShots: Shot[];
}

const usd = (value: number): string => `$${value.toFixed(2)}`;

function shotTotal(shot: Shot): number {
  return shot.takes.reduce((sum, take) => sum + (take.cost?.usd ?? 0), 0);
}

export function CostTab({ shot, allShots }: CostTabProps) {
  const total = shotTotal(shot);
  const filmTotal = allShots.reduce((sum, s) => sum + shotTotal(s), 0);
  const unpriced = shot.takes.filter((t) => t.cost === null);

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
            Every shot in the film · {allShots.length} shot{allShots.length === 1 ? "" : "s"}
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

export default CostTab;
