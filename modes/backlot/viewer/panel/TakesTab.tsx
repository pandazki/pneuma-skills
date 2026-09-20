/**
 * Takes — one card per generated video, in submission order.
 *
 * The card is the take's whole record: which model and endpoint, what
 * resolution and length were ASKED for, what ffprobe MEASURED, the request
 * id, the price, the named defect the take was made to fix, and whether it is
 * the one the shot delivers. A take that is still `submitted` shows that and
 * its estimate; a `failed` one shows why. Paid work is recorded before it
 * leaves, so a card exists for a request whose file never arrived
 * (invariant 6).
 */

import type { Shot, Take } from "../../domain.js";
import { probeFacts, takeLabel } from "../player-model.js";

export interface TakesTabProps {
  shot: Shot;
  selectedLaneTake: string | null;
  onShowTake: (id: string) => void;
}

export function TakesTab({ shot, selectedLaneTake, onShowTake }: TakesTabProps) {
  if (shot.takes.length === 0) {
    return (
      <p className="text-[11px] leading-relaxed text-cc-muted">
        No takes yet. A take is generated from the greybox that is on the stage — accept the
        greybox first, then press <em>Generate a take</em>.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {shot.takes.map((take) => (
        <li key={take.id}>
          <TakeCard
            take={take}
            onStage={take.id === selectedLaneTake}
            onShow={() => onShowTake(take.id)}
          />
        </li>
      ))}
    </ul>
  );
}

function TakeCard({
  take,
  onStage,
  onShow,
}: {
  take: Take;
  onStage: boolean;
  onShow: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onShow}
      aria-pressed={onStage}
      title={`Put ${takeLabel(take.id)} on the take lane`}
      className={`w-full rounded-md border px-2 py-2 text-left transition-colors ${
        onStage ? "border-cc-primary/50 bg-cc-primary/10" : "border-cc-border bg-cc-card hover:border-cc-primary/30"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-cc-fg">{takeLabel(take.id)}</span>
        <TakeStatusChip status={take.status} />
        {take.selected ? (
          <span className="rounded-full border border-cc-success/40 bg-cc-success/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-cc-success">
            delivered
          </span>
        ) : null}
        {take.cost ? (
          <span className="ml-auto text-[11px] tabular-nums text-cc-fg">
            ${take.cost.usd.toFixed(2)}
          </span>
        ) : null}
      </div>

      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
        <dt className="text-cc-muted">model</dt>
        <dd className="truncate text-cc-fg">
          {take.model || "—"}
          {take.endpoint ? ` · ${take.endpoint}` : ""}
        </dd>
        <dt className="text-cc-muted">asked for</dt>
        <dd className="tabular-nums text-cc-fg">
          {take.resolution || "?"} · {take.seconds ?? "?"} s
          {take.greyboxRevision !== null ? ` · greybox rev ${take.greyboxRevision}` : ""}
        </dd>
        <dt className="text-cc-muted">measured</dt>
        <dd className="tabular-nums text-cc-fg">{probeFacts(take.probe)}</dd>
        <dt className="text-cc-muted">request</dt>
        <dd className="truncate font-mono text-[9px] text-cc-muted">{take.requestId ?? "—"}</dd>
      </dl>

      {take.fix ? (
        <p className="mt-1 text-[10px] leading-relaxed text-cc-fg">
          <span className="text-cc-muted">made to fix: </span>
          {take.fix}
        </p>
      ) : null}
      {take.error ? (
        <p className="mt-1 text-[10px] leading-relaxed text-cc-error">{take.error}</p>
      ) : null}
      {take.note ? (
        <p className="mt-1 text-[10px] leading-relaxed text-cc-muted">{take.note}</p>
      ) : null}
      {take.cost ? (
        <p className="mt-1 text-[9px] text-cc-muted/80">{take.cost.basis}</p>
      ) : null}
    </button>
  );
}

export function TakeStatusChip({ status }: { status: Take["status"] }) {
  const tone =
    status === "done"
      ? "border-cc-success/40 bg-cc-success/10 text-cc-success"
      : status === "failed"
        ? "border-cc-error/50 bg-cc-error/10 text-cc-error"
        : "border-cc-primary/50 bg-cc-primary/10 text-cc-primary";
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${tone}`}
    >
      {status}
    </span>
  );
}

export default TakesTab;
