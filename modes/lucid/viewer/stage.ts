/**
 * The lucid stage's decidable half — everything the viewer computes that can
 * be wrong in a way a screenshot would not show.
 *
 * Three things live here on purpose:
 *
 *  - **The address algebra.** `navigate-to`, `capture` and a locator card all
 *    route through `parseAddress`; a `round` that silently became `NaN` would
 *    put the wrong picture on screen and the agent would believe it.
 *  - **The rail's own arithmetic.** Which round is best, what a chip says,
 *    and where the sparkline's points fall. The sparkline's y-axis is FIXED
 *    to the rubric's 0–10, never auto-scaled: an auto-scaled trajectory makes
 *    "6.7 → 6.8" look like a breakthrough, which is the one thing the user
 *    reads this control to find out.
 *  - **What the status strip claims.** The exit verdict is `lucid.mjs`'s,
 *    read back verbatim; the only thing the viewer derives is the wall clock.
 */

import {
  budgetRemainingMinutes,
  type ExitState,
  type Loop,
  type RoundRecord,
} from "../domain.js";
import type { CaptureSource } from "./bridge.js";

// ── View mode ──────────────────────────────────────────────────────────────

/** Live = the scene running; Target = the dream; Split = the wipe compare. */
export type ViewMode = "live" | "target" | "split";

export const VIEW_MODES: readonly ViewMode[] = ["live", "target", "split"];

export function parseViewMode(raw: unknown): ViewMode | null {
  return typeof raw === "string" && (VIEW_MODES as readonly string[]).includes(raw)
    ? (raw as ViewMode)
    : null;
}

// ── The wipe ───────────────────────────────────────────────────────────────

/** Fraction of the stage width the target overlay covers, clamped to 0…1. */
export function clampWipe(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/**
 * Pointer x → wipe fraction. A drag that leaves the stage keeps dragging
 * (pointer capture), so the clamp is what stops the overlay from inverting.
 */
export function wipeFromPointer(
  clientX: number,
  rect: { left: number; width: number },
): number {
  if (!rect.width) return 0.5;
  return clampWipe((clientX - rect.left) / rect.width);
}

// ── The stage's own size ───────────────────────────────────────────────────

/** The CSS box the scene fills, as `get-scene-state` reports it. */
export interface StageSize {
  width: number;
  height: number;
  /** `width / height`, to three decimals — 1091 × 738 is `1.478`. */
  aspect: number;
}

/**
 * The stage's size in CSS pixels.
 *
 * The agent dreams ONE target image and every later round is measured against
 * it, so the target has to be the shape of the stage it will be compared on.
 * In the blind trial (2026-09-16) the agent used the skill's default 16:9
 * while the stage was 1091 × 738 (1.478) — every round was then judged
 * against a differently shaped picture, and no amount of scene work could
 * close that gap.
 *
 * Measured from the STAGE CONTAINER, not the iframe: the container exists
 * before any scene does (so an empty project can still answer) and it is what
 * the scene is stretched to fill. Null only when there is no element to
 * measure or it has no area yet — a zero-height box has no aspect, and
 * inventing one is how a wrong number gets into a prompt.
 */
export function stageSize(
  rect: { width: number; height: number } | null | undefined,
): StageSize | null {
  if (!rect) return null;
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  // Rounded dimensions drive the ratio so the three numbers agree: an agent
  // that divides the reported width by the reported height gets `aspect`.
  return { width, height, aspect: Math.round((width / height) * 1000) / 1000 };
}

// ── Address ────────────────────────────────────────────────────────────────

export interface LucidAddress {
  contentSet?: string;
  /** 1-based round index, matching `rounds/NN/`. */
  round?: number;
  view?: ViewMode;
}

/**
 * Read a ViewerAddress into the three keys this mode owns.
 *
 * Lenient at this agent-input boundary and silent about keys it does not
 * know — but a `round` that is not a positive integer is DROPPED rather than
 * coerced: `round: "2"` from a hand-written JSON string still resolves (a
 * numeric string is unambiguous), while `round: 0` or `round: 1.5` names no
 * round on disk and must not quietly become round 1.
 */
export function parseAddress(raw: unknown): LucidAddress {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const address: LucidAddress = {};

  const contentSet = record.contentSet;
  if (typeof contentSet === "string") address.contentSet = contentSet;

  const roundRaw = record.round;
  const round =
    typeof roundRaw === "number"
      ? roundRaw
      : typeof roundRaw === "string" && roundRaw.trim() !== ""
        ? Number(roundRaw)
        : NaN;
  if (Number.isInteger(round) && round >= 1) address.round = round;

  const view = parseViewMode(record.view);
  if (view) address.view = view;

  return address;
}

/** What the stage is showing: a recorded round or the live scene, in a view. */
export interface StagePosition {
  round: number | null;
  view: ViewMode;
}

/**
 * Where an address moves the stage from where it already is.
 *
 * The rule that earns its own function: NAMING A ROUND MUST MAKE THAT ROUND
 * VISIBLE. `capture` drives a navigation before it shoots, so a `{ round: 1 }`
 * that left the stage in Target view produced a perfectly valid screenshot —
 * of the dream, filed under "round 1". A plausible picture of the wrong
 * object is the exact failure the coarse-key registry exists to prevent, so
 * an address that names a round and no view lands in Split, where the round
 * and the target are both on screen.
 *
 * An explicit `view` always wins: an agent that asks for `{ round: 1, view:
 * "target" }` is asking to see the dream, and is entitled to it.
 */
export function nextStage(current: StagePosition, address: LucidAddress): StagePosition {
  const next: StagePosition = { ...current };
  if (address.round !== undefined) {
    next.round = address.round;
    if (address.view === undefined && current.view !== "split") next.view = "split";
  } else if (address.view !== undefined || address.contentSet !== undefined) {
    // A view switch or a project switch with no round means the live scene.
    next.round = null;
  }
  if (address.view !== undefined) next.view = address.view;
  return next;
}

// ── Resolving an address against the workspace ─────────────────────────────

/** Everything `resolveAddress` needs to know about the workspace. */
export interface StageWorld {
  /** The project on stage: its directory, `""` for a root-level one. */
  dir: string;
  /** Every project the loader could read, keyed by directory. */
  projects: Record<string, Loop>;
  /** The directories the store can actually switch to. */
  contentSets: readonly string[];
  /** Where the stage is now. */
  position: StagePosition;
}

export type AddressOutcome =
  | {
      ok: true;
      /** The project the stage lands on. */
      contentSet: string;
      /** The project to activate first, or null when none is needed. */
      switchTo: string | null;
      position: StagePosition;
    }
  | { ok: false; message: string };

/**
 * Where an address sends the stage, or why it cannot go.
 *
 * Decided here, and whole, before the component moves anything: a refusal
 * issued halfway through leaves the stage somewhere the answer does not
 * describe.
 *
 * THE ROUND IS CHECKED AGAINST THE PROJECT THE ADDRESS LANDS ON — the one it
 * names, or the one already on stage when it names none. The earlier version
 * checked only when `contentSet` was spelled out, so the documented shorthand
 * `{ "round": 999, "view": "split" }` answered success; a later effect
 * silently dropped the round, and the agent went on believing a round it had
 * never recorded was on screen. A named refusal is the whole point of
 * validating at all.
 */
export function resolveAddress(world: StageWorld, address: LucidAddress): AddressOutcome {
  const switching = address.contentSet !== undefined && address.contentSet !== world.dir;
  if (switching && !world.contentSets.includes(address.contentSet!)) {
    const showing = world.projects[world.dir]?.title ?? "nothing";
    return {
      ok: false,
      message: `No project named "${address.contentSet}" in this workspace. Showing "${showing}".`,
    };
  }

  const contentSet = address.contentSet ?? world.dir;
  const destination = world.projects[contentSet] ?? null;

  if (address.round !== undefined) {
    if (!destination) {
      // The switcher knows the directory but the loader could not read its
      // manifest — mid-write, or hand-edited. Nothing can be said about its
      // rounds, and saying nothing is what produced the bug above.
      return {
        ok: false,
        message: `Cannot show round ${address.round}: no readable lucid.json in "${contentSet || "(root)"}".`,
      };
    }
    if (!destination.rounds.some((round) => round.index === address.round)) {
      return {
        ok: false,
        message: `Round ${address.round} is not recorded in "${destination.title}".`,
      };
    }
  }

  return {
    ok: true,
    contentSet,
    switchTo: switching ? address.contentSet! : null,
    position: nextStage(world.position, address),
  };
}

// ── What `capture` hands back ──────────────────────────────────────────────

/** A recorded PNG that is on the stage, and what that PNG is a picture of. */
export interface StillSelection {
  /** The `/content/…` URL whose exact bytes `capture` returns. */
  url: string;
  source: Exclude<CaptureSource, "live">;
  /** The round this still was recorded for; absent for the target. */
  round?: number;
}

/**
 * Which recorded still `capture` must hand back, or null when the live scene
 * is the subject.
 *
 * Deliberate, and the reason this is a function rather than an inline
 * ternary: `capture` answers with a PNG path whatever it shot, so the
 * difference between "a frame of the scene" and "the dream, again" is
 * invisible in the reply. The caller files the answer as `lastCapture.source`
 * so the agent can tell them apart before it spends a verdict.
 *
 * In Split the LIVE frame is the subject — the target is the yardstick beside
 * it, and the agent asks for the target by name when it wants the target. A
 * round with no recorded capture is nothing to hand back, so the live scene
 * (which is still rendering underneath) answers instead.
 */
export function stillOnStage(
  position: StagePosition,
  urls: { target: string | null; capture: string | null },
): StillSelection | null {
  if (position.view === "target") {
    return urls.target ? { url: urls.target, source: "target" } : null;
  }
  if (position.round !== null && urls.capture) {
    return { url: urls.capture, source: "round", round: position.round };
  }
  return null;
}

// ── Scores ─────────────────────────────────────────────────────────────────

/**
 * `6.8`, `7`, `3.35`, `4.25` — up to two decimals, no trailing zeros.
 *
 * Two, because the judge scores in hundredths: composition/lighting/materials
 * are 0–3 and details 0–1 with fractions allowed, so a real trajectory reads
 * 3.35 → 4 → 4.25. Rounding that to one decimal printed `3.4` / `4.3` on the
 * rail while the same numbers appeared unrounded everywhere else the user
 * could see them — the score in the chat, the seed's own description — and a
 * rail that disagrees with the verdict is a rail nobody trusts.
 */
export function formatScore(total: number): string {
  if (!Number.isFinite(total)) return "—";
  // Round through `toFixed`, then strip: `4.00` → `4`, `4.20` → `4.2`, and
  // `4.25` stays. The decimal point `toFixed(2)` always writes is what keeps
  // the strip from eating the zeros of a whole number like `10`.
  return total.toFixed(2).replace(/\.?0+$/, "");
}

export interface RailChip {
  /** 1-based round index — the value that goes in an address. */
  index: number;
  /** `"R1 4.5"` — what the chip prints. */
  short: string;
  /** `"Round 1 · 4.5"` — the accessible name and the workspace-item label. */
  label: string;
  total: number | null;
  judged: boolean;
  /** The highest-scoring judged round of the CURRENT target; ties go earlier. */
  best: boolean;
  hasCapture: boolean;
  /** `rethink` rounds are the deliberate redesigns, marked on the rail. */
  rethink: boolean;
  /** The `target.version` this round was captured and judged against. */
  targetVersion: number;
  /**
   * True when this round was judged against a target the loop has since
   * replaced. Its score no longer counts towards the exit rules (`lucid.mjs`
   * excludes it), so the rail must not let it read as part of the current
   * trajectory.
   */
  superseded: boolean;
}

/**
 * The target version a round's score is still measured against.
 *
 * `0` means no target has been locked yet, and a loop with no dream has no
 * superseded rounds — nothing to compare against is not the same as "every
 * round is out of date".
 */
function currentTargetVersion(loop: Loop): number {
  return Math.max(0, loop.target.version);
}

/**
 * The highest-scoring judged round; ties keep the earliest.
 *
 * With `targetVersion`, only rounds judged against THAT target compete — the
 * same exclusion `lucid.mjs` applies when it computes `evaluation.best`. A
 * rail that lit a superseded round as "best" would be telling the user
 * something the script's own status contradicts.
 */
export function bestRoundIndex(
  rounds: readonly RoundRecord[],
  targetVersion?: number,
): number | null {
  let best: number | null = null;
  let bestTotal = -Infinity;
  for (const round of rounds) {
    if (!round.verdict) continue;
    if (targetVersion !== undefined && round.targetVersion !== targetVersion) continue;
    if (round.verdict.total > bestTotal) {
      bestTotal = round.verdict.total;
      best = round.index;
    }
  }
  return best;
}

/**
 * The best round, as the LOOP defines it — one answer for every surface that
 * shows one.
 *
 * `lucid.mjs` computes `evaluation.best` over the rounds judged against the
 * LOCKED target only, so after a re-dream it names a round from the current
 * dream. Deriving a second answer here from every round on file would light a
 * chip, and tell the agent, about a round scored against a dream this loop
 * has abandoned. The script's answer wins whenever it has one; the derivation
 * below exists for the window before the first evaluation, and applies the
 * same target-version exclusion.
 */
export function bestPoint(loop: Loop | null): { index: number; total: number } | null {
  if (!loop) return null;
  if (loop.evaluation) return loop.evaluation.best;
  const current = currentTargetVersion(loop);
  const index = bestRoundIndex(loop.rounds, current > 0 ? current : undefined);
  const round = index === null ? null : loop.rounds.find((r) => r.index === index);
  return round?.verdict ? { index: round.index, total: round.verdict.total } : null;
}

export function railChips(loop: Loop | null): RailChip[] {
  if (!loop) return [];
  const current = currentTargetVersion(loop);
  const best = bestPoint(loop)?.index ?? null;
  return loop.rounds.map((round) => {
    const total = round.verdict ? round.verdict.total : null;
    const score = total === null ? "" : ` ${formatScore(total)}`;
    const superseded = current > 0 && round.targetVersion !== current;
    const named = total === null ? `Round ${round.index}` : `Round ${round.index} · ${formatScore(total)}`;
    return {
      index: round.index,
      short: `R${round.index}${score}`,
      label: superseded ? `${named} · target v${round.targetVersion}` : named,
      total,
      judged: total !== null,
      best: best !== null && round.index === best,
      hasCapture: !!round.capture,
      rethink: round.kind === "rethink",
      targetVersion: round.targetVersion,
      superseded,
    };
  });
}

// ── Sparkline ──────────────────────────────────────────────────────────────

export interface SparklinePoint {
  x: number;
  y: number;
}

/**
 * Trajectory points inside a `width × height` box, y fixed to the rubric's
 * 0–10 so two projects (and two moments in one project) are comparable.
 * A single judged round is one point, not a line — `sparklinePath` draws the
 * dot; drawing a zero-length line would show nothing at all.
 */
export function sparklinePoints(
  trend: readonly number[],
  width: number,
  height: number,
): SparklinePoint[] {
  if (trend.length === 0 || width <= 0 || height <= 0) return [];
  const span = trend.length > 1 ? trend.length - 1 : 1;
  return trend.map((total, i) => {
    const clamped = Math.min(10, Math.max(0, total));
    return {
      x: trend.length > 1 ? (i / span) * width : width / 2,
      y: height - (clamped / 10) * height,
    };
  });
}

/** `M…L…` for the points above; `""` when there is nothing to draw. */
export function sparklinePath(points: readonly SparklinePoint[]): string {
  if (points.length < 2) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
}

// ── Scene change detection ─────────────────────────────────────────────────

/**
 * A fingerprint of the scene's source files, used to decide whether the
 * iframe needs a reload.
 *
 * Content is hashed rather than compared by length: an agent fixing a
 * material usually swaps one token for another of the same size
 * (`0xffffff` → `0x8844ff`), and a length-only signature would report "no
 * change" for exactly the edits the user is waiting to see. Paths are sorted
 * so a reordered snapshot is not a change either.
 */
export function sceneSignature(
  files: readonly { path: string; content: string }[] | null | undefined,
): string {
  if (!files || files.length === 0) return "";
  return files
    .map((file) => `${file.path}:${file.content.length}:${hash32(file.content)}`)
    .sort()
    .join("|");
}

/** djb2 — cheap, stable, and never leaves this module's comparisons. */
function hash32(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ── Status ─────────────────────────────────────────────────────────────────

export type StatusTone = "idle" | "active" | "good" | "warn" | "bad";

export interface StatusChip {
  label: string;
  tone: StatusTone;
}

/**
 * The exit verdict, as `lucid.mjs` computed it.
 *
 * The viewer never re-derives this — the whole point of the script owning
 * the exit rule is that one authority decides when the loop is done. An
 * unevaluated project falls back to its `status`, which is the honest "the
 * script has not spoken yet".
 */
export function exitChip(loop: Loop | null): StatusChip {
  if (!loop) return { label: "No project", tone: "idle" };
  const exit: ExitState | null = loop.evaluation?.exit ?? null;
  switch (exit) {
    case "dreaming":
      return { label: "Dreaming the target", tone: "idle" };
    case "continue":
      return { label: "Looping", tone: "active" };
    case "done":
      return { label: "Done", tone: "good" };
    case "optimize-fps":
      return { label: "Score met, fps short", tone: "warn" };
    case "stall-approaching":
      return { label: "Stall approaching", tone: "warn" };
    case "stalled":
      return { label: "Stalled", tone: "bad" };
    case "budget-exhausted":
      return { label: "Budget exhausted", tone: "bad" };
    default:
      break;
  }
  switch (loop.status) {
    case "looping":
      return { label: "Looping", tone: "active" };
    case "done":
      return { label: "Done", tone: "good" };
    case "stalled":
      return { label: "Stalled", tone: "bad" };
    default:
      return { label: "Dreaming the target", tone: "idle" };
  }
}

/** `"42 min left"` / `"under a minute left"` / null when no budget is running. */
export function budgetLabel(loop: Loop | null, now: Date = new Date()): string | null {
  if (!loop) return null;
  const remaining = budgetRemainingMinutes(loop, now);
  if (remaining === null) return null;
  if (remaining <= 0) return "out of time";
  if (remaining < 1) return "under a minute left";
  return `${Math.round(remaining)} min left`;
}

/** What the scene bridge reported, as the status strip needs it. */
export interface SceneVitals {
  bridge: boolean;
  fps: number | null;
  frameMs: number | null;
  triangles: number | null;
  textures: number | null;
  errors: readonly string[];
  /** Named diagnostics the scene recorded; 0 or absent prints nothing. */
  notes?: number;
}

/**
 * How many distinct notes the scene has recorded.
 *
 * Two sources, one count: the state reply carries the notes with their
 * values, and the unsolicited announcements carry names that arrived between
 * polls. Neither is a superset of the other for long, and counting them twice
 * would tell the user the scene said more than it did.
 */
export function noteCount(
  announced: readonly string[],
  notes: Record<string, unknown> | null | undefined,
): number {
  return new Set([...announced, ...Object.keys(notes ?? {})]).size;
}

/**
 * Warnings, most actionable first.
 *
 * "no bridge" leads because it invalidates every other number on the strip —
 * and because `capture` and `get-scene-state` both go through the bridge, a
 * scene without it cannot be judged at all.
 */
export function warningLines(loop: Loop | null, scene: SceneVitals): string[] {
  const lines: string[] = [];
  if (!scene.bridge) {
    lines.push("no bridge — the scene cannot be measured or captured");
  }
  if (scene.errors.length > 0) {
    lines.push(
      scene.errors.length === 1
        ? `1 scene error: ${scene.errors[0]}`
        : `${scene.errors.length} scene errors: ${scene.errors[0]}`,
    );
  }
  for (const warning of loop?.warnings ?? []) lines.push(warning);
  return lines;
}

/** `"58 fps · 17.2 ms · 84k tris · 6 textures · 2 notes"`, skipping the unknown. */
export function vitalsLine(scene: SceneVitals): string {
  const parts: string[] = [];
  if (scene.fps !== null) parts.push(`${Math.round(scene.fps)} fps`);
  if (scene.frameMs !== null) parts.push(`${scene.frameMs.toFixed(1)} ms`);
  if (scene.triangles !== null) parts.push(`${compactCount(scene.triangles)} tris`);
  if (scene.textures !== null) {
    parts.push(`${scene.textures} texture${scene.textures === 1 ? "" : "s"}`);
  }
  // Notes are not a warning — they are the scene's own diagnostics. The strip
  // says only that there are some; their values go to the agent.
  if (scene.notes) parts.push(`${scene.notes} note${scene.notes === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** `840` / `84k` / `1.2M` — triangle counts are read, not audited. */
export function compactCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const n = Math.max(0, Math.round(value));
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(1) : Math.round(m)}M`;
}
