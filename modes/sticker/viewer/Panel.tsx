/**
 * The panel: the character card and the pack's facts beside the sticker
 * grid. Every card plays its sticker on the chat plate with one status chip;
 * the status, its reason and every number come from the domain (which takes
 * them from sticker-state.mjs) — nothing here decides a status.
 */

import type { ReactNode } from "react";

import type { ArtKindView, AssetBrief, StickerPack, StickerView } from "../domain.js";
import { StickerLoop } from "./StickerLoop.js";
import { mediaUrl } from "./media.js";
import type { StickerStrings } from "./strings.js";
import { Chip, Icon, Plate, SectionTitle, StatusChip, fmtUsd, plateInk } from "./ui.js";
import { assetNumber, newestFirst, type Focus, type Plate as PlateKind, type Position } from "./view-model.js";

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

function CardPlate({ value, sticker, plate, base, t, now, unknown }: { value: StickerPack; sticker: StickerView; plate: PlateKind; base: string; t: StickerStrings; now: number; unknown: boolean }) {
  const url = mediaUrl(base, sticker.shown);
  const ink = plateInk(plate);
  const status = sticker.state.status;
  let body: ReactNode = null;
  if (url) {
    body = <StickerLoop value={value} sticker={sticker} take={sticker.shown} base={base} size="80%" alt={`${sticker.sticker.word} ${sticker.sticker.caption}`} t={t} />;
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
  value,
  sticker,
  plate,
  base,
  t,
  now,
  selected,
  unknown,
  onOpen,
}: {
  value: StickerPack;
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
      <CardPlate value={value} sticker={sticker} plate={plate} base={base} t={t} now={now} unknown={unknown} />
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
            <StatusChip status={status} title={sticker.state.messages.map(t.say).join(" · ") || undefined}>
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
          value={value}
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

/**
 * What stands for the character: the picked anchor, else the newest ready
 * candidate (waiting to be picked) — never "no character" while one exists.
 */
export function characterFace(value: StickerPack): { brief: AssetBrief | null; picked: boolean; toPick: number } {
  const character = value.character;
  if (!character || value.projectError) return { brief: null, picked: false, toPick: 0 };
  const ready = newestFirst(character.candidates.filter((c) => c.status === "ready"));
  if (character.anchor.ready && character.asset) return { brief: character.asset, picked: true, toPick: 0 };
  return { brief: ready[0] ?? null, picked: false, toPick: ready.length };
}

function CharacterCard({ value, plate, base, t, selected, onOpen }: { value: StickerPack; plate: PlateKind; base: string; t: StickerStrings; selected: boolean; onOpen: () => void }) {
  const character = value.character;
  const pack = value.pack!;
  const face = characterFace(value);
  const url = mediaUrl(base, face.brief);
  const unread = value.projectError !== null;
  const anchor = pack.character.anchor;
  return (
    <section>
      <SectionTitle>{t.character}</SectionTitle>
      <button
        type="button"
        data-character-card
        onClick={onOpen}
        aria-pressed={selected}
        title={`${t.style}: ${pack.character.style}`}
        className={`block w-full overflow-hidden rounded-[14px] border text-left transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${selected ? "border-cc-primary/80" : "border-cc-border hover:border-cc-primary/35"}`}
      >
        <Plate plate={plate} className="relative grid aspect-[5/4] w-full place-items-center">
          {url ? (
            <img src={url} alt={t.character} crossOrigin="anonymous" draggable={false} className="h-[88%] w-[88%] select-none object-contain" />
          ) : (
            <span className="px-4 text-center text-[11.5px]" style={{ color: plateInk(plate) }}>
              {unread ? t.unread : t.noCharacter}
            </span>
          )}
          {!face.picked && face.toPick ? (
            <span data-to-pick className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-cc-primary px-2 py-[2px] text-[10.5px] font-medium text-white shadow-[0_4px_14px_rgba(0,0,0,0.3)]">
              {t.candidatesToPick(face.toPick)}
            </span>
          ) : null}
        </Plate>
        <div className="border-t border-cc-border bg-cc-surface/50 px-2.5 py-2">
          <div className="truncate text-[12.5px] font-semibold text-cc-fg">{value.title || t.character}</div>
          {face.picked && anchor ? <div className="text-[10.5px] text-cc-muted">{`${t.candidateN(assetNumber(anchor))} · ${t.isTheCharacter}`}</div> : null}
          {!unread && character && !character.anchor.ready && character.anchor.anchor && character.anchor.message ? (
            <div className="mt-1 text-[10.5px] text-cc-warning">{t.say(character.anchor.message)}</div>
          ) : null}
        </div>
      </button>
    </section>
  );
}

function ArtRow({ art, plate, base, t, unread, selected, onOpen }: { art: ArtKindView; plate: PlateKind; base: string; t: StickerStrings; unread: boolean; selected: boolean; onOpen: () => void }) {
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
        <div className="truncate text-[10.5px] text-cc-muted" title={art.picked ?? undefined}>
          {art.picked ? t.artN(assetNumber(art.picked)) : unread ? t.statusUnknown : art.candidates.length ? t.notPicked : t.noneYet}
        </div>
      </div>
    </button>
  );
}

/** A platform's name, toned by its checklist, with the count of what fails — or, when nothing fails, of what is left to confirm. */
function PlatformChip({ view, t, unread, tally }: { view: StickerPack["platforms"][number]; t: StickerStrings; unread: boolean; tally?: boolean }) {
  const { fail, warn, pass } = view.tally;
  const level = unread ? "unknown" : fail ? "fail" : warn ? "warn" : "pass";
  const count = level === "fail" ? fail : level === "warn" ? warn : 0;
  return (
    <span data-platform-chip={view.platform} data-level={level} className="inline-flex">
      <Chip tone={level === "unknown" ? "neutral" : level === "fail" ? "error" : level === "warn" ? "warning" : "success"} title={unread ? t.unread : t.checksTally(pass, warn, fail)}>
        {t.platformName(view.platform)}
        {tally && count ? <span className="opacity-75">· {count}</span> : null}
      </Chip>
    </span>
  );
}

function PackFacts({ value, t, keys }: { value: StickerPack; t: StickerStrings; keys: KeysKnown }) {
  const pack = value.pack!;
  const cost = value.cost;
  const unread = value.projectError !== null;
  return (
    <section className="flex flex-col gap-2.5">
      <SectionTitle>{t.pack}</SectionTitle>
      <div>
        <div className="mb-1 text-[10.5px] text-cc-muted">{t.platforms}</div>
        <div className="flex flex-wrap gap-1">
          {value.platforms.length ? (
            value.platforms.map((p) => <PlatformChip key={p.platform} view={p} t={t} unread={unread} tally />)
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
        <div data-spend className="whitespace-nowrap font-mono text-[15px] font-semibold tabular-nums text-cc-fg">{unread ? "—" : `≈ ${fmtUsd(cost.total)}`}</div>
        <div className="text-[10.5px] leading-[1.45] text-cc-muted">{unread ? t.unreadSpend : t.spendNote}</div>
        {!unread && cost.inFlight.length || cost.uncertain.length || cost.unpriced.length ? (
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
                unread={value.projectError !== null}
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
  const face = characterFace(value);
  const rights = value.pack?.rights;
  const unread = value.projectError !== null;
  return (
    <div data-compact-bar className="mb-3 flex items-center gap-3 rounded-[14px] border border-cc-border bg-cc-surface/50 p-2">
      <button type="button" onClick={() => onFocus({ type: "character" })} className="shrink-0 rounded-lg focus-visible:ring-2 focus-visible:ring-cc-primary/60" aria-label={t.character}>
        <Thumb brief={face.brief} plate={position.plate} base={base} size={48} alt={t.character} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-semibold text-cc-fg" title={`${t.style}: ${value.pack?.character.style ?? ""}`}>
          {value.title || t.untitled}
          {!face.picked && face.toPick ? <span className="ml-2 text-[10.5px] font-medium text-cc-primary">{t.candidatesToPick(face.toPick)}</span> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {rights ? <Chip tone="success">{t.rightsBasis(rights.basis)}</Chip> : <Chip tone="error">{t.rightsMissing}</Chip>}
          {value.platforms.map((p) => (
            <PlatformChip key={p.platform} view={p} t={t} unread={unread} tally />
          ))}
          {unread ? null : <span className="font-mono text-[11px] text-cc-muted">≈ {fmtUsd(value.cost.total)}</span>}
        </div>
      </div>
    </div>
  );
}
