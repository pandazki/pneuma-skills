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

// Pre-onboard introduction carousel — replaces the generic loading
// spinner that used to fill this slot. While the discovery agent reads
// the project (~30–60s), we walk a first-time user through what Pneuma
// is, one panel every 5s. Image captions are baked into the PNGs;
// `alt` text mirrors them for screen readers and bundle hash stability.
import img01 from "./illustrations/01-files-canvas.png";
import img02 from "./illustrations/02-live-players.png";
import img03 from "./illustrations/03-twelve-modes.png";
import img04 from "./illustrations/04-auto-discovery.png";
import img05 from "./illustrations/05-smart-handoff.png";
import img06 from "./illustrations/06-project-layer.png";
import img07 from "./illustrations/07-click-locator.png";
import img08 from "./illustrations/08-skills-coach.png";
import img09 from "./illustrations/09-evolution.png";
import img10 from "./illustrations/10-replay.png";

const ILLUSTRATIONS: Array<{ src: string; alt: string }> = [
  { src: img01, alt: "The directory is the canvas." },
  { src: img02, alt: "Watch the work, not a spinner." },
  { src: img03, alt: "One shell, twelve players." },
  { src: img04, alt: "Reading your project — a brief takes shape." },
  { src: img05, alt: "The next mode picks up where the last one left off." },
  { src: img06, alt: "Many sessions. One shared brain." },
  { src: img07, alt: "Point in the canvas — the agent already knows." },
  { src: img08, alt: "Coaching the agent before the first message." },
  { src: img09, alt: "Pneuma learns your taste — across every session." },
  { src: img10, alt: "Every turn is a checkpoint. Rewind anything." },
];

const CAROUSEL_CYCLE_MS = 5000;

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

interface WelcomeMoment {
  /** Absolute path to the agent-generated welcome image (under sessionDir). */
  image: string;
  /** Short greeting copy the agent wrote — 1–2 sentences, friendly. */
  message: string;
}

interface OnboardProposal {
  schemaVersion: number;
  project: ProposalProject;
  atlas: string;
  anchors: ProposalAnchor[];
  openQuestions?: string[];
  tasks: ProposalTask[];
  apiKeyHints?: ApiKeyHints;
  /**
   * Branch A from the SKILL.md "Drawing for the project" section: when
   * the project is too sparse to anchor a real Discovery Report, the
   * agent draws a small welcome image + writes a short greeting. The
   * viewer renders this above the rest as a hero band.
   */
  welcome?: WelcomeMoment;
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

function WelcomeBand({ welcome, projectRoot }: { welcome: WelcomeMoment; projectRoot: string | null }) {
  // The agent saved welcome.image into <sessionDir>/onboard/. For
  // project sessions, the per-session server's /content/* serves the
  // sessionDir, so we can convert the absolute path to a relative URL
  // by stripping the sessionDir prefix. The sessionDir always ends in
  // the session id under <projectRoot>/.pneuma/sessions/, so we walk
  // back from the path to find it.
  const apiBase = getApiBase();
  const [errored, setErrored] = useState(false);

  // The welcome image lives at <sessionDir>/onboard/welcome-egg-*.png.
  // Pull just the basename + onboard/ prefix and serve via /content/.
  const onboardIdx = welcome.image.lastIndexOf("/onboard/");
  const url = onboardIdx >= 0 ? `${apiBase}/content${welcome.image.slice(onboardIdx)}` : null;

  return (
    <section className="flex flex-col items-center text-center gap-5 pb-2">
      <div className="text-[11px] uppercase tracking-[0.2em] text-orange-400/80">A small welcome</div>
      <div className="relative w-full max-w-md aspect-square rounded-3xl overflow-hidden bg-zinc-900 border border-zinc-800/60 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.6)]">
        {url && !errored ? (
          <img
            src={url}
            alt="A welcome image drawn for this project"
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setErrored(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-5xl font-light text-zinc-600 select-none">·</span>
          </div>
        )}
        {/* Subtle warm glow at the bottom edge to anchor the image to the surrounding zinc */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-orange-500/10 to-transparent pointer-events-none" />
      </div>
      <p className="text-base text-zinc-200 leading-relaxed max-w-lg italic">
        {welcome.message}
      </p>
    </section>
  );
}

function CoverPreview({ source, projectRoot }: { source: string | null; projectRoot: string | null }) {
  // The proposal stores an absolute path under the project root. We
  // serve it through the project-rooted file route (which has its own
  // manifest gate + path containment) rather than `/content/...`,
  // because the per-session `/content` resolves to the session dir, not
  // the project root.
  const apiBase = getApiBase();
  const [errored, setErrored] = useState(false);

  let url: string | null = null;
  if (source && projectRoot && source.startsWith(`${projectRoot}/`)) {
    const rel = source.slice(projectRoot.length).replace(/^\/+/, "");
    url = `${apiBase}/api/projects/${encodeURIComponent(projectRoot)}/file?path=${encodeURIComponent(rel)}`;
  }

  if (!source || !url || errored) {
    return (
      <div className="w-32 h-32 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 flex items-center justify-center">
        <span className="text-3xl font-light text-zinc-600 select-none">·</span>
      </div>
    );
  }
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
    return <CarouselLoading lastError={lastError} />;
  }

  const showKeyHint =
    proposal.apiKeyHints &&
    proposal.apiKeyHints.missingButRecommended.length > 0 &&
    !keyHintDismissed;

  return (
    <div className="h-full overflow-auto bg-zinc-950 text-zinc-200">
      <div className="max-w-4xl mx-auto px-8 py-12 flex flex-col gap-10">

        {/* Welcome band — only present when the agent decided to draw a
            meet-cute gift for a sparse project. Sits above the regular
            discovery report so the moment lands first. */}
        {proposal.welcome ? (
          <WelcomeBand welcome={proposal.welcome} projectRoot={projectRoot} />
        ) : null}

        {/* Hero band */}
        <section className="flex items-center gap-6">
          <CoverPreview source={proposal.project.coverSource} projectRoot={projectRoot} />
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

// ── Loading carousel ───────────────────────────────────────────────────────

/**
 * Carousel that auto-cycles through the 10 introductory illustrations
 * while the discovery agent works. Two stacked layers — the bottom is
 * always the *current* image, the top is the *outgoing* image whose
 * `clip-path` animates from `inset(0)` to `inset(0 0 0 100%)`, sweeping
 * left-to-right so it feels like the new image is wiping the old away
 * (rather than crossfading). The wipe layer remounts on every advance
 * via its `key`, restarting the animation cleanly even if the user
 * clicks a dot mid-transition.
 */
function CarouselLoading({ lastError }: { lastError: string | null }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState<number | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setPreviousIndex(activeIndex);
      setActiveIndex((i) => (i + 1) % ILLUSTRATIONS.length);
    }, CAROUSEL_CYCLE_MS);
    return () => clearTimeout(id);
  }, [activeIndex]);

  const goTo = (i: number) => {
    if (i === activeIndex) return;
    setPreviousIndex(activeIndex);
    setActiveIndex(i);
  };

  return (
    <>
      <style>{`
        /* Registered so CSS can interpolate it across keyframes — without
           @property a custom percentage var would just snap between
           values instead of animating smoothly. */
        @property --pneuma-wipe {
          syntax: '<percentage>';
          inherits: false;
          initial-value: 0%;
        }

        @keyframes pneuma-wipe-progress {
          from { --pneuma-wipe: -10%; }
          to   { --pneuma-wipe: 110%; }
        }

        /* The outgoing image wipes out via a soft-edged gradient mask
           rather than a hard clip-path. The mask is a diagonal
           (~12° off-vertical) gradient with a 14% transition band, so
           the boundary feels like a lit dissolve sweeping across the
           frame instead of a razor-sharp clip. */
        .pneuma-wipe-out {
          --pneuma-wipe: -10%;
          -webkit-mask-image: linear-gradient(
            102deg,
            transparent calc(var(--pneuma-wipe) - 7%),
            #000 calc(var(--pneuma-wipe) + 7%)
          );
          mask-image: linear-gradient(
            102deg,
            transparent calc(var(--pneuma-wipe) - 7%),
            #000 calc(var(--pneuma-wipe) + 7%)
          );
          animation: pneuma-wipe-progress 1100ms cubic-bezier(0.76, 0, 0.24, 1) forwards;
        }

        /* A faint warm orange luminance band rides the same gradient
           position, painted in screen-blend to add a "lit reveal"
           glow without darkening either image. Kept low-opacity (peak
           ~22%) so it reads as atmospheric warmth, not a scanner. */
        .pneuma-wipe-glow {
          --pneuma-wipe: -10%;
          background: linear-gradient(
            102deg,
            transparent calc(var(--pneuma-wipe) - 7%),
            rgba(249, 115, 22, 0.0) calc(var(--pneuma-wipe) - 4%),
            rgba(249, 115, 22, 0.16) calc(var(--pneuma-wipe) + 1%),
            rgba(249, 115, 22, 0.22) calc(var(--pneuma-wipe) + 3%),
            rgba(249, 115, 22, 0.08) calc(var(--pneuma-wipe) + 5%),
            transparent calc(var(--pneuma-wipe) + 7%)
          );
          animation: pneuma-wipe-progress 1100ms cubic-bezier(0.76, 0, 0.24, 1) forwards;
          mix-blend-mode: screen;
          pointer-events: none;
        }
      `}</style>
      <div className="h-full overflow-auto bg-zinc-950 text-zinc-200 flex items-center justify-center">
        <div className="w-full max-w-5xl px-8 py-8 flex flex-col items-center gap-6">
          {/* Carousel frame — 16:9 to match the illustrations' native ratio */}
          <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800/60 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.6)]">
            {/* Bottom layer: the current active image — always fully shown */}
            <img
              key={`active-${activeIndex}`}
              src={ILLUSTRATIONS[activeIndex].src}
              alt={ILLUSTRATIONS[activeIndex].alt}
              loading="eager"
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Wipe-out layers — only mounted during a transition. Two
                stacked elements share the same wipe-position via the
                same keyframe + custom-property: the masked image
                fades out softly while the orange glow band rides the
                leading edge to give it a lit, atmospheric feel. */}
            {previousIndex !== null && previousIndex !== activeIndex ? (
              <>
                <img
                  key={`wipe-img-${previousIndex}-${activeIndex}`}
                  src={ILLUSTRATIONS[previousIndex].src}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 w-full h-full object-cover pneuma-wipe-out"
                />
                <div
                  key={`wipe-glow-${previousIndex}-${activeIndex}`}
                  aria-hidden
                  className="absolute inset-0 pneuma-wipe-glow"
                />
              </>
            ) : null}
          </div>

          {/* Status pill — what's actually happening on the backend */}
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" aria-hidden />
            <span>Discovering your project — a brief is taking shape.</span>
          </div>

          {/* Pagination dots — clickable to jump, the active one is a wider pill */}
          <div className="flex items-center gap-1.5">
            {ILLUSTRATIONS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={`h-1 rounded-full transition-all duration-300 cursor-pointer ${
                  i === activeIndex
                    ? "w-8 bg-orange-500"
                    : "w-2 bg-zinc-700 hover:bg-zinc-500"
                }`}
              />
            ))}
          </div>

          {lastError ? (
            <div className="text-xs text-red-400/70 mt-2 font-mono">{lastError}</div>
          ) : null}
        </div>
      </div>
    </>
  );
}
