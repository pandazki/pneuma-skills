/**
 * Plotwise domain types + aggregate-file load/save.
 *
 * A `Course` is the entire plotwise workspace: every `course.json` found
 * under a content-set directory (keyed by the directory prefix). One
 * content set = one custom-tailored branching video course.
 *
 * On disk, a course is deliberately multi-file so the agent can edit each
 * piece with surgical writes and two parallel producers never touch the
 * same file:
 *
 *   <set>/course.json               tree structure + meta (the manifest)
 *   <set>/nodes/<id>/script.md      verbatim narration script (canonical text)
 *   <set>/nodes/<id>/evidence.json  evidence refs bound to the segment
 *   <set>/nodes/<id>/video.mp4      the generated clip (binary; reaches the
 *                                   viewer via /content/*, never via Source)
 *   <set>/nodes/<id>/generation.json  provenance (prompt, expanded_prompt,
 *                                   seed, QA transcript) — not aggregated
 *   <set>/summary.md                the learning-path recap
 *
 * `load` merges course.json + per-node script/evidence into one `Course`.
 * `save` is a stub: the viewer never writes the domain — user choices flow
 * to the agent via notifications and the agent persists via Edit/Write.
 */

import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** `main` scenes follow the outline one beat each; `branch` scenes are
 * detours that return to it; `question` scenes answer the learner;
 * `sidequest` is the pre-0.4 name for a question scene. */
export type NodeKind = "main" | "branch" | "sidequest" | "question";
/** planned → (scripting →) queued → generating → ready | failed; a scene
 * on a road the learner did not take becomes `cancelled`. */
export type NodeStatus =
  | "planned"
  | "scripting"
  | "queued"
  | "generating"
  | "ready"
  | "failed"
  | "cancelled";
export type EvidenceKind =
  | "citation"
  | "code-verification"
  | "rendered-figure"
  | "world-knowledge";

/** One piece of grounding bound to a segment. `kind` is canonically one
 * of EvidenceKind, but an off-contract label an agent invents is kept and
 * displayed verbatim rather than silently dropped. */
export interface EvidenceRef {
  kind: EvidenceKind | (string & {});
  /** Workspace-relative file (rendered figure, verification output, notes). */
  file?: string;
  /** External source URL for citations. */
  url?: string;
  /** One-line human explanation of what this evidence establishes. */
  note: string;
}

/** A forward choice offered at the end of a segment. */
export interface ChoiceRef {
  nodeId: string;
  /** Choice-card label, e.g. "Unpack it with a worked example". */
  label: string;
}

/** One H3 clip of a scene, 5-15 s. Shots chain: shot k+1 is shot from
 * shot k's last frame, so a scene plays as one continuous take. */
export interface Shot {
  id: string;
  /** What is spoken in this shot, verbatim. */
  script: string;
  /** What is on screen, for the prompt. */
  visual?: string;
  /** Planned length in seconds. */
  duration?: number;
  /** Figures this shot shows, as references the model reproduces (set-relative). */
  figures: string[];
  status: NodeStatus;
  video?: { file: string; duration: number };
}

/** One scene of the course tree: a teaching unit of one or more shots,
 * as long as its content needs. */
export interface CourseNode {
  id: string;
  parent?: string;
  /** Outline beat this node serves (attention anchor). */
  beat?: string;
  kind: NodeKind;
  /** Label this node carried when offered as a choice. */
  choiceLabel?: string;
  /** What the scene teaches and how it opens and closes — the writer's
   * input for a detour or question scene that has no shots yet. */
  brief?: string;
  /** The scene's narration: nodes/<id>/script.md, or the shots' scripts
   * joined when the file is not written yet. */
  script: string;
  shots: Shot[];
  /** The whole scene as one clip (the shots concatenated). */
  video?: { file: string; duration: number };
  evidence: EvidenceRef[];
  children: ChoiceRef[];
  status: NodeStatus;
  /** Set by the producer while in production: when it started and which step it is on. */
  startedAt?: string;
  phase?: ProductionPhase;
  /** Which shot is being shot or checked, 1-based, and how many there are. */
  shotIndex?: number;
  shotCount?: number;
  /** Why the last production failed, when `status` is "failed". */
  error?: string;
}

export type PlayState = "warming" | "playing" | "complete" | "failed";

/** The play manager's snapshot of itself — read-only for everyone else.
 * `updatedAt` is its heartbeat: a snapshot that stops moving while work
 * is pending means the process is gone. */
export interface PlaySnapshot {
  state: PlayState;
  currentNode?: string;
  slots?: number;
  videoAhead?: number;
  planAhead?: number;
  queued: string[];
  active: string[];
  pruned: number;
  updatedAt?: string;
}

export type ProductionPhase = "script" | "shoot" | "qa";
const PRODUCTION_PHASES = new Set<string>(["script", "shoot", "qa"]);

/** One beat of the master outline — the spine the user must not drift
 * from, and the evidence index the play loop shoots against. */
export interface OutlineBeat {
  id: string;
  title: string;
  summary?: string;
  /** Accuracy tier decided at planning time. */
  tier?: EvidenceKind;
  /** Evidence bound to the beat at planning time — the references every
   * segment of this beat may lean on (figures rendered by code, pinned
   * citations, verification runs). Heavy work happens before play; the
   * per-segment producer only reads this list. */
  evidence: EvidenceRef[];
}

/** Where the style step stands. The board owns everything up to
 * `confirmed`; the stage never re-opens it. */
export type StyleStatus = "pending" | "sampling" | "sampled" | "confirmed";

/** The sample the user confirms the style on: a style anchor still and a
 * 5s clip shot from it with a hook line about the topic. Once confirmed,
 * the clip's last frame seeds the course's frame chain. */
export interface StyleSample {
  image?: string;
  video?: string;
  hook?: string;
  error?: string;
}

export interface CourseStyle {
  /** Preset id from the catalog, or "custom". */
  id: string;
  status: StyleStatus;
  /** Display name — custom styles have no catalog entry. */
  name?: string;
  /** Recipe text when it deviates from the catalog (custom / adjusted). */
  recipe?: string;
  /** Why the agent proposed this one, in the user's language. */
  rationale?: string;
  sample?: StyleSample;
  /** Reference images the learner provided (set-relative). */
  userRefs?: string[];
  /** Shoot references once confirmed: [anchor, ...characters]. */
  refImages?: string[];
}

/** One course (one content set). */
export interface CourseSet {
  title: string;
  topic: string;
  goal: string;
  style: CourseStyle;
  outline: OutlineBeat[];
  rootNode: string;
  /** The learner's actually-taken path, in order. */
  path: string[];
  nodes: Record<string, CourseNode>;
  /** Workspace-relative path of the recap document, when written. */
  summaryFile?: string;
  /** Present once the play manager has run. */
  play?: PlaySnapshot;
}

/** The whole plotwise workspace. */
export interface Course {
  byContentSet: Record<string, CourseSet>;
}

// ── load ────────────────────────────────────────────────────────────────────

interface RawShot {
  id?: string;
  script?: string;
  visual?: string;
  duration?: number;
  figures?: unknown;
  status?: string;
  video?: { file?: string; duration?: number };
}

interface RawNode {
  parent?: string;
  beat?: string;
  kind?: string;
  choiceLabel?: string;
  brief?: string;
  shots?: unknown;
  video?: { file?: string; duration?: number };
  children?: Array<{ nodeId?: string; label?: string }>;
  status?: string;
  startedAt?: string;
  phase?: string;
  shotIndex?: number;
  shotCount?: number;
  error?: string;
}

interface RawPlay {
  state?: string;
  currentNode?: string;
  slots?: number;
  videoAhead?: number;
  planAhead?: number;
  queued?: unknown;
  active?: unknown;
  pruned?: number;
  updatedAt?: string;
}

interface RawCourse {
  title?: string;
  topic?: string;
  goal?: string;
  style?: {
    id?: string;
    status?: string;
    name?: string;
    recipe?: string;
    rationale?: string;
    sample?: { image?: string; video?: string; hook?: string; error?: string };
    userRefs?: unknown;
    refImages?: unknown;
  };
  outline?: Array<{
    id?: string;
    title?: string;
    summary?: string;
    tier?: string;
    evidence?: unknown;
    /** Legacy shapes agents reach for without the contract in front of
     * them — lifted into `evidence` on load. */
    figures?: unknown;
    sources?: unknown;
  }>;
  rootNode?: string;
  path?: string[];
  nodes?: Record<string, RawNode>;
  summaryFile?: string;
  play?: RawPlay;
}

const NODE_KINDS = new Set<NodeKind>(["main", "branch", "sidequest", "question"]);
const NODE_STATUSES = new Set<NodeStatus>([
  "planned",
  "scripting",
  "queued",
  "generating",
  "ready",
  "failed",
  "cancelled",
]);
const PLAY_STATES = new Set<PlayState>(["warming", "playing", "complete", "failed"]);

function parseVideo(v: { file?: string; duration?: number } | undefined): { file: string; duration: number } | undefined {
  return v?.file != null ? { file: String(v.file), duration: Number(v.duration ?? 0) } : undefined;
}

function parseShots(raw: unknown): Shot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is RawShot => !!s && typeof s === "object")
    .map((s, i) => ({
      id: typeof s.id === "string" && s.id ? s.id : `s${i + 1}`,
      script: typeof s.script === "string" ? s.script.trim() : "",
      visual: typeof s.visual === "string" && s.visual ? s.visual : undefined,
      duration: typeof s.duration === "number" && Number.isFinite(s.duration) ? s.duration : undefined,
      figures: Array.isArray(s.figures) ? s.figures.filter((f): f is string => typeof f === "string" && f.length > 0) : [],
      status: NODE_STATUSES.has(s.status as NodeStatus) ? (s.status as NodeStatus) : "planned",
      video: parseVideo(s.video),
    }));
}

function parsePlay(raw: RawPlay | undefined): PlaySnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    state: PLAY_STATES.has(raw.state as PlayState) ? (raw.state as PlayState) : "warming",
    currentNode: typeof raw.currentNode === "string" && raw.currentNode ? raw.currentNode : undefined,
    slots: num(raw.slots),
    videoAhead: num(raw.videoAhead),
    planAhead: num(raw.planAhead),
    queued: ids(raw.queued),
    active: ids(raw.active),
    pruned: num(raw.pruned) ?? 0,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : undefined,
  };
}
const EVIDENCE_KINDS = new Set<EvidenceKind>([
  "citation",
  "code-verification",
  "rendered-figure",
  "world-knowledge",
]);

/**
 * Build a Course from the raw file snapshot. Every `<prefix>/course.json`
 * is parsed into a CourseSet; per-node script.md and evidence.json under
 * the same prefix are merged into the node objects. Returns null when no
 * course.json exists yet.
 *
 * A malformed course.json throws — the aggregate-file provider catches,
 * emits an error event, and keeps the previous good value alive (the right
 * behavior while the agent is mid-write). Malformed per-node evidence.json
 * degrades to an empty list instead: partial evidence should not take the
 * whole course down.
 */
export function load(files: ReadonlyArray<ViewerFileContent>): Course | null {
  const courseFiles = files.filter((f) => /(^|\/)course\.json$/.test(f.path));
  if (courseFiles.length === 0) return null;

  const byContentSet: Record<string, CourseSet> = {};

  for (const cf of courseFiles) {
    const prefix =
      cf.path === "course.json"
        ? ""
        : cf.path.slice(0, -"/course.json".length);
    const raw = JSON.parse(cf.content) as RawCourse;

    const nodes: Record<string, CourseNode> = {};
    for (const [id, rn] of Object.entries(raw.nodes ?? {})) {
      const scriptPath = joinPrefix(prefix, `nodes/${id}/script.md`);
      const evidencePath = joinPrefix(prefix, `nodes/${id}/evidence.json`);
      const scriptFile = files.find((f) => f.path === scriptPath);
      const evidenceFile = files.find((f) => f.path === evidencePath);

      const shots = parseShots(rn.shots);
      const count = (v: unknown): number | undefined =>
        typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
      nodes[id] = {
        id,
        parent: rn.parent || undefined,
        beat: rn.beat || undefined,
        kind: NODE_KINDS.has(rn.kind as NodeKind)
          ? (rn.kind as NodeKind)
          : "main",
        choiceLabel: rn.choiceLabel || undefined,
        brief: typeof rn.brief === "string" && rn.brief.trim() ? rn.brief.trim() : undefined,
        // The manager writes script.md when the scene is ready; until
        // then the shots already say what the scene will say.
        script: cleanScript(scriptFile?.content) || shots.map((s) => s.script).filter(Boolean).join("\n\n"),
        shots,
        video: parseVideo(rn.video),
        evidence: parseEvidence(evidenceFile?.content),
        children: (rn.children ?? [])
          .filter((c) => c.nodeId)
          .map((c) => ({ nodeId: String(c.nodeId), label: String(c.label ?? "") })),
        startedAt: typeof rn.startedAt === "string" && rn.startedAt ? rn.startedAt : undefined,
        phase: typeof rn.phase === "string" && PRODUCTION_PHASES.has(rn.phase) ? (rn.phase as ProductionPhase) : undefined,
        shotIndex: count(rn.shotIndex),
        shotCount: count(rn.shotCount) ?? (shots.length || undefined),
        error: typeof rn.error === "string" && rn.error ? rn.error : undefined,
        status: NODE_STATUSES.has(rn.status as NodeStatus)
          ? (rn.status as NodeStatus)
          : "planned",
      };
    }

    byContentSet[prefix] = {
      title: typeof raw.title === "string" ? raw.title : "Untitled course",
      topic: typeof raw.topic === "string" ? raw.topic : "",
      goal: typeof raw.goal === "string" ? raw.goal : "",
      style: parseStyle(raw.style),
      outline: (raw.outline ?? [])
        .filter((b) => b.id && b.title)
        .map((b) => ({
          id: String(b.id),
          title: String(b.title),
          summary: b.summary ? String(b.summary) : undefined,
          tier: EVIDENCE_KINDS.has(b.tier as EvidenceKind)
            ? (b.tier as EvidenceKind)
            : undefined,
          evidence: beatEvidence(b),
        })),
      rootNode: typeof raw.rootNode === "string" ? raw.rootNode : "",
      path: Array.isArray(raw.path) ? raw.path.map(String) : [],
      nodes,
      summaryFile: raw.summaryFile ? String(raw.summaryFile) : undefined,
      play: parsePlay(raw.play),
    };
  }

  return { byContentSet };
}

function joinPrefix(prefix: string, rel: string): string {
  return prefix === "" ? rel : `${prefix}/${rel}`;
}

/**
 * script.md is contractually bare narration, but an agent occasionally
 * decorates it with a markdown heading; the caption under the stage must
 * never show one. Headings are dropped, the narration lines survive.
 */
function cleanScript(content: string | undefined): string {
  if (!content) return "";
  return content
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .trim();
}

function parseEvidence(content: string | undefined): EvidenceRef[] {
  if (!content) return [];
  try {
    return parseEvidenceEntries(JSON.parse(content) as unknown);
  } catch {
    return [];
  }
}

/** Accept `[...]` or `{ evidence: [...] }`; keep every entry with a
 * non-empty string kind. Mirrors `normalizeEvidenceList` in
 * `skill/scripts/segment-lib.mjs` — the producer and the viewer must
 * read the same list. */
function parseEvidenceEntries(parsed: unknown): EvidenceRef[] {
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { evidence?: unknown[] })?.evidence)
      ? (parsed as { evidence: unknown[] }).evidence
      : [];
  return list
    .filter(
      (e): e is Record<string, unknown> =>
        !!e &&
        typeof e === "object" &&
        typeof (e as { kind?: unknown }).kind === "string" &&
        ((e as { kind: string }).kind.length > 0),
    )
    .map((e) => ({
      kind: String(e.kind),
      file: e.file ? String(e.file) : undefined,
      url: e.url ? String(e.url) : undefined,
      note: String(e.note ?? ""),
    }));
}

const STYLE_STATUSES = new Set<StyleStatus>([
  "pending",
  "sampling",
  "sampled",
  "confirmed",
]);

/** A course written before the style step existed carries `{ id }` alone
 * — that is a confirmed style. No style at all is a pending one. */
function parseStyle(raw: RawCourse["style"]): CourseStyle {
  const id = typeof raw?.id === "string" ? raw.id : "";
  const status = STYLE_STATUSES.has(raw?.status as StyleStatus)
    ? (raw!.status as StyleStatus)
    : id
      ? "confirmed"
      : "pending";
  const strings = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.length > 0) : undefined;
  const sample = raw?.sample && typeof raw.sample === "object"
    ? {
        image: typeof raw.sample.image === "string" ? raw.sample.image : undefined,
        video: typeof raw.sample.video === "string" ? raw.sample.video : undefined,
        hook: typeof raw.sample.hook === "string" ? raw.sample.hook : undefined,
        error: typeof raw.sample.error === "string" ? raw.sample.error : undefined,
      }
    : undefined;
  return {
    id,
    status,
    name: typeof raw?.name === "string" && raw.name ? raw.name : undefined,
    recipe: typeof raw?.recipe === "string" && raw.recipe ? raw.recipe : undefined,
    rationale: typeof raw?.rationale === "string" && raw.rationale ? raw.rationale : undefined,
    sample,
    userRefs: strings(raw?.userRefs),
    refImages: strings(raw?.refImages),
  };
}

/**
 * Evidence declared on an outline beat. Canonical is `evidence[]`; the
 * two shapes agents reach for when the contract is not in front of them
 * are lifted as well: `figures: string[]` (code-rendered figures) and
 * `sources: "evidence/bN/sources.json"` (a citations file).
 */
function beatEvidence(b: {
  evidence?: unknown;
  figures?: unknown;
  sources?: unknown;
}): EvidenceRef[] {
  const out = parseEvidenceEntries(b.evidence);
  if (Array.isArray(b.figures)) {
    for (const f of b.figures) {
      if (typeof f === "string" && f) {
        out.push({ kind: "rendered-figure", file: f, note: "" });
      }
    }
  }
  if (typeof b.sources === "string" && b.sources) {
    out.push({ kind: "citation", file: b.sources, note: "" });
  }
  return out;
}

// ── save ────────────────────────────────────────────────────────────────────

/**
 * The plotwise viewer is read-only over the domain: user choices are
 * delivered to the agent as notifications and the agent persists them
 * through its own Edit/Write tools (which the runtime origin-tags).
 * Stubbing save is the documented aggregate-file pattern for that
 * arrangement (see illustrate).
 */
export function save(
  _next: Course,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  return { writes: [], deletes: [] };
}
