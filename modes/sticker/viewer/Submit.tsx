/**
 * One submission tab per chosen platform: the checklist (`checkPack` rows —
 * the same rows `sticker.mjs check` prints), the exported files at native
 * size on the chat plate (`exportState` says which are current), and the
 * listing text with the platform's own character count.
 */

import { useEffect, useRef, type ReactNode } from "react";

import type { CheckRow, ExportItem, ExportItemState, Platform, PlatformView, StickerPack } from "../domain.js";
import { asianWidthLength, charLength } from "../skill/scripts/sticker-state.mjs";
import type { TextSpec } from "../skill/scripts/sticker-state.mjs";
import { fileUrl, mediaUrl } from "./media.js";
import { ApngPlayer, GifImg, WebmPlayer } from "./players.js";
import type { StickerStrings } from "./strings.js";
import { Btn, Chip, DraftField, Icon, Plate, ReadField, SectionTitle, Segmented, fmtBytes, plateInk } from "./ui.js";
import type { Focus, Plate as PlateKind, Position } from "./view-model.js";

const LEVEL_STYLE: Record<CheckRow["level"], { ink: string; icon: ReactNode }> = {
  pass: { ink: "text-cc-success", icon: <Icon.Check size={13} /> },
  warn: { ink: "text-cc-warning", icon: <Icon.Alert size={13} /> },
  fail: { ink: "text-cc-error", icon: <Icon.Cross size={13} /> },
};

const STATE_TONE: Record<ExportItemState, "success" | "warning" | "error" | "neutral"> = {
  current: "success",
  stale: "warning",
  missing: "error",
  blocked: "neutral",
};

function rowFocus(row: CheckRow): Focus | null {
  if (row.address?.sticker) return { type: "sticker", id: row.address.sticker };
  if (row.address?.art) return { type: "art", kind: row.address.art };
  return null;
}

function CheckRowView({ row, t, focus, words, onRow, quiet }: { row: CheckRow; t: StickerStrings; focus: Focus | null; words: Map<string, string>; onRow: (focus: Focus) => void; quiet?: boolean }) {
  const target = rowFocus(row);
  const on = !!target && !!focus && JSON.stringify(target) === JSON.stringify(focus);
  const style = LEVEL_STYLE[row.level];
  const word = row.id.startsWith("sticker-") ? words.get(row.id.slice("sticker-".length)) : undefined;
  const inner = (
    <>
      <span className={`mt-[2px] shrink-0 ${style.ink}`} aria-label={t.level[row.level]}>
        {style.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-cc-fg">
          {t.rowLabel(row.id, row.label)}
          {word ? <span className="ml-1.5 font-normal text-cc-fg/70">{word}</span> : null}
        </span>
        <span className={`block break-words text-[11px] leading-[1.5] text-cc-muted ${quiet ? "line-clamp-1" : ""}`}>{row.detail}</span>
      </span>
    </>
  );
  const cls = `flex w-full gap-2 border-b border-cc-border px-2.5 text-left last:border-b-0 ${quiet ? "py-1.5" : "py-2"} ${on ? "bg-cc-primary/10" : ""}`;
  return target ? (
    <button type="button" data-check={row.id} data-level={row.level} onClick={() => onRow(target)} className={`${cls} transition-colors hover:bg-cc-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cc-primary/60`}>
      {inner}
    </button>
  ) : (
    <div data-check={row.id} data-level={row.level} className={cls}>
      {inner}
    </div>
  );
}

/**
 * The rows in the module's order, split by what a person has to do: what
 * fails or warns first, what passes below. A row that names a sticker or
 * an art kind points at its file.
 */
function Checklist({ value, view, t, focus, onRow }: { value: StickerPack; view: PlatformView; t: StickerStrings; focus: Focus | null; onRow: (focus: Focus) => void }) {
  const words = new Map(value.stickers.map((s) => [s.id, s.sticker.word]));
  const attention = view.rows.filter((r) => r.level !== "pass");
  const passing = view.rows.filter((r) => r.level === "pass");
  return (
    <section data-checklist={view.platform} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-cc-muted">{t.checklist}</h3>
        <span className="ml-auto flex items-center gap-1">
          <Chip tone={view.tally.fail ? "error" : "neutral"}>{t.level.fail} {view.tally.fail}</Chip>
          <Chip tone={view.tally.warn ? "warning" : "neutral"}>{t.level.warn} {view.tally.warn}</Chip>
          <Chip tone="success">{t.level.pass} {view.tally.pass}</Chip>
        </span>
      </div>
      {attention.length ? (
        <div>
          <div className="mb-1 text-[11px] font-medium text-cc-fg/80">{t.needsAttention(attention.length)}</div>
          <div className="overflow-hidden rounded-[12px] border border-cc-border bg-cc-bg/35">
            {attention.map((row) => (
              <CheckRowView key={row.id} row={row} t={t} focus={focus} words={words} onRow={onRow} />
            ))}
          </div>
        </div>
      ) : (
        <div data-all-pass className="flex items-center gap-2 rounded-[12px] border border-cc-success/30 bg-cc-success/[0.07] px-3 py-2.5 text-[12px] font-medium text-cc-fg">
          <span className="text-cc-success">
            <Icon.Check size={14} />
          </span>
          {t.allPass}
        </div>
      )}
      {passing.length ? (
        <div>
          <div className="mb-1 text-[11px] font-medium text-cc-fg/80">{t.passing(passing.length)}</div>
          <div className="overflow-hidden rounded-[12px] border border-cc-border bg-cc-bg/25">
            {passing.map((row) => (
              <CheckRowView key={row.id} row={row} t={t} focus={focus} words={words} onRow={onRow} quiet />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Files larger than this are shown scaled, and say so; smaller ones at their own pixels. */
const MAX_TILE = 320;

function nativeSize(view: PlatformView, item: ExportItem): { width: number; height: number } {
  if (item.measure?.width && item.measure.height) return { width: item.measure.width, height: item.measure.height };
  if (item.kind === "sticker") {
    const rules = view.profile.sticker as Record<string, unknown>;
    const w = (rules.width ?? rules.edge ?? rules.maxWidth ?? 240) as number;
    const h = (rules.height ?? rules.edge ?? rules.maxHeight ?? 240) as number;
    return { width: w, height: h };
  }
  const spec = view.profile.deliverables[item.deliverable];
  return { width: spec?.width ?? 240, height: spec?.height ?? 240 };
}

function displaySize(view: PlatformView, item: ExportItem, cap: number): { width: number; height: number; scale: number } {
  const native = nativeSize(view, item);
  const scale = Math.min(1, cap / Math.max(native.width, native.height));
  return { width: Math.round(native.width * scale), height: Math.round(native.height * scale), scale };
}

function ExportMedia({ value, view, item, base, plate, t }: { value: StickerPack; view: PlatformView; item: ExportItem; base: string; plate: PlateKind; t: StickerStrings }) {
  const { width, height } = displaySize(view, item, item.kind === "art" ? 480 : MAX_TILE);
  const url = item.file ? mediaUrl(base, value.assets[item.assetId]) : null;
  if (!url) {
    return (
      <div
        className="grid max-w-full place-items-center rounded-md border-[1.5px] border-dashed px-3 text-center text-[11px] leading-[1.45]"
        style={{ width, aspectRatio: `${width} / ${height}`, borderColor: `${plateInk(plate)}55`, color: plateInk(plate) }}
      >
        {item.reason ?? t.exportState[item.state]}
      </div>
    );
  }
  const format = item.measure?.format ?? (item.ext === "webm" ? "webm" : item.ext === "gif" ? "gif" : "png");
  if (format === "webm") return <WebmPlayer url={url} width={width} height={height} measure={item.measure} messages={{ noVp9: t.noVp9, noAlpha: t.noAlpha }} />;
  if (format === "apng") return <ApngPlayer url={url} width={width} height={height} measure={item.measure} labels={{ replay: t.replay, plays: t.plays, loops: t.loops }} />;
  if (format === "gif") return <GifImg url={url} size={width} alt={item.name} className="max-w-full" />;
  return (
    <img src={url} alt={item.name} crossOrigin="anonymous" draggable={false} style={{ width, aspectRatio: `${width} / ${height}` }} className="max-w-full select-none object-contain" />
  );
}

function ExportTile({ value, view, item, base, plate, t, highlighted }: { value: StickerPack; view: PlatformView; item: ExportItem; base: string; plate: PlateKind; t: StickerStrings; highlighted: boolean }) {
  const ref = useRef<HTMLElement | null>(null);
  const { scale } = displaySize(view, item, item.kind === "art" ? 480 : MAX_TILE);
  const word = item.sticker && item.kind === "sticker" ? value.stickers.find((s) => s.id === item.sticker)?.sticker.word : undefined;
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [highlighted]);
  const m = item.measure;
  const spec = item.kind === "sticker" ? null : view.profile.deliverables[item.deliverable];
  const label = item.kind === "sticker" ? `${item.name} · ${item.sticker}` : spec?.label ?? item.deliverable;
  return (
    <figure
      ref={ref}
      data-export={item.assetId}
      data-state={item.state}
      className={`m-0 flex min-w-0 max-w-full flex-col gap-1.5 rounded-[12px] p-1.5 transition-shadow ${highlighted ? "shadow-[0_0_0_2px_var(--color-cc-primary)]" : ""}`}
    >
      <Plate plate={plate} checker={item.kind !== "sticker"} className="grid max-w-full place-items-center rounded-[10px] p-3" style={{ color: plateInk(plate) }}>
        <ExportMedia value={value} view={view} item={item} base={base} plate={plate} t={t} />
      </Plate>
      <figcaption className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 px-0.5">
        <span className="truncate text-[11.5px] font-medium text-cc-fg">{label}</span>
        {word ? <span className="truncate text-[11px] text-cc-fg/70">{word}</span> : null}
        {item.state !== "current" ? <Chip tone={STATE_TONE[item.state]} title={item.reason ?? undefined}>{t.exportState[item.state]}</Chip> : null}
        {m ? <span className="font-mono text-[10.5px] text-cc-muted">{`${m.width}×${m.height} · ${fmtBytes(m.bytes)}`}</span> : null}
        {scale < 1 ? <span className="font-mono text-[10.5px] text-cc-muted">· {t.shownAt(Math.round(scale * 100))}</span> : null}
      </figcaption>
      {item.state === "stale" && item.reason ? <div className="px-0.5 text-[10.5px] leading-[1.45] text-cc-warning">{item.reason}</div> : null}
    </figure>
  );
}

function Missing({ items, value, view, t, focus }: { items: ExportItem[]; value: StickerPack; view: PlatformView; t: StickerStrings; focus: Focus | null }) {
  if (!items.length) return null;
  return (
    <div data-not-exported className="overflow-hidden rounded-[12px] border border-dashed border-cc-border">
      {items.map((item) => {
        const spec = item.kind === "sticker" ? null : view.profile.deliverables[item.deliverable];
        const word = item.kind === "sticker" ? value.stickers.find((s) => s.id === item.sticker)?.sticker.word : undefined;
        const on = !!focus && ((focus.type === "sticker" && item.sticker === focus.id) || (focus.type === "art" && item.art === focus.kind));
        return (
          <div key={item.assetId} data-export={item.assetId} data-state={item.state} className={`flex items-baseline gap-2 border-b border-dashed border-cc-border px-2.5 py-1.5 last:border-b-0 ${on ? "bg-cc-primary/10" : ""}`}>
            <span className="shrink-0 text-[11.5px] font-medium text-cc-fg">{item.kind === "sticker" ? `${item.name} · ${item.sticker}` : spec?.label ?? item.deliverable}</span>
            {word ? <span className="shrink-0 text-[11px] text-cc-fg/70">{word}</span> : null}
            <Chip tone={STATE_TONE[item.state]}>{t.exportState[item.state]}</Chip>
            <span className="min-w-0 truncate text-[10.5px] text-cc-muted" title={item.reason ?? undefined}>
              {item.reason}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Files({ value, view, base, plate, t, focus }: { value: StickerPack; view: PlatformView; base: string; plate: PlateKind; t: StickerStrings; focus: Focus | null }) {
  const exists = (i: ExportItem) => !!i.file && (i.state === "current" || i.state === "stale");
  const stickers = view.exports.items.filter((i) => i.kind === "sticker");
  const extras = view.exports.items.filter((i) => i.kind !== "sticker");
  const missing = view.exports.items.filter((i) => !exists(i) && !(i.optional && i.state === "blocked"));
  const isOn = (item: ExportItem) =>
    !!focus && ((focus.type === "sticker" && (item.kind === "sticker" || item.kind === "main") && item.sticker === focus.id) || (focus.type === "art" && item.kind === "art" && item.art === focus.kind));
  const tiles = (items: ExportItem[]) => (
    <div className="flex flex-wrap items-start gap-2">
      {items.filter(exists).map((item) => (
        <ExportTile key={item.assetId} value={value} view={view} item={item} base={base} plate={plate} t={t} highlighted={isOn(item)} />
      ))}
    </div>
  );
  return (
    <section data-files={view.platform} className="flex min-w-0 flex-col gap-3">
      <SectionTitle aside={<span className="text-[10.5px] text-cc-muted">{t.exportSummary(countStates(view.exports.items))}</span>}>{t.files}</SectionTitle>
      {stickers.some(exists) ? (
        <div>
          <div className="mb-1 text-[11px] font-medium text-cc-fg/80">{t.stickersFiles}</div>
          {tiles(stickers)}
        </div>
      ) : null}
      {extras.some(exists) ? (
        <div>
          <div className="mb-1 text-[11px] font-medium text-cc-fg/80">{t.platformArt}</div>
          {tiles(extras)}
        </div>
      ) : null}
      {missing.length ? (
        <div>
          <div className="mb-1 text-[11px] font-medium text-cc-fg/80">{t.notExportedYet(missing.length)}</div>
          <Missing items={missing} value={value} view={view} t={t} focus={focus} />
        </div>
      ) : null}
    </section>
  );
}

function countStates(items: ExportItem[]): Record<ExportItemState, number> {
  const out: Record<ExportItemState, number> = { current: 0, stale: 0, missing: 0, blocked: 0 };
  for (const i of items) out[i.state] += 1;
  return out;
}

function Listing({ view, t, canWrite, listing, onListing }: { view: PlatformView; t: StickerStrings; canWrite: boolean; listing: Record<string, string | undefined>; onListing: (field: string, text: string) => void }) {
  const fields = Object.entries(view.profile.text) as Array<[string, TextSpec]>;
  return (
    <section data-listing={view.platform}>
      <SectionTitle aside={<span className="font-mono text-[10.5px] text-cc-muted">exports/{view.platform}/{view.profile.listingFile}</span>}>{t.listing}</SectionTitle>
      <div className="flex flex-col gap-2.5 rounded-[12px] border border-cc-border bg-cc-bg/35 p-2.5">
        {fields.map(([field, spec]) => {
          const text = listing[field] ?? "";
          const length = spec.asianWidth ? asianWidthLength(text) : charLength(text);
          const over = (spec.max !== undefined && length > spec.max) || (spec.min !== undefined && text && length < spec.min);
          return (
            <label key={field} className="flex flex-col gap-1">
              <span className="flex items-baseline gap-2">
                <span className="text-[11.5px] font-medium text-cc-fg">{spec.label}</span>
                <span className="text-[10.5px] text-cc-muted">{spec.required ? t.required : t.optional}</span>
                {spec.max !== undefined ? (
                  <span data-counter={field} className={`ml-auto font-mono text-[10.5px] tabular-nums ${over ? "text-cc-error" : "text-cc-muted"}`} title={spec.asianWidth ? t.asianWidth : undefined}>
                    {length}/{spec.max}
                    {spec.asianWidth ? "*" : ""}
                  </span>
                ) : null}
              </span>
              {canWrite ? (
                <DraftField label={spec.label} dataField={`listing-${field}`} value={text} multiline={(spec.max ?? 0) > 60} onCommit={(next) => onListing(field, next)} />
              ) : (
                <ReadField value={text} empty={t.emptyValue} />
              )}
            </label>
          );
        })}
        {fields.some(([, spec]) => spec.asianWidth) ? <span className="text-[10px] text-cc-muted">* {t.asianWidth}</span> : null}
      </div>
    </section>
  );
}

export function SubmitView({
  value,
  position,
  base,
  t,
  wide,
  canWrite,
  canCommand,
  onTab,
  onRow,
  onListing,
  onExport,
}: {
  value: StickerPack;
  position: Position;
  base: string;
  t: StickerStrings;
  wide: boolean;
  canWrite: boolean;
  canCommand: boolean;
  onTab: (platform: Platform) => void;
  onRow: (focus: Focus) => void;
  onListing: (platform: Platform, field: string, text: string) => void;
  onExport: (platform: Platform) => void;
}) {
  const view = value.platforms.find((p) => p.platform === position.platform) ?? value.platforms[0];
  if (!view) return <p className="p-8 text-center text-[12.5px] text-cc-muted">{t.noPlatforms}</p>;
  const archive = view.exports.archive;
  const counts = countStates(view.exports.items);
  const staleFiles = counts.stale + counts.missing;
  const listing = (value.pack?.listing[view.platform] ?? {}) as Record<string, string | undefined>;
  const focus = position.focus;
  // Takes, exports and archives are all recorded in project.json: while it
  // cannot be read, every check and file state here would be a guess.
  const unread = value.projectError !== null;

  return (
    <div data-submit={view.platform} className="flex flex-col gap-3.5 px-4 pb-8 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label={t.view.submit}
          dataName="platform"
          value={view.platform}
          onChange={onTab}
          options={value.platforms.map((p) => ({
            value: p.platform,
            label: p.profile.label,
            badge: unread ? null : p.tally.fail ? (
              <span className="rounded-full bg-cc-error/15 px-1.5 font-mono text-[10px] text-cc-error">{p.tally.fail}</span>
            ) : p.tally.warn ? (
              <span className="rounded-full bg-cc-warning/15 px-1.5 font-mono text-[10px] text-cc-warning">{p.tally.warn}</span>
            ) : (
              <span className="text-cc-success">
                <Icon.Check size={11} />
              </span>
            ),
          }))}
        />
        <span className="ml-auto" />
        {canCommand && !unread ? (
          <Btn primary data-command="export-check" onClick={() => onExport(view.platform)}>
            <Icon.Spark size={13} />
            {t.exportCheck}
          </Btn>
        ) : null}
      </div>

      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] border border-cc-border bg-cc-surface/60 px-3.5 py-2.5 backdrop-blur">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-cc-fg">{view.profile.label}</div>
          <div className="flex flex-wrap items-center gap-x-2 text-[10.5px] text-cc-muted">
            <span>{t.rulesRead(view.profile.checked)}</span>
            {view.profile.sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" title={s.url} className="inline-flex items-center gap-0.5 underline decoration-cc-border underline-offset-2 hover:text-cc-fg">
                {s.what.length > 48 ? new URL(s.url).host : s.what}
                <Icon.Link size={10} />
              </a>
            ))}
          </div>
        </div>
        {unread ? null : (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-[10.5px] text-cc-muted">{t.archive}</span>
            <span className="font-mono text-[11px] text-cc-fg/90">{archive.uri}</span>
            {archive.measure ? <span className="font-mono text-[10.5px] text-cc-muted">{fmtBytes(archive.measure.bytes)} · {t.archiveFiles(archive.measure.entries.length)}</span> : null}
            <Chip tone={STATE_TONE[archive.state]}>{t.archiveState(archive.state)}</Chip>
            {archive.measure && archive.state === "current" ? (
              <a
                data-download={archive.uri}
                href={fileUrl(base, archive.uri, archive.measure.at)}
                download
                className="inline-flex items-center gap-1 rounded-md border border-cc-border px-1.5 py-0.5 text-[11px] text-cc-fg transition-colors hover:border-cc-primary/40 focus-visible:ring-2 focus-visible:ring-cc-primary/60"
              >
                <Icon.Download size={11} />
                {t.download}
              </a>
            ) : null}
          </div>
        )}
      </header>

      {unread ? (
        <div data-checks-unread role="status" className="rounded-[14px] border border-cc-error/35 bg-cc-error/[0.07] px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-cc-error">
            <Icon.Alert size={13} />
            {t.unreadChecksTitle}
          </div>
          <p className="m-0 mt-1 text-[11.5px] leading-[1.55] text-cc-fg/85">{t.unreadChecksBody}</p>
        </div>
      ) : null}

      {unread ? (
        <Listing view={view} t={t} canWrite={canWrite} listing={listing} onListing={(f, text) => onListing(view.platform, f, text)} />
      ) : null}

      {!unread && staleFiles ? (
        <div data-exports-stale className="flex items-center gap-2 rounded-lg border border-cc-warning/35 bg-cc-warning/[0.08] px-3 py-2 text-[11.5px] text-cc-fg">
          <span className="text-cc-warning">
            <Icon.Alert size={13} />
          </span>
          {t.exportsStale(staleFiles)}
        </div>
      ) : null}

      {unread ? null : (
        <div className="grid items-start gap-4" style={{ gridTemplateColumns: wide ? "minmax(0, 0.95fr) minmax(0, 1.05fr)" : "minmax(0, 1fr)" }}>
          <div className="flex min-w-0 flex-col gap-4">
            <Checklist value={value} view={view} t={t} focus={focus} onRow={onRow} />
            {wide ? <Listing view={view} t={t} canWrite={canWrite} listing={listing} onListing={(f, text) => onListing(view.platform, f, text)} /> : null}
          </div>
          <Files value={value} view={view} base={base} plate={position.plate} t={t} focus={focus} />
          {!wide ? <Listing view={view} t={t} canWrite={canWrite} listing={listing} onListing={(f, text) => onListing(view.platform, f, text)} /> : null}
        </div>
      )}
    </div>
  );
}
