import { frameDistance, premultiplied } from "./cycle.mjs";
import { DUPLICATE_STEP, stepThumb } from "./frame-steps.mjs";

/** Pixel changes cannot determine whether a hold, flash or transparency is intended. */
export function diagnoseAnimation(frames, { durationsMs = null, timingSource = "unknown", loop = null, duplicateStep = DUPLICATE_STEP } = {}) {
  if (!frames.length) throw new Error("animation diagnostics needs at least one frame");
  if (!Number.isFinite(duplicateStep) || duplicateStep < 0 || duplicateStep > 1) throw new Error("duplicateStep must be between 0 and 1");
  if (durationsMs !== null && (durationsMs.length !== frames.length || durationsMs.some((ms) => !Number.isFinite(ms) || ms <= 0))) throw new Error("one positive duration per frame is required");
  const knownTiming = durationsMs !== null && ["gif-delays", "atlas-frame-durations", "loop-frame-rate", "transition-frame-rate"].includes(timingSource);
  const thumbs = frames.map((frame) => premultiplied(frame.thumb ?? stepThumb(frame)));
  const alphaMass = frames.map((frame) => {
    if (Number.isFinite(frame.alphaMass)) return frame.alphaMass;
    let sum = 0;
    for (let i = 3; i < frame.data.length; i += 4) sum += frame.data[i] / 255;
    return sum / (frame.width * frame.height);
  });
  const steps = thumbs.slice(1).map((thumb, i) => frameDistance(thumbs[i], thumb));
  const sorted = [...steps].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const holds = [];
  let start = 0;
  for (let end = 1; end <= frames.length; end++) {
    if (end < frames.length && steps[end - 1] < duplicateStep) continue;
    if (end - start > 1) holds.push({ from: start, to: end - 1, frames: end - start, durationMs: knownTiming ? durationsMs.slice(start, end).reduce((a, b) => a + b, 0) : null, certainty: "measured" });
    start = end;
  }
  const adjacentDistinctDrawings = steps.filter((step) => step >= duplicateStep).length;
  return {
    frameCount: frames.length, adjacentPairs: steps.length, adjacentDistinctDrawings,
    drawingCount: adjacentDistinctDrawings + 1, drawingCountDefinition: "contiguous drawing runs at the declared difference threshold; return poses count again",
    differenceMethod: "mean absolute premultiplied RGBA difference at 64x64",
    duplicateStep, steps, holds,
    heldMs: knownTiming ? holds.reduce((sum, hold) => sum + hold.durationMs, 0) : null,
    heldFrameCount: holds.reduce((sum, hold) => sum + hold.frames, 0),
    timing: { source: knownTiming ? timingSource : "unknown", durationsMs: knownTiming ? [...durationsMs] : null, totalMs: knownTiming ? durationsMs.reduce((a, b) => a + b, 0) : null },
    loop,
    wrapStep: loop === true && frames.length > 1 ? frameDistance(thumbs.at(-1), thumbs[0]) : null,
    changeSpikes: steps.flatMap((step, i) => step > Math.max(duplicateStep, 3 * median) ? [{ from: i, to: i + 1, step, certainty: "suspected", meaning: "change spike; intent unknown" }] : []),
    alphaMass, alphaChanges: alphaMass.slice(1).map((mass, i) => ({ from: i, to: i + 1, delta: mass - alphaMass[i], certainty: "measured" })),
    interpretation: { applicability: "unknown", certainty: "unknown", reason: "Holds and silhouette or alpha changes may be intentional, including smoke, glow, glass, particles and abstract effects. These measurements do not prove ghosts, anatomy errors or identity changes." },
    artisticQuality: "unknown",
  };
}
