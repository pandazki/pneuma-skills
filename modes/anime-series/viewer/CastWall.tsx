/**
 * The cast wall: one card per character, group and scene, and the style
 * lock — the bible, always in view while an episode is judged.
 *
 * Text fields are edited in place and written straight into bible.json; a
 * sheet is picked from its candidates in the drawer; "Lock vN" appends the
 * next lock. Generation (make sheets, check sheets) is a command to the
 * agent — the viewer never writes project.json.
 */

import type { DriftRef, EntityCard, Series, SheetCandidateView } from "../domain.js";
import { isBusy } from "../domain.js";
import { mediaUrl } from "./media.js";
import type { SeriesStrings } from "./strings.js";
import { Btn, Card, Chip, CloseIcon, EditableText, FailureNote, HATCH, LockIcon, Swatches, Tiny } from "./ui.js";
import { fmtUsd, type Focus } from "./view-model.js";

export interface WallHandlers {
  onFocus: (focus: Focus) => void;
  onOpenCandidates: (card: EntityCard, candidate: string | null) => void;
  onEditField: (card: EntityCard, field: "look" | "ability" | "personality", value: string) => void;
  onEditStyle: (field: "style" | "sheetStyle", value: string) => void;
  onLock: () => void;
  onCommand: (id: "make-sheets" | "check-sheets" | "retry", card: EntityCard) => void;
  onOverview: () => void;
  /** Open the drift compare a card's drift chip points at. */
  onDrift: (drift: DriftRef) => void;
}

function LockChip({ card, series, t }: { card: EntityCard; series: Series; t: SeriesStrings }) {
  if (card.lock.state === "edited") {
    return (
      <Chip tone="warn" title={card.lock.changed.map((f) => t.fieldLabel(f)).join(" · ")}>
        {t.editedChip}
      </Chip>
    );
  }
  if (card.lock.state === "unlocked" || card.lock.version === null) return <Chip tone="dim">{t.unlockedChip}</Chip>;
  const flagged = series.episodes.find(
    (ep) => ep.flag?.stale && ep.flag.changes.some((c) => c.key === card.key),
  );
  if (flagged && flagged.flag) {
    return (
      <Chip tone="warn">{t.shotUnderChip(card.lock.version, flagged.id, flagged.flag.shotUnder ?? 0)}</Chip>
    );
  }
  return <Chip tone="ok">{t.lockedChip(card.lock.version)}</Chip>;
}

function SheetBox({
  card,
  base,
  t,
  wide,
  canCommand,
  handlers,
}: {
  card: EntityCard;
  base: string;
  t: SeriesStrings;
  wide: boolean;
  canCommand: boolean;
  handlers: WallHandlers;
}) {
  const aspect = wide ? "aspect-[16/7]" : "aspect-[16/10]";
  const picked = card.sheet && card.sheet.status === "ready" ? card.sheet : null;
  const src = picked ? mediaUrl(base, picked) : null;
  const busy = card.candidates.some((c) => isBusy(c));
  const ready = card.candidates.filter((c) => c.status === "ready");

  if (src && picked) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handlers.onOpenCandidates(card, picked.id);
        }}
        className={`relative block w-full overflow-hidden rounded-[6px] bg-[#fbfaf7] ${aspect}`}
        title={t.candidatesTitle(card.name)}
      >
        <img
          src={src}
          alt={card.name}
          draggable={false}
          className={`h-full w-full ${card.kind === "scene" ? "object-cover" : "object-cover object-top"}`}
        />
        {busy ? <span className="absolute inset-0" style={HATCH} /> : null}
        <span className="absolute bottom-1 right-1 inline-flex items-center gap-[3px]">
          {card.lock.version && !card.lock.changed.includes("sheet") ? (
            <i className="rounded-[4px] border border-white/25 bg-[#1c1c20]/85 px-1 text-[9px] not-italic leading-[15px] text-cc-muted">
              v{card.lock.version}
            </i>
          ) : null}
          {picked.spent !== null ? (
            <i className="rounded-[4px] border border-white/25 bg-[#1c1c20]/85 px-1 text-[9px] not-italic leading-[15px] text-cc-muted">
              {fmtUsd(picked.spent)}
            </i>
          ) : null}
        </span>
        {picked.outdated.length > 0 ? (
          <span className="absolute bottom-1 left-1" title={picked.outdated.map((f) => t.fieldLabel(f)).join(" · ")}>
            <Chip tone="warn" className="bg-cc-bg/80">
              {t.outdated}
            </Chip>
          </span>
        ) : null}
      </button>
    );
  }

  if (card.sheetState === "pick" || (ready.length > 0 && !picked)) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handlers.onOpenCandidates(card, ready[0]?.id ?? null);
        }}
        className={`relative grid w-full gap-1 overflow-hidden rounded-[6px] border border-cc-primary/40 bg-cc-primary-muted p-1 ${aspect}`}
        style={{ gridTemplateColumns: `repeat(${Math.min(ready.length, 2)}, minmax(0, 1fr))` }}
      >
        {ready.slice(0, 2).map((c) => (
          <img
            key={c.id}
            src={mediaUrl(base, c) ?? undefined}
            alt=""
            draggable={false}
            className="h-full w-full rounded-[4px] bg-[#fbfaf7] object-cover object-top"
          />
        ))}
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2">
          <Chip tone="gen">{t.pickOne(ready.length)}</Chip>
        </span>
      </button>
    );
  }

  if (card.sheetState === "generating") {
    return (
      <div className={`relative grid w-full place-items-center overflow-hidden rounded-[6px] border border-cc-primary/40 ${aspect}`} style={HATCH}>
        <Chip tone="gen" pulse>
          {t.sheetGenerating}
        </Chip>
      </div>
    );
  }

  if (card.sheetState === "failed") {
    const reason = card.candidates[card.candidates.length - 1]?.failure?.reason;
    return (
      <div className={`grid w-full place-items-center gap-1 rounded-[6px] border border-cc-error/50 bg-cc-error/5 p-2 text-center ${aspect}`}>
        <span className="text-[11px] text-cc-error">{t.sheetFailed}</span>
        {reason ? <span className="line-clamp-2 text-[10px] text-cc-muted">{reason}</span> : null}
        <Btn disabled={!canCommand} onClick={() => handlers.onCommand("retry", card)}>
          {t.makeSheets}
        </Btn>
      </div>
    );
  }

  if (card.kind === "group") return null;

  return (
    <div className={`grid w-full place-items-center gap-1.5 rounded-[6px] border border-dashed border-cc-border p-2 text-center ${aspect}`}>
      <span className="text-[11px] text-cc-muted">{t.noSheet}</span>
      <Btn disabled={!canCommand} onClick={() => handlers.onCommand("make-sheets", card)}>
        {t.makeSheets}
      </Btn>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-1 text-[11px] leading-[1.5] text-cc-muted">
      <em className="mr-1 not-italic text-cc-fg">{label}</em>
      {children}
    </div>
  );
}

function EntityCardView({
  card,
  series,
  base,
  t,
  focused,
  canWrite,
  canCommand,
  handlers,
}: {
  card: EntityCard;
  series: Series;
  base: string;
  t: SeriesStrings;
  focused: boolean;
  canWrite: boolean;
  canCommand: boolean;
  handlers: WallHandlers;
}) {
  const entity = card.entity as unknown as Record<string, unknown>;
  const str = (k: string) => (typeof entity[k] === "string" ? (entity[k] as string) : "");
  const textOnly = card.kind === "group" && !card.sheet && card.candidates.length === 0;
  const unaccepted = card.drift.filter((d) => !d.accepted);

  return (
    <Card
      selected={focused}
      warn={card.lock.state === "edited"}
      onClick={() => handlers.onFocus({ kind: card.kind, id: card.id })}
    >
      <SheetBox card={card} base={base} t={t} wide={card.kind !== "character"} canCommand={canCommand} handlers={handlers} />
      <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 ${textOnly ? "" : "mt-[7px]"}`}>
        <b className="whitespace-nowrap text-[12.5px] font-semibold text-cc-fg">{card.name}</b>
        <Tiny className="whitespace-nowrap">{t.kindLabel(card.kind)}</Tiny>
        <span className="ml-auto">
          {textOnly ? <Chip tone="dim">{t.textOnly}</Chip> : <LockChip card={card} series={series} t={t} />}
        </span>
      </div>
      {card.kind === "character" ? (
        <>
          <Field label={t.fieldLabel("ability")}>
            <EditableText value={str("ability")} disabled={!canWrite} title={t.editHint} onCommit={(v) => handlers.onEditField(card, "ability", v)} />
          </Field>
          <Field label={t.fieldLabel("personality")}>
            <EditableText value={str("personality")} disabled={!canWrite} title={t.editHint} onCommit={(v) => handlers.onEditField(card, "personality", v)} />
          </Field>
          <Field label={t.fieldLabel("look")}>
            <EditableText
              value={str("look")}
              disabled={!canWrite}
              title={t.editHint}
              className="line-clamp-2"
              onCommit={(v) => handlers.onEditField(card, "look", v)}
            />
          </Field>
          {entity.palette ? (
            <Field label={t.fieldLabel("palette")}>
              <Swatches palette={entity.palette} />
            </Field>
          ) : null}
        </>
      ) : (
        <div className="mt-1 text-[11px] leading-[1.5] text-cc-muted">
          <EditableText
            value={str("look")}
            disabled={!canWrite}
            title={t.editHint}
            className="line-clamp-3"
            onCommit={(v) => handlers.onEditField(card, "look", v)}
          />
          {card.kind === "group" && str("leader") ? <div className="mt-1 line-clamp-2">{str("leader")}</div> : null}
          {entity.palette ? <Swatches palette={entity.palette} /> : null}
        </div>
      )}
      {card.kind === "character" || card.appearances.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-[5px]">
          <Chip tone="dim">{t.appearances(card.appearances.length)}</Chip>
          {card.kind !== "scene" ? (
            unaccepted.length > 0 ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlers.onDrift(unaccepted[0]);
                }}
              >
                <Chip tone="warn">{t.driftAt(unaccepted.length, unaccepted[0].episode, unaccepted[0].shot)}</Chip>
              </button>
            ) : card.drift.length > 0 ||
              series.episodes.some(
                (e) => (card.kind === "character" ? e.cast : e.groups).includes(card.id) && e.parts.some((p) => p.take),
              ) ? (
              <Chip tone="ok">{t.noDrift}</Chip>
            ) : null
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export function CastWall({
  series,
  base,
  t,
  focus,
  layout,
  canWrite,
  canCommand,
  handlers,
}: {
  series: Series;
  base: string;
  t: SeriesStrings;
  focus: Focus | null;
  layout: "wide" | "mid" | "narrow";
  canWrite: boolean;
  canCommand: boolean;
  handlers: WallHandlers;
}) {
  const needsLock = [series.style, ...series.cards].some((c) => c.lock.state !== "locked");
  const style = series.style;
  const stacked = layout !== "wide";

  return (
    <aside
      aria-label={t.wallTitle}
      className={
        stacked
          ? `grid content-start items-start gap-2 border-b border-cc-border bg-cc-surface/30 p-2.5 ${layout === "narrow" ? "grid-cols-2" : "grid-cols-[repeat(auto-fill,minmax(170px,1fr))]"}`
          : "flex flex-col gap-2 border-r border-cc-border bg-cc-surface/30 p-2.5"
      }
    >
      {/* Title and hint each stay on one line; the hint drops under the
          title as a whole when the column is too narrow for both. */}
      <header className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-0.5 pb-0.5 ${stacked ? "col-span-full" : ""}`}>
        <h2 className="m-0 whitespace-nowrap text-[11px] font-medium text-cc-fg">{t.wallTitle}</h2>
        <Tiny className="whitespace-nowrap">{t.wallHint}</Tiny>
      </header>

      {series.cards.map((card) => (
        <EntityCardView
          key={card.key}
          card={card}
          series={series}
          base={base}
          t={t}
          focused={!!focus && focus.kind === card.kind && focus.id === card.id}
          canWrite={canWrite}
          canCommand={canCommand}
          handlers={handlers}
        />
      ))}

      <Card
        selected={focus?.kind === "style"}
        warn={style.lock.state === "edited"}
        onClick={() => handlers.onFocus({ kind: "style", id: "style" })}
      >
        <div className="flex items-center gap-1.5">
          <b className="text-[12.5px] font-semibold text-cc-fg">{t.styleTitle}</b>
          <span className="ml-auto">
            {style.lock.state === "edited" ? (
              <Chip tone="warn" title={style.lock.changed.map((f) => t.fieldLabel(f)).join(" · ")}>
                {t.editedChip}
              </Chip>
            ) : style.lock.version ? (
              <Chip tone="ok">{t.lockedChip(style.lock.version)}</Chip>
            ) : (
              <Chip tone="dim">{t.unlockedChip}</Chip>
            )}
          </span>
        </div>
        <div className="mt-1 text-[11px] leading-[1.5] text-cc-muted">
          <EditableText value={style.style} disabled={!canWrite} title={t.editHint} className="line-clamp-4" onCommit={(v) => handlers.onEditStyle("style", v)} />
        </div>
        <div className="mt-1 flex flex-wrap gap-[5px]">
          <Chip tone="dim">{style.ratio}</Chip>
        </div>
      </Card>

      {series.lineup ? <LineupCard series={series} base={base} t={t} /> : null}

      {needsLock ? (
        <div className={`flex flex-col gap-1 ${stacked ? "col-span-full" : ""}`}>
          <Btn primary disabled={!canWrite} onClick={handlers.onLock} className="justify-center">
            <LockIcon />
            {t.lockAs(series.version + 1)}
          </Btn>
          <Tiny className="px-0.5">{t.lockHint}</Tiny>
        </div>
      ) : null}

      {/* A full-width block, not a one-line Btn: the name and what it
          records wrap inside the column instead of overflowing it. */}
      <button
        type="button"
        onClick={handlers.onOverview}
        className={`flex w-full min-w-0 flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0.5 rounded-[7px] border border-cc-border bg-cc-card px-2.5 py-[5px] text-center text-[11.5px] leading-[1.35] text-cc-fg transition-colors hover:bg-cc-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${stacked ? "col-span-full" : ""}`}
      >
        <span className="whitespace-nowrap">{t.logButton}</span>
        <Tiny className="whitespace-nowrap">{t.logButtonHint}</Tiny>
      </button>
    </aside>
  );
}

/** The newest lineup probe: the picked sheets side by side, at one scale. */
function LineupCard({ series, base, t }: { series: Series; base: string; t: SeriesStrings }) {
  const lineup = series.lineup!;
  const src = lineup.view.status === "ready" ? mediaUrl(base, lineup.view) : null;
  const ratio = lineup.view.width && lineup.view.height ? lineup.view.width / lineup.view.height : 16 / 9;
  return (
    <Card>
      <div className="flex items-center gap-1.5">
        <b className="text-[12.5px] font-semibold text-cc-fg">{t.lineupTitle}</b>
        <span className="ml-auto">{lineup.stale ? <Chip tone="stale">{t.lineupStale}</Chip> : null}</span>
      </div>
      <div className="relative mt-1.5 overflow-hidden rounded-[6px] bg-[#fbfaf7]" style={{ aspectRatio: String(ratio) }}>
        {src ? (
          <img src={src} alt={lineup.names.join(" · ")} draggable={false} className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full w-full place-items-center bg-cc-bg" style={isBusy(lineup.view) ? HATCH : undefined}>
            <Chip tone={lineup.view.status === "failed" ? "err" : "gen"} pulse={isBusy(lineup.view)}>
              {lineup.view.status === "failed" ? t.failed : t.generating}
            </Chip>
          </div>
        )}
      </div>
      {lineup.view.status === "failed" ? <FailureNote failure={lineup.view.failure} t={t} className="mt-1" /> : null}
      <div className="mt-1 flex flex-wrap items-center gap-[5px]">
        <Tiny>{lineup.names.join(" · ")}</Tiny>
        {lineup.view.spent !== null ? <Chip tone="dim" className="ml-auto">{fmtUsd(lineup.view.spent)}</Chip> : null}
      </div>
    </Card>
  );
}

// ── Candidates drawer ──────────────────────────────────────────────────────

function verdictChip(c: SheetCandidateView, t: SeriesStrings) {
  if (!c.check) return <Chip tone="dim">{t.verdictUnverified}</Chip>;
  if (c.check.verdict === "ok") return <Chip tone="ok">{t.verdictOk}</Chip>;
  if (c.check.verdict === "drift") return <Chip tone="warn">{t.verdictDrift}</Chip>;
  return <Chip tone="dim">{t.verdictUnverified}</Chip>;
}

export function CandidatesDrawer({
  card,
  selected,
  base,
  t,
  canWrite,
  canCommand,
  onSelect,
  onUse,
  onCommand,
  onClose,
}: {
  card: EntityCard;
  selected: string | null;
  base: string;
  t: SeriesStrings;
  canWrite: boolean;
  canCommand: boolean;
  onSelect: (id: string) => void;
  onUse: (id: string) => void;
  onCommand: (id: "make-sheets" | "check-sheets") => void;
  onClose: () => void;
}) {
  const inUse = card.sheet?.id ?? null;
  const shown = card.candidates.length > 0 ? card.candidates : card.sheet ? [card.sheet] : [];
  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center overflow-auto bg-cc-bg/70 p-4 backdrop-blur-[6px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[980px] rounded-[12px] border border-cc-border bg-cc-surface/95 p-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-2.5 flex items-center gap-2">
          <h3 className="m-0 text-[13px] font-semibold text-cc-fg">{t.candidatesTitle(card.name)}</h3>
          <div className="ml-auto flex items-center gap-1.5">
            <Btn disabled={!canCommand} onClick={() => onCommand("check-sheets")}>
              {t.checkSheets}
            </Btn>
            <Btn disabled={!canCommand} onClick={() => onCommand("make-sheets")}>
              {t.twoMore}
            </Btn>
            <button
              type="button"
              aria-label={t.close}
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-[7px] border border-cc-border text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
            >
              <CloseIcon />
            </button>
          </div>
        </header>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${card.kind === "character" ? 300 : 360}px, 1fr))` }}>
          {shown.map((c) => {
            const src = mediaUrl(base, c);
            const active = c.id === selected;
            return (
              <div
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`cursor-pointer rounded-[10px] border p-1.5 ${active ? "border-cc-primary/60 shadow-[0_0_0_3px_var(--color-cc-glow)]" : "border-cc-border"} bg-cc-card`}
              >
                <div className={`relative overflow-hidden rounded-[6px] bg-[#fbfaf7] ${card.kind === "character" ? "aspect-square" : "aspect-video"}`}>
                  {src ? (
                    <img src={src} alt={c.id} draggable={false} className="h-full w-full object-contain" />
                  ) : (
                    <div className="grid h-full w-full place-items-center" style={isBusy(c) ? HATCH : undefined}>
                      <Chip tone={c.status === "failed" ? "err" : "gen"} pulse={isBusy(c)}>
                        {c.status === "failed" ? t.failed : t.generating}
                      </Chip>
                    </div>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="text-[11px] tabular-nums text-cc-muted">{c.id}</span>
                  {verdictChip(c, t)}
                  {c.spent !== null ? <Chip tone="dim">{fmtUsd(c.spent)}</Chip> : null}
                  <span className="ml-auto">
                    {c.id === inUse ? (
                      <Chip tone="ok">{t.inUse}</Chip>
                    ) : c.status === "ready" ? (
                      <Btn
                        primary
                        disabled={!canWrite}
                        onClick={() => onUse(c.id)}
                      >
                        {t.useThis}
                      </Btn>
                    ) : null}
                  </span>
                </div>
                {c.status === "failed" ? <FailureNote failure={c.failure} t={t} className="mt-1" /> : null}
                {c.check?.note ? <p className="m-0 mt-1 text-[11px] leading-[1.5] text-cc-muted">{c.check.note}</p> : null}
                {c.outdated.length > 0 ? (
                  <p className="m-0 mt-1 text-[10.5px] text-cc-warning">
                    {t.outdated}: {c.outdated.map((f) => t.fieldLabel(f)).join(" · ")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
