#!/usr/bin/env node

/**
 * Plotwise segment producer — the play loop, as ONE process.
 *
 * Everything between "the session decided a direction" and "the choice
 * card is live" happens here, in a fixed order, with no agent in the
 * middle: resolve the beat's planning-time evidence → write the script
 * (a designed LLM call, GPT 5.6 Luna) → evidence gate (verify only — never
 * render mid-course) → continuity frame → shoot on H3 Max → narration QA
 * (transcribe, compare; a designed LLM judge only for the ambiguous band)
 * → one re-shoot at most → write the node files → commit course.json under
 * a lock. Measured on the first live course, the same steps driven by an
 * agent took 3-5 minutes per segment; the API work inside them is ~40s.
 *
 * Usage (from the session cwd; paths inside course.json are set-relative):
 *   node produce-segment.mjs --set plexus --id n3a --parent n3 --beat b3 \
 *     --kind branch --direction "unpack the spine with the Obsidian example" \
 *     --label "用 Obsidian 的例子展开" [--language zh] [--duration 10] \
 *     [--resolution 480P] [--endpoint reference|image|text] \
 *     [--context "..."] [--evidence-file nodes/sq1/extra.json]... \
 *     [--script-file nodes/n3a/script.json] [--model openai/gpt-5.6-luna] \
 *     [--no-qa] [--no-commit] --json
 *
 * Two candidates are two invocations — run them in parallel; each touches
 * only its own nodes/<id>/ files and course.json is updated under a lock.
 *
 * Exit codes:
 *   0  ready — node files written, course.json updated, the card is live
 *   2  failed — evidence gate or narration QA rejected it; the node is
 *      committed as "failed" and generation.json carries the reason
 *   3  needs-script — no OPENROUTER_API_KEY. The brief is at
 *      nodes/<id>/brief.json; write nodes/<id>/script.json yourself
 *      ({script, video_prompt, needs_figure_refs}, contract in
 *      write-script.mjs) and re-run with --script-file. The node stays
 *      "generating" meanwhile.
 *   1  hard error (missing files, API failure) — node marked "failed"
 *
 * --json prints one object: { id, status, video?, qa, timings, files,
 * warnings, reason? } — `timings` is per-step seconds; keep an eye on it.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawnSync, spawn } from "node:child_process";

import {
  DEFAULT_MODEL,
  QA_KEYLESS_PASS,
  SPEECH_OVERRUN,
  autoVerdict,
  checkFigureGate,
  compareNarration,
  detectLanguage,
  extractLastFrame,
  judgeNarration,
  loadEnvKey,
  planRefs,
  resolveStyle,
  probeDuration,
  readCourse,
  resolveEvidence,
  shootableFigures,
  speechBudgetUnits,
  speechUnits,
  upsertNode,
  withCourseLock,
  chooseEndpoint,
  describeAvailableRefs,
  injectBindings,
} from "./segment-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = dirname(__dirname);
const STYLES_MD = join(SKILL_ROOT, "references", "styles.md");
const WRITE_SCRIPT = join(__dirname, "write-script.mjs");
const GENERATE_VIDEO = join(__dirname, "generate-video.mjs");
const TRANSCRIBE = join(__dirname, "transcribe.mjs");

const DEFAULT_DURATION = 10;
const CONTEXT_EXCERPT = 400;

// ── Args ────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    set: { type: "string" },
    id: { type: "string" },
    parent: { type: "string" },
    beat: { type: "string" },
    kind: { type: "string", default: "main" },
    direction: { type: "string" },
    label: { type: "string" },
    language: { type: "string" },
    duration: { type: "string" },
    resolution: { type: "string", default: "480P" },
    endpoint: { type: "string", default: "auto" },
    context: { type: "string" },
    "evidence-file": { type: "string", multiple: true, default: [] },
    "script-file": { type: "string" },
    model: { type: "string" },
    "judge-model": { type: "string" },
    "no-qa": { type: "boolean", default: false },
    "no-commit": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

function fail(msg, code = 1) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

for (const required of ["set", "id", "direction"]) {
  if (!args[required]) fail(`--${required} is required`);
}
if (args.parent && !args.label) fail("--label (the choice-card text) is required when --parent is given");
if (!["main", "branch", "sidequest"].includes(args.kind)) fail(`--kind must be main | branch | sidequest`);
if (!["auto", "image", "reference", "text"].includes(args.endpoint)) fail(`--endpoint must be auto | image | reference | text`);

const setDir = resolve(args.set);
const id = args.id;
const nodeRel = `nodes/${id}`;
const nodeDir = join(setDir, nodeRel);
mkdirSync(nodeDir, { recursive: true });

const timings = {};
const warnings = [];
const started = performance.now();
let stepStart = started;
function mark(step) {
  const now = performance.now();
  timings[step] = Math.round((now - stepStart) / 100) / 10;
  stepStart = now;
}

function run(script, argv) {
  return spawnSync(process.execPath, [script, ...argv], { encoding: "utf-8", cwd: process.cwd(), maxBuffer: 64 * 1024 * 1024 });
}

function emit(obj, code) {
  if (args.json) console.log(JSON.stringify(obj));
  else console.log(`${obj.status}: ${id}${obj.reason ? ` — ${obj.reason}` : ""}`);
  process.exit(code);
}

// ── Course context ──────────────────────────────────────────────────────────

const course = readCourse(setDir);
const beat = args.beat ? (course.outline ?? []).find((b) => b && b.id === args.beat) : null;
if (args.beat && !beat) fail(`beat "${args.beat}" is not in the outline of ${setDir}/course.json`);

const language = args.language ?? course.language ?? detectLanguage(`${course.title ?? ""} ${course.goal ?? ""}`);
const durationRaw = Number(args.duration ?? course.defaults?.duration ?? DEFAULT_DURATION);
const duration = Math.min(15, Math.max(5, Number.isFinite(durationRaw) ? durationRaw : DEFAULT_DURATION));

const resolvedStyle = resolveStyle(course, existsSync(STYLES_MD) ? readFileSync(STYLES_MD, "utf-8") : null);
const style = { id: resolvedStyle.id, recipe: resolvedStyle.recipe, narration: resolvedStyle.narration };
if (!resolvedStyle.id) warnings.push("course.json has no style — the board has not confirmed one; shooting with no recipe");
else if (resolvedStyle.status !== "confirmed") warnings.push(`style "${resolvedStyle.id}" is ${resolvedStyle.status}, not confirmed — the board should settle it before segments are shot`);
else if (!resolvedStyle.fromCatalog && !course.style?.recipe) warnings.push(`style "${resolvedStyle.id}" has no recipe in references/styles.md — using the id as the recipe`);
const refImages = (course.style?.refImages ?? []).filter((f) => typeof f === "string" && existsSync(join(setDir, f)));
const styleAnchor = refImages[0] ?? null;
const characters = refImages.slice(1);

const evidence = resolveEvidence({ setDir, beat, nodeId: id, extraFiles: args["evidence-file"] });
for (const e of evidence) if (e.missing) warnings.push(`evidence file missing on disk: ${e.file}`);
const figures = shootableFigures(evidence);

// Continuity anchor: the parent's last frame, else the style anchor.
let anchorFile = null;
let anchorKind = "continuity";
const parentNode = args.parent ? course.nodes?.[args.parent] : null;
if (args.parent && !parentNode) warnings.push(`parent "${args.parent}" is not in course.json — linking anyway`);
if (parentNode?.video?.file && existsSync(join(setDir, parentNode.video.file))) {
  if (extractLastFrame(join(setDir, parentNode.video.file), join(nodeDir, "prev-frame.png"))) {
    anchorFile = `${nodeRel}/prev-frame.png`;
  } else {
    warnings.push("ffmpeg could not extract the parent's last frame — falling back to the style anchor");
  }
}
// The root continues from the confirmed style SAMPLE — the clip the
// learner said yes to is literally where the course begins.
const sampleVideo = course.style?.sample?.video;
if (!anchorFile && !args.parent && typeof sampleVideo === "string" && existsSync(join(setDir, sampleVideo))) {
  if (extractLastFrame(join(setDir, sampleVideo), join(nodeDir, "prev-frame.png"))) {
    anchorFile = `${nodeRel}/prev-frame.png`;
  } else {
    warnings.push("ffmpeg could not extract the style sample's last frame — falling back to the style anchor");
  }
}
if (!anchorFile && styleAnchor) {
  anchorFile = styleAnchor;
  anchorKind = "style-anchor";
}
if (!anchorFile) warnings.push("no continuity frame and no style anchor — this shoot is unanchored");

// The writer hears what images are on offer, by name. The endpoint and
// the numbered bindings are decided after the script, from what it shows.
const availableRefs = describeAvailableRefs({ anchorKind: anchorFile ? anchorKind : null, characters, figures });
mark("context");

function commit(spec) {
  if (args["no-commit"]) return;
  withCourseLock(setDir, (c) => {
    upsertNode(c, spec);
    if (!args.parent && !c.rootNode) c.rootNode = id;
    return c;
  });
}

function writeGeneration(extra) {
  writeFileSync(
    join(nodeDir, "generation.json"),
    `${JSON.stringify({ produced_at: new Date().toISOString(), id, direction: args.direction, ...extra, timings, warnings }, null, 2)}\n`,
  );
}

function abort(status, reason, extra = {}, code = 2) {
  writeGeneration({ status, reason, ...extra });
  try {
    commit({ id, parent: args.parent, beat: beat?.id, kind: args.kind, choiceLabel: args.label, status: "failed", video: null, phase: null, error: String(reason).slice(0, 240) });
  } catch (e) {
    warnings.push(`could not mark the node failed: ${e.message}`);
  }
  timings.total = Math.round((performance.now() - started) / 100) / 10;
  emit({ id, status, reason, timings, warnings }, code);
}

// The stage reads phase + startedAt: 写稿中 / 拍摄中 / 质检中 with a clock,
// and a node stuck past its stale line can be re-requested instead of
// spinning forever.
commit({ id, parent: args.parent, beat: beat?.id, kind: args.kind, choiceLabel: args.label, status: "generating", video: null, startedAt: new Date().toISOString(), phase: "script", error: null });

// ── Script ──────────────────────────────────────────────────────────────────

const briefPath = join(nodeDir, "brief.json");
let scriptOut;
let scriptWriter;
let brief = null;
const scriptRevisions = [];

if (args["script-file"]) {
  const raw = JSON.parse(readFileSync(args["script-file"], "utf-8"));
  if (typeof raw.script !== "string" || typeof raw.video_prompt !== "string") {
    fail(`${args["script-file"]} must carry { script, video_prompt, needs_figure_refs }`);
  }
  scriptOut = { script: raw.script, video_prompt: raw.video_prompt, needs_figure_refs: Array.isArray(raw.needs_figure_refs) ? raw.needs_figure_refs.map(String) : [] };
  scriptWriter = "script-file (backend fallback)";
  if (existsSync(briefPath)) brief = JSON.parse(readFileSync(briefPath, "utf-8"));
} else {
  const contextParts = [];
  if (parentNode) {
    const parentScript = join(setDir, `nodes/${args.parent}/script.md`);
    if (existsSync(parentScript)) {
      const text = readFileSync(parentScript, "utf-8").replace(/^\s*#.*$/gm, "").trim();
      contextParts.push(`The previous segment (${parentNode.choiceLabel ?? args.parent}) said: "${text.slice(0, CONTEXT_EXCERPT)}"`);
    }
  }
  const pathLabels = (course.path ?? []).slice(-4).map((pid) => course.nodes?.[pid]?.choiceLabel ?? pid);
  if (pathLabels.length) contextParts.push(`Path taken so far: ${pathLabels.join(" → ")}.`);
  if (args.context) contextParts.push(args.context);

  brief = {
    direction: args.direction,
    language,
    duration,
    style,
    beat: beat ? { title: beat.title, summary: beat.summary } : { title: args.direction },
    evidence: evidence.filter((e) => !e.missing).map(({ kind, file, url, note }) => ({ kind, ...(file ? { file } : {}), ...(url ? { url } : {}), note })),
    context: contextParts.join(" ") || undefined,
    characters: availableRefs,
  };
  writeFileSync(briefPath, `${JSON.stringify(brief, null, 2)}\n`);

  const r = run(WRITE_SCRIPT, ["--brief-file", briefPath, ...(args.model ? ["--model", args.model] : [])]);
  if (r.status === 3) {
    timings.total = Math.round((performance.now() - started) / 100) / 10;
    emit(
      {
        id,
        status: "needs-script",
        brief: `${nodeRel}/brief.json`,
        scriptFile: `${nodeRel}/script.json`,
        next: `No OPENROUTER_API_KEY. Write ${nodeRel}/script.json as {script, video_prompt, needs_figure_refs} following write-script.mjs's contract (same brief), then re-run this command with --script-file ${nodeRel}/script.json.`,
        timings,
        warnings,
      },
      3,
    );
  }
  if (r.status !== 0) abort("failed", `write-script.mjs failed: ${(r.stderr || "").trim().slice(0, 400)}`, {}, 1);
  try {
    scriptOut = JSON.parse(r.stdout);
  } catch (e) {
    abort("failed", `write-script.mjs returned non-JSON: ${e.message}`, {}, 1);
  }
  scriptWriter = `${args.model ?? DEFAULT_MODEL} via write-script.mjs`;

  // Speech budget: a script the clip cannot fit is rushed into an
  // unintelligible take (measured: 1.85× budget failed QA twice). One
  // designed rewrite before any shoot is far cheaper than a re-shoot.
  const budget = speechBudgetUnits(language, duration);
  const units = speechUnits(scriptOut.script, language);
  if (units > budget * SPEECH_OVERRUN) {
    brief.revision_note = `Your previous draft was ${units} speech units ("${scriptOut.script}"); the clip is ${duration}s and the hard cap is ${Math.round(budget * SPEECH_OVERRUN)} units. Rewrite the script to at most ${budget} units — drop whole clauses rather than compressing every one; keep each remaining fact exact; keep the same reference bindings; regenerate video_prompt with the new narration embedded verbatim.`;
    writeFileSync(briefPath, `${JSON.stringify(brief, null, 2)}\n`);
    const r2 = run(WRITE_SCRIPT, ["--brief-file", briefPath, ...(args.model ? ["--model", args.model] : [])]);
    let revised = null;
    if (r2.status === 0) {
      try {
        revised = JSON.parse(r2.stdout);
      } catch {
        /* keep the first draft */
      }
    }
    const revisedUnits = revised && typeof revised.script === "string" ? speechUnits(revised.script, language) : null;
    scriptRevisions.push({ units, budget, revised_units: revisedUnits });
    if (revised && revisedUnits != null && revisedUnits < units && typeof revised.video_prompt === "string") {
      scriptOut = {
        script: revised.script,
        video_prompt: revised.video_prompt,
        needs_figure_refs: Array.isArray(revised.needs_figure_refs) ? revised.needs_figure_refs.map(String) : [],
      };
      if (revisedUnits > budget * SPEECH_OVERRUN) {
        warnings.push(`script still over budget after one rewrite (${revisedUnits}/${budget} units) — shooting anyway; QA decides`);
      }
    } else {
      warnings.push(`script over budget (${units}/${budget} units) and the rewrite did not shorten it — shooting anyway; QA decides`);
    }
  }
}
mark("script");
commit({ id, phase: "shoot" });
prewarmTranscriber();

// ── Evidence gate ───────────────────────────────────────────────────────────

const gate = checkFigureGate(scriptOut.needs_figure_refs, figures);
if (!gate.ok) {
  abort(
    "failed",
    `evidence gate: the prompt depends on figure(s) not on disk for this beat — ${gate.missing.join(", ")}. Render them by code at planning time under evidence/${beat?.id ?? id}/, list them in the outline beat's evidence, then re-run. Never render mid-course and never let the model imagine them.`,
    { script: scriptOut.script, video_prompt: shootPrompt, needs_figure_refs: scriptOut.needs_figure_refs, offered_figures: figures.map((f) => f.file) },
  );
}
mark("gate");

// ── Endpoint, from what the script shows ────────────────────────────────────
// A figure on screen or a recurring character → reference-to-video with
// numbered bindings injected into the prompt; a scene to continue and
// nothing to show → image-to-video from the parent's last frame; nothing
// at all → text-to-video. Most segments are the second or third case.
const shootEndpoint = chooseEndpoint({ requested: args.endpoint, anchorFile, characters, figures: gate.bound });
const plan = planRefs({ anchorFile, anchorKind, characters, figures: gate.bound, mode: shootEndpoint === "image" ? "image" : "reference" });
const shootPrompt = shootEndpoint === "text" ? scriptOut.video_prompt : injectBindings(scriptOut.video_prompt, plan.lines);

// ── Shoot + QA ──────────────────────────────────────────────────────────────

const videoRel = `${nodeRel}/video.mp4`;
const videoAbs = join(setDir, videoRel);

function shoot(seed) {
  const argv = ["--prompt", shootPrompt, "--output", videoAbs, "--duration", String(duration), "--resolution", args.resolution, "--expansion", "balanced", "--json"];
  let endpoint = shootEndpoint;
  if (endpoint === "reference") {
    for (const ref of plan.refs) argv.push("--ref-image", join(setDir, ref.file));
  } else if (endpoint === "image") {
    // Continuity only. A figure is a reference, never a keyframe: a
    // segment that binds one is not shot from a first frame alone.
    if (gate.bound.length > 0) {
      throw new Error(`image-to-video cannot anchor a figure (${gate.bound.map((f) => basename(f.file)).join(", ")}) — figures ride along only as references; use reference-to-video`);
    }
    argv.push("--image", join(setDir, anchorFile));
  } else {
    argv.push("--endpoint", "text");
  }
  if (seed != null) argv.push("--seed", String(seed));
  let r = run(GENERATE_VIDEO, argv);
  // reference-to-video can be down while the other endpoints answer
  // (2026-09-02: 504 "downstream_service_unavailable" for hours). A
  // segment that binds no figure is shot image-to-video from the
  // continuity frame instead; one that needs a figure anchored fails
  // honestly — the iron law is that a knowledge visual is never left to
  // the model's imagination, and a raw figure is never forced on screen.
  if (r.status !== 0 && endpoint === "reference" && anchorFile && /HTTP 5\d\d|request failed/.test(r.stderr || "")) {
    if (gate.bound.length > 0) {
      throw new Error(`reference-to-video is unavailable (${(r.stderr || "").trim().split("\n").pop().slice(0, 160)}) and this segment needs ${gate.bound.length} figure(s) anchored as references — not shot from imagination; try again later`);
    }
    warnings.push(`reference-to-video failed (${(r.stderr || "").trim().split("\n").pop().slice(0, 160)}) — shot image-to-video from the continuity frame instead (no figure was bound)`);
    endpoint = "image";
    const fallback = argv.filter((a, i, all) => a !== "--ref-image" && all[i - 1] !== "--ref-image");
    fallback.push("--image", join(setDir, anchorFile));
    r = run(GENERATE_VIDEO, fallback);
  }
  if (r.status !== 0) throw new Error(`generate-video.mjs failed: ${(r.stderr || "").trim().slice(0, 400)}`);
  return { endpoint, result: JSON.parse(r.stdout) };
}

/** Transcribe from the clip's CDN URL when the generator returned one
 * (no 8 MB base64 upload — a 10-15s clip can exceed the inline limit),
 * falling back to the local file. */
/**
 * wizper on fal cold-starts: a third of this course's clips paid ~100s
 * for a transcription that takes 2s on a warm worker. A throwaway
 * request on the smallest clip already on disk, fired while H3 renders,
 * means the real one finds the worker warm. Detached, output ignored.
 */
function prewarmTranscriber() {
  const candidates = [course.style?.sample?.video, parentNode?.video?.file]
    .filter((f) => typeof f === "string")
    .map((f) => join(setDir, f))
    .filter((f) => existsSync(f));
  if (!candidates.length) return;
  try {
    const child = spawn(process.execPath, [TRANSCRIBE, "--input", candidates[0], "--language", language, "--json"], { stdio: "ignore", detached: true });
    child.unref();
  } catch {
    /* a warm-up that fails costs nothing */
  }
}

function transcribe(sourceUrl) {
  const inputs = sourceUrl ? [sourceUrl, videoAbs] : [videoAbs];
  let lastErr = "";
  for (const input of inputs) {
    const r = run(TRANSCRIBE, ["--input", input, "--language", language, "--json"]);
    if (r.status === 0) return String(JSON.parse(r.stdout).text ?? "");
    lastErr = (r.stderr || "").trim().slice(0, 400);
    warnings.push(`transcribe.mjs failed on ${input === videoAbs ? "the local file" : "the CDN URL"}: ${lastErr}`);
  }
  throw new Error(`transcribe.mjs failed: ${lastErr}`);
}

async function qa(attempt, sourceUrl) {
  const transcript = transcribe(sourceUrl);
  const cmp = compareNarration(scriptOut.script, transcript);
  const sim = Math.round(cmp.similarity * 1000) / 1000;
  const coverage = Math.round(cmp.coverage * 1000) / 1000;
  let verdict = autoVerdict(sim, coverage);
  let judge = "auto";
  let reason = "";
  if (verdict == null) {
    const key = loadEnvKey("OPENROUTER_API_KEY", { skillRoot: SKILL_ROOT });
    if (key) {
      judge = "luna";
      try {
        const j = await judgeNarration({ key, model: args["judge-model"] ?? args.model ?? DEFAULT_MODEL, script: scriptOut.script, transcript, language, similarity: sim, coverage });
        verdict = j.verdict;
        reason = j.reason;
      } catch (e) {
        warnings.push(`judge call failed (${e.message}) — deciding by similarity`);
        judge = "keyless";
        verdict = sim >= QA_KEYLESS_PASS ? "pass" : "fail";
      }
    } else {
      judge = "keyless";
      verdict = sim >= QA_KEYLESS_PASS ? "pass" : "fail";
    }
  }
  return { attempt, transcript, similarity: sim, coverage, verdict, judge, reason };
}

const attempts = [];
let shot = null;
let finalVerdict = "pass";
try {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const seed = attempt === 1 ? null : Math.floor(Math.random() * 2 ** 31);
    shot = shoot(seed);
    shot.result.attempt = attempt;
    mark(attempt === 1 ? "shoot" : "reshoot");
    if (args["no-qa"]) {
      attempts.push({ attempt, verdict: "skipped", judge: "none" });
      break;
    }
    commit({ id, phase: "qa" });
    const outcome = await qa(attempt, shot.result.url);
    attempts.push(outcome);
    mark(attempt === 1 ? "qa" : "qa-reshoot");
    finalVerdict = outcome.verdict;
    if (outcome.verdict === "pass") break;
    if (attempt === 1) {
      renameSync(videoAbs, join(nodeDir, "video-rejected-1.mp4"));
      warnings.push(`attempt 1 rejected by narration QA (similarity ${outcome.similarity}) — re-shooting with a fresh seed`);
    }
  }
} catch (e) {
  abort("failed", e.message, { script: scriptOut.script, video_prompt: scriptOut.video_prompt, qa: attempts }, 1);
}

// ── Write the node ──────────────────────────────────────────────────────────

writeFileSync(join(nodeDir, "script.md"), `${scriptOut.script.trim()}\n`);

const boundFiles = new Set(gate.bound.map((f) => f.file));
const nodeEvidence = evidence
  .filter((e) => !e.missing)
  .filter((e) => !figures.includes(e) || boundFiles.has(e.file))
  .map(({ kind, file, url, note }) => ({ kind: kind === "figure" ? "rendered-figure" : kind, ...(file ? { file } : {}), ...(url ? { url } : {}), note }));
writeFileSync(join(nodeDir, "evidence.json"), `${JSON.stringify(nodeEvidence, null, 2)}\n`);

const status = finalVerdict === "pass" ? "ready" : "failed";
const realDuration = status === "ready" ? (probeDuration(videoAbs) ?? duration) : null;

writeGeneration({
  status,
  endpoint: shot.endpoint,
  prompt: scriptOut.video_prompt,
  expanded_prompt: shot.result.expanded_prompt ?? null,
  params: { duration, resolution: args.resolution, expansion: "balanced" },
  refs: plan.refs,
  continuity: anchorFile ? { kind: anchorKind, file: anchorFile } : null,
  seed: shot.result.seed ?? null,
  inference_seconds: shot.result.inference_seconds ?? null,
  loudness: shot.result.loudness ?? null,
  script_writer: scriptWriter,
  script_revisions: scriptRevisions,
  needs_figure_refs: scriptOut.needs_figure_refs,
  brief,
  qa: attempts,
});
rmSync(briefPath, { force: true });

commit({
  id,
  parent: args.parent,
  beat: beat?.id,
  kind: args.kind,
  choiceLabel: args.label,
  status,
  video: status === "ready" ? { file: videoRel, duration: realDuration } : null,
  phase: null,
  startedAt: null,
  error: status === "ready" ? null : `narration QA: ${finalVerdict}`,
});
mark("commit");
timings.total = Math.round((performance.now() - started) / 100) / 10;

const last = attempts[attempts.length - 1] ?? {};
emit(
  {
    id,
    status,
    ...(status === "ready" ? { video: { file: videoRel, duration: realDuration } } : { reason: `narration QA failed twice (last similarity ${last.similarity}${last.reason ? `: ${last.reason}` : ""}) — shorten the script or raise --duration and re-run` }),
    qa: { attempts: attempts.length, verdict: finalVerdict, similarity: last.similarity ?? null, judge: last.judge ?? null },
    timings,
    files: { script: `${nodeRel}/script.md`, evidence: `${nodeRel}/evidence.json`, generation: `${nodeRel}/generation.json` },
    warnings,
  },
  status === "ready" ? 0 : 2,
);
