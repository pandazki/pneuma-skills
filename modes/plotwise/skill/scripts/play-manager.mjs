#!/usr/bin/env node

/**
 * play-manager — the play loop of a plotwise course, as one long-running
 * program. After the director has confirmed the style, planned the
 * outline and landed the screenplay, this process owns everything the
 * learner sees change: it writes detour and question scripts ahead of
 * them (planning queue, Luna), shoots scenes clip by clip ahead of them
 * (video queue, H3 slots), prunes what they did not choose, and records
 * the path. No model is ever called on the click path: a choice is a
 * file the viewer writes, and the manager answers by switching the
 * current node and re-prioritising work.
 *
 * A scene is 1-3 MONTAGE CLIPS (0.6). Every clip is shot
 * reference-to-video with the same bindings — the style anchor as Image 1,
 * the character sheet next, that clip's figures after, and the course's
 * voice as Audio 1 — so the look and the voice carry across a scene
 * without chaining frames. The frame chain is gone: it bought a seamless
 * join at the price of the voice reference and of every cut inside a clip.
 *
 * Usage:
 *   node play-manager.mjs --set <dir> --detach [--slots 3] [--video-ahead 2]
 *                         [--plan-ahead 2] [--resolution 480P]
 *   node play-manager.mjs --set <dir> [--once]        (foreground)
 *
 * `--detach` is how the director starts it: the manager re-spawns itself
 * in its own session (stdout/stderr → <set>/state/manager.out), waits for
 * the pid file and prints { pid, log }. `nohup … &` is NOT enough — an
 * agent's exec tool kills its process group when the command returns
 * (Codex, 2026-09-03: the manager died silently twice, the learner sat
 * ten minutes on "等待开拍"). A manager already running for the set is
 * reported, never doubled.
 *
 * Inputs it watches (under <set>/state/):
 *   choice.json    { "at": iso, "choose": "<nodeId>" } | { "at": iso, "retry": "<nodeId>" }
 *   requests/*.json  { "parent": "<nodeId>", "label": "...", "brief": "..." }  (a learner question)
 * Outputs: course.json (nodes / path / play, under the course lock),
 *   nodes/<id>/c<k>.mp4, nodes/<id>/video.mp4, state/manager.log,
 *   state/manager.pid.
 *
 * Every dependency with a cost — the writer, the renderer, ffmpeg, the
 * transcriber — is injectable, so the scheduling can be tested without
 * paying for a single clip. See `createManager`.
 *
 * Design: docs/proposals/2026-09-02-plotwise-async-play-manager.md.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AsyncJobQueue } from "./async-job-queue.mjs";
import {
  DEFAULT_MODEL,
  MAX_REFS,
  autoVerdict,
  chatJson,
  compareNarration,
  extractLastFrame,
  judgeNarration,
  loadEnvKey,
  planRefs,
  probeDuration,
  probeStreams,
  readCourse,
  resolveEvidence,
  resolveStyle,
  shootableFigures,
  withCourseLock,
} from "./segment-lib.mjs";
import { writeDetourScene } from "./screenplay-lib.mjs";
import { H3_PRACTICES_VERSION, clipScript, insertReferenceBlock } from "./h3-prompt.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_ROOT = dirname(__dirname);
const GENERATE_VIDEO = join(__dirname, "generate-video.mjs");
const TRANSCRIBE = join(__dirname, "transcribe.mjs");
const GENERATE_IMAGE = join(__dirname, "generate_image.mjs");
const STYLES_MD = join(SKILL_ROOT, "references", "styles.md");

/** Where the continuity kit lives, set-relative. */
export const VOICE_REF = "style/voice.mp3";
export const CHARACTER_SHEET = ["style/character-1.png", "style/character-2.png"];
/** fal takes 2-15 s of reference audio; the sample is 5 s. */
const VOICE_REF_MAX_S = 15;
/** Audio fade at every clip join in the scene concat: long enough to
 * kill the click of a waveform discontinuity, short enough to be
 * inaudible as a fade. */
const SEAM_FADE_S = 0.03;

// ── Small helpers ───────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();
const sleep = (ms, signal) =>
  new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); rej(abortError()); }, { once: true });
  });
function abortError() {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}
const isAbort = (e, signal) => Boolean(signal?.aborted) || e?.name === "AbortError";

/** Breadth-first window of descendants, with their distance from the root. */
export function descendantWindow(nodes, rootId, depth) {
  const out = [];
  const queue = [{ id: rootId, distance: 0 }];
  const seen = new Set();
  while (queue.length) {
    const item = queue.shift();
    if (seen.has(item.id) || item.distance > depth) continue;
    const node = nodes[item.id];
    if (!node) continue;
    seen.add(item.id);
    out.push(item);
    if (item.distance === depth) continue;
    for (const c of node.children ?? []) queue.push({ id: c.nodeId, distance: item.distance + 1 });
  }
  return out;
}
export function subtreeIds(nodes, rootId) {
  return descendantWindow(nodes, rootId, Number.POSITIVE_INFINITY).map((i) => i.id);
}

/** Run a child process with an abort signal; resolves { code, stdout, stderr }. */
function runChild(cmd, argv, { signal, cwd } = {}) {
  return new Promise((res, rej) => {
    if (signal?.aborted) return rej(abortError());
    const child = spawn(cmd, argv, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const onAbort = () => { child.kill("SIGTERM"); };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => { signal?.removeEventListener("abort", onAbort); rej(e); });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return rej(abortError());
      res({ code, stdout: out, stderr: err });
    });
  });
}

/** How long one clip may take at fal, queue wait included, before it is retried. */
export const CLIP_DEADLINE_S = 360;
/** Pause before the second transcription attempt of a clip. */
const TRANSCRIBE_RETRY_MS = 3000;

// ── Default production dependencies (the paid ones) ─────────────────────────

export function defaultDeps({ setDir, resolution = "480P", model = DEFAULT_MODEL } = {}) {
  const openrouterKey = loadEnvKey("OPENROUTER_API_KEY", { skillRoot: SKILL_ROOT, cwd: setDir });
  return {
    model,
    chat: openrouterKey
      ? ({ system, user }) => chatJson({ key: openrouterKey, model, system, user, temperature: 0.4 })
      : null,
    /** Render one clip to `output`; returns generate-video's JSON. */
    async renderClip({ prompt, output, duration, image, refImages = [], refAudios = [], seed }, signal) {
      // A clip that fal has not returned in six minutes is re-tried, not
      // waited on: the learner is watching a clock. (Three 768P openings
      // once sat 21 minutes in fal's queue under the generator's own
      // 15-minute deadline, 2026-09-03.)
      //
      // `--expansion balanced` is not optional: the prompt is the plain
      // four-block montage form, and fal's expander is what turns it into
      // H3's own sectioned shape (measured 2026-09-04).
      const argv = ["--prompt", prompt, "--output", output, "--duration", String(duration), "--resolution", resolution, "--expansion", "balanced", "--deadline-s", String(CLIP_DEADLINE_S), "--json"];
      if (image) argv.push("--image", image);
      else if (refImages.length) {
        for (const r of refImages) argv.push("--ref-image", r);
        for (const a of refAudios) argv.push("--ref-audio", a);
      } else argv.push("--endpoint", "text");
      if (seed != null) argv.push("--seed", String(seed));
      const r = await runChild(process.execPath, [GENERATE_VIDEO, ...argv], { signal, cwd: setDir });
      if (r.code !== 0) throw new Error(`generate-video.mjs failed: ${(r.stderr || "").trim().slice(0, 400)}`);
      return JSON.parse(r.stdout);
    },
    /** The narration of a clip as an mp3, at most `maxSeconds` long. */
    async extractAudio(video, output, maxSeconds = VOICE_REF_MAX_S, signal) {
      const r = await runChild("ffmpeg", ["-y", "-v", "error", "-i", video, "-t", String(maxSeconds), "-vn", "-acodec", "libmp3lame", "-q:a", "2", output], { signal });
      if (r.code !== 0 || !existsSync(output)) throw new Error(`ffmpeg audio extraction failed: ${(r.stderr || "").trim().slice(-200)}`);
      const d = probeDuration(output);
      if (d != null && d < 2) throw new Error(`the voice reference is ${d.toFixed(1)}s — fal needs at least 2s of audio`);
    },
    /** The first frame of a clip as a PNG. */
    async firstFrame(video, output, signal) {
      const r = await runChild("ffmpeg", ["-y", "-v", "error", "-ss", "0.1", "-i", video, "-frames:v", "1", output], { signal });
      if (r.code !== 0 || !existsSync(output)) throw new Error(`ffmpeg first-frame extraction failed: ${(r.stderr || "").trim().slice(-200)}`);
    },
    /**
     * Two more angles of the course's host from one frame, so every clip
     * carries the same face: reference images govern identity, prompt
     * words do not (a face described in words drifts scene to scene).
     */
    async characterSheet({ frame, outputs, styleRecipe }, signal) {
      const uri = `data:image/png;base64,${readFileSync(frame).toString("base64")}`;
      const angles = [
        "a three-quarter view, head and shoulders",
        "a medium close-up facing the camera, neutral expression",
      ];
      for (let i = 0; i < outputs.length; i++) {
        const prompt = `Character sheet. The same person as in the attached frame — identical face, hair, skin, outfit and accessories — shown as ${angles[i] ?? angles[0]}, in the same setting and lighting, in this exact visual style: ${styleRecipe}. No text, no labels, no watermark, 16:9.`;
        const dir = dirname(outputs[i]);
        const prefix = basename(outputs[i]).replace(/\.png$/, "");
        const r = await runChild(process.execPath, [GENERATE_IMAGE, prompt, "--model", "gpt-image-2", "--image-urls", uri, "--aspect-ratio", "16:9", "--quality", "medium", "--output-dir", dir, "--filename-prefix", prefix], { signal });
        if (r.code !== 0 || !existsSync(outputs[i])) throw new Error(`character sheet ${i + 1} failed: ${(r.stderr || "").trim().slice(-200)}`);
      }
    },
    async transcribe({ input, language }, signal) {
      const r = await runChild(process.execPath, [TRANSCRIBE, "--input", input, "--language", language, "--json"], { signal, cwd: setDir });
      if (r.code !== 0) throw new Error(`transcribe.mjs failed: ${(r.stderr || "").trim().slice(0, 300)}`);
      return String(JSON.parse(r.stdout).text ?? "");
    },
    judge: openrouterKey
      ? (args) => judgeNarration({ key: openrouterKey, model, ...args })
      : null,
    lastFrame: (video, out) => extractLastFrame(video, out),
    probe: (video) => probeDuration(video),
    /**
     * ffmpeg concat of the clips into one file. Stream copy when every clip
     * has the same stream shape and the result is as long as its parts;
     * otherwise the clips are brought to one format and re-encoded through
     * the concat filter. A stream-copy join of clips with mixed audio
     * sample rates once produced a 141 s file from 47 s of clips — the
     * demuxer does not check, so this does (2026-09-03).
     */
    async concat(inputs, output, signal) {
      const durations = inputs.map((f) => probeDuration(f) ?? 0);
      const expected = durations.reduce((sum, d) => sum + d, 0);
      const fits = () => {
        const d = probeDuration(output);
        return d != null && Math.abs(d - expected) <= 1.5;
      };
      // A join between two clips is a waveform discontinuity — a click.
      // Each shot's audio fades in and out over 30 ms at the seam; the
      // clips end on sentence boundaries, so nothing spoken is touched.
      const fade = (i, from) =>
        `[${from}:a]afade=t=in:st=0:d=${SEAM_FADE_S},afade=t=out:st=${Math.max(0, durations[i] - SEAM_FADE_S).toFixed(3)}:d=${SEAM_FADE_S}`;
      const shapes = inputs.map((f) => JSON.stringify(probeStreams(f)));
      const uniform = shapes.every((x) => x === shapes[0] && x !== "null");
      if (uniform) {
        // Video by stream copy through the concat demuxer; audio through
        // the fade chain, so only the audio is re-encoded.
        const list = `${output}.txt`;
        writeFileSync(list, inputs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
        try {
          const argv = ["-y", "-f", "concat", "-safe", "0", "-i", list];
          for (const f of inputs) argv.push("-i", f);
          const chains = inputs.map((_, i) => `${fade(i, i + 1)}[a${i}]`).join(";");
          const refs = inputs.map((_, i) => `[a${i}]`).join("");
          argv.push(
            "-filter_complex", `${chains};${refs}concat=n=${inputs.length}:v=0:a=1[a]`,
            "-map", "0:v", "-c:v", "copy",
            "-map", "[a]", "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
            "-movflags", "+faststart", output,
          );
          const copy = await runChild("ffmpeg", argv, { signal });
          if (copy.code === 0 && existsSync(output) && fits()) return;
        } finally {
          try { unlinkSync(list); } catch { /* fine */ }
        }
      }
      const first = probeStreams(inputs[0]);
      const w = first?.video?.width || 854;
      const h = first?.video?.height || 480;
      const argv = ["-y"];
      for (const f of inputs) argv.push("-i", f);
      const chains = inputs
        .map((_, i) => `[${i}:v]scale=${w}:${h},fps=24,format=yuv420p[v${i}];${fade(i, i)},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`)
        .join(";");
      const refs = inputs.map((_, i) => `[v${i}][a${i}]`).join("");
      argv.push(
        "-filter_complex", `${chains};${refs}concat=n=${inputs.length}:v=1:a=1[v][a]`,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", output,
      );
      const enc = await runChild("ffmpeg", argv, { signal });
      if (enc.code !== 0 || !existsSync(output)) throw new Error(`ffmpeg concat failed: ${(enc.stderr || "").trim().slice(-300)}`);
      if (!fits()) throw new Error(`ffmpeg concat produced ${probeDuration(output)}s from ${Math.round(expected)}s of clips`);
    },
  };
}

// ── The manager ─────────────────────────────────────────────────────────────

/**
 * createManager({ setDir, deps, slots, videoAhead, planAhead, log })
 *   .start()          — load, reconcile, watch state/ inputs
 *   .choose(nodeId)   — the learner's choice (also reached via state/choice.json)
 *   .retry(nodeId)    — re-request a failed/stuck scene
 *   .request({parent,label,brief}) — a question scene
 *   .reconcile()      — (re)schedule work from the current node
 *   .stop()           — cancel everything, exit
 */
export function createManager({ setDir, deps, slots = 3, videoAhead = 2, planAhead = 2, log = () => {}, pollMs = 500 }) {
  setDir = resolve(setDir);
  const stateDir = join(setDir, "state");
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(join(stateDir, "requests"), { recursive: true });

  let course = readCourse(setDir);
  const style = resolveStyle(course, existsSync(STYLES_MD) ? readFileSync(STYLES_MD, "utf-8") : "");
  const language = course.language ?? "zh";
  // The style's reference images: the anchor first, then the recurring
  // characters (the continuity kit may add a character sheet at start).
  let refImages = [];
  let styleAnchor = null;
  let characters = [];
  const reloadRefs = () => {
    refImages = (course.style?.refImages ?? []).filter((f) => typeof f === "string" && existsSync(join(setDir, f)));
    styleAnchor = refImages[0] ?? null;
    characters = refImages.slice(1);
  };
  reloadRefs();
  /** The course's voice reference, when the kit produced one. */
  const voiceRef = () => {
    const v = course.style?.voiceRef;
    return typeof v === "string" && existsSync(join(setDir, v)) ? v : null;
  };
  // Video work waits for the kit (voice reference, character sheet); the
  // planning queue does not need it.
  let kitReady = false;
  let kitPromise = Promise.resolve();

  // Every queue transition refreshes the snapshot; a key LEAVING the
  // active set (a job finished, failed or — after an abort — finally
  // settled) also schedules a reconcile. A reconcile run from inside the
  // job's own tail sees its key still active, so a retry of a scene that
  // was being shot could not re-queue it until the next choice (Codex
  // review of PR #144).
  let lastActive = new Set();
  let reconcileTimer = null;
  const scheduleReconcile = () => {
    if (stopped || reconcileTimer) return;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      reconcile();
    }, 0);
  };
  const onQueueChange = () => {
    const active = new Set([...planning.snapshot().active, ...video.snapshot().active].map((i) => i.key));
    const left = [...lastActive].some((k) => !active.has(k));
    lastActive = active;
    syncSnapshot();
    if (left) scheduleReconcile();
  };
  const planning = new AsyncJobQueue(3, onQueueChange);
  const video = new AsyncJobQueue(slots, onQueueChange);
  let stopped = false;
  let lastChoiceAt = "";
  let persistChain = Promise.resolve();

  const nodes = () => course.nodes;
  const current = () => course.play?.currentNode ?? course.path?.[course.path.length - 1] ?? course.rootNode;

  // ── persistence: merge our fields onto whatever is on disk ────────────
  function persist() {
    const snapshot = { nodes: structuredClone(course.nodes), path: [...(course.path ?? [])], play: structuredClone(course.play ?? {}) };
    persistChain = persistChain.then(() => {
      withCourseLock(setDir, (c) => {
        c.nodes = snapshot.nodes;
        c.path = snapshot.path;
        c.play = { ...snapshot.play, updatedAt: nowIso() };
        // Keep everything else (outline evidence still landing, style) as the disk has it.
        course.outline = c.outline;
        course.style = c.style;
        return c;
      });
    }).catch((e) => log(`persist failed: ${e.message}`));
    return persistChain;
  }
  function syncSnapshot() {
    const p = planning.snapshot();
    const v = video.snapshot();
    course.play = {
      ...(course.play ?? {}),
      state: course.play?.state ?? "warming",
      currentNode: current(),
      slots,
      videoAhead,
      planAhead,
      queued: [...p.queued.map((i) => i.key), ...v.queued.map((i) => i.key)],
      active: [...p.active.map((i) => i.key), ...v.active.map((i) => i.key)],
      pruned: course.play?.pruned ?? 0,
      updatedAt: nowIso(),
    };
  }
  function setNode(id, patch) {
    const n = nodes()[id];
    if (!n) return;
    Object.assign(n, patch);
    n.updatedAt = nowIso();
  }
  function setPhase(id, phase, extra = {}) {
    setNode(id, { phase, ...extra });
    void persist();
  }

  // ── scripting (planning queue) ─────────────────────────────────────────
  async function scriptNode(id, signal) {
    const n = nodes()[id];
    if (!n || (n.clips ?? []).length > 0 || !n.brief) return;
    if (!deps.chat) throw new Error("no OPENROUTER_API_KEY — detour and question scenes cannot be written");
    setNode(id, { status: "scripting", phase: "script", startedAt: nowIso(), error: null });
    await persist();
    const { clips, device, problems } = await writeDetourScene({ course, node: n, chat: deps.chat, styleRecipe: style.recipe, styleDevices: style.devices, narration: style.narration, language, setDir });
    signal?.throwIfAborted();
    if (!nodes()[id]) return; // pruned meanwhile
    if (!clips?.length) throw new Error(`the writer returned no clips${problems?.length ? `: ${problems.join("; ")}` : ""}`);
    setNode(id, {
      clips: clips.map((c, i) => ({ ...c, id: c.id ?? `c${i + 1}`, status: "planned" })),
      ...(device ? { device } : {}),
      status: "planned",
      phase: null,
      startedAt: null,
      problems: problems?.length ? problems : undefined,
    });
    await persist();
  }

  // ── rendering (video queue) ────────────────────────────────────────────
  /**
   * What one clip binds. Every clip gets the same shape — the style
   * anchor as Image 1, the recurring characters, then the figures this
   * clip's cuts name, and the course's voice as Audio 1 — because that
   * is where continuity now comes from. A figure carries the cut it
   * belongs to, so the prompt can say when it appears.
   */
  function clipRefs(node, clip) {
    // Figures the clip shows, resolved against the beat's evidence, in
    // the order of the cuts that show them.
    const beat = (course.outline ?? []).find((b) => b.id === node.beat) ?? null;
    const evidence = beat ? resolveEvidence({ setDir, beat, nodeId: node.id }) : [];
    const offered = shootableFigures(evidence);
    const cutOf = new Map();
    (clip.cuts ?? []).forEach((cut, i) => {
      for (const f of cut.figures ?? []) {
        const key = basename(String(f));
        if (!cutOf.has(key)) cutOf.set(key, i + 1);
      }
    });
    const wanted = (clip.figures ?? []).map(String);
    const bound = offered
      .filter((f) => wanted.some((w) => w === f.file || basename(w) === basename(f.file)))
      .map((f) => ({ ...f, cut: cutOf.get(basename(f.file)) }))
      .sort((a, b) => (a.cut ?? 99) - (b.cut ?? 99));
    // fal analyses at most MAX_REFS images: one is the style anchor, the
    // course's recurring characters take the next, and the figures share
    // what is left. A clip over that budget would lose its last figure
    // silently at the shoot — it fails here instead, naming the split the
    // screenplay needs.
    const anchored = styleAnchor ? 1 : 0;
    const budget = MAX_REFS - anchored - characters.length;
    if (bound.length > budget) {
      throw new Error(
        `${node.id}/${clip.id}: ${bound.length} figures with ${anchored ? "the style anchor and " : ""}${characters.length} character reference${characters.length === 1 ? "" : "s"} exceed the ${MAX_REFS} reference slots (${Math.max(0, budget)} left for figures) — split the figures across clips`,
      );
    }
    const voice = voiceRef();
    const plan = planRefs({
      anchorFile: styleAnchor,
      anchorKind: "style-anchor",
      characters,
      figures: bound,
      voice,
      narration: style.narration,
      mode: "reference",
    });
    if (plan.refs.length === 0) return { mode: "text", refs: [], audios: [], lines: [] };
    return {
      mode: "reference",
      refs: plan.refs.filter((r) => r.kind !== "audio").map((r) => join(setDir, r.file)),
      audios: plan.refs.filter((r) => r.kind === "audio").map((r) => join(setDir, r.file)),
      lines: plan.lines,
    };
  }

  /**
   * The continuity kit, made once per course before the first clip: the
   * confirmed sample's narration as the voice reference, and for a course
   * with a speaker on screen (or references the learner supplied) a
   * character sheet — two more angles of the host from the sample's
   * first frame — so identity rides on images, not on prompt words.
   * Every step is best effort and reported: a course without a sample
   * still shoots, without a voice reference.
   */
  async function ensureContinuityKit() {
    const sample = course.style?.sample?.video;
    const sampleAbs = typeof sample === "string" ? join(setDir, sample) : null;
    if (!sampleAbs || !existsSync(sampleAbs)) {
      log("continuity kit: no confirmed sample on file — shooting without a voice reference");
      return;
    }
    const patch = {};
    if (!voiceRef() && typeof deps.extractAudio === "function") {
      try {
        await deps.extractAudio(sampleAbs, join(setDir, VOICE_REF));
        patch.voiceRef = VOICE_REF;
        log(`continuity kit: voice reference ${VOICE_REF} from the sample`);
      } catch (e) {
        log(`continuity kit: voice reference failed (${e.message}) — shooting without it`);
      }
    }
    // The sheet is only for a course that actually has a person to keep:
    // measured 2026-09-04 on the teacher style, the anchor still already
    // shows the host and every reference clip kept the same face without
    // it, while the two sheet images cost 77 s once and two of the four
    // reference slots on every clip.
    const wantsSheet = style.narration === "on-camera" || (course.style?.userRefs ?? []).length > 0;
    const hasSheet = Array.isArray(course.style?.characterSheet) && course.style.characterSheet.every((f) => existsSync(join(setDir, f)));
    if (wantsSheet && !hasSheet && typeof deps.characterSheet === "function" && typeof deps.firstFrame === "function") {
      try {
        const frame = join(setDir, "style", "character-0.png");
        await deps.firstFrame(sampleAbs, frame);
        const outputs = CHARACTER_SHEET.map((f) => join(setDir, f));
        await deps.characterSheet({ frame, outputs, styleRecipe: style.recipe }, undefined);
        patch.characterSheet = [...CHARACTER_SHEET];
        const userRefs = (course.style?.userRefs ?? []).filter((f) => typeof f === "string");
        patch.refImages = [...(styleAnchor ? [styleAnchor] : []), ...CHARACTER_SHEET, ...userRefs.filter((f) => f !== styleAnchor)];
        log(`continuity kit: character sheet ${CHARACTER_SHEET.join(", ")}`);
      } catch (e) {
        log(`continuity kit: character sheet failed (${e.message}) — shooting without it`);
      }
    }
    if (Object.keys(patch).length) {
      withCourseLock(setDir, (c) => {
        c.style = { ...(c.style ?? {}), ...patch };
        course.style = c.style;
        return c;
      });
      reloadRefs();
    }
  }

  /**
   * What the evidence panel shows for a scene: the beat's citations and
   * verifications, plus the figures its clips actually put on screen; a
   * question scene's own evidence directory rides along.
   */
  function sceneEvidence(node) {
    const beat = (course.outline ?? []).find((b) => b.id === node.beat) ?? null;
    const all = resolveEvidence({ setDir, beat, nodeId: node.id });
    const shown = new Set((node.clips ?? []).flatMap((c) => (c.figures ?? []).map((f) => basename(String(f)))));
    const isFigure = (e) => e.file && /\.(png|jpe?g|webp)$/i.test(e.file);
    return all
      .filter((e) => !isFigure(e) || shown.has(basename(e.file)) || (node.kind === "question" && String(e.file).startsWith(`evidence/${node.id}/`)))
      .map((e) => ({ kind: e.kind, file: e.file, url: e.url, note: e.note ?? "" }));
  }

  /**
   * Transcribe the clip, twice if the first attempt fails. Narration that
   * cannot be checked is not narration that passed: a transcriber outage
   * used to wave the clip through as "skipped", which is exactly the clip
   * this mode promises never to show. The file stays on disk under the
   * clip as `unchecked`, so a retry checks it again without paying for
   * another render.
   */
  async function transcribeClip(node, clip, result, signal) {
    let last = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await deps.transcribe({ input: result.url ?? join(setDir, clip.video.file), language }, signal);
      } catch (e) {
        if (isAbort(e, signal)) throw e;
        last = e;
        if (attempt === 1) {
          log(`${node.id}/${clip.id}: transcription failed (${e.message}) — trying once more`);
          await sleep(TRANSCRIBE_RETRY_MS, signal);
        }
      }
    }
    clip.status = "unchecked";
    throw new Error(`${node.id}/${clip.id}: narration could not be checked — transcription failed twice (${last?.message}); the clip is kept and 再拍一次 checks it again`);
  }

  /** The whole clip's narration against the whole clip's transcript: the
   * lines are spread across the montage, and H3 places them itself. */
  async function qaClip(node, clip, result, signal) {
    const transcript = await transcribeClip(node, clip, result, signal);
    const cmp = compareNarration(clipScript(clip, language), transcript);
    const sim = Math.round(cmp.similarity * 1000) / 1000;
    const coverage = Math.round(cmp.coverage * 1000) / 1000;
    let verdict = autoVerdict(sim, coverage);
    let judge = "auto";
    let reason = "";
    if (verdict == null) {
      if (deps.judge) {
        try {
          const j = await deps.judge({ script: clipScript(clip, language), transcript, language, similarity: sim, coverage });
          verdict = j.verdict;
          reason = j.reason;
          judge = "luna";
        } catch {
          verdict = sim >= 0.9 ? "pass" : "fail";
          judge = "keyless";
        }
      } else {
        verdict = sim >= 0.9 ? "pass" : "fail";
        judge = "keyless";
      }
    }
    return { verdict, judge, reason, similarity: sim, coverage, transcript };
  }

  async function renderScene(id, signal) {
    const node = nodes()[id];
    if (!node || node.status === "ready") return;
    const nodeDir = join(setDir, "nodes", id);
    mkdirSync(nodeDir, { recursive: true });
    const clips = node.clips ?? [];
    setNode(id, { status: "generating", phase: "shoot", startedAt: nowIso(), clipIndex: 1, clipCount: clips.length, error: null });
    await persist();
    const outputs = [];
    for (let i = 0; i < clips.length; i++) {
      signal?.throwIfAborted();
      const clip = clips[i];
      const clipFile = `nodes/${id}/${clip.id}.mp4`;
      // The clip's last frame is what the interlude shows while the next
      // scene is still being shot. It is no longer a first frame for
      // anything: the chain is retired.
      const frameOf = (rel) => {
        const frame = `nodes/${id}/${clip.id}.last.png`;
        deps.lastFrame(join(setDir, rel), join(setDir, frame));
      };
      if (clip.status === "ready" && clip.video?.file && existsSync(join(setDir, clip.video.file))) {
        // A clip that survived an earlier attempt is not paid for twice.
        outputs.push(join(setDir, clip.video.file));
        frameOf(clip.video.file);
        continue;
      }
      setPhase(id, "shoot", { clipIndex: i + 1 });
      const refs = clipRefs(node, clip);
      const prompt = refs.lines.length ? insertReferenceBlock(clip.videoPrompt, refs.lines) : clip.videoPrompt;
      let done = null;
      let lastQa = null;
      // A clip whose narration could not be checked last time is checked
      // first; it is rendered again only if that check fails.
      const unchecked = clip.status === "unchecked" && clip.video?.file && existsSync(join(setDir, clip.video.file));
      for (let attempt = 1; attempt <= 2 && !done; attempt++) {
        let result;
        if (attempt === 1 && unchecked) {
          result = { duration: clip.video.duration };
        } else {
          result = await deps.renderClip({ prompt, output: join(setDir, clipFile), duration: clip.duration, image: refs.mode === "image" ? refs.image : undefined, refImages: refs.mode === "reference" ? refs.refs : [], refAudios: refs.mode === "reference" ? refs.audios ?? [] : [], seed: attempt === 1 ? undefined : Math.floor(Math.random() * 2 ** 31) }, signal);
          clip.video = { file: clipFile, duration: Number(result.duration ?? deps.probe(join(setDir, clipFile)) ?? clip.duration) };
          clip.h3Practices = H3_PRACTICES_VERSION;
        }
        setPhase(id, "qa", { clipIndex: i + 1 });
        const qa = await qaClip(node, clip, result, signal);
        signal?.throwIfAborted();
        lastQa = qa;
        if (qa.verdict === "pass") done = { result, qa };
        else if (attempt === 1) {
          try { renameSync(join(setDir, clipFile), join(nodeDir, `${clip.id}.rejected.mp4`)); } catch { /* fine */ }
          log(`${id}/${clip.id}: narration QA failed (similarity ${qa.similarity}) — re-shooting with a fresh seed`);
        }
      }
      if (!done) throw new Error(`${id}/${clip.id}: narration QA failed twice (similarity ${lastQa?.similarity})`);
      clip.status = "ready";
      clip.qa = { similarity: done.qa.similarity, coverage: done.qa.coverage, verdict: done.qa.verdict, judge: done.qa.judge };
      clip.endpoint = refs.mode;
      outputs.push(join(setDir, clipFile));
      frameOf(clipFile);
      await persist();
    }
    signal?.throwIfAborted();
    const finalRel = `nodes/${id}/video.mp4`;
    const finalAbs = join(setDir, finalRel);
    if (outputs.length === 1) {
      // A single-clip scene IS its clip. When the surviving file already
      // is the scene file (a re-run over a scene that was ready), there
      // is nothing to move — renaming it onto itself would delete it.
      if (outputs[0] !== finalAbs) {
        try { unlinkSync(finalAbs); } catch { /* none */ }
        renameSync(outputs[0], finalAbs);
      }
      clips[0].video.file = finalRel;
    } else {
      await deps.concat(outputs, finalAbs, signal);
    }
    const duration = deps.probe(finalAbs) ?? clips.reduce((s, x) => s + (x.video?.duration ?? x.duration), 0);
    writeFileSync(join(nodeDir, "script.md"), `# ${node.choiceLabel ?? id}\n\n${clips.map((c) => clipScript(c, language)).join("\n\n")}\n`);
    writeFileSync(join(nodeDir, "evidence.json"), JSON.stringify(sceneEvidence(node), null, 2));
    setNode(id, { status: "ready", video: { file: finalRel, duration }, phase: null, startedAt: null, clipIndex: null, error: null });
    if (id === course.rootNode) course.play.state = "playing";
    await persist();
    log(`${id} ready (${clips.length} clip${clips.length === 1 ? "" : "s"}, ${Math.round(duration)}s)`);
  }

  // ── scheduling ─────────────────────────────────────────────────────────
  function isDone(n) { return n.status === "ready" || n.status === "cancelled"; }
  function needsScript(n) { return (n.clips ?? []).length === 0 && !!n.brief && n.status !== "cancelled" && n.status !== "failed"; }

  function reconcile() {
    if (stopped) return;
    const from = current();
    // `videoAhead` scenes ahead means distances 1..videoAhead from the
    // scene on stage (distance 0): "two ahead" is the next two main
    // scenes and the detours they offer, not three.
    const window = descendantWindow(nodes(), from, Math.max(videoAhead, planAhead));
    // A learner's question is scheduled wherever it hangs: they asked it,
    // they are waiting for it. One filed under a scene they had already
    // left sat outside the window for six minutes (2026-09-03).
    const inWindowIds = new Set(window.map((i) => i.id));
    for (const [id, n] of Object.entries(nodes())) {
      if (n.kind === "question" && !inWindowIds.has(id)) window.push({ id, distance: 0 });
    }
    for (const { id, distance } of window) {
      const n = nodes()[id];
      if (!n || isDone(n) || n.status === "failed") continue;
      const priority = distance * 100 + (n.kind === "question" ? -50 : n.kind === "main" ? 0 : 10);
      // The queues reconcile when a job's key leaves them (onQueueChange),
      // which is after these tails have run — a reconcile inside the tail
      // would still see the key as active.
      if (needsScript(n) && distance <= planAhead) {
        planning.enqueue(id, priority, async (signal) => {
          try {
            await scriptNode(id, signal);
          } catch (e) {
            if (isAbort(e, signal)) return;
            log(`${id}: scripting failed: ${e.message}`);
            setNode(id, { status: "failed", phase: null, error: `写稿失败：${e.message}`.slice(0, 240) });
            await persist();
          }
        });
        continue;
      }
      if (kitReady && (n.clips ?? []).length > 0 && n.status === "planned" && distance <= videoAhead) {
        // Marked before the enqueue: a job that starts at once sets
        // `generating` synchronously, and a mark after the call would
        // put "排队中" over a shoot in progress (seen 2026-09-03).
        setNode(id, { status: "queued" });
        const queued = video.enqueue(id, priority, async (signal) => {
          try {
            await renderScene(id, signal);
          } catch (e) {
            if (isAbort(e, signal)) return;
            log(`${id}: rendering failed: ${e.message}`);
            setNode(id, { status: "failed", phase: null, startedAt: null, error: String(e.message).slice(0, 240) });
            await persist();
          }
        });
        if (!queued && nodes()[id]?.status === "queued") setNode(id, { status: "planned" });
      }
    }
    // Anything queued that fell out of the window is stood down.
    const inWindow = new Set(window.map((i) => i.id));
    video.cancelWhere((key) => !inWindow.has(key));
    planning.cancelWhere((key) => !inWindow.has(key));
    for (const [id, n] of Object.entries(nodes())) {
      if (n.status === "queued" && !inWindow.has(id)) n.status = "planned";
    }
    syncSnapshot();
    void persist();
  }

  // ── learner inputs ─────────────────────────────────────────────────────
  function choose(nodeId) {
    const target = nodes()[nodeId];
    if (!target) return log(`choice ignored: ${nodeId} is not a node`);
    const parentId = target.parent;
    const siblings = parentId ? (nodes()[parentId]?.children ?? []).map((c) => c.nodeId).filter((id) => id !== nodeId) : [];
    // Prune the unchosen subtrees: cancel their work, mark them, keep them
    // on the map as roads not taken. A detour's "回到主线" edge leads back
    // onto the spine, so a sibling's subtree can contain the whole rest of
    // the course — everything reachable from the chosen scene is kept.
    const keep = new Set(subtreeIds(nodes(), nodeId));
    let pruned = 0;
    for (const sib of siblings) {
      for (const id of subtreeIds(nodes(), sib)) {
        if (keep.has(id)) continue;
        const n = nodes()[id];
        if (!n || n.status === "ready" || n.status === "cancelled") continue;
        video.cancel(id);
        planning.cancel(id);
        n.status = "cancelled";
        n.phase = null;
        pruned++;
      }
    }
    // A road not taken earlier can be taken now (the learner went back on
    // the map): everything under it that was stood down is planned again.
    for (const id of subtreeIds(nodes(), nodeId)) {
      const n = nodes()[id];
      if (n?.status === "cancelled") { n.status = "planned"; n.phase = null; n.error = null; }
    }
    course.path = [...(course.path ?? []).filter((id) => id !== nodeId), nodeId];
    course.play = { ...(course.play ?? {}), currentNode: nodeId, pruned: (course.play?.pruned ?? 0) + pruned };
    if (target.kind === "main" && !(target.children ?? []).some((c) => nodes()[c.nodeId]?.kind === "main")) {
      course.play.state = "complete";
    }
    log(`choice: ${nodeId} (${target.choiceLabel ?? ""}); pruned ${pruned}`);
    reconcile();
  }
  function retry(nodeId) {
    const n = nodes()[nodeId];
    if (!n) return;
    video.cancel(nodeId);
    planning.cancel(nodeId);
    // A retry of a scene that is READY is the learner asking for a new
    // take of the whole scene (a garbled figure, a mis-drawn board):
    // every shot is shot again. A retry of a failed or stuck scene keeps
    // the clips that passed and the one whose narration is still to be
    // checked — neither is paid for twice.
    const whole = n.status === "ready" || !!n.video;
    for (const s of n.clips ?? []) {
      if (whole || (s.status !== "ready" && s.status !== "unchecked")) { s.status = "planned"; delete s.video; delete s.qa; }
    }
    setNode(nodeId, { status: "planned", video: undefined, phase: null, startedAt: null, clipIndex: null, error: null });
    log(`retry: ${nodeId}${whole ? " (a new take of every shot)" : ""}`);
    reconcile();
  }
  function request({ parent, label, brief }) {
    const asked = nodes()[parent];
    if (!asked) return log(`request ignored: parent ${parent} unknown`);
    // The answer is offered where the learner is now: if they have moved
    // on from the scene they asked about, the card hangs off the scene on
    // stage (the evidence still belongs to the beat they asked about).
    const cur = current();
    const hangOn = cur !== parent && subtreeIds(nodes(), parent).includes(cur) ? cur : parent;
    const p = nodes()[hangOn];
    const id = `q${Object.keys(nodes()).filter((k) => /^q\d+$/.test(k)).length + 1}`;
    nodes()[id] = { parent: hangOn, beat: asked.beat, kind: "question", choiceLabel: label, brief, status: "planned", clips: [], children: [{ nodeId: (p.children ?? []).find((c) => nodes()[c.nodeId]?.kind === "main")?.nodeId, label: "回到主线" }].filter((c) => c.nodeId) };
    p.children = [...(p.children ?? []), { nodeId: id, label }];
    log(`question scene ${id} under ${hangOn}${hangOn !== parent ? ` (asked at ${parent})` : ""}: ${label}`);
    reconcile();
  }

  // ── inputs from disk ───────────────────────────────────────────────────
  function pollInputs() {
    const choicePath = join(stateDir, "choice.json");
    if (existsSync(choicePath)) {
      try {
        const c = JSON.parse(readFileSync(choicePath, "utf-8"));
        if (c && typeof c.at === "string" && c.at > lastChoiceAt) {
          lastChoiceAt = c.at;
          // Both may ride in one write: a failed or pruned scene the
          // learner picks is reset first, then becomes the current one.
          if (c.retry) retry(String(c.retry));
          if (c.choose) choose(String(c.choose));
        }
      } catch { /* half-written; next tick */ }
    }
    const reqDir = join(stateDir, "requests");
    for (const f of readdirSync(reqDir)) {
      if (!f.endsWith(".json")) continue;
      const p = join(reqDir, f);
      try {
        const r = JSON.parse(readFileSync(p, "utf-8"));
        request(r);
        renameSync(p, `${p}.done`);
      } catch (e) {
        log(`request ${f} ignored: ${e.message}`);
        try { renameSync(p, `${p}.bad`); } catch { /* fine */ }
      }
    }
  }

  let timer = null;
  let heartbeat = null;
  return {
    get course() { return course; },
    start() {
      course = readCourse(setDir);
      // A manager that died mid-shot leaves scenes "generating": they are ours again.
      for (const n of Object.values(nodes())) {
        if (n.status === "generating" || n.status === "queued" || n.status === "scripting") { n.status = "planned"; n.phase = null; }
      }
      lastActive = new Set();
      course.play = { ...(course.play ?? {}), state: course.play?.state === "complete" ? "complete" : nodes()[course.rootNode]?.status === "ready" ? "playing" : "warming", currentNode: current() };
      if (!course.path?.length && course.rootNode) course.path = [course.rootNode];
      const choicePath = join(stateDir, "choice.json");
      if (existsSync(choicePath)) { try { lastChoiceAt = JSON.parse(readFileSync(choicePath, "utf-8")).at ?? ""; } catch { /* fine */ } }
      writeFileSync(join(stateDir, "manager.pid"), String(process.pid));
      // Scripting starts at once; shooting waits for the kit (a minute at
      // most: an audio extraction and, for a speaker on screen, two
      // images). The snapshot is written first so the viewer sees a live
      // manager while the kit is made.
      syncSnapshot();
      void persist();
      reconcile();
      kitPromise = ensureContinuityKit()
        .catch((e) => log(`continuity kit: ${e.message}`))
        .finally(() => {
          kitReady = true;
          reconcile();
        });
      timer = setInterval(() => { try { pollInputs(); } catch (e) { log(`poll: ${e.message}`); } }, pollMs);
      // The heartbeat: while a shot waits on fal nothing else writes the
      // snapshot, and a silent snapshot reads as a dead process.
      heartbeat = setInterval(() => {
        const busy = video.snapshot().active.length + planning.snapshot().active.length > 0;
        if (busy) { syncSnapshot(); void persist(); }
      }, Math.max(pollMs, 20_000));
      return this;
    },
    choose, retry, request, reconcile,
    queues: () => ({ planning: planning.snapshot(), video: video.snapshot() }),
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (heartbeat) clearInterval(heartbeat);
      if (reconcileTimer) { clearTimeout(reconcileTimer); reconcileTimer = null; }
      video.cancelWhere(() => true);
      planning.cancelWhere(() => true);
      await persistChain;
      try { unlinkSync(join(stateDir, "manager.pid")); } catch { /* fine */ }
    },
    // Idle means the kit is made and both queues are empty — a `--once`
    // run that asked before the kit finished would have exited with
    // nothing shot.
    whenIdle: async () => { await kitPromise; await planning.whenIdle(); await video.whenIdle(); await persistChain; },
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { values: args } = parseArgs({
    options: {
      set: { type: "string" },
      slots: { type: "string", default: "3" },
      "video-ahead": { type: "string", default: "2" },
      "plan-ahead": { type: "string", default: "2" },
      resolution: { type: "string", default: "480P" },
      // 0.5's continuity switch. Every clip now carries the anchor and
      // the voice, so there is nothing to choose — but a session resumed
      // with the old skill text still passes it, and dying on an
      // unknown flag would leave the learner on "等待开拍".
      continuity: { type: "string" },
      model: { type: "string" },
      once: { type: "boolean", default: false },
      detach: { type: "boolean", default: false },
    },
  });
  if (!args.set) { console.error("ERROR: --set is required"); process.exit(1); }
  const setDir = resolve(args.set);
  const logPath = join(setDir, "state", "manager.log");
  const pidPath = join(setDir, "state", "manager.pid");
  mkdirSync(dirname(logPath), { recursive: true });

  // One manager per course. A live pid file means the work is already in
  // hand: say so and leave — a second manager would fight the first for
  // the same slots and the same course.json.
  const livePid = () => {
    try {
      const pid = Number(readFileSync(pidPath, "utf-8").trim());
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) { process.kill(pid, 0); return pid; }
    } catch { /* no file, or a dead pid */ }
    return null;
  };
  const running = livePid();
  if (running) {
    console.log(JSON.stringify({ pid: running, log: logPath, alreadyRunning: true }));
    process.exit(0);
  }

  if (args.detach) {
    const outPath = join(setDir, "state", "manager.out");
    const fd = openSync(outPath, "a");
    const argv = process.argv.slice(2).filter((a) => a !== "--detach");
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv], {
      detached: true,
      stdio: ["ignore", fd, fd],
      cwd: process.cwd(),
      env: process.env,
    });
    child.unref();
    const deadline = Date.now() + 8000;
    let started = false;
    while (Date.now() < deadline) {
      if (existsSync(pidPath) && readFileSync(pidPath, "utf-8").trim() === String(child.pid)) { started = true; break; }
      if (child.exitCode != null) break;
      await sleep(150);
    }
    if (started) {
      console.log(JSON.stringify({ pid: child.pid, log: logPath }));
      process.exit(0);
    }
    let tail = "";
    try { tail = readFileSync(outPath, "utf-8").slice(-1500); } catch { /* nothing written */ }
    console.error(`ERROR: the play manager did not start (see ${outPath})${tail ? `\n${tail}` : ""}`);
    process.exit(1);
  }

  // A detached child outlives the shell that started it: the hang-up that
  // shell sends on exit must not be its end.
  process.on("SIGHUP", () => {});
  const log = (msg) => {
    const line = `${nowIso()} ${msg}\n`;
    appendFileSync(logPath, line);
    process.stderr.write(line);
  };
  const manager = createManager({
    setDir,
    deps: defaultDeps({ setDir, resolution: args.resolution.toUpperCase(), model: args.model ?? DEFAULT_MODEL }),
    slots: Math.max(1, Number(args.slots) || 3),
    videoAhead: Math.max(1, Number(args["video-ahead"]) || 2),
    planAhead: Math.max(1, Number(args["plan-ahead"]) || 2),
    log,
  }).start();
  log(`play-manager started for ${setDir} (slots ${args.slots}, video-ahead ${args["video-ahead"]}, h3 practices ${H3_PRACTICES_VERSION})`);
  if (args.continuity) log(`--continuity ${args.continuity} ignored: every clip carries the style anchor and the voice since 0.6`);
  const shutdown = async (sig) => { log(`${sig}: stopping`); await manager.stop(); process.exit(0); };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  if (args.once) { await manager.whenIdle(); await manager.stop(); process.exit(0); }
}
