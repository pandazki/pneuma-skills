/**
 * The hand-off a shot declares, rendered once for every surface that shows
 * it (the Plan tab's record, the Lineup tab's review).
 *
 * TWO DIFFERENT BLOCKS LIVE IN THIS FIELD and they must not read alike.
 * `continuity.from` set means "this shot is one continuous action seen from a
 * new camera, and it opens on that shot's last used frame" — a claim the
 * `take-handoff` check answers. `from` null with only an `exit` means "here
 * is how this shot ENDS, for a later shot to pick up": a note, not a claim.
 *
 * And the ABSENCE of the block is neither. Most cuts exist to break
 * continuity — an ellipsis, a jump cut, a montage — so nothing is drawn to
 * mark a shot that declares nothing, and nowhere does a missing hand-off read
 * as a defect.
 */

import type { ShotContinuity } from "../../domain.js";
import { LinkIcon } from "../icons.js";

export function ContinuityNote({ continuity }: { continuity: ShotContinuity | null }) {
  if (!continuity) return null;
  const handoff = continuity.from !== null;

  return (
    <section
      className={`rounded-md border px-2.5 py-2 ${
        handoff ? "border-cc-primary/40 bg-cc-primary/10" : "border-cc-border bg-cc-hover/40"
      }`}
    >
      <h3
        className={`flex items-center gap-1.5 text-[11px] font-medium ${
          handoff ? "text-cc-primary" : "text-cc-muted"
        }`}
      >
        <LinkIcon size={11} />
        {handoff ? `Continues from ${continuity.from}` : "Exit state on record"}
      </h3>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        {continuity.entry ? (
          <>
            <dt className="text-cc-muted">Entry</dt>
            <dd className="leading-relaxed text-cc-fg">{continuity.entry}</dd>
          </>
        ) : null}
        {continuity.exit ? (
          <>
            <dt className="text-cc-muted">Exit</dt>
            <dd className="leading-relaxed text-cc-fg">{continuity.exit}</dd>
          </>
        ) : null}
      </dl>
      <p className="mt-1 text-[10px] leading-relaxed text-cc-muted">
        {handoff
          ? "The first frame must continue that shot's last used frame — positions, facing, weapons, action."
          : "No hand-off: this shot is generated alone. The exit is here for whatever picks it up."}
      </p>
    </section>
  );
}

export default ContinuityNote;
