/**
 * anime-series prompt assembly — bible + episode in, prompts out. Pure: no
 * `node:*` imports, no I/O, so the viewer can show the same text the scripts
 * send (the no-key path copies it into Jimeng / Dreamina by hand).
 *
 * Port of the assembly in ai-anime-series `scripts/make_prompts.py`
 * (MIT, (c) 2026 硅基废话 / 10291124jcjc-dotcom; the licence text is in
 * LICENSE-ai-anime-series.txt beside this file). The method is kept:
 *   - reference order: cast (episode order) → groups that have a sheet →
 *     the scene sheet → the storyboard, always last;
 *   - the grid follows the shot count; the video prompt has one timed entry
 *     per storyboard panel, with its sound cue;
 *   - the video prompt opens by saying the storyboard is reference only and
 *     must never be pasted into the frame;
 *   - continuity lines, "no dialogue" unless the series wants it, and "no
 *     text in frame" last.
 *
 * The scaffolding is written in the bible's language (`bibleLang`): the
 * sentences live in `prompt-locales.mjs`, Chinese reusing the upstream
 * wording. The bible and the shot list are sent as the user wrote them.
 */

import { panelAspect } from "./grid.mjs";
import { PROMPT_LANGS, PROMPT_LOCALES } from "./prompt-locales.mjs";
import { PART_MIN_S, checkEpisode, fmtSeconds, gridOf, patchPlan, shotTimeline } from "./series-state.mjs";

/**
 * fal's Seedance 2.5 reference-to-video accepts up to 30 reference images
 * (`seedance-video.mjs`, MAX_REF_IMAGES). This is the limit for generation.
 */
export const SEEDANCE_MAX_REFS = 30;
/**
 * The Jimeng / Dreamina canvas limit the upstream method was built on (its
 * `JIMENG_MAX_REFS` default). Upstream calls it a third-party figure, to be
 * checked against the canvas's current limit, and lets an environment
 * variable change it; here it only raises a warning on the copy-paste
 * variant and never blocks, so there is no override.
 *
 * Past the limit the remedies are a group described in text or less
 * supporting cast. Upstream's third remedy, combining several supporting
 * sheets into one image (`grid.py grid`), is not offered: the review rows,
 * the check cells and the lineup compare each character or group against its
 * own sheet, so every reference stays one identity.
 */
export const JIMENG_MAX_REFS = 9;

/** How a reference image is addressed in a video prompt, per target. */
export const REF_TOKENS = Object.freeze({
  // seedance-video.mjs: "@Image1, @Image2 … by modality and order".
  seedance: (n) => `@Image${n}`,
  // Jimeng's omni-reference token, kept verbatim from the upstream method.
  jimeng: (n) => `@图${n}`,
});

/** The English cut line (each language has its own: `PROMPT_LOCALES[lang].copyLine`). */
export const COPY_LINE = PROMPT_LOCALES.en.copyLine;

export const DEFAULT_EXPRESSIONS = PROMPT_LOCALES.en.expressions;
export const DEFAULT_POSES = PROMPT_LOCALES.en.poses;
export const DEFAULT_GROUP_POSES = PROMPT_LOCALES.en.groupPoses;

export class PromptError extends Error {
  constructor(message) {
    super(message);
    this.name = "PromptError";
  }
}

const HAN = /[㐀-鿿豈-﫿]/g;
const LATIN_WORD = /[A-Za-z]{2,}/g;

/**
 * The language the scaffolding is written in: the bible's explicit `lang`
 * ("zh" | "en") when set, otherwise the language its own text is mostly in —
 * Han characters against Latin words over the title, the two style cards and
 * every entity's name and look.
 */
export function bibleLang(bible) {
  if (PROMPT_LANGS.includes(bible?.lang)) return bible.lang;
  const entities = [...(bible?.characters ?? []), ...(bible?.groups ?? []), ...(bible?.scenes ?? [])];
  const text = [bible?.title, bible?.style, bible?.sheetStyle, ...entities.flatMap((e) => [e?.name, e?.look])]
    .filter((x) => typeof x === "string")
    .join(" ");
  const han = text.match(HAN)?.length ?? 0;
  const latin = text.match(LATIN_WORD)?.length ?? 0;
  return han > latin ? "zh" : "en";
}

/** The scaffolding table for a bible. */
export function localeOf(bible) {
  return PROMPT_LOCALES[bibleLang(bible)];
}

/** The method's continuity lines, in the bible's language — `add-episode`'s default. */
export function defaultContinuity(bible) {
  return [...localeOf(bible).defaultContinuity];
}

/** Fill `{name}` placeholders; a missing value is an assembly bug, not an empty string. */
function fill(template, values) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`prompt template is missing {${key}}`);
    return String(values[key]);
  });
}

/** CJK text ends with a full-width stop, anything else with a period. */
const CJK_END = /[　-〿㐀-鿿豈-﫿＀-￯]$/;
const sentence = (text) => {
  const t = String(text ?? "").trim();
  if (!t) return "";
  if (/[.!?。！？…]$/.test(t)) return t;
  return CJK_END.test(t) ? `${t}。` : `${t}.`;
};
const clause = (text) => String(text ?? "").trim().replace(/[.。]+$/, "");
const nonEmpty = (lines) => lines.filter((line) => line !== null && line !== undefined && line !== false);

function byId(list, ids, what) {
  const index = new Map((list ?? []).map((item) => [item?.id, item]));
  const missing = ids.filter((id) => !index.has(id));
  if (missing.length) throw new PromptError(`the episode's ${what} ${missing.map((m) => `"${m}"`).join(", ")} ${missing.length > 1 ? "are" : "is"} not in bible.json`);
  return ids.map((id) => index.get(id));
}

function gridName(L, count) {
  return L.gridNames[count] ?? fill(L.gridFallback, { count });
}

// ---------------------------------------------------------------------------
// Design sheets
// ---------------------------------------------------------------------------

/**
 * The design-sheet prompt for one bible entity, and the aspect to render it
 * at. Lessons from the seed series' sheet rounds are built in where they are
 * mechanical: no explanatory text besides the name and panel captions (a
 * model added a paragraph of notes), a silhouette with no face, pose phrases
 * kept whole (separated by semicolons, so a pose with its own commas stays
 * one pose), group poses and the leader panel from the bible, the scene's
 * own time of day, and — for a scene drawn after the cast — the cast sheets
 * as style-only references (text-only scene sheets came out photoreal).
 *
 * `styleReferences` is the number of character sheets the caller attaches
 * as style references (scenes only).
 */
export function sheetPrompt(bible, kind, id, { styleReferences = 0 } = {}) {
  const list = { character: bible?.characters, group: bible?.groups, scene: bible?.scenes }[kind];
  if (!list) throw new PromptError(`kind must be character, group or scene (got: ${kind})`);
  const entity = list.find((e) => e?.id === id);
  if (!entity) throw new PromptError(`no ${kind} "${id}" in bible.json`);
  if (!String(entity.look ?? "").trim()) throw new PromptError(`${kind} "${id}" has no look yet — write it before drawing a sheet`);
  const lang = bibleLang(bible);
  const L = PROMPT_LOCALES[lang];
  const sheetStyle = String(bible?.sheetStyle ?? "").trim();
  let lines;
  let aspectRatio = "1:1";
  if (kind === "character") {
    const expressions = entity.expressions?.length ? entity.expressions : L.expressions;
    const poses = entity.poses?.length ? entity.poses : L.poses;
    lines = [
      fill(L.characterSheet, {
        expressionCount: expressions.length,
        expressions: expressions.join(L.expressionSep),
        poseCount: poses.length,
        poses: poses.join(L.poseSep),
        name: entity.name,
      }),
      fill(L.characterLook, { look: sentence(entity.look) }),
      sheetStyle || null,
    ];
  } else if (kind === "group") {
    aspectRatio = "16:9";
    const poses = entity.poses?.length ? entity.poses : L.groupPoses;
    const leader = String(entity.leader ?? "").trim();
    lines = [
      fill(L.groupSheet, {
        name: entity.name,
        look: sentence(entity.look),
        poseCount: poses.length,
        poses: poses.join(L.poseSep),
        leader: leader ? fill(L.groupSheetLeader, { leader: sentence(leader) }) : "",
      }),
      sheetStyle || null,
    ];
  } else {
    aspectRatio = bible?.ratio || "16:9";
    const time = String(entity.time ?? "").trim();
    lines = [
      nonEmpty([
        fill(L.sceneSheet, { name: entity.name, look: sentence(entity.look), time: time ? fill(L.sceneSheetTime, { time: clause(time) }) : "" }),
        rulesLine(L, entity),
        String(bible?.style ?? "").trim() ? sentence(bible.style) : null,
        L.sceneNoText,
      ]).join(L.sentenceJoin),
      styleReferences > 0 ? L.sceneStyleRefs : null,
    ];
  }
  return { kind, id, name: entity.name, lang, prompt: nonEmpty(lines).join("\n"), aspectRatio, styleReferences: kind === "scene" ? styleReferences : 0 };
}

/** The Jimeng copy-paste form of a sheet prompt: a canvas instruction line, the cut line, the body. */
export function jimengSheet(sheet) {
  const L = PROMPT_LOCALES[sheet.lang] ?? PROMPT_LOCALES.en;
  const head = fill(L.jimengSheetHead, {
    refs: sheet.styleReferences > 0 ? L.jimengSheetRefs : "",
    ratio: sheet.aspectRatio,
    kind: sheet.kind,
    id: sheet.id,
  });
  return `${head}\n${L.copyLine}\n\n${sheet.prompt}`;
}

/**
 * A lineup probe: two or more characters side by side from their picked
 * sheets, at one scale. The cheapest check that identities and the size
 * relation survive when the sheets are used together — before a clip.
 * `characters` are bible characters in reference order.
 */
export function lineupPrompt(bible, characters) {
  if (!Array.isArray(characters) || characters.length < 2) throw new PromptError("a lineup needs two or more characters");
  const L = localeOf(bible);
  const refs = characters.map((c, i) => fill(L.lineupRef, { n: i + 1, name: c.name })).join(L.listSep);
  return nonEmpty([
    fill(L.lineup, { refs, count: characters.length }),
    ...characters.map((c) => fill(L.textOnly, { name: c.name, look: sentence(c.look) })),
    String(bible?.sheetStyle ?? "").trim() || null,
  ]).join("\n");
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * The ordered reference list for one part: cast with a sheet, groups with a
 * sheet, the scene sheet, then the storyboard (always last, when given).
 * A cast member without a sheet is not an image reference; its look goes in
 * as text (`textOnly`). `sheetOf(kind, id)` returns the sheet asset in
 * effect or null.
 *
 * `limit` is checked against the full list, storyboard included.
 */
export function refsFor(bible, episode, { sheetOf = () => null, board = null, limit = SEEDANCE_MAX_REFS } = {}) {
  const L = localeOf(bible);
  const cast = byId(bible?.characters, episode?.cast ?? [], "cast member");
  const groups = byId(bible?.groups, episode?.groups ?? [], "group");
  const scenes = episode?.scene ? byId(bible?.scenes, [episode.scene], "scene") : [];
  const refs = [];
  const textOnly = [];
  for (const c of cast) {
    const asset = sheetOf("character", c.id);
    if (asset) refs.push({ kind: "character", id: c.id, name: c.name, look: c.look, asset });
    else textOnly.push({ kind: "character", id: c.id, name: c.name, look: c.look });
  }
  for (const g of groups) {
    const asset = sheetOf("group", g.id);
    const look = describeGroup(L, g);
    if (asset) refs.push({ kind: "group", id: g.id, name: g.name, look, asset });
    else textOnly.push({ kind: "group", id: g.id, name: g.name, look });
  }
  for (const s of scenes) {
    const asset = sheetOf("scene", s.id);
    if (asset) refs.push({ kind: "scene", id: s.id, name: s.name, look: s.look, asset });
  }
  if (board !== null) refs.push({ kind: "storyboard", id: null, name: "storyboard", look: "", asset: board });
  if (refs.length > limit) {
    throw new PromptError(`this part needs ${refs.length} reference images; the limit is ${limit}. Cut supporting cast or groups from the episode, or drop a group's sheet so it is described in text`);
  }
  refs.forEach((ref, i) => {
    ref.n = i + 1;
  });
  const markings = [...cast, ...groups].map((e) => String(e?.markings ?? "").trim()).filter(Boolean);
  return { refs, cast, groups, scene: scenes[0] ?? null, textOnly, markings };
}

/** A group's look plus its leader, as one description. */
function describeGroup(L, group) {
  const leader = String(group?.leader ?? "").trim();
  return leader ? fill(L.groupWithLeader, { look: sentence(group.look), leader: clause(leader) }) : group.look;
}

/** The episode's time of day, falling back to the scene's own. */
function timeOf(L, episode, scene) {
  return String(episode?.time ?? "").trim() || String(scene?.time ?? "").trim() || L.timeFallback;
}

/**
 * The closing line. Text that belongs to a character or group (a printed
 * label on the villain) is named as the one exception; everything else
 * stays out of frame.
 */
export function noTextLine(markings, lang = "en") {
  const L = PROMPT_LOCALES[lang] ?? PROMPT_LOCALES.en;
  return markings.length ? fill(L.noTextExcept, { markings: markings.map(clause).join(L.clauseSep) }) : L.noText;
}

function partOf(episode, partId) {
  const part = (episode?.parts ?? []).find((p) => p?.id === partId);
  if (!part) throw new PromptError(`episode ${episode?.id ?? "?"} has no part "${partId}"`);
  return part;
}

function assertTiming(episode) {
  const { errors } = checkEpisode(episode);
  if (errors.length) throw new PromptError(`episode ${episode?.id ?? "?"} breaks the timing rules:\n- ${errors.map((e) => e.message).join("\n- ")}`);
}

// ---------------------------------------------------------------------------
// Storyboard and panels
// ---------------------------------------------------------------------------

function characterReference(L, refs) {
  const who = refs.filter((r) => r.kind !== "storyboard").map((r) =>
    fill(r.kind === "scene" ? L.whoScene : L.whoEntity, { n: r.n, name: r.name }));
  return who.length ? fill(L.whoList, { list: who.join(L.listSep) }) : "";
}

function textOnlyLine(L, textOnly) {
  return textOnly.length ? textOnly.map((t) => fill(L.textOnly, { name: t.name, look: sentence(t.look) })).join(L.sentenceJoin) : null;
}

function placeLine(L, template, count, scene, time) {
  if (!scene) return null;
  return fill(template, { count, scene: scene.name, time: timeOf(L, { time }, scene) });
}

/** Whether a clause contains one of the locale's constraint words (whole words for Latin ones). */
function isConstraint(L, text) {
  return L.constraintWords.some((word) => (/^[A-Za-z]+$/.test(word) ? new RegExp(`\\b${word}\\b`, "i").test(text) : text.includes(word)));
}

/**
 * The scene's short constraints ("the clock face has no numbers"): its
 * `rules`, and with `fromLook` the clauses of its look that state one. The
 * board does not carry the scene's whole look (it is a pencil sketch with no
 * detailed background), so without this line a board drew "12" on a
 * numberless clock and the clip copied the board.
 */
function rulesLine(L, scene, { fromLook = false } = {}) {
  const rules = String(scene?.rules ?? "").trim();
  const found = rules ? [clause(rules)] : [];
  if (fromLook) {
    for (const part of String(scene?.look ?? "").split(/[;；。.!！?？\n,，]+/)) {
      const text = part.trim();
      if (text && isConstraint(L, text) && !found.some((f) => f.includes(text))) found.push(text);
    }
  }
  return found.length ? fill(L.sceneRules, { rules: sentence(found.join(L.clauseSep)) }) : null;
}

/**
 * The B/W grid storyboard for one part. `refs` excludes the storyboard
 * itself. It ends by restating black-and-white: the references are colour
 * sheets, and a board drawn in colour gets copied into the clip.
 */
export function storyboardPrompt(bible, episode, part, ctx) {
  const L = localeOf(bible);
  const shots = part.shots;
  const { rows, cols } = gridOf(shots.length);
  const lines = nonEmpty([
    fill(L.board, { ratio: bible?.ratio || "16:9", count: shots.length, gridName: gridName(L, shots.length), rows, cols, who: characterReference(L, ctx.refs) }),
    placeLine(L, L.boardPlace, shots.length, ctx.scene, episode.time),
    rulesLine(L, ctx.scene, { fromLook: true }),
    textOnlyLine(L, ctx.textOnly),
    "",
    ...shots.map((shot, i) => fill(L.boardShot, { n: i + 1, text: sentence(shot.sketch || shot.desc) })),
    "",
    L.boardClosing,
  ]);
  return lines.join("\n");
}

/**
 * One panel, drawn alone, to be composited back into the grid. With
 * `withBoard`, image 1 is the board it goes back into, attached as the style
 * reference (a panel drawn from the sheets alone came back with a circled
 * number, a lighter pencil and a wider framing than its neighbours); the
 * sheets follow from image 2.
 */
export function panelPrompt(bible, episode, part, shotNumber, ctx, { withBoard = false } = {}) {
  const L = localeOf(bible);
  const shot = part.shots[shotNumber - 1];
  if (!shot) throw new PromptError(`part ${part.id} has no shot ${shotNumber}`);
  const { rows, cols } = gridOf(part.shots.length);
  return nonEmpty([
    fill(L.panel, { count: part.shots.length, gridName: gridName(L, part.shots.length), rows, cols, shot: shotNumber, who: characterReference(L, ctx.refs) }),
    withBoard ? L.panelBoardRef : null,
    placeLine(L, L.panelPlace, 1, ctx.scene, episode.time),
    rulesLine(L, ctx.scene, { fromLook: true }),
    textOnlyLine(L, ctx.textOnly),
    "",
    fill(L.boardShot, { n: shotNumber, text: sentence(shot.sketch || shot.desc) }),
    "",
    L.boardClosing,
  ]).join("\n");
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

/**
 * The video prompt for `entries` (`{ number, shot }`, consecutive), timed
 * from 0. `refs` includes the storyboard last; `token` addresses them.
 * `patch` (`[a, b]`) says the run covers only those panels.
 */
export function videoPrompt(bible, episode, entries, ctx, { token = REF_TOKENS.seedance, patch = null } = {}) {
  const L = localeOf(bible);
  const board = ctx.refs.find((r) => r.kind === "storyboard");
  if (!board) throw new PromptError("a video prompt needs the storyboard as its last reference");
  const lines = [
    fill(L.videoOpen, { board: token(board.n), note: patch ? fill(L.videoPatchNote, { a: patch[0], b: patch[1] }) : "" }),
    "",
  ];
  for (const ref of ctx.refs) {
    if (ref.kind === "character") lines.push(fill(L.videoCharacter, { token: token(ref.n), name: ref.name, look: sentence(ref.look) }));
    else if (ref.kind === "group") lines.push(fill(L.videoGroup, { token: token(ref.n), name: ref.name, look: sentence(ref.look) }));
  }
  for (const t of ctx.textOnly) lines.push(fill(L.textOnly, { name: t.name, look: sentence(t.look) }));
  const style = nonEmpty([
    String(bible?.style ?? "").trim() ? sentence(bible.style) : null,
    bible?.dialogue ? null : L.noDialogue,
  ]);
  const sceneRef = ctx.refs.find((r) => r.kind === "scene");
  if (ctx.scene) {
    style.push(fill(L.videoPlace, { scene: ctx.scene.name, time: timeOf(L, episode, ctx.scene), look: sentence(ctx.scene.look) }));
    const rules = rulesLine(L, ctx.scene);
    if (rules) style.push(rules);
    if (sceneRef) style.push(fill(L.videoSceneRef, { token: token(sceneRef.n) }));
  }
  lines.push("", fill(L.videoStyle, { style: style.join(L.sentenceJoin) }), "");
  const continuity = (episode.continuity ?? []).map(clause).filter(Boolean);
  if (continuity.length) lines.push(fill(L.continuity, { lines: continuity.join(L.clauseSep) }), "");
  let t = 0;
  for (const { number, shot } of entries) {
    const end = Math.round((t + Number(shot.dur)) * 10) / 10;
    lines.push(fill(L.videoShot, { n: number, start: fmtSeconds(t), end: fmtSeconds(end), desc: sentence(shot.desc) }));
    lines.push(fill(L.videoSound, { sfx: String(shot.sfx ?? "").trim() }));
    lines.push("");
    t = end;
  }
  lines.push(noTextLine(ctx.markings ?? [], bibleLang(bible)));
  return lines.join("\n");
}

function jimengVideoHead(bible, refs, seconds, label) {
  const L = localeOf(bible);
  const order = refs.map((r) => fill(r.kind === "storyboard" ? L.jimengVideoBoard : L.jimengVideoNode, { token: REF_TOKENS.jimeng(r.n), name: r.name }));
  return fill(L.jimengVideoHead, { order: order.join(L.nodeSep), ratio: bible?.ratio || "16:9", seconds: fmtSeconds(seconds), label });
}

function jimengLimitWarning(refs) {
  return refs.length > JIMENG_MAX_REFS
    ? [`the Jimeng variant needs ${refs.length} reference images; the Jimeng canvas takes at most ${JIMENG_MAX_REFS} (the upstream method's figure, from third-party reports — check the canvas's current limit)`]
    : [];
}

/**
 * Everything for one part: grid, timing, references, the storyboard prompt,
 * the Seedance video prompt and the Jimeng copy-paste variants.
 *
 *   sheetOf(kind, id) → sheet asset id in effect, or null
 *   board             → storyboard asset id in effect, or null (a planned slot)
 *   boardFile         → where the Jimeng user should save the storyboard
 */
export function assemblePart(bible, episode, partId, { sheetOf = () => null, board = null, boardFile = null, limit = SEEDANCE_MAX_REFS } = {}) {
  assertTiming(episode);
  const L = localeOf(bible);
  const part = partOf(episode, partId);
  const parts = episode.parts.length;
  const seconds = Number(episode.duration) / parts;
  const grid = gridOf(part.shots.length);
  const sheetCtx = refsFor(bible, episode, { sheetOf, board: null, limit });
  const videoCtx = refsFor(bible, episode, { sheetOf, board: board ?? "(storyboard)", limit });
  const storyboard = storyboardPrompt(bible, episode, part, sheetCtx);
  const entries = part.shots.map((shot, i) => ({ number: i + 1, shot }));
  const label = parts > 1 ? fill(L.labelPart, { part: partId, parts }) : L.labelWhole;
  const seedance = videoPrompt(bible, episode, entries, videoCtx, { token: REF_TOKENS.seedance });
  const jimengBody = videoPrompt(bible, episode, entries, videoCtx, { token: REF_TOKENS.jimeng });
  const nodes = sheetCtx.refs.map((r) => fill(L.jimengBoardNode, { name: r.name }));
  const jimengBoardHead = fill(L.jimengBoardHead, {
    nodes: nodes.length ? nodes.join(L.nodeSep) : L.jimengNoNodes,
    ratio: bible?.ratio || "16:9",
    saveAs: boardFile ? fill(L.jimengSaveAs, { file: boardFile }) : "",
    episode: episode.id,
    part: partId,
  });
  return {
    episode: episode.id,
    part: partId,
    lang: bibleLang(bible),
    seconds,
    shots: part.shots.length,
    grid: { rows: grid.rows, cols: grid.cols, tidy: grid.tidy },
    timeline: shotTimeline(part.shots),
    refs: videoCtx.refs.map(({ n, kind, id, name, asset }) => ({ n, kind, id, name, asset: kind === "storyboard" ? board : asset })),
    textOnly: videoCtx.textOnly.map(({ kind, id, name }) => ({ kind, id, name })),
    storyboard: { prompt: storyboard, refs: sheetCtx.refs.map((r) => r.asset) },
    video: { prompt: seedance },
    jimeng: {
      storyboard: `${jimengBoardHead}\n${L.copyLine}\n\n${storyboard}`,
      video: `${jimengVideoHead(bible, videoCtx.refs, seconds, label)}\n${L.copyLine}\n\n${jimengBody}`,
    },
    warnings: jimengLimitWarning(videoCtx.refs),
  };
}

/**
 * The single-panel redraw prompt for shot `shotNumber` of a part. `board`
 * (the board the panel goes back into) is attached first, as the style
 * reference; the sheets follow. `aspectRatio` is the one the panel is drawn
 * at: one cell of the grid at the series ratio.
 *
 * `jimeng.panel` is the copy-paste form. Its canvas line lists the nodes in
 * the order the prompt numbers them — the board first, then the sheets — so
 * selecting them in another order misnumbers every reference. `boardFile`
 * names the board's file in that line, so the user can tell it from older
 * boards on the canvas. The line ends by asking for the new board, once
 * registered, to go back on the canvas: the clip must select it, not the old
 * one.
 */
export function assemblePanel(bible, episode, partId, shotNumber, { sheetOf = () => null, board = null, boardFile = null } = {}) {
  assertTiming(episode);
  const L = localeOf(bible);
  const part = partOf(episode, partId);
  const ctx = refsFor(bible, episode, { sheetOf, board: null });
  const shifted = board ? { ...ctx, refs: ctx.refs.map((r) => ({ ...r, n: r.n + 1 })) } : ctx;
  const prompt = panelPrompt(bible, episode, part, shotNumber, shifted, { withBoard: Boolean(board) });
  const aspectRatio = panelAspect(bible?.ratio || "16:9", part.shots.length);
  const order = [
    ...(board ? [fill(L.jimengPanelBoard, { token: REF_TOKENS.jimeng(1), file: boardFile ?? board })] : []),
    ...shifted.refs.map((r) => fill(L.jimengVideoNode, { token: REF_TOKENS.jimeng(r.n), name: r.name })),
  ];
  const head = fill(L.jimengPanelHead, {
    order: order.length ? order.join(L.nodeSep) : L.jimengNoNodes,
    ratio: aspectRatio,
    episode: episode.id,
    part: partId,
    shot: shotNumber,
  });
  return {
    episode: episode.id,
    part: partId,
    shot: shotNumber,
    lang: bibleLang(bible),
    grid: gridOf(part.shots.length),
    aspectRatio,
    prompt,
    refs: [...(board ? [board] : []), ...ctx.refs.map((r) => r.asset)],
    jimeng: { panel: `${head}\n${L.copyLine}\n\n${prompt}` },
  };
}

/**
 * The re-shoot prompt for shots a–b of a part, widened to the minimum
 * generation length when needed (`plan.extended`). Shots keep their
 * numbers; the clock starts at 0 and both ends are hard cuts.
 */
export function assemblePatch(bible, episode, partId, a, b, { sheetOf = () => null, board = null, limit = SEEDANCE_MAX_REFS } = {}) {
  assertTiming(episode);
  const L = localeOf(bible);
  const part = partOf(episode, partId);
  const plan = patchPlan(part.shots, a, b);
  const [lo, hi] = plan.covered;
  const ctx = refsFor(bible, episode, { sheetOf, board: board ?? "(storyboard)", limit });
  const entries = part.shots.slice(lo - 1, hi).map((shot, i) => ({ number: lo + i, shot }));
  const seedance = videoPrompt(bible, episode, entries, ctx, { token: REF_TOKENS.seedance, patch: [lo, hi] });
  const jimeng = videoPrompt(bible, episode, entries, ctx, { token: REF_TOKENS.jimeng, patch: [lo, hi] });
  const label = fill(L.labelPatch, { part: partId, a: lo, b: hi });
  return {
    episode: episode.id,
    part: partId,
    lang: bibleLang(bible),
    plan,
    refs: ctx.refs.map(({ n, kind, id, name, asset }) => ({ n, kind, id, name, asset: kind === "storyboard" ? board : asset })),
    video: { prompt: seedance },
    jimeng: { video: `${jimengVideoHead(bible, ctx.refs, plan.requestSeconds, label)}\n${L.copyLine}\n\n${jimeng}` },
    warnings: [
      ...(plan.extended ? [`shots ${a}–${b} last ${fmtSeconds(plan.span[1] - plan.span[0])} s, under the ${PART_MIN_S} s minimum render; the patch also covers shots ${lo}–${hi} and only ${a}–${b} is spliced back`] : []),
      ...jimengLimitWarning(ctx.refs),
    ],
  };
}
