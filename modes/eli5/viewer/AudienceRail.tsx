/**
 * The ladder — an ordered rail of audiences across the top of the canvas.
 *
 * Rung order is manifest order, and the badge is the number the agent and
 * the reader both count with ("audience 2/3" in the chat is this pill).
 * Four states, each visually distinct because each means something
 * different to the person reading it:
 *
 *  - `active`  — the page in the (left) pane;
 *  - `compare` — the page in the second pane while comparing;
 *  - `pending` — the manifest names it, but no page has landed yet;
 *  - `idle`    — written, not on screen.
 *
 * A pending rung stays pressable. It is unwritten, not forbidden: pressing
 * it is how a reader asks for that page — the click becomes the selection
 * the agent sees in the next message's `<viewer-context>`.
 */

import type { AudienceEntry } from "../domain.js";

export type RungState = "active" | "compare" | "pending" | "idle";

export interface AudienceRailProps {
  audiences: AudienceEntry[];
  /** Rung in the main pane. */
  activeId: string | null;
  /** Rung in the second pane while comparing, else null. */
  compareId?: string | null;
  /** Whether this rung's page exists in the current file snapshot. */
  hasPage: (audience: AudienceEntry) => boolean;
  onPick: (id: string) => void;
}

const STATE_CLASS: Record<RungState, string> = {
  active:
    "border-cc-primary/70 bg-cc-primary/15 text-cc-fg shadow-[0_0_18px_rgba(249,115,22,0.18)]",
  compare:
    "border-cc-primary/45 border-dashed bg-cc-primary/5 text-cc-fg/90",
  pending:
    "border-dashed border-cc-border bg-cc-surface/30 text-cc-muted/80 hover:text-cc-fg/80",
  idle: "border-cc-border bg-cc-surface/50 text-cc-fg/80 hover:border-cc-primary/40 hover:bg-cc-surface/80",
};

const BADGE_CLASS: Record<RungState, string> = {
  active: "border-cc-primary/60 bg-cc-primary/25 text-cc-primary",
  compare: "border-cc-primary/40 bg-cc-primary/10 text-cc-primary/90",
  pending: "border-cc-border bg-transparent text-cc-muted/70",
  idle: "border-cc-primary/25 bg-cc-primary/10 text-cc-primary/80",
};

export default function AudienceRail({
  audiences,
  activeId,
  compareId,
  hasPage,
  onPick,
}: AudienceRailProps) {
  return (
    <nav
      aria-label="Audience ladder"
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5"
    >
      {audiences.map((audience, i) => {
        const written = hasPage(audience);
        const state: RungState = !written
          ? "pending"
          : audience.id === activeId
            ? "active"
            : audience.id === compareId
              ? "compare"
              : "idle";
        return (
          <button
            key={`${audience.id}-${i}`}
            type="button"
            data-eli5-rung={audience.id}
            data-eli5-state={state}
            aria-current={audience.id === activeId ? "true" : undefined}
            title={
              written
                ? audience.tone || audience.label
                : `No page yet — ${audience.file || "no file named"}`
            }
            onClick={() => onPick(audience.id)}
            className={`group flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-cc-primary/60 ${STATE_CLASS[state]}`}
          >
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold tabular-nums ${BADGE_CLASS[state]}`}
            >
              {i + 1}
            </span>
            <span className="max-w-[14rem] truncate">{audience.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
