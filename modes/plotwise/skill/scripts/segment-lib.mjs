/**
 * Plotwise segment library — the pure, testable half of the play loop.
 *
 * Everything `produce-segment.mjs` and `course-edit.mjs` do that does not
 * touch the network lives here: reading the style catalog, resolving a
 * beat's evidence, planning reference bindings, comparing a transcript to
 * its script, and committing to course.json under a lock. Kept separate
 * so `modes/plotwise/__tests__/` can pin the behavior without spending a
 * cent on fal.ai or OpenRouter.
 *
 * Path convention: every file path inside course.json and evidence lists
 * is SET-RELATIVE (`nodes/n3/video.mp4`, `evidence/b2/fig.png`). Callers
 * pass `setDir` (absolute or cwd-relative) and this module joins.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { spawnSync } from "node:child_process";

export const FIGURE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
export const FIGURE_KINDS = new Set(["rendered-figure", "figure"]);
/** fal reference analysis is the slow, paid part of reference-to-video —
 * continuity frame + up to three figures/characters is the ceiling. */
export const MAX_REFS = 4;

/** Transcript similarity above this passes without a judge call; below
 * QA_AUTO_FAIL it fails without one. In between, a designed LLM call
 * decides like an editor (or, keyless, QA_KEYLESS_PASS splits it). */
export const QA_AUTO_PASS = 0.97;
export const QA_AUTO_FAIL = 0.6;
export const QA_KEYLESS_PASS = 0.9;

// ── Style catalog ───────────────────────────────────────────────────────────

/**
 * Parse `references/styles.md` into `Map<id, { recipe, narration }>`.
 * A recipe section is a `##`/`###` heading whose text is a bare style id
 * followed by a `**Recipe**: "..."` line; anything else (prose headings)
 * is skipped. Narration mode is the first token of the Narration line:
 * `on-camera` or `voiceover`.
 */
export function parseStyleCatalog(markdown) {
  const catalog = new Map();
  const sections = String(markdown).split(/\n(?=#{2,3} )/);
  for (const section of sections) {
    const head = section.match(/^#{2,3} ([a-z0-9][a-z0-9-]*)\s*$/m);
    if (!head) continue;
    const recipe = section.match(/\*\*Recipe\*\*:\s*"([\s\S]*?)"/);
    if (!recipe) continue;
    const narration = section.match(/\*\*Narration\*\*:\s*([a-z-]+)/);
    catalog.set(head[1], {
      recipe: recipe[1].replace(/\s*\n\s*/g, " ").trim(),
      narration: narration?.[1]?.startsWith("on-camera") ? "on-camera" : "voiceover",
    });
  }
  return catalog;
}

/**
 * The style a shoot works under: a custom/adjusted recipe on the course
 * wins over the catalog entry; narration mode comes from the catalog
 * (custom styles are voiceover unless the course says `on-camera`).
 */
export function resolveStyle(course, stylesMarkdown) {
  const s = course?.style && typeof course.style === "object" ? course.style : {};
  const id = typeof s.id === "string" ? s.id : "";
  const preset = stylesMarkdown ? parseStyleCatalog(stylesMarkdown).get(id) : undefined;
  const custom = typeof s.recipe === "string" && s.recipe.trim() ? s.recipe.trim() : null;
  return {
    id,
    name: typeof s.name === "string" && s.name ? s.name : id,
    recipe: custom ?? preset?.recipe ?? id,
    narration: s.narration === "on-camera" ? "on-camera" : (preset?.narration ?? "voiceover"),
    status: typeof s.status === "string" ? s.status : id ? "confirmed" : "pending",
    fromCatalog: !!preset && !custom,
  };
}

// ── Language ────────────────────────────────────────────────────────────────

/** Best-effort language tag from course text: kana → ja, CJK → zh, else en. */
export function detectLanguage(text) {
  const s = String(text ?? "");
  if (/[぀-ヿ]/.test(s)) return "ja";
  if (/[一-鿿]/.test(s)) return "zh";
  return "en";
}

// ── Speech budget ───────────────────────────────────────────────────────────

/** Scripts past this multiple of the budget are sent back to the writer
 * once before any shoot; measured: 1.25× spoke fine in 10s, 1.85× was
 * rushed into an unintelligible clip twice. */
export const SPEECH_OVERRUN = 1.4;

function isCjk(language) {
  const l = String(language ?? "");
  return l.startsWith("zh") || l.startsWith("ja");
}

/** Comfortable speech per clip: ~4.8 CJK characters or ~2.6 English words
 * per second (write-script.mjs states the same rule to the writer). */
export function speechBudgetUnits(language, seconds) {
  return Math.round(seconds * (isCjk(language) ? 4.8 : 2.6));
}

/** Spoken length of a script in budget units. In CJK scripts a Latin
 * token (an acronym, a code identifier) costs about two characters. */
export function speechUnits(text, language) {
  const s = String(text ?? "");
  if (isCjk(language)) {
    const cjk = (s.match(/[぀-ヿ㐀-鿿]/g) ?? []).length;
    const latin = (s.match(/[A-Za-z0-9][A-Za-z0-9.\-_/]*/g) ?? []).length;
    return cjk + latin * 2;
  }
  return (s.match(/[A-Za-z0-9][A-Za-z0-9.'\-]*/g) ?? []).length;
}

// ── Transcript comparison ───────────────────────────────────────────────────

/** Strip everything that is not a letter/number so punctuation, spacing
 * and width differences never count against a transcript. */
const CN_DIGITS = "零一二三四五六七八九";
const CN_UNITS = ["", "十", "百", "千"];

/** 0..9999 in spoken Chinese numerals ("二十四", "一百零五", "二千零二十四"). */
function cnSection(num) {
  const digits = String(num).padStart(4, "0").split("").map(Number);
  let out = "";
  let pendingZero = false;
  for (let i = 0; i < 4; i++) {
    const d = digits[i];
    if (d === 0) {
      pendingZero = out.length > 0;
      continue;
    }
    if (pendingZero) {
      out += "零";
      pendingZero = false;
    }
    out += CN_DIGITS[d] + CN_UNITS[3 - i];
  }
  return out;
}

/** A run of digits, with an optional decimal part, as it is spoken in
 * Chinese: "24" → 二十四, "0.5" → 零点五, "3.14" → 三点一四. Very long
 * integers are read digit by digit, as a phone number would be. */
export function digitsToChinese(run) {
  const [intPart, frac] = String(run).split(".");
  let out;
  const n = Number(intPart);
  if (intPart.length > 8 || !Number.isSafeInteger(n)) {
    out = [...intPart].map((d) => CN_DIGITS[Number(d)] ?? d).join("");
  } else if (n === 0) {
    out = "零";
  } else {
    const high = Math.floor(n / 10000);
    const low = n % 10000;
    out = high ? `${cnSection(high)}万` : "";
    if (low) out += (high && low < 1000 ? "零" : "") + cnSection(low);
    out = out.replace(/^一十/, "十");
  }
  if (frac !== undefined && frac.length) out += `点${[...frac].map((d) => CN_DIGITS[Number(d)] ?? d).join("")}`;
  return out;
}

/** What the recognizer writes as a symbol, the narrator said as a word. */
const SPOKEN_SYMBOLS = [
  [/²/g, "平方"],
  [/³/g, "立方"],
  [/√/g, "根号"],
  [/(?<=[\d\p{Script=Han}a-z)])\s*÷\s*/gu, "除以"],
  [/(?<=\d)\s*\/\s*(?=\d)/g, "除以"],
  [/(?<=[\d\p{Script=Han}a-z)])\s*[×*]\s*(?=[\d\p{Script=Han}a-z(])/gu, "乘"],
  [/(?<=[\d\p{Script=Han}a-z)])\s*\+\s*(?=[\d\p{Script=Han}a-z(])/gu, "加"],
  [/(?<=[\d\p{Script=Han}a-z)])\s*[−-]\s*(?=[\d\p{Script=Han}a-z(])/gu, "减"],
  [/(?<=[\d\p{Script=Han}a-z)])\s*=\s*/gu, "等于"],
];

/**
 * Both sides of the narration check pass through here. The script is
 * written the way it is spoken ("零点五", "二十四"); the transcriber
 * writes digits and symbols ("0.5", "24", "+", "²") — so a correct take
 * of a numeric sentence once scored 0.59 and was re-shot twice for
 * nothing (泰勒展开 e^0.5, 2026-09-03). Digits and arithmetic symbols
 * become the words they were said as, and 两 reads as 二, before the
 * two strings are compared.
 */
export function normalizeForCompare(text) {
  let t = String(text ?? "").toLowerCase();
  for (const [re, word] of SPOKEN_SYMBOLS) t = t.replace(re, word);
  t = t.normalize("NFKC").replace(/\d+(?:\.\d+)?/g, (run) => digitsToChinese(run));
  return t.replace(/两/g, "二").replace(/[\p{P}\p{S}\p{Z}\p{C}]/gu, "");
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 1.0 = identical after normalization; 0.0 = nothing in common. */
export function similarity(script, transcript) {
  return compareNarration(script, transcript).similarity;
}

/** Similarity plus coverage (transcript length / script length after
 * normalization). Speech-to-text noise on code-switched narration is
 * substitutions at full coverage; a clip that dropped a clause or ran out
 * of time shows up as a coverage deficit. */
export function compareNarration(script, transcript) {
  const a = normalizeForCompare(script);
  const b = normalizeForCompare(transcript);
  if (!a.length && !b.length) return { similarity: 1, coverage: 1 };
  const sim = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return { similarity: sim, coverage: a.length ? b.length / a.length : 1 };
}

/** Full-coverage substitutions above this similarity are recognizer
 * noise (measured: 0.94-0.95 on Chinese narration with English acronyms,
 * every word present). */
export const QA_COVERAGE_PASS = 0.9;
export const QA_COVERAGE_TOLERANCE = 0.08;

/** Decide without a judge when the numbers are unambiguous. Returns
 * "pass" | "fail" | null (null = ask the judge). */
export function autoVerdict(sim, coverage = 1) {
  if (sim >= QA_AUTO_PASS) return "pass";
  if (sim >= QA_COVERAGE_PASS && Math.abs(coverage - 1) <= QA_COVERAGE_TOLERANCE) return "pass";
  if (sim < QA_AUTO_FAIL) return "fail";
  return null;
}

// ── Evidence ────────────────────────────────────────────────────────────────

export function readJsonLenient(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Accept `[...]` or `{ evidence: [...] }`; keep any entry with a
 * non-empty string kind. Off-contract kinds survive verbatim. */
export function normalizeEvidenceList(raw) {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.evidence)
      ? raw.evidence
      : [];
  return list
    .filter((e) => e && typeof e === "object" && typeof e.kind === "string" && e.kind.length > 0)
    .map((e) => ({
      kind: String(e.kind),
      ...(e.file ? { file: String(e.file) } : {}),
      ...(e.url ? { url: String(e.url) } : {}),
      note: String(e.note ?? ""),
    }));
}

/**
 * Evidence declared on an outline beat. Canonical is `beat.evidence[]`;
 * the two shapes agents reach for when the contract is not in front of
 * them are lifted too: `figures: string[]` (rendered figures) and
 * `sources: "evidence/bN/sources.json"` (a citations file).
 */
export function beatEvidence(beat) {
  if (!beat) return [];
  const out = normalizeEvidenceList(beat.evidence);
  for (const f of Array.isArray(beat.figures) ? beat.figures : []) {
    if (typeof f === "string" && f) out.push({ kind: "rendered-figure", file: f, note: "" });
  }
  if (typeof beat.sources === "string" && beat.sources) {
    out.push({ kind: "citation", file: beat.sources, note: "" });
  }
  return out;
}

function evidenceKey(e) {
  return e.file ? `f:${e.file}` : e.url ? `u:${e.url}` : `k:${e.kind}:${e.note}`;
}

/** Expand a `sources.json` pointer ([{url, note}]) into citation refs. */
function expandSourcesFile(setDir, entry) {
  const raw = readJsonLenient(join(setDir, entry.file));
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.sources) ? raw.sources : null;
  if (!list) return [entry];
  return list
    .filter((s) => s && typeof s.url === "string")
    .map((s) => ({ kind: "citation", url: s.url, note: String(s.note ?? "") }));
}

/** Everything an evidence directory holds, as refs: an `evidence.json`,
 * a `sources.json`, and every figure image. */
function scanEvidenceDir(setDir, relDir) {
  const abs = join(setDir, relDir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  const out = [];
  for (const name of readdirSync(abs).sort()) {
    const rel = `${relDir}/${name}`;
    if (name === "evidence.json") {
      out.push(...normalizeEvidenceList(readJsonLenient(join(abs, name))));
    } else if (name === "sources.json") {
      out.push(...expandSourcesFile(setDir, { kind: "citation", file: rel, note: "" }));
    } else if (FIGURE_EXTS.has(extname(name).toLowerCase())) {
      out.push({ kind: "rendered-figure", file: rel, note: "" });
    }
  }
  return out;
}

/**
 * Resolve the evidence a segment may lean on, in priority order: the
 * outline beat's declared refs, the beat's `evidence/<beatId>/` directory,
 * the node's own `evidence/<nodeId>/` directory (side quests), and any
 * extra evidence files the caller names. Deduplicated by file/url; file
 * refs that do not exist on disk are kept but flagged `missing: true` so
 * the gate can name them.
 */
export function resolveEvidence({ setDir, beat, nodeId, extraFiles = [] }) {
  const collected = [];
  for (const e of beatEvidence(beat)) {
    if (e.kind === "citation" && e.file && !e.url && /sources\.json$/.test(e.file)) {
      collected.push(...expandSourcesFile(setDir, e));
    } else {
      collected.push(e);
    }
  }
  if (beat?.id) collected.push(...scanEvidenceDir(setDir, `evidence/${beat.id}`));
  if (nodeId && nodeId !== beat?.id) collected.push(...scanEvidenceDir(setDir, `evidence/${nodeId}`));
  for (const file of extraFiles) {
    collected.push(...normalizeEvidenceList(readJsonLenient(file)));
  }

  const seen = new Map();
  for (const e of collected) {
    const key = evidenceKey(e);
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, { ...e });
    } else if (!prev.note && e.note) {
      prev.note = e.note;
    }
  }
  return [...seen.values()].map((e) => {
    if (e.file && !existsSync(join(setDir, e.file))) return { ...e, missing: true };
    return e;
  });
}

/** Figures a shoot can bind: existing raster files of a figure kind. */
export function shootableFigures(evidence) {
  return evidence.filter(
    (e) => FIGURE_KINDS.has(e.kind) && e.file && !e.missing && FIGURE_EXTS.has(extname(e.file).toLowerCase()),
  );
}

/**
 * The evidence gate. Every figure the writer says the prompt depends on
 * must be one of the figures on offer — by set-relative path or basename.
 * Returns `{ ok, bound: [figure...], missing: [name...] }`.
 */
export function checkFigureGate(needsFigureRefs, figures) {
  const bound = [];
  const missing = [];
  for (const need of needsFigureRefs ?? []) {
    const name = String(need).trim();
    if (!name) continue;
    const hit = figures.find(
      (f) => f.file === name || basename(f.file) === basename(name) || name.endsWith(`/${f.file}`),
    );
    if (hit) {
      if (!bound.includes(hit)) bound.push(hit);
    } else {
      missing.push(name);
    }
  }
  return { ok: missing.length === 0, bound, missing };
}

// ── Reference plan ──────────────────────────────────────────────────────────

const JOB_TEXT = {
  continuity:
    "the exact scene this shot continues from — the same set/board, stroke texture, handwriting/typography, lighting and framing must carry over precisely, and the shot continues seamlessly from it (it is not new content to describe)",
  "style-anchor":
    "the course's style anchor — reproduce its palette, materials, line quality and lighting exactly; it is a look reference, not content to show",
  character: "a recurring character of this course — keep their identity, face and outfit exactly",
};

function figureJobText(ref) {
  const note = ref.note ? ` (${ref.note})` : "";
  return `the reference figure "${basename(ref.file)}"${note}: it appears on screen reproduced faithfully, every label unaltered`;
}

/**
 * Decide which images ride along and what each one is for, so the
 * writer can address them as "Image N" and the shoot passes them in the
 * same order. Continuity/anchor is always Image 1.
 */
/**
 * Which H3 endpoint a segment is shot on — decided AFTER the script, from
 * what it actually shows (`figures` here are the figures the script bound,
 * not every figure the beat offers):
 *
 *   - a figure on screen, or a recurring character → reference-to-video:
 *     Image 1 is the continuity frame with its binding, Image 2+ are the
 *     figures and characters, all REFERENCES the model reproduces inside
 *     its own picture. A figure is never a keyframe — pinned as a first or
 *     last frame the raw bitmap fills the screen and the next segment
 *     chains from it (a course turned into a slideshow that way).
 *   - nothing to show but a scene to continue → image-to-video from the
 *     parent's last frame: the previous shot's end is this one's start.
 *   - no frame to continue from → text-to-video.
 *
 * Most teaching segments have no figure to show; that is the point.
 */
export function chooseEndpoint({ requested = "auto", anchorFile = null, characters = [], figures = [] } = {}) {
  const needsRefs = characters.length > 0 || figures.length > 0;
  if (requested === "image") return anchorFile ? "image" : needsRefs ? "reference" : "text";
  if (requested === "reference") return needsRefs || anchorFile ? "reference" : "text";
  if (requested === "text") return "text";
  if (needsRefs) return "reference";
  return anchorFile ? "image" : "text";
}

/**
 * What the scriptwriter is told about the images on offer — by NAME, never
 * by number. The producer numbers the references at shoot time from what
 * the script actually uses (`planRefs` + `injectBindings`), so the writer
 * never has to guess which figure becomes Image 2.
 */
export function describeAvailableRefs({ anchorKind = null, characters = [], figures = [] } = {}) {
  const lines = [];
  if (anchorKind === "continuity") {
    lines.push("This shot continues seamlessly from the previous segment's last frame (the producer supplies it): the same set/board, stroke texture, handwriting/typography, lighting and framing carry over — it is not new content to describe.");
  } else if (anchorKind === "style-anchor") {
    lines.push("The course's style anchor is supplied by the producer: its palette, materials, line quality and lighting carry over exactly — it is a look reference, not content to show.");
  }
  for (const file of characters) {
    lines.push(`A recurring character of this course is available as the reference image "${basename(file)}" — keep their identity, face and outfit exactly; refer to it in the prompt as: the reference image "${basename(file)}".`);
  }
  for (const fig of figures) {
    const note = fig.note ? ` (${fig.note})` : "";
    lines.push(`The code-rendered knowledge figure "${basename(fig.file)}"${note} is available as a reference. If this segment shows it, name it in needs_figure_refs and refer to it in the prompt as: the reference figure "${basename(fig.file)}" — reproduced faithfully on screen, every label unaltered. If this segment does not show it, do not mention it.`);
  }
  return lines;
}

/**
 * Put the numbered reference bindings into the prompt's first section (the
 * visual description), ahead of the soundscape sections, so the model reads
 * them with the picture. Appends when the prompt has no sections.
 */
export function injectBindings(prompt, sentences) {
  const block = (sentences ?? []).filter(Boolean).join(" ");
  if (!block) return prompt;
  const at = prompt.indexOf("\noverall_soundscape:");
  if (at === -1) return `${prompt.trimEnd()} ${block}`;
  return `${prompt.slice(0, at).trimEnd()} ${block}${prompt.slice(at)}`;
}

export function planRefs({ anchorFile, anchorKind = "continuity", characters = [], figures = [], max = MAX_REFS, mode = "reference" }) {
  if (mode === "image") {
    // Continuity only: the frame chain is the first frame, and nothing
    // else can ride along — a figure is a reference, never a keyframe, so
    // a segment that needs one is not shot in this mode at all.
    const refs = [];
    const lines = [];
    if (anchorFile) {
      refs.push({ file: anchorFile, job: anchorKind, role: "first-frame" });
      lines.push(
        anchorKind === "continuity"
          ? "The first frame of this shot is the exact last frame of the previous segment — the same set/board, stroke texture, handwriting/typography, lighting and framing carry over, and the shot continues seamlessly from it (it is not new content to describe)."
          : "The first frame of this shot is the course's style anchor — its palette, materials, line quality and lighting carry over exactly; the scene develops from it.",
      );
    }
    return { refs, lines };
  }
  const refs = [];
  if (anchorFile) refs.push({ file: anchorFile, job: anchorKind });
  for (const file of characters) {
    if (refs.length >= max) break;
    refs.push({ file, job: "character" });
  }
  for (const fig of figures) {
    if (refs.length >= max) break;
    refs.push({ file: fig.file, job: "figure", note: fig.note ?? "" });
  }
  const lines = refs.map(
    (r, i) => `Image ${i + 1} is ${r.job === "figure" ? figureJobText(r) : r.job === "character" ? `the reference image "${basename(r.file)}" — ${JOB_TEXT.character}` : JOB_TEXT[r.job]}.`,
  );
  return { refs, lines };
}

// ── course.json ─────────────────────────────────────────────────────────────

export function readCourse(setDir) {
  const path = join(setDir, "course.json");
  if (!existsSync(path)) throw new Error(`no course.json in ${setDir}`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Upsert one node and its parent linkage. Never touches path[], rootNode,
 * outline or style. Existing children/status survive unless overridden. */
export function upsertNode(course, spec) {
  const nodes = (course.nodes = course.nodes ?? {});
  const existing = nodes[spec.id] ?? {};
  const next = { ...existing };
  if (spec.parent !== undefined) next.parent = spec.parent;
  if (spec.beat !== undefined) next.beat = spec.beat;
  if (spec.kind !== undefined) next.kind = spec.kind;
  if (spec.choiceLabel !== undefined) next.choiceLabel = spec.choiceLabel;
  if (!Array.isArray(next.children)) next.children = [];
  if (spec.status !== undefined) next.status = spec.status;
  if (spec.video !== undefined) {
    if (spec.video === null) delete next.video;
    else next.video = spec.video;
  }
  // Production bookkeeping the stage reads (phase + when it started, or
  // why it failed); null clears a field when the node settles.
  for (const key of ["startedAt", "phase", "error"]) {
    if (spec[key] === undefined) continue;
    if (spec[key] === null) delete next[key];
    else next[key] = spec[key];
  }
  nodes[spec.id] = next;

  if (next.parent) {
    const parent = (nodes[next.parent] = nodes[next.parent] ?? { children: [], status: "planned" });
    if (!Array.isArray(parent.children)) parent.children = [];
    const label = next.choiceLabel ?? "";
    const link = parent.children.find((c) => c && c.nodeId === spec.id);
    if (link) {
      if (label) link.label = label;
    } else {
      parent.children.push({ nodeId: spec.id, label });
    }
  }
  return course;
}

/** Append to the taken path unless it is already the tail. */
export function appendWatched(course, id) {
  const path = (course.path = Array.isArray(course.path) ? course.path : []);
  const nodes = course.nodes ?? {};
  // path[] ends on the segment the learner's line currently ends on, and
  // carries every ancestor of it: a root the director never recorded, or a
  // branch the learner opened from the map, goes in ahead of the segment
  // watched. A segment watched again moves to the tail — the line's end is
  // always the latest thing watched, and the recap keeps everything seen.
  const chain = [];
  const seen = new Set();
  for (let cur = id; cur && nodes[cur] && !seen.has(cur); cur = nodes[cur].parent) {
    seen.add(cur);
    chain.unshift(cur);
  }
  if (!chain.length) chain.push(id);
  for (const ancestor of chain.slice(0, -1)) {
    if (!path.includes(ancestor)) path.push(ancestor);
  }
  const at = path.indexOf(id);
  if (at !== -1) path.splice(at, 1);
  path.push(id);
  return course;
}

/**
 * Read-modify-write course.json under a directory lock (mkdir is atomic
 * on every platform we run on), writing through a temp file + rename so
 * a reader never sees a torn manifest. Two producers finishing in the
 * same second was how trees got corrupted before this existed.
 */
export function withCourseLock(setDir, mutate, { timeoutMs = 15000, pollMs = 120, staleMs = 60000 } = {}) {
  const lockDir = join(setDir, "course.json.lock");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // A holder keeps the lock for milliseconds; one older than staleMs
      // belongs to a producer that died mid-commit.
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > staleMs) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        /* vanished between checks — retry */
      }
      if (Date.now() > deadline) throw new Error(`course.json is locked by another producer (${lockDir})`);
      sleepSync(pollMs);
    }
  }
  try {
    const course = readCourse(setDir);
    const next = mutate(course) ?? course;
    const target = join(setDir, "course.json");
    const tmp = join(setDir, `.course.json.${process.pid}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(tmp, target);
    return next;
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ── Keys ────────────────────────────────────────────────────────────────────

/** Environment first, then `.env` at the skill root, then `.env` walking
 * up from cwd — the same chain every sibling script uses. Never printed. */
export function loadEnvKey(name, { skillRoot, cwd = process.cwd() } = {}) {
  if (process.env[name]) return process.env[name];
  const candidates = [];
  if (skillRoot) candidates.push(join(skillRoot, ".env"));
  let dir = cwd;
  for (;;) {
    candidates.push(join(dir, ".env"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const value = readEnvValue(readFileSync(envPath, "utf-8"), name);
    if (value) return value;
  }
  return null;
}

export function readEnvValue(content, name) {
  for (const raw of String(content).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1 || line.slice(0, eq).trim() !== name) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  return null;
}

// ── Designed LLM calls (OpenRouter) ─────────────────────────────────────────

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "openai/gpt-5.6-luna";

/** One chat completion that must answer with a JSON object. */
export async function chatJson({ key, model = DEFAULT_MODEL, system, user, temperature = 0 }) {
  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenRouter returned HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  const result = await resp.json();
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("no completion in response");
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`completion carried no JSON object: ${content.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

export const JUDGE_SYSTEM = `You are the narration QA editor of a learning-video studio. A clip was generated to speak a SCRIPT verbatim; an automatic speech recognizer produced the TRANSCRIPT. Decide whether the CLIP says what the script says — you are judging the speech, not the recognizer.

The recognizer is imperfect in known ways, and none of them count against the clip: punctuation, spacing, casing; digit vs word forms of the same number; filler sounds; homophones and near-homophones in the script's language (网关→网间, 作用域→作用于); and Latin acronyms or English technical terms embedded in Chinese/Japanese speech, which it routinely mangles into near-phonetic spellings (HANDSHAKE→"Handtake", PAT→"Pate"). A near-phonetic rendering of a script term IS that term.

FAIL only when a term, number or name is ABSENT or replaced by a DIFFERENT real word with a different meaning; when a clause of the script is missing or an extra clause was spoken; or when the transcript stops before the script ends (the clip ran out of time). A difference confined to one character or one syllable inside a term is the recognizer, not the speaker. When in doubt, PASS — a false FAIL costs a paid re-shoot; a false PASS is caught by the learner's evidence panel.

Answer with strict JSON only: {"verdict": "pass" | "fail", "reason": "one short sentence"}`;

export async function judgeNarration({ key, model, script, transcript, language, similarity: sim, coverage }) {
  const stats =
    sim != null && coverage != null
      ? `\n\nMeasured: character similarity ${Math.round(sim * 100)}%, transcript covers ${Math.round(coverage * 100)}% of the script's length (100% = nothing dropped, nothing added).`
      : "";
  const parsed = await chatJson({
    key,
    model,
    system: JUDGE_SYSTEM,
    user: `Language: ${language}${stats}\n\nSCRIPT:\n${script}\n\nTRANSCRIPT:\n${transcript}`,
    temperature: 0,
  });
  const verdict = parsed?.verdict === "pass" ? "pass" : "fail";
  return { verdict, reason: String(parsed?.reason ?? "") };
}

// ── ffmpeg helpers ──────────────────────────────────────────────────────────

/** Grab the last frame of a clip as PNG. Returns true on success. */
export function extractLastFrame(videoPath, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  for (const offset of ["-0.1", "-0.5"]) {
    const r = spawnSync(
      "ffmpeg",
      ["-y", "-sseof", offset, "-i", videoPath, "-frames:v", "1", "-update", "1", outPath],
      { encoding: "utf-8" },
    );
    if (r.error) return false;
    if (r.status === 0 && existsSync(outPath) && statSync(outPath).size > 0) return true;
  }
  return false;
}

/** Real clip duration in seconds via ffprobe, or null. */
/** fal's reference-image aspect-ratio range (image_aspect_ratio_error outside it). */
export const REF_ASPECT_MIN = 0.4;
export const REF_ASPECT_MAX = 2.5;

/**
 * Pixel size of a PNG or JPEG from its header (no decoder), ffprobe for
 * anything else. Null when unreadable.
 */
export function imageSize(path) {
  let buf;
  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { encoding: "utf-8" });
  if (r.error || r.status !== 0) return null;
  const [w, h] = String(r.stdout).trim().split(",").map(Number);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** The stream shape of a clip, for deciding whether clips can be joined
 * by stream copy: codec, size and frame rate of the video, codec, sample
 * rate and channels of the audio. Null when ffprobe is unavailable. */
export function probeStreams(videoPath) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels", "-of", "json", videoPath],
    { encoding: "utf-8" },
  );
  if (r.error || r.status !== 0) return null;
  try {
    const streams = JSON.parse(String(r.stdout)).streams ?? [];
    const video = streams.find((s) => s.codec_type === "video") ?? null;
    const audio = streams.find((s) => s.codec_type === "audio") ?? null;
    return {
      video: video ? { codec: video.codec_name, width: Number(video.width), height: Number(video.height), fps: String(video.r_frame_rate) } : null,
      audio: audio ? { codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: Number(audio.channels) } : null,
    };
  } catch {
    return null;
  }
}

export function probeDuration(videoPath) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", videoPath],
    { encoding: "utf-8" },
  );
  if (r.error || r.status !== 0) return null;
  const n = Number(String(r.stdout).trim());
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}
