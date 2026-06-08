/**
 * TidyPreview — Project Tidy Mode's live progress report.
 *
 * The agent sweeps the project's sessions and rewrites each placeholder
 * title; as it goes it rewrites `tidy/report.json` under the session
 * dir. This viewer polls that file (~1s) and renders a calm progress
 * list: one row per session, showing the old title crossed out beside
 * the freshly-written title + summary, plus a per-row status.
 *
 * There is no apply control — refines are already applied on disk by the
 * time they show as `done`. The viewer is purely an observation surface.
 */

import { useState, useEffect, useRef } from "react";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";

function getApiBase(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("apiBase");
  if (explicit) return explicit.replace(/\/$/, "");
  return "";
}

// ── Report shape (mirrors what SKILL.md asks the agent to write) ───────────

type TidyStatus = "pending" | "running" | "done" | "skipped";

interface TidyMeta {
  displayName?: string | null;
  description?: string | null;
}

interface TidySessionEntry {
  sessionId: string;
  mode: string;
  status: TidyStatus;
  before?: TidyMeta;
  after?: TidyMeta;
  skipReason?: string | null;
}

interface TidyReport {
  schemaVersion?: number;
  total?: number;
  sessions: TidySessionEntry[];
}

// ── Polling helper (mirrors OnboardPreview.useProposal) ────────────────────

function useReport(): { report: TidyReport | null; lastError: string | null } {
  const [report, setReport] = useState<TidyReport | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const apiBase = getApiBase();
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const tick = async () => {
      try {
        const res = await fetch(`${apiBase}/api/files/read?path=tidy%2Freport.json`);
        if (!res.ok) return; // 404 = agent hasn't written yet — keep polling
        const body = (await res.json()) as { content?: string };
        if (!body.content) return;
        const parsed = JSON.parse(body.content) as TidyReport;
        if (!cancelled.current && parsed && Array.isArray(parsed.sessions)) {
          setReport(parsed);
          setLastError(null);
        }
      } catch (err) {
        if (!cancelled.current) {
          setLastError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void tick();
    const interval = setInterval(tick, 1000);
    return () => {
      cancelled.current = true;
      clearInterval(interval);
    };
  }, [apiBase]);

  return { report, lastError };
}

// ── Bits ───────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: TidyStatus }) {
  if (status === "running") {
    return (
      <span className="w-2.5 h-2.5 shrink-0 rounded-full border-[1.5px] border-cc-primary/30 border-t-cc-primary animate-spin" />
    );
  }
  if (status === "done") {
    return (
      <span className="w-2.5 h-2.5 shrink-0 rounded-full bg-cc-primary shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
    );
  }
  if (status === "skipped") {
    return <span className="w-2.5 h-2.5 shrink-0 rounded-full bg-cc-muted/30" />;
  }
  return <span className="w-2.5 h-2.5 shrink-0 rounded-full border border-cc-muted/30" />;
}

function fallbackTitle(mode: string): string {
  const pretty = mode.charAt(0).toUpperCase() + mode.slice(1);
  return `${pretty} session`;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function TidyPreview(_props: ViewerPreviewProps) {
  const { report } = useReport();

  const sessions = report?.sessions ?? [];
  const done = sessions.filter((s) => s.status === "done").length;
  const skipped = sessions.filter((s) => s.status === "skipped").length;
  // `total` is the actionable set (sessions that need a refine) — skipped
  // rows are shown for transparency but don't count toward the bar. The
  // agent reports it; fall back to the non-skipped row count.
  const total = report?.total ?? sessions.filter((s) => s.status !== "skipped").length;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;
  const allDone = done >= total;

  return (
    <div className="w-full h-full overflow-y-auto bg-cc-bg text-cc-fg">
      <div className="max-w-[760px] mx-auto px-8 py-10">
        {/* Header */}
        <header className="flex items-start gap-4 mb-8">
          <div className="w-12 h-12 shrink-0 rounded-xl bg-cc-primary/10 text-cc-primary flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden>
              <path d="M3 6h18" />
              <path d="M3 12h12" />
              <path d="M3 18h6" />
              <path d="m17 14 1.5 3.5L22 19l-3.5 1.5L17 24l-1.5-3.5L12 19l3.5-1.5z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-2xl leading-tight">整理会话</h1>
            <p className="text-sm text-cc-muted/70 mt-1 leading-relaxed">
              扫一遍项目里还是默认标题的会话，给每一行补全标题与摘要。
            </p>
          </div>
        </header>

        {/* Summary / progress */}
        {report ? (
          <div className="mb-8">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm text-cc-fg">
                {allDone ? (
                  <span className="text-cc-primary">整理完成</span>
                ) : (
                  <span>整理中…</span>
                )}
              </span>
              <span className="text-xs text-cc-muted/60 tabular-nums">
                {done} / {total}
                {skipped > 0 ? <span className="text-cc-muted/40">（{skipped} 项跳过）</span> : null}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-cc-muted/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-cc-primary transition-[width] duration-500 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm text-cc-muted/60 mb-8">
            <span className="w-3.5 h-3.5 rounded-full border-[1.5px] border-cc-primary/30 border-t-cc-primary animate-spin" />
            正在扫描项目会话…
          </div>
        )}

        {/* Session rows */}
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => {
            const beforeTitle = s.before?.displayName?.trim() || fallbackTitle(s.mode);
            const afterTitle = s.after?.displayName?.trim();
            const afterDesc = s.after?.description?.trim();
            const isSkipped = s.status === "skipped";
            return (
              <li
                key={s.sessionId}
                className={`rounded-lg border px-4 py-3 transition-colors ${
                  s.status === "done"
                    ? "border-cc-primary/20 bg-cc-primary/[0.04]"
                    : s.status === "running"
                      ? "border-cc-primary/30 bg-cc-primary/[0.06]"
                      : "border-cc-border/50 bg-cc-surface/40"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-1.5">
                    <StatusDot status={s.status} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {afterTitle && !isSkipped ? (
                        <>
                          <span className="text-sm text-cc-fg font-medium">{afterTitle}</span>
                          <span className="text-xs text-cc-muted/40 line-through truncate max-w-[200px]">
                            {beforeTitle}
                          </span>
                        </>
                      ) : (
                        <span className={`text-sm ${isSkipped ? "text-cc-muted/50" : "text-cc-fg/70"}`}>
                          {beforeTitle}
                        </span>
                      )}
                      <span className="text-[10px] uppercase tracking-wider text-cc-muted/40 px-1.5 py-0.5 rounded bg-cc-muted/10">
                        {s.mode}
                      </span>
                    </div>
                    {afterDesc && !isSkipped ? (
                      <p className="text-xs text-cc-muted/70 mt-1 leading-snug line-clamp-2">
                        {afterDesc}
                      </p>
                    ) : null}
                    {isSkipped && s.skipReason ? (
                      <p className="text-xs text-cc-muted/40 mt-1 leading-snug">{s.skipReason}</p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {report && sessions.length === 0 ? (
          <div className="text-center py-12 text-sm text-cc-muted/50">
            没有需要整理的会话 —— 所有会话都已有清晰的标题。
          </div>
        ) : null}
      </div>
    </div>
  );
}
