/**
 * Palate domain types + aggregate-file load/save pure functions.
 *
 * The studio's editable output is a `Draft` — an ordered list of stable,
 * block-addressed markdown blocks. The agent and the user both write
 * `draft.md`; the viewer subscribes to the parsed `Draft` and never sees
 * file paths. Block ids are persisted in a `draft.blocks.json` sidecar so
 * "the metaphor I poked" or "the kernel I froze" stays anchored across
 * rewrites of *other* blocks (the kernel-freeze UI invariant, brief §3.1).
 *
 * The read-only `TasteProfile` is the agent-authored taste substrate
 * (voice floor + symptom rubric + calibrated launch rung + golden-material
 * counters). The viewer renders it; only the agent writes the underlying
 * files (brief §3.2 — "all learning is disciplined file updates").
 *
 * Everything here is PURE — no fs, no fetch, no async. The aggregate-file
 * provider (core/sources/aggregate-file.ts) owns all IO. No React imports:
 * this module is imported by the backend-readable manifest.ts (brief §2).
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** A single top-level markdown block of the draft, stably addressed. */
export interface DraftBlock {
  /** Stable id, e.g. "b7" — reconciled from draft.blocks.json across edits. */
  id: string;
  /** The block's raw markdown source text. */
  markdown: string;
  /** Kernel-freeze flag — a frozen block is an invariant the rewrite path honors. */
  frozen: boolean;
}

/** The studio's editable output for one writing project (content set). */
export interface Draft {
  /** Active writing-project prefix ("" = root). */
  contentSet: string;
  /** Ordered top-level blocks. */
  blocks: DraftBlock[];
}

/** One symptom card parsed from the taste rubric (taste-profile.md §2). */
export interface Symptom {
  /** Stable id, e.g. "S7". */
  id: string;
  /** Short human title, e.g. "ai-metaphor". */
  title: string;
  /** The "tell" — how the symptom shows up. */
  tell: string;
  /** The "fix" — how to compress it. */
  fix: string;
}

/**
 * One per-block revision note from `draft.annotations.json`. The agent authors
 * these instead of polluting `draft.md` with a revision preamble / change-log
 * (the first non-negotiable discipline in SKILL.md). The viewer renders them in
 * the block-aligned annotation column, read-only.
 */
export interface BlockAnnotation {
  /** "revision" = "I changed this and why"; "note" = an observation, not a change. */
  kind: "revision" | "note";
  /** One concise margin line — the change and its reason. */
  text: string;
  /** ISO-8601 timestamp. */
  ts: string;
}

/**
 * The parsed `draft.annotations.json` for one writing project — per-block
 * revision notes keyed by the SAME block id as `draft.blocks.json` / the
 * ViewerAddress, so the viewer aligns each note to its block.
 */
export interface DraftAnnotations {
  contentSet: string;
  /** blockId → ordered notes (a block can accumulate several). */
  annotations: Record<string, BlockAnnotation[]>;
}

/** Read-only taste substrate rendered in the right panel. */
export interface TasteProfile {
  contentSet: string;
  /** taste-profile.md §1 prose (the human-ness floor). */
  voiceFloor: string;
  /** taste-profile.md §2 parsed into symptom cards (S1..S7). */
  rubric: Symptom[];
  /** Calibrated starting rung for this content type (taste-profile.md §0). */
  launchRung: number;
  /** taste/recipes/*.md filenames. */
  recipeNames: string[];
  /** taste/swaps.jsonl line count (golden-material gauge). */
  swapCount: number;
  /** taste/prefs.log.jsonl line count. */
  prefsCount: number;
}

/** Sidecar shape persisted at <prefix>/draft.blocks.json. */
interface BlocksSidecar {
  version: number;
  /** Monotonic counter for minting fresh block ids. */
  nextId: number;
  blocks: Array<{ id: string; hash: string }>;
}

/** Sidecar shape persisted at <prefix>/draft.freeze.json. */
interface FreezeSidecar {
  frozen: string[];
}

const SIDECAR_VERSION = 1;

// ── Hashing ──────────────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit content hash. Small, deterministic, dependency-free. Used to
 * reconcile a block's stable id when its position shifts but its content is
 * unchanged. The exact algorithm is private — callers only rely on stability.
 */
function hashBlock(markdown: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < markdown.length; i++) {
    h ^= markdown.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// ── Block splitting ──────────────────────────────────────────────────────────

/**
 * Split markdown source into top-level blocks using a CommonMark block scanner
 * (mdast via mdast-util-from-markdown, a transitive dep of remark-parse). We
 * take depth-1 children and slice the SOURCE by each child's byte offsets, so
 * fenced code blocks / multi-paragraph lists / blockquotes stay intact as one
 * block (brief §3.2 RISK note — never hand-roll a regex splitter).
 */
function splitBlocks(source: string): string[] {
  const tree = fromMarkdown(source);
  const blocks: string[] = [];
  for (const child of tree.children) {
    const pos = child.position;
    if (!pos || pos.start.offset == null || pos.end.offset == null) continue;
    const text = source.slice(pos.start.offset, pos.end.offset);
    if (text.trim().length > 0) blocks.push(text);
  }
  return blocks;
}

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Join a content-set prefix with a relative path. "" → root. */
function prefixed(contentSet: string, rel: string): string {
  return contentSet ? `${contentSet}/${rel}` : rel;
}

function findFile(
  files: ReadonlyArray<ViewerFileContent>,
  path: string,
): ViewerFileContent | undefined {
  return files.find((f) => f.path === path);
}

// ── loadDraft ────────────────────────────────────────────────────────────────

/**
 * Read `<contentSet>/draft.md`, split into top-level blocks, and assign or
 * reconcile stable block ids from `<contentSet>/draft.blocks.json`. Frozen
 * blocks are marked from `<contentSet>/draft.freeze.json`.
 *
 * Id reconciliation (position-then-hash, brief §12.1):
 *   1. position match — the block at index i inherits the prior id at index i
 *      when one exists. This keeps a block anchored when a *different* block
 *      is rewritten (the kernel-freeze invariant).
 *   2. otherwise, mint a fresh id from the sidecar's monotonic counter.
 *
 * Returns null when no draft.md exists (empty workspace) — the source stays in
 * "no initial yet" state and a later file change may produce a valid Draft.
 */
export function loadDraft(
  files: ReadonlyArray<ViewerFileContent>,
  contentSet = "",
): Draft | null {
  const draftFile = findFile(files, prefixed(contentSet, "draft.md"));
  if (!draftFile) return null;

  const texts = splitBlocks(draftFile.content);

  // Prior sidecar (ids + hashes) drives reconciliation.
  const sidecar = parseSidecar(findFile(files, prefixed(contentSet, "draft.blocks.json")));
  let nextId = sidecar?.nextId ?? 1;
  const priorById = new Map<string, { id: string; hash: string }>();
  const priorByIndex = sidecar?.blocks ?? [];
  for (const entry of priorByIndex) priorById.set(entry.id, entry);

  // Ids already claimed in this load, so position-match never double-assigns.
  const claimed = new Set<string>();

  const blocks: DraftBlock[] = texts.map((markdown, index) => {
    let id: string | null = null;
    const prior = priorByIndex[index];
    // Position match: same index reuses the prior id (unless already claimed).
    if (prior && !claimed.has(prior.id)) {
      id = prior.id;
    }
    if (id === null) {
      id = `b${nextId++}`;
    }
    claimed.add(id);
    return { id, markdown, frozen: false };
  });

  // Apply freeze set.
  const freeze = parseFreeze(findFile(files, prefixed(contentSet, "draft.freeze.json")));
  if (freeze) {
    const frozenSet = new Set(freeze.frozen);
    for (const b of blocks) {
      if (frozenSet.has(b.id)) b.frozen = true;
    }
  }

  return { contentSet, blocks };
}

function parseSidecar(file: ViewerFileContent | undefined): BlocksSidecar | null {
  if (!file) return null;
  // Let JSON.parse throw — aggregate-file catches and emits an error event.
  const parsed = JSON.parse(file.content) as Partial<BlocksSidecar>;
  if (!Array.isArray(parsed.blocks)) return null;
  return {
    version: parsed.version ?? SIDECAR_VERSION,
    nextId: parsed.nextId ?? parsed.blocks.length + 1,
    blocks: parsed.blocks,
  };
}

function parseFreeze(file: ViewerFileContent | undefined): FreezeSidecar | null {
  if (!file) return null;
  const parsed = JSON.parse(file.content) as Partial<FreezeSidecar>;
  if (!Array.isArray(parsed.frozen)) return null;
  return { frozen: parsed.frozen };
}

// ── saveDraft ────────────────────────────────────────────────────────────────

/**
 * Re-serialize a Draft back to disk. Produces the minimal set of writes:
 *   - draft.md           — blocks joined with a blank line.
 *   - draft.blocks.json  — refreshed id↔hash sidecar + monotonic counter.
 *   - draft.freeze.json  — the current frozen-id set.
 *
 * Frozen blocks' markdown is carried through verbatim (the join preserves each
 * block's text exactly), so a save originating from a rewrite of another block
 * never alters a frozen block (brief §3.2 invariant). The id monotonic counter
 * advances past the highest existing id so future fresh ids never collide.
 */
export function saveDraft(
  next: Draft,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  const cs = next.contentSet;
  const writes: Array<{ path: string; content: string }> = [];

  const draftMd = next.blocks.map((b) => b.markdown).join("\n\n");
  writes.push({ path: prefixed(cs, "draft.md"), content: draftMd });

  let maxId = 0;
  for (const b of next.blocks) {
    const n = parseInt(b.id.replace(/^b/, ""), 10);
    if (Number.isFinite(n) && n > maxId) maxId = n;
  }
  const sidecar: BlocksSidecar = {
    version: SIDECAR_VERSION,
    nextId: maxId + 1,
    blocks: next.blocks.map((b) => ({ id: b.id, hash: hashBlock(b.markdown) })),
  };
  writes.push({
    path: prefixed(cs, "draft.blocks.json"),
    content: JSON.stringify(sidecar, null, 2),
  });

  const frozen = next.blocks.filter((b) => b.frozen).map((b) => b.id);
  writes.push({
    path: prefixed(cs, "draft.freeze.json"),
    content: JSON.stringify({ frozen } satisfies FreezeSidecar, null, 2),
  });

  return { writes, deletes: [] };
}

// ── loadTaste ────────────────────────────────────────────────────────────────

/**
 * Parse `<contentSet>/taste/taste-profile.md` into a TasteProfile and count the
 * jsonl golden-material files. Sections are matched by their leading number
 * (`## 0.` / `## 1.` / `## 2.` / `## 5.`) so the parser works for both the
 * Chinese worked-example profile and a generic English bootstrap profile.
 *
 * Read-only: the viewer renders this, never mutates it (brief §3.2). Returns
 * null when no taste-profile.md exists yet.
 */
export function loadTaste(
  files: ReadonlyArray<ViewerFileContent>,
  contentSet = "",
): TasteProfile | null {
  const profileFile = findFile(files, prefixed(contentSet, "taste/taste-profile.md"));
  if (!profileFile) return null;

  const sections = splitSections(profileFile.content);

  const voiceFloor = (sections.get(1) ?? "").trim();
  const launchRung = parseLaunchRung(sections.get(0) ?? "");
  const rubric = parseRubric(sections.get(2) ?? "");

  const recipePrefix = prefixed(contentSet, "taste/recipes/");
  const recipeNames = files
    .filter((f) => f.path.startsWith(recipePrefix) && f.path.endsWith(".md"))
    .map((f) => f.path.slice(recipePrefix.length))
    .filter((name) => !name.includes("/"))
    .sort();

  const swapCount = countJsonlLines(findFile(files, prefixed(contentSet, "taste/swaps.jsonl")));
  const prefsCount = countJsonlLines(findFile(files, prefixed(contentSet, "taste/prefs.log.jsonl")));

  return { contentSet, voiceFloor, rubric, launchRung, recipeNames, swapCount, prefsCount };
}

/**
 * Split a taste-profile.md into a map keyed by the leading section number of
 * each `## N. …` heading. Body text runs until the next numbered heading.
 */
function splitSections(markdown: string): Map<number, string> {
  const out = new Map<number, string>();
  const lines = markdown.split("\n");
  let currentNum: number | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentNum !== null) out.set(currentNum, buffer.join("\n"));
    buffer = [];
  };

  for (const line of lines) {
    const m = /^##\s+(\d+)\.?\s/.exec(line);
    if (m) {
      flush();
      currentNum = parseInt(m[1], 10);
      continue;
    }
    if (currentNum !== null) buffer.push(line);
  }
  flush();
  return out;
}

/** Pull the first integer 0–5 out of the calibration section (§0). */
function parseLaunchRung(section: string): number {
  const m = /\b([0-5])\b/.exec(section.replace(/[#*`]/g, ""));
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * Parse the symptom rubric (§2) into cards. Each symptom is a list item shaped
 * `N. **S<n> <title>** — tell: … fix: …` (a numbered or bulleted line). The
 * tell/fix split is tolerant: we look for "fix:"/"修：" as the divider, else
 * keep all as tell.
 *
 * A `**S<n> …**` reference is treated as a CARD only when it sits at a card
 * boundary — the line begins with a list marker (`N.` / `-` / `*` / `•`) or the
 * bold itself opens the line. A real profile cross-references symptoms inside
 * scan-aid blockquotes and warnings (`> ⚠ **S5 is the drain of S7** …`), and
 * those are PROSE: a blockquote (`>`-led) line, or one where the bold appears
 * mid-sentence, is rejected so it never mints a phantom/duplicate card in the
 * right panel.
 */
function parseRubric(section: string): Symptom[] {
  const symptoms: Symptom[] = [];
  const seen = new Set<string>();
  // A leading list marker (`1.`, `-`, `*`, `•`) consumed before the bold. The
  // bold "S<n> <title>" must then open the remaining text — not float mid-line.
  const listLeadRe = /^(?:\d+[.)]|[-*•])\s+/;
  const cardRe = /^\*\*\s*(S\d+)\s+([^*]+?)\s*\*\*\s*(.*)$/;
  for (const rawLine of section.split("\n")) {
    const line = rawLine.trim();
    // Blockquote lines are always prose, never card headers.
    if (line.startsWith(">")) continue;
    const afterLead = line.replace(listLeadRe, "");
    // Reject when the bold does not open the (post-marker) line: that means the
    // **Sn** is a mid-prose cross-reference, not a card header.
    const m = cardRe.exec(afterLead);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue; // one card per symptom id; ignore later prose dupes
    seen.add(id);
    const title = m[2].trim();
    const rest = m[3].replace(/^[—–\-:：\s]+/, "").trim();
    const { tell, fix } = splitTellFix(rest);
    symptoms.push({ id, title, tell, fix });
  }
  return symptoms;
}

function splitTellFix(rest: string): { tell: string; fix: string } {
  // Divider is "fix:" (EN) or "修："/"修:" (the worked-example dialect).
  const fixRe = /(?:fix\s*[:：]|修\s*[:：])/i;
  const m = fixRe.exec(rest);
  if (!m) {
    return { tell: stripTellLabel(rest), fix: "" };
  }
  const tell = rest.slice(0, m.index).trim();
  const fix = rest.slice(m.index + m[0].length).trim();
  return { tell: stripTellLabel(tell), fix };
}

function stripTellLabel(s: string): string {
  return s.replace(/^(?:tell\s*[:：]|tell\s*=\s*|—|–|-)+\s*/i, "").trim();
}

// ── saveTaste ────────────────────────────────────────────────────────────────

/**
 * Stub — taste artifacts are authored by the AGENT via its native Edit/Write
 * tools, never restructured from the viewer (brief §3.2 — the source
 * experiment's "all learning is disciplined file updates" discipline). The
 * aggregate-file write path therefore has nothing to emit. Mirrors webcraft's
 * saveSite stub.
 */
export function saveTaste(
  _next: TasteProfile,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  return { writes: [], deletes: [] };
}

/** Count non-empty lines in a jsonl file (each line is one record). */
function countJsonlLines(file: ViewerFileContent | undefined): number {
  if (!file) return 0;
  return file.content.split("\n").filter((l) => l.trim().length > 0).length;
}

// ── loadAnnotations ────────────────────────────────────────────────────────────

/**
 * Parse `<contentSet>/draft.annotations.json` into per-block revision notes.
 *
 * The shape is the PINNED CONTRACT shared with the skill task:
 *   `{ version: 1, annotations: { "<blockId>": [ { kind, text, ts } ] } }`.
 *
 * Read-only in the viewer (the agent owns all writes via Edit/Write). Degrades
 * GRACEFULLY — malformed JSON, a missing `annotations` object, or individual
 * malformed entries never throw: the file is simply treated as "no annotations"
 * (returns null) or the bad entries are dropped. A note is kept only when it has
 * a non-empty `text`; an unknown `kind` normalizes to `"note"`. Returns null
 * when no annotations file exists, so the viewer defaults to a full-width
 * article and shows the annotation column only when notes are present.
 */
export function loadAnnotations(
  files: ReadonlyArray<ViewerFileContent>,
  contentSet = "",
): DraftAnnotations | null {
  const file = findFile(files, prefixed(contentSet, "draft.annotations.json"));
  if (!file) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    return null; // malformed JSON — no annotations, never a crash.
  }
  if (!parsed || typeof parsed !== "object") return null;
  const raw = (parsed as { annotations?: unknown }).annotations;
  if (!raw || typeof raw !== "object") return null;

  const annotations: Record<string, BlockAnnotation[]> = {};
  for (const [blockId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue; // a non-array value is dropped wholesale.
    const notes: BlockAnnotation[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const text = (entry as { text?: unknown }).text;
      if (typeof text !== "string" || text.trim().length === 0) continue;
      const kindRaw = (entry as { kind?: unknown }).kind;
      const kind: BlockAnnotation["kind"] = kindRaw === "revision" ? "revision" : "note";
      const tsRaw = (entry as { ts?: unknown }).ts;
      const ts = typeof tsRaw === "string" ? tsRaw : "";
      notes.push({ kind, text, ts });
    }
    if (notes.length > 0) annotations[blockId] = notes;
  }

  if (Object.keys(annotations).length === 0) return null;
  return { contentSet, annotations };
}

/** The notes attached to a block, or an empty array — viewer alignment helper. */
export function annotationsForBlock(
  ann: DraftAnnotations | null,
  blockId: string,
): BlockAnnotation[] {
  return ann?.annotations[blockId] ?? [];
}

/** True when at least one block carries a note — gates the annotation column. */
export function hasAnnotations(ann: DraftAnnotations | null): boolean {
  if (!ann) return false;
  return Object.values(ann.annotations).some((list) => list.length > 0);
}

/**
 * Stub — the agent authors `draft.annotations.json` via its native Edit/Write
 * tools (the same "all learning is disciplined file updates" discipline that
 * governs the taste artifacts). The viewer renders the annotation column
 * read-only, so the aggregate-file write path has nothing to emit. Mirrors
 * saveTaste.
 */
export function saveAnnotations(
  _next: DraftAnnotations,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  return { writes: [], deletes: [] };
}
