/**
 * The ask bar (T6, direction ①→⑥) — what the user hands back to the agent
 * after pointing at the board.
 *
 * It sits between the board and the transport on purpose. The transport is
 * the user's control over the RECORDING (play, scrub, rate — none of that
 * involves the agent, §9). This strip is the user's control over the
 * EXPLANATION, and every button here is a request to the person who wrote
 * it. Keeping the two rows adjacent but distinct is the whole point: one
 * is a remote, the other is raising your hand.
 *
 * The left half is the receipt for a click on the board — without it, "say
 * this part again" is a request with no visible subject, and the user has
 * no way to tell what the agent is about to be told.
 *
 * Chrome tokens (`cc-*`), not board tokens: this is Pneuma's surface, not
 * the content's.
 */

import type { ViewerCommandDescriptor } from "../../../core/types/viewer-contract.js";

export interface BoardCommandsProps {
  commands: readonly ViewerCommandDescriptor[];
  /** What the user is pointing at, already in lecture words. */
  pointing: { where: string; kind: string; summary: string } | null;
  onClear(): void;
  onRun(command: ViewerCommandDescriptor): void;
}

export default function BoardCommands({
  commands,
  pointing,
  onClear,
  onRun,
}: BoardCommandsProps) {
  if (commands.length === 0) return null;

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg border border-cc-border bg-cc-surface/60 backdrop-blur">
      {pointing ? (
        <div className="flex items-center gap-1.5 min-w-0 text-xs">
          <span className="shrink-0 text-cc-primary font-medium">
            {pointing.where}
          </span>
          <span className="shrink-0 text-cc-muted/70">{pointing.kind}</span>
          <span className="truncate text-cc-fg/80">“{pointing.summary}”</span>
          <button
            type="button"
            onClick={onClear}
            aria-label="Stop pointing at this step"
            title="Stop pointing at this step"
            className="shrink-0 w-4 h-4 grid place-items-center rounded text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </div>
      ) : (
        <span className="text-xs text-cc-muted/70 truncate">
          Click anything on the board to point at it.
        </span>
      )}

      <span className="flex-1 min-w-[8px]" />

      {commands.map((command) => (
        <button
          key={command.id}
          type="button"
          onClick={() => onRun(command)}
          title={command.description}
          className="shrink-0 px-2.5 py-1 rounded-md text-xs font-medium text-cc-muted hover:text-cc-primary hover:bg-cc-primary/10 transition-colors cursor-pointer"
        >
          {command.label}
        </button>
      ))}
    </div>
  );
}
