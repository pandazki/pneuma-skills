/**
 * Plotwise screenplay library — the whole main line of a course, written
 * once, before a single frame is shot.
 *
 * The unit of production is a MONTAGE CLIP. A scene is one outline beat,
 * made of 1-3 clips of up to 15 seconds, and inside a clip the model cuts
 * by itself: 3-9 time-coded cuts, each a composed picture with its own
 * camera move, with the narration spread across the timeline. That is the
 * grammar the community's published H3 prompts use and the one we
 * reproduced at their quality on fal (2026-09-04). Before 0.6 a scene was
 * a chain of one-take shots and every prompt opened with "One continuous
 * shot, no cuts" — the courses came out as talking illustrations.
 *
 * The writer is therefore a DIRECTOR: it decides the visual device that
 * carries the idea, then writes a shot list a director could shoot. It
 * never writes the prompt — `h3-prompt.mjs` assembles the four blocks
 * from these structured fields, so the practice can be improved in one
 * place without asking a model to remember it.
 *
 * The whole spine is written in ONE call so the scenes actually connect:
 * each opens on the last one's closing thought and closes on a hook to
 * the next. A truncated answer falls back to scene by scene.
 *
 * Everything in this module is pure except the LLM call, which is
 * injected (`chat({ system, user })`) — the tests spend nothing.
 *
 * Division of labour with the shoot: the writer names figures by their
 * set-relative PATH, on the cut that shows them, and never by number. The
 * play manager numbers the references at shoot time
 * (`insertReferenceBlock`). A writer that had to guess which figure
 * becomes Image 2 would guess wrong.
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
import { buildClipPrompt, clipScript, normalizeCuts, normalizeNarration } from "./h3-prompt.mjs";

// The H3 prompt itself is built by h3-prompt.mjs — the practice lives
// there; this module re-exports what its callers always imported here.
export { buildClipPrompt, clipScript };

/** A clip is one H3 generation. The model's ceiling, and its sweet spot. */
export const MIN_CLIP_SECONDS = 8;
export const MAX_CLIP_SECONDS = 15;
/** What a clip lasts when the writer forgot to say: the validated length. */
export const DEFAULT_CLIP_SECONDS = 15;
/** Fewer cuts than this is a talking illustration again; more than this
 * and 15 seconds cannot hold them. */
export const MIN_CUTS_PER_CLIP = 3;
export const MAX_CUTS_PER_CLIP = 9;
/** A beat is 1-3 clips — as long as its content needs, never padded. */
export const MAX_CLIPS_PER_SCENE = 3;
/** A detour is a side trip, not a second course. */
export const MAX_DETOUR_CLIPS = 2;
/** How many figures one clip can bind: the shoot spends one reference
 * slot on the style anchor, and fal analyses at most MAX_REFS images. */
export const MAX_FIGURES_PER_CLIP = MAX_REFS - 1;
/**
 * Narration under this fraction of the clip's speech budget is too
 * sparse: H3 pads unspoken seconds with a repeated line or invented
 * speech. Measured 2026-09-04 on one 15 s clip — 44 characters failed
 * the transcript gate in 6 of 9 takes (coverage 1.3-1.6, lines said
 * twice, gibberish spliced in), 50-56 characters passed 2 of 2, 88
 * characters garbled a stretch in 2 of 3 (coverage 0.74-0.80). The
 * budget is 4.8 characters a second; 70% of it is 50 for 15 s.
 */
export const SPARSE_FLOOR = 0.7;
/**
 * Narration over this multiple of the budget starts to garble: the model
 * cannot fit the words and swallows a stretch. Measured 2026-09-04 at
 * 480P, 15 s clips, characters spoken / takes clean on the first shoot:
 * 44 → 1 of 4, 50-56 → 2 of 2, 84-89 → 4 of 6, 118 → 0 of 2. So the band
 * is wide and both edges are real; 1.25 × the 4.8-a-second budget is 90
 * characters for 15 s, above everything that worked and below what did
 * not. The hard cap (`SPEECH_OVERRUN`, 101) is where speech becomes
 * impossible rather than unreliable.
 */
export const DENSE_CEILING = 1.25;

/**
 * The figure budget of THIS course: MAX_REFS minus the style-anchor slot
 * minus one slot per recurring character (`style.refImages[1..]` ride
 * along on every clip). The manager fails a clip over this budget rather
 * than drop a figure silently, so the validator caps by the same number
 * and the writer hears about it before anything is shot.
 */
export function figureBudget(course) {
  const refs = Array.isArray(course?.style?.refImages) ? course.style.refImages : [];
  const characters = Math.max(0, refs.length - 1);
  return Math.max(0, MAX_FIGURES_PER_CLIP - characters);
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

const DIRECTOR_ROLE = `You are Luna, the director and screenwriter of an interactive learning-video course. You do not describe ideas; you write what the camera sees, shot by shot, the way a director hands a shot list to a crew.

Every clip you write is shot by MiniMax H3, which cuts by itself inside one prompt. Its published work lives at 4-8 cuts per 15 seconds. The narration you write is synthesized and then transcribed and checked against your text word by word, so it must be sayable exactly as written.`;

const DEVICE_RULE = `THE VISUAL DEVICE COMES FIRST. A knowledge point is filmable only through concrete things an audience can see — objects, a metaphor made of matter, a character with a job. "Compound interest" cannot be filmed; "a coin that buds a second coin, then both bud again, climbing a band that steepens" can. The outline may already carry a \`device\` for the beat: use it and translate it into the chosen style's own materials. If it carries none, invent one that fits both the idea and the style, and keep it running — the same device, developing, across the beat's clips.`;

const SCENE_SHAPE = `A SCENE is one outline beat. It is made of 1-${MAX_CLIPS_PER_SCENE} CLIPS of ${MIN_CLIP_SECONDS}-${MAX_CLIP_SECONDS} seconds (${DEFAULT_CLIP_SECONDS} is the norm). An easy idea is one clip; a hard one earns two or three. Never pad a scene to reach a length, and never put two beats in one scene.

A CLIP is a MONTAGE: ${MIN_CUTS_PER_CLIP}-${MAX_CUTS_PER_CLIP} cuts, each a composed picture with its own camera move, cut on the times you give. Inside a scene the clips are the same set and materials, developing — clip 2 picks up where clip 1 left the picture.`;

const CORE_RULES = `Rules, in priority order:

1. ONE RUNNING EXAMPLE CARRIES THE WHOLE COURSE, and one device carries each beat. The outline decides the example; every scene returns to it instead of inventing a fresh one. Facts come from the beat's evidence or from the textbook knowledge the outline already vetted — never introduce a claim the brief does not carry.
2. THE LINE IS CONTINUOUS. Every scene opens by picking up the previous scene's closing thought in ONE clause, and closes on a hook that makes the next beat wanted.
3. A CUT LINE IS ONE SENTENCE: subject + action + setting, written in the course's language, concrete enough to shoot. Name colours from the style anchor's palette by name ("mustard yellow", "deep navy" — never "vivid"). NO ON-SCREEN TEXT, labels, numbers or formulas: the video model renders text it was not given as garbled glyphs. The one exception is a title card of two words or fewer, which you must spell verbatim inside double quotes.
4. EVERY CUT CARRIES A CAMERA — a short move in the course's language (a fixed frame, a slow push-in, a lateral drift, a follow, an overhead, a hard cut to a close-up). A cut with no camera is a dead frame. AND THE SCALE CHANGES: at least one cut is WIDE enough to show the whole device at once, and at least one is CLOSE on the detail that matters. A montage shot entirely at one distance reads as five versions of the same picture — measured 2026-09-04, a sample whose five cuts were all mid-overheads lost the one thing its own anchor did best.
5. THE NARRATION IS TIMED, AND IT FILLS THE CLIP AT SPEAKING PACE. Each line is {"from","to","text"} in seconds inside the clip, placed where its picture is. The total must match the clip's length at about 4.5-5.5 Chinese characters or 2.4-3 English words per second — a ${DEFAULT_CLIP_SECONDS}-second clip carries 60-85 Chinese characters or 32-45 English words. Both edges of that band are real (measured 2026-09-04): under about 50 characters the model pads the silence by REPEATING a line or inventing speech; over about 100 it cannot fit the words and swallows a stretch. Spread the words across the cuts rather than stacking them on one — but do not go spare. IF THE BEAT NEEDS MORE WORDS THAN ONE CLIP HOLDS, ADD A CLIP; never squeeze them. Write it as it is spoken: no abbreviations, no symbols, no digits where words are said.
6. FIGURES ARE FOR EXACTNESS ONLY, and they belong to a cut. Put a figure path in that cut's "figures" ONLY when the content must be exact on screen — a plot, a coordinate system, a formula, a table — naming it exactly as the beat's evidence list spells it. A path that is not on that list does not exist and asking for it fails the clip. MOST CLIPS SHOW NO FIGURE. WRITTEN MATHEMATICS NEEDS A FIGURE: if a cut shows a formula, a derivation or a labelled axis, it names a figure that contains it; without one, the picture stays free of writing and the narration carries it.
7. AUDIO IS TWO LAYERS UNDER THE VOICE, in one line in the course's language: the ambience (room tone, wind, paper settling) and the action effects with the moment they land ("a crisp paper snap when the first coin pops at 2s"). Never write music.
8. NEGATIVES ARE STYLE-SPECIFIC, in one line in the course's language: what THIS look must never show (for papercraft: no metal coins, no neon, no plastic sheen). The pipeline adds its own standing negatives; yours are the ones only this style needs.`;

const DETOUR_RULE = `9. EVERY SCENE ENDS WITH ONE DETOUR. "detour.label" is what the learner would press to take it, in the course's language, 4-14 characters (举个例子 / 讲细一点 / 练一练 / "a worked example"). "detour.brief" is one paragraph: what that side scene teaches, on what example, and how it hands the learner back to the spine. You write the label and the brief only — the detour's own clips are written later, and only if it is ever taken.`;

const STRICT_JSON = `Output STRICT JSON only, no markdown fences, no commentary. Write every human-readable string in the course's language; the field names stay as they are here.`;

const CLIP_JSON = `{"duration":15,"theme":"<one line: what this clip shows and why>","cuts":[{"from":0,"to":3,"shot":"<subject + action + setting>","camera":"<a short camera move>","figures":[]},{"from":3,"to":8,"shot":"...","camera":"..."}],"narration":[{"from":0,"to":4,"text":"<verbatim spoken line>"}],"audio":"<ambience and effects with their moments>","negatives":"<what this style must never show>"}`;
const SCENE_JSON = `{"beat":"b1","label":"<the scene's name in the course's language — the text on the card that leads into it>","device":"<the visual device that carries this beat, one or two sentences>","clips":[${CLIP_JSON}],"detour":{"label":"...","brief":"..."}}`;

/** The system prompt for writing the whole main line in one call. */
export const SCREENPLAY_SYSTEM = `${DIRECTOR_ROLE}

You write the WHOLE main line in one pass: the outline is the spine, and you turn each of its beats into exactly ONE scene, in the outline's order.

${DEVICE_RULE}

${SCENE_SHAPE}

${CORE_RULES}
${DETOUR_RULE}

${STRICT_JSON}
{"scenes":[${SCENE_JSON}]}`;

/** The system prompt for the fallback lane: one scene at a time. */
export const SCENE_SYSTEM = `${DIRECTOR_ROLE}

The outline is the spine and you are writing ONE scene of it — the one beat the brief names — knowing what the scene before it said.

${DEVICE_RULE}

${SCENE_SHAPE}

${CORE_RULES}
${DETOUR_RULE}

${STRICT_JSON}
${SCENE_JSON}`;

/**
 * The system prompt for the STYLE SAMPLE — one clip, written before the
 * course is planned, so the learner confirms the look on the real thing
 * rather than on a mood board. Same grammar, same assembler, one clip.
 */
export const SAMPLE_SYSTEM = `${DIRECTOR_ROLE}

You are writing the STYLE SAMPLE of a course that has not been planned yet: ONE montage clip that shows what this look does with this topic's opening hook. The learner watches it and decides whether their whole course is shot in this style, so it has to be the real thing — the same montage grammar every scene will use.

${DEVICE_RULE}

A SAMPLE is ONE CLIP: ${MIN_CUTS_PER_CLIP}-${MAX_CUTS_PER_CLIP} cuts inside the seconds you are given, cut on the times you set, with the hook spoken across them.

${CORE_RULES}

The hook line you are given is spoken VERBATIM — copy it into the narration exactly, and add nothing else to say.

${STRICT_JSON}
${CLIP_JSON}`;

/** The system prompt for a detour the learner actually took. */
export const DETOUR_SYSTEM = `${DIRECTOR_ROLE}

The learner stepped off the spine and asked for this detour. You write that one side scene, 1-${MAX_DETOUR_CLIPS} CLIPS, from the brief that was written when the detour was offered.

A detour serves the scene it hangs off: it opens by picking up that scene's closing thought, does the ONE thing the brief promises (an example, a closer look, a check), and closes by handing the learner back to the spine. It never re-teaches the main scene and never starts a new topic.

${DEVICE_RULE}

${SCENE_SHAPE}

${CORE_RULES}

${STRICT_JSON}
{"device":"<the device this side scene uses>","clips":[${CLIP_JSON}]}`;

/** One outline beat as the writer sees it: what it teaches, what carries
 * it visually, what it may show. */
function beatBlock(beat, index) {
  const lines = [`[${beat?.id ?? `b${index + 1}`}] ${trim(beat?.title) || "(untitled beat)"}`];
  if (trim(beat?.summary)) lines.push(`  what it teaches: ${trim(beat.summary)}`);
  if (trim(beat?.device)) lines.push(`  visual device from the plan (translate it into the style's materials): ${trim(beat.device)}`);
  if (trim(beat?.tier)) lines.push(`  accuracy tier: ${trim(beat.tier)}`);
  const evidence = beatEvidence(beat);
  if (evidence.length === 0) {
    lines.push("  evidence: none — this beat shows no figure; carry it with the device alone.");
  } else {
    lines.push("  evidence:");
    for (const e of evidence) {
      const where = e.file ? e.file : e.url ? e.url : "(no file)";
      lines.push(`    - [${e.kind}] ${where}${trim(e.note) ? ` — ${trim(e.note)}` : ""}`);
    }
    const figures = evidence.filter((e) => e.file && /\.(png|jpe?g|webp)$/i.test(e.file));
    lines.push(
      figures.length
        ? `  figures this beat may show (name the path verbatim, on the cut that shows it): ${figures.map((f) => f.file).join(", ")}`
        : "  figures this beat may show: none",
    );
  }
  return lines.join("\n");
}

/** The speech rate as the writer must budget it, in their language. */
function rateLine(language) {
  const l = String(language ?? "").slice(0, 2);
  const budget = speechBudgetUnits(language, MAX_CLIP_SECONDS);
  const low = Math.round(budget * SPARSE_FLOOR);
  const high = Math.round(budget * DENSE_CEILING);
  const unit = l === "zh" || l === "ja" ? "characters" : "words";
  return `Speech budget: ${low}-${high} ${unit} in a ${MAX_CLIP_SECONDS}-second clip; scale it down with a shorter clip. Under ${low} the model pads the silence with a repeated line, over ${high} it swallows a stretch.`;
}

function courseHeader({ course, styleRecipe, styleDevices, narration, language }) {
  const lines = [
    `COURSE: ${trim(course?.title) || trim(course?.topic) || "(untitled)"}`,
    `Topic: ${trim(course?.topic) || trim(course?.title) || "(unstated)"}`,
  ];
  if (trim(course?.goal)) lines.push(`What the learner wants out of it: ${trim(course.goal)}`);
  lines.push(`Language of every string you write: ${language} (${langName(language)})`);
  lines.push(rateLine(language));
  lines.push("");
  lines.push(`ART DIRECTION — every cut is composed in these materials, and the palette is named from it: ${trim(styleRecipe) || "(no recipe on file)"}`);
  if (trim(styleDevices)) lines.push(`Graphic devices this look owns — reach for them cut by cut so no two cuts share one framing: ${trim(styleDevices)}`);
  const visual = course?.visual;
  if (visual && typeof visual === "object") {
    if (trim(visual.bible)) lines.push(`How this course looks as a whole: ${trim(visual.bible)}`);
    const motifs = (Array.isArray(visual.motifs) ? visual.motifs : []).map(trim).filter(Boolean);
    if (motifs.length) lines.push(`Recurring motifs: ${motifs.join("; ")}`);
    const never = (Array.isArray(visual.neverDraw) ? visual.neverDraw : []).map(trim).filter(Boolean);
    if (never.length) lines.push(`This course never draws: ${never.join("; ")}`);
  }
  lines.push(
    narration === "on-camera"
      ? "Narration mode: on-camera — a speaker is in frame and their lines are lipsynced."
      : "Narration mode: voiceover — nobody speaks on screen; the narration rides over the picture.",
  );
  return lines.join("\n");
}

/** The user message for the whole-main-line call. */
export function screenplayUser({ course, styleRecipe, styleDevices, narration, language } = {}) {
  const beats = Array.isArray(course?.outline) ? course.outline : [];
  const lang = language ?? course?.language ?? "en";
  return [
    courseHeader({ course, styleRecipe, styleDevices, narration, language: lang }),
    "",
    `THE SPINE — ${beats.length} beats, one scene each, in this order:`,
    "",
    beats.map((b, i) => beatBlock(b, i)).join("\n\n"),
    "",
    `Write all ${beats.length} scenes now, in this order, as one JSON object.`,
  ].join("\n");
}

/** The user message for one scene of the fallback lane. */
/** The paragraph a re-ask carries: what was wrong with the last draft. */
function revisionBlock(revision) {
  const notes = (Array.isArray(revision) ? revision : []).map(trim).filter(Boolean);
  if (!notes.length) return "";
  return [
    "",
    "REVISION — your previous draft of this scene was refused for the reasons below. Write it again so that none of them recurs; keep everything that was not named.",
    ...notes.map((n) => `- ${n}`),
  ].join("\n");
}

export function sceneUser({ course, beat, index, total, previousScene, styleRecipe, styleDevices, narration, language, revision } = {}) {
  const lang = language ?? course?.language ?? "en";
  const before = previousScene
    ? [
        "",
        `THE SCENE BEFORE THIS ONE (${trim(previousScene.label) || "unnamed"}) said, clip by clip:`,
        (previousScene.clips ?? []).map((c, i) => `  ${i + 1}. ${clipScript(c, lang)}`).join("\n"),
        trim(previousScene.device) ? `Its device: ${trim(previousScene.device)}` : "",
        "Open this scene by picking that closing thought up in one clause.",
      ]
        .filter(Boolean)
        .join("\n")
    : "\nThis is the course's OPENING scene — there is nothing before it. Open on the hook the topic is remembered by.";
  return [
    courseHeader({ course, styleRecipe, styleDevices, narration, language: lang }),
    before,
    "",
    `THIS SCENE — beat ${index + 1} of ${total}:`,
    "",
    beatBlock(beat, index),
    revisionBlock(revision),
    "",
    "Write this one scene now, as one JSON object.",
  ].join("\n");
}

/** The user message for a detour scene the learner took. */
export function detourUser({ course, node, parentScene, styleRecipe, styleDevices, narration, language, revision } = {}) {
  const lang = language ?? course?.language ?? "en";
  const beats = Array.isArray(course?.outline) ? course.outline : [];
  const beatId = node?.beat ?? course?.nodes?.[node?.parent]?.beat;
  const beat = beats.find((b) => b && b.id === beatId) ?? null;
  const parentLines = (parentScene?.clips ?? []).map((c, i) => `  ${i + 1}. ${clipScript(c, lang)}`).join("\n");
  return [
    courseHeader({ course, styleRecipe, styleDevices, narration, language: lang }),
    "",
    `THE SCENE THIS DETOUR HANGS OFF (${trim(parentScene?.choiceLabel) || node?.parent || "the spine"}) said, clip by clip:`,
    parentLines || "  (its script is not on file — assume the beat below was just taught)",
    trim(parentScene?.device) ? `Its device: ${trim(parentScene.device)}` : "",
    "",
    `THE DETOUR the learner pressed: ${trim(node?.choiceLabel) || "(unnamed)"}`,
    `What it promised: ${trim(node?.brief)}`,
    "",
    beat ? `The beat it serves:\n\n${beatBlock(beat, beats.indexOf(beat))}` : "This detour serves no outline beat directly — stay on what the parent scene taught.",
    revisionBlock(revision),
    "",
    `Write this one side scene now (1-${MAX_DETOUR_CLIPS} clips), as one JSON object.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Validation ──────────────────────────────────────────────────────────────

/** The figures a beat can actually put on screen, by set-relative path. */
function offeredFigures({ setDir, beat, nodeId }) {
  if (!setDir || !beat) return [];
  return shootableFigures(resolveEvidence({ setDir, beat, nodeId }));
}

/** Writing on screen that no figure backs: a video model asked to write
 * c₃ = f‴(a)/3! wrote f″, and a wrong formula on screen is worse than
 * none (2026-09-03). Cheap to spot, so it is spotted. */
const WRITING_ON_SCREEN = /[=＝∑∫√±×÷≈≤≥^]|\b\d+\s*\/\s*\d+\b|[₀-₉⁰-⁹]/;

/**
 * The per-clip checks every lane shares: a shot list of the right size
 * that covers the clip, a narration that fits the clip, cameras
 * everywhere, and figures that are rendered evidence of this beat.
 * Out-of-range values are normalized (clamped, dropped) AND reported —
 * the caller keeps a usable scene and still learns what was wrong.
 */
function validateClips({ raw, beat, language, setDir, nodeId, where, max, budget = MAX_FIGURES_PER_CLIP }) {
  const problems = [];
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0 || list.length > max) {
    problems.push(`${where} has ${list.length} clips — a scene is 1-${max} clips`);
  }
  const figures = offeredFigures({ setDir, beat, nodeId });
  const clips = list.map((rawClip, k) => {
    const at = `${where} clip ${k + 1}`;

    const rawDuration = Number(rawClip?.duration);
    let duration = Number.isFinite(rawDuration) ? Math.round(rawDuration) : DEFAULT_CLIP_SECONDS;
    if (!Number.isFinite(rawDuration)) {
      problems.push(`${at}: duration ${JSON.stringify(rawClip?.duration)} is not a number — using ${duration}s`);
    } else if (!Number.isInteger(rawDuration) || rawDuration < MIN_CLIP_SECONDS || rawDuration > MAX_CLIP_SECONDS) {
      duration = Math.min(MAX_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, duration));
      problems.push(`${at}: duration ${rawDuration}s is outside ${MIN_CLIP_SECONDS}-${MAX_CLIP_SECONDS}s — clamped to ${duration}s`);
    }

    const { cuts, problems: cutProblems } = normalizeCuts(rawClip?.cuts, duration, { where: at, language });
    problems.push(...cutProblems);
    if (cuts.length < MIN_CUTS_PER_CLIP) {
      problems.push(`${at}: ${cuts.length} cut${cuts.length === 1 ? "" : "s"} in ${duration}s — a montage is ${MIN_CUTS_PER_CLIP}-${MAX_CUTS_PER_CLIP} cuts, and one long take is what this format exists to replace`);
    } else if (cuts.length > MAX_CUTS_PER_CLIP) {
      problems.push(`${at}: ${cuts.length} cuts in ${duration}s — over ${MAX_CUTS_PER_CLIP} the model has no time to compose them`);
    }
    if (cuts.length && cuts[0].from > 0.5) {
      problems.push(`${at}: the shot list starts at ${cuts[0].from}s — the first ${cuts[0].from}s of the clip are unwritten`);
      cuts[0].from = 0;
    }
    for (let i = 1; i < cuts.length; i += 1) {
      const gap = cuts[i].from - cuts[i - 1].to;
      if (gap > 0.5) problems.push(`${at}: a ${Math.round(gap * 10) / 10}s gap between cut ${i} and cut ${i + 1} — the timeline must be continuous`);
    }

    const { narration: lines, problems: lineProblems } = normalizeNarration(rawClip?.narration, duration, { where: at });
    problems.push(...lineProblems);
    if (lines.length === 0) problems.push(`${at}: nothing is spoken — a clip with no narration teaches nothing`);
    const script = clipScript({ narration: lines }, language);
    const units = speechUnits(script, language);
    const speechBudget = speechBudgetUnits(language, duration);
    const cap = Math.round(speechBudget * SPEECH_OVERRUN);
    const floor = Math.round(speechBudget * SPARSE_FLOOR);
    const ceiling = Math.round(speechBudget * DENSE_CEILING);
    if (script && units > cap) {
      problems.push(`${at}: the narration is ${units} speech units, over the ${cap}-unit cap for ${duration}s — it cannot be spoken in the clip`);
    } else if (script && units > ceiling) {
      problems.push(`${at}: the narration is ${units} speech units for ${duration}s, over the ${ceiling}-unit ceiling — the model garbles a stretch to fit, so cut words or add a clip`);
    } else if (script && units < floor) {
      problems.push(`${at}: the narration is ${units} speech units for ${duration}s, under the ${floor}-unit floor — the model pads unspoken seconds with a repeated line or invented speech, so say more or shorten the clip`);
    }

    // Figures are bound per cut, then gathered for the shoot.
    const wanted = dedupe(cuts.flatMap((c) => c.figures ?? []).map(String));
    const gate = checkFigureGate(wanted, figures);
    const boundSet = new Set(gate.bound.map((f) => f.file));
    const byBasename = new Map(gate.bound.map((f) => [f.file.split("/").pop(), f.file]));
    for (const miss of gate.missing) {
      problems.push(`${at}: figure "${miss}" is not a rendered figure on disk for this beat — dropped`);
    }
    for (const cut of cuts) {
      if (!cut.figures) continue;
      const kept = dedupe(cut.figures.map((f) => (boundSet.has(f) ? f : byBasename.get(String(f).split("/").pop()))).filter(Boolean));
      if (kept.length) cut.figures = kept;
      else delete cut.figures;
    }
    const bound = dedupe(cuts.flatMap((c) => c.figures ?? []));
    if (bound.length > budget) {
      // The manager fails such a clip at the shoot; say so here instead.
      problems.push(`${at}: ${bound.length} figures in one clip — this course's shoot binds at most ${budget} (${MAX_REFS} reference slots less the style anchor${budget < MAX_FIGURES_PER_CLIP ? " and the recurring characters" : ""}), so split them across clips`);
    }
    for (const [i, cut] of cuts.entries()) {
      if (!cut.figures?.length && WRITING_ON_SCREEN.test(cut.shot)) {
        problems.push(`${at} cut ${i + 1}: it puts writing on screen with no figure to reproduce — the model invents glyphs; move it into the narration or render a figure`);
      }
    }

    const clip = {
      id: `c${k + 1}`,
      duration,
      theme: trim(rawClip?.theme) || trim(rawClip?.visual),
      cuts,
      narration: lines,
      figures: bound,
    };
    const audio = trim(rawClip?.audio);
    if (audio) clip.audio = audio;
    const negatives = trim(rawClip?.negatives);
    if (negatives) clip.negatives = negatives;
    return clip;
  });
  return { clips, problems };
}

/** The user message for the style sample: a topic, a hook, and a look. */
export function sampleUser({ topic, goal, hook, action, styleRecipe, styleDevices, styleName, narration, language, duration = MAX_CLIP_SECONDS } = {}) {
  const lang = language ?? "en";
  return [
    `TOPIC: ${trim(topic) || "(unstated)"}`,
    trim(goal) ? `What the learner wants out of the course: ${trim(goal)}` : "",
    `Language of every string you write: ${lang} (${langName(lang)})`,
    rateLine(lang),
    "",
    `ART DIRECTION — every cut is composed in these materials, and the palette is named from it${trim(styleName) ? ` (${trim(styleName)})` : ""}: ${trim(styleRecipe) || "(no recipe on file)"}`,
    trim(styleDevices) ? `Graphic devices this look owns — reach for them cut by cut so no two cuts share one framing: ${trim(styleDevices)}` : "",
    narration === "on-camera"
      ? "Narration mode: on-camera — a speaker is in frame and their line is lipsynced."
      : "Narration mode: voiceover — nobody speaks on screen; the narration rides over the picture.",
    "",
    `THE CLIP: ${duration} seconds.`,
    `The hook, spoken verbatim: ${trim(hook)}`,
    trim(action) ? `What the session already decided these seconds should SHOW: ${trim(action)}` : "",
    "",
    "Write that one clip now, as one JSON object.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Check a style sample the writer returned: one clip, the shared per-clip
 * checks, and no figures (nothing is rendered before a course is planned).
 */
export function validateSampleClip(raw, { language, duration = MAX_CLIP_SECONDS } = {}) {
  const one = raw && typeof raw === "object" && !Array.isArray(raw) ? { duration, ...raw } : null;
  const { clips, problems } = validateClips({ raw: one ? [one] : [], language, where: "the sample", max: 1, budget: 0 });
  return { clip: clips[0] ?? null, problems };
}

/** The detour promised at the end of a scene, or null when it is missing. */
function normalizeDetour(raw) {
  const label = trim(raw?.label);
  const brief = trim(raw?.brief);
  if (!label || !brief) return null;
  return { label, brief };
}

function normalizeScene({ rawScene, beat, index, language, setDir, max = MAX_CLIPS_PER_SCENE, budget }) {
  const where = `scene ${index + 1} (${beat?.id ?? "?"})`;
  const problems = [];
  const named = trim(rawScene?.beat);
  if (named && beat?.id && named !== beat.id) {
    problems.push(`${where}: the screenplay calls it "${named}", but the outline's beat ${index + 1} is "${beat.id}" — position wins`);
  }
  const { clips, problems: clipProblems } = validateClips({
    raw: rawScene?.clips ?? rawScene?.shots,
    beat,
    language,
    setDir,
    where,
    max,
    budget,
  });
  problems.push(...clipProblems);

  const device = trim(rawScene?.device) || trim(beat?.device);
  if (!device) problems.push(`${where}: no visual device — the beat has nothing concrete to film`);

  const detour = normalizeDetour(rawScene?.detour);
  if (!detour) problems.push(`${where}: no detour with both a label and a brief — every scene offers one side trip`);

  return {
    scene: {
      beat: beat?.id ?? named,
      label: trim(rawScene?.label) || trim(beat?.title) || (beat?.id ?? `scene ${index + 1}`),
      device,
      clips,
      detour,
    },
    problems,
  };
}

/**
 * Check a screenplay draft against the outline it was written from.
 * Returns normalized scenes (trimmed, clamped, figures deduped and
 * dropped when they are not on disk) plus every problem found, each
 * naming the scene and clip it belongs to. Nothing is thrown: the caller
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

function landClips({ scene, styleRecipe, narration, language }) {
  const total = scene.clips.length;
  return scene.clips.map((clip, k) => ({
    ...clip,
    id: clip.id ?? `c${k + 1}`,
    videoPrompt: buildClipPrompt({
      styleRecipe,
      narration,
      language,
      clip,
      part: { index: k + 1, total, sceneGoal: scene.label },
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
 * a plan. Such a node keeps its clips, its status and its video, but its
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
        ...(scene.device ? { device: scene.device } : {}),
        status: "planned",
        clips: landClips({ scene, styleRecipe: recipe, narration: mode, language: lang }),
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
        clips: [],
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

/**
 * The problems that are certain to waste a render: narration outside the
 * density band. Everything else the validator reports is advisory or
 * already normalized; these fail the transcript gate more often than not
 * (measured 2026-09-04), so the writer is asked once more before a clip
 * is paid for.
 */
export function densityProblems(problems) {
  return (problems ?? []).filter((p) => /speech units/.test(String(p)));
}

/**
 * One more pass over a scene whose draft would waste a render: the scene
 * lane with the refused draft's problems as revision notes. The revision
 * replaces the draft only when it fixed the density; otherwise the draft
 * stands and both rounds are reported.
 */
async function reviseScene({ course, chat, setDir, styleRecipe, styleDevices, narration, language, beat, index, total, previousScene, scene, problems }) {
  const notes = densityProblems(problems);
  if (!notes.length || typeof chat !== "function") return { scene, problems };
  const where = `scene ${index + 1} (${beat?.id ?? "?"})`;
  let raw;
  try {
    raw = await chat({
      system: SCENE_SYSTEM,
      user: sceneUser({ course, beat, index, total, previousScene, styleRecipe, styleDevices, narration, language, revision: notes }),
    });
  } catch (e) {
    return { scene, problems: [...problems, `${where}: the revision failed — ${e.message}; the first draft stands`] };
  }
  const rawScene = Array.isArray(raw?.scenes) ? raw.scenes[0] : Array.isArray(raw) ? raw[0] : raw;
  const revised = normalizeScene({ rawScene, beat, index, language, setDir, budget: figureBudget(course) });
  if (densityProblems(revised.problems).length || revised.scene.clips.length === 0) {
    return { scene, problems: [...problems, `${where}: revised once for narration density and still outside the band — the first draft stands`, ...revised.problems] };
  }
  return { scene: revised.scene, problems: [`${where}: revised once for narration density`, ...revised.problems] };
}

/** A screenplay is usable when every beat got a scene and every scene has clips. */
function isComplete(scenes, course) {
  const beats = Array.isArray(course?.outline) ? course.outline : [];
  return scenes.length === beats.length && scenes.every((s) => s.clips.length > 0);
}

/**
 * The fallback lane: one call per beat, in order, each told what the
 * scene before it said. Slower and less connected than one pass over the
 * whole spine, but a single scene is a small enough answer that a model
 * which truncated the long one can still finish it.
 */
export async function writeMainSceneFallback({ course, chat, setDir, styleRecipe, styleDevices, narration, language, problems = [] } = {}) {
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
          styleDevices,
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
    const draft = normalizeScene({
      rawScene,
      beat,
      index: i,
      language: lang,
      setDir,
      budget: figureBudget(course),
    });
    const { scene, problems: sceneProblems } = await reviseScene({
      course, chat, setDir, styleRecipe, styleDevices, narration, language: lang,
      beat, index: i, total: beats.length, previousScene: previous,
      scene: draft.scene, problems: draft.problems,
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
export async function writeScreenplay({ course, chat, setDir, styleRecipe, styleDevices, narration, language } = {}) {
  const lang = language ?? course?.language ?? "en";
  const beats = Array.isArray(course?.outline) ? course.outline : [];
  if (beats.length === 0) throw new Error("the outline is empty — there is no spine to write scenes for");

  const carried = [];
  try {
    const raw = await chat({
      system: SCREENPLAY_SYSTEM,
      user: screenplayUser({ course, styleRecipe, styleDevices, narration, language: lang }),
    });
    const { scenes, problems } = validateScreenplay(raw, { course, language: lang, setDir });
    if (isComplete(scenes, course)) {
      if (!densityProblems(problems).length) return { scenes, problems, mode: "single" };
      // One repair pass per scene outside the band, each told what was
      // wrong. Problems are re-attributed per scene by their prefix.
      const out = problems.filter((p) => !/^scene \d+ \(/.test(p));
      for (let i = 0; i < scenes.length; i += 1) {
        const prefix = `scene ${i + 1} (`;
        const mine = problems.filter((p) => p.startsWith(prefix));
        const { scene, problems: after } = await reviseScene({
          course, chat, setDir, styleRecipe, styleDevices, narration, language: lang,
          beat: beats[i], index: i, total: beats.length, previousScene: scenes[i - 1] ?? null,
          scene: scenes[i], problems: mine,
        });
        scenes[i] = scene;
        out.push(...after);
      }
      return { scenes, problems: out, mode: "single" };
    }
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
    styleDevices,
    narration,
    language: lang,
    problems: carried,
  });
  return { scenes, problems, mode: "fallback" };
}

/**
 * Write the clips of a detour (or a learner's question) that was landed
 * as a stub with a brief. Returns clips in landed shape — id, video
 * prompt and `status: "planned"` included — so the manager can write them
 * straight onto the node and queue them.
 */
export async function writeDetourScene({ course, node, chat, styleRecipe, styleDevices, narration, language, setDir } = {}) {
  const brief = trim(node?.brief);
  if (!brief) throw new Error("this node has no brief — a detour scene is written from the brief it was offered with");
  if (typeof chat !== "function") throw new Error("writeDetourScene needs a chat function");

  const lang = language ?? course?.language ?? "en";
  const parentScene = node?.parent ? course?.nodes?.[node.parent] : null;
  const beats = Array.isArray(course?.outline) ? course.outline : [];
  const beatId = node?.beat ?? parentScene?.beat;
  const beat = beats.find((b) => b && b.id === beatId) ?? null;
  const label = trim(node?.choiceLabel) || brief.slice(0, 24);

  const ask = async (revision) => {
    const raw = await chat({
      system: DETOUR_SYSTEM,
      user: detourUser({ course, node, parentScene, styleRecipe, styleDevices, narration, language: lang, revision }),
    });
    const list = Array.isArray(raw?.clips) ? raw.clips : Array.isArray(raw) ? raw : raw?.scenes?.[0]?.clips;
    const checked = validateClips({
      raw: list,
      beat,
      language: lang,
      setDir,
      nodeId: node?.id,
      where: `detour ${label}`,
      max: MAX_DETOUR_CLIPS,
      budget: figureBudget(course),
    });
    return { raw, ...checked };
  };
  let { raw, clips, problems } = await ask();
  // A draft outside the narration density band is asked for once more
  // before the manager pays for a clip that would fail its transcript.
  const dense = densityProblems(problems);
  if (dense.length) {
    try {
      const again = await ask(dense);
      if (again.clips.length && !densityProblems(again.problems).length) {
        ({ raw, clips } = again);
        problems = [`detour ${label}: revised once for narration density`, ...again.problems];
      } else {
        problems = [...problems, `detour ${label}: revised once for narration density and still outside the band — the first draft stands`, ...again.problems];
      }
    } catch (e) {
      problems = [...problems, `detour ${label}: the revision failed — ${e.message}; the first draft stands`];
    }
  }

  const device = trim(raw?.device) || trim(parentScene?.device);
  return {
    device,
    clips: landClips({
      scene: { clips, label, device },
      styleRecipe: styleRecipe ?? course?.style?.recipe ?? "",
      narration: narration ?? (course?.style?.narration === "on-camera" ? "on-camera" : "voiceover"),
      language: lang,
    }),
    problems,
  };
}
