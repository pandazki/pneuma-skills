/**
 * The transport — the only thing on screen that moves the clock.
 *
 * Rates stop at 1×: this is a check-the-blocking player, and everything
 * slower than real time is what a jitter or a drifting camera is found at.
 */

import type { Shot } from "../domain.js";
import { PauseIcon, PlayIcon, StepBackIcon, StepForwardIcon, LoopIcon } from "./icons.js";
import { Segment } from "./Lane.js";
import { PLAY_RATES, formatSeconds, playheadLabel } from "./stage-model.js";
import { useClock, type Clock, type LoopMode } from "./usePlayhead.js";

export interface TransportProps {
  clock: Clock;
  spec: Shot["spec"];
  onPrevEdge: () => void;
  onNextEdge: () => void;
  markedRange: [number, number] | null;
  onClearRange: () => void;
}

export function Transport({
  clock,
  spec,
  onPrevEdge,
  onNextEdge,
  markedRange,
  onClearRange,
}: TransportProps) {
  const { playing, rate, loop } = useClock(clock);

  const setLoop = (mode: LoopMode) => clock.setLoop(loop === mode ? "off" : mode);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-cc-border bg-cc-surface/30 px-3 py-1.5 backdrop-blur">
      <button
        type="button"
        onClick={() => clock.toggle()}
        title={playing ? "Pause (Space)" : "Play (Space)"}
        aria-label={playing ? "Pause" : "Play"}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-cc-primary/50 bg-cc-primary/15 text-cc-primary transition-colors hover:bg-cc-primary/25 focus-visible:ring-2 focus-visible:ring-cc-primary/60"
      >
        {playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
      </button>

      <div className="flex items-center gap-0.5">
        <IconButton onClick={() => clock.stepFrames(-1)} title="Back one frame (←)">
          <StepBackIcon size={13} />
        </IconButton>
        <IconButton onClick={() => clock.stepFrames(1)} title="Forward one frame (→)">
          <StepForwardIcon size={13} />
        </IconButton>
      </div>

      <div className="flex items-center gap-1">
        <IconButton onClick={onPrevEdge} title="Previous beat edge ([)">
          <span className="text-[11px] leading-none">[</span>
        </IconButton>
        <IconButton onClick={onNextEdge} title="Next beat edge (])">
          <span className="text-[11px] leading-none">]</span>
        </IconButton>
      </div>

      <span className="mx-0.5 h-3.5 w-px bg-cc-border" />

      <div className="flex items-center gap-1">
        {PLAY_RATES.map((value) => (
          <Segment key={value} active={rate === value} onClick={() => clock.setRate(value)}>
            {value}×
          </Segment>
        ))}
      </div>

      <span className="mx-0.5 h-3.5 w-px bg-cc-border" />

      <div className="flex items-center gap-1">
        <span className="text-cc-muted">
          <LoopIcon size={12} />
        </span>
        <Segment
          active={loop === "shot"}
          onClick={() => setLoop("shot")}
          title="Loop the whole shot"
        >
          Shot
        </Segment>
        <Segment
          active={loop === "beat"}
          onClick={() => setLoop("beat")}
          title="Loop the beat under the playhead (L)"
        >
          Beat
        </Segment>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {markedRange ? (
          <button
            type="button"
            onClick={onClearRange}
            title="Clear the marked range"
            className="rounded-full border border-cc-primary/40 px-2 py-0.5 text-[10px] tabular-nums text-cc-primary transition-colors hover:bg-cc-primary/10"
          >
            marked {formatSeconds(markedRange[0])}–{formatSeconds(markedRange[1])} s ✕
          </button>
        ) : null}
        <TimeReadout clock={clock} spec={spec} />
      </div>
    </div>
  );
}

/** Its own subscriber, so the number can update every frame on its own. */
function TimeReadout({ clock, spec }: { clock: Clock; spec: Shot["spec"] }) {
  const { time } = useClock(clock);
  return (
    <span className="text-[11px] tabular-nums text-cc-fg">{playheadLabel(time, spec)}</span>
  );
}

function IconButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-6 w-6 items-center justify-center rounded text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:ring-2 focus-visible:ring-cc-primary/60"
    >
      {children}
    </button>
  );
}

export default Transport;
