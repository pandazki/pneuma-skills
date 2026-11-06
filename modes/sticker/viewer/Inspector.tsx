/**
 * The inspector: one sticker (stage at 2×, frame strip, takes, text), the
 * character (anchor and candidates), or one art kind (picks and what it
 * becomes on each platform).
 *
 * Writes are DECISIONS only — a picked take, anchor or art, an edited word,
 * caption, emoji or action — and go through the domain's pure edits into
 * pack.json. Statuses and reasons are the domain's (sticker-state.mjs),
 * reasons said in the user's language (`t.say`).
 */

import type { ReactNode } from "react";

import type { ArtKind, AssetBrief, Platform, StickerPack, StickerView, TakeView } from "../domain.js";
import type { StickerField } from "../domain.js";
import { PLATFORM_PROFILES, charLength } from "../skill/scripts/sticker-state.mjs";
import { elapsedOf } from "./Panel.js";
import { mediaUrl } from "./media.js";
import { FrameCanvas, GifImg, type FramesState } from "./players.js";
import type { StickerStrings } from "./strings.js";
import { Btn, Chip, DraftField, Icon, IconBtn, Plate, ReadField, SectionTitle, StatusChip, fmtBytes, fmtSeconds, plateInk } from "./ui.js";
import { frameCount, stageTake, type Plate as PlateKind, type Position } from "./view-model.js";

/** The sticker at twice the size it plays in the chat preview (120 px). */
export const STAGE_SIZE = 240;

function Shell({ title, aside, onClose, t, children }: { title: ReactNode; aside?: ReactNode; onClose: () => void; t: StickerStrings; children: ReactNode }) {
  return (
    <section data-inspector className="flex h-full min-h-0 flex-col overflow-hidden rounded-[16px] border border-cc-border bg-cc-surface/70 shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <header className="flex items-center gap-2 border-b border-cc-border px-3.5 py-2.5">
        <div className="min-w-0 flex-1">{title}</div>
        {aside}
        <IconBtn label={t.close} onClick={onClose}>
          <Icon.Close size={14} />
        </IconBtn>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-5 pt-3">{children}</div>
    </section>
  );
}

function Notice({ tone, icon, children }: { tone: "success" | "warning" | "error" | "primary" | "neutral"; icon?: ReactNode; children: ReactNode }) {
  const cls = {
    success: "border-cc-success/25 bg-cc-success/[0.07] text-cc-fg",
    warning: "border-cc-warning/35 bg-cc-warning/[0.08] text-cc-fg",
    error: "border-cc-error/35 bg-cc-error/[0.08] text-cc-fg",
    primary: "border-cc-primary/35 bg-cc-primary/[0.07] text-cc-fg",
    neutral: "border-cc-border bg-cc-bg/40 text-cc-fg",
  }[tone];
  const ink = { success: "text-cc-success", warning: "text-cc-warning", error: "text-cc-error", primary: "text-cc-primary", neutral: "text-cc-muted" }[tone];
  return (
    <div className={`flex gap-2 rounded-lg border px-2.5 py-2 text-[11.5px] leading-[1.5] ${cls}`}>
      {icon ? <span className={`mt-[2px] shrink-0 ${ink}`}>{icon}</span> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * What a plain gen does with a failed sticker, read off `genTargets`: it
 * retries one whose last call provably never left, and leaves one whose
 * last call may have been billed for the user to retry on purpose.
 */
function GenPlanLine({ value, sticker, t }: { value: StickerPack; sticker: StickerView; t: StickerStrings }) {
  const plan = value.gen;
  if (!plan) return null;
  if (plan.uncertain.some((u) => u.id === sticker.id)) {
    return (
      <div data-gen-plan="uncertain" className="mt-1.5 border-t border-cc-error/20 pt-1.5 font-medium text-cc-warning">
        {t.genLeftUncertain}
      </div>
    );
  }
  if (plan.targets.some((x) => x.id === sticker.id)) {
    return (
      <div data-gen-plan="target" className="mt-1.5 border-t border-cc-error/20 pt-1.5 text-cc-fg/75">
        {t.genRetries}
      </div>
    );
  }
  return null;
}

function BillingLine({ take, t }: { take: AssetBrief; t: StickerStrings }) {
  if (take.failure?.billing === "unknown") return <div className="mt-0.5 font-medium text-cc-warning">{t.billingUnknown}</div>;
  if (take.failure?.billing === "none") return <div className="mt-0.5 text-cc-muted">{t.billingNone}</div>;
  return null;
}

// ── Sticker ────────────────────────────────────────────────────────────────

function StatusBlock({ value, sticker, t, now, canCommand }: { value: StickerPack; sticker: StickerView; t: StickerStrings; now: number; canCommand: boolean }) {
  const state = sticker.state;
  switch (state.status) {
    case "ready":
      return (
        <Notice tone="success" icon={<Icon.Check size={12} />}>
          {t.readyHeadline}
        </Notice>
      );
    case "stale":
      return (
        <Notice tone="warning" icon={<Icon.Alert size={12} />}>
          <div data-stale-headline className="font-semibold">{t.staleHeadline}</div>
          <ul className="m-0 mt-0.5 list-none p-0 text-cc-fg/80">
            {state.messages.map((m, i) => (
              <li key={i} data-stale-reason>
                {t.say(m)}
              </li>
            ))}
          </ul>
        </Notice>
      );
    case "pick":
      return (
        <Notice tone="primary" icon={<Icon.Spark size={12} />}>
          <div className="font-semibold">{t.pickHeadline(state.ready.length)}</div>
          <div className="text-cc-fg/70">{state.messages.map(t.say).join(" · ")}</div>
        </Notice>
      );
    case "generating": {
      const busy = sticker.takes.find((x) => state.inFlight.includes(x.id));
      return (
        <Notice tone="primary" icon={<span className="block h-2.5 w-2.5 rounded-full border-[1.5px] border-current border-t-transparent motion-safe:animate-spin" />}>
          <div className="font-semibold">{t.generatingHeadline(elapsedOf(t, now, busy?.submittedAt ?? null))}</div>
          <div className="text-cc-fg/70">{state.messages.map(t.say).join(" · ")}</div>
        </Notice>
      );
    }
    case "failed":
      return (
        <Notice tone="error" icon={<Icon.Cross size={12} />}>
          <div className="font-semibold">{t.failedHeadline}</div>
          {sticker.takes
            .filter((x) => x.status === "failed")
            .map((x) => (
              <div key={x.id} data-failure={x.id} className="mt-1">
                <span className="font-mono text-[10.5px] text-cc-muted">{x.id}</span> <span className="text-cc-fg/85">{x.failure?.reason}</span>
                <BillingLine take={x} t={t} />
              </div>
            ))}
          <GenPlanLine value={value} sticker={sticker} t={t} />
        </Notice>
      );
    default:
      return <Notice tone="neutral">{canCommand ? t.emptyHeadline : t.emptyHeadlineQuiet}</Notice>;
  }
}

function Stage({
  sticker,
  take,
  position,
  frames,
  base,
  t,
  now,
}: {
  sticker: StickerView;
  take: TakeView | null;
  position: Position;
  frames: FramesState;
  base: string;
  t: StickerStrings;
  now: number;
}) {
  const plate = position.plate;
  const ink = plateInk(plate);
  const url = mediaUrl(base, take);
  let body: ReactNode;
  const frozen = position.frame !== null && frames.status === "ready" ? frames.frames[position.frame] : undefined;
  if (url && frozen) {
    body = <FrameCanvas bitmap={frozen} size={STAGE_SIZE} label={t.frame(position.frame!, frames.status === "ready" ? frames.frames.length : 0)} />;
  } else if (url) {
    body = <GifImg url={url} size={STAGE_SIZE} alt={`${sticker.sticker.word} ${sticker.sticker.caption}`} />;
  } else if (take?.status === "failed") {
    body = (
      <div className="flex max-w-[260px] flex-col items-center gap-2 text-center text-[11.5px] leading-[1.5]" style={{ color: ink }}>
        <span style={{ color: plate === "light" ? "#dc2626" : "#f87171" }}>
          <Icon.Cross size={30} />
        </span>
        <span>{take.failure?.reason}</span>
      </div>
    );
  } else if (take && (take.status === "pending" || take.status === "generating")) {
    body = (
      <div className="flex flex-col items-center gap-2" style={{ color: ink }}>
        <span className="h-9 w-9 rounded-full border-2 border-current border-t-transparent opacity-70 motion-safe:animate-spin" />
        <span className="font-mono text-[12px] tabular-nums">{elapsedOf(t, now, take.submittedAt)}</span>
      </div>
    );
  } else {
    body = (
      <div className="flex h-[150px] w-[150px] items-center justify-center rounded-[24px] border-[1.5px] border-dashed px-4 text-center text-[11px] leading-[1.5]" style={{ borderColor: `${ink}66`, color: ink }}>
        {sticker.sticker.action || t.noneYet}
      </div>
    );
  }
  return (
    <Plate plate={plate} className="relative grid w-full place-items-center rounded-[14px] py-5" style={{ minHeight: STAGE_SIZE + 40 }}>
      <div data-stage data-stage-take={take?.id ?? ""} data-stage-frame={position.frame ?? ""} className="grid place-items-center" style={{ minWidth: STAGE_SIZE, minHeight: STAGE_SIZE }}>
        {body}
      </div>
      <span className="absolute left-3 top-2 font-mono text-[10.5px]" style={{ color: ink }}>
        2×
      </span>
    </Plate>
  );
}

function FrameStrip({
  take,
  value,
  sticker,
  position,
  frames,
  t,
  onFrame,
}: {
  take: TakeView;
  value: StickerPack;
  sticker: StickerView;
  position: Position;
  frames: FramesState;
  t: StickerStrings;
  onFrame: (frame: number | null) => void;
}) {
  const total = frameCount(take, value);
  const keep = sticker.sticker.keepFrames;
  const aside = keep ? <span className="text-[10.5px] text-cc-muted">{t.keepFrames(keep.length, total)}</span> : null;
  if (frames.status === "unsupported") {
    return (
      <section data-frames="unsupported">
        <SectionTitle>{t.frames}</SectionTitle>
        <p className="m-0 rounded-lg border border-dashed border-cc-border px-2.5 py-2 text-[11px] leading-[1.5] text-cc-muted">{t.framesUnsupported}</p>
      </section>
    );
  }
  if (frames.status === "error") {
    return (
      <section data-frames="error">
        <SectionTitle>{t.frames}</SectionTitle>
        <p className="m-0 text-[11px] text-cc-error">{t.framesError(frames.message)}</p>
      </section>
    );
  }
  const count = frames.status === "ready" ? frames.frames.length : total;
  return (
    <section data-frames={frames.status}>
      <SectionTitle aside={aside}>{t.frames}</SectionTitle>
      <div className="grid grid-cols-8 gap-1">
        {Array.from({ length: count }, (_, i) => {
          const cut = keep ? !keep.includes(i) : false;
          const on = position.frame === i;
          const bitmap = frames.status === "ready" ? frames.frames[i] : undefined;
          return (
            <button
              key={i}
              type="button"
              data-frame={i}
              aria-pressed={on}
              disabled={!bitmap}
              onClick={() => onFrame(on ? null : i)}
              className={`flex min-w-0 flex-col items-center gap-0.5 rounded-lg p-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${on ? "bg-cc-primary/15 ring-1 ring-cc-primary" : "hover:bg-cc-hover"} ${cut ? "opacity-35" : ""}`}
              title={cut ? t.cut : undefined}
            >
              <Plate plate={position.plate} className="grid aspect-square w-full place-items-center overflow-hidden rounded-md">
                {bitmap ? <FrameCanvas bitmap={bitmap} size={40} className="h-full w-full" /> : <span className="h-full w-full motion-safe:animate-pulse bg-current opacity-[0.06]" />}
              </Plate>
              <span className={`font-mono text-[10px] tabular-nums ${on ? "text-cc-primary" : "text-cc-muted"}`}>{i}</span>
            </button>
          );
        })}
      </div>
      {frames.status === "loading" ? <div className="text-[10.5px] text-cc-muted">{t.framesLoading}</div> : null}
    </section>
  );
}

function TakeTile({ take, plate, base, t, now, on, onClick }: { take: TakeView; plate: PlateKind; base: string; t: StickerStrings; now: number; on: boolean; onClick: () => void }) {
  const url = mediaUrl(base, take);
  const ink = plateInk(plate);
  return (
    <button
      type="button"
      data-take={take.id}
      aria-pressed={on}
      onClick={onClick}
      className={`flex w-[76px] shrink-0 flex-col gap-1 rounded-[10px] p-1 text-left transition-colors focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${on ? "bg-cc-primary/12 ring-1 ring-cc-primary" : "hover:bg-cc-hover"}`}
    >
      <Plate plate={plate} className="relative grid h-[68px] w-[68px] place-items-center overflow-hidden rounded-lg">
        {url ? (
          <GifImg url={url} size={60} alt={t.take(take.n)} />
        ) : take.status === "failed" ? (
          <span style={{ color: plate === "light" ? "#dc2626" : "#f87171" }}>
            <Icon.Cross size={20} />
          </span>
        ) : (
          <span className="flex flex-col items-center gap-1" style={{ color: ink }}>
            <span className="h-4 w-4 rounded-full border-[1.5px] border-current border-t-transparent motion-safe:animate-spin" />
            <span className="font-mono text-[9.5px]">{elapsedOf(t, now, take.submittedAt)}</span>
          </span>
        )}
        {take.picked ? (
          <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-cc-primary text-white">
            <Icon.Check size={10} />
          </span>
        ) : null}
      </Plate>
      <span className="flex items-center gap-1 px-0.5">
        <span className="truncate text-[10.5px] text-cc-fg/90">{t.take(take.n)}</span>
        {take.staleness?.stale ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cc-warning" title={t.takeStale} /> : null}
        {take.status === "failed" ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cc-error" /> : null}
      </span>
    </button>
  );
}

function TakeDetail({ take, t, canWrite, onPick }: { take: TakeView; t: StickerStrings; canWrite: boolean; onPick: () => void }) {
  const m = take.measure;
  const facts = [
    take.actor === "human" ? t.uploaded : t.drawn,
    m ? `${m.width}×${m.height}` : take.width && take.height ? `${take.width}×${take.height}` : null,
    m?.frames ? `${m.frames} × ${m.delaysMs?.[0] ?? "?"} ms` : null,
    m?.durationMs ? fmtSeconds(m.durationMs) : null,
    m ? fmtBytes(m.bytes) : null,
    take.cost?.usd !== undefined && take.cost?.usd !== null ? `≈ $${take.cost.usd.toFixed(2)} ${take.cost.basis}` : null,
  ].filter(Boolean);
  return (
    <div data-take-detail={take.id} className="mt-2 rounded-lg border border-cc-border bg-cc-bg/35 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold text-cc-fg">{t.take(take.n)}</span>
        <span className="font-mono text-[10.5px] text-cc-muted">{take.id}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {take.picked ? <Chip tone="primary">{t.inUse}</Chip> : null}
          {take.staleness?.stale ? <Chip tone="warning">{t.takeStale}</Chip> : null}
        </span>
      </div>
      {take.status === "ready" ? <div className="mt-1 font-mono text-[10.5px] text-cc-muted">{facts.join(" · ")}</div> : null}
      {take.status === "failed" ? (
        <div className="mt-1 text-[11px] leading-[1.5] text-cc-fg/85">
          {take.failure?.reason}
          <BillingLine take={take} t={t} />
        </div>
      ) : null}
      {take.staleness?.stale && !take.picked ? <div className="mt-1 text-[10.5px] text-cc-warning">{take.staleness.messages.map(t.say).join(" · ")}</div> : null}
      {canWrite && take.status === "ready" && !take.picked ? (
        <div className="mt-2">
          <Btn primary small data-action="pick-take" onClick={onPick}>
            <Icon.Check size={12} />
            {t.useThisTake}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, hint, counter, children }: { label: string; hint: string; counter?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-2">
        <span className="text-[11.5px] font-medium text-cc-fg">{label}</span>
        <span className="truncate text-[10.5px] text-cc-muted">{hint}</span>
        {counter ? <span className="ml-auto shrink-0">{counter}</span> : null}
      </span>
      {children}
    </label>
  );
}

function TextFields({ value, sticker, t, canWrite, onField }: { value: StickerPack; sticker: StickerView; t: StickerStrings; canWrite: boolean; onField: (field: StickerField, text: string) => void }) {
  const s = sticker.sticker;
  const wechat = value.pack?.platforms.includes("wechat");
  const wordMax = PLATFORM_PROFILES.wechat.word?.max ?? 4;
  const wordLen = charLength(s.word.trim());
  const field = (name: StickerField, multiline = false) =>
    canWrite ? (
      <DraftField label={t.field[name]} dataField={name} value={s[name]} multiline={multiline} onCommit={(text) => onField(name, text)} />
    ) : (
      <ReadField value={s[name]} empty={t.emptyValue} multiline={multiline} />
    );
  return (
    <section className="flex flex-col gap-2.5">
      <SectionTitle>{t.text}</SectionTitle>
      <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
        <Field
          label={t.field.word}
          hint={wechat ? "" : t.fieldHint.word}
          counter={wechat ? <span className={`font-mono text-[10.5px] tabular-nums ${wordLen > wordMax || wordLen === 0 ? "text-cc-error" : "text-cc-muted"}`}>{wordLen}/{wordMax}</span> : null}
        >
          {field("word")}
        </Field>
        <Field label={t.field.emoji} hint="">
          {field("emoji")}
        </Field>
      </div>
      <Field label={t.field.caption} hint={t.fieldHint.caption}>
        {field("caption")}
      </Field>
      <Field label={t.field.action} hint={t.fieldHint.action}>
        {field("action", true)}
      </Field>
    </section>
  );
}

export function StickerInspector({
  value,
  sticker,
  position,
  frames,
  base,
  t,
  now,
  canWrite,
  canCommand,
  onClose,
  onShowTake,
  onFrame,
  onPickTake,
  onField,
}: {
  value: StickerPack;
  sticker: StickerView;
  position: Position;
  frames: FramesState;
  base: string;
  t: StickerStrings;
  now: number;
  canWrite: boolean;
  /** The agent can be asked (editing, not read-only): the empty headline names the command. */
  canCommand: boolean;
  onClose: () => void;
  onShowTake: (take: string | null) => void;
  onFrame: (frame: number | null) => void;
  onPickTake: (take: string) => void;
  onField: (field: StickerField, text: string) => void;
}) {
  const take = stageTake(sticker, position);
  const s = sticker.sticker;
  const m = take?.measure;
  const unknown = value.projectError !== null;
  return (
    <Shell
      t={t}
      onClose={onClose}
      title={
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-[11px] text-cc-muted">{sticker.number}</span>
          <span className="truncate text-[14px] font-semibold text-cc-fg">{s.word || s.id}</span>
          <span className="text-[14px] leading-none">{s.emoji}</span>
          <span className="font-mono text-[10.5px] text-cc-muted">{s.id}</span>
        </div>
      }
      aside={
        unknown ? (
          <StatusChip status="unknown">{t.statusUnknown}</StatusChip>
        ) : (
          <StatusChip status={sticker.state.status}>
            {t.status(sticker.state.status, sticker.state.ready.length, elapsedOf(t, now, sticker.takes.find((x) => sticker.state.inFlight.includes(x.id))?.submittedAt ?? null))}
          </StatusChip>
        )
      }
    >
      <div className="flex flex-col gap-3.5">
        {unknown ? null : <StatusBlock value={value} sticker={sticker} t={t} now={now} canCommand={canCommand} />}
        <div>
          <Stage sticker={sticker} take={take} position={position} frames={frames} base={base} t={t} now={now} />
          {take?.status === "ready" ? (
            <div className="mt-1.5 flex min-h-[26px] items-center gap-2">
              {position.frame !== null ? (
                <>
                  <span className="font-mono text-[11px] text-cc-primary">{t.frame(position.frame, frameCount(take, value))}</span>
                  <Btn small data-action="play-loop" onClick={() => onFrame(null)}>
                    <Icon.Play size={11} />
                    {t.playLoop}
                  </Btn>
                </>
              ) : (
                <span className="font-mono text-[10.5px] text-cc-muted">
                  {[m?.frames ? `${m.frames} × ${m.delaysMs?.[0] ?? value.pack?.motion.frameMs} ms` : null, m?.durationMs ? fmtSeconds(m.durationMs) : null, m ? fmtBytes(m.bytes) : null, m ? `${m.width}×${m.height}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </div>
          ) : null}
        </div>
        {take?.status === "ready" ? <FrameStrip take={take} value={value} sticker={sticker} position={position} frames={frames} t={t} onFrame={onFrame} /> : null}
        {sticker.takes.length ? (
          <section>
            <SectionTitle>{t.takes}</SectionTitle>
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
              {sticker.takes.map((x) => (
                <TakeTile
                  key={x.id}
                  take={x}
                  plate={position.plate}
                  base={base}
                  t={t}
                  now={now}
                  on={take?.id === x.id}
                  onClick={() => onShowTake(x.id === sticker.shown?.id ? null : x.id)}
                />
              ))}
            </div>
            {take ? <TakeDetail take={take} t={t} canWrite={canWrite} onPick={() => onPickTake(take.id)} /> : null}
          </section>
        ) : null}
        <TextFields value={value} sticker={sticker} t={t} canWrite={canWrite} onField={onField} />
      </div>
    </Shell>
  );
}

// ── Character ──────────────────────────────────────────────────────────────

function AssetTile({ brief, plate, base, label, on, tag, onClick }: { brief: AssetBrief; plate: PlateKind; base: string; label: string; on: boolean; tag?: ReactNode; onClick?: () => void }) {
  const url = mediaUrl(base, brief);
  const inner = (
    <>
      <Plate plate={plate} className="relative grid h-[96px] w-[96px] place-items-center overflow-hidden rounded-lg">
        {url ? <img src={url} alt={label} crossOrigin="anonymous" draggable={false} className="h-full w-full select-none object-contain" /> : <span className="text-[10px]" style={{ color: plateInk(plate) }}>{brief.status}</span>}
      </Plate>
      <span className="flex items-center gap-1 px-0.5">
        <span className="truncate font-mono text-[10px] text-cc-muted">{brief.id}</span>
      </span>
      {tag}
    </>
  );
  return onClick ? (
    <button type="button" data-asset={brief.id} aria-pressed={on} onClick={onClick} className={`flex w-[104px] shrink-0 flex-col items-start gap-1 rounded-[10px] p-1 text-left focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${on ? "bg-cc-primary/12 ring-1 ring-cc-primary" : "hover:bg-cc-hover"}`}>
      {inner}
    </button>
  ) : (
    <div data-asset={brief.id} className="flex w-[104px] shrink-0 flex-col items-start gap-1 p-1">
      {inner}
    </div>
  );
}

export function CharacterInspector({
  value,
  position,
  base,
  t,
  canWrite,
  onClose,
  onPickAnchor,
}: {
  value: StickerPack;
  position: Position;
  base: string;
  t: StickerStrings;
  canWrite: boolean;
  onClose: () => void;
  onPickAnchor: (assetId: string) => void;
}) {
  const character = value.character!;
  const pack = value.pack!;
  const anchorUrl = mediaUrl(base, character.anchor.ready ? character.asset : null);
  return (
    <Shell t={t} onClose={onClose} title={<span className="text-[14px] font-semibold text-cc-fg">{t.character}</span>}>
      <div className="flex flex-col gap-3.5">
        <Plate plate={position.plate} className="grid w-full place-items-center rounded-[14px] py-4" style={{ minHeight: STAGE_SIZE + 32 }}>
          {anchorUrl ? (
            <img src={anchorUrl} alt={t.character} crossOrigin="anonymous" draggable={false} style={{ width: STAGE_SIZE, height: STAGE_SIZE }} className="select-none object-contain" />
          ) : (
            <span className="px-6 text-center text-[12px]" style={{ color: plateInk(position.plate) }}>
              {t.noCharacter}
            </span>
          )}
        </Plate>
        {character.anchor.message && character.anchor.anchor ? (
          <Notice tone="warning" icon={<Icon.Alert size={12} />}>
            {t.say(character.anchor.message)}
          </Notice>
        ) : null}
        {character.candidates.length ? (
          <section>
            <SectionTitle>{t.candidates}</SectionTitle>
            <div className="flex flex-wrap gap-1">
              {character.candidates.map((c) => {
                const isAnchor = pack.character.anchor === c.id;
                return (
                  <AssetTile
                    key={c.id}
                    brief={c}
                    plate={position.plate}
                    base={base}
                    label={c.id}
                    on={isAnchor}
                    tag={
                      isAnchor ? (
                        <Chip tone="primary">{t.isTheCharacter}</Chip>
                      ) : canWrite && c.status === "ready" ? (
                        <Btn small data-action="pick-anchor" onClick={() => onPickAnchor(c.id)}>
                          {t.useAsCharacter}
                        </Btn>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          </section>
        ) : null}
        {character.sources.length ? (
          <section>
            <SectionTitle>{t.sources}</SectionTitle>
            <div className="flex flex-wrap gap-1">
              {character.sources.map((c) => (
                <AssetTile key={c.id} brief={c} plate={position.plate} base={base} label={c.id} on={false} />
              ))}
            </div>
          </section>
        ) : null}
        <section className="flex flex-col gap-2">
          <div>
            <div className="text-[11.5px] font-medium text-cc-fg">{t.description}</div>
            <p className="m-0 mt-0.5 text-[12px] leading-[1.55] text-cc-fg/85">{pack.character.description || <span className="italic text-cc-muted">{t.emptyValue}</span>}</p>
          </div>
          <div>
            <div className="text-[11.5px] font-medium text-cc-fg">{t.style}</div>
            <p className="m-0 mt-0.5 text-[12px] leading-[1.55] text-cc-fg/85">{pack.character.style}</p>
          </div>
        </section>
      </div>
    </Shell>
  );
}

// ── Art ────────────────────────────────────────────────────────────────────

export function ArtInspector({
  value,
  kind,
  position,
  base,
  t,
  canWrite,
  onClose,
  onPickArt,
  onExport,
}: {
  value: StickerPack;
  kind: ArtKind;
  position: Position;
  base: string;
  t: StickerStrings;
  canWrite: boolean;
  onClose: () => void;
  onPickArt: (assetId: string) => void;
  onExport: (platform: Platform) => void;
}) {
  const art = value.art.find((a) => a.kind === kind)!;
  const url = mediaUrl(base, art.asset?.status === "ready" ? art.asset : null);
  return (
    <Shell t={t} onClose={onClose} title={<span className="text-[14px] font-semibold text-cc-fg">{t.artKind(kind)}</span>}>
      <div className="flex flex-col gap-3.5">
        <Plate plate={position.plate} checker className="grid w-full place-items-center rounded-[14px] p-4" style={{ minHeight: 200 }}>
          {url ? <img src={url} alt={t.artKind(kind)} crossOrigin="anonymous" draggable={false} className="max-h-[260px] max-w-full select-none object-contain" /> : <span className="text-[12px]" style={{ color: plateInk(position.plate) }}>{art.picked ?? t.notPicked}</span>}
        </Plate>
        {art.candidates.length ? (
          <section>
            <SectionTitle>{t.candidates}</SectionTitle>
            <div className="flex flex-wrap gap-1">
              {art.candidates.map((c) => {
                const picked = art.picked === c.id;
                return (
                  <AssetTile
                    key={c.id}
                    brief={c}
                    plate={position.plate}
                    base={base}
                    label={c.id}
                    on={picked}
                    tag={
                      picked ? (
                        <Chip tone="primary">{t.inUse}</Chip>
                      ) : canWrite && c.status === "ready" ? (
                        <Btn small data-action="pick-art" onClick={() => onPickArt(c.id)}>
                          {t.useThisArt}
                        </Btn>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          </section>
        ) : null}
        <section>
          <SectionTitle>{t.becomes}</SectionTitle>
          {art.becomes.length ? (
            <div className="flex flex-col gap-1">
              {art.becomes.map((b) => {
                const item = value.platforms.find((p) => p.platform === b.platform)?.exports.items.find((i) => i.deliverable === b.deliverable);
                const spec = PLATFORM_PROFILES[b.platform].deliverables[b.deliverable];
                return (
                  <button
                    key={`${b.platform}-${b.deliverable}`}
                    type="button"
                    data-becomes={`${b.platform}:${b.deliverable}`}
                    onClick={() => onExport(b.platform)}
                    className="flex items-center gap-2 rounded-lg border border-cc-border bg-cc-bg/35 px-2.5 py-1.5 text-left transition-colors hover:border-cc-primary/40 focus-visible:ring-2 focus-visible:ring-cc-primary/60"
                  >
                    <span className="text-[11.5px] font-medium text-cc-fg">{PLATFORM_PROFILES[b.platform].label}</span>
                    <span className="truncate text-[11px] text-cc-muted">{t.deliverableLabel(b.platform, b.deliverable)}</span>
                    <span className="font-mono text-[10.5px] text-cc-muted">{spec ? `${spec.width}×${spec.height}` : ""}</span>
                    {item ? (
                      <span className="ml-auto">
                        <Chip tone={item.state === "current" ? "success" : item.state === "blocked" ? "neutral" : "warning"}>{t.exportState[item.state]}</Chip>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="m-0 text-[11.5px] text-cc-muted">{t.artUnused}</p>
          )}
        </section>
      </div>
    </Shell>
  );
}
