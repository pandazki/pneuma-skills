/**
 * OnboardPreview — Project Onboard Mode's Discovery Report viewer.
 *
 * Renders the agent's `proposal.json` as a layered discovery report:
 *   - Hero band: cover + auto-detected name + one-line description
 *   - Anchors: what the discovery surfaced, with citations
 *   - Open questions: ambiguities the agent flagged for the user
 *   - API key hint: optional soft prompt for unlocking better tasks
 *   - Two task cards: the next-step recommendations
 *   - Apply controls: "apply only" or "apply + start chosen task"
 *
 * The agent writes proposal.json into `$PNEUMA_SESSION_DIR/onboard/`;
 * the viewer polls for it (~1s cadence) until it appears, then renders.
 * Apply + handoff actions are the next-phase backend wiring; for now
 * they call the planned endpoints and surface failures non-fatally so
 * the agent can continue evolving the proposal even if the apply
 * pipeline isn't fully landed yet.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { useStore } from "../../../src/store.js";

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

// ── Proposal shape (mirrors what the SKILL.md asks the agent to write) ─────

interface ProposalProject {
  displayName: string;
  description: string;
  coverSource: string | null;
}

interface ProposalAnchor {
  label: string;
  value: string;
  source: string;
}

interface HandoffPayload {
  intent: string;
  summary?: string;
  suggested_files?: string[];
  key_decisions?: string[];
  open_questions?: string[];
}

interface ProposalTask {
  title: string;
  targetMode: string;
  timeEstimate?: string;
  rationale: string;
  handoffPayload: HandoffPayload;
}

interface ApiKeyHints {
  missingButRecommended: string[];
  rationale: string;
}

interface OnboardProposal {
  schemaVersion: number;
  project: ProposalProject;
  atlas: string;
  anchors: ProposalAnchor[];
  openQuestions?: string[];
  tasks: ProposalTask[];
  apiKeyHints?: ApiKeyHints;
}

// ── Polling helper ────────────────────────────────────────────────────────

function useProposal(): { proposal: OnboardProposal | null; lastError: string | null } {
  const [proposal, setProposal] = useState<OnboardProposal | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const apiBase = getApiBase();
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const tick = async () => {
      try {
        const res = await fetch(`${apiBase}/api/files/read?path=onboard%2Fproposal.json`);
        if (!res.ok) {
          // 404 is the expected "agent hasn't written yet" state — keep polling.
          return;
        }
        const body = (await res.json()) as { content?: string };
        if (!body.content) return;
        const parsed = JSON.parse(body.content) as OnboardProposal;
        if (!cancelled.current) {
          setProposal(parsed);
          setLastError(null);
        }
      } catch (err) {
        if (!cancelled.current) {
          setLastError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void tick();
    const interval = setInterval(tick, 1500);
    return () => {
      cancelled.current = true;
      clearInterval(interval);
    };
  }, [apiBase]);

  return { proposal, lastError };
}

// ── Sub-components ────────────────────────────────────────────────────────

function CoverPreview({ source }: { source: string | null }) {
  // The proposal stores an absolute path; for the in-viewer preview we
  // serve it through the workspace static handler. If the path is not
  // under the served root the request 404s and we fall back to the
  // dotted-letter placeholder, which matches what the launcher itself
  // shows when no cover is set.
  const apiBase = getApiBase();
  const [errored, setErrored] = useState(false);

  if (!source || errored) {
    return (
      <div className="w-32 h-32 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 flex items-center justify-center">
        <span className="text-3xl font-light text-zinc-600 select-none">·</span>
      </div>
    );
  }
  // Best-effort static serve — the per-session server exposes /content for
  // the workspace; out-of-tree absolute paths simply 404 (handled by onError).
  const url = `${apiBase}/content${source}`;
  return (
    <img
      src={url}
      alt="Project cover preview"
      className="w-32 h-32 rounded-2xl object-cover border border-zinc-800/80 bg-zinc-900/60"
      onError={() => setErrored(true)}
    />
  );
}

function AnchorCard({ anchor }: { anchor: ProposalAnchor }) {
  return (
    <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-4">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">{anchor.label}</div>
      <div className="text-sm text-zinc-200 leading-relaxed">{anchor.value}</div>
      <div className="text-[11px] text-zinc-600 mt-2 font-mono truncate">{anchor.source}</div>
    </div>
  );
}

function OpenQuestion({ q }: { q: string }) {
  return (
    <div className="flex items-start gap-2 text-sm text-zinc-300 leading-relaxed">
      <span className="text-orange-400 shrink-0 mt-0.5" aria-hidden>?</span>
      <span>{q}</span>
    </div>
  );
}

function ApiKeyHint({ hints, onSkip }: { hints: ApiKeyHints; onSkip: () => void }) {
  return (
    <div className="rounded-xl border border-orange-500/20 bg-orange-500/[0.04] p-4 flex items-start gap-3">
      <div className="text-orange-400 mt-0.5" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <path d="M9.663 17h4.673M12 3v1M5.05 5.05l.707.707M2 13h1M21 13h-1M18.95 5.05l-.707.707M12 7a5 5 0 015 5c0 1.5-.5 2.5-1.5 3.5L14 17h-4l-1.5-1.5C7.5 14.5 7 13.5 7 12a5 5 0 015-5z"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-200">{hints.rationale}</div>
        <div className="text-xs text-zinc-500 mt-1.5">
          Missing: <span className="font-mono text-zinc-400">{hints.missingButRecommended.join(", ")}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onSkip}
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 -my-1"
      >
        Skip
      </button>
    </div>
  );
}

function TaskCard({
  task,
  onStart,
  disabled,
}: {
  task: ProposalTask;
  onStart: (task: ProposalTask) => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/30 p-6 flex flex-col gap-4 transition-colors hover:border-orange-500/30 hover:bg-zinc-950/50">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-2">
          <span>{task.targetMode}</span>
          {task.timeEstimate ? (
            <>
              <span className="text-zinc-700">·</span>
              <span>{task.timeEstimate}</span>
            </>
          ) : null}
        </div>
        <h3 className="text-lg font-medium text-zinc-100 leading-snug">{task.title}</h3>
      </div>
      <p className="text-sm text-zinc-400 leading-relaxed flex-1">{task.rationale}</p>
      <button
        type="button"
        onClick={() => onStart(task)}
        disabled={disabled}
        className="self-start text-sm text-orange-400 hover:text-orange-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
      >
        <span>Start this task</span>
        <span aria-hidden>→</span>
      </button>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────

export default function OnboardPreview(_props: ViewerPreviewProps) {
  const { proposal, lastError } = useProposal();
  const apiBase = getApiBase();
  const projectRoot = useStore((s) => s.projectContext?.projectRoot ?? null);
  const sourceSessionId = useStore((s) => s.session?.session_id ?? null);
  const [keyHintDismissed, setKeyHintDismissed] = useState(false);
  const [applying, setApplying] = useState<string | null>(null); // "apply-only" | task title
  const [applyError, setApplyError] = useState<string | null>(null);

  const onApply = useCallback(
    async (task: ProposalTask | null) => {
      if (!proposal) return;
      if (!projectRoot) {
        setApplyError("Project root unavailable — cannot apply outside a project session.");
        return;
      }
      const label = task ? task.title : "apply-only";
      setApplying(label);
      setApplyError(null);
      try {
        const res = await fetch(`${apiBase}/api/projects/onboard/apply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectRoot,
            proposal,
            chosenTask: task ? task.title : null,
            sourceSessionId: sourceSessionId ?? undefined,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setApplyError(data.error ?? `Apply failed (${res.status})`);
          return;
        }
        const data = (await res.json()) as {
          applied: boolean;
          launchUrl?: string | null;
          warning?: string;
        };
        if (data.warning) {
          // Apply landed but the launch failed — show the warning so
          // the user knows the discovery write succeeded and they can
          // pick another task.
          setApplyError(data.warning);
          return;
        }
        if (data.launchUrl) {
          window.location.href = data.launchUrl;
          return;
        }
        // Apply-only — reload to land back in EmptyShell, which now
        // sees `onboardedAt` set and won't re-trigger onboarding.
        // The user gets the panel ready for their next move.
        if (projectRoot) {
          window.location.href = `/?project=${encodeURIComponent(projectRoot)}`;
        }
      } catch (err) {
        setApplyError(err instanceof Error ? err.message : String(err));
      } finally {
        setApplying(null);
      }
    },
    [apiBase, proposal, projectRoot, sourceSessionId],
  );

  if (!proposal) {
    return (
      <div className="h-full overflow-auto bg-zinc-950 text-zinc-200">
        <div className="max-w-3xl mx-auto px-8 py-24 flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-zinc-800 border-t-orange-500 animate-spin" />
          <div className="text-zinc-400 text-sm">Reading your project…</div>
          <div className="text-zinc-600 text-xs leading-relaxed text-center max-w-md">
            The onboarding agent is mining your README, package manifest, and existing visual assets to assemble a discovery report.
          </div>
          {lastError ? (
            <div className="text-xs text-red-400/70 mt-4 font-mono">{lastError}</div>
          ) : null}
        </div>
      </div>
    );
  }

  const showKeyHint =
    proposal.apiKeyHints &&
    proposal.apiKeyHints.missingButRecommended.length > 0 &&
    !keyHintDismissed;

  return (
    <div className="h-full overflow-auto bg-zinc-950 text-zinc-200">
      <div className="max-w-4xl mx-auto px-8 py-12 flex flex-col gap-10">

        {/* Hero band */}
        <section className="flex items-center gap-6">
          <CoverPreview source={proposal.project.coverSource} />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">Project</div>
            <h1 className="text-3xl font-medium text-zinc-100 leading-tight mb-2">
              {proposal.project.displayName}
            </h1>
            <p className="text-base text-zinc-400 leading-relaxed">
              {proposal.project.description}
            </p>
          </div>
        </section>

        {/* Anchors */}
        {proposal.anchors.length > 0 ? (
          <section>
            <h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-4">What we found</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {proposal.anchors.map((a, i) => (
                <AnchorCard key={i} anchor={a} />
              ))}
            </div>
          </section>
        ) : null}

        {/* Open questions */}
        {proposal.openQuestions && proposal.openQuestions.length > 0 ? (
          <section className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-4 flex flex-col gap-2">
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Open questions</div>
            {proposal.openQuestions.map((q, i) => (
              <OpenQuestion key={i} q={q} />
            ))}
          </section>
        ) : null}

        {/* API key hint */}
        {showKeyHint ? (
          <ApiKeyHint
            hints={proposal.apiKeyHints!}
            onSkip={() => setKeyHintDismissed(true)}
          />
        ) : null}

        {/* Two task cards */}
        <section>
          <h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-4">What's next</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {proposal.tasks.map((t, i) => (
              <TaskCard
                key={i}
                task={t}
                onStart={(task) => void onApply(task)}
                disabled={applying !== null}
              />
            ))}
          </div>
        </section>

        {/* Footer controls */}
        <footer className="flex flex-col gap-3 pt-6 border-t border-zinc-900/80">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => void onApply(null)}
              disabled={applying !== null}
              className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Apply only — don't start a task yet
            </button>
            <div className="text-xs text-zinc-600 text-right">
              {applying ? (
                <span>Applying {applying === "apply-only" ? "metadata" : `"${applying}"`}…</span>
              ) : (
                <span>Review the report, then pick a path.</span>
              )}
            </div>
          </div>
          {applyError ? (
            <div className="text-xs text-red-400/80" role="alert">
              {applyError}
            </div>
          ) : null}
        </footer>

      </div>
    </div>
  );
}
