/**
 * Two overlays on the desk: the whole storyboard grid exactly as the model
 * received it (and, with several, the pick between them), and the prompts.
 *
 * The prompts are what the script sent when it sent something (the sidecar's
 * `prompts[part]`); before that, they are assembled by the same module the
 * script runs (`prompts.mjs`) and labelled a preview — the no-key path, where
 * the user copies them into another tool.
 */

import { useMemo, useState } from "react";

import type { EpisodeView, PartView, Series } from "../domain.js";
import { isBusy } from "../domain.js";
import { assemblePart } from "../skill/scripts/prompts.mjs";
import { mediaUrl } from "./media.js";
import type { SeriesStrings } from "./strings.js";
import { Btn, Chip, CloseIcon, FailureNote, HATCH, Tiny } from "./ui.js";
import { fmtUsd } from "./view-model.js";

function Shell({ title, t, onClose, children }: { title: React.ReactNode; t: SeriesStrings; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center overflow-auto bg-cc-bg/70 p-4 backdrop-blur-[6px]" onClick={onClose}>
      <div className="w-full max-w-[1100px] rounded-[12px] border border-cc-border bg-cc-surface/95 p-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="mb-2.5 flex items-center gap-2">
          <h3 className="m-0 text-[13px] font-semibold text-cc-fg">{title}</h3>
          <button
            type="button"
            aria-label={t.close}
            onClick={onClose}
            className="ml-auto grid h-7 w-7 place-items-center rounded-[7px] border border-cc-border text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          >
            <CloseIcon />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/**
 * The whole grid, and — when a part has more than one — every storyboard it
 * has, so the user picks the one the video is shot from (`picks.storyboard`).
 */
export function GridOverlay({
  part,
  base,
  t,
  canWrite,
  onUse,
  onClose,
}: {
  part: PartView;
  base: string;
  t: SeriesStrings;
  canWrite: boolean;
  onUse: (asset: string) => void;
  onClose: () => void;
}) {
  const inUse = part.board?.record.asset ?? null;
  const [shown, setShown] = useState<string | null>(inUse);
  const current = part.boards.find((b) => b.record.asset === shown) ?? part.board;
  const src = current && current.view.status === "ready" ? mediaUrl(base, current.view) : null;
  const many = part.boards.length > 1;
  return (
    <Shell title={many ? t.boardsTitle(part.boards.length) : t.gridTitle} t={t} onClose={onClose}>
      {src ? (
        <img src={src} alt={current?.record.asset ?? ""} draggable={false} className="block w-full rounded-[8px] bg-[#ece8df]" />
      ) : (
        <p className="m-0 text-[12px] text-cc-muted">{t.gridNone}</p>
      )}
      {many ? (
        <div className="mt-2.5 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
          {[...part.boards].reverse().map((b) => {
            const id = b.record.asset;
            const thumb = b.view.status === "ready" ? mediaUrl(base, b.view) : null;
            const ratio = b.view.width && b.view.height ? b.view.width / b.view.height : 16 / 9;
            return (
              <div
                key={id}
                onClick={() => setShown(id)}
                className={`cursor-pointer rounded-[9px] border bg-cc-card p-1.5 ${
                  id === current?.record.asset ? "border-cc-primary/60 shadow-[0_0_0_3px_var(--color-cc-glow)]" : "border-cc-border"
                }`}
              >
                <div className="relative overflow-hidden rounded-[5px] bg-[#ece8df]" style={{ aspectRatio: String(ratio) }}>
                  {thumb ? (
                    <img src={thumb} alt={id} draggable={false} className="h-full w-full object-contain" />
                  ) : (
                    <div className="grid h-full w-full place-items-center bg-cc-bg" style={isBusy(b.view) ? HATCH : undefined}>
                      <Chip tone={b.view.status === "failed" ? "err" : "gen"} pulse={isBusy(b.view)}>
                        {b.view.status === "failed" ? t.failed : t.generating}
                      </Chip>
                    </div>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="truncate text-[11px] tabular-nums text-cc-muted">{id}</span>
                  {b.view.spent !== null ? <Chip tone="dim">{fmtUsd(b.view.spent)}</Chip> : null}
                  <span className="ml-auto shrink-0">
                    {id === inUse ? (
                      <Chip tone="ok">{t.inUse}</Chip>
                    ) : b.view.status === "ready" ? (
                      <Btn
                        primary
                        disabled={!canWrite}
                        onClick={() => onUse(id)}
                      >
                        {t.useThis}
                      </Btn>
                    ) : null}
                  </span>
                </div>
                {b.view.status === "failed" ? <FailureNote failure={b.view.failure} t={t} className="mt-1" /> : null}
                {b.record.from ? <Tiny className="mt-1 block">{t.boardRedraw(b.record.from.shot, b.record.from.board)}</Tiny> : null}
                {id === inUse && !part.boardPicked ? <Tiny className="mt-1 block">{t.boardNewest}</Tiny> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </Shell>
  );
}

function PromptBlock({ label, note, text, t }: { label: string; note?: string; text: string; t: SeriesStrings }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-[8px] border border-cc-border bg-cc-bg/60">
      <header className="flex items-center gap-2 border-b border-cc-border px-2.5 py-1.5">
        <span className="text-[11px] font-medium text-cc-fg">{label}</span>
        {note ? <Tiny>{note}</Tiny> : null}
        <Btn
          className="ml-auto"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            });
          }}
        >
          {copied ? t.copied : t.copy}
        </Btn>
      </header>
      <pre className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap px-2.5 py-2 font-mono text-[11px] leading-[1.6] text-cc-muted">{text}</pre>
    </div>
  );
}

export function PromptsOverlay({
  series,
  episode,
  part,
  t,
  onClose,
}: {
  series: Series;
  episode: EpisodeView;
  part: PartView;
  t: SeriesStrings;
  onClose: () => void;
}) {
  const view = useMemo(() => {
    // What was SENT wins: the board's and the take's provenance edges record
    // the exact prompt; the sidecar's assembly is the next-best record.
    const sentBoard = part.board?.view.prompt ?? part.prompts?.storyboard ?? null;
    const sentVideo = part.take?.view.prompt ?? part.prompts?.video ?? null;
    let preview: { storyboard: string; video: string; jimeng: { storyboard: string; video: string } } | null = null;
    let error: string | null = null;
    try {
      const sheetOf = (kind: "character" | "group" | "scene", id: string) => {
        const card = series.cards.find((c) => c.kind === kind && c.id === id);
        return card?.sheet && card.sheet.status === "ready" ? card.sheet.id : null;
      };
      const assembled = assemblePart(series.bible, episode.episode, part.id, {
        sheetOf,
        board: part.board?.record.asset ?? null,
      });
      preview = { storyboard: assembled.storyboard.prompt, video: assembled.video.prompt, jimeng: assembled.jimeng };
    } catch (e) {
      error = (e as Error).message;
    }
    return {
      storyboard: sentBoard ?? preview?.storyboard ?? null,
      storyboardSent: sentBoard !== null,
      video: sentVideo ?? preview?.video ?? null,
      videoSent: sentVideo !== null,
      jimeng: part.prompts?.jimeng ?? preview?.jimeng ?? null,
      error: sentBoard === null && sentVideo === null ? error : null,
    };
  }, [series, episode, part]);

  const tag = (sent: boolean, asset: string | undefined) => (sent ? t.promptsSent(asset ?? "") : t.promptsPreview);

  return (
    <Shell
      title={
        <span className="inline-flex items-baseline gap-2">
          {t.promptsTitle} · {episode.id}
          {episode.parts.length > 1 ? ` · ${t.partLabel(part.id)}` : ""}
        </span>
      }
      t={t}
      onClose={onClose}
    >
      {view.error ? (
        <p className="m-0 text-[12px] text-cc-warning">{t.promptsUnavailable(view.error)}</p>
      ) : (
        <div className="grid gap-2.5">
          {view.storyboard !== null ? (
            <PromptBlock label={t.promptStoryboard} note={tag(view.storyboardSent, part.board?.record.asset)} text={view.storyboard} t={t} />
          ) : null}
          {view.video !== null ? (
            <PromptBlock label={t.promptVideo} note={tag(view.videoSent, part.take?.record.asset)} text={view.video} t={t} />
          ) : null}
          {view.jimeng ? (
            <>
              <PromptBlock label={`${t.promptJimeng} · ${t.promptStoryboard}`} text={view.jimeng.storyboard} t={t} />
              <PromptBlock label={`${t.promptJimeng} · ${t.promptVideo}`} text={view.jimeng.video} t={t} />
            </>
          ) : null}
        </div>
      )}
    </Shell>
  );
}
