#!/usr/bin/env node
/**
 * lucid.mjs — the only writer of `<project>/lucid.json`.
 *
 * The loop this script owns: a locked TARGET (the dream, a generated
 * screenshot), N ROUNDS (one live capture of the scene plus one judge
 * verdict), and an ASSET LEDGER. Its job is to make the loop's bookkeeping
 * and its EXIT RULES deterministic. The agent does not remember the history
 * and decide whether to stop — it asks `status`, which recomputes the rules
 * from the file every time. (`.claude/references/mode-gotchas.md` →
 * "Workflow execution and recovery": the inner loop a user is waiting on has
 * to be a program; prose about when to stop is a rule nobody enforces.)
 *
 * On-disk contract: exactly the `LoopFile` type in `modes/lucid/domain.ts`
 * (`format: "pneuma-lucid/v1"`). Every mutation rewrites the whole file
 * atomically (scratch file + rename), bumps `updatedAt`, and recomputes
 * `evaluation` and `status`, so a rejected command leaves the previous
 * project exactly as it was.
 *
 * Zero npm dependencies: Node 22+ built-ins, plus `npm` and `tar` for the
 * one subcommand that vendors three.js.
 */

import { spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

const LUCID_FORMAT = "pneuma-lucid/v1";
const MANIFEST = "lucid.json";
const DEFAULT_FPS_TARGET = 60;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ROUND_KINDS = ["iterate", "rethink"];
const GAP_AREAS = ["composition", "lighting", "materials", "details"];
const ASSET_ROLES = ["hero", "prop", "environment"];
const ASSET_SOURCES = ["image-to-3d", "blender", "procedural", "user"];
const ASSET_STATES = ["planned", "generating", "ready", "placed", "failed"];

/** The six files a scene needs from one three.js release, and where they
 *  live inside the npm tarball's `package/` root. Since three 0.167 the build
 *  is split: `three.module.js` re-exports `./three.core.js`, so a vendor
 *  directory without the core file 404s on the page's first import and the
 *  scene dies before `main.js` runs (measured 2026-09-16 on 0.186.0). */
const VENDOR_FILES = [
  { from: "build/three.module.js", to: "three.module.js" },
  { from: "build/three.core.js", to: "three.core.js" },
  { from: "examples/jsm/loaders/GLTFLoader.js", to: "addons/loaders/GLTFLoader.js" },
  { from: "examples/jsm/controls/OrbitControls.js", to: "addons/controls/OrbitControls.js" },
  { from: "examples/jsm/utils/BufferGeometryUtils.js", to: "addons/utils/BufferGeometryUtils.js" },
  { from: "examples/jsm/utils/SkeletonUtils.js", to: "addons/utils/SkeletonUtils.js" },
];

const SUBCOMMANDS = [
  "init", "vendor-three", "target", "round", "verdict",
  "status", "budget", "asset", "judge-prompt", "bridge",
];

// ---------------------------------------------------------------------------
// THE RULES — verdict validation and the exit criteria
//
// Everything that decides "is this verdict well-formed" and "should the loop
// stop" lives in this one section, as named constants plus two pure
// functions. Both are transcribed from achimala/dream-loop (MIT); see
// NOTICE.md. Nothing else in this file re-implements a threshold.
// ---------------------------------------------------------------------------

/** Per-area score ceilings. Composition/lighting/materials 0–3, details 0–1,
 *  fractions allowed — 10 points in total. */
const SCORE_MAX = { composition: 3, lighting: 3, materials: 3, details: 1 };

/** A verdict at or above this total is "close enough to the dream". */
const DONE_TOTAL = 8;

/** Measured fps counts as acceptable at 90% of the project's fps target. */
const FPS_OK_RATIO = 0.9;

/** How much the score must gain across the stall window to count as progress. */
const STALL_MIN_GAIN = 1.0;

/** How many judged rounds the score-plateau test needs before it can fire. */
const STALL_MIN_ROUNDS = 3;

/** How many recent rounds the plateau test looks at. */
const STALL_WINDOW = 2;

/** How far the judge's own arithmetic may drift from the sum before we say so. */
const TOTAL_TOLERANCE = 0.05;

/**
 * The judge's brief, transcribed from achimala/dream-loop's pro-mode workflow
 * (MIT, commit 9bddb90). It is ONE constant so `NOTICE.md` can point at a
 * line range, and so no caller can paraphrase it into something softer.
 */
export const JUDGE_RUBRIC = `You are judging how close the current product is relative to the target image.
Score along this rubric:

- **Composition (0-3):** Are the camera, framing, and layout correct? Are the
  position and scale of all major components correct compared to the target
  image?
- **Lighting (0-3):** Check color palette, exposure, shadows, contrast, and
  atmosphere. Pay attention to reflections, glows, etc. Ensure the scene
  overall is not too dark or too light compared to the target.
- **Materials (0-3):** Check that every surface looks right, with the expected
  textures, roughness, translucency, wetness, etc. Ensure assets don't look
  blocky, plasticky, smooth, or fake, unless the target image specifically
  also does this.
- **Details (0-1):** Go through everything with a fine-toothed comb. Not a
  single pixel should be different. Every tiny speck and detail should match
  between the two images.

You can give fractional scores. You should be nitpicky and precise, and
include a list of all gaps and blockers that need to be resolved for a perfect
score on each category. It's OK to output a gigantic list if the current
product is nowhere close to the target. It needs to be comprehensive and
actionable so that another agent could go fix everything on the list, come
back, and get a substantially improved score. Avoid non-actionable feedback
like "This tree looks fake." You need to name exactly what's giving that
impression and how the agent should fix it.

Everything is within reason. If models or scenes need to be completely
redesigned, say so. Don't sugarcoat it. The goal is for both images to be
identical. The product should exactly reach the target. Do not settle for
less.

You should lastly also provide a total score out of 10 by summing these up.

If a previous verdict and screenshot are provided, maintain consistency with
prior judgment, but do not feel obligated to match or increase score. If the
product regressed, it should score worse.`;

/** The exact JSON the judge must answer with. */
const JUDGE_SCHEMA = `{
  "composition": 0.0,            // 0-3, fractions allowed
  "lighting": 0.0,               // 0-3
  "materials": 0.0,              // 0-3
  "details": 0.0,                // 0-1
  "total": 0.0,                  // the sum of the four, out of 10
  "summary": "one paragraph: what is closest, what is furthest",
  "gaps": [
    {
      "id": "kebab-case-slug",   // stable across rounds; REUSE it when the gap persists
      "area": "composition",     // composition | lighting | materials | details
      "issue": "what is different from the target, concretely",
      "fix": "what the builder should change, concretely"
    }
  ]
}`;

/** One line of what to do next, per exit state. */
const ADVICE = {
  dreaming:
    "No target yet. Generate the dream screenshot and lock it with `lucid.mjs target <dir> --set <png>`. Any budget is already counting — it started when the user asked, and dreaming spends it.",
  continue:
    "Keep looping: fix the gaps the judge named, capture the scene, judge again.",
  done:
    "Done. Show the user the latest capture beside the target and ask whether they want more rounds.",
  "optimize-fps":
    "The look is there but the frame budget is not. Take the lossless wins first, then the low-visual-impact ones, and re-judge to prove you did not regress.",
  "stall-approaching":
    "Stop tweaking. Step back and find the architectural reason the scene is not reaching the target, then record that round with --kind rethink.",
  stalled:
    "The redesign did not move the score. Do not spend more tokens guessing — show the user where it stands and ask them to weigh in.",
  "budget-exhausted":
    "The time budget is spent. Show the user the best round against the target and ask whether to continue.",
};

/**
 * Validate one judge verdict and return it in `Verdict` shape.
 *
 * `total` is RECOMPUTED as the sum of the four areas: the score trajectory is
 * the loop's only measure of progress, so it cannot depend on a language
 * model's arithmetic. A disagreement beyond TOTAL_TOLERANCE is reported back
 * as a warning rather than swallowed.
 *
 * @returns {{ verdict: object, warnings: string[] }}
 */
function validateVerdict(raw, judgedAt) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("verdict must be a JSON object");
  }
  const warnings = [];
  const scores = {};
  for (const [area, max] of Object.entries(SCORE_MAX)) {
    const value = raw[area];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(`verdict.${area} must be a number (0-${max})`);
    }
    if (value < 0 || value > max) {
      fail(`verdict.${area} is ${value}, outside the rubric's 0-${max} range`);
    }
    scores[area] = value;
  }
  const total = round2(
    scores.composition + scores.lighting + scores.materials + scores.details,
  );
  if (typeof raw.total === "number" && Number.isFinite(raw.total)) {
    if (Math.abs(raw.total - total) > TOTAL_TOLERANCE) {
      warnings.push(
        `judge reported total ${raw.total} but the four areas sum to ${total}; stored ${total}`,
      );
    }
  } else {
    warnings.push(`verdict had no numeric total; stored the sum ${total}`);
  }

  const rawGaps = raw.gaps === undefined ? [] : raw.gaps;
  if (!Array.isArray(rawGaps)) fail("verdict.gaps must be an array");
  const seen = new Set();
  const gaps = rawGaps.map((gap, i) => {
    if (!gap || typeof gap !== "object" || Array.isArray(gap)) {
      fail(`verdict.gaps[${i}] must be an object`);
    }
    if (!GAP_AREAS.includes(gap.area)) {
      fail(`verdict.gaps[${i}].area must be one of ${GAP_AREAS.join("|")}`);
    }
    const issue = typeof gap.issue === "string" ? gap.issue.trim() : "";
    if (!issue) fail(`verdict.gaps[${i}].issue is required`);
    let id = typeof gap.id === "string" ? slug(gap.id) : "";
    if (!id) {
      id = slug(issue) || `gap-${i + 1}`;
      warnings.push(`verdict.gaps[${i}] had no id; slugged "${id}" from its issue`);
    }
    if (seen.has(id)) fail(`verdict.gaps[${i}] repeats gap id "${id}" inside one verdict`);
    seen.add(id);
    return { id, area: gap.area, issue, fix: typeof gap.fix === "string" ? gap.fix.trim() : "" };
  });

  return {
    verdict: {
      composition: scores.composition,
      lighting: scores.lighting,
      materials: scores.materials,
      details: scores.details,
      total,
      ...(typeof raw.summary === "string" && raw.summary.trim()
        ? { summary: raw.summary.trim() }
        : {}),
      gaps,
      judgedAt,
    },
    warnings,
  };
}

/**
 * Compute the loop's exit state. Pure: the same file plus the same `now`
 * always gives the same answer.
 *
 * Only rounds judged against the CURRENT target version are scored. Locking a
 * new target (a re-dream) therefore restarts the trajectory from zero: the old
 * rounds stay in the file and on the rail, but a score earned against a
 * different dream says nothing about this one, and a loop that was `done`
 * must not stay `done` against a target it has never been compared to.
 *
 * `now` is only consulted for the budget, and only when `withClock` is true —
 * the evaluation STORED in lucid.json must be time-independent (a file read
 * an hour later must not claim a state it never had), so mutations store the
 * clockless verdict and `status` re-runs this with the wall clock.
 *
 * @returns {object} a `LoopEvaluation`
 */
function evaluate(loop, now, { withClock = false } = {}) {
  const reasons = [];
  const targetVersion = loop.target.version;
  const judged = loop.rounds.filter((r) => r.verdict && r.targetVersion === targetVersion);
  const superseded = loop.rounds.filter((r) => r.verdict && r.targetVersion !== targetVersion).length;
  const trend = judged.map((r) => r.verdict.total);
  const last = judged.length ? judged[judged.length - 1] : null;

  let bestRound = null;
  for (const r of judged) {
    if (!bestRound || r.verdict.total > bestRound.verdict.total) bestRound = r;
  }

  // Gap ids the judge named in BOTH of the last two verdicts. Ids, not fuzzy
  // text: that is why the judge is told to carry an id forward.
  let repeatedGaps = [];
  if (judged.length >= 2) {
    const a = new Set(judged[judged.length - 2].verdict.gaps.map((g) => g.id));
    repeatedGaps = judged[judged.length - 1].verdict.gaps
      .map((g) => g.id)
      .filter((id) => a.has(id));
  }

  // fps of the last judged round, against the project's target.
  let fpsOk = null;
  if (last && typeof last.fps === "number" && Number.isFinite(last.fps)) {
    fpsOk = last.fps >= FPS_OK_RATIO * loop.fpsTarget;
  }

  const base = {
    reasons,
    targetVersion,
    best: bestRound ? { index: bestRound.index, total: bestRound.verdict.total } : null,
    last: last ? { index: last.index, total: last.verdict.total } : null,
    trend,
    repeatedGaps,
    fpsOk,
    computedAt: now,
  };

  /**
   * `budget-exhausted` when the clock says so, otherwise null. Only `status`
   * passes `withClock`, so the stored evaluation stays time-independent. The
   * reason is pushed onto the same `reasons` array `base` already holds.
   */
  const exhausted = () => {
    if (!withClock || !budgetExhausted(loop, now)) return null;
    reasons.push(budgetReason(loop, now));
    return { exit: "budget-exhausted", ...base };
  };

  if (loop.target.version === 0) {
    reasons.push("no target is locked yet — the loop has nothing to score against");
    return { exit: "dreaming", ...base };
  }
  if (!last) {
    reasons.push(
      superseded > 0
        ? `target v${targetVersion} is locked and nothing has been judged against it yet — the ${superseded} verdict${superseded === 1 ? " scored against an earlier target does" : "s scored against an earlier target do"} not count`
        : "the target is locked but no round has been judged yet",
    );
    // The clock is spent whether or not a verdict exists yet: a loop that
    // burned its budget dreaming and building must not read as "continue".
    return exhausted() ?? { exit: "continue", ...base };
  }

  const fpsBar = round2(FPS_OK_RATIO * loop.fpsTarget);
  const bestBefore = bestTotalBefore(judged, judged.length - 1);

  // ── done / optimize-fps: these win over every stall signal. A scene at the
  // target is finished (or one optimisation pass away from it); telling the
  // agent to redesign it would be worse than useless.
  if (last.verdict.total >= DONE_TOTAL) {
    if (fpsOk === true) {
      reasons.push(
        `round ${last.index} scored ${last.verdict.total}/10 (>= ${DONE_TOTAL}) at ${last.fps} fps (>= ${fpsBar})`,
      );
      return { exit: "done", ...base };
    }
    if (fpsOk === false) {
      reasons.push(
        `round ${last.index} scored ${last.verdict.total}/10 (>= ${DONE_TOTAL}) but ran at ${last.fps} fps, below the ${fpsBar} bar`,
      );
      return { exit: "optimize-fps", ...base };
    }
    reasons.push(
      `round ${last.index} scored ${last.verdict.total}/10 (>= ${DONE_TOTAL}) but fps unmeasured — capture a round with --fps before calling it done`,
    );
    return { exit: "continue", ...base };
  }

  // ── stalled: the big redesign was tried and it did not pay.
  if (last.kind === "rethink" && bestBefore !== null && last.verdict.total <= bestBefore) {
    reasons.push(
      `round ${last.index} was a rethink and scored ${last.verdict.total}/10, no better than the ${bestBefore}/10 before it`,
    );
    return { exit: "stalled", ...base };
  }
  if (judged.length >= 2) {
    const prev = judged[judged.length - 2];
    const prevBest = bestTotalBefore(judged, judged.length - 2);
    const gainless = (r, before) =>
      r.kind === "rethink" && before !== null && r.verdict.total < before + STALL_MIN_GAIN;
    if (gainless(last, bestBefore) && gainless(prev, prevBest)) {
      reasons.push(
        `rounds ${prev.index} and ${last.index} were both rethinks and neither gained a full point`,
      );
      return { exit: "stalled", ...base };
    }
  }

  // ── stall approaching: the score has plateaued, or the judge keeps naming
  // the same gap. Either way small tweaks are not going to close it.
  let approaching = false;
  if (repeatedGaps.length > 0) {
    reasons.push(
      `the judge named the same gap in two verdicts in a row: ${repeatedGaps.join(", ")}`,
    );
    approaching = true;
  }
  if (judged.length >= STALL_MIN_ROUNDS) {
    const recent = judged.slice(-STALL_WINDOW);
    const bestRecent = Math.max(...recent.map((r) => r.verdict.total));
    const before = bestTotalBefore(judged, judged.length - STALL_WINDOW);
    if (before !== null && bestRecent < before + STALL_MIN_GAIN) {
      reasons.push(
        `the best of the last ${STALL_WINDOW} rounds is ${bestRecent}/10, less than a full point over the ${before}/10 before them`,
      );
      approaching = true;
    }
  }
  if (approaching) {
    return exhausted() ?? { exit: "stall-approaching", ...base };
  }

  const spent = exhausted();
  if (spent) return spent;

  reasons.push(
    `round ${last.index} scored ${last.verdict.total}/10; the loop is still gaining`,
  );
  return { exit: "continue", ...base };
}

/** Best total among judged rounds strictly before `index`, or null. */
function bestTotalBefore(judged, index) {
  let best = null;
  for (let i = 0; i < index && i < judged.length; i += 1) {
    const total = judged[i].verdict.total;
    if (best === null || total > best) best = total;
  }
  return best;
}

function elapsedMinutes(loop, now) {
  if (!loop.budget || !loop.budget.startedAt) return null;
  const started = Date.parse(loop.budget.startedAt);
  if (!Number.isFinite(started)) return null;
  return round2(Math.max(0, (Date.parse(now) - started) / 60_000));
}

function budgetExhausted(loop, now) {
  const elapsed = elapsedMinutes(loop, now);
  return elapsed !== null && elapsed >= loop.budget.minutes;
}

function budgetReason(loop, now) {
  return `the ${loop.budget.minutes}-minute budget is spent (${elapsedMinutes(loop, now)} minutes elapsed)`;
}

/** The project's coarse status, derived from the exit state so the file has
 *  one authority for "where is this loop". `budget-exhausted` never lands
 *  here: it is a fact about the clock, not about the work. */
function statusFor(loop, evaluation) {
  if (loop.target.version === 0) return "dreaming";
  if (evaluation.exit === "done") return "done";
  if (evaluation.exit === "stalled") return "stalled";
  return "looping";
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

function manifestPath(dir) {
  return join(resolve(dir), MANIFEST);
}

function loadLoop(dir) {
  const path = manifestPath(dir);
  if (!existsSync(path)) {
    fail(`no ${MANIFEST} in ${resolve(dir)} — run 'lucid.mjs init <dir> --title … --brief …' first`);
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail(`${path} is not a JSON object`);
  if (doc.format !== LUCID_FORMAT) {
    fail(`${path} has format "${doc.format}", expected "${LUCID_FORMAT}"`);
  }
  doc.rounds ??= [];
  doc.assets ??= [];
  doc.target ??= { path: null, version: 0, lockedAt: null, history: [] };
  doc.target.history ??= [];
  doc.budget ??= null;
  doc.rounds = doc.rounds.map(normalizeRound);
  return doc;
}

/** Key order for the manifest, so diffs stay readable whichever command wrote it. */
const LOOP_KEYS = [
  "format", "title", "brief", "status", "createdAt", "updatedAt",
  "fpsTarget", "budget", "target", "rounds", "assets", "evaluation",
];

/** Key order for one round, same reason. */
const ROUND_KEYS = ["index", "kind", "targetVersion", "at", "capture", "fps", "note", "verdict"];

/** Write the listed keys first, in order, then anything else the object holds. */
function inKeyOrder(value, keys) {
  const ordered = {};
  for (const key of keys) if (value[key] !== undefined) ordered[key] = value[key];
  for (const key of Object.keys(value)) if (ordered[key] === undefined) ordered[key] = value[key];
  return ordered;
}

/**
 * One round as this version of the script writes it.
 *
 * A file written before `targetVersion` existed had no way to record a target
 * replacement per round, so its rounds read as the FIRST target's — the same
 * default `domain.ts` applies. On a project that was re-dreamed under the old
 * script that is the conservative reading: those verdicts stop counting rather
 * than being credited to a dream they may never have been compared against.
 * The next mutation persists the field, so a file upgrades itself once.
 */
function normalizeRound(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const round = { ...raw };
  if (typeof round.targetVersion !== "number" || !Number.isFinite(round.targetVersion)) {
    round.targetVersion = 1;
  }
  return inKeyOrder(round, ROUND_KEYS);
}

/**
 * Recompute the derived fields and rewrite the whole file atomically.
 * Scratch + rename: the viewer polls this file while the loop runs, so it
 * must never observe a half-written manifest.
 */
function saveLoop(dir, loop, now) {
  loop.updatedAt = now;
  loop.evaluation = evaluate(loop, now);
  loop.status = statusFor(loop, loop.evaluation);

  const ordered = inKeyOrder(loop, LOOP_KEYS);

  const path = manifestPath(dir);
  const scratch = `${path}.tmp`;
  try {
    try {
      writeFileSync(scratch, `${JSON.stringify(ordered, null, 2)}\n`);
      renameSync(scratch, path);
    } finally {
      if (existsSync(scratch)) rmSync(scratch, { force: true });
    }
  } catch (error) {
    fail(`cannot write ${path}: ${error.message}`);
  }
  return ordered;
}

/** Resolve an input path: absolute as given (the framework's `capture` action
 *  returns an absolute path under the session directory), otherwise relative
 *  to the CURRENT directory — the workspace root. This script never cds. */
function resolveInput(path) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function requirePng(path, label) {
  const abs = resolveInput(path);
  if (!existsSync(abs)) fail(`${label}: file not found: ${abs}`);
  let head = Buffer.alloc(8);
  let read = 0;
  try {
    const fd = openSync(abs, "r");
    try {
      read = readSync(fd, head, 0, 8, 0);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    fail(`${label}: cannot read ${abs}: ${error.message}`);
  }
  if (read < 8 || !head.subarray(0, 8).equals(PNG_MAGIC)) {
    fail(`${label}: ${abs} is not a PNG (bad magic bytes)`);
  }
  return abs;
}

/** Copy into the project, creating the parent directory. Returns the
 *  project-relative path that goes into the manifest. */
function copyInto(dir, sourceAbs, relPath) {
  const destination = join(resolve(dir), relPath);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(sourceAbs, destination);
  return relPath;
}

/** Project-relative form of a ledger file path. Relative input is taken as
 *  already project-relative; absolute input must be inside the project. */
function projectRelative(dir, path, label) {
  if (!isAbsolute(path)) return path.split(sep).join("/");
  const root = resolve(dir);
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    fail(`${label}: ${path} is outside the project directory ${root}`);
  }
  return rel.split(sep).join("/");
}

function readJsonArg(value, label) {
  const text = value === "-" ? readFileSync(0, "utf-8") : readFileSync(resolveInput(value), "utf-8");
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label}: not valid JSON (${error.message})`);
  }
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify({ ok: true, ...payload }, null, 2)}\n`);
}

function num(value, label, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${label} must be a number, got "${value}"`);
  if (n < min || n > max) fail(`${label} must be between ${min} and ${max}, got ${n}`);
  return n;
}

function requireOneOf(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} must be one of ${allowed.join("|")}, got "${value}"`);
  return value;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Where `judge-prompt` writes round N's brief, absolute. */
function briefPath(dir, index) {
  return join(resolve(dir), "rounds", pad2(index), "judge-brief.md");
}

/** Where the judge is told to write round N's verdict, absolute. It is also
 *  what `verdict --round N` reads when no --file is given, so the two commands
 *  agree on one path instead of on an instruction the agent has to remember. */
function verdictPath(dir, index) {
  return join(resolve(dir), "rounds", pad2(index), "verdict.json");
}

// ---------------------------------------------------------------------------
// three.js vendoring
// ---------------------------------------------------------------------------

function vendorDir(dir) {
  return join(resolve(dir), "scene", "vendor");
}

/**
 * What the scene's vendor directory currently holds. A directory missing any
 * of the five files (or VERSION) is reported as NOT ok — a half-vendored
 * directory breaks the importmap exactly like an empty one, so it must not
 * read as "three.js is there".
 */
function vendorReport(dir) {
  const root = vendorDir(dir);
  const missing = VENDOR_FILES.map((f) => f.to).filter((rel) => !existsSync(join(root, rel)));
  const versionFile = join(root, "VERSION");
  const hasVersion = existsSync(versionFile);
  if (!hasVersion) missing.push("VERSION");
  return {
    ok: missing.length === 0,
    version: hasVersion ? readFileSync(versionFile, "utf-8").trim() : null,
    missing,
  };
}

function npmRun(args, label) {
  const r = spawnSync("npm", args, { encoding: "utf-8" });
  if (r.error) throw new Error(`${label}: cannot run npm (${r.error.message})`);
  if (r.status !== 0) {
    const tail = String(r.stderr || "").trim().split("\n").slice(-3).join(" ");
    throw new Error(`${label}: npm ${args.join(" ")} failed (exit ${r.status}) ${tail}`);
  }
  return String(r.stdout);
}

/**
 * Vendor exactly six files from ONE three.js release.
 *
 * Staged into `scene/vendor.incoming` and verified complete before the live
 * directory is replaced, so a failed or offline run can never leave a mixed
 * vendor directory behind — the previous (working) version stays put.
 */
function vendorThree(dir, version) {
  const scene = join(resolve(dir), "scene");
  mkdirSync(scene, { recursive: true });
  const resolved = version || npmRun(["view", "three", "version"], "vendor-three").trim();
  if (!/^\d+\.\d+\.\d+/.test(resolved)) {
    throw new Error(`vendor-three: "${resolved}" does not look like a three.js version`);
  }

  const temp = mkdtempSync(join(tmpdir(), "lucid-three-"));
  const staging = join(scene, "vendor.incoming");
  try {
    rmSync(staging, { recursive: true, force: true });
    const packed = npmRun(
      ["pack", `three@${resolved}`, "--pack-destination", temp, "--loglevel", "error"],
      "vendor-three",
    );
    const tarball = packed.trim().split("\n").filter(Boolean).pop();
    if (!tarball) throw new Error("vendor-three: npm pack printed no tarball name");
    const tarPath = join(temp, basename(tarball.trim()));
    if (!existsSync(tarPath)) throw new Error(`vendor-three: npm pack produced no ${tarPath}`);

    const untar = spawnSync("tar", ["-xzf", tarPath, "-C", temp], { encoding: "utf-8" });
    if (untar.error) throw new Error(`vendor-three: cannot run tar (${untar.error.message})`);
    if (untar.status !== 0) {
      throw new Error(`vendor-three: tar failed (exit ${untar.status}) ${String(untar.stderr || "").trim()}`);
    }

    const root = join(temp, "package");
    for (const file of VENDOR_FILES) {
      const source = join(root, file.from);
      if (!existsSync(source)) {
        throw new Error(`vendor-three: three@${resolved} has no ${file.from} — nothing was written`);
      }
      const destination = join(staging, file.to);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
    writeFileSync(join(staging, "VERSION"), `${resolved}\n`);

    // All five landed: swap the staged directory in.
    rmSync(vendorDir(dir), { recursive: true, force: true });
    renameSync(staging, vendorDir(dir));
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
  }
  return { ok: true, version: resolved, files: VENDOR_FILES.map((f) => f.to).concat("VERSION") };
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function copyStarter(dir) {
  const scene = join(resolve(dir), "scene");
  mkdirSync(scene, { recursive: true });
  const created = [];
  const kept = [];
  const sources = [
    { from: join(HERE, "scene-starter", "index.html"), to: "index.html" },
    { from: join(HERE, "scene-starter", "main.js"), to: "main.js" },
    { from: join(HERE, "lucid-bridge.js"), to: "lucid-bridge.js" },
  ];
  for (const source of sources) {
    if (!existsSync(source.from)) fail(`starter file missing from the skill: ${source.from}`);
    const destination = join(scene, source.to);
    // Never clobber a scene the agent already wrote: `init` refuses an
    // existing lucid.json, but a directory can still hold earlier work.
    if (existsSync(destination)) {
      kept.push(`scene/${source.to}`);
      continue;
    }
    copyFileSync(source.from, destination);
    created.push(`scene/${source.to}`);
  }
  return { created, kept };
}

function cmdInit(dir, opts, now) {
  if (!opts.title) fail("init needs --title");
  if (!opts.brief) fail("init needs --brief");
  if (existsSync(manifestPath(dir))) {
    fail(`${manifestPath(dir)} already exists — refusing to overwrite a loop in progress`);
  }
  const fpsTarget = opts["fps-target"] === undefined
    ? DEFAULT_FPS_TARGET
    : num(opts["fps-target"], "--fps-target", { min: 1, max: 480 });
  const budgetMinutes = opts["budget-minutes"] === undefined
    ? null
    : num(opts["budget-minutes"], "--budget-minutes", { min: 0 });

  for (const sub of ["", "rounds", "assets", "scene"]) {
    mkdirSync(join(resolve(dir), sub), { recursive: true });
  }
  const starter = copyStarter(dir);

  const loop = {
    format: LUCID_FORMAT,
    title: opts.title,
    brief: opts.brief,
    status: "dreaming",
    createdAt: now,
    updatedAt: now,
    fpsTarget,
    // The clock starts HERE, not at the first target lock: the user who said
    // "45 minutes" started counting when they asked, and dreaming the target
    // spends that time like everything else.
    budget: budgetMinutes ? { minutes: budgetMinutes, startedAt: now } : null,
    target: { path: null, version: 0, lockedAt: null, history: [] },
    rounds: [],
    assets: [],
    evaluation: null,
  };
  saveLoop(dir, loop, now);

  // `ok: false` is the honest report either way — three.js is not on disk —
  // but the reason says whether anything went wrong or you asked for this.
  let vendor = { ok: false, skipped: true, reason: "--no-vendor", error: null };
  if (!opts["no-vendor"]) {
    try {
      vendor = vendorThree(dir, opts.version);
    } catch (error) {
      // A vendoring failure is a REPORTED outcome, not a failed init: the
      // project and the scene exist, and `vendor-three` can be re-run once
      // the network is back.
      vendor = { ok: false, skipped: false, error: error.message };
    }
  }

  emit({
    dir: resolve(dir),
    manifest: manifestPath(dir),
    created: ["rounds/", "assets/", "scene/", ...starter.created],
    kept: starter.kept,
    fpsTarget,
    budgetMinutes,
    vendor,
    next: "Generate the dream target, then lock it: lucid.mjs target <dir> --set <png>",
  });
}

function cmdVendorThree(dir, opts) {
  if (!existsSync(manifestPath(dir))) {
    fail(`no ${MANIFEST} in ${resolve(dir)} — vendor-three vendors into an existing project`);
  }
  let result;
  try {
    result = vendorThree(dir, opts.version);
  } catch (error) {
    fail(error.message);
  }
  emit({ dir: resolve(dir), vendor: result, vendorDir: vendorDir(dir) });
}

function cmdTarget(dir, opts, now) {
  if (!opts.set) fail("target needs --set <png>");
  const loop = loadLoop(dir);
  const source = requirePng(opts.set, "--set");

  const previousVersion = loop.target.version;
  const archived = [];
  if (previousVersion > 0 && loop.target.path) {
    const current = join(resolve(dir), loop.target.path);
    if (existsSync(current)) {
      const archivePath = `target-history/v${previousVersion}.png`;
      mkdirSync(join(resolve(dir), "target-history"), { recursive: true });
      copyFileSync(current, join(resolve(dir), archivePath));
      loop.target.history.push({
        version: previousVersion,
        path: archivePath,
        replacedAt: now,
        ...(opts.reason ? { reason: opts.reason } : {}),
      });
      archived.push(archivePath);
    }
  }

  copyInto(dir, source, "target.png");
  loop.target.path = "target.png";
  loop.target.version = previousVersion + 1;
  loop.target.lockedAt = now;

  // The lock does NOT touch the budget clock: the clock belongs to the user's
  // request (`init --budget-minutes` / `budget --minutes`), and a target that
  // took ten minutes to dream has already spent ten minutes of it.
  const firstLock = previousVersion === 0;

  // Every verdict so far was scored against the OLD dream. The rounds stay on
  // disk and on the rail, but saveLoop's recomputed evaluation no longer counts
  // them: the trajectory restarts at zero against the new target.
  const supersededRounds = loop.rounds.filter(
    (r) => r.verdict && r.targetVersion !== loop.target.version,
  ).length;

  const saved = saveLoop(dir, loop, now);
  emit({
    dir: resolve(dir),
    target: saved.target,
    firstLock,
    archived,
    supersededRounds,
    status: saved.status,
    budget: saved.budget,
    evaluation: saved.evaluation,
    advice: ADVICE[saved.evaluation.exit],
  });
}

function cmdRound(dir, action, opts, now) {
  if (action !== "add") fail(`round: unknown action "${action ?? ""}" (expected: add)`);
  if (!opts.capture) fail("round add needs --capture <png>");
  const loop = loadLoop(dir);
  if (loop.target.version === 0) {
    fail("no target is locked — run 'lucid.mjs target <dir> --set <png>' before recording a round");
  }
  const source = requirePng(opts.capture, "--capture");
  const kind = opts.kind === undefined ? "iterate" : requireOneOf(opts.kind, ROUND_KINDS, "--kind");
  const fps = opts.fps === undefined ? null : round2(num(opts.fps, "--fps", { min: 0, max: 10_000 }));

  // Validate the verdict BEFORE anything is copied, so a malformed one leaves
  // no half-made round directory behind.
  let verdict = null;
  let warnings = [];
  if (opts.verdict !== undefined) {
    const validated = validateVerdict(readJsonArg(opts.verdict, "--verdict"), now);
    verdict = validated.verdict;
    warnings = validated.warnings;
  }

  const index = loop.rounds.length + 1;
  const capture = copyInto(dir, source, `rounds/${pad2(index)}/capture.png`);
  const record = {
    index,
    kind,
    // Which dream this round was shot against. The exit rules score only the
    // rounds whose version matches the locked target, so a re-dream restarts
    // the trajectory instead of inheriting one earned against another image.
    targetVersion: loop.target.version,
    at: now,
    capture,
    fps,
    ...(opts.note ? { note: opts.note } : {}),
    verdict,
  };
  loop.rounds.push(record);

  const saved = saveLoop(dir, loop, now);
  emit({
    dir: resolve(dir),
    round: saved.rounds[index - 1],
    capturePath: join(resolve(dir), capture),
    warnings,
    status: saved.status,
    evaluation: saved.evaluation,
    advice: ADVICE[saved.evaluation.exit],
  });
}

function cmdVerdict(dir, opts, now) {
  if (opts.round === undefined) fail("verdict needs --round N");
  const loop = loadLoop(dir);
  const index = num(opts.round, "--round", { min: 1 });
  const record = loop.rounds.find((r) => r.index === index);
  if (!record) {
    fail(`no round ${index} in ${manifestPath(dir)} (${loop.rounds.length} recorded)`);
  }
  if (record.verdict && !opts.replace) {
    fail(`round ${index} already has a verdict (${record.verdict.total}/10) — pass --replace to overwrite it`);
  }
  // No --file: read the path the judge brief told the judge to write to.
  // Ingesting by path is what keeps a hand-copied verdict from being retyped
  // (and mistyped) on its way into the loop.
  const fallback = verdictPath(dir, index);
  const file = opts.file ?? (existsSync(fallback) ? fallback : null);
  if (file === null) {
    fail(
      `verdict needs --file <json|-> ('-' reads stdin), or a judge verdict at ${fallback} (that file does not exist)`,
    );
  }
  const replaced = Boolean(record.verdict);
  // Name the source the caller actually used, so "not valid JSON" points at
  // the judge's file rather than at a flag nobody passed.
  const label = opts.file === undefined ? relative(resolve(dir), fallback).split(sep).join("/") : "--file";
  const validated = validateVerdict(readJsonArg(file, label), now);
  record.verdict = validated.verdict;

  const saved = saveLoop(dir, loop, now);
  emit({
    dir: resolve(dir),
    round: saved.rounds.find((r) => r.index === index),
    source: file === "-" ? "stdin" : resolveInput(file),
    replaced,
    warnings: validated.warnings,
    status: saved.status,
    evaluation: saved.evaluation,
    advice: ADVICE[saved.evaluation.exit],
  });
}

function cmdStatus(dir, now) {
  const loop = loadLoop(dir);
  const evaluation = evaluate(loop, now, { withClock: true });
  const elapsed = elapsedMinutes(loop, now);
  emit({
    dir: resolve(dir),
    title: loop.title,
    status: statusFor(loop, evaluation),
    fpsTarget: loop.fpsTarget,
    target: loop.target,
    rounds: loop.rounds.length,
    judged: loop.rounds.filter((r) => r.verdict).length,
    // What the exit rules actually counted: verdicts scored against the target
    // that is locked right now. After a re-dream this drops to 0 while
    // `judged` keeps the file's full history.
    judgedAgainstTarget: loop.rounds.filter(
      (r) => r.verdict && r.targetVersion === loop.target.version,
    ).length,
    assets: loop.assets.length,
    scene: { vendor: vendorReport(dir), bridge: existsSync(join(resolve(dir), "scene", "lucid-bridge.js")) },
    budget: loop.budget
      ? {
          minutes: loop.budget.minutes,
          startedAt: loop.budget.startedAt,
          elapsedMinutes: elapsed,
          remainingMinutes: elapsed === null ? null : round2(Math.max(0, loop.budget.minutes - elapsed)),
        }
      : null,
    evaluation,
    advice: ADVICE[evaluation.exit],
  });
}

function cmdBudget(dir, opts, now) {
  if (opts.minutes === undefined) fail("budget needs --minutes N (0 removes the budget)");
  const minutes = num(opts.minutes, "--minutes", { min: 0 });
  const loop = loadLoop(dir);
  let startedAtSource = "none";
  if (minutes === 0) {
    loop.budget = null;
  } else {
    // A budget starts counting the moment it is asked for. An existing start
    // is KEPT, so raising or lowering the budget never buys more wall clock.
    const existing = loop.budget && loop.budget.startedAt ? loop.budget.startedAt : null;
    startedAtSource = existing ? "budget" : "now";
    loop.budget = { minutes, startedAt: existing ?? now };
  }
  const saved = saveLoop(dir, loop, now);
  emit({ dir: resolve(dir), budget: saved.budget, startedAtSource, evaluation: saved.evaluation });
}

function cmdAsset(dir, action, opts, now) {
  if (!["add", "update"].includes(action ?? "")) {
    fail(`asset: unknown action "${action ?? ""}" (expected: add | update)`);
  }
  if (!opts.id) fail(`asset ${action} needs --id <id>`);
  const loop = loadLoop(dir);
  const existing = loop.assets.find((a) => a.id === opts.id);
  const files = opts.files === undefined
    ? undefined
    : opts.files.split(",").map((f) => f.trim()).filter(Boolean)
        .map((f) => projectRelative(dir, f, "--files"));

  let entry;
  if (action === "add") {
    if (existing) fail(`asset "${opts.id}" already exists — use 'asset <dir> update --id ${opts.id}'`);
    if (!opts.role) fail("asset add needs --role hero|prop|environment");
    if (!opts.source) fail(`asset add needs --source ${ASSET_SOURCES.join("|")}`);
    entry = {
      id: opts.id,
      role: requireOneOf(opts.role, ASSET_ROLES, "--role"),
      source: requireOneOf(opts.source, ASSET_SOURCES, "--source"),
      state: opts.state === undefined ? "planned" : requireOneOf(opts.state, ASSET_STATES, "--state"),
      files: files ?? [],
      ...(opts.note ? { note: opts.note } : {}),
      updatedAt: now,
    };
    loop.assets.push(entry);
  } else {
    if (!existing) fail(`no asset "${opts.id}" in ${manifestPath(dir)}`);
    if (opts.state !== undefined) existing.state = requireOneOf(opts.state, ASSET_STATES, "--state");
    if (opts.role !== undefined) existing.role = requireOneOf(opts.role, ASSET_ROLES, "--role");
    if (opts.source !== undefined) existing.source = requireOneOf(opts.source, ASSET_SOURCES, "--source");
    if (files !== undefined) existing.files = files;
    if (opts.note !== undefined) existing.note = opts.note;
    existing.updatedAt = now;
    entry = existing;
  }

  const saved = saveLoop(dir, loop, now);
  emit({ dir: resolve(dir), asset: entry, assets: saved.assets.length });
}

function cmdJudgePrompt(dir, opts) {
  const loop = loadLoop(dir);
  if (loop.target.version === 0 || !loop.target.path) {
    fail("no target is locked — there is nothing for a judge to compare against");
  }
  if (loop.rounds.length === 0) {
    fail("no rounds recorded — run 'lucid.mjs round <dir> add --capture <png>' first");
  }
  const index = opts.round === undefined
    ? loop.rounds[loop.rounds.length - 1].index
    : num(opts.round, "--round", { min: 1 });
  const record = loop.rounds.find((r) => r.index === index);
  if (!record) fail(`no round ${index} in ${manifestPath(dir)} (${loop.rounds.length} recorded)`);
  if (!record.capture) fail(`round ${index} has no capture to judge`);

  const targetAbs = join(resolve(dir), loop.target.path);
  const captureAbs = join(resolve(dir), record.capture);
  for (const [label, path] of [["target", targetAbs], ["capture", captureAbs]]) {
    if (!existsSync(path)) fail(`the ${label} image is missing from disk: ${path}`);
  }

  // Nearest earlier judged round AGAINST THE SAME TARGET: consistency is what
  // keeps the trajectory meaningful, and a carried-over gap id is how a stall
  // becomes measurable. A verdict scored against a different dream would ask
  // this judge to stay consistent with a comparison it cannot see.
  let previous = null;
  for (const r of loop.rounds) {
    if (r.index < index && r.verdict && r.targetVersion === record.targetVersion) previous = r;
  }

  const lines = [
    `# Judge round ${index} of "${loop.title}"`,
    "",
    "You are an independent judge. You did not build this scene and you have no",
    "memory of how it was made. Look at the two images and score the current",
    "build against the target.",
    "",
    "## Images",
    "",
    `Target (the dream to match): ${targetAbs}`,
    `Current build (round ${index} capture): ${captureAbs}`,
    "",
    "## What the user asked for",
    "",
    loop.brief || "(no brief recorded)",
    "",
    "## Rubric",
    "",
    JUDGE_RUBRIC,
    "",
  ];

  if (previous) {
    lines.push(
      `## The previous verdict (round ${previous.index})`,
      "",
      "```json",
      JSON.stringify(previous.verdict, null, 2),
      "```",
      "",
      "Stay consistent with it, but do not feel obliged to match or raise the",
      "score — a regression should score lower. When a gap it named is still",
      "present, REUSE that gap's `id` verbatim; that is how this loop detects",
      "that the same problem survived another round.",
      "",
    );
  } else if (record.targetVersion > 1) {
    lines.push(
      "## Previous verdict",
      "",
      `None — this is the first round judged against this target (v${record.targetVersion}).`,
      "Earlier rounds were scored against a different dream and are deliberately",
      "not carried over. Choose kebab-case `id`s that a later judge can reuse",
      "verbatim if the gap survives.",
      "",
    );
  } else {
    lines.push(
      "## Previous verdict",
      "",
      "None — this is the first judged round. Choose kebab-case `id`s that a",
      "later judge can reuse verbatim if the gap survives.",
      "",
    );
  }

  lines.push(
    "## Output",
    "",
    "Reply with ONE JSON object and nothing else — no prose around it, no code",
    "fence commentary. Comments in the schema below are explanation, not part",
    "of your answer:",
    "",
    "```json",
    JUDGE_SCHEMA,
    "```",
    "",
    `\`total\` is recomputed from the four areas when this verdict is recorded (0-${
      SCORE_MAX.composition + SCORE_MAX.lighting + SCORE_MAX.materials + SCORE_MAX.details
    }).`,
    "`gaps` may be long. It must be comprehensive and every entry must be actionable.",
    "",
    // Hand-copying a verdict back through a chat turn is how a JSON key gets
    // corrupted. The judge writes the file; the loop ingests that same path.
    `WRITE that JSON object to ${verdictPath(dir, index)} (overwrite it if it exists) AND print it in your reply — the loop ingests the file by path, and the printed copy is what a human reads.`,
    "",
  );

  const brief = `${lines.join("\n")}\n`;
  const file = briefPath(dir, index);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, brief);
  } catch (error) {
    fail(`cannot write the judge brief to ${file}: ${error.message}`);
  }

  // The path comes FIRST so a caller that only forwards the head of this
  // output still hands the judge something it can read in full, and so the
  // brief never has to survive being retyped into a subagent prompt.
  process.stdout.write(`# Brief file: ${file}\n\n${brief}`);
}

function cmdBridge(dir, opts) {
  if (!opts.refresh) fail("bridge needs --refresh (it re-copies lucid-bridge.js into scene/)");
  if (!existsSync(manifestPath(dir))) {
    fail(`no ${MANIFEST} in ${resolve(dir)} — bridge --refresh updates an existing project`);
  }
  const source = join(HERE, "lucid-bridge.js");
  if (!existsSync(source)) fail(`lucid-bridge.js missing from the skill: ${source}`);
  const destination = join(resolve(dir), "scene", "lucid-bridge.js");
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  emit({ dir: resolve(dir), path: destination, bytes: statSync(destination).size });
}

// ---------------------------------------------------------------------------
// Usage and argv
// ---------------------------------------------------------------------------

const USAGE = `Usage: lucid.mjs <subcommand> <dir> [options]

The only writer of <dir>/lucid.json (format ${LUCID_FORMAT}) and of
<dir>/rounds/**. The agent never hand-edits them and the viewer only reads
them. <dir> is the project directory, absolute or relative to the CURRENT
directory (the workspace root) — this script never changes directory.
Capture / target PNG arguments may be absolute (that is what the framework's
capture action returns) or relative to the current directory.

Every subcommand except judge-prompt prints ONE JSON object on stdout and
exits 0. A failure prints one "ERROR: …" line on stderr and exits 1, leaving
the project untouched. --json is accepted everywhere and is already the
default, so passing it out of habit costs nothing. --now <ISO-8601> pins what
this run calls "now" (timestamps it writes, and the clock that status
compares the budget against); without it the wall clock is used.

  init <dir> --title "<name>" --brief "<the user's direction, verbatim>"
       [--fps-target ${DEFAULT_FPS_TARGET}] [--budget-minutes N] [--no-vendor] [--version <semver>]
      Create lucid.json (status dreaming, target version 0), rounds/, assets/
      and a runnable scene/: index.html + main.js from the starter plus
      lucid-bridge.js. Existing files of those names are kept, not clobbered.
      Then vendor three.js unless --no-vendor; a vendoring failure is reported
      as vendor.ok = false and does NOT fail init — the project and the scene
      exist, and you can run vendor-three later.
      --budget-minutes starts the clock NOW, at init: a user who says "45
      minutes" starts counting when they ask, so dreaming the target spends
      that budget too.
      Refuses a directory that already has a lucid.json.

  vendor-three <dir> [--version <semver>]
      npm pack three@<version> (default: the latest published version) and
      copy exactly six files into scene/vendor/:
        three.module.js, three.core.js, addons/loaders/GLTFLoader.js,
        addons/controls/OrbitControls.js, addons/utils/BufferGeometryUtils.js,
        addons/utils/SkeletonUtils.js
      plus scene/vendor/VERSION. All six come from ONE version or none is
      written: the download is staged and only swapped in when complete, so a
      failure never leaves a mixed vendor directory. Needs the network;
      offline is a loud failure. A vendor directory missing any one of the seven
      files reads as not ok in 'status'.

  target <dir> --set <png> [--reason "<why it changed>"]
      Lock the dream. Copies <png> to target.png. Replacing a target first
      archives the current one to target-history/v<version>.png and appends
      target.history, so a score trajectory is never silently compared against
      two different dreams. The FIRST lock flips status to looping. It does
      not touch the budget clock — that started when the budget was set.
      A REPLACEMENT (a re-dream) bumps target.version and RESTARTS THE SCORE
      TRAJECTORY: every round carries the targetVersion it was judged against,
      and only rounds matching the locked version feed the exit rules. The old
      rounds stay in the file and on the rail but count for nothing, so a loop
      that had reached done goes back to continue against the new dream; the
      reply says how many verdicts stopped counting (supersededRounds).

  round <dir> add --capture <png> [--fps N] [--kind ${ROUND_KINDS.join("|")}]
                  [--note "<text>"] [--verdict <file.json|->]
      Record the next round (1-based) and copy <png> to
      rounds/NN/capture.png. Refuses to run before a target is locked, and
      stamps the round with the locked target.version it is being judged
      against.
      --fps is what the scene bridge measured at capture time; without it the
      loop can never reach done ("fps unmeasured").
      --kind rethink marks the deliberate big-picture redesign that a stall
      calls for — the exit rules read it.
      --verdict ingests the judge's JSON in the same call ("-" reads stdin).

  verdict <dir> --round N [--file <file.json|->] [--replace]
      Validate the judge's JSON and store it inline in that round. Scores must
      be in range (composition/lighting/materials 0-3, details 0-1); the total
      is recomputed as their sum, a disagreement beyond ${TOTAL_TOLERANCE} is reported in
      warnings, and a gap with no id gets one slugged from its issue.
      Without --file it reads rounds/NN/verdict.json — the path judge-prompt
      told the judge to write to — and fails naming that path when it is not
      there. --file overrides it ("-" reads stdin). The file actually ingested
      comes back as "source".
      Refuses to overwrite an existing verdict without --replace.

  status <dir>
      Where the loop stands: the stored evaluation re-checked against the wall
      clock, the budget (minutes / elapsedMinutes / remainingMinutes), what
      the scene directory holds, and one line of advice. Never writes. Always
      exits 0 — it is a report, not a gate.
      It scores ONLY the rounds whose targetVersion equals the locked
      target.version: "rounds" and "judged" count the whole file, while
      "judgedAgainstTarget" and evaluation.trend count the current dream, and
      evaluation.targetVersion names which dream that is. The budget check
      applies from the moment a budget starts, including before the first
      verdict — it overrides continue and stall-approaching, never done.

  budget <dir> --minutes N
      Set or update the time budget; --minutes 0 removes it. A budget that has
      no clock yet starts counting NOW (startedAtSource: "now"); an existing
      start is kept (startedAtSource: "budget"), so raising the budget never
      buys back wall clock and lowering it never restarts the clock.

  asset <dir> add --id <id> --role ${ASSET_ROLES.join("|")}
                  --source ${ASSET_SOURCES.join("|")}
                  [--state ${ASSET_STATES.join("|")}]
                  [--files a,b] [--note "<text>"]
  asset <dir> update --id <id> [--state …] [--role …] [--source …]
                     [--files a,b] [--note "<text>"]
      The ledger of what the scene needs and where it came from. It moves no
      files; --files are project-relative paths (an absolute path inside the
      project is accepted and stored relative).

  judge-prompt <dir> [--round N]
      Write the complete brief for a fresh judge to rounds/NN/judge-brief.md
      (overwriting) and print it as PLAIN TEXT rather than JSON, with
      "# Brief file: <absolute path>" as the FIRST line and a blank line after
      it. The brief carries the rubric, the absolute paths of target.png and
      the round's capture (default: the latest round), the project brief, the
      previous verdict from the SAME targetVersion with the instruction to
      reuse a persisting gap's id (after a re-dream there is none — the judge
      starts fresh rather than staying consistent with a comparison against a
      dream it cannot see), the exact output schema, and the absolute
      rounds/NN/verdict.json the
      judge must write its answer to. Hand the judge that file path instead of
      retyping the brief; then ingest it with 'verdict <dir> --round N'.

  bridge <dir> --refresh
      Re-copy lucid-bridge.js into scene/ after a skill update.

Exit rules — computed here from the file, never from the agent's memory, and
only over the rounds whose targetVersion matches the locked target.version:

  dreaming           no target locked yet
  continue           the default; also when the last verdict is >= ${DONE_TOTAL}/10 but no
                     fps was measured ("fps unmeasured")
  done               last verdict >= ${DONE_TOTAL}/10 and fps >= ${FPS_OK_RATIO} x fpsTarget
  optimize-fps       last verdict >= ${DONE_TOTAL}/10 but fps below that bar
  stall-approaching  >= ${STALL_MIN_ROUNDS} judged rounds and the best of the last ${STALL_WINDOW} gained less
                     than ${STALL_MIN_GAIN.toFixed(1)} point over the best before them, OR the judge
                     named the same gap id in two verdicts in a row
  stalled            the last round was a rethink and did not beat the best
                     score before it, or two rethinks in a row each gained
                     less than ${STALL_MIN_GAIN.toFixed(1)} point
  budget-exhausted   the budget is spent (status only; it overrides continue
                     and stall-approaching from the moment the clock starts,
                     including before the first verdict, never done)

done and optimize-fps win over every stall signal. Locking a new target resets
all of this: the rounds judged against the old one stop counting, so the next
status is continue with an empty trend, whatever the loop had reached before.`;

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  json: { type: "boolean" },
  now: { type: "string" },
  title: { type: "string" },
  brief: { type: "string" },
  "fps-target": { type: "string" },
  "budget-minutes": { type: "string" },
  "no-vendor": { type: "boolean" },
  version: { type: "string" },
  set: { type: "string" },
  reason: { type: "string" },
  capture: { type: "string" },
  fps: { type: "string" },
  kind: { type: "string" },
  note: { type: "string" },
  verdict: { type: "string" },
  round: { type: "string" },
  file: { type: "string" },
  replace: { type: "boolean" },
  minutes: { type: "string" },
  id: { type: "string" },
  role: { type: "string" },
  source: { type: "string" },
  files: { type: "string" },
  state: { type: "string" },
  refresh: { type: "boolean" },
};

function nowStamp(opts) {
  if (opts.now === undefined) return new Date().toISOString();
  const parsed = Date.parse(opts.now);
  if (!Number.isFinite(parsed)) fail(`--now must be an ISO-8601 timestamp, got "${opts.now}"`);
  return new Date(parsed).toISOString();
}

function main() {
  let parsed;
  try {
    parsed = parseArgs({ args: process.argv.slice(2), options: OPTIONS, allowPositionals: true });
  } catch (error) {
    fail(`${error.message}\n\n${USAGE}`);
  }
  const opts = parsed.values;
  const [subcommand, dirArg, action] = parsed.positionals;

  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  if (!subcommand) fail(`no subcommand\n\n${USAGE}`);
  if (!SUBCOMMANDS.includes(subcommand)) {
    fail(`unknown subcommand "${subcommand}" (expected: ${SUBCOMMANDS.join(", ")})`);
  }
  if (!dirArg) fail(`${subcommand} needs a project directory: lucid.mjs ${subcommand} <dir> …`);

  const dir = resolveInput(dirArg);
  const now = nowStamp(opts);

  switch (subcommand) {
    case "init": return cmdInit(dir, opts, now);
    case "vendor-three": return cmdVendorThree(dir, opts);
    case "target": return cmdTarget(dir, opts, now);
    case "round": return cmdRound(dir, action, opts, now);
    case "verdict": return cmdVerdict(dir, opts, now);
    case "status": return cmdStatus(dir, now);
    case "budget": return cmdBudget(dir, opts, now);
    case "asset": return cmdAsset(dir, action, opts, now);
    case "judge-prompt": return cmdJudgePrompt(dir, opts);
    case "bridge": return cmdBridge(dir, opts);
    default: return fail(`unhandled subcommand "${subcommand}"`);
  }
}

/** Run only when invoked as a program, so importing JUDGE_RUBRIC is safe. */
const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
