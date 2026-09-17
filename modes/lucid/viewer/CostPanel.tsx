/**
 * The cost panel — what this loop has spent, in total and per round.
 *
 * A heavy mode deserves a bill: every fal job priced by endpoint and option,
 * every image generation, the model's tokens. All of it is an ESTIMATE at
 * public list price and the panel says so on every render, because a
 * subscription pays for the model in quota, not dollars, and a job the price
 * table does not know is shown as unpriced rather than free. Per-round rows
 * attribute the jobs and images that landed between two captures; tokens
 * are cumulative only and stay at the session level.
 */

import type { CostSummary } from "../skill/scripts/costs.mjs";
import { CloseIcon } from "./icons.js";

export interface CostPanelProps {
  summary: CostSummary;
  open: boolean;
  onClose: () => void;
}

const usd = (value: number | null): string => (value === null ? "—" : `$${value.toFixed(2)}`);
const count = (value: number): string => value.toLocaleString();

export function CostPanel({ summary, open, onClose }: CostPanelProps) {
  if (!open) return null;
  const { fal, images, tokens, byRound } = summary;
  const tokenTotal = tokens.usage ? tokens.usage.input_tokens + tokens.usage.output_tokens : null;
  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-80 max-w-[85%] flex-col border-l border-cc-border bg-cc-surface/95 backdrop-blur">
      <header className="flex shrink-0 items-center gap-2 border-b border-cc-border px-3 py-2">
        <h2 className="text-xs font-medium text-cc-fg">Cost</h2>
        <span className="text-[11px] text-cc-muted">estimate · list price</span>
        <button
          type="button"
          onClick={onClose}
          title="Close the cost panel"
          className="ml-auto rounded p-1 text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:ring-2 focus-visible:ring-cc-primary/60"
        >
          <CloseIcon size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className="rounded-md border border-cc-border bg-cc-card px-2.5 py-2">
          <div className="flex items-baseline">
            <span className="text-[11px] text-cc-muted">Total so far</span>
            <span className="ml-auto text-base font-semibold tabular-nums text-cc-fg">{usd(summary.total)}</span>
          </div>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-cc-muted">
              image-to-3D · {count(fal.count)} job{fal.count === 1 ? "" : "s"}
              {fal.unpriced.length > 0 && (
                <span className="text-cc-warning"> · {fal.unpriced.length} unpriced</span>
              )}
            </dt>
            <dd className="text-right tabular-nums text-cc-fg">{usd(fal.usd)}</dd>
            <dt className="text-cc-muted">image generations · {count(images.count)}</dt>
            <dd className="text-right tabular-nums text-cc-fg">{usd(images.usd)}</dd>
            <dt className="text-cc-muted">
              model tokens{tokenTotal !== null ? ` · ${formatTokens(tokenTotal)}` : ""}
              {tokens.usage && !tokens.priced && <span> · no price for {tokens.model || "this model"}</span>}
            </dt>
            <dd className="text-right tabular-nums text-cc-fg">{tokens.usage ? usd(tokens.usd) : "—"}</dd>
          </dl>
          {tokens.usage && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-cc-muted">
              input {formatTokens(tokens.usage.input_tokens)} · cached {formatTokens(tokens.usage.cached_input_tokens)} · output{" "}
              {formatTokens(tokens.usage.output_tokens)}
              {tokens.model ? ` · ${tokens.model}` : ""}
            </p>
          )}
        </div>

        {byRound.length > 0 && (
          <table className="mt-3 w-full text-[11px]">
            <thead>
              <tr className="text-left text-cc-muted">
                <th className="py-1 font-normal">Round</th>
                <th className="py-1 text-right font-normal">Score</th>
                <th className="py-1 text-right font-normal">3D</th>
                <th className="py-1 text-right font-normal">Images</th>
                <th className="py-1 text-right font-normal">$</th>
              </tr>
            </thead>
            <tbody>
              {byRound.map((row) => (
                <tr key={row.index ?? "tail"} className="border-t border-cc-border/60 text-cc-fg">
                  <td className="py-1">{row.index === null ? "in progress" : `${row.index}`}</td>
                  <td className="py-1 text-right tabular-nums">{row.score === null ? "—" : row.score.toFixed(2)}</td>
                  <td className="py-1 text-right tabular-nums">{row.fal.count}</td>
                  <td className="py-1 text-right tabular-nums">{row.images.count}</td>
                  <td className="py-1 text-right tabular-nums">{usd(row.fal.usd + row.images.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {fal.jobs.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {fal.jobs.map((job, i) => (
              <li key={`${job.id ?? "job"}-${i}`} className="flex items-baseline gap-2 text-[11px]">
                <span className="min-w-0 truncate text-cc-fg">{job.id ?? "?"}</span>
                <span className="min-w-0 truncate text-cc-muted">{job.endpoint?.replace(/^.*\//, "") ?? ""}</span>
                <span className="ml-auto shrink-0 tabular-nums text-cc-muted">{job.state ?? ""}</span>
                <span className="shrink-0 tabular-nums text-cc-fg">{usd(job.usd)}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-[10px] leading-relaxed text-cc-muted">
          {summary.basis}. Prices as of {summary.asOf}; image generations at a flat ${summary.images.count >= 0 ? (summary.images.usd / Math.max(1, summary.images.count) || 0.15).toFixed(2) : "0.15"} each.
        </p>
      </div>
    </aside>
  );
}

/** 17,393,159 → "17.4M"; 48,712 → "48.7k"; below a thousand, the number. */
function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
