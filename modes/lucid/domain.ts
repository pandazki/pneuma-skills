/**
 * Lucid domain types + aggregate-file load/save.
 *
 * A `Loops` value is the whole lucid workspace: every `lucid.json` found under
 * any content-set directory, keyed by that directory prefix (an empty-string
 * key `""` means a root-level project). One content set is one PROJECT — one
 * dream, one scene, one score trajectory — so there is no separate `project`
 * address key; the project *is* the content set.
 *
 * `lucid.json` is written only by `skill/scripts/lucid.mjs`. It is the single
 * authority for the loop: the locked target, every round (capture + verdict),
 * the asset ledger, and the last computed exit evaluation. The script
 * recomputes `evaluation` on every mutation, so the viewer never re-derives
 * the exit rules — it displays what the script decided, and only adds the
 * wall clock (budget remaining) on top.
 *
 * Parsing is defensive on purpose. The file is rewritten mid-loop while the
 * viewer is watching, so a half-written or hand-edited project is SKIPPED with
 * a warning, never thrown on — one broken project must not blank the roster
 * for every sibling (the same stance as `modes/sprite/domain.ts`).
 *
 * `saveLoops` throws. The v0.1 viewer is read-only: rounds, targets and assets
 * are recorded by the script, which owns the numbering and the evaluation.
 * When viewer write-back lands (e.g. dropping a round, editing the brief),
 * replace the throw with a real decomposer rather than teaching the viewer a
 * second way to write `lucid.json`.
 */

import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

// ── On-disk contract (`<project>/lucid.json`) ───────────────────────────────

export const LUCID_FORMAT = "pneuma-lucid/v1" as const;

export const LUCID_MANIFEST = "lucid.json" as const;

/** Overall project state. `dreaming` = no target locked yet. */
export type LoopStatus = "dreaming" | "looping" | "done" | "stalled";

/** What the script tells the agent to do next. Computed by `lucid.mjs`. */
export type ExitState =
  | "dreaming"
  | "continue"
  | "done"
  | "optimize-fps"
  | "stall-approaching"
  | "stalled"
  | "budget-exhausted";

export type GapArea = "composition" | "lighting" | "materials" | "details";

/**
 * One actionable gap named by the judge. `id` is a stable slug the judge
 * carries over from the previous verdict when the same gap persists — that
 * is how "the judge keeps naming the same gap" is detected without fuzzy
 * text matching.
 */
export interface Gap {
  id: string;
  area: GapArea;
  issue: string;
  fix: string;
}

/**
 * The judge's verdict for one round. Composition / lighting / materials are
 * scored 0–3, details 0–1, fractions allowed; `total` is their sum (the
 * script recomputes it and warns when the judge's arithmetic disagrees).
 */
export interface Verdict {
  composition: number;
  lighting: number;
  materials: number;
  details: number;
  total: number;
  summary?: string;
  gaps: Gap[];
  judgedAt: string;
}

/** `iterate` is a normal fix round; `rethink` is the deliberate big-picture
 *  redesign the skill calls for when a stall is approaching. */
export type RoundKind = "iterate" | "rethink";

export interface RoundRecord {
  /** 1-based, matches the `rounds/NN/` directory. */
  index: number;
  kind: RoundKind;
  /**
   * The `target.version` this round was captured and judged against. Locking a
   * new target (a re-dream) leaves earlier rounds in the file and on the rail,
   * but they no longer count towards the exit rules — a trajectory scored
   * against one dream says nothing about another. Rounds written before this
   * field existed read as `1`.
   */
  targetVersion: number;
  at: string;
  /** Project-relative capture path (`rounds/01/capture.png`) or null when the
   *  round was recorded without a screenshot. */
  capture: string | null;
  /** Measured fps at capture time, from the scene bridge; null when unmeasured. */
  fps: number | null;
  note?: string;
  verdict: Verdict | null;
}

export interface TargetHistoryEntry {
  version: number;
  /** Project-relative archived path (`target-history/v1.png`). */
  path: string;
  replacedAt: string;
  reason?: string;
}

export interface TargetState {
  /** Project-relative path of the locked target (`target.png`), null before the first lock. */
  path: string | null;
  /** Increments on every replacement; 0 before the first lock. */
  version: number;
  lockedAt: string | null;
  history: TargetHistoryEntry[];
}

export interface BudgetState {
  minutes: number;
  /**
   * When the clock started: the moment the budget was asked for
   * (`init --budget-minutes` or `budget --minutes`), NOT the first target
   * lock — the user's minutes begin when they ask, and dreaming spends them.
   * Null only for a project whose budget was written without one.
   */
  startedAt: string | null;
  /**
   * Minutes credited back by `budget --pause-credit` after a pause the wall
   * clock counted (credits ran out, the machine slept). Absent until the
   * first credit; the clock never pauses on its own.
   */
  pausedMinutes?: number;
}

export type AssetRole = "hero" | "prop" | "environment";
export type AssetSource = "image-to-3d" | "blender" | "procedural" | "user";
export type AssetState = "planned" | "generating" | "ready" | "placed" | "failed";

export interface AssetEntry {
  id: string;
  role: AssetRole;
  source: AssetSource;
  state: AssetState;
  /** Project-relative files (`scene/models/arch.glb`, `assets/arch.png`). */
  files: string[];
  note?: string;
  updatedAt: string;
}

/** The last exit evaluation the script computed. Time-independent — budget
 *  exhaustion is re-evaluated by `lucid.mjs status` and by the viewer clock. */
export interface LoopEvaluation {
  exit: ExitState;
  reasons: string[];
  /**
   * The `target.version` these numbers were computed against; rounds judged
   * against an earlier target were excluded. Evaluations written before this
   * field existed read as `1`.
   */
  targetVersion: number;
  best: { index: number; total: number } | null;
  last: { index: number; total: number } | null;
  /** Totals in round order, one entry per judged round OF THIS TARGET VERSION. */
  trend: number[];
  /** Gap ids present in both of the last two verdicts. */
  /** Named in the last two verdicts: what persisted, reported, not a signal. */
  repeatedGaps: string[];
  /** Named in three verdicts running — survived two rounds of work: the stall signal. */
  stubbornGaps: string[];
  /** null when the last round carries no fps measurement. */
  fpsOk: boolean | null;
  computedAt: string;
}

/** Exactly what `lucid.json` holds. */
export interface LoopFile {
  format: typeof LUCID_FORMAT;
  title: string;
  /** The user's original direction, verbatim — the judge and any re-dream read it. */
  brief: string;
  status: LoopStatus;
  createdAt: string;
  updatedAt: string;
  fpsTarget: number;
  budget: BudgetState | null;
  target: TargetState;
  rounds: RoundRecord[];
  assets: AssetEntry[];
  evaluation: LoopEvaluation | null;
}

// ── Viewer-side shapes ──────────────────────────────────────────────────────

/** One project as the viewer sees it: the file plus where it lives and what
 *  the loader could not trust about it. */
export interface Loop extends LoopFile {
  /** Content-set prefix (`"lantern-shrine"`, or `""` for a root-level project). */
  dir: string;
  /** Loader-level caveats (missing fields defaulted, unknown format version). */
  warnings: string[];
}

export interface Loops {
  projects: Record<string, Loop>;
}

// ── Load / save ─────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const LOOP_STATUSES: ReadonlySet<string> = new Set(["dreaming", "looping", "done", "stalled"]);
const EXIT_STATES: ReadonlySet<string> = new Set([
  "dreaming", "continue", "done", "optimize-fps", "stall-approaching", "stalled", "budget-exhausted",
]);
const GAP_AREAS: ReadonlySet<string> = new Set(["composition", "lighting", "materials", "details"]);
const ASSET_ROLES: ReadonlySet<string> = new Set(["hero", "prop", "environment"]);
const ASSET_SOURCES: ReadonlySet<string> = new Set(["image-to-3d", "blender", "procedural", "user"]);
const ASSET_STATES: ReadonlySet<string> = new Set(["planned", "generating", "ready", "placed", "failed"]);

function parseGap(raw: unknown): Gap | null {
  if (!isRecord(raw)) return null;
  const area = asString(raw.area, "");
  if (!GAP_AREAS.has(area)) return null;
  const issue = asString(raw.issue, "");
  if (!issue) return null;
  return {
    id: asString(raw.id, issue.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)),
    area: area as GapArea,
    issue,
    fix: asString(raw.fix, ""),
  };
}

function parseVerdict(raw: unknown): Verdict | null {
  if (!isRecord(raw)) return null;
  const composition = asNumber(raw.composition, 0);
  const lighting = asNumber(raw.lighting, 0);
  const materials = asNumber(raw.materials, 0);
  const details = asNumber(raw.details, 0);
  const gaps = Array.isArray(raw.gaps)
    ? raw.gaps.map(parseGap).filter((g): g is Gap => g !== null)
    : [];
  return {
    composition,
    lighting,
    materials,
    details,
    total: asNumber(raw.total, composition + lighting + materials + details),
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    gaps,
    judgedAt: asString(raw.judgedAt, ""),
  };
}

function parseRound(raw: unknown, position: number): RoundRecord | null {
  if (!isRecord(raw)) return null;
  const kind = asString(raw.kind, "iterate");
  return {
    index: asNumber(raw.index, position + 1),
    kind: kind === "rethink" ? "rethink" : "iterate",
    // A file written before `targetVersion` existed could not record a target
    // replacement per round, so its rounds read as the first target's.
    targetVersion: asNumber(raw.targetVersion, 1),
    at: asString(raw.at, ""),
    capture: asNullableString(raw.capture),
    fps: asNullableNumber(raw.fps),
    note: typeof raw.note === "string" ? raw.note : undefined,
    verdict: parseVerdict(raw.verdict),
  };
}

function parseAsset(raw: unknown): AssetEntry | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id, "");
  if (!id) return null;
  const role = asString(raw.role, "prop");
  const source = asString(raw.source, "procedural");
  const state = asString(raw.state, "planned");
  return {
    id,
    role: (ASSET_ROLES.has(role) ? role : "prop") as AssetRole,
    source: (ASSET_SOURCES.has(source) ? source : "procedural") as AssetSource,
    state: (ASSET_STATES.has(state) ? state : "planned") as AssetState,
    files: Array.isArray(raw.files) ? raw.files.filter((f): f is string => typeof f === "string") : [],
    note: typeof raw.note === "string" ? raw.note : undefined,
    updatedAt: asString(raw.updatedAt, ""),
  };
}

function parseEvaluation(raw: unknown): LoopEvaluation | null {
  if (!isRecord(raw)) return null;
  const exit = asString(raw.exit, "");
  if (!EXIT_STATES.has(exit)) return null;
  const point = (value: unknown): { index: number; total: number } | null =>
    isRecord(value) ? { index: asNumber(value.index, 0), total: asNumber(value.total, 0) } : null;
  return {
    exit: exit as ExitState,
    reasons: Array.isArray(raw.reasons) ? raw.reasons.filter((r): r is string => typeof r === "string") : [],
    targetVersion: asNumber(raw.targetVersion, 1),
    best: point(raw.best),
    last: point(raw.last),
    trend: Array.isArray(raw.trend) ? raw.trend.filter((t): t is number => typeof t === "number") : [],
    repeatedGaps: Array.isArray(raw.repeatedGaps)
      ? raw.repeatedGaps.filter((g): g is string => typeof g === "string")
      : [],
    stubbornGaps: Array.isArray(raw.stubbornGaps)
      ? raw.stubbornGaps.filter((g): g is string => typeof g === "string")
      : [],
    fpsOk: typeof raw.fpsOk === "boolean" ? raw.fpsOk : null,
    computedAt: asString(raw.computedAt, ""),
  };
}

/**
 * Parse one `lucid.json` text into a `Loop`. Returns null when the text is not
 * JSON or not a lucid project at all; otherwise defaults missing fields and
 * records what it defaulted in `warnings`.
 */
export function parseLoop(dir: string, text: string): Loop | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const warnings: string[] = [];
  if (raw.format !== LUCID_FORMAT) {
    if (typeof raw.format !== "string") return null;
    warnings.push(`unknown format "${raw.format}", read as ${LUCID_FORMAT}`);
  }
  const status = asString(raw.status, "dreaming");
  if (!LOOP_STATUSES.has(status)) warnings.push(`unknown status "${status}", shown as dreaming`);

  const targetRaw = isRecord(raw.target) ? raw.target : {};
  const target: TargetState = {
    path: asNullableString(targetRaw.path),
    version: asNumber(targetRaw.version, 0),
    lockedAt: asNullableString(targetRaw.lockedAt),
    history: Array.isArray(targetRaw.history)
      ? targetRaw.history
          .filter(isRecord)
          .map((h) => ({
            version: asNumber(h.version, 0),
            path: asString(h.path, ""),
            replacedAt: asString(h.replacedAt, ""),
            reason: typeof h.reason === "string" ? h.reason : undefined,
          }))
          .filter((h) => h.path.length > 0)
      : [],
  };

  const budget: BudgetState | null = isRecord(raw.budget)
    ? {
        minutes: asNumber(raw.budget.minutes, 0),
        startedAt: asNullableString(raw.budget.startedAt),
        ...(typeof raw.budget.pausedMinutes === "number" && Number.isFinite(raw.budget.pausedMinutes) && raw.budget.pausedMinutes > 0
          ? { pausedMinutes: raw.budget.pausedMinutes }
          : {}),
      }
    : null;

  const rounds = Array.isArray(raw.rounds)
    ? raw.rounds.map(parseRound).filter((r): r is RoundRecord => r !== null)
    : [];
  if (!Array.isArray(raw.rounds)) warnings.push("rounds missing, shown as none");

  return {
    format: LUCID_FORMAT,
    title: asString(raw.title, dir || "Untitled"),
    brief: asString(raw.brief, ""),
    status: (LOOP_STATUSES.has(status) ? status : "dreaming") as LoopStatus,
    createdAt: asString(raw.createdAt, ""),
    updatedAt: asString(raw.updatedAt, ""),
    fpsTarget: asNumber(raw.fpsTarget, 60),
    budget,
    target,
    rounds,
    assets: Array.isArray(raw.assets)
      ? raw.assets.map(parseAsset).filter((a): a is AssetEntry => a !== null)
      : [],
    evaluation: parseEvaluation(raw.evaluation),
    dir,
    warnings,
  };
}

/** Content-set prefix for a `lucid.json` path, or null when the path is not one. */
export function projectDirOf(path: string): string | null {
  if (path === LUCID_MANIFEST) return "";
  const suffix = `/${LUCID_MANIFEST}`;
  if (!path.endsWith(suffix)) return null;
  const dir = path.slice(0, -suffix.length);
  // Only a direct top-level directory is a content set; `a/b/lucid.json` is
  // not a project (it would be invisible to the content-set resolver).
  if (dir.includes("/") || dir.startsWith(".")) return null;
  return dir;
}

export function loadLoops(files: ReadonlyArray<ViewerFileContent>): Loops | null {
  const projects: Record<string, Loop> = {};
  for (const file of files) {
    const dir = projectDirOf(file.path);
    if (dir === null) continue;
    const loop = parseLoop(dir, file.content);
    if (loop) projects[dir] = loop;
  }
  return { projects };
}

export function saveLoops(
  _next: Loops,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  throw new Error("lucid viewer is read-only; lucid.json is written by scripts/lucid.mjs");
}

// ── Helpers the viewer and extractContext share ────────────────────────────

/** Minutes left on the budget at `now`, or null when no budget / not started. */
export function budgetRemainingMinutes(loop: Loop, now: Date = new Date()): number | null {
  if (!loop.budget || !loop.budget.startedAt) return null;
  const started = Date.parse(loop.budget.startedAt);
  if (!Number.isFinite(started)) return null;
  const elapsed = (now.getTime() - started) / 60_000 - (loop.budget.pausedMinutes ?? 0);
  return Math.max(0, loop.budget.minutes - Math.max(0, elapsed));
}

/**
 * The highest-scoring judged round, or null before the first verdict. This
 * spans EVERY target version, because the rail shows every round; the exit
 * rules' own "best" (`evaluation.best`) counts only the current target's
 * rounds and is the one to quote when talking about the trajectory.
 */
export function bestRound(loop: Loop): RoundRecord | null {
  let best: RoundRecord | null = null;
  for (const round of loop.rounds) {
    if (!round.verdict) continue;
    if (!best || !best.verdict || round.verdict.total > best.verdict.total) best = round;
  }
  return best;
}
