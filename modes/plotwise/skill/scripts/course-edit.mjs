#!/usr/bin/env node

/**
 * Plotwise course.json editor — the manifest edits the session makes
 * while producers may be committing concurrently. Every op goes through
 * the same lock `produce-segment.mjs` and `make-style-sample.mjs` use,
 * so a hand edit never races a producer's read-modify-write.
 *
 * Usage:
 *   node course-edit.mjs init          --set <dir> --title <t> [--topic <t>] [--goal <g>] [--language zh]
 *   node course-edit.mjs set-style     --set <dir> [--style-id <id>] [--status pending|sampling|sampled|confirmed]
 *                                      [--name <n>] [--recipe <text>] [--rationale <text>] [--ref-image <set-relative>]...
 *   node course-edit.mjs confirm-style --set <dir>
 *   node course-edit.mjs watched       --set <dir> --node <id>
 *   node course-edit.mjs summary       --set <dir> --file summary.md
 *   node course-edit.mjs status        --set <dir> --node <id> --status planned|generating|ready|failed
 *
 * `init` creates the course skeleton the moment the topic is known (the
 * style board shows the topic from it; make-style-sample needs it) and
 * is a no-op merge when the file already exists. `set-style` merges into
 * the existing style (a bare --status pending resets the step; --ref-image
 * records learner-provided references). `confirm-style` is the end of
 * the style step: status confirmed, shoot references = [sample anchor,
 * ...learner refs]. `watched` appends to path[] (idempotent at the tail)
 * — kept for courses without a play manager (0.4 records the path itself). `outline --file` lands
 * the planner's beats (merge; mints n1; world-knowledge beats with no
 * figures are recorded as grounded). `evidence --beat --file` merges one
 * beat's evidence entries + problems (files must exist on disk).
 * `audit` prints, without writing, what every beat still owes. Prints JSON.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { appendWatched, detectLanguage, withCourseLock, imageSize, REF_ASPECT_MAX, REF_ASPECT_MIN } from "./segment-lib.mjs";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    set: { type: "string" },
    node: { type: "string" },
    title: { type: "string" },
    topic: { type: "string" },
    goal: { type: "string" },
    language: { type: "string" },
    "style-id": { type: "string" },
    name: { type: "string" },
    recipe: { type: "string" },
    rationale: { type: "string" },
    "ref-image": { type: "string", multiple: true, default: [] },
    file: { type: "string" },
    status: { type: "string" },
    beat: { type: "string" },
  },
});

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

const OPS = ["init", "set-style", "confirm-style", "watched", "summary", "status", "outline", "evidence", "audit"];
const op = positionals[0];
if (!op || !OPS.includes(op)) fail(`an op is required: ${OPS.join(" | ")}`);
if (!args.set) fail("--set is required");
const setDir = resolve(args.set);

const NODE_STATUSES = new Set(["planned", "generating", "ready", "failed"]);
const STYLE_STATUSES = new Set(["pending", "sampling", "sampled", "confirmed"]);
const TIERS = new Set(["world-knowledge", "citation", "code-verification"]);
const EVIDENCE_KINDS = new Set(["citation", "code-verification", "rendered-figure", "world-knowledge"]);
const WORLD_KNOWLEDGE_NOTE = (language) =>
  String(language ?? "").startsWith("zh") ? "教科书级常识，无需查证" : "Textbook fact — no lookup needed";

function readJsonFile(file) {
  if (!existsSync(file)) fail(`file not found: ${file}`);
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    fail(`${file} is not valid JSON: ${e.message}`);
  }
}

/** What a beat still owes under its tier — the same check the audit prints. */
function beatProblems(setDir, beat) {
  const problems = new Set(Array.isArray(beat.problems) ? beat.problems.map(String) : []);
  const ev = Array.isArray(beat.evidence) ? beat.evidence : [];
  for (const e of ev) {
    if (e?.file && !existsSync(join(setDir, e.file))) {
      problems.add(`evidence file not on disk: ${e.file}`);
    } else if (e?.file && /\.(png|jpe?g|webp)$/i.test(e.file)) {
      // A figure outside fal's reference range is letterboxed at shoot
      // time; the padding is wasted screen, so the planner hears about it.
      const size = imageSize(join(setDir, e.file));
      const ratio = size ? size.w / size.h : null;
      if (ratio != null && (ratio > REF_ASPECT_MAX || ratio < REF_ASPECT_MIN)) {
        problems.add(`figure ${e.file} is ${ratio.toFixed(2)}:1 — outside the reference range ${REF_ASPECT_MIN}-${REF_ASPECT_MAX}; split it or reframe it (16:9 / 4:3)`);
      }
    }
  }
  // `figureSpecs` are the planner's one-line descriptions; `figures[]` on
  // a beat is the LEGACY list of rendered files (lifted as evidence by the
  // viewer and the producer), so specs must never be stored there.
  const specs = Array.isArray(beat.figureSpecs) ? beat.figureSpecs : [];
  const rendered = ev.filter((e) => e?.kind === "rendered-figure").length;
  if (specs.length > rendered) problems.add(`${specs.length - rendered} figure spec(s) without a rendered file`);
  if (beat.tier === "citation" && !ev.some((e) => e?.kind === "citation" && (e.url || e.file))) problems.add("no pinned source");
  if (beat.tier === "code-verification" && !ev.some((e) => e?.kind === "code-verification")) problems.add("no verification run on disk");
  return [...problems];
}

if (op === "audit") {
  const path = join(setDir, "course.json");
  if (!existsSync(path)) fail(`no course.json in ${setDir}`);
  const c = JSON.parse(readFileSync(path, "utf-8"));
  const beats = (c.outline ?? []).map((b) => {
    const problems = beatProblems(setDir, b);
    return {
      id: b.id,
      tier: b.tier ?? null,
      figureSpecs: Array.isArray(b.figureSpecs) ? b.figureSpecs.length : 0,
      evidence: Array.isArray(b.evidence) ? b.evidence.length : 0,
      ok: problems.length === 0 && (Array.isArray(b.evidence) ? b.evidence.length : 0) > 0,
      problems,
    };
  });
  console.log(JSON.stringify({ op, ok: beats.length > 0 && beats.every((b) => b.ok), beats }, null, 2));
  process.exit(0);
}

if (op === "init") {
  if (!args.title) fail("--title is required for init");
  const path = join(setDir, "course.json");
  if (!existsSync(path)) {
    mkdirSync(setDir, { recursive: true });
    const skeleton = {
      title: args.title,
      topic: args.topic ?? args.title,
      goal: args.goal ?? "",
      language: args.language ?? detectLanguage(`${args.title} ${args.topic ?? ""} ${args.goal ?? ""}`),
      style: { id: "", status: "pending" },
      outline: [],
      rootNode: "",
      path: [],
      nodes: {},
    };
    writeFileSync(path, `${JSON.stringify(skeleton, null, 2)}\n`);
  }
}

let course;
try {
  course = withCourseLock(setDir, (c) => {
  // Inside the lock a validation failure must THROW, never exit — an
  // exit here would leave course.json.lock behind for the next writer.
  const fail = (msg) => {
    throw new Error(msg);
  };
  switch (op) {
    case "init": {
      if (args.title) c.title = args.title;
      if (args.topic) c.topic = args.topic;
      if (args.goal) c.goal = args.goal;
      if (args.language) c.language = args.language;
      if (!c.style || typeof c.style !== "object") c.style = { id: "", status: "pending" };
      return c;
    }
    case "set-style": {
      const prev = c.style && typeof c.style === "object" ? c.style : {};
      const next = { ...prev };
      if (args["style-id"] !== undefined) next.id = args["style-id"];
      if (args.name !== undefined) next.name = args.name;
      if (args.recipe !== undefined) next.recipe = args.recipe;
      if (args.rationale !== undefined) next.rationale = args.rationale;
      if (args["ref-image"].length) next.userRefs = args["ref-image"];
      if (args.status !== undefined) {
        if (!STYLE_STATUSES.has(args.status)) fail(`--status must be one of ${[...STYLE_STATUSES].join(" | ")}`);
        next.status = args.status;
      } else if (!next.status) {
        next.status = next.id ? "confirmed" : "pending";
      }
      if (next.status === "pending") {
        delete next.sample;
        delete next.refImages;
      }
      if (!next.id) next.id = "";
      c.style = next;
      return c;
    }
    case "confirm-style": {
      const s = c.style && typeof c.style === "object" ? c.style : null;
      if (!s || !s.id) fail("no style candidate to confirm — the board has not produced one");
      const anchor = s.sample?.image ?? (Array.isArray(s.refImages) ? s.refImages[0] : undefined);
      const userRefs = Array.isArray(s.userRefs) ? s.userRefs : [];
      c.style = {
        ...s,
        status: "confirmed",
        refImages: [...(anchor ? [anchor] : []), ...userRefs.filter((r) => r !== anchor)],
      };
      return c;
    }
    case "watched": {
      if (!args.node) fail("--node is required");
      if (!c.nodes?.[args.node]) fail(`node "${args.node}" is not in course.json`);
      return appendWatched(c, args.node);
    }
    case "summary": {
      if (!args.file) fail("--file is required");
      c.summaryFile = args.file;
      return c;
    }
    case "outline": {
      if (!args.file) fail("--file is required (a JSON array of beats)");
      const raw = readJsonFile(args.file);
      const beats = Array.isArray(raw) ? raw : raw?.beats;
      if (!Array.isArray(beats) || beats.length === 0) fail("the outline file must be a non-empty array of beats");
      const prevById = new Map((c.outline ?? []).map((b) => [b.id, b]));
      c.outline = beats.map((b, i) => {
        const id = String(b?.id || `b${i + 1}`);
        const prev = prevById.get(id);
        const tier = TIERS.has(b?.tier) ? b.tier : "world-knowledge";
        const figureSpecs = Array.isArray(b?.figureSpecs ?? b?.figures) ? (b.figureSpecs ?? b.figures).map(String).filter(Boolean) : [];
        // Evidence already committed for this beat survives a re-plan;
        // a textbook beat with nothing to draw is grounded by definition.
        const kept = Array.isArray(prev?.evidence) && prev.evidence.length ? prev.evidence : null;
        const evidence = kept ?? (tier === "world-knowledge" && figureSpecs.length === 0 ? [{ kind: "world-knowledge", note: WORLD_KNOWLEDGE_NOTE(c.language) }] : []);
        const beat = { id, title: String(b?.title ?? id), summary: b?.summary ? String(b.summary) : "", tier, figureSpecs, evidence };
        if (Array.isArray(prev?.problems) && prev.problems.length) beat.problems = prev.problems;
        return beat;
      });
      if (!c.rootNode) c.rootNode = "n1";
      c.nodes = c.nodes && typeof c.nodes === "object" ? c.nodes : {};
      if (!c.nodes.n1) {
        c.nodes.n1 = { beat: c.outline[0].id, kind: "main", choiceLabel: c.outline[0].title, children: [], status: "planned" };
      }
      return c;
    }
    case "evidence": {
      if (!args.beat || !args.file) fail("--beat and --file are required");
      const beat = (c.outline ?? []).find((b) => b.id === args.beat);
      if (!beat) fail(`beat "${args.beat}" is not in the outline — land the outline first (course-edit.mjs outline)`);
      const raw = readJsonFile(args.file);
      const list = Array.isArray(raw) ? raw : raw?.evidence;
      if (!Array.isArray(list)) fail("the evidence file must be an array or { evidence: [...], problems?: [...] }");
      const reported = Array.isArray(raw?.problems) ? raw.problems.map(String) : [];
      const key = (e) => `${e.kind}|${e.file ?? ""}|${e.url ?? ""}`;
      const merged = Array.isArray(beat.evidence) ? [...beat.evidence] : [];
      const seen = new Set(merged.map(key));
      const missing = [];
      for (const e of list) {
        if (!e || !EVIDENCE_KINDS.has(e.kind)) fail(`evidence kind must be one of ${[...EVIDENCE_KINDS].join(" | ")} (got ${JSON.stringify(e?.kind)})`);
        const entry = { kind: e.kind, note: String(e.note ?? "") };
        if (e.file) entry.file = String(e.file);
        if (e.url) entry.url = String(e.url);
        if (entry.file && !existsSync(join(setDir, entry.file))) {
          missing.push(entry.file);
          continue;
        }
        if (!seen.has(key(entry))) {
          seen.add(key(entry));
          merged.push(entry);
        }
      }
      beat.evidence = merged;
      const problems = new Set([...(Array.isArray(beat.problems) ? beat.problems : []), ...reported, ...missing.map((f) => `evidence file not on disk: ${f}`)]);
      if (problems.size) beat.problems = [...problems];
      else delete beat.problems;
      beat.grounded = true;
      return c;
    }
    case "status": {
      if (!args.node || !args.status) fail("--node and --status are required");
      if (!NODE_STATUSES.has(args.status)) fail(`--status must be one of ${[...NODE_STATUSES].join(" | ")}`);
      if (!c.nodes?.[args.node]) fail(`node "${args.node}" is not in course.json`);
      c.nodes[args.node].status = args.status;
      return c;
    }
    default:
      fail(`unknown op "${op}"`);
  }
  });
} catch (e) {
  fail(e.message);
}

console.log(
  JSON.stringify({
    op,
    title: course.title ?? null,
    style: course.style ?? null,
    path: course.path ?? [],
    outline: (course.outline ?? []).length,
    grounded: (course.outline ?? []).filter((b) => Array.isArray(b.evidence) && b.evidence.length > 0).length,
    summaryFile: course.summaryFile ?? null,
  }),
);
