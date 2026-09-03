/**
 * The style board — step one of a course, and the only place style is
 * ever decided.
 *
 * Three ways in (pick a preset card, ask for a recommendation, describe
 * your own), one way out: a SAMPLE the director shoots in that style —
 * a style-anchor still plus a 5-second clip with a hook line about the
 * topic — which the learner confirms right here. What leaves the board
 * is a settled style and that sample; the stage never re-opens it.
 *
 * State lives in course.json (`style.status`: pending → sampling →
 * sampled → confirmed) and is written by the agent's scripts; the board
 * only reads it and reports the learner's moves through `onEvent`.
 * Chinese display strings are fixed label maps (viewer copy is the
 * sanctioned home for user-facing Chinese).
 */

import { useEffect, useState } from "react";
import type { CourseStyle } from "../domain.js";
import { STYLE_CARDS } from "./styleCatalog.js";
import { Check, CinemaCaption, CinemaCard, CinemaScreen, CinemaShell, Spinner } from "./cinema.js";

export type StyleBoardEvent =
  | { type: "candidate"; id: string; name: string }
  | { type: "recommend" }
  | { type: "custom"; description: string }
  | { type: "adjust"; feedback: string }
  | { type: "confirm"; id: string; name: string };

export interface StyleBoardProps {
  /** Course topic, once the agent has created the course. */
  topic?: string;
  /** null until a course.json exists. */
  style: CourseStyle | null;
  /** Content-set prefix — sample assets are served from /content/. */
  prefix: string;
  onEvent: (event: StyleBoardEvent) => void;
}

const COPY = {
  step: "第一步 · 定风格",
  titleWithTopic: (t: string) => `为「${t}」定一个视觉风格`,
  titleNoTopic: "先定一个视觉风格",
  leadWithTopic: "选一种风格,导演会用你的主题拍一条 5 秒样片给你确认。",
  leadNoTopic: "在对话里告诉导演你想学什么;风格可以现在就选,导演会拍一条样片给你确认。",
  recommend: "为我推荐",
  recommendDesc: "导演按内容挑一种,直接拍样片给你看",
  recommendBusy: "导演正在挑风格、拍样片…",
  custom: "我要自定义",
  customDesc: "口述你想要的样子;参考图可以在对话里发给导演",
  customPlaceholder: "比如:像宫崎骏电影那样的手绘感,黄昏色调,旁白温柔一点",
  customSend: "发给导演拍样片",
  customBusy: "导演正在按你的描述调风格、拍样片…",
  cancel: "取消",
  picked: "已选",
  shoot: "拍一条样片看看",
  shootBusy: "样片拍摄中…",
  sampleTitle: "样片确认",
  sampling: "导演正在拍样片…",
  samplingHint: "先出锚图,再出 5 秒片,约一分钟。",
  sampleFailed: "样片没拍成:",
  sampleFailedHint: "再选一次就会重拍,或者换一种风格。",
  hookLabel: "样片口播",
  playWithSound: "有声播放",
  confirm: "就用这个风格,开始课程",
  adjust: "再调整",
  adjustPlaceholder: "想改什么?比如:颜色再暖一点,镜头别晃",
  adjustSend: "发送",
  another: "换一种",
  backToGrid: "返回全部风格",
  customName: "自定义风格",
} as const;

export default function StyleBoard({ topic, style, prefix, onEvent }: StyleBoardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [adjustText, setAdjustText] = useState("");
  // The learner pressed "换一种" while a sample exists: show the grid until
  // the file says otherwise (a new candidate changes id or status).
  const [browsing, setBrowsing] = useState(false);
  // What we asked the director for and are waiting on. Cleared the
  // moment course.json reflects it.
  const [waiting, setWaiting] = useState<"recommend" | "custom" | "candidate" | "adjust" | null>(null);

  const status = style?.status ?? "pending";
  // A sample that failed resets the style to pending with the reason on
  // `sample.error`; that answers the wait as much as a landed sample does.
  const sampleError = style?.sample?.error;
  useEffect(() => {
    setBrowsing(false);
    setAdjusting(false);
    setAdjustText("");
    if (status === "sampling" || status === "sampled" || sampleError) setWaiting(null);
  }, [style?.id, status, style?.sample?.video, sampleError]);

  const card = STYLE_CARDS.find((c) => c.id === style?.id);
  const styleName = style?.name || card?.name || (style?.id === "custom" ? COPY.customName : style?.id || "");
  const asset = (file?: string) => (file ? `/content/${prefix ? `${prefix}/` : ""}${file}` : null);
  const sampleImage = asset(style?.sample?.image);
  const sampleVideo = asset(style?.sample?.video);
  const sampleView = !!style && !browsing && (status === "sampling" || status === "sampled");

  const send = (event: StyleBoardEvent, wait: typeof waiting) => {
    setWaiting(wait);
    onEvent(event);
  };

  // ── Sample confirmation ─────────────────────────────────────────────
  // The cinema frame: the sample on the big screen, its spoken line as
  // the caption, and one card with the decision — name and reason on the
  // left, the three moves on the right.
  if (sampleView && style) {
    const ready = status === "sampled" && !!style.sample?.video;
    const sendAdjust = () => {
      if (!adjustText.trim()) return;
      send({ type: "adjust", feedback: adjustText.trim() }, "adjust");
      setAdjusting(false);
      setAdjustText("");
    };
    return (
      <CinemaShell step={COPY.step}>
        <CinemaScreen
          video={sampleVideo}
          poster={sampleImage ?? card?.thumb ?? null}
          dim={!sampleImage}
          alt={styleName}
        >
          {status === "sampling" && (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-4 py-3 text-sm text-white">
              <Spinner />
              <span>{COPY.sampling}</span>
              <span className="text-xs text-white/60">{COPY.samplingHint}</span>
            </div>
          )}
        </CinemaScreen>
        <CinemaCaption>
          {style.sample?.error ? (
            <span className="text-cc-error">
              {COPY.sampleFailed} {style.sample.error}
            </span>
          ) : style.sample?.hook ? (
            <>
              <span className="text-cc-muted/70">{COPY.hookLabel}</span>「{style.sample.hook}」
            </>
          ) : null}
        </CinemaCaption>
        <CinemaCard>
          <div className="flex items-center gap-6">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-[0.2em] text-cc-muted">{COPY.sampleTitle}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-semibold">{styleName}</span>
                {card && <span className="text-sm text-cc-muted/70">{card.nameEn}</span>}
              </div>
              <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-cc-fg/80">
                {style.rationale ?? style.recipe ?? card?.pitch}
              </p>
              {style.rationale && style.recipe && (
                <p className="mt-0.5 truncate text-xs text-cc-muted">{style.recipe}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                disabled={!ready || waiting === "adjust"}
                onClick={() => setAdjusting((v) => !v)}
                className={`rounded-full border px-4 py-2 text-sm transition-colors disabled:opacity-40 ${
                  adjusting ? "border-cc-primary/50 bg-cc-primary/10 text-cc-primary" : "border-cc-border text-cc-fg/80 hover:border-cc-primary/40 hover:text-cc-primary"
                }`}
              >
                {waiting === "adjust" ? COPY.shootBusy : COPY.adjust}
              </button>
              <button
                onClick={() => {
                  setBrowsing(true);
                  setSelected(null);
                }}
                className="rounded-full border border-cc-border px-4 py-2 text-sm text-cc-fg/80 transition-colors hover:border-cc-primary/40 hover:text-cc-primary"
              >
                {COPY.another}
              </button>
              <button
                disabled={!ready}
                onClick={() => onEvent({ type: "confirm", id: style.id, name: styleName })}
                className="rounded-full bg-cc-primary px-5 py-2 text-sm font-medium text-white shadow-lg shadow-cc-glow transition-opacity disabled:opacity-40"
              >
                {COPY.confirm}
              </button>
            </div>
          </div>
          {adjusting && (
            <div className="mt-3 flex items-center gap-2 border-t border-cc-border pt-3">
              <input
                autoFocus
                value={adjustText}
                onChange={(e) => setAdjustText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendAdjust();
                  if (e.key === "Escape") setAdjusting(false);
                }}
                placeholder={COPY.adjustPlaceholder}
                className="min-w-0 flex-1 appearance-none rounded-full border border-cc-primary/50 bg-cc-input-bg px-4 py-1.5 text-sm text-cc-fg placeholder:text-cc-muted/70 focus-visible:ring-2 focus-visible:ring-cc-primary/40"
              />
              <button
                disabled={!adjustText.trim()}
                onClick={sendAdjust}
                className="shrink-0 rounded-full bg-cc-primary px-4 py-1.5 text-sm text-white transition-opacity disabled:opacity-40"
              >
                {COPY.adjustSend}
              </button>
            </div>
          )}
        </CinemaCard>
      </CinemaShell>
    );
  }

  // ── Catalog + the two other doors ───────────────────────────────────
  const selectedCard = STYLE_CARDS.find((c) => c.id === selected) ?? null;
  // A course title is a line; a topic can be the whole brief the learner
  // pasted. The header wants the line.
  const shortTopic = topic && topic.length > 40 ? `${topic.slice(0, 40)}…` : topic;
  return (
    <div className="relative h-full w-full overflow-y-auto bg-cc-bg text-cc-fg">
      <div className="mx-auto max-w-6xl px-8 pb-28 pt-10">
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-[0.2em] text-cc-muted">{COPY.step}</div>
          <div className="mt-2 text-xl font-semibold">{shortTopic ? COPY.titleWithTopic(shortTopic) : COPY.titleNoTopic}</div>
          <div className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-cc-muted">
            {topic ? COPY.leadWithTopic : COPY.leadNoTopic}
          </div>
          {sampleError && (
            <div
              data-style-sample-error
              className="mx-auto mt-4 max-w-xl rounded-lg border border-cc-error/40 bg-cc-error/10 px-4 py-2 text-left text-sm leading-relaxed"
            >
              <span className="text-cc-error">
                {COPY.sampleFailed} {sampleError}
              </span>
              <span className="ml-2 text-cc-muted">{COPY.sampleFailedHint}</span>
            </div>
          )}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            disabled={waiting === "recommend"}
            onClick={() => {
              setSelected(null);
              setCustomOpen(false);
              send({ type: "recommend" }, "recommend");
            }}
            className="group flex items-start gap-4 rounded-xl border border-cc-border bg-cc-card p-5 text-left transition-all hover:border-cc-primary/50 disabled:cursor-default disabled:hover:border-cc-border"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cc-primary/10 text-cc-primary">
              {waiting === "recommend" ? (
                <Spinner />
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
                  <path d="M19 17v4M17 19h4M5 3v3M3.5 4.5h3" />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-base font-medium">{COPY.recommend}</div>
              <div className="mt-1 text-sm text-cc-muted">{waiting === "recommend" ? COPY.recommendBusy : COPY.recommendDesc}</div>
            </div>
          </button>

          <button
            onClick={() => {
              setSelected(null);
              setCustomOpen((v) => !v);
            }}
            className={`group flex items-start gap-4 rounded-xl border p-5 text-left transition-all ${
              customOpen ? "border-cc-primary/60 bg-cc-primary/5" : "border-cc-border bg-cc-card hover:border-cc-primary/50"
            }`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cc-primary/10 text-cc-primary">
              {waiting === "custom" ? (
                <Spinner />
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19l7-7 3 3-7 7-3-3z" />
                  <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                  <path d="M2 2l7.586 7.586" />
                  <circle cx="11" cy="11" r="2" />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-base font-medium">{COPY.custom}</div>
              <div className="mt-1 text-sm text-cc-muted">{waiting === "custom" ? COPY.customBusy : COPY.customDesc}</div>
            </div>
          </button>
        </div>

        {customOpen && (
          <div className="mt-4 rounded-xl border border-cc-primary/40 bg-cc-card p-4">
            <textarea
              autoFocus
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              rows={3}
              placeholder={COPY.customPlaceholder}
              className="w-full resize-none appearance-none rounded-lg border border-cc-border bg-cc-input-bg px-3 py-2 text-sm leading-relaxed text-cc-fg placeholder:text-cc-muted/70 focus-visible:ring-2 focus-visible:ring-cc-primary/40"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setCustomOpen(false);
                  setCustomText("");
                }}
                className="rounded-full border border-cc-border px-4 py-1.5 text-sm text-cc-muted transition-colors hover:text-cc-fg"
              >
                {COPY.cancel}
              </button>
              <button
                disabled={!customText.trim()}
                onClick={() => {
                  send({ type: "custom", description: customText.trim() }, "custom");
                  setCustomOpen(false);
                }}
                className="rounded-full bg-cc-primary px-4 py-1.5 text-sm text-white transition-opacity disabled:opacity-40"
              >
                {COPY.customSend}
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {STYLE_CARDS.map((s) => {
            const active = selected === s.id;
            return (
              <button
                key={s.id}
                onClick={() => {
                  setCustomOpen(false);
                  setSelected(active ? null : s.id);
                }}
                className={`group overflow-hidden rounded-xl border text-left transition-all ${
                  active
                    ? "border-cc-primary/70 bg-cc-primary/5 shadow-lg shadow-cc-glow"
                    : "border-cc-border bg-cc-card hover:border-cc-muted/40"
                }`}
              >
                <div className="relative aspect-video w-full overflow-hidden">
                  <img
                    src={s.thumb}
                    alt={s.nameEn}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  {active && (
                    <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-cc-primary text-white shadow">
                      <Check />
                    </div>
                  )}
                </div>
                <div className="px-3 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className={`shrink-0 whitespace-nowrap text-sm font-medium ${active ? "text-cc-primary" : "text-cc-fg"}`}>
                      {s.name}
                    </span>
                    <span className="truncate text-[11px] text-cc-muted/70">{s.nameEn}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-cc-muted">{s.pitch}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedCard && (
        <div className="sticky bottom-0 left-0 right-0 z-10 border-t border-cc-border bg-cc-surface/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-8 py-3">
            <img src={selectedCard.thumb} alt="" className="h-12 w-20 shrink-0 rounded-md object-cover" />
            <div className="min-w-0 flex-1">
              <div className="text-sm">
                <span className="text-cc-muted">{COPY.picked} </span>
                <span className="font-medium text-cc-fg">{selectedCard.name}</span>
                <span className="ml-2 text-xs text-cc-muted/70">{selectedCard.nameEn}</span>
              </div>
              <div className="truncate text-xs text-cc-muted">{selectedCard.pitch}</div>
            </div>
            <button
              disabled={waiting === "candidate"}
              onClick={() => send({ type: "candidate", id: selectedCard.id, name: selectedCard.name }, "candidate")}
              className="flex shrink-0 items-center gap-2 rounded-full bg-cc-primary px-5 py-2 text-sm font-medium text-white shadow-lg shadow-cc-glow transition-opacity disabled:opacity-60"
            >
              {waiting === "candidate" && <Spinner />}
              {waiting === "candidate" ? COPY.shootBusy : COPY.shoot}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
