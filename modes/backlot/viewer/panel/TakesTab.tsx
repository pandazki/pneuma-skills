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
 *
 * THE REFERENCES CARRY THEIR JOBS. Every reference attached to a request is
 * listed in the index order the prompt addresses it by, with the job the pack
 * assigned it. A reference with no job is called out: an unassigned reference
 * bleeds its own lighting, framing and palette into the shot, and the only
 * place a person can notice that is beside the picture it paid for.
 */

import type { Shot, Take, TakeRef } from "../../domain.js";
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

      <RefList refs={take.refs} />

      {take.handoff?.skipped ? (
        // `take-handoff` is still seeded and still has to be answered by eye,
        // so the card has to say that the frame it is judged against is one
        // this take was never shown.
        <p className="mt-1 text-[10px] leading-relaxed text-cc-warning">
          generated with <code>--no-handoff</code> — the previous shot&rsquo;s frame was not
          attached, so the hand-off is judged against a frame this take never saw.
        </p>
      ) : null}

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

/**
 * `@Image2` — the tag the prompt pack addresses this reference by, spelled
 * the way `previz.mjs::refTag` spells it.
 *
 * Not exported: a non-component export from a file of components breaks
 * React Fast Refresh, and the only caller is right here.
 */
function refTag(ref: TakeRef): string {
  const kind = ref.kind.charAt(0).toUpperCase() + ref.kind.slice(1);
  return `@${kind}${ref.index}`;
}

/** The order the prompt pack lists its references in. */
const KIND_ORDER: ReadonlyArray<string> = ["video", "image", "audio"];

function kindRank(kind: string): number {
  const rank = KIND_ORDER.indexOf(kind.toLowerCase());
  // A kind this viewer has never heard of goes last rather than being
  // dropped or alphabetised into the middle of the known ones.
  return rank === -1 ? KIND_ORDER.length : rank;
}

/**
 * Every reference of one request, in the order the prompt addresses them.
 *
 * Kind order is the pack's own (video, then images, then audio) and not
 * alphabetical: a person reads this list against the prompt they wrote, and
 * `@Video1` is the first line of that prompt.
 */
function RefList({ refs }: { refs: TakeRef[] }) {
  if (refs.length === 0) return null;
  const ordered = [...refs].sort((a, b) =>
    a.kind === b.kind ? a.index - b.index : kindRank(a.kind) - kindRank(b.kind),
  );
  const unassigned = ordered.filter((ref) => !ref.role?.trim()).length;

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {ordered.map((ref) => {
          const role = ref.role?.trim() ?? "";
          return (
            <span
              key={`${ref.kind}${ref.index}`}
              title={`${refTag(ref)} · ${ref.file}${role ? `` : " — no job assigned in the prompt pack"}`}
              className={`inline-flex max-w-full items-baseline gap-1 rounded-full border px-1.5 py-0.5 text-[9px] ${
                role
                  ? "border-cc-border bg-cc-hover/50 text-cc-muted"
                  : "border-cc-warning/55 bg-cc-warning/10 text-cc-warning"
              }`}
            >
              <span className="shrink-0 font-mono text-cc-fg">{refTag(ref)}</span>
              <span className="truncate">{role || "unassigned"}</span>
            </span>
          );
        })}
      </div>
      {unassigned > 0 ? (
        <p className="mt-1 text-[9px] leading-relaxed text-cc-warning/90">
          {unassigned === 1
            ? "1 reference carries no job"
            : `${unassigned} references carry no job`}{" "}
          — an unassigned reference bleeds its own lighting and framing into the shot.
        </p>
      ) : null}
    </div>
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
