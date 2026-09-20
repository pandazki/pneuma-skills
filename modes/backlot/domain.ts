/**
 * Backlot domain types + aggregate-file load/save.
 *
 * A `Film` value is the whole backlot workspace: every `backlot.json` found
 * under a top-level directory (the content set = one short film project),
 * each carrying the `shot.json` files under its own `shots/` directory.
 *
 * `backlot.json` and `shot.json` are written ONLY by
 * `skill/scripts/previz.mjs` (invariant 2 of the design brief). The agent
 * authors the prose (`shot-plan.md`, `prompts.md`, `comparison.md`) and the
 * Blender script; the viewer writes nothing at all, which is why `saveFilm`
 * throws instead of decomposing.
 *
 * Parsing is defensive on purpose. `shot.json` is rewritten mid-render while
 * the viewer is watching, so a half-written or hand-edited shot is SKIPPED
 * with a warning rather than thrown on — one broken shot must not blank the
 * whole film (same stance as `modes/lucid/domain.ts`).
 */

import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

// ── On-disk contract ────────────────────────────────────────────────────────

export const BACKLOT_MANIFEST = "backlot.json" as const;
export const SHOT_MANIFEST = "shot.json" as const;
export const SCENE_META = "scene.meta.json" as const;

/** The frame arithmetic of one shot. `frames === seconds × fps`, frames 1..N. */
export interface ShotSpec {
  seconds: number;
  fps: number;
  width: number;
  height: number;
  frames: number;
}

/** `original` starts from an idea; `recreate` starts from a reference video. */
export type ShotEntry = "original" | "recreate";

/** What a beat is: the four rows the timeline draws. */
export type BeatKind = "action" | "trigger" | "camera" | "hold";

export interface Beat {
  id: string;
  label: string;
  from: number;
  to: number;
  kind: BeatKind;
  /** A trigger beat names the beat that caused it (invariant 5). */
  causedBy: string | null;
}

/** ffprobe facts about a media file — what was MEASURED, never what was asked for. */
export interface Probe {
  codec: string | null;
  pixFmt: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  frames: number | null;
  seconds: number | null;
  bytes: number | null;
}

/** One rendered MP4 with the revision it belongs to. */
export interface RenderRecord {
  file: string;
  revision: number;
  probe: Probe | null;
  renderedAt: number | null;
  renderSeconds: number | null;
}

export interface ReferenceState {
  file: string;
  sourceName: string | null;
  in: number | null;
  out: number | null;
  probe: Probe | null;
  /** Cut timestamps detected inside the trimmed segment, in seconds. */
  cuts: number[];
  sheet: string | null;
}

export interface GreyboxState {
  revision: number;
  script: string | null;
  preview: RenderRecord | null;
  /** The MP4 the video model receives — the conditioning truth (invariant 1). */
  final: RenderRecord | null;
  glb: string | null;
  meta: string | null;
  blend: string | null;
  sheet: string | null;
}

/** Nothing is "passed" unseen: a check nobody looked at stays `unverified`. */
export type CheckStatus = "pass" | "fail" | "unverified";

export interface CheckHistoryEntry {
  revision: number;
  status: CheckStatus;
  note: string;
}

export interface Check {
  id: string;
  label: string;
  /** `greybox` or a take id (`take-01`). */
  target: string;
  status: CheckStatus;
  /** Seconds on the shared clock, or null for a whole-shot check. */
  range: [number, number] | null;
  note: string;
  revision: number;
  history: CheckHistoryEntry[];
}

export type TakeStatus = "submitted" | "done" | "failed";

export interface TakeCost {
  usd: number;
  basis: string;
}

export interface Take {
  id: string;
  status: TakeStatus;
  model: string;
  endpoint: string;
  resolution: string;
  seconds: number | null;
  refSeconds: number | null;
  greyboxRevision: number | null;
  requestId: string | null;
  file: string | null;
  promptFile: string | null;
  probe: Probe | null;
  cost: TakeCost | null;
  submittedAt: number | null;
  finishedAt: number | null;
  /** The named defect this take was made to fix (invariant 6). */
  fix: string | null;
  selected: boolean;
  note: string;
  /** Why a `failed` take failed. */
  error: string | null;
}

/** Exactly what one `shot.json` holds, plus where it lives. */
export interface Shot {
  id: string;
  title: string;
  entry: ShotEntry;
  spec: ShotSpec;
  assumptions: string[];
  beats: Beat[];
  reference: ReferenceState | null;
  greybox: GreyboxState;
  checks: Check[];
  /** Check ids that failed on two consecutive revisions (invariant 7). */
  stuck: string[];
  promptFile: string | null;
  takes: Take[];
  /** Workspace-relative shot directory (`first-light/shots/lab-walk`). */
  dir: string;
  /** Loader-level caveats (missing fields defaulted, unknown version). */
  warnings: string[];
}

export interface ProjectDefaults {
  seconds: number;
  fps: number;
  width: number;
  height: number;
}

/** One project = one content set = one short film. */
export interface Project {
  /** Content-set prefix (`"first-light"`, `""` for a root-level project). */
  dir: string;
  title: string;
  defaults: ProjectDefaults;
  /** Shots in `backlot.json` order; shots found on disk but unlisted come last. */
  shots: Shot[];
  warnings: string[];
}

export interface Film {
  projects: Record<string, Project>;
}

/** `greybox/scene.meta.json`, written by the Blender kit at render time. */
export interface SceneAccent {
  objects: string[];
  from: number;
  to: number;
  /** Linear RGB in 0..1, as Blender wrote it. */
  color: [number, number, number];
}

export interface SceneMeta {
  fps: number;
  frames: number;
  seconds: number;
  width: number;
  height: number;
  /** glTF node name of the shot camera. */
  camera: string | null;
  /** glTF node names whose floor trail the 3D lane draws. */
  subjects: string[];
  accents: SceneAccent[];
  blender: string | null;
  engine: string | null;
}

// ── Parsing helpers ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

const BEAT_KINDS: ReadonlySet<string> = new Set(["action", "trigger", "camera", "hold"]);
const CHECK_STATUSES: ReadonlySet<string> = new Set(["pass", "fail", "unverified"]);
const TAKE_STATUSES: ReadonlySet<string> = new Set(["submitted", "done", "failed"]);

export function parseProbe(raw: unknown): Probe | null {
  if (!isRecord(raw)) return null;
  return {
    codec: asNullableString(raw.codec),
    pixFmt: asNullableString(raw.pixFmt),
    width: asNullableNumber(raw.width),
    height: asNullableNumber(raw.height),
    fps: asNullableNumber(raw.fps),
    frames: asNullableNumber(raw.frames),
    seconds: asNullableNumber(raw.seconds),
    bytes: asNullableNumber(raw.bytes),
  };
}

function parseRange(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const from = asNullableNumber(raw[0]);
  const to = asNullableNumber(raw[1]);
  if (from === null || to === null) return null;
  return from <= to ? [from, to] : [to, from];
}

function parseRender(raw: unknown): RenderRecord | null {
  if (!isRecord(raw)) return null;
  const file = asNullableString(raw.file);
  if (!file) return null;
  return {
    file,
    revision: asNumber(raw.revision, 0),
    probe: parseProbe(raw.probe),
    renderedAt: asNullableNumber(raw.renderedAt),
    renderSeconds: asNullableNumber(raw.renderSeconds),
  };
}

function parseBeat(raw: unknown): Beat | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id, "");
  if (!id) return null;
  const kind = asString(raw.kind, "action");
  const from = asNumber(raw.from, 0);
  const to = asNumber(raw.to, from);
  return {
    id,
    label: asString(raw.label, id),
    from,
    to: Math.max(from, to),
    kind: (BEAT_KINDS.has(kind) ? kind : "action") as BeatKind,
    causedBy: asNullableString(raw.causedBy),
  };
}

function parseCheck(raw: unknown): Check | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id, "");
  if (!id) return null;
  const status = asString(raw.status, "unverified");
  return {
    id,
    label: asString(raw.label, id),
    target: asString(raw.target, "greybox"),
    // An unknown status is NOT green. A check the loader cannot read is a
    // check nobody has looked at (invariant 4).
    status: (CHECK_STATUSES.has(status) ? status : "unverified") as CheckStatus,
    range: parseRange(raw.range),
    note: asString(raw.note, ""),
    revision: asNumber(raw.revision, 0),
    history: Array.isArray(raw.history)
      ? raw.history.filter(isRecord).map((h) => {
          const hs = asString(h.status, "unverified");
          return {
            revision: asNumber(h.revision, 0),
            status: (CHECK_STATUSES.has(hs) ? hs : "unverified") as CheckStatus,
            note: asString(h.note, ""),
          };
        })
      : [],
  };
}

function parseTake(raw: unknown): Take | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id, "");
  if (!id) return null;
  const status = asString(raw.status, "submitted");
  const cost = isRecord(raw.cost)
    ? { usd: asNumber(raw.cost.usd, 0), basis: asString(raw.cost.basis, "") }
    : null;
  return {
    id,
    // An unreadable status is `submitted`, not `done`: a take is never
    // reported finished on the strength of a field nobody could parse.
    status: (TAKE_STATUSES.has(status) ? status : "submitted") as TakeStatus,
    model: asString(raw.model, ""),
    endpoint: asString(raw.endpoint, ""),
    resolution: asString(raw.resolution, ""),
    seconds: asNullableNumber(raw.seconds),
    refSeconds: asNullableNumber(raw.refSeconds),
    greyboxRevision: asNullableNumber(raw.greyboxRevision),
    requestId: asNullableString(raw.requestId),
    file: asNullableString(raw.file),
    promptFile: asNullableString(raw.promptFile),
    probe: parseProbe(raw.probe),
    cost,
    submittedAt: asNullableNumber(raw.submittedAt),
    finishedAt: asNullableNumber(raw.finishedAt),
    fix: asNullableString(raw.fix),
    selected: raw.selected === true,
    note: asString(raw.note, ""),
    error: asNullableString(raw.error),
  };
}

function parseGreybox(raw: unknown, warnings: string[]): GreyboxState {
  if (!isRecord(raw)) {
    warnings.push("greybox block missing, shown as not rendered");
    return {
      revision: 0,
      script: null,
      preview: null,
      final: null,
      glb: null,
      meta: null,
      blend: null,
      sheet: null,
    };
  }
  return {
    revision: asNumber(raw.revision, 0),
    script: asNullableString(raw.script),
    preview: parseRender(raw.preview),
    final: parseRender(raw.final),
    glb: asNullableString(raw.glb),
    meta: asNullableString(raw.meta),
    blend: asNullableString(raw.blend),
    sheet: asNullableString(raw.sheet),
  };
}

function parseReference(raw: unknown): ReferenceState | null {
  if (!isRecord(raw)) return null;
  const file = asNullableString(raw.file);
  if (!file) return null;
  return {
    file,
    sourceName: asNullableString(raw.sourceName),
    in: asNullableNumber(raw.in),
    out: asNullableNumber(raw.out),
    probe: parseProbe(raw.probe),
    cuts: Array.isArray(raw.cuts)
      ? raw.cuts.filter((c): c is number => typeof c === "number" && Number.isFinite(c))
      : [],
    sheet: asNullableString(raw.sheet),
  };
}

/**
 * Parse one `shot.json` text. Returns null when the text is not JSON or not a
 * shot at all; otherwise defaults what is missing and records it in
 * `warnings`.
 *
 * `dir` is the workspace-relative shot directory; `fallbackId` is the
 * directory name, used when the file does not name itself.
 */
export function parseShot(dir: string, fallbackId: string, text: string): Shot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;

  const warnings: string[] = [];
  if (raw.version !== 1) {
    if (typeof raw.version !== "number") return null;
    warnings.push(`unknown shot version ${raw.version}, read as 1`);
  }

  const specRaw = isRecord(raw.spec) ? raw.spec : {};
  const seconds = asNumber(specRaw.seconds, 8);
  const fps = asNumber(specRaw.fps, 24);
  // Frame arithmetic is exact (invariant 3). A file whose `frames` disagrees
  // with `seconds × fps` is reported, not silently trusted — the viewer's
  // frame readout and the 3D lane's clip mapping both read this number.
  const declaredFrames = asNullableNumber(specRaw.frames);
  const computedFrames = Math.round(seconds * fps);
  if (declaredFrames !== null && declaredFrames !== computedFrames) {
    warnings.push(
      `spec.frames is ${declaredFrames} but ${seconds} s × ${fps} fps is ${computedFrames}`,
    );
  }

  const entry = asString(raw.entry, "original");
  const beats = Array.isArray(raw.beats)
    ? raw.beats.map(parseBeat).filter((b): b is Beat => b !== null)
    : [];
  // Cause before effect (invariant 5): a dangling `causedBy` would draw a
  // connector to nothing, so it is reported and dropped to null.
  const beatIds = new Set(beats.map((b) => b.id));
  for (const beat of beats) {
    if (beat.causedBy && !beatIds.has(beat.causedBy)) {
      warnings.push(`beat "${beat.id}" names an unknown cause "${beat.causedBy}"`);
      beat.causedBy = null;
    }
  }

  const promptRaw = isRecord(raw.prompt) ? raw.prompt : {};

  return {
    id: asString(raw.id, fallbackId),
    title: asString(raw.title, fallbackId),
    entry: (entry === "recreate" ? "recreate" : "original") as ShotEntry,
    spec: {
      seconds,
      fps,
      width: asNumber(specRaw.width, 1280),
      height: asNumber(specRaw.height, 720),
      frames: declaredFrames ?? computedFrames,
    },
    assumptions: asStringArray(raw.assumptions),
    beats,
    reference: parseReference(raw.reference),
    greybox: parseGreybox(raw.greybox, warnings),
    checks: Array.isArray(raw.checks)
      ? raw.checks.map(parseCheck).filter((c): c is Check => c !== null)
      : [],
    stuck: asStringArray(raw.stuck),
    promptFile: asNullableString(promptRaw.file) ?? "prompts.md",
    takes: Array.isArray(raw.takes)
      ? raw.takes.map(parseTake).filter((t): t is Take => t !== null)
      : [],
    dir,
    warnings,
  };
}

/** `greybox/scene.meta.json` → `SceneMeta`, or null when it is not one. */
export function parseSceneMeta(text: string): SceneMeta | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const fps = asNullableNumber(raw.fps);
  const frames = asNullableNumber(raw.frames);
  if (fps === null || frames === null) return null;
  const accents: SceneAccent[] = Array.isArray(raw.accents)
    ? raw.accents.filter(isRecord).flatMap((a) => {
        const color = Array.isArray(a.color) ? a.color.map((c) => asNumber(c, 0)) : [];
        if (color.length < 3) return [];
        const objects = asStringArray(a.objects);
        if (objects.length === 0) return [];
        return [
          {
            objects,
            from: asNumber(a.from, 0),
            to: asNumber(a.to, 0),
            color: [color[0], color[1], color[2]] as [number, number, number],
          },
        ];
      })
    : [];
  return {
    fps,
    frames,
    seconds: asNumber(raw.seconds, frames / fps),
    width: asNumber(raw.width, 0),
    height: asNumber(raw.height, 0),
    camera: asNullableString(raw.camera),
    subjects: asStringArray(raw.subjects),
    accents,
    blender: asNullableString(raw.blender),
    engine: asNullableString(raw.engine),
  };
}

// ── Path helpers ────────────────────────────────────────────────────────────

/**
 * Content-set prefix for a `backlot.json` path, or null when the path is not
 * one. Only a direct top-level directory is a project: `a/b/backlot.json`
 * would be invisible to the content-set resolver, so it is not offered.
 */
export function projectDirOf(path: string): string | null {
  if (path === BACKLOT_MANIFEST) return "";
  const suffix = `/${BACKLOT_MANIFEST}`;
  if (!path.endsWith(suffix)) return null;
  const dir = path.slice(0, -suffix.length);
  if (dir.includes("/") || dir.startsWith(".")) return null;
  return dir;
}

/** `{ project, shot }` for a `…/shots/<id>/shot.json` path, else null. */
export function shotRefOf(path: string): { project: string; shot: string } | null {
  const suffix = `/${SHOT_MANIFEST}`;
  if (!path.endsWith(suffix)) return null;
  const parts = path.slice(0, -suffix.length).split("/");
  // `shots/<id>` (root project) or `<project>/shots/<id>`.
  if (parts.length === 2 && parts[0] === "shots") return { project: "", shot: parts[1] };
  if (parts.length === 3 && parts[1] === "shots" && !parts[0].startsWith(".")) {
    return { project: parts[0], shot: parts[2] };
  }
  return null;
}

/** Workspace-relative directory holding a shot's files. */
export function shotDir(projectDir: string, shotId: string): string {
  return projectDir ? `${projectDir}/shots/${shotId}` : `shots/${shotId}`;
}

// ── Load / save ─────────────────────────────────────────────────────────────

export function loadFilm(files: ReadonlyArray<ViewerFileContent>): Film | null {
  const projects: Record<string, Project> = {};
  const order: Record<string, string[]> = {};

  for (const file of files) {
    const dir = projectDirOf(file.path);
    if (dir === null) continue;
    const warnings: string[] = [];
    let title = dir || "Untitled";
    let defaults: ProjectDefaults = { seconds: 8, fps: 24, width: 1280, height: 720 };
    let shotIds: string[] = [];
    try {
      const raw: unknown = JSON.parse(file.content);
      if (!isRecord(raw)) continue;
      title = asString(raw.title, title);
      if (isRecord(raw.defaults)) {
        defaults = {
          seconds: asNumber(raw.defaults.seconds, defaults.seconds),
          fps: asNumber(raw.defaults.fps, defaults.fps),
          width: asNumber(raw.defaults.width, defaults.width),
          height: asNumber(raw.defaults.height, defaults.height),
        };
      }
      shotIds = asStringArray(raw.shots);
    } catch {
      // A half-written manifest still names a project — the directory is
      // there and its shots are readable. Say so rather than dropping it.
      warnings.push("backlot.json could not be parsed, shots listed in discovery order");
    }
    projects[dir] = { dir, title, defaults, shots: [], warnings };
    order[dir] = shotIds;
  }

  for (const file of files) {
    const ref = shotRefOf(file.path);
    if (ref === null) continue;
    const project = projects[ref.project];
    // A shot whose project manifest is missing has no content set to live in.
    if (!project) continue;
    const shot = parseShot(shotDir(ref.project, ref.shot), ref.shot, file.content);
    if (shot) project.shots.push(shot);
  }

  for (const [dir, project] of Object.entries(projects)) {
    const listed = order[dir] ?? [];
    const rank = new Map(listed.map((id, i) => [id, i]));
    project.shots.sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.id.localeCompare(b.id);
    });
    for (const id of listed) {
      if (!project.shots.some((s) => s.id === id)) {
        project.warnings.push(`shot "${id}" is listed in backlot.json but has no shot.json`);
      }
    }
  }

  return { projects };
}

/**
 * The backlot viewer is strictly read-only (invariant 2). `backlot.json` and
 * `shot.json` are written only by `skill/scripts/previz.mjs`, which owns the
 * revision counter, the acceptance record and the take ledger. When
 * write-back ever lands, replace this with a real decomposer rather than
 * teaching the viewer a second way to write machine state.
 */
export function saveFilm(
  _next: Film,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  throw new Error(
    "backlot viewer is read-only; backlot.json and shot.json are written by scripts/previz.mjs",
  );
}

// ── Helpers the viewer and extractContext share ────────────────────────────

/**
 * Frame number at `t` on the shared clock, 1-based and clamped to the spec.
 *
 * Blender numbers frames 1..N and the glTF exporter puts frame 1 at `1/fps`,
 * so t = 0 is frame 1 — and t = seconds would be frame N+1, which never
 * exists (invariant 3).
 */
export function frameAt(t: number, spec: ShotSpec): number {
  const frame = 1 + Math.round(t * spec.fps);
  return Math.min(Math.max(frame, 1), Math.max(1, spec.frames));
}

/** The beat containing `t`, preferring the narrowest match. */
export function beatAt(beats: ReadonlyArray<Beat>, t: number): Beat | null {
  let best: Beat | null = null;
  for (const beat of beats) {
    if (t < beat.from || t > beat.to) continue;
    if (!best || beat.to - beat.from < best.to - best.from) best = beat;
  }
  return best;
}

/** The take the shot delivers, or the first one when none is marked. */
export function selectedTake(shot: Shot): Take | null {
  return shot.takes.find((t) => t.selected) ?? shot.takes[0] ?? null;
}

/**
 * The acceptance summary, honest by construction (invariant 4). A shot is
 * only `accepted` when EVERY check of that target passed.
 */
export function checkTally(
  checks: ReadonlyArray<Check>,
): { pass: number; fail: number; unverified: number } {
  let pass = 0;
  let fail = 0;
  let unverified = 0;
  for (const check of checks) {
    if (check.status === "pass") pass += 1;
    else if (check.status === "fail") fail += 1;
    else unverified += 1;
  }
  return { pass, fail, unverified };
}

/** Distinct check targets in a stable order: `greybox` first, then take ids. */
export function checkTargets(checks: ReadonlyArray<Check>): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const check of checks) {
    if (seen.has(check.target)) continue;
    seen.add(check.target);
    targets.push(check.target);
  }
  return targets.sort((a, b) => {
    if (a === "greybox") return -1;
    if (b === "greybox") return 1;
    return a.localeCompare(b);
  });
}

/** Stage dots for the shots rail: plan · greybox · accepted · take. */
export interface ShotStages {
  plan: boolean;
  greybox: boolean;
  accepted: boolean;
  take: boolean;
}

export function shotStages(shot: Shot): ShotStages {
  const greyboxChecks = shot.checks.filter((c) => c.target === "greybox");
  return {
    plan: shot.beats.length > 0,
    greybox: shot.greybox.final !== null,
    // "Accepted" means every greybox check passed — an `unverified` one is
    // not green, and `stuck` is never accepted.
    accepted:
      greyboxChecks.length > 0 &&
      greyboxChecks.every((c) => c.status === "pass") &&
      shot.stuck.length === 0,
    take: shot.takes.some((t) => t.status === "done"),
  };
}
