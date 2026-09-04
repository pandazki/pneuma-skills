/**
 * h3-prompt — the one place plotwise's knowledge of how to talk to
 * MiniMax H3 lives.
 *
 * Luna writes what is said and what is seen; this module writes the
 * prompt. The shape follows fal's H3 Max prompt spec (three labeled
 * sections the expander rewrites toward) and, inside the description,
 * the four-block order the community validated on H3 — style anchor
 * first, then the picture as timed beats each with its camera, then the
 * narration, then the negatives — with the practices below baked in so
 * no model has to remember them:
 *
 *   - the STYLE ANCHOR is the first sentence of every shot, verbatim: the
 *     model has no memory across shots, and "as before" is nothing;
 *   - every beat carries a CAMERA MOVE written as motion + amplitude +
 *     speed; a beat without one gets a default, because no camera means
 *     a dead static shot;
 *   - the picture is written as a TIMELINE of beats inside one continuous
 *     take ("0-3s … 3-7s …"): the model's time allocation follows the
 *     numbers, and the narration lands where the picture changes;
 *   - the SOUND is three layers — ambience, action effects, the voice —
 *     and the voice is the narration, fixed; the writer's `sound` line
 *     carries the other two and when they land;
 *   - the NEGATIVES close every prompt: no text the prompt did not spell,
 *     no garbled glyphs, no dissolves/morphs/cuts/shake, and for any style
 *     with people: no extra limbs, no deformed hands or faces, lips in
 *     sync with the words;
 *   - reference BINDINGS ("Image 1 is …", "Audio 1 is …") are not written
 *     here: the manager numbers them at shoot time (`injectBindings`)
 *     from what the shot actually binds — the style anchor or the
 *     previous frame, the characters, the figures, the voice.
 *
 * Provenance and the reasoning behind each rule: references/h3-best-practices.md.
 * Change the practice there and here, together, and bump the version.
 */

import { basename } from "node:path";

/** Stamped on every shot the manager renders, so a course records which
 * generation of the practice shot it. */
export const H3_PRACTICES_VERSION = "2026-09-04";

const LANGUAGE_NAMES = { zh: "Chinese", en: "English", ja: "Japanese" };
const langName = (language) => LANGUAGE_NAMES[String(language ?? "").slice(0, 2)] ?? "English";
const trim = (v) => String(v ?? "").trim();
const sentence = (s) => {
  const t = trim(s).replace(/\s+/g, " ");
  return t && !/[.!?。！？]$/.test(t) ? `${t}.` : t;
};

/** The camera a beat gets when the writer named none. */
export const DEFAULT_CAMERA = "the camera holds steady with a slow, small push-in";

/** Words that mean the writer did describe a camera. */
const CAMERA_WORDS = /\b(camera|dolly|push(es|ing)? in|pull(s|ing)? (out|back)|pan(s|ning)?|tilt(s|ing)?|orbit|tracking|handheld|zoom|crane|static shot|holds? (still|steady)|locked[- ]off)\b/i;

export function hasCameraDirection(text) {
  return CAMERA_WORDS.test(String(text ?? ""));
}

/** Styles that put people on screen need the people negatives. */
export function styleHasPeople({ narration, styleRecipe } = {}) {
  if (narration === "on-camera") return true;
  return /\b(character|host|instructor|teacher|presenter|person|people|actor|figure of a|children|kids|hands?)\b/i.test(String(styleRecipe ?? ""));
}

/**
 * Normalize the writer's beats against the shot's duration: numeric
 * bounds, clamped to [0, duration], sorted, camera filled in. Returns
 * `{ beats, problems }`; an empty list means "no beats written".
 */
export function normalizeBeats(rawBeats, duration, { where = "shot" } = {}) {
  const problems = [];
  const list = Array.isArray(rawBeats) ? rawBeats : [];
  const total = Number(duration) || 10;
  const beats = [];
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const action = trim(raw.action ?? raw.what ?? raw.visual);
    if (!action) {
      problems.push(`${where} beat ${i + 1}: no action — dropped`);
      return;
    }
    let from = Number(raw.from ?? raw.start ?? raw.t0);
    let to = Number(raw.to ?? raw.end ?? raw.t1);
    if (!Number.isFinite(from)) from = i === 0 ? 0 : (beats[beats.length - 1]?.to ?? 0);
    if (!Number.isFinite(to)) to = total;
    from = Math.min(Math.max(0, from), total);
    to = Math.min(Math.max(from, to), total);
    if (to > total || Number(raw.to) > total) problems.push(`${where} beat ${i + 1}: ends past the shot's ${total}s — clamped`);
    let camera = trim(raw.camera);
    if (!camera) {
      problems.push(`${where} beat ${i + 1}: no camera — the shot would sit on a dead static frame; using "${DEFAULT_CAMERA}"`);
      camera = DEFAULT_CAMERA;
    }
    beats.push({ from, to, action, camera });
  });
  beats.sort((a, b) => a.from - b.from);
  if (beats.length && beats[beats.length - 1].to < total - 0.5) {
    beats[beats.length - 1].to = total;
  }
  return { beats, problems };
}

/** "0-3s — action; the camera …" for one beat. */
function beatSentence(beat) {
  const span = `${Math.round(beat.from)}-${Math.round(beat.to)}s`;
  const cam = trim(beat.camera);
  return `${span} — ${sentence(beat.action)} ${sentence(cam.charAt(0).toUpperCase() + cam.slice(1))}`;
}

/** The negatives that close every prompt, by what the style shows. */
export function negativesFor({ narration, styleRecipe, figures = [] } = {}) {
  const parts = [
    `Do not show: any on-screen text, labels, formulas or numbers beyond what this prompt spells out in quotes${figures.length ? " or the reference figure carries" : ""}`,
    "garbled or invented characters",
    "soft dissolves, morphs or hard cuts",
    "camera shake",
    "objects or shapes the prompt did not describe",
  ];
  if (styleHasPeople({ narration, styleRecipe })) {
    parts.push("extra fingers or limbs", "deformed hands or faces", "a second speaker", "lips out of sync with the words");
  }
  return `${parts.join("; ")}.`;
}

/**
 * The video prompt for ONE shot.
 *
 * @param {object} p
 * @param {string} p.styleRecipe   The style anchor (five elements), verbatim.
 * @param {"voiceover"|"on-camera"} p.narration
 * @param {string} p.language      Course language tag (zh / en / ja).
 * @param {object} p.shot          { script, visual, duration, figures, beats?, sound? }
 * @param {string} [p.sceneGoal]   What the scene explains (a continuity note, never on screen).
 * @param {boolean} [p.hasParentFrame]  A frame is supplied at shoot time (previous shot or anchor).
 * @param {boolean} [p.isSceneOpening]  The supplied frame is the style anchor, not a continuation.
 */
export function buildShotPrompt({
  styleRecipe,
  narration,
  language,
  shot,
  sceneGoal,
  hasParentFrame = false,
  isSceneOpening = false,
} = {}) {
  const script = trim(shot?.script);
  const visual = trim(shot?.visual);
  const duration = Number(shot?.duration) || 10;
  const figures = [...new Set((Array.isArray(shot?.figures) ? shot.figures : []).map(String).filter(Boolean))];
  const { beats } = normalizeBeats(shot?.beats, duration);

  const anchor = trim(styleRecipe) ? `Style anchor: ${sentence(styleRecipe)}` : "";

  const continuity = hasParentFrame
    ? isSceneOpening
      ? "The supplied frame is this course's look: its palette, materials, line quality, lighting and set carry over exactly, and this scene is established from it."
      : "This shot continues seamlessly from the previous shot's last frame — the same set, stroke texture, handwriting and typography, lighting and framing carry over; that frame is not new content to describe."
    : "";

  const goalNote = trim(sceneGoal)
    ? `Continuity note, never shown on screen: this shot is one part of a longer continuous scene explaining ${trim(sceneGoal)}, and the set and materials stay identical across it.`
    : "";

  // The picture: timed beats when the writer gave them, else the visual
  // with the camera it names or the default.
  let picture;
  if (beats.length) {
    picture = `Timeline of this one continuous take: ${beats.map(beatSentence).join(" ")}`;
  } else {
    const cam = hasCameraDirection(visual) ? "" : sentence(DEFAULT_CAMERA.charAt(0).toUpperCase() + DEFAULT_CAMERA.slice(1));
    picture = [sentence(visual), `The action fills the ${duration} seconds and is the visual focus.`, cam].filter(Boolean).join(" ");
  }

  const figureClause = figures
    .map((file) => `The reference figure "${basename(file)}" appears on screen, reproduced faithfully — every label, axis and number unaltered.`)
    .join(" ");

  const narrationClause =
    narration === "on-camera"
      ? `The speaker (S1), framed at medium distance facing the camera, says: <d>[${langName(language)}] ${script}</d>`
      : `A clear, warm narrator says in an off-screen voiceover: <d>[${langName(language)}] ${script}</d>. No on-screen character's lips move.`;

  const description = [
    "integrated_multimodal_description: [Shot 1] One continuous shot, no cuts.",
    anchor,
    continuity,
    goalNote,
    picture,
    figureClause,
    narrationClause,
    negativesFor({ narration, styleRecipe, figures }),
  ]
    .filter(Boolean)
    .join(" ");

  const soundLine = trim(shot?.sound);
  const sound = soundLine
    ? `${sentence(soundLine.charAt(0).toUpperCase() + soundLine.slice(1))} Nothing louder than the voice.`
    : "Quiet ambience matched to the scene, low enough that the narration stays the focus.";

  return [description, `overall_soundscape: ${sound}`, "non_diegetic_music: N/A"].join("\n");
}
