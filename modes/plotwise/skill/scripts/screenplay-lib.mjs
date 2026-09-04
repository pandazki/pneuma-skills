/**
 * Plotwise screenplay library — the whole main line of a course, written
 * once, before a single frame is shot.
 *
 * The first live courses failed at exactly this seam: one beat became one
 * 12-second clip, so a "segment" was one sentence and the course was a
 * thread of tweets. A knowledge point needs 30-60 seconds of continuous
 * explanation, and 15 seconds is the ceiling of a SHOT, not of a scene.
 * So the unit here is the SCENE — one outline beat, 1-6 shots, as long as
 * its content needs — and the whole spine is written in ONE call so the
 * scenes actually connect: each opens on the last one's closing thought
 * and closes on a hook to the next.
 *
 * Everything in this module is pure except the LLM call, which is
 * injected (`chat({ system, user })`) — the tests spend nothing.
 *
 * Division of labour with the shoot: the writer names figures by their
 * set-relative PATH and never by number. The play manager decides the
 * endpoint from what the script actually bound and injects the numbered
 * "Image N" bindings at shoot time (`injectBindings`). A writer that had
 * to guess which figure becomes Image 2 would guess wrong.
 */

import {
  MAX_REFS,
  SPEECH_OVERRUN,
  beatEvidence,
  checkFigureGate,
  resolveEvidence,
  shootableFigures,
  speechBudgetUnits,
  speechUnits,
} from "./segment-lib.mjs";
import { buildShotPrompt, normalizeBeats } from "./h3-prompt.mjs";

// The H3 prompt itself is built by h3-prompt.mjs — the practice lives
// there; this module only re-exports it for the callers that always
// imported it from here.
export { buildShotPrompt };

/** A shot is one H3 clip. The model's floor and ceiling, not ours. */
export const MIN_SHOT_SECONDS = 5;
export const MAX_SHOT_SECONDS = 15;
/** What a shot lasts when the writer forgot to say. */
export const DEFAULT_SHOT_SECONDS = 10;
/** A main scene is a teaching unit: enough shots for a hard idea, no padding. */
export const MAX_SHOTS_PER_SCENE = 6;
/** A detour is a side trip, not a second course. */
export const MAX_DETOUR_SHOTS = 4;
/** How many figures one shot can bind in a course with no recurring
 * character: the shoot spends one reference slot on the continuity frame
 * or the style anchor, and fal analyses at most MAX_REFS. */
export const MAX_FIGURES_PER_SHOT = MAX_REFS - 1;

/**
 * The figure budget of THIS course: MAX_REFS minus the continuity/anchor
 * slot minus one slot per recurring character (`style.refImages[1..]`
 * ride along on every shot). The manager fails a shot over this budget
 * rather than drop a figure silently, so the validator caps by the same
 * number and the writer hears about it before anything is shot.
 */
export function figureBudget(course) {
  const refs = Array.isArray(course?.style?.refImages) ? course.style.refImages : [];
  const characters = Math.max(0, refs.length - 1);
  return Math.max(0, MAX_FIGURES_PER_SHOT - characters);
}

const LANGUAGE_NAMES = { zh: "Chinese", en: "English", ja: "Japanese" };

const langName = (language) => LANGUAGE_NAMES[String(language ?? "").slice(0, 2)] ?? "English";

/** The label a "keep going" card carries, in the course's language. */
function continuePrefix(language) {
  const l = String(language ?? "").slice(0, 2);
  if (l === "zh") return "继续：";
  if (l === "ja") return "次へ：";
  return "Next: ";
}

/** The card at the end of a detour: back onto the spine, at the scene
 * the learner would have continued to. */
function returnPrefix(language) {
  const l = String(language ?? "").slice(0, 2);
  if (l === "zh") return "回到主线：";
  if (l === "ja") return "本筋に戻る：";
  return "Back to the course: ";
}

const trim = (v) => String(v ?? "").trim();

function dedupe(list) {
  const out = [];
  for (const item of list ?? []) if (item && !out.includes(item)) out.push(item);
  return out;
}

// ── Prompts ─────────────────────────────────────────────────────────────────

const SCENE_SHAPE = `A SCENE is a teaching unit, not a clip. It is made of 1-${MAX_SHOTS_PER_SCENE} SHOTS of ${MIN_SHOT_SECONDS}-${MAX_SHOT_SECONDS} seconds each, shot one continuously after another. A scene is as long as its content needs: a hard idea earns several shots in a row, an easy one is done in a single shot. Never pad a scene to reach a length, and never cram two beats into one.`;

const CORE_RULES = `Rules, in priority order:

1. ONE RUNNING EXAMPLE CARRIES THE WHOLE COURSE. The outline decides what it is; every scene comes back to that same example instead of inventing a fresh one each time. Facts come from the beat's evidence or from the textbook knowledge the outline already vetted — never introduce a claim the brief does not carry.
2. THE LINE IS CONTINUOUS. Every scene opens by picking up the previous scene's closing thought in ONE clause, and closes on a hook that makes the next beat wanted. Inside a scene, shot k+1 continues shot k: the same set, the same board, the thought carried forward.
3. THE NARRATION FITS THE CLIP. A shot's "script" is what is spoken in that shot, and it must be speakable inside its "duration": about 4.5 Chinese or Japanese characters per second, or about 2.4 English words per second. A 12-second Chinese shot is therefore about 54 characters, not 80. The caller measures every shot and rejects the ones that do not fit; an over-long script is spoken at a rush or cut off mid-sentence.
4. FIGURES ARE FOR EXACTNESS ONLY. Put a figure in a shot's "figures" ONLY when the content must be exact on screen — a plot, a coordinate system, a formula, a table. Name it by the set-relative path exactly as the beat's evidence list spells it; a path that is not on that list does not exist and asking for it fails the shot. MOST SHOTS SHOW NO FIGURE — a scene, a metaphor or a character carries an idea better than a diagram. Never describe a knowledge visual you have no figure to reproduce.
5. "visual" IS WHAT IS ON SCREEN, "beats" IS WHEN. "visual" is 1-2 English sentences summarizing the picture in the style's own materials — the viewer shows it. "beats" is the same picture as a TIMELINE inside one continuous take: 2-4 entries {"from","to","action","camera"} in seconds, covering the whole duration, each ending where the narration changes thought, and each with its own CAMERA MOVE written as motion + amplitude + speed ("the camera pushes in slowly with small amplitude toward the gap", "holds still", "drifts left"). A beat without a camera is a dead static frame. Name colors from the style anchor, not adjectives ("amber", "deep navy" — never "vivid"). No on-screen text, labels, formulas or numbers unless you spell them out verbatim in double quotes — the video model renders unspecified text as garbled glyphs. WRITTEN MATHEMATICS NEEDS A FIGURE: a shot that shows a formula, a derivation or a labeled axis names a figure that contains it; without one, the board stays free of formulas and the narration carries them (a video model asked to write c₃ = f‴(a)/3! wrote f″ — a wrong formula on screen is worse than none).
6. "sound" IS THE TWO LAYERS UNDER THE VOICE. One English sentence: the ambience (room tone, wind, chalk dust settling) and the action effects with the moment they land ("a soft chalk tap when the second curve appears at 3s"). The voice is the narration and is fixed; never write music.`;

const DETOUR_RULE = `7. EVERY SCENE ENDS WITH ONE DETOUR. "detour.label" is what the learner would press to take it, in the course's language, 4-14 characters (举个例子 / 讲细一点 / 练一练 / "a worked example"). "detour.brief" is one paragraph: what that side scene teaches, on what example, and how it hands the learner back to the spine. You write the label and the brief only — the detour's own shots are written later, and only if it is ever taken.`;

const STRICT_JSON = `Output STRICT JSON only, no markdown fences, no commentary.`;

const SHOT_JSON = `{"script":"<verbatim narration>","visual":"<one-line summary of the picture>","duration":10,"figures":[],"beats":[{"from":0,"to":4,"action":"<what happens>","camera":"<motion + amplitude + speed>"},{"from":4,"to":10,"action":"...","camera":"..."}],"sound":"<ambience and action effects, with when they land>"}`;
const SCENE_JSON = `{"beat":"b1","label":"<the scene's name in the course's language — the text on the card that leads into it>","shots":[${SHOT_JSON}],"detour":{"label":"...","brief":"..."}}`;

/** The system prompt for writing the whole main line in one call. */
export const SCREENPLAY_SYSTEM = `You are Luna, the screenwriter of an interactive learning-video course. You write the WHOLE main line in one pass: the outline is the spine, and you turn each of its beats into exactly ONE scene, in the outline's order.

${SCENE_SHAPE}

${CORE_RULES}
${DETOUR_RULE}

${STRICT_JSON}
{"scenes":[${SCENE_JSON}]}`;

/** The system prompt for the fallback lane: one scene at a time. */
export const SCENE_SYSTEM = `You are Luna, the screenwriter of an interactive learning-video course. The outline is the spine and you are writing ONE scene of it — the one beat the brief names — knowing what the scene before it said.

${SCENE_SHAPE}

${CORE_RULES}
${DETOUR_RULE}

${STRICT_JSON}
${SCENE_JSON}`;

/** The system prompt for a detour the learner actually took. */
export const DETOUR_SYSTEM = `You are Luna, the screenwriter of an interactive learning-video course. The learner stepped off the spine and asked for this detour. You write that one side scene, 1-${MAX_DETOUR_SHOTS} SHOTS of ${MIN_SHOT_SECONDS}-${MAX_SHOT_SECONDS} seconds each, from the brief that was written when the detour was offered.

A detour serves the scene it hangs off: it opens by picking up that scene's closing thought, does the ONE thing the brief promises (an example, a closer look, a check), and closes by handing the learner back to the spine. It never re-teaches the main scene and never starts a new topic.

${CORE_RULES}

${STRICT_JSON}
{"shots":[${SHOT_JSON}]}`;

/** One outline beat as the writer sees it: what it teaches, what it may show. */
function beatBlock(beat, index) {
  const lines = [`[${beat?.id ?? `b${index + 1}`}] ${trim(beat?.title) || "(untitled beat)"}`];
  if (trim(beat?.summary)) lines.push(`  what it teaches: ${trim(beat.summary)}`);
  if (trim(beat?.tier)) lines.push(`  accuracy tier: ${trim(beat.tier)}`);
  const evidence = beatEvidence(beat);
  if (evidence.length === 0) {
    lines.push("  evidence: none — this beat shows no figure; carry it with a scene, a metaphor or a character.");
  } else {
    lines.push("  evidence:");
    for (const e of evidence) {
      const where = e.file ? e.file : e.url ? e.url : "(no file)";
      lines.push(`    - [${e.kind}] ${where}${trim(e.note) ? ` — ${trim(e.note)}` : ""}`);
    }
    const figures = evidence.filter((e) => e.file && /\.(png|jpe?g|webp)$/i.test(e.file));
    lines.push(
      figures.length
        ? `  figures this beat may show (name the path verbatim): ${figures.map((f) => f.file).join(", ")}`
        : "  figures this beat may show: none",
    );
  }
  return lines.join("\n");
}

/** The speech rate as the writer must budget it, in their language. */
function rateLine(language) {
  const l = String(language ?? "").slice(0, 2);
  if (l === "zh" || l === "ja") {
    return `Speech budget: about 4.5 characters per second — a ${MIN_SHOT_SECONDS}s shot is ~${Math.round(MIN_SHOT_SECONDS * 4.5)} characters, a ${MAX_SHOT_SECONDS}s shot ~${Math.round(MAX_SHOT_SECONDS * 4.5)}.`;
  }
  return `Speech budget: about 2.4 words per second — a ${MIN_SHOT_SECONDS}s shot is ~${Math.round(MIN_SHOT_SECONDS * 2.4)} words, a ${MAX_SHOT_SECONDS}s shot ~${Math.round(MAX_SHOT_SECONDS * 2.4)}.`;
}

function courseHeader({ course, styleRecipe, narration, language }) {
  const lines = [
    `COURSE: ${trim(course?.title) || trim(course?.topic) || "(untitled)"}`,
    `Topic: ${trim(course?.topic) || trim(course?.title) || "(unstated)"}`,
  ];
  if (trim(course?.goal)) lines.push(`What the learner wants out of it: ${trim(course.goal)}`);
  lines.push(`Language of narration: ${language} (${langName(language)})`);
  lines.push(rateLine(language));
  lines.push("");
  lines.push(`Visual style — every "visual" is described in these materials: ${trim(styleRecipe) || "(no recipe on file)"}`);
  lines.push(
    narration === "on-camera"
      ? "Narration mode: on-camera — a speaker is in frame and their lines are lipsynced."
      : "Narration mode: voiceover — nobody speaks on screen; the narration rides over the picture.",
  );
  return lines.join("\n");
}

/** The user message for the whole-main-line call. */
export function screenplayUser({ course, styleRecipe, narration, language } = {}) {
  const beats = Array.isArray(course?.outline) ? course.outline : [];
  const lang = language ?? course?.language ?? "en";
  return [
    courseHeader({ course, styleRecipe, narration, language: lang }),
    "",
    `THE SPINE — ${beats.length} beats, one scene each, in this order:`,
    "",
    beats.map((b, i) => beatBlock(b, i)).join("\n\n"),
    "",
    `Write all ${beats.length} scenes now, in this order, as one JSON object.`,
  ].join("\n");
}

/** The user message for one scene of the fallback lane. */
export function sceneUser({ course, beat, index, total, previousScene, styleRecipe, narration, language } = {}) {
  const lang = language ?? course?.language ?? "en";
  const before = previousScene
    ? [
        "",
        `THE SCENE BEFORE THIS ONE (${trim(previousScene.label) || "unnamed"}) said, shot by shot:`,
        (previousScene.shots ?? []).map((s, i) => `  ${i + 1}. ${trim(s.script)}`).join("\n"),
        "Open this scene by picking that closing thought up in one clause.",
      ].join("\n")
    : "\nThis is the course's OPENING scene — there is nothing before it. Open on the hook the topic is remembered by.";
  return [
    courseHeader({ course, styleRecipe, narration, language: lang }),
    before,
    "",
    `THIS SCENE — beat ${index + 1} of ${total}:`,
    "",
    beatBlock(beat, index),
    "",
    "Write this one scene now, as one JSON object.",
  ].join("\n");
}

/** The user message for a detour scene the learner took. */
export function detourUser({ course, node, parentScene, styleRecipe, narration, language } = {}) {
  const lang = language ?? course?.language ?? "en";
  const beats = Array.isArray(course?.outline) ? course.outline : [];
  const beatId = node?.beat ?? course?.nodes?.[node?.parent]?.beat;
  const beat = beats.find((b) => b && b.id === beatId) ?? null;
  const parentLines = (parentScene?.shots ?? []).map((s, i) => `  ${i + 1}. ${trim(s.script)}`).join("\n");
  return [
    courseHeader({ course, styleRecipe, narration, language: lang }),
    "",
    `THE SCENE THIS DETOUR HANGS OFF (${trim(parentScene?.choiceLabel) || node?.parent || "the spine"}) said, shot by shot:`,
    parentLines || "  (its script is not on file — assume the beat below was just taught)",
    "",
    `THE DETOUR the learner pressed: ${trim(node?.choiceLabel) || "(unnamed)"}`,
    `What it promised: ${trim(node?.brief)}`,
    "",
    beat ? `The beat it serves:\n\n${beatBlock(beat, beats.indexOf(beat))}` : "This detour serves no outline beat directly — stay on what the parent scene taught.",
    "",
    `Write this one side scene now (1-${MAX_DETOUR_SHOTS} shots), as one JSON object.`,
  ].join("\n");
}

// ── Validation ──────────────────────────────────────────────────────────────

/** The figures a beat can actually put on screen, by set-relative path. */
function offeredFigures({ setDir, beat, nodeId }) {
  if (!setDir || !beat) return [];
  return shootableFigures(resolveEvidence({ setDir, beat, nodeId }));
}

/**
 * The per-shot checks every lane shares: 1..max shots, integer durations
 * inside the model's window, a script that fits the clip, and figures
 * that are rendered evidence of this beat. Out-of-range values are
 * normalized (clamped, dropped) AND reported — the caller keeps a usable
 * scene and still learns what was wrong with it.
 */
function validateShots({ raw, beat, language, setDir, nodeId, where, max, budget = MAX_FIGURES_PER_SHOT }) {
  const problems = [];
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0 || list.length > max) {
    problems.push(`${where} has ${list.length} shots — a scene is 1-${max} shots`);
  }
  const figures = offeredFigures({ setDir, beat, nodeId });
  const shots = list.map((rawShot, k) => {
    const at = `${where} shot ${k + 1}`;
    const script = trim(rawShot?.script);
    const visual = trim(rawShot?.visual);
    if (!script) problems.push(`${at}: no script — a shot with nothing spoken is not a shot`);
    if (!visual) problems.push(`${at}: no visual — nothing describes what is on screen`);

    const rawDuration = Number(rawShot?.duration);
    let duration = Number.isFinite(rawDuration) ? Math.round(rawDuration) : DEFAULT_SHOT_SECONDS;
    if (!Number.isFinite(rawDuration)) {
      problems.push(`${at}: duration ${JSON.stringify(rawShot?.duration)} is not a number — using ${duration}s`);
    } else if (!Number.isInteger(rawDuration) || rawDuration < MIN_SHOT_SECONDS || rawDuration > MAX_SHOT_SECONDS) {
      duration = Math.min(MAX_SHOT_SECONDS, Math.max(MIN_SHOT_SECONDS, duration));
      problems.push(`${at}: duration ${rawDuration}s is outside ${MIN_SHOT_SECONDS}-${MAX_SHOT_SECONDS}s — clamped to ${duration}s`);
    }

    const units = speechUnits(script, language);
    const cap = Math.round(speechBudgetUnits(language, duration) * SPEECH_OVERRUN);
    if (script && units > cap) {
      problems.push(`${at}: the script is ${units} speech units, over the ${cap}-unit cap for ${duration}s — it cannot be spoken in the clip`);
    }

    const wanted = (Array.isArray(rawShot?.figures) ? rawShot.figures : []).map(String).filter(Boolean);
    const gate = checkFigureGate(wanted, figures);
    for (const miss of gate.missing) {
      problems.push(`${at}: figure "${miss}" is not a rendered figure on disk for this beat — dropped`);
    }
    const bound = dedupe(gate.bound.map((f) => f.file));
    if (bound.length > budget) {
      // The manager fails such a shot at the shoot; say so here instead.
      problems.push(`${at}: ${bound.length} figures on screen at once — this course's shoot binds at most ${budget} (${MAX_REFS} reference slots less the continuity frame${budget < MAX_FIGURES_PER_SHOT ? " and the recurring characters" : ""}), so split them across shots`);
    }

    // The timeline and the sound are optional — a shot with only a visual
    // still shoots — but what is there is made honest: beats clamped to
    // the shot, a missing camera named (the builder fills the default).
    const { beats, problems: beatProblems } = normalizeBeats(rawShot?.beats, duration, { where: at });
    problems.push(...beatProblems);
    const sound = trim(rawShot?.sound);
    const shot = { script, visual, duration, figures: bound };
    if (beats.length) shot.beats = beats;
    if (sound) shot.sound = sound;
    return shot;
  });
  return { shots, problems };
}

/** The detour promised at the end of a scene, or null when it is missing. */
function normalizeDetour(raw) {
  const label = trim(raw?.label);
  const brief = trim(raw?.brief);
  if (!label || !brief) return null;
  return { label, brief };
}

function normalizeScene({ rawScene, beat, index, language, setDir, max = MAX_SHOTS_PER_SCENE, budget }) {
  const where = `scene ${index + 1} (${beat?.id ?? "?"})`;
  const problems = [];
  const named = trim(rawScene?.beat);
  if (named && beat?.id && named !== beat.id) {
    problems.push(`${where}: the screenplay calls it "${named}", but the outline's beat ${index + 1} is "${beat.id}" — position wins`);
  }
  const { shots, problems: shotProblems } = validateShots({
    raw: rawScene?.shots,
    beat,
    language,
    setDir,
    where,
    max,
    budget,
  });
  problems.push(...shotProblems);

  const detour = normalizeDetour(rawScene?.detour);
  if (!detour) problems.push(`${where}: no detour with both a label and a brief — every scene offers one side trip`);

  return {
    scene: {
      beat: beat?.id ?? named,
      label: trim(rawScene?.label) || trim(beat?.title) || (beat?.id ?? `scene ${index + 1}`),
      shots,
      detour,
    },
    problems,
  };
}

/**
 * Check a screenplay draft against the outline it was written from.
 * Returns normalized scenes (trimmed, clamped, figures deduped and
 * dropped when they are not on disk) plus every problem found, each
 * naming the scene and shot it belongs to. Nothing is thrown: the caller
 * decides whether to shoot, to re-ask, or to fall back.
 */
export function validateScreenplay(raw, { course, language, setDir } = {}) {
  const beats = Array.isArray(course?.outline) ? course.outline : [];
  const lang = language ?? course?.language ?? "en";
  const problems = [];
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.scenes) ? raw.scenes : null;
  if (!list) {
    problems.push('the screenplay carried no "scenes" array');
    return { scenes: [], problems };
  }
  if (list.length !== beats.length) {
    const orphanBeats = beats.slice(list.length).map((b) => b?.id).filter(Boolean);
    problems.push(
      `the outline has ${beats.length} beats but the screenplay carries ${list.length} scene${list.length === 1 ? "" : "s"}` +
        (orphanBeats.length ? ` — no scene for ${orphanBeats.map((b) => `"${b}"`).join(", ")}` : ""),
    );
  }
  const scenes = [];
  const budget = figureBudget(course);
  list.forEach((rawScene, i) => {
    const beat = beats[i];
    if (!beat) {
      problems.push(`scene ${i + 1} has no beat in the outline — dropped`);
      return;
    }
    const { scene, problems: sceneProblems } = normalizeScene({ rawScene, beat, index: i, language: lang, setDir, budget });
    problems.push(...sceneProblems);
    scenes.push(scene);
  });
  return { scenes, problems };
}

// ── Landing ─────────────────────────────────────────────────────────────────

const hasVideo = (node) => !!node && !!node.video && typeof node.video.file === "string";

/** The style anchor the manager will supply as a scene's opening frame. */
function styleAnchorOf(course) {
  const refs = course?.style?.refImages;
  return Array.isArray(refs) && typeof refs[0] === "string" ? refs[0] : null;
}

function landShots({ scene, course, styleRecipe, narration, language, sceneGoal }) {
  const anchored = !!styleAnchorOf(course);
  return scene.shots.map((shot, k) => ({
    id: `s${k + 1}`,
    script: shot.script,
    visual: shot.visual,
    duration: shot.duration,
    figures: shot.figures,
    ...(shot.beats ? { beats: shot.beats } : {}),
    ...(shot.sound ? { sound: shot.sound } : {}),
    videoPrompt: buildShotPrompt({
      styleRecipe,
      narration,
      language,
      shot,
      sceneGoal,
      // Inside a scene every shot chains off the previous one's last
      // frame; the opening shot only has one if the style was sampled.
      hasParentFrame: k > 0 || anchored,
      isSceneOpening: k === 0,
    }),
    status: "planned",
  }));
}

/**
 * Land a validated screenplay into course.json: one `main` node per beat
 * in order (`n1..nK`), a `branch` stub per detour (`n<k>d`), the children
 * links that make the tree navigable, and `rootNode`. `path`, `outline`,
 * `style` and `title` are never touched — they belong to the learner and
 * the planner, not to the writer.
 *
 * Re-landing rewrites the plan. The one thing it will not overwrite is a
 * node that already HAS A VIDEO: film is an artifact, everything else is
 * a plan. Such a node keeps its shots, its status and its video, but its
 * outgoing children ARE refreshed — a card must never advertise a scene
 * that no longer says what the card says.
 */
export function landScreenplay(course, scenes, { language, styleRecipe, narration } = {}) {
  const lang = language ?? course?.language ?? "en";
  const recipe = styleRecipe ?? course?.style?.recipe ?? course?.style?.id ?? "";
  const mode = narration ?? (course?.style?.narration === "on-camera" ? "on-camera" : "voiceover");
  const beats = Array.isArray(course?.outline) ? course.outline : [];
  const beatIndex = new Map(beats.map((b, i) => [b?.id, i]));
  const nodes = (course.nodes = course.nodes && typeof course.nodes === "object" ? course.nodes : {});

  const entries = (scenes ?? []).map((scene, i) => {
    const index = beatIndex.has(scene.beat) ? beatIndex.get(scene.beat) : i;
    return { scene, id: `n${index + 1}`, detourId: `n${index + 1}d` };
  });
  const prefix = continuePrefix(lang);

  entries.forEach((entry, i) => {
    const { scene, id, detourId } = entry;
    const prev = entries[i - 1];
    const next = entries[i + 1];

    const children = [];
    if (next) children.push({ nodeId: next.id, label: `${prefix}${next.scene.label}` });
    if (scene.detour) children.push({ nodeId: detourId, label: scene.detour.label });

    const existing = nodes[id];
    if (hasVideo(existing)) {
      existing.children = children;
    } else {
      nodes[id] = {
        ...(prev ? { parent: prev.id } : {}),
        ...(scene.beat ? { beat: scene.beat } : {}),
        kind: "main",
        choiceLabel: scene.label,
        status: "planned",
        shots: landShots({ scene, course, styleRecipe: recipe, narration: mode, language: lang, sceneGoal: scene.label }),
        children,
      };
    }

    if (scene.detour && !hasVideo(nodes[detourId])) {
      nodes[detourId] = {
        parent: id,
        // The detour serves the same beat, and the shoot resolves figures
        // by beat — a stub without it could bind nothing.
        ...(scene.beat ? { beat: scene.beat } : {}),
        kind: "branch",
        choiceLabel: scene.detour.label,
        brief: scene.detour.brief,
        status: "planned",
        shots: [],
        // A detour returns to the spine where the learner left it; the
        // last scene's detour ends the course.
        children: next ? [{ nodeId: next.id, label: `${returnPrefix(lang)}${next.scene.label}` }] : [],
      };
    }
  });

  if (entries.length) course.rootNode = entries[0].id;
  return course;
}

// ── Writing ─────────────────────────────────────────────────────────────────

/** A screenplay is usable when every beat got a scene and every scene has shots. */
function isComplete(scenes, course) {
  const beats = Array.isArray(course?.outline) ? course.outline : [];
  return scenes.length === beats.length && scenes.every((s) => s.shots.length > 0);
}

/**
 * The fallback lane: one call per beat, in order, each told what the
 * scene before it said. Slower and less connected than one pass over the
 * whole spine, but a single scene is a small enough answer that a model
 * which truncated the long one can still finish it.
 */
export async function writeMainSceneFallback({ course, chat, setDir, styleRecipe, narration, language, problems = [] } = {}) {
  const beats = Array.isArray(course?.outline) ? course.outline : [];
  const lang = language ?? course?.language ?? "en";
  const out = [...problems];
  const scenes = [];
  let previous = null;
  for (let i = 0; i < beats.length; i += 1) {
    const beat = beats[i];
    const where = `scene ${i + 1} (${beat?.id ?? "?"})`;
    let raw;
    try {
      raw = await chat({
        system: SCENE_SYSTEM,
        user: sceneUser({
          course,
          beat,
          index: i,
          total: beats.length,
          previousScene: previous,
          styleRecipe,
          narration,
          language: lang,
        }),
      });
    } catch (e) {
      // A hole in the spine is reported, never papered over: the manager
      // shows the beat as unwritten instead of skipping it silently.
      out.push(`${where}: the writer failed — ${e.message}`);
      continue;
    }
    const rawScene = Array.isArray(raw?.scenes) ? raw.scenes[0] : Array.isArray(raw) ? raw[0] : raw;
    const { scene, problems: sceneProblems } = normalizeScene({
      rawScene,
      beat,
      index: i,
      language: lang,
      setDir,
    });
    out.push(...sceneProblems);
    scenes.push(scene);
    previous = scene;
  }
  return { scenes, problems: out };
}

/**
 * Write the course's whole main line. One call for everything (the
 * scenes connect because one mind wrote them in a row); if that call
 * fails or comes back short of the spine, fall back to scene by scene.
 */
export async function writeScreenplay({ course, chat, setDir, styleRecipe, narration, language } = {}) {
  const lang = language ?? course?.language ?? "en";
  const beats = Array.isArray(course?.outline) ? course.outline : [];
  if (beats.length === 0) throw new Error("the outline is empty — there is no spine to write scenes for");

  const carried = [];
  try {
    const raw = await chat({
      system: SCREENPLAY_SYSTEM,
      user: screenplayUser({ course, styleRecipe, narration, language: lang }),
    });
    const { scenes, problems } = validateScreenplay(raw, { course, language: lang, setDir });
    if (isComplete(scenes, course)) return { scenes, problems, mode: "single" };
    carried.push(
      `the single-call screenplay covered ${scenes.length} of ${beats.length} beats — falling back to scene by scene`,
      ...problems,
    );
  } catch (e) {
    carried.push(`the single-call screenplay failed — ${e.message}`);
  }

  const { scenes, problems } = await writeMainSceneFallback({
    course,
    chat,
    setDir,
    styleRecipe,
    narration,
    language: lang,
    problems: carried,
  });
  return { scenes, problems, mode: "fallback" };
}

/**
 * Write the shots of a detour (or a learner's question) that was landed
 * as a stub with a brief. Returns shots in landed shape — id, video
 * prompt and `status: "planned"` included — so the manager can write them
 * straight onto the node and queue them.
 */
export async function writeDetourScene({ course, node, chat, styleRecipe, narration, language, setDir } = {}) {
  const brief = trim(node?.brief);
  if (!brief) throw new Error("this node has no brief — a detour scene is written from the brief it was offered with");
  if (typeof chat !== "function") throw new Error("writeDetourScene needs a chat function");

  const lang = language ?? course?.language ?? "en";
  const parentScene = node?.parent ? course?.nodes?.[node.parent] : null;
  const beats = Array.isArray(course?.outline) ? course.outline : [];
  const beatId = node?.beat ?? parentScene?.beat;
  const beat = beats.find((b) => b && b.id === beatId) ?? null;
  const label = trim(node?.choiceLabel) || brief.slice(0, 24);

  const raw = await chat({
    system: DETOUR_SYSTEM,
    user: detourUser({ course, node, parentScene, styleRecipe, narration, language: lang }),
  });
  const list = Array.isArray(raw?.shots) ? raw.shots : Array.isArray(raw) ? raw : raw?.scenes?.[0]?.shots;
  const { shots, problems } = validateShots({
    raw: list,
    beat,
    language: lang,
    setDir,
    nodeId: node?.id,
    where: `detour ${label}`,
    max: MAX_DETOUR_SHOTS,
    budget: figureBudget(course),
  });

  const anchored = !!styleAnchorOf(course);
  return {
    shots: shots.map((shot, k) => ({
      id: `s${k + 1}`,
      script: shot.script,
      visual: shot.visual,
      duration: shot.duration,
      figures: shot.figures,
      ...(shot.beats ? { beats: shot.beats } : {}),
      ...(shot.sound ? { sound: shot.sound } : {}),
      videoPrompt: buildShotPrompt({
        styleRecipe,
        narration,
        language: lang,
        shot,
        sceneGoal: label,
        hasParentFrame: k > 0 || anchored,
        isSceneOpening: k === 0,
      }),
      status: "planned",
    })),
    problems,
  };
}
