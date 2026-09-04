/**
 * h3-prompt — the one place plotwise's knowledge of how to talk to
 * MiniMax H3 lives.
 *
 * Luna writes what is seen and what is said; this module writes the
 * prompt. Its shape is the four-block montage grammar the community
 * validated on H3 and we reproduced on fal (references/h3-best-practices.md):
 *
 *   1. the STYLE ANCHOR verbatim, then the clip's subject in one line —
 *      the model has no memory across clips, and "as before" is nothing;
 *   2. a time-coded SHOT LIST: one line per cut, subject + action +
 *      setting + a bracketed camera move. H3 cuts by itself inside one
 *      prompt, and 4-8 cuts in 15 seconds is the zone the published
 *      prompts live in. Our own pipeline used to open every prompt with
 *      "One continuous shot, no cuts" — that single clause is most of why
 *      plotwise looked like a talking illustration (2026-09-04);
 *   3. the NARRATION, distributed across the timeline in `<d>` tags, so
 *      each line lands where its picture is;
 *   4. the AUDIO in two layers under the voice — ambience and action
 *      effects with the moment they land — and never music;
 *   5. the NEGATIVES, closing the prompt: the pipeline-wide ones (no text
 *      the prompt did not spell, no invented glyphs, no dissolves, and
 *      for a style with people no extra limbs) plus whatever the writer
 *      ruled out for this style.
 *
 * Two rules about language, both deliberate:
 *   - the CONTENT is written in the course's language (the validated
 *     prompts are Chinese; H3 reads both), because that is the language
 *     the topic, the evidence and the narration are already in;
 *   - the STRUCTURAL LABELS this module emits are English, and so is the
 *     style recipe it copies. The validated W1 prompt was exactly this
 *     mix — an English style anchor inside an otherwise Chinese shot
 *     list — and it keeps this repository's source in one language
 *     (.claude/rules/modes.md).
 *
 * Reference BINDINGS ("Image 1 is …", "Audio 1 is …") are not written at
 * writing time: the manager numbers them at the shoot from what the clip
 * actually binds (`insertReferenceBlock`), because the numbering depends
 * on the anchor, the character sheet and the figures of that one clip.
 *
 * Provenance and the reasoning behind each rule: references/h3-best-practices.md.
 * Change the practice there and here, together, and bump the version.
 */

import { basename } from "node:path";

/** Stamped on every clip the manager renders, so a course records which
 * generation of the practice shot it. */
export const H3_PRACTICES_VERSION = "2026-09-04-montage";

const LANGUAGE_NAMES = { zh: "Chinese", en: "English", ja: "Japanese" };
const lang2 = (language) => String(language ?? "").slice(0, 2).toLowerCase();
export const langName = (language) => LANGUAGE_NAMES[lang2(language)] ?? "English";

const trim = (v) => String(v ?? "").trim();
/** Languages whose sentences are not separated by a space. */
const isCjk = (language) => lang2(language) === "zh" || lang2(language) === "ja";

/** Close a clause with a stop in the right script, if it has none. */
function sentence(s, language) {
  const t = trim(s).replace(/\s+/g, " ");
  if (!t) return "";
  if (/[.!?。！？；;：:,，、]$/.test(t)) return t;
  return isCjk(language) ? `${t}。` : `${t}.`;
}

/** The camera a cut gets when the writer named none. A cut with no camera
 * is a dead static frame, and the model reads the absence as "hold". */
export const DEFAULT_CAMERA = "static shot";
export function defaultCamera(language) {
  return lang2(language) === "zh" ? "固定镜头" : lang2(language) === "ja" ? "固定カメラ" : DEFAULT_CAMERA;
}

/** Styles that put people on screen need the people negatives. */
export function styleHasPeople({ narration, styleRecipe } = {}) {
  if (narration === "on-camera") return true;
  // Plurals included: the art-direction recipes say "characters", "faces",
  // "real people at real work" — a singular-only list missed three styles
  // that put drawn people on screen (2026-09-04).
  // `hands?(?!-)`: "hand-drawn" and "hand-painted" describe the line, not a
  // person — the chalkboard recipe was getting anatomy negatives for it.
  return /\b(characters?|hosts?|instructors?|teachers?|presenters?|persons?|people|actors?|figures? of|children|kids|hands?(?!-)|faces?|skin|bodies|body)\b/i.test(String(styleRecipe ?? ""));
}

/** "0-2s", "2-3.5s" — whole seconds stay whole. */
function span(from, to) {
  const fmt = (t) => (Number.isInteger(t) ? String(t) : String(Math.round(t * 10) / 10));
  return `${fmt(from)}-${fmt(to)}s`;
}

/**
 * Normalize the writer's cuts against the clip's duration: numeric
 * bounds clamped to [0, duration], sorted, the last cut carried to the
 * end, a missing camera filled in, figure paths deduped. Returns
 * `{ cuts, problems }`; an empty list means the writer wrote no shot list
 * at all, which the validator refuses.
 */
export function normalizeCuts(rawCuts, duration, { where = "clip", language } = {}) {
  const problems = [];
  const list = Array.isArray(rawCuts) ? rawCuts : [];
  const total = Number(duration) || 15;
  const cuts = [];
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const shot = trim(raw.shot ?? raw.action ?? raw.visual ?? raw.what);
    if (!shot) {
      problems.push(`${where} cut ${i + 1}: nothing is described — dropped`);
      return;
    }
    let from = Number(raw.from ?? raw.start ?? raw.t0);
    let to = Number(raw.to ?? raw.end ?? raw.t1);
    if (!Number.isFinite(from)) from = i === 0 ? 0 : (cuts[cuts.length - 1]?.to ?? 0);
    if (!Number.isFinite(to)) to = total;
    from = Math.min(Math.max(0, from), total);
    to = Math.min(Math.max(from, to), total);
    if (Number(raw.to) > total) problems.push(`${where} cut ${i + 1}: ends past the clip's ${total}s — clamped`);
    let camera = trim(raw.camera);
    if (!camera) {
      camera = defaultCamera(language);
      problems.push(`${where} cut ${i + 1}: no camera move — the cut would sit on a dead frame; using "${camera}"`);
    }
    const figures = [...new Set((Array.isArray(raw.figures) ? raw.figures : []).map(String).map(trim).filter(Boolean))];
    cuts.push({ from, to, shot, camera, ...(figures.length ? { figures } : {}) });
  });
  cuts.sort((a, b) => a.from - b.from);
  if (cuts.length && cuts[cuts.length - 1].to < total - 0.5) cuts[cuts.length - 1].to = total;
  return { cuts, problems };
}

/**
 * Normalize the narration into timed lines. The writer is asked for
 * `[{ from, to, text }]`; a bare array of strings (which a model reaches
 * for) is spread evenly across the clip rather than dropped, and said so.
 */
export function normalizeNarration(rawLines, duration, { where = "clip" } = {}) {
  const problems = [];
  const list = Array.isArray(rawLines) ? rawLines : rawLines ? [rawLines] : [];
  const total = Number(duration) || 15;
  const timed = [];
  const bare = [];
  list.forEach((raw) => {
    if (typeof raw === "string") {
      const text = trim(raw);
      if (text) bare.push(text);
      return;
    }
    if (!raw || typeof raw !== "object") return;
    const text = trim(raw.text ?? raw.script ?? raw.line);
    if (!text) return;
    let from = Number(raw.from ?? raw.start ?? raw.t0);
    let to = Number(raw.to ?? raw.end ?? raw.t1);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      bare.push(text);
      return;
    }
    from = Math.min(Math.max(0, from), total);
    to = Math.min(Math.max(from, to), total);
    timed.push({ from, to, text });
  });
  if (bare.length) {
    problems.push(`${where}: ${bare.length} narration line${bare.length === 1 ? "" : "s"} carried no time span — spread evenly across the clip`);
    const slice = total / bare.length;
    bare.forEach((text, i) => {
      timed.push({ from: Math.round(i * slice * 10) / 10, to: Math.round((i + 1) * slice * 10) / 10, text });
    });
  }
  timed.sort((a, b) => a.from - b.from);
  return { narration: timed, problems };
}

/**
 * What the clip says, as one string: the narration lines in order. This
 * is what the transcript is compared against and what script.md records,
 * so it has exactly one definition.
 */
export function clipScript(clip, language) {
  const lines = (Array.isArray(clip?.narration) ? clip.narration : [])
    .map((l) => trim(typeof l === "string" ? l : l?.text))
    .filter(Boolean);
  return lines.join(isCjk(language ?? clip?.language) ? "" : " ");
}

/**
 * The negatives that close every prompt. Pipeline-wide first — invented
 * on-screen text is this mode's oldest failure, and a knowledge figure
 * must be reproduced rather than re-imagined — then whatever the writer
 * ruled out for this style.
 *
 * Note what is NOT here any more: "hard cuts". A montage is cuts. It is
 * also not "objects or shapes the prompt did not describe" — with a
 * figure on screen that clause made the model paste the figure as a flat
 * picture on an empty background (2026-09-04, math-anim n3/n4).
 */
export function negativesFor({ narration, styleRecipe, figures = [], extra, language } = {}) {
  const parts = [
    `any on-screen text, labels, formulas or numbers beyond what this prompt spells out in quotes${figures.length ? " or the reference figure carries" : ""}`,
    "garbled or invented characters or numbers",
    "soft dissolves or morphing between shots",
    "camera shake",
    "any spoken word beyond the narration above, including muttering, chanting or invented speech",
  ];
  if (styleHasPeople({ narration, styleRecipe })) {
    parts.push("extra fingers or limbs", "deformed hands or faces", "a second speaker", "lips out of sync with the words");
  }
  const own = trim(extra);
  return `${parts.join("; ")}.${own ? ` ${sentence(own, language)}` : ""}`;
}

/** "The reference figure "x.png" appears in this cut, …" — a figure is
 * content to reproduce, not a picture to paste. */
function figureClause(files) {
  return files
    .map(
      (file) =>
        `(The reference figure "${basename(file)}" appears in this cut, drawn in the scene's own materials and filling the frame — not pasted as a flat picture — with every label, axis and number reproduced faithfully and unaltered.)`,
    )
    .join(" ");
}

/**
 * The video prompt for ONE montage clip.
 *
 * @param {object} p
 * @param {string} p.styleRecipe  The style anchor, verbatim (the art direction).
 * @param {"voiceover"|"on-camera"} p.narration
 * @param {string} p.language     Course language tag (zh / en / ja).
 * @param {object} p.clip         { duration, theme, cuts[], narration[], audio, negatives }
 * @param {{index:number,total:number,sceneGoal?:string}} [p.part]
 *   Which clip of a multi-clip scene this is, so the model keeps the set.
 */
export function buildClipPrompt({ styleRecipe, narration, language, clip, part } = {}) {
  const duration = Number(clip?.duration) || 15;
  const { cuts } = normalizeCuts(clip?.cuts, duration, { language });
  const { narration: lines } = normalizeNarration(clip?.narration, duration);
  const figures = cuts.flatMap((c) => c.figures ?? []);

  const anchor = trim(styleRecipe) ? `1. Style anchor: ${sentence(styleRecipe, "en")}` : "1. Style anchor: (none on file).";
  const subject = trim(clip?.theme) ? `Subject: ${sentence(clip.theme, language)}` : "";
  const continuity =
    part && Number(part.total) > 1
      ? `This is part ${part.index} of ${part.total} of one continuous scene${trim(part.sceneGoal) ? ` about ${trim(part.sceneGoal)}` : ""}: the same set, materials, palette and lighting as the other parts. Never shown on screen.`
      : "";

  const shotList = [
    `2. Shot list — ${cuts.length} cut${cuts.length === 1 ? "" : "s"} in ${duration}s, cut on the times given:`,
    ...cuts.map((cut, i) => {
      const figs = cut.figures?.length ? ` ${figureClause(cut.figures)}` : "";
      return `${span(cut.from, cut.to)} Cut ${i + 1}: ${sentence(cut.shot, language)} [${cut.camera}]${figs}`;
    }),
  ].join("\n");

  const speaks =
    narration === "on-camera"
      ? "3. Narration — the speaker (S1) is in frame at medium distance and their lips are in sync with the words:"
      : "3. Narration — off-screen voiceover; no one on screen opens their mouth:";
  // "These are the only words" is load-bearing. A montage carries fewer
  // words than its seconds, and H3 fills the gap with invented speech:
  // measured 2026-09-04, a clip whose three lines came to ten seconds of
  // a fifteen-second montage came back with a stretch of gibberish
  // spliced between them (similarity 0.57 twice, the QA gate caught it),
  // while its neighbours in the same course passed at 0.96. Unspecified
  // audio is invented audio — the same lesson as `non_diegetic_music: N/A`.
  const narrationBlock = lines.length
    ? [
        speaks,
        ...lines.map((l) => `${span(l.from, l.to)} <d>[${langName(language)}]${l.text}</d>`),
        "These are the only words spoken in the whole clip. Outside them there is no speech at all — no muttering, no chanting, no crowd voices, no invented words — only the ambience below.",
      ].join("\n")
    : "";

  const audio = trim(clip?.audio);
  const audioBlock = `4. Audio: ${audio ? sentence(audio, language) : "quiet ambience matched to the scene."} Nothing louder than the voice, and no music.`;

  const negatives = `5. Do not show: ${negativesFor({ narration, styleRecipe, figures, extra: clip?.negatives, language })}`;

  return [[anchor, subject, continuity].filter(Boolean).join("\n"), shotList, narrationBlock, audioBlock, negatives]
    .filter(Boolean)
    .join("\n\n");
}

/** What each reference does, by the job the manager gave it. */
const JOB_TEXT = {
  "style-anchor":
    "this course's style anchor — its palette, materials, line quality, lighting and set carry over exactly; it is a look reference, not a picture to show",
  continuity:
    "the last frame of the previous part of this scene; this part continues in the same set, with the same materials and lighting",
  character: "keep this person's identity, face, hair and outfit exactly as they are here",
};

/**
 * The numbered reference bindings for one clip, in the order the manager
 * passes the files to fal. `refs` is `[{ file, job, kind, note?, cut? }]`;
 * images are numbered "Image N" in order and the voice is "Audio 1".
 * A figure names the cut it belongs to, so the model knows WHEN as well
 * as WHICH.
 */
export function bindingLines({ refs = [], narration = "voiceover" } = {}) {
  const lines = [];
  let image = 0;
  for (const ref of refs) {
    if (ref.kind === "audio") continue;
    image += 1;
    if (ref.job === "figure") {
      const cut = Number(ref.cut) > 0 ? ` It appears in cut ${Number(ref.cut)}` : " It appears in the cut that names it";
      lines.push(
        `Image ${image} is the code-rendered knowledge figure "${basename(ref.file)}"${trim(ref.note) ? ` (${trim(ref.note)})` : ""}.${cut}, drawn in the scene's own materials with every label, axis and number reproduced faithfully and unaltered.`,
      );
    } else {
      lines.push(`Image ${image} is ${JOB_TEXT[ref.job] ?? "a reference for this clip"}.`);
    }
  }
  if (refs.some((r) => r.kind === "audio")) {
    lines.push(
      narration === "on-camera"
        ? "Audio 1 is the speaker's voice — they speak in exactly this voice, timbre and pace."
        : "Audio 1 is the narrator's voice — the voiceover keeps exactly this voice, timbre and pace.",
    );
  }
  return lines;
}

/**
 * Put the numbered bindings into the prompt as their own block, between
 * the style anchor and the shot list: the references say who and what the
 * picture is made of, so the model must read them before the cuts.
 * A prompt with no recognizable blocks gets them appended.
 */
export function insertReferenceBlock(prompt, lines) {
  const block = (lines ?? []).filter(Boolean).join(" ");
  if (!block) return prompt;
  const body = `Reference material: ${block}`;
  const at = prompt.indexOf("\n\n2. Shot list");
  if (at === -1) return `${prompt.trimEnd()}\n\n${body}`;
  return `${prompt.slice(0, at)}\n\n${body}${prompt.slice(at)}`;
}
