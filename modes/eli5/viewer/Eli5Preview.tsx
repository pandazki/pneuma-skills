/**
 * ELI5 Preview — audience ladder player.
 *
 * SCOPE NOTE: this is the T1 stub. It proves the wiring — manifest →
 * `explainer` source → ladder — and gives an honest empty state, nothing
 * more. The real player (page iframes, compare mode, selection, capture,
 * navigate-to / navigateRequest handling) lands in T2 and replaces this
 * file wholesale. Deliberately absent here rather than half-built, so a
 * later reader never mistakes a stub for a finished surface.
 */

import { useMemo } from "react";
import type { Source } from "../../../core/types/source.js";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useStore } from "../../../src/store.js";
import type { Explainer, ExplainerManifest } from "../domain.js";

export default function Eli5Preview({ sources }: ViewerPreviewProps) {
  const explainerSource = sources.explainer as Source<Explainer> | undefined;
  const { value: explainer } = useSource(explainerSource);
  const activeContentSet = useStore((s) => s.activeContentSet);

  // A single-topic workspace surfaces no content sets (the directory
  // resolver needs two), so `activeContentSet` is null while a topic
  // directory sits on disk. Fall back to the first manifest we have —
  // illustrate's precedent, and the reason a lone seed still renders.
  const manifest = useMemo<ExplainerManifest | null>(() => {
    if (!explainer) return null;
    const byContentSet = explainer.byContentSet;
    const key = activeContentSet ?? "";
    if (byContentSet[key]) return byContentSet[key];
    const firstKey = Object.keys(byContentSet)[0];
    return firstKey !== undefined ? byContentSet[firstKey] : null;
  }, [explainer, activeContentSet]);

  if (!manifest) return <EmptyState />;

  return (
    <div className="h-full min-h-0 overflow-auto bg-cc-bg text-cc-fg">
      <div className="mx-auto w-full max-w-2xl px-8 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">
          {manifest.title}
        </h1>
        {manifest.topic && (
          <p className="mt-1 text-sm text-cc-muted">{manifest.topic}</p>
        )}

        <ol className="mt-8 flex flex-col gap-2">
          {manifest.audiences.map((audience, i) => (
            <li
              key={`${audience.id}-${i}`}
              className="flex items-center gap-3 rounded-lg border border-cc-border bg-cc-surface/60 px-4 py-3 backdrop-blur"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-cc-primary/40 bg-cc-primary/10 text-[11px] font-medium text-cc-primary">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {audience.label}
              </span>
              <span className="shrink-0 truncate font-mono text-[11px] text-cc-muted/70">
                {audience.file || "no page yet"}
              </span>
            </li>
          ))}
          {manifest.audiences.length === 0 && (
            <li className="rounded-lg border border-dashed border-cc-border px-4 py-3 text-sm text-cc-muted">
              This topic has no audiences yet. Ask the agent who it should be
              explained to.
            </li>
          )}
        </ol>

        <p className="mt-8 border-t border-cc-border pt-4 text-xs leading-relaxed text-cc-muted/70">
          Ladder structure only — page rendering, side-by-side compare, and
          selection arrive with the full viewer.
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid h-full min-h-0 place-items-center bg-cc-bg px-8 text-center">
      <div className="max-w-sm">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mx-auto h-10 w-10 text-cc-primary/70"
          aria-hidden="true"
        >
          <path d="M21 4.5v9a1.5 1.5 0 0 1-1.5 1.5H12l-4.5 3.75V15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h15A1.5 1.5 0 0 1 21 4.5Z" />
          <path d="M12 4.5a2.75 2.75 0 0 0-1.65 4.95c.34.26.55.65.55 1.08v.22h2.2v-.22c0-.43.21-.82.55-1.08A2.75 2.75 0 0 0 12 4.5ZM10.9 12.8h2.2" />
        </svg>
        <h2 className="mt-5 text-base font-semibold tracking-tight text-cc-fg">
          Explain anything to anyone
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-cc-muted">
          Name a topic and who it needs to land with — a five-year-old, your
          manager, the engineer on call. Each audience gets its own page, and
          they stack up here as a ladder you can climb.
        </p>
      </div>
    </div>
  );
}
