/**
 * The panel: the character card and the pack's facts beside the sticker
 * grid. Every card plays its sticker on the chat plate with one status chip;
 * the status, its reason and every number come from the domain (which takes
 * them from sticker-state.mjs) — nothing here decides a status.
 */

import type { ReactNode } from "react";

import type { ArtKindView, AssetBrief, StickerPack, StickerView } from "../domain.js";
import { mediaUrl } from "./media.js";
import { GifImg } from "./players.js";
import type { StickerStrings } from "./strings.js";
import { Chip, Icon, Plate, SectionTitle, StatusChip, fmtUsd, plateInk } from "./ui.js";
import type { Focus, Plate as PlateKind, Position } from "./view-model.js";

export interface KeysKnown {
  /** null: the session did not say (the hosted player has no init params). */
  fal: boolean | null;
  openrouter: boolean | null;
}

/** Seconds since a take was reserved, as the chip says it. */
export function elapsedOf(t: StickerStrings, now: number, submittedAt: number | null): string {
  if (!submittedAt) return "";
  return t.elapsed(Math.max(0, Math.round((now - submittedAt) / 1000)));
}

function oldestInFlight(sticker: StickerView): AssetBrief | null {
  const busy = sticker.takes.filter((x) => x.status === "pending" || x.status === "generating");
  return busy[0] ?? null;
}

// ── Sticker card ───────────────────────────────────────────────────────────

function CardPlate({ sticker, plate, base, t, now, unknown }: { sticker: StickerView; plate: PlateKind; base: string; t: StickerStrings; now: number; unknown: boolean }) {
  const url = mediaUrl(base, sticker.shown);
  const ink = plateInk(plate);
  const status = sticker.state.status;
  let body: ReactNode = null;
  if (url) {
    body = <GifImg url={url} size="80%" alt={`${sticker.sticker.word} ${sticker.sticker.caption}`} />;
  } else if (unknown) {
    body = null;
  } else if (status === "generating") {
    const busy = oldestInFlight(sticker);
    body = (
      <div className="flex flex-col items-center gap-2" style={{ color: ink }}>
        <span className="h-7 w-7 rounded-full border-2 border-current border-t-transparent opacity-70 motion-safe:animate-spin" />
        <span className="font-mono text-[11px] tabular-nums">{elapsedOf(t, now, busy?.submittedAt ?? null)}</span>
      </div>
    );
  } else if (status === "failed") {
    body = (
      <div className="flex flex-col items-center gap-1.5 px-3 text-center" style={{ color: ink }}>
        <span style={{ color: plate === "light" ? "#dc2626" : "#f87171" }}>
          <Icon.Cross size={26} />
        </span>
        {sticker.uncertain.length ? <span className="text-[10.5px] font-medium">{t.mayBeBilled}</span> : <span className="text-[10.5px]">{t.notBilled}</span>}
      </div>
    );
  } else {
    body = (
      <div className="flex h-[76%] w-[76%] items-center justify-center rounded-[18px] border-[1.5px] border-dashed px-3 text-center" style={{ borderColor: `${ink}66`, color: ink }}>
        <span className="line-clamp-3 text-[10.5px] leading-[1.45] opacity-90">{sticker.sticker.action || t.noneYet}</span>
      </div>
    );
  }
  return (
    <Plate plate={plate} className="relative grid aspect-square w-full place-items-center">
      {body}
      <span className="absolute left-2 top-1.5 font-mono text-[10.5px] tabular-nums" style={{ color: ink }}>
        {sticker.number}
      </span>
    </Plate>
  );
}

export function StickerCard({
  sticker,
  plate,
  base,
  t,
  now,
  selected,
  unknown,
  onOpen,
}: {
  sticker: StickerView;
  plate: PlateKind;
  base: string;
  t: StickerStrings;
  now: number;
  selected: boolean;
  /** project.json is unreadable: no status can be told. */
  unknown: boolean;
  onOpen: () => void;
}) {
  const s = sticker.sticker;
  const status = sticker.state.status;
  const ready = sticker.state.ready.length;
  const busy = oldestInFlight(sticker);
  return (
    <button
      type="button"
      data-sticker={sticker.id}
      data-status={unknown ? "unknown" : status}
      aria-pressed={selected}
      aria-label={t.openSticker(sticker.number, s.word)}
      onClick={onOpen}
      className={`group flex min-w-0 flex-col overflow-hidden rounded-[14px] border bg-cc-surface/50 text-left transition-[border-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-cc-primary/60 motion-safe:hover:-translate-y-[1px] ${
        selected ? "border-cc-primary/80 shadow-[0_0_0_1px_var(--color-cc-primary),0_8px_28px_var(--color-cc-glow)]" : "border-cc-border hover:border-cc-primary/35"
      }`}
    >
      <CardPlate sticker={sticker} plate={plate} base={base} t={t} now={now} unknown={unknown} />
      <div className="flex min-w-0 flex-col gap-1 border-t border-cc-border px-2.5 pb-2 pt-1.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-cc-fg">{s.word || s.id}</span>
          {s.caption && s.caption !== s.word ? <span className="truncate text-[11.5px] text-cc-muted">“{s.caption}”</span> : null}
          {!s.caption ? <span className="truncate text-[11px] italic text-cc-muted/80">{t.noCaption}</span> : null}
          <span className="ml-auto shrink-0 text-[13px] leading-none">{s.emoji}</span>
        </div>
        <div className="flex min-w-0">
          {unknown ? (
            <StatusChip status="unknown">{t.statusUnknown}</StatusChip>
          ) : (
            <StatusChip status={status} title={sticker.state.reason ?? undefined}>
              {t.status(status, ready, elapsedOf(t, now, busy?.submittedAt ?? null))}
            </StatusChip>
          )}
        </div>
      </div>
    </button>
  );
}

export function StickerGrid({
  value,
  position,
  base,
  t,
  now,
  columns,
  onFocus,
}: {
  value: StickerPack;
  position: Position;
  base: string;
  t: StickerStrings;
  now: number;
  columns: number;
  onFocus: (focus: Focus) => void;
}) {
  const focused = position.focus?.type === "sticker" ? position.focus.id : null;
  return (
    <div data-sticker-grid className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {value.stickers.map((sticker) => (
        <StickerCard
          key={sticker.id}
          sticker={sticker}
          plate={position.plate}
          base={base}
          t={t}
          now={now}
          selected={focused === sticker.id}
          unknown={value.projectError !== null}
          onOpen={() => onFocus({ type: "sticker", id: sticker.id })}
        />
      ))}
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

function Thumb({ brief, plate, base, size, alt }: { brief: AssetBrief | null; plate: PlateKind; base: string; size: number; alt: string }) {
  const url = mediaUrl(base, brief);
  return (
    <Plate plate={plate} className="grid shrink-0 place-items-center overflow-hidden rounded-lg" style={{ width: size, height: size }}>
      {url ? <img src={url} alt={alt} crossOrigin="anonymous" draggable={false} className="h-full w-full select-none object-contain" /> : null}
    </Plate>
  );
}

function RightsBadge({ value, t }: { value: StickerPack; t: StickerStrings }) {
  const rights = value.pack?.rights;
  if (!rights) {
    return (
      <div data-rights="missing" className="rounded-lg border border-cc-error/40 bg-cc-error/10 px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-cc-error">
          <Icon.Alert size={12} />
          {t.rightsMissing}
        </div>
        <p className="m-0 mt-1 text-[11px] leading-[1.5] text-cc-fg/80">{t.rightsMissingBody}</p>
      </div>
    );
  }
  return (
    <div data-rights={rights.basis} className="flex items-start gap-2 rounded-lg border border-cc-border bg-cc-bg/40 px-2.5 py-2" title={rights.note || undefined}>
      <span className="mt-[1px] text-cc-success">
        <Icon.Lock size={12} />
      </span>
      <div className="min-w-0">
        <div className="text-[11.5px] font-medium text-cc-fg">{t.rightsBasis(rights.basis)}</div>
        <div className="text-[10.5px] text-cc-muted">
          {t.confirmed(rights.confirmedAt)}
          {rights.note ? <span className="block truncate">{rights.note}</span> : null}
        </div>
      </div>
    </div>
  );
}

function CharacterCard({ value, plate, base, t, selected, onOpen }: { value: StickerPack; plate: PlateKind; base: string; t: StickerStrings; selected: boolean; onOpen: () => void }) {
  const character = value.character;
  const pack = value.pack!;
  const ready = character?.candidates.filter((c) => c.status === "ready") ?? [];
  const anchorUrl = mediaUrl(base, character?.anchor.ready ? character.asset : null);
  return (
    <section>
      <SectionTitle>{t.character}</SectionTitle>
      <button
        type="button"
        data-character-card
        onClick={onOpen}
        aria-pressed={selected}
        className={`block w-full overflow-hidden rounded-[14px] border text-left transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${selected ? "border-cc-primary/80" : "border-cc-border hover:border-cc-primary/35"}`}
      >
        <Plate plate={plate} className="grid aspect-[5/4] w-full place-items-center">
          {anchorUrl ? (
            <img src={anchorUrl} alt={t.character} crossOrigin="anonymous" draggable={false} className="h-[88%] w-[88%] select-none object-contain" />
          ) : (
            <span className="px-4 text-center text-[11.5px]" style={{ color: plateInk(plate) }}>
              {ready.length ? t.candidatesToPick(ready.length) : t.noCharacter}
            </span>
          )}
        </Plate>
        <div className="border-t border-cc-border bg-cc-surface/50 px-2.5 py-2">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-cc-muted">{t.style}</div>
          <div className="line-clamp-2 text-[11.5px] leading-[1.45] text-cc-fg/90">{pack.character.style}</div>
          {character && !character.anchor.ready && character.anchor.anchor ? (
            <div className="mt-1 text-[10.5px] text-cc-warning">{character.anchor.reason}</div>
          ) : null}
        </div>
      </button>
    </section>
  );
}

function ArtRow({ art, plate, base, t, selected, onOpen }: { art: ArtKindView; plate: PlateKind; base: string; t: StickerStrings; selected: boolean; onOpen: () => void }) {
  const ready = art.asset?.status === "ready" ? art.asset : null;
  return (
    <button
      type="button"
      data-art={art.kind}
      onClick={onOpen}
      aria-pressed={selected}
      className={`flex w-full items-center gap-2.5 rounded-lg border px-1.5 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${selected ? "border-cc-primary/70 bg-cc-primary/5" : "border-transparent hover:bg-cc-hover"}`}
    >
      <Thumb brief={ready} plate={plate} base={base} size={36} alt={t.artKind(art.kind)} />
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-cc-fg">{t.artKind(art.kind)}</div>
        <div className="truncate font-mono text-[10.5px] text-cc-muted">{art.picked ?? (art.candidates.length ? t.notPicked : t.noneYet)}</div>
      </div>
    </button>
  );
}

function PackFacts({ value, t, keys }: { value: StickerPack; t: StickerStrings; keys: KeysKnown }) {
  const pack = value.pack!;
  const cost = value.cost;
  return (
    <section className="flex flex-col gap-2.5">
      <SectionTitle>{t.pack}</SectionTitle>
      <div>
        <div className="mb-1 text-[10.5px] text-cc-muted">{t.platforms}</div>
        <div className="flex flex-wrap gap-1">
          {value.platforms.length ? (
            value.platforms.map((p) => (
              <Chip key={p.platform} tone={p.tally.fail ? "error" : p.tally.warn ? "warning" : "success"} title={t.checksTally(p.tally.pass, p.tally.warn, p.tally.fail)}>
                {p.profile.label}
                <span className="opacity-75">{p.tally.fail ? `· ${p.tally.fail}` : ""}</span>
              </Chip>
            ))
          ) : (
            <span className="text-[11px] text-cc-muted">{t.noPlatforms}</span>
          )}
        </div>
      </div>
      <div>
        <div className="text-[10.5px] text-cc-muted">{t.motion}</div>
        <div className="font-mono text-[11.5px] text-cc-fg/90">{t.motionLine(pack.motion.size, pack.motion.frames, pack.motion.frameMs)}</div>
      </div>
      <div>
        <div className="text-[10.5px] text-cc-muted">{t.spend}</div>
        <div data-spend className="whitespace-nowrap font-mono text-[15px] font-semibold tabular-nums text-cc-fg">≈ {fmtUsd(cost.total)}</div>
        <div className="text-[10.5px] leading-[1.45] text-cc-muted">{t.spendNote}</div>
        {cost.inFlight.length || cost.uncertain.length || cost.unpriced.length ? (
          <div className="mt-1 flex flex-col gap-0.5 text-[10.5px]">
            {cost.inFlight.length ? <span className="text-cc-primary">{t.inFlight(cost.inFlight.length)}</span> : null}
            {cost.uncertain.length ? (
              <span className="text-cc-warning" title={cost.uncertain.join(", ")}>
                {t.uncertain(cost.uncertain.length)}
              </span>
            ) : null}
            {cost.unpriced.length ? <span className="text-cc-muted">{t.unpriced(cost.unpriced.length)}</span> : null}
          </div>
        ) : null}
      </div>
      {keys.fal === false || keys.openrouter === false ? (
        <div data-keys-missing className="rounded-lg border border-cc-border bg-cc-bg/40 px-2.5 py-2 text-[10.5px] leading-[1.5] text-cc-muted">
          <div className="mb-0.5 font-medium text-cc-fg/90">{t.keys}</div>
          {keys.fal === false ? <p className="m-0">{t.falMissing}</p> : null}
          {keys.openrouter === false ? <p className="m-0 mt-1">{t.openrouterMissing}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export function Sidebar({
  value,
  position,
  base,
  t,
  keys,
  onFocus,
}: {
  value: StickerPack;
  position: Position;
  base: string;
  t: StickerStrings;
  keys: KeysKnown;
  onFocus: (focus: Focus) => void;
}) {
  const focus = position.focus;
  return (
    <aside data-sidebar className="flex flex-col gap-4">
      <CharacterCard value={value} plate={position.plate} base={base} t={t} selected={focus?.type === "character"} onOpen={() => onFocus({ type: "character" })} />
      <RightsBadge value={value} t={t} />
      <PackFacts value={value} t={t} keys={keys} />
      {value.art.length ? (
        <section>
          <SectionTitle>{t.art}</SectionTitle>
          <div className="flex flex-col gap-0.5">
            {value.art.map((a) => (
              <ArtRow
                key={a.kind}
                art={a}
                plate={position.plate}
                base={base}
                t={t}
                selected={focus?.type === "art" && focus.kind === a.kind}
                onOpen={() => onFocus({ type: "art", kind: a.kind })}
              />
            ))}
          </div>
        </section>
      ) : null}
    </aside>
  );
}

/** The sidebar's essentials in one row, for a panel too narrow for a column. */
export function CompactBar({ value, position, base, t, onFocus }: { value: StickerPack; position: Position; base: string; t: StickerStrings; onFocus: (focus: Focus) => void }) {
  const character = value.character;
  const rights = value.pack?.rights;
  return (
    <div data-compact-bar className="mb-3 flex items-center gap-3 rounded-[14px] border border-cc-border bg-cc-surface/50 p-2">
      <button type="button" onClick={() => onFocus({ type: "character" })} className="shrink-0 rounded-lg focus-visible:ring-2 focus-visible:ring-cc-primary/60" aria-label={t.character}>
        <Thumb brief={character?.anchor.ready ? character.asset : null} plate={position.plate} base={base} size={48} alt={t.character} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] text-cc-fg/90">{value.pack?.character.style}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {rights ? <Chip tone="success">{t.rightsBasis(rights.basis)}</Chip> : <Chip tone="error">{t.rightsMissing}</Chip>}
          {value.platforms.map((p) => (
            <Chip key={p.platform} tone={p.tally.fail ? "error" : p.tally.warn ? "warning" : "success"}>
              {p.profile.label}
            </Chip>
          ))}
          <span className="font-mono text-[11px] text-cc-muted">≈ {fmtUsd(value.cost.total)}</span>
        </div>
      </div>
    </div>
  );
}
