/**
 * Sprite viewer — STUB.
 *
 * The real motion stage (refs rail, motion list, frame player, GIF / video /
 * atlas panels, the four actions) is a later task. This stub exists so the
 * mode boots end to end: it subscribes to the same `roster` source the real
 * viewer will, resolves the active character the same way, and renders enough
 * for a human to see that the pipeline is landing files. It deliberately
 * implements NO action — a viewer that answered `play` with a shrug would be
 * worse than one the runtime can see has nothing wired.
 */

import { useMemo } from "react";

import type { Source } from "../../../core/types/source.js";
import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { useSource } from "../../../src/hooks/useSource.js";
import { useStore } from "../../../src/store.js";
import type { CharacterProject, Motion, Roster } from "../domain.js";

const STATUS_TONE: Record<Motion["status"], string> = {
  planned: "text-[var(--cc-text-muted,#a1a1aa)] border-white/15",
  generating: "text-[#f97316] border-[#f97316]/40",
  processing: "text-[#f97316] border-[#f97316]/40",
  ready: "text-[#4ade80] border-[#4ade80]/40",
  failed: "text-[#f87171] border-[#f87171]/40",
};

/**
 * Which character the stage shows. `activeContentSet` is the framework's
 * answer when the workspace has switchable sets; a workspace with a single
 * character never surfaces one, so fall back to the first key rather than
 * rendering the empty state over a character that is right there.
 */
export function selectActiveCharacter(
  roster: Roster | null,
  activeContentSet: string | null | undefined,
): CharacterProject | null {
  if (!roster) return null;
  if (activeContentSet != null && roster.byContentSet[activeContentSet]) {
    return roster.byContentSet[activeContentSet];
  }
  const first = Object.keys(roster.byContentSet).sort()[0];
  return first === undefined ? null : roster.byContentSet[first];
}

export default function SpritePreview(props: ViewerPreviewProps) {
  const rosterSource = props.sources.roster as Source<Roster> | undefined;
  const { value: roster } = useSource(rosterSource);
  const activeContentSet = useStore((s) => s.activeContentSet);

  const character = useMemo(
    () => selectActiveCharacter(roster, activeContentSet),
    [roster, activeContentSet],
  );

  if (!character) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#09090b] p-8 text-center">
        <p className="max-w-md text-sm text-[var(--cc-text-muted,#a1a1aa)]">
          Sprite mode initialized — ask the agent to design a character
        </p>
      </div>
    );
  }

  const { character: identity, refs, motions } = character.sprite;

  return (
    <div className="h-full w-full overflow-auto bg-[#09090b] p-8 text-[var(--cc-text,#e4e4e7)]">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{identity.name}</h1>
        {identity.description ? (
          <p className="mt-1 max-w-2xl text-sm text-[var(--cc-text-muted,#a1a1aa)]">
            {identity.description}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-[var(--cc-text-muted,#a1a1aa)]">
          {identity.cell.width}×{identity.cell.height} cell · {refs.length}{" "}
          reference{refs.length === 1 ? "" : "s"} · {motions.length} motion
          {motions.length === 1 ? "" : "s"}
        </p>
      </header>

      <ul className="flex max-w-2xl flex-col gap-2">
        {motions.map((motion) => (
          <li
            key={motion.id}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 backdrop-blur"
          >
            <span className="flex flex-col">
              <span className="text-sm">{motion.label}</span>
              <span className="text-xs text-[var(--cc-text-muted,#a1a1aa)]">
                {motion.grid.cols}×{motion.grid.rows} · {motion.fps} fps ·{" "}
                {motion.loop ? "loop" : "once"} · {motion.frames.length} frame
                {motion.frames.length === 1 ? "" : "s"}
              </span>
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${STATUS_TONE[motion.status]}`}
            >
              {motion.status}
            </span>
          </li>
        ))}
      </ul>

      {motions.length === 0 ? (
        <p className="max-w-2xl text-sm text-[var(--cc-text-muted,#a1a1aa)]">
          No motions yet — ask the agent for one (idle, walk, attack…).
        </p>
      ) : null}
    </div>
  );
}
