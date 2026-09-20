/**
 * Everything the backlot player decides that is not React.
 *
 * Lane resolution, the layout algebra, address parsing/resolution, timeline
 * geometry and the small formatters live here so the same rules answer the
 * user's click, the agent's `navigate-to` and `get-player-state`. A second
 * copy inside the component is how a player and its report start disagreeing.
 */

import type {
  Beat,
  BeatKind,
  Check,
  Film,
  Probe,
  Project,
  Shot,
  StageId,
  Take,
} from "../domain.js";
import { STAGES, frameAt, selectedTake } from "../domain.js";

// ── Vocabulary ──────────────────────────────────────────────────────────────

export type LaneId = "reference" | "board" | "greybox" | "take";
export type LayoutId = "side" | "wipe" | "blend" | "solo";
export type GreyboxMode = "render" | "3d";
export type CameraMode = "shot" | "free";

export const LANE_IDS: ReadonlyArray<LaneId> = ["reference", "board", "greybox", "take"];
export const LAYOUT_IDS: ReadonlyArray<LayoutId> = ["side", "wipe", "blend", "solo"];
export const PLAY_RATES: ReadonlyArray<number> = [0.25, 0.5, 1];

export const LAYOUT_LABEL: Record<LayoutId, string> = {
  side: "Side",
  wipe: "Wipe",
  blend: "Blend",
  solo: "Solo",
};

/** The two stages whose body is the player; everything else has its own view. */
export const PLAYER_STAGES: ReadonlyArray<StageId> = ["previz", "takes"];

export function isPlayerStage(stage: StageId): boolean {
  return (PLAYER_STAGES as ReadonlyArray<string>).includes(stage);
}

/** What the player is currently pointed at. One value, two consumers. */
export interface PlayerPosition {
  shot: string;
  lane: LaneId;
  /** Which take the take lane plays; null when the shot has none. */
  take: string | null;
  layout: LayoutId;
  time: number;
  /** The span the user shift-dragged on the timeline, or null. */
  range: [number, number] | null;
}

/**
 * Where the whole viewer is: which stage is open, what that stage has in
 * focus, and — for the two stages that show the player — the player's own
 * position. One value answers the user's click, `navigate-to` and
 * `get-player-state`, so the screen and the report cannot drift apart.
 */
export interface ViewPosition {
  stage: StageId;
  /** Script stage: the scene id in focus. */
  scene: string | null;
  /** Bible stage: the character / set card in focus. */
  character: string | null;
  set: string | null;
  /** Sound stage: the line in focus. */
  line: string | null;
  /** Cut stage: the segment in focus, named by its shot id. */
  segment: string | null;
  /** Seconds on the CUT's clock — a different film from the shot's. */
  cutTime: number;
  player: PlayerPosition;
}

// ── Lanes ───────────────────────────────────────────────────────────────────

/** `video` plays, `image` is a still; the rest are named states. */
export type LaneKind = "video" | "image" | "waiting" | "failed" | "empty";

export interface LaneView {
  id: LaneId;
  label: string;
  kind: LaneKind;
  /** Shot-relative media path, or null when there is nothing to play. */
  file: string | null;
  /** What ffprobe measured, for the lane header. */
  facts: string;
  /** Measured duration in seconds; null when unknown (falls back to the spec). */
  duration: number | null;
  /** Why this lane is waiting or failed. */
  note: string | null;
  /** The take this lane plays, when it is the take lane. */
  takeId: string | null;
  /** Cache buster for the lane's URL. */
  revision: number;
}

/** `854×480 · 24 fps · 193 f · 8.04 s` — measured, never ordered. */
export function probeFacts(probe: Probe | null): string {
  if (!probe) return "no probe recorded";
  const parts: string[] = [];
  if (probe.width && probe.height) parts.push(`${probe.width}×${probe.height}`);
  if (probe.fps) parts.push(`${round(probe.fps, 2)} fps`);
  if (probe.frames) parts.push(`${probe.frames} f`);
  // Always the measured duration. An 8.04 s take next to an 8.00 s greybox is
  // exactly the mismatch the player has to clamp, and a header that hid it
  // whenever it agreed with frames ÷ fps would hide it in that case too.
  if (probe.seconds !== null) parts.push(`${probe.seconds.toFixed(2)} s`);
  return parts.length > 0 ? parts.join(" · ") : "no probe recorded";
}

/** `take-01` → `Take 01`. */
export function takeLabel(id: string): string {
  const match = id.match(/^take-(\d+)$/);
  return match ? `Take ${match[1]}` : id;
}

function takeLane(take: Take | null, greyboxRevision: number): LaneView {
  if (!take) {
    return {
      id: "take",
      label: "Take",
      kind: "empty",
      file: null,
      facts: "nothing generated yet",
      duration: null,
      note: "No take has been generated from this greybox.",
      takeId: null,
      revision: greyboxRevision,
    };
  }
  const label = takeLabel(take.id);
  if (take.status === "submitted") {
    const cost = take.cost ? ` · about $${take.cost.usd.toFixed(2)}` : "";
    return {
      id: "take",
      label,
      kind: "waiting",
      file: null,
      facts: `${take.resolution || "?"} · ${take.seconds ?? "?"} s${cost}`,
      duration: null,
      note: take.fix
        ? `Submitted to ${take.model || "the model"} to fix: ${take.fix}`
        : `Submitted to ${take.model || "the model"}; waiting for the result.`,
      takeId: take.id,
      revision: greyboxRevision,
    };
  }
  if (take.status === "failed" || !take.file) {
    return {
      id: "take",
      label,
      kind: "failed",
      file: null,
      facts: take.requestId ? `request ${take.requestId}` : "no request id recorded",
      duration: null,
      note: take.error ?? take.note ?? "The request failed; no file was written.",
      takeId: take.id,
      revision: greyboxRevision,
    };
  }
  return {
    id: "take",
    label,
    kind: "video",
    file: take.file,
    facts: probeFacts(take.probe),
    duration: take.probe?.seconds ?? null,
    note: null,
    takeId: take.id,
    revision: take.greyboxRevision ?? greyboxRevision,
  };
}

/**
 * The lanes this shot has, in story order.
 *
 * Reference appears ONLY when the shot has one (a recreate shot) and the
 * board ONLY when one was drawn — a named empty lane for either would cost
 * the comparison half its width on every shot that has neither. Greybox and
 * take are always present, as a named empty lane when their file is not there
 * yet, because those two are what the whole mode is about.
 */
export function laneViews(shot: Shot, takeId: string | null): LaneView[] {
  const lanes: LaneView[] = [];
  const revision = shot.greybox.revision;

  if (shot.reference) {
    const ref = shot.reference;
    const segment =
      ref.in !== null && ref.out !== null
        ? `${ref.in.toFixed(2)}–${ref.out.toFixed(2)} s of ${ref.sourceName ?? "the source"}`
        : (ref.sourceName ?? "the source");
    lanes.push({
      id: "reference",
      label: "Reference",
      kind: "video",
      file: ref.file,
      facts: `${probeFacts(ref.probe)} · ${segment}`,
      duration: ref.probe?.seconds ?? null,
      note: ref.cuts.length > 0 ? `${ref.cuts.length} cut(s) detected inside the segment` : null,
      takeId: null,
      revision,
    });
  }

  if (shot.board) {
    lanes.push({
      id: "board",
      label: "Board",
      // A still, on the same clock as everything else: it simply does not
      // move, which is exactly what a storyboard frame is.
      kind: "image",
      file: shot.board.file,
      facts: shot.board.refs.length > 0 ? `${shot.board.refs.length} reference(s)` : "board frame",
      duration: null,
      note: shot.board.prompt || null,
      takeId: null,
      revision: shot.board.revision,
    });
  }

  const final = shot.greybox.final;
  lanes.push(
    final
      ? {
          id: "greybox",
          label: "Greybox",
          kind: "video",
          file: final.file,
          facts: `${probeFacts(final.probe)} · rev ${final.revision}`,
          duration: final.probe?.seconds ?? null,
          note: null,
          takeId: null,
          revision: final.revision,
        }
      : {
          id: "greybox",
          label: "Greybox",
          kind: "empty",
          file: null,
          facts: "not rendered yet",
          duration: null,
          note: "No greybox has been rendered for this shot.",
          takeId: null,
          revision,
        },
  );

  const take = takeId ? (shot.takes.find((t) => t.id === takeId) ?? null) : selectedTake(shot);
  lanes.push(takeLane(take, revision));
  return lanes;
}

/**
 * Which lanes a layout actually shows.
 *
 * `side` shows every lane the shot has; the two-up layouts show the A/B pair
 * the user picked; `solo` shows A alone.
 */
export function visibleLanes(
  lanes: ReadonlyArray<LaneView>,
  layout: LayoutId,
  laneA: LaneId,
  laneB: LaneId,
): LaneView[] {
  if (layout === "side") return [...lanes];
  const a = lanes.find((l) => l.id === laneA) ?? lanes[0];
  if (layout === "solo") return a ? [a] : [];
  const b = lanes.find((l) => l.id === laneB) ?? lanes.find((l) => l.id !== a?.id) ?? null;
  return [a, b].filter((l): l is LaneView => l != null);
}

/** A pair that always names two DIFFERENT existing lanes. */
export function defaultPair(lanes: ReadonlyArray<LaneView>): { a: LaneId; b: LaneId } {
  const ids = lanes.map((l) => l.id);
  const a = ids.includes("greybox") ? "greybox" : (ids[0] ?? "greybox");
  const b = ids.find((id) => id !== a) ?? a;
  return { a, b };
}

// ── Checks ──────────────────────────────────────────────────────────────────

/** The lane and take a check's `target` names (`greybox`, `take-01`). */
export function laneOfTarget(target: string): { lane: LaneId; take: string | null } {
  if (target === "reference") return { lane: "reference", take: null };
  if (target === "greybox") return { lane: "greybox", take: null };
  return { lane: "take", take: target };
}

/** Failed checks that have a range — the red spans on the timeline's track. */
export function failedRanges(
  checks: ReadonlyArray<Check>,
): Array<{ id: string; label: string; from: number; to: number; target: string }> {
  return checks
    .filter((c) => c.status === "fail" && c.range !== null)
    .map((c) => ({ id: c.id, label: c.label, from: c.range![0], to: c.range![1], target: c.target }));
}

// ── Timeline geometry ───────────────────────────────────────────────────────

/** Row order on the timeline, densest first. Empty rows are not drawn. */
export const BEAT_ROW_ORDER: ReadonlyArray<BeatKind> = ["action", "trigger", "camera", "hold"];

export interface BeatRow {
  kind: BeatKind;
  beats: Beat[];
}

export function beatRows(beats: ReadonlyArray<Beat>): BeatRow[] {
  return BEAT_ROW_ORDER.map((kind) => ({
    kind,
    beats: beats.filter((b) => b.kind === kind).sort((a, b) => a.from - b.from),
  })).filter((row) => row.beats.length > 0);
}

/**
 * Trigger beats and the beat that caused them, with both rows resolved.
 *
 * The connector is drawn from the cause's END to the trigger's START — the
 * direction the order rule reads in (invariant 5).
 */
export interface BeatLink {
  triggerId: string;
  causeId: string;
  fromTime: number;
  toTime: number;
  fromRow: number;
  toRow: number;
}

export function beatLinks(rows: ReadonlyArray<BeatRow>): BeatLink[] {
  const where = new Map<string, { row: number; beat: Beat }>();
  rows.forEach((row, index) => {
    for (const beat of row.beats) where.set(beat.id, { row: index, beat });
  });
  const links: BeatLink[] = [];
  for (const [, entry] of where) {
    const { beat, row } = entry;
    if (!beat.causedBy) continue;
    const cause = where.get(beat.causedBy);
    if (!cause) continue;
    links.push({
      triggerId: beat.id,
      causeId: cause.beat.id,
      fromTime: cause.beat.to,
      toTime: beat.from,
      fromRow: cause.row,
      toRow: row,
    });
  }
  return links.sort((a, b) => a.fromTime - b.fromTime);
}

// ── Tempo ───────────────────────────────────────────────────────────────────

/** One drawn stretch of the tempo row, already clamped to the shot. */
export interface TempoSpan {
  from: number;
  to: number;
  factor: number;
  /** `½×`, `2×` — what the row prints. */
  label: string;
  /** Slow motion reads differently from a speed-up, so it is coloured apart. */
  slow: boolean;
}

/** `0.5` → `½×`, `2` → `2×`, `1.25` → `1.25×`. */
export function formatFactor(factor: number): string {
  const VULGAR: Record<string, string> = { "0.5": "½", "0.25": "¼", "0.75": "¾", "0.33": "⅓" };
  const key = String(round(factor, 2));
  if (VULGAR[key]) return `${VULGAR[key]}×`;
  return `${round(factor, 2)}×`;
}

/**
 * The tempo row's spans: `scene.meta.json`'s `time_warp` clamped to the shot.
 *
 * A warp entirely outside the shot is dropped rather than pinned to an edge —
 * a zero-width block at 0 s would claim a ramp that is not in the render. A
 * factor of exactly 1 is also dropped: it remaps nothing, and a row that
 * draws "1×" invites the reading that everything else is not.
 */
export function tempoSpans(
  warps: ReadonlyArray<{ from: number; to: number; factor: number }>,
  duration: number,
): TempoSpan[] {
  const spans: TempoSpan[] = [];
  for (const warp of warps) {
    if (warp.factor === 1) continue;
    const from = clamp(warp.from, 0, duration);
    const to = clamp(warp.to, 0, duration);
    if (!(to > from)) continue;
    spans.push({
      from,
      to,
      factor: warp.factor,
      label: formatFactor(warp.factor),
      slow: warp.factor < 1,
    });
  }
  return spans.sort((a, b) => a.from - b.from);
}

/** Beat edges, sorted and de-duplicated — what `[` and `]` jump between. */
export function beatEdges(beats: ReadonlyArray<Beat>, duration: number): number[] {
  const edges = new Set<number>([0, duration]);
  for (const beat of beats) {
    edges.add(clamp(beat.from, 0, duration));
    edges.add(clamp(beat.to, 0, duration));
  }
  return [...edges].sort((a, b) => a - b);
}

/** The next edge strictly after `t`, or the last one. */
export function nextEdge(edges: ReadonlyArray<number>, t: number): number {
  const epsilon = 1e-4;
  return edges.find((e) => e > t + epsilon) ?? edges[edges.length - 1] ?? t;
}

/** The previous edge strictly before `t`, or the first one. */
export function prevEdge(edges: ReadonlyArray<number>, t: number): number {
  const epsilon = 1e-4;
  for (let i = edges.length - 1; i >= 0; i -= 1) {
    if (edges[i] < t - epsilon) return edges[i];
  }
  return edges[0] ?? t;
}

// ── Addresses ───────────────────────────────────────────────────────────────

export interface BacklotAddress {
  contentSet?: string;
  /** One of the eight pipeline stages. ABSENT MEANS `previz` — see below. */
  stage?: StageId;
  shot?: string;
  /** A scene id, or the scene NUMBER the screenplay prints. */
  scene?: string | number;
  character?: string;
  set?: string;
  lane?: LaneId;
  take?: string;
  time?: number;
  range?: [number, number];
  layout?: LayoutId;
  line?: string;
  /** A cut segment, named by the shot it plays. */
  segment?: string;
}

function isLane(value: unknown): value is LaneId {
  return typeof value === "string" && (LANE_IDS as ReadonlyArray<string>).includes(value);
}

function isLayout(value: unknown): value is LayoutId {
  return typeof value === "string" && (LAYOUT_IDS as ReadonlyArray<string>).includes(value);
}

function isStageId(value: unknown): value is StageId {
  return typeof value === "string" && (STAGES as ReadonlyArray<string>).includes(value);
}

/** Read whatever the agent sent; unknown keys and wrong types are ignored. */
export function parseAddress(raw: unknown): BacklotAddress {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const address: BacklotAddress = {};
  const text = (key: string): string | undefined => {
    const value = source[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  if (text("contentSet") !== undefined) address.contentSet = text("contentSet");
  if (isStageId(source.stage)) address.stage = source.stage;
  if (text("shot") !== undefined) address.shot = text("shot");
  if (text("character") !== undefined) address.character = text("character");
  if (text("set") !== undefined) address.set = text("set");
  if (text("line") !== undefined) address.line = text("line");
  if (text("segment") !== undefined) address.segment = text("segment");
  if (text("scene") !== undefined) address.scene = text("scene");
  else if (typeof source.scene === "number" && Number.isFinite(source.scene)) {
    address.scene = source.scene;
  }
  if (isLane(source.lane)) address.lane = source.lane;
  if (text("take") !== undefined) address.take = text("take");
  if (typeof source.time === "number" && Number.isFinite(source.time)) address.time = source.time;
  if (isLayout(source.layout)) address.layout = source.layout;
  if (Array.isArray(source.range) && source.range.length >= 2) {
    const from = source.range[0];
    const to = source.range[1];
    if (typeof from === "number" && typeof to === "number" && Number.isFinite(from) && Number.isFinite(to)) {
      address.range = from <= to ? [from, to] : [to, from];
    }
  }
  return address;
}

export type AddressOutcome =
  | {
      ok: true;
      contentSet: string;
      /** The content set to activate, or null when it is already active. */
      switchTo: string | null;
      position: ViewPosition;
    }
  | { ok: false; message: string };

export interface AddressContext {
  /** The content set currently active. */
  contentSet: string;
  projects: Record<string, Project>;
  /** Every content-set prefix the store knows about. */
  contentSets: ReadonlyArray<string>;
  position: ViewPosition;
}

/**
 * Resolve an address against the film. Validated IN FULL before anything
 * moves: a refusal that had already switched the project would leave the
 * viewer somewhere the answer does not describe.
 *
 * AN ADDRESS WITH NO `stage` IS A PREVIZ ADDRESS. Every address written
 * before the film grew its other seven stages named a shot, a lane and a
 * moment, and those all still land where they always did.
 */
export function resolveAddress(ctx: AddressContext, address: BacklotAddress): AddressOutcome {
  let contentSet = ctx.contentSet;
  let switchTo: string | null = null;
  if (address.contentSet !== undefined && address.contentSet !== contentSet) {
    if (!ctx.projects[address.contentSet] && !ctx.contentSets.includes(address.contentSet)) {
      const known = Object.keys(ctx.projects).map((p) => p || "(root)").join(", ") || "none";
      return {
        ok: false,
        message: `There is no project "${address.contentSet}" in this workspace. Projects here: ${known}.`,
      };
    }
    contentSet = address.contentSet;
    switchTo = address.contentSet;
  }

  const project = ctx.projects[contentSet];
  if (!project) {
    return { ok: false, message: `Project "${contentSet || "(root)"}" has no backlot.json loaded yet.` };
  }

  const stage: StageId = address.stage ?? "previz";
  const samePlace = switchTo === null;

  // ── The shot ────────────────────────────────────────────────────────────
  // A named shot must exist. An inherited one that does not (a stale
  // position after a project switch) is replaced by the first shot rather
  // than refused: the user asked for a stage, not for that shot.
  const named = address.shot;
  if (named !== undefined && !project.shots.some((s) => s.id === named)) {
    const known = project.shots.map((s) => s.id).join(", ") || "none";
    return {
      ok: false,
      message: `There is no shot "${named}" in "${project.title}". Shots here: ${known}.`,
    };
  }
  const inherited = samePlace ? ctx.position.player.shot : "";
  const shot =
    project.shots.find((s) => s.id === (named ?? inherited)) ?? project.shots[0] ?? null;
  const sameShot = shot !== null && shot.id === ctx.position.player.shot && samePlace;

  // ── The fine keys, each refused BY NAME ─────────────────────────────────
  let scene = samePlace ? ctx.position.scene : null;
  if (address.scene !== undefined) {
    const wanted = address.scene;
    const match = project.scenes.find((s) =>
      typeof wanted === "number" ? s.number === wanted : s.id === wanted || s.number === Number(wanted),
    );
    if (!match) {
      const known = project.scenes.map((s) => `${s.number}:${s.id}`).join(", ") || "none";
      return {
        ok: false,
        message: `There is no scene "${wanted}" in "${project.title}". Scenes here: ${known}.`,
      };
    }
    scene = match.id;
  }

  let character = samePlace ? ctx.position.character : null;
  if (address.character !== undefined) {
    if (!project.characters.some((c) => c.id === address.character)) {
      const known = project.characters.map((c) => c.id).join(", ") || "none";
      return {
        ok: false,
        message: `There is no character "${address.character}" in the bible. Characters here: ${known}.`,
      };
    }
    character = address.character;
  }

  let set = samePlace ? ctx.position.set : null;
  if (address.set !== undefined) {
    if (!project.sets.some((s) => s.id === address.set)) {
      const known = project.sets.map((s) => s.id).join(", ") || "none";
      return {
        ok: false,
        message: `There is no set "${address.set}" in the bible. Sets here: ${known}.`,
      };
    }
    set = address.set;
  }

  let line = samePlace ? ctx.position.line : null;
  if (address.line !== undefined) {
    if (!project.sound.lines.some((l) => l.id === address.line)) {
      const known = project.sound.lines.map((l) => l.id).join(", ") || "none";
      return {
        ok: false,
        message: `There is no line "${address.line}" in this film. Lines here: ${known}.`,
      };
    }
    line = address.line;
  }

  let segment = samePlace ? ctx.position.segment : null;
  if (address.segment !== undefined) {
    const match = project.cut?.segments.find((s) => s.shot === address.segment);
    if (!match) {
      const known = project.cut?.segments.map((s) => s.shot).join(", ") || "none";
      return {
        ok: false,
        message: `The cut has no segment for "${address.segment}". Segments here: ${known}.`,
      };
    }
    segment = match.shot;
  }

  // ── The player ──────────────────────────────────────────────────────────
  let take = sameShot ? ctx.position.player.take : (shot ? selectedTake(shot)?.id ?? null : null);
  let lane: LaneId = address.lane ?? (sameShot ? ctx.position.player.lane : "greybox");

  if (address.take !== undefined) {
    if (!shot || !shot.takes.some((t) => t.id === address.take)) {
      const known = shot?.takes.map((t) => t.id).join(", ") || "none";
      return {
        ok: false,
        message: `Shot "${shot?.id ?? "(none)"}" has no take "${address.take}". Takes here: ${known}.`,
      };
    }
    take = address.take;
    // Naming a take means "show me that take" — asking for one and landing
    // on the greybox would be an answer nobody can act on.
    if (address.lane === undefined) lane = "take";
  } else if (shot && (take === null || !shot.takes.some((t) => t.id === take))) {
    take = selectedTake(shot)?.id ?? null;
  }

  // A lane the shot does not have is not a refusal — the address is legal,
  // the shot simply has no reference — but the player must not claim to show
  // it, so it falls back to the greybox and the report says where it landed.
  if (lane === "reference" && !shot?.reference) lane = "greybox";
  if (lane === "board" && !shot?.board) lane = "greybox";

  // ── Time: two clocks, and the stage decides which one is meant ──────────
  const duration = shot?.spec.seconds ?? 0;
  const cutSeconds = project.cut?.seconds ?? 0;
  const onCut = stage === "cut";
  const inheritedTime = sameShot ? ctx.position.player.time : 0;
  const time = onCut
    ? inheritedTime
    : clamp(address.time ?? inheritedTime, 0, Math.max(duration, 0));
  let cutTime = samePlace ? ctx.position.cutTime : 0;
  if (onCut && address.time !== undefined) cutTime = clamp(address.time, 0, Math.max(cutSeconds, 0));
  // Naming a segment lands the cut's playhead where that segment starts,
  // unless the caller also named the second they meant.
  if (segment !== null && address.segment !== undefined && address.time === undefined) {
    const match = project.cut?.segments.find((s) => s.shot === segment);
    if (match) cutTime = match.offset;
  }

  const range =
    address.range !== undefined
      ? ([clamp(address.range[0], 0, duration), clamp(address.range[1], 0, duration)] as [number, number])
      : sameShot
        ? ctx.position.player.range
        : null;

  return {
    ok: true,
    contentSet,
    switchTo,
    position: {
      stage,
      scene,
      character,
      set,
      line,
      segment,
      cutTime,
      player: {
        shot: shot?.id ?? "",
        lane,
        take,
        layout: address.layout ?? ctx.position.player.layout,
        time,
        range,
      },
    },
  };
}

/**
 * The lane and layout a stage opens on when you ARRIVE at it.
 *
 * Previz and Takes are the same player pointed at two different questions:
 * previz asks "is the blocking right", so it opens on the greybox with every
 * lane side by side; takes asks "did the model keep it", so it opens with the
 * take wiped over the greybox. Naming a lane or a layout in the address wins
 * — an explicit request is never overridden by a default — and staying on
 * the stage you are already on changes nothing.
 */
export function withStageDefaults(
  next: ViewPosition,
  fromStage: StageId,
  address: BacklotAddress,
): ViewPosition {
  if (next.stage === fromStage) return next;
  if (next.stage === "takes") {
    return {
      ...next,
      player: {
        ...next.player,
        lane: address.lane ?? "take",
        layout: address.layout ?? "wipe",
      },
    };
  }
  if (next.stage === "previz") {
    return {
      ...next,
      player: {
        ...next.player,
        lane: address.lane ?? "greybox",
        layout: address.layout ?? "side",
      },
    };
  }
  return next;
}

/** The A/B pair a stage opens with, when the shot has both lanes. */
export function stagePair(stage: StageId, lanes: ReadonlyArray<LaneView>): { a: LaneId; b: LaneId } {
  const ids = lanes.map((l) => l.id);
  if (stage === "takes" && ids.includes("take") && ids.includes("greybox")) {
    return { a: "take", b: "greybox" };
  }
  return defaultPair(lanes);
}

/**
 * The address the viewer reports back for where it is now.
 *
 * Only the keys that MEAN something on the open stage are included: a bible
 * card has no playhead, and a cut has no lane. The block the agent reads and
 * the address it can send back are therefore the same vocabulary.
 */
export function positionAddress(
  contentSet: string,
  position: ViewPosition,
  spec: Shot["spec"] | null,
): Record<string, unknown> {
  const address: Record<string, unknown> = {};
  if (contentSet) address.contentSet = contentSet;
  address.stage = position.stage;
  const { player } = position;

  switch (position.stage) {
    case "script":
      if (position.scene) address.scene = position.scene;
      break;
    case "bible":
      if (position.character) address.character = position.character;
      if (position.set) address.set = position.set;
      break;
    case "boards":
      if (player.shot) address.shot = player.shot;
      break;
    case "previz":
    case "takes":
      if (player.shot) address.shot = player.shot;
      address.lane = player.lane;
      if (player.take) address.take = player.take;
      address.time = round(player.time, 3);
      if (spec) address.frame = frameAt(player.time, spec);
      address.layout = player.layout;
      if (player.range) address.range = [round(player.range[0], 3), round(player.range[1], 3)];
      break;
    case "sound":
      if (position.line) address.line = position.line;
      break;
    case "cut":
      if (position.segment) address.segment = position.segment;
      address.time = round(position.cutTime, 3);
      break;
    default:
      break;
  }
  return address;
}

// ── Prose ───────────────────────────────────────────────────────────────────

/**
 * The fenced ```prompt block from `prompts.md` — the exact text the video
 * model receives, and the only part of the pack worth a copy button.
 */
export function extractPromptBlock(markdown: string): string | null {
  const match = markdown.match(/```prompt[^\n]*\n([\s\S]*?)```/);
  return match ? match[1].trimEnd() : null;
}

// ── Formatters ──────────────────────────────────────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * The largest box of `aspect` that fits inside `boxW × boxH`.
 *
 * The 3D lane's Shot-camera mode letterboxes to the SHOT's aspect so the
 * framing matches the MP4 beside it; a canvas stretched to the pane would
 * show a wider or taller view of the same scene and quietly disprove the
 * comparison the lane exists for.
 */
export function fitBox(
  boxW: number,
  boxH: number,
  aspect: number,
): { width: number; height: number } {
  if (!(boxW > 0) || !(boxH > 0) || !(aspect > 0)) return { width: 0, height: 0 };
  const width = Math.min(boxW, boxH * aspect);
  return { width: Math.round(width), height: Math.round(width / aspect) };
}

/** Chrome the Side layout has to pay for, in CSS px. */
export interface SideChrome {
  /** `p-2` on the player box, both sides. */
  padding: number;
  /** `gap-2` between two cards. */
  gap: number;
  /** A lane card's two-row header. */
  header: number;
}

export interface SidePlan {
  direction: "row" | "column";
  /** Card width when stacked; null in a row, where flex-1 divides the width. */
  laneWidth: number | null;
}

/**
 * Does Side lay its lanes out in a row or a column, and how wide is a card?
 *
 * Whichever makes each lane BIGGER — the comparison the layout exists for is
 * the one you can see. Measured 2026-09-20 in a 1800×1172 window: with the
 * chat panel open the player is 680×700 and three 16:9 cards in a row are
 * 216 px across while the same three stacked are 314; collapse the chat and
 * the player is 1240×700, where a row gives 403 and a stack still 314. So the
 * answer flips with the pane, and it has to be computed rather than chosen.
 *
 * Stacked cards are sized by HEIGHT: three aspect-ratio boxes at `w-full`
 * would be taller than the pane and push the last one out of view.
 */
export function planSideLayout(
  boxW: number,
  boxH: number,
  aspect: number,
  count: number,
  chrome: SideChrome,
): SidePlan {
  if (count <= 1 || !(boxW > 0) || !(boxH > 0) || !(aspect > 0)) {
    return { direction: "row", laneWidth: null };
  }
  const innerW = boxW - chrome.padding;
  const innerH = boxH - chrome.padding;
  const asRow = Math.min(
    (innerW - chrome.gap * (count - 1)) / count,
    Math.max(0, innerH - chrome.header) * aspect,
  );
  const stacked = Math.min(
    innerW,
    Math.max(0, (innerH - chrome.gap * (count - 1)) / count - chrome.header) * aspect,
  );
  if (stacked > asRow) {
    return { direction: "column", laneWidth: Math.max(160, Math.round(stacked)) };
  }
  return { direction: "row", laneWidth: null };
}

/** `3.8` → `03.80` — a fixed-width readout that does not jump while playing. */
export function formatSeconds(t: number): string {
  return t.toFixed(2).padStart(5, "0");
}

/** `03.80 s · f 92 / 192` */
export function playheadLabel(t: number, spec: Shot["spec"]): string {
  return `${formatSeconds(t)} s · f ${frameAt(t, spec)} / ${spec.frames}`;
}

/** The project the viewer should show for a content set. */
export function selectProject(film: Film | null, contentSet: string | null | undefined): Project | null {
  if (!film) return null;
  if (contentSet != null && film.projects[contentSet]) return film.projects[contentSet];
  const first = Object.keys(film.projects).sort()[0];
  return first === undefined ? null : film.projects[first];
}
