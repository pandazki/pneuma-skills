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
 *   <set>/nodes/<id>/<clip>.mp4     one montage clip of the scene
 *   <set>/nodes/<id>/video.mp4      the scene, its clips concatenated
 *                                   (binary; reaches the viewer via
 *                                   /content/*, never via Source)
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

/**
 * One time-coded cut inside a montage clip — the model cuts by itself,
 * so a clip carries 3-9 of these. "Shot" used to name a whole clip; from
 * 0.6 it names a cut's composed picture, and a legacy course's shots each
 * become one clip of one cut.
 */
export interface Cut {
  /** Seconds inside the clip: ascending, together covering the clip. */
  from: number;
  to: number;
  /** The composed picture — subject + action + setting, one line. */
  shot: string;
  /** Camera move in the course's language, no brackets. */
  camera?: string;
  /** Figures this cut shows, as references the model reproduces (set-relative). */
  figures: string[];
}

/** One narration line and the window it is spoken in, inside the clip.
 * The caption under the stage follows it. */
export interface NarrationLine {
  from: number;
  to: number;
  text: string;
}

/**
 * One montage clip of a scene: up to 15 s, cut 3-9 times, with the
 * narration distributed across its timeline. A scene is 1-3 clips, and
 * the scene's video is those clips concatenated — so a playhead into the
 * scene is a playhead into one clip (`lineAt` in viewer/waiting.ts).
 */
export interface Clip {
  id: string;
  /** Planned length in seconds (8-15); the measured one rides `video`. */
  duration?: number;
  cuts: Cut[];
  narration: NarrationLine[];
  /** Figures this clip binds as references (set-relative) — the union of
   * its cuts' figures, in cut order, when the clip declares none. */
  figures: string[];
  status: NodeStatus;
  video?: { file: string; duration: number };
}

/** One scene of the course tree: a teaching unit of one or more montage
 * clips, as long as its content needs. */
export interface CourseNode {
  id: string;
  parent?: string;
  /** Outline beat this node serves (attention anchor). */
  beat?: string;
  kind: NodeKind;
  /** Label this node carried when offered as a choice. */
  choiceLabel?: string;
  /** What the scene teaches and how it opens and closes — the writer's
   * input for a detour or question scene that has no clips yet. */
  brief?: string;
  /** The scene's narration: nodes/<id>/script.md, or the clips' narration
   * lines joined when the file is not written yet. */
  script: string;
  clips: Clip[];
  /** The whole scene as one file (its clips concatenated). */
  video?: { file: string; duration: number };
  evidence: EvidenceRef[];
  children: ChoiceRef[];
  status: NodeStatus;
  /** Set by the producer while in production: when it started and which step it is on. */
  startedAt?: string;
  phase?: ProductionPhase;
  /** Which clip is being shot or checked, 1-based, and how many there are. */
  clipIndex?: number;
  clipCount?: number;
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
  /** The course's language tag (`zh` / `en` / `ja` / …). It decides how
   * narration lines are joined into a scene's text: zh/ja sentences take
   * no separator, everyone else's take a space. */
  language?: string;
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

/** A pre-0.6 shot: one continuous take with one spoken line. */
interface RawShot {
  id?: string;
  script?: string;
  visual?: string;
  duration?: number;
  figures?: unknown;
  status?: string;
  video?: { file?: string; duration?: number };
}

interface RawCut {
  from?: unknown;
  to?: unknown;
  shot?: unknown;
  camera?: unknown;
  figures?: unknown;
}

interface RawNarrationLine {
  from?: unknown;
  to?: unknown;
  text?: unknown;
}

interface RawClip {
  id?: string;
  duration?: unknown;
  cuts?: unknown;
  narration?: unknown;
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
  clips?: unknown;
  /** Pre-0.6 shape, still read: one clip per shot. */
  shots?: unknown;
  video?: { file?: string; duration?: number };
  children?: Array<{ nodeId?: string; label?: string }>;
  status?: string;
  startedAt?: string;
  phase?: string;
  clipIndex?: number;
  clipCount?: number;
  /** Pre-0.6 names for clipIndex / clipCount. */
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
  language?: string;
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

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const paths = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((f): f is string => typeof f === "string" && f.length > 0) : [];

const clipStatus = (v: unknown): NodeStatus =>
  NODE_STATUSES.has(v as NodeStatus) ? (v as NodeStatus) : "planned";

function parseCuts(raw: unknown): Cut[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is RawCut => !!c && typeof c === "object")
    .map((c) => ({
      from: num(c.from) ?? 0,
      to: num(c.to) ?? 0,
      shot: text(c.shot),
      camera: text(c.camera) || undefined,
      figures: paths(c.figures),
    }));
}

/**
 * The clip's spoken lines. An entry is `{ from, to, text }`; a bare
 * string is accepted too (the producer's `clipScript` tolerates one), and
 * a line with nothing in it is not a spoken line at all.
 */
function parseNarration(raw: unknown): NarrationLine[] {
  if (!Array.isArray(raw)) return [];
  const out: NarrationLine[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const bare = entry.trim();
      if (bare) out.push({ from: 0, to: 0, text: bare });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const line = entry as RawNarrationLine;
    const spoken = text(line.text);
    if (!spoken) continue;
    out.push({ from: num(line.from) ?? 0, to: num(line.to) ?? 0, text: spoken });
  }
  return out;
}

function parseClips(raw: unknown): Clip[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is RawClip => !!c && typeof c === "object")
    .map((c, i) => {
      const cuts = parseCuts(c.cuts);
      const declared = paths(c.figures);
      return {
        id: typeof c.id === "string" && c.id ? c.id : `c${i + 1}`,
        duration: num(c.duration),
        cuts,
        narration: parseNarration(c.narration),
        // Contractually the union of the cuts' figures in cut order; the
        // producer writes it out, and a clip that did not is derived.
        figures: declared.length ? declared : [...new Set(cuts.flatMap((cut) => cut.figures))],
        status: clipStatus(c.status),
        video: parseVideo(c.video),
      };
    });
}

/**
 * A course written before 0.6 carries `shots[]` — one continuous take
 * with one spoken line each. Every one becomes a clip of a single cut
 * spanning the take (the shot's `visual` was that one composed picture)
 * with its script as the clip's only narration line, so every seed course
 * and everything shot before 0.6 still plays. `clips[]` wins when both
 * are present.
 */
function clipsFromShots(raw: unknown): Clip[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is RawShot => !!s && typeof s === "object")
    .map((s, i) => {
      const duration = num(s.duration);
      const span = duration ?? 0;
      const figures = paths(s.figures);
      const spoken = text(s.script);
      return {
        id: typeof s.id === "string" && s.id ? s.id : `s${i + 1}`,
        duration,
        cuts: [{ from: 0, to: span, shot: text(s.visual), camera: undefined, figures }],
        narration: spoken ? [{ from: 0, to: span, text: spoken }] : [],
        figures,
        status: clipStatus(s.status),
        video: parseVideo(s.video),
      };
    });
}

/** Languages whose sentences are not separated by a space. */
const isCjk = (language: string | undefined): boolean => {
  const tag = String(language ?? "").slice(0, 2).toLowerCase();
  return tag === "zh" || tag === "ja";
};

/**
 * What a scene says, as one string: every clip's narration lines in
 * order. Mirrors `clipScript` in `skill/scripts/h3-prompt.mjs` — the
 * text script.md records and the text the caption falls back to must
 * read alike.
 */
function clipsScript(clips: ReadonlyArray<Clip>, language: string | undefined): string {
  return clips
    .flatMap((c) => c.narration.map((l) => l.text))
    .filter(Boolean)
    .join(isCjk(language) ? "" : " ");
}

function parsePlay(raw: RawPlay | undefined): PlaySnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
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

      // 0.6 clips when they are there, the pre-0.6 shots mapped when
      // they are not: a node that has both is a 0.6 node whose old
      // shots[] nobody cleaned up.
      const declaredClips = parseClips(rn.clips);
      const clips = declaredClips.length ? declaredClips : clipsFromShots(rn.shots);
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
        // then the clips' narration already says what the scene will say.
        script: cleanScript(scriptFile?.content) || clipsScript(clips, raw.language),
        clips,
        video: parseVideo(rn.video),
        evidence: parseEvidence(evidenceFile?.content),
        children: (rn.children ?? [])
          .filter((c) => c.nodeId)
          .map((c) => ({ nodeId: String(c.nodeId), label: String(c.label ?? "") })),
        startedAt: typeof rn.startedAt === "string" && rn.startedAt ? rn.startedAt : undefined,
        phase: typeof rn.phase === "string" && PRODUCTION_PHASES.has(rn.phase) ? (rn.phase as ProductionPhase) : undefined,
        // The pre-0.6 names are still read: a course shot before 0.6
        // records its progress as shotIndex / shotCount.
        clipIndex: count(rn.clipIndex) ?? count(rn.shotIndex),
        clipCount: count(rn.clipCount) ?? count(rn.shotCount) ?? (clips.length || undefined),
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
      language: typeof raw.language === "string" && raw.language ? raw.language : undefined,
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
