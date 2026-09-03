#!/usr/bin/env node

/**
 * play-manager — the play loop of a plotwise course, as one long-running
 * program. After the director has confirmed the style, planned the
 * outline and landed the screenplay, this process owns everything the
 * learner sees change: it writes detour and question scripts ahead of
 * them (planning queue, Luna), renders scenes shot by shot ahead of them
 * (video queue, H3 slots), prunes what they did not choose, and records
 * the path. No model is ever called on the click path: a choice is a
 * file the viewer writes, and the manager answers by switching the
 * current node and re-prioritising work.
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
 *   nodes/<id>/s<k>.mp4, nodes/<id>/video.mp4, state/manager.log,
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
  autoVerdict,
  chatJson,
  compareNarration,
  extractLastFrame,
  injectBindings,
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_ROOT = dirname(__dirname);
const GENERATE_VIDEO = join(__dirname, "generate-video.mjs");
const TRANSCRIBE = join(__dirname, "transcribe.mjs");
const STYLES_MD = join(SKILL_ROOT, "references", "styles.md");

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

/** How long one shot may take at fal, queue wait included, before it is retried. */
export const SHOT_DEADLINE_S = 360;

// ── Default production dependencies (the paid ones) ─────────────────────────

export function defaultDeps({ setDir, resolution = "480P", model = DEFAULT_MODEL } = {}) {
  const openrouterKey = loadEnvKey("OPENROUTER_API_KEY", { skillRoot: SKILL_ROOT, cwd: setDir });
  return {
    model,
    chat: openrouterKey
      ? ({ system, user }) => chatJson({ key: openrouterKey, model, system, user, temperature: 0.4 })
      : null,
    /** Render one shot to `output`; returns generate-video's JSON. */
    async renderShot({ prompt, output, duration, image, refImages = [], seed }, signal) {
      // A shot that fal has not returned in six minutes is re-tried, not
      // waited on: the learner is watching a clock. (Three 768P openings
      // once sat 21 minutes in fal's queue under the generator's own
      // 15-minute deadline, 2026-09-03.)
      const argv = ["--prompt", prompt, "--output", output, "--duration", String(duration), "--resolution", resolution, "--expansion", "balanced", "--deadline-s", String(SHOT_DEADLINE_S), "--json"];
      if (image) argv.push("--image", image);
      else if (refImages.length) for (const r of refImages) argv.push("--ref-image", r);
      else argv.push("--endpoint", "text");
      if (seed != null) argv.push("--seed", String(seed));
      const r = await runChild(process.execPath, [GENERATE_VIDEO, ...argv], { signal, cwd: setDir });
      if (r.code !== 0) throw new Error(`generate-video.mjs failed: ${(r.stderr || "").trim().slice(0, 400)}`);
      return JSON.parse(r.stdout);
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
     * ffmpeg concat of the shots into one file. Stream copy when every shot
     * has the same stream shape and the result is as long as its parts;
     * otherwise the shots are brought to one format and re-encoded through
     * the concat filter. A stream-copy join of shots with mixed audio
     * sample rates once produced a 141 s file from 47 s of shots — the
     * demuxer does not check, so this does (2026-09-03).
     */
    async concat(inputs, output, signal) {
      const expected = inputs.reduce((sum, f) => sum + (probeDuration(f) ?? 0), 0);
      const fits = () => {
        const d = probeDuration(output);
        return d != null && Math.abs(d - expected) <= 1.5;
      };
      const shapes = inputs.map((f) => JSON.stringify(probeStreams(f)));
      const uniform = shapes.every((x) => x === shapes[0] && x !== "null");
      if (uniform) {
        const list = `${output}.txt`;
        writeFileSync(list, inputs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
        try {
          const copy = await runChild("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", output], { signal });
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
        .map((_, i) => `[${i}:v]scale=${w}:${h},fps=24,format=yuv420p[v${i}];[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`)
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
      if (!fits()) throw new Error(`ffmpeg concat produced ${probeDuration(output)}s from ${Math.round(expected)}s of shots`);
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
  const refImages = (course.style?.refImages ?? []).filter((f) => typeof f === "string" && existsSync(join(setDir, f)));
  const styleAnchor = refImages[0] ?? null;
  const characters = refImages.slice(1);

  const planning = new AsyncJobQueue(3, () => syncSnapshot());
  const video = new AsyncJobQueue(slots, () => syncSnapshot());
  const jobs = new Map(); // nodeId → { kind, promise }
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
    if (!n || (n.shots ?? []).length > 0 || !n.brief) return;
    if (!deps.chat) throw new Error("no OPENROUTER_API_KEY — detour and question scenes cannot be written");
    setNode(id, { status: "scripting", phase: "script", startedAt: nowIso(), error: null });
    await persist();
    const { shots, problems } = await writeDetourScene({ course, node: n, chat: deps.chat, styleRecipe: style.recipe, narration: style.narration, language, setDir });
    signal?.throwIfAborted();
    if (!nodes()[id]) return; // pruned meanwhile
    if (!shots?.length) throw new Error(`the writer returned no shots${problems?.length ? `: ${problems.join("; ")}` : ""}`);
    setNode(id, { shots: shots.map((s, i) => ({ ...s, id: s.id ?? `s${i + 1}`, status: "planned" })), status: "planned", phase: null, startedAt: null, problems: problems?.length ? problems : undefined });
    await persist();
  }

  // ── rendering (video queue) ────────────────────────────────────────────
  function shotRefs(node, shot, prevFrame) {
    // Figures the shot shows, resolved against the beat's evidence.
    const beat = (course.outline ?? []).find((b) => b.id === node.beat) ?? null;
    const evidence = beat ? resolveEvidence({ setDir, beat, nodeId: node.id }) : [];
    const offered = shootableFigures(evidence);
    const wanted = (shot.figures ?? []).map(String);
    const bound = offered.filter((f) => wanted.some((w) => w === f.file || basename(w) === basename(f.file)));
    if (prevFrame) {
      // Inside a scene: continue from the previous shot's last frame.
      if (bound.length === 0 && characters.length === 0) {
        return { mode: "image", image: join(setDir, prevFrame), refs: [], lines: [] };
      }
      const plan = planRefs({ anchorFile: prevFrame, anchorKind: "continuity", characters, figures: bound, mode: "reference" });
      return { mode: "reference", refs: plan.refs.map((r) => join(setDir, r.file)), lines: plan.lines };
    }
    // A scene opening: the style anchor as a look reference (a cut is fine
    // between scenes), plus whatever the shot shows.
    if (styleAnchor) {
      const plan = planRefs({ anchorFile: styleAnchor, anchorKind: "style-anchor", characters, figures: bound, mode: "reference" });
      return { mode: "reference", refs: plan.refs.map((r) => join(setDir, r.file)), lines: plan.lines };
    }
    if (bound.length) {
      const plan = planRefs({ anchorFile: null, characters, figures: bound, mode: "reference" });
      return { mode: "reference", refs: plan.refs.map((r) => join(setDir, r.file)), lines: plan.lines };
    }
    return { mode: "text", refs: [], lines: [] };
  }

  /**
   * What the evidence panel shows for a scene: the beat's citations and
   * verifications, plus the figures its shots actually put on screen; a
   * question scene's own evidence directory rides along.
   */
  function sceneEvidence(node) {
    const beat = (course.outline ?? []).find((b) => b.id === node.beat) ?? null;
    const all = resolveEvidence({ setDir, beat, nodeId: node.id });
    const shown = new Set((node.shots ?? []).flatMap((s) => (s.figures ?? []).map((f) => basename(String(f)))));
    const isFigure = (e) => e.file && /\.(png|jpe?g|webp)$/i.test(e.file);
    return all
      .filter((e) => !isFigure(e) || shown.has(basename(e.file)) || (node.kind === "question" && String(e.file).startsWith(`evidence/${node.id}/`)))
      .map((e) => ({ kind: e.kind, file: e.file, url: e.url, note: e.note ?? "" }));
  }

  async function qaShot(node, shot, result, signal) {
    let transcript = "";
    try {
      transcript = await deps.transcribe({ input: result.url ?? join(setDir, shot.video.file), language }, signal);
    } catch (e) {
      if (isAbort(e, signal)) throw e;
      return { verdict: "pass", judge: "skipped", reason: `transcription unavailable: ${e.message}`, similarity: null, coverage: null };
    }
    const cmp = compareNarration(shot.script, transcript);
    const sim = Math.round(cmp.similarity * 1000) / 1000;
    const coverage = Math.round(cmp.coverage * 1000) / 1000;
    let verdict = autoVerdict(sim, coverage);
    let judge = "auto";
    let reason = "";
    if (verdict == null) {
      if (deps.judge) {
        try {
          const j = await deps.judge({ script: shot.script, transcript, language, similarity: sim, coverage });
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
    const shots = node.shots ?? [];
    setNode(id, { status: "generating", phase: "shoot", startedAt: nowIso(), shotIndex: 1, shotCount: shots.length, error: null });
    await persist();
    let prevFrame = null;
    const outputs = [];
    for (let i = 0; i < shots.length; i++) {
      signal?.throwIfAborted();
      const shot = shots[i];
      const shotFile = `nodes/${id}/${shot.id}.mp4`;
      if (shot.status === "ready" && shot.video?.file && existsSync(join(setDir, shot.video.file))) {
        // A shot that survived an earlier attempt is not paid for twice.
        outputs.push(join(setDir, shot.video.file));
        const frame = `nodes/${id}/${shot.id}.last.png`;
        if (deps.lastFrame(join(setDir, shot.video.file), join(setDir, frame))) prevFrame = frame;
        continue;
      }
      setPhase(id, "shoot", { shotIndex: i + 1 });
      const refs = shotRefs(node, shot, prevFrame);
      const prompt = refs.lines.length ? injectBindings(shot.videoPrompt, refs.lines) : shot.videoPrompt;
      let done = null;
      let lastQa = null;
      for (let attempt = 1; attempt <= 2 && !done; attempt++) {
        const result = await deps.renderShot({ prompt, output: join(setDir, shotFile), duration: shot.duration, image: refs.mode === "image" ? refs.image : undefined, refImages: refs.mode === "reference" ? refs.refs : [], seed: attempt === 1 ? undefined : Math.floor(Math.random() * 2 ** 31) }, signal);
        shot.video = { file: shotFile, duration: Number(result.duration ?? deps.probe(join(setDir, shotFile)) ?? shot.duration) };
        setPhase(id, "qa", { shotIndex: i + 1 });
        const qa = await qaShot(node, shot, result, signal);
        lastQa = qa;
        if (qa.verdict === "pass") done = { result, qa };
        else if (attempt === 1) {
          try { renameSync(join(setDir, shotFile), join(nodeDir, `${shot.id}.rejected.mp4`)); } catch { /* fine */ }
          log(`${id}/${shot.id}: narration QA failed (similarity ${qa.similarity}) — re-shooting with a fresh seed`);
        }
      }
      if (!done) throw new Error(`${id}/${shot.id}: narration QA failed twice (similarity ${lastQa?.similarity})`);
      shot.status = "ready";
      shot.qa = { similarity: done.qa.similarity, coverage: done.qa.coverage, verdict: done.qa.verdict, judge: done.qa.judge };
      shot.endpoint = refs.mode;
      outputs.push(join(setDir, shotFile));
      const frame = `nodes/${id}/${shot.id}.last.png`;
      prevFrame = deps.lastFrame(join(setDir, shotFile), join(setDir, frame)) ? frame : null;
      await persist();
    }
    signal?.throwIfAborted();
    const finalRel = `nodes/${id}/video.mp4`;
    const finalAbs = join(setDir, finalRel);
    if (outputs.length === 1) {
      try { unlinkSync(finalAbs); } catch { /* none */ }
      renameSync(outputs[0], finalAbs);
      shots[0].video.file = finalRel;
    } else {
      await deps.concat(outputs, finalAbs, signal);
    }
    const duration = deps.probe(finalAbs) ?? shots.reduce((s, x) => s + (x.video?.duration ?? x.duration), 0);
    writeFileSync(join(nodeDir, "script.md"), `# ${node.choiceLabel ?? id}\n\n${shots.map((s) => s.script).join("\n\n")}\n`);
    writeFileSync(join(nodeDir, "evidence.json"), JSON.stringify(sceneEvidence(node), null, 2));
    setNode(id, { status: "ready", video: { file: finalRel, duration }, phase: null, startedAt: null, shotIndex: null, error: null });
    if (id === course.rootNode) course.play.state = "playing";
    await persist();
    log(`${id} ready (${shots.length} shot${shots.length === 1 ? "" : "s"}, ${Math.round(duration)}s)`);
  }

  // ── scheduling ─────────────────────────────────────────────────────────
  function isDone(n) { return n.status === "ready" || n.status === "cancelled"; }
  function needsScript(n) { return (n.shots ?? []).length === 0 && !!n.brief && n.status !== "cancelled" && n.status !== "failed"; }
  function canRender(n) { return (n.shots ?? []).length > 0 && (n.status === "planned" || n.status === "scripting" && false); }

  function reconcile() {
    if (stopped) return;
    const from = current();
    const window = descendantWindow(nodes(), from, Math.max(videoAhead, planAhead) + 1);
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
      if (needsScript(n) && distance <= planAhead + 1) {
        planning.enqueue(id, priority, async (signal) => {
          try {
            await scriptNode(id, signal);
          } catch (e) {
            if (isAbort(e, signal)) return;
            log(`${id}: scripting failed: ${e.message}`);
            setNode(id, { status: "failed", phase: null, error: `写稿失败：${e.message}`.slice(0, 240) });
            await persist();
          } finally {
            reconcile();
          }
        });
        continue;
      }
      if ((n.shots ?? []).length > 0 && n.status === "planned" && distance <= videoAhead + 1) {
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
          } finally {
            reconcile();
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
    for (const s of n.shots ?? []) if (s.status !== "ready") { s.status = "planned"; delete s.video; }
    setNode(nodeId, { status: "planned", phase: null, startedAt: null, shotIndex: null, error: null });
    log(`retry: ${nodeId}`);
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
    nodes()[id] = { parent: hangOn, beat: asked.beat, kind: "question", choiceLabel: label, brief, status: "planned", shots: [], children: [{ nodeId: (p.children ?? []).find((c) => nodes()[c.nodeId]?.kind === "main")?.nodeId, label: "回到主线" }].filter((c) => c.nodeId) };
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
      course.play = { ...(course.play ?? {}), state: course.play?.state === "complete" ? "complete" : nodes()[course.rootNode]?.status === "ready" ? "playing" : "warming", currentNode: current() };
      if (!course.path?.length && course.rootNode) course.path = [course.rootNode];
      const choicePath = join(stateDir, "choice.json");
      if (existsSync(choicePath)) { try { lastChoiceAt = JSON.parse(readFileSync(choicePath, "utf-8")).at ?? ""; } catch { /* fine */ } }
      writeFileSync(join(stateDir, "manager.pid"), String(process.pid));
      reconcile();
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
      video.cancelWhere(() => true);
      planning.cancelWhere(() => true);
      await persistChain;
      try { unlinkSync(join(stateDir, "manager.pid")); } catch { /* fine */ }
    },
    whenIdle: async () => { await planning.whenIdle(); await video.whenIdle(); await persistChain; },
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
  log(`play-manager started for ${setDir} (slots ${args.slots}, video-ahead ${args["video-ahead"]})`);
  const shutdown = async (sig) => { log(`${sig}: stopping`); await manager.stop(); process.exit(0); };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  if (args.once) { await manager.whenIdle(); await manager.stop(); process.exit(0); }
}
