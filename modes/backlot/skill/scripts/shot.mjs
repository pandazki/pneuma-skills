/**
 * shot.mjs — what `backlot.json` and `shot.json` mean.
 *
 * `previz.mjs` is the only writer of those two files; this module is the only
 * place that decides what they may contain and what they imply. Everything
 * here is PURE: plain data in, plain data out, no file system, no clock, no
 * child process. The invariants the mode is built on live here so a test can
 * exercise them without a render:
 *
 *  3. Frame arithmetic is exact — `makeSpec` refuses a seconds x fps that is
 *     not a whole number of frames, so `render`'s refusal can never be the
 *     first time anybody notices.
 *  4. Nothing is "passed" unseen — a check nobody looked at stays
 *     `unverified`, and `summarizeChecks` reports unverified SEPARATELY from
 *     fail, so "not accepted" can never read as "one small failure".
 *  5. Cause before effect — a trigger beat names a cause that exists, starts
 *     no later than the trigger, and is not itself downstream of the trigger.
 *  6. Paid work is submitted once — `takePolicy` is the gate, and it answers
 *     from the recorded takes rather than from the agent's memory.
 *  7. The same defect twice stops the loop — `computeStuck` reads the check
 *     history, not the last render.
 */

export const SHOT_VERSION = 1;
export const PROJECT_VERSION = 1;

export const ENTRIES = ["original", "recreate"];
/**
 * HOW THIS SHOT IS CONDITIONED — decided per shot, in the shot plan.
 *
 * Round 3's eight-take run (2026-09-21 night) was consistent and had no
 * 亮点: every shot was locked off, the pawns barely moved, and the climax
 * was four near-identical inserts with the exchange itself elided. The
 * control test the same night — the same exchange shot FREE, with the
 * sheets and the style frame and a dynamic prompt — came back with a real
 * fight. The greybox is a tool, not the film:
 *
 *  - `greybox` — space, geography or a camera move the model cannot do
 *    alone (the establishing orbit, the crane, the dolly zoom, the geometric
 *    "one inch"). `@Video1` is attached and the prompt inherits its layout
 *    and camera.
 *  - `free` — the fight beats and the charm beats. No `@Video1`: the
 *    references are the character sheets and the style frame, and the prompt
 *    is written for spectacle. A greybox may still exist for the reel and
 *    for continuity of positions, but it is not sent.
 *  - `hybrid` — `@Video1` for positions and the camera path, with the prompt
 *    explicitly allowing dynamic body action and camera acceleration inside
 *    that layout.
 *
 * `greybox` is the default, and the value a file written before this
 * existed is read as.
 */
export const CONDITIONINGS = ["greybox", "free", "hybrid"];
export const DEFAULT_CONDITIONING = "greybox";
export const BEAT_KINDS = ["action", "trigger", "camera", "hold"];
export const CHECK_STATUSES = ["pass", "fail", "unverified"];
export const TAKE_STATUSES = ["submitted", "done", "failed"];
/**
 * A line is spoken ON SCREEN or it is voice-over, and the two are made by
 * different machines: a `spoken` line is rendered by the video model (the
 * take carries the text and the character's voice sample, and the take is
 * checked against a transcript), a `vo` line is a TTS file the cut mixes in.
 * Laying TTS over a mouth the model animated is the lip-sync failure these
 * two kinds exist to prevent.
 */
export const LINE_KINDS = ["spoken", "vo"];

export const DEFAULT_SPEC = { seconds: 8, fps: 24, width: 1280, height: 720 };

/**
 * Upstream's acceptance list, as this mode records it.
 *
 * `target` is what the check is about, not a shot-specific id: `greybox`
 * checks are seeded by `shot add` / `checklist`, and the `take` ones are
 * seeded against a take's id the moment that take finishes, so a take can
 * never be delivered with an empty acceptance record.
 */
export const STANDARD_CHECKS = {
  greybox: [
    { id: "frame-count", label: "The render is exactly the spec's frame count at the spec's fps" },
    { id: "blocking", label: "Every subject is where the plan says, facing what it says, at the second it says" },
    { id: "pace", label: "Subjects cover their distances at a speed a body can move at" },
    { id: "framing", label: "The subject, the prop and the reaction are in frame when the shot is about them" },
    { id: "penetration", label: "Nothing passes through anything: figure/prop, figure/wall, prop/prop" },
    { id: "trigger-order", label: "No effect starts before its cause" },
    { id: "camera-smooth", label: "The camera move has no jitter and no overshoot" },
    { id: "end-hold", label: "The last half second is settled unless the user asked for motion" },
  ],
  take: [
    { id: "take-motion", label: "The person follows the greybox's path and timing and performs the prompted action" },
    { id: "take-body", label: "The body moves naturally: real steps, no gliding, no stiff or extra limbs in motion" },
    { id: "take-camera", label: "The take keeps the greybox's camera move" },
    { id: "take-order", label: "The take keeps cause before effect" },
    { id: "take-integrity", label: "One person, whole limbs, no invented cut, no captions" },
  ],
  reference: [
    { id: "ref-framing", label: "The greybox frames the subject the way the reference does" },
    { id: "ref-timing", label: "The greybox's beats land when the reference's do" },
  ],
  /**
   * Only seeded when the shot has a line spoken ON SCREEN. Its evidence is
   * a `transcribe.mjs` transcript stored beside the take, so "the model said
   * the line" is measured rather than remembered — and a shot with no spoken
   * line never carries a check nobody can answer.
   */
  lines: [{ id: "take-lines", label: "Spoken lines are audible and correct" }],
  /**
   * Only seeded when the shot DECLARES a hand-off (`continuity.from`). A cut
   * that deliberately breaks continuity — an ellipsis, a jump cut, a montage
   * — must not carry a check that says it failed; and a shot that claims one
   * continuous action seen from a new camera has to be looked at frame 1
   * against the frame it continues. `compare --handoff` is the picture that
   * answers it.
   */
  handoff: [
    {
      id: "take-handoff",
      label: "First frame continues the previous shot's last used frame — positions, facing, weapons, action",
    },
  ],
};

/**
 * The two take checks whose SUBJECT is the greybox, reworded for a shot that
 * never sends one.
 *
 * A `free` take has no block to be compared against, and "does it keep the
 * greybox's camera" is then a question nobody can answer — it would sit
 * `unverified` forever and block `select`. What a free take IS answerable
 * against is the plan: the beats and their seconds, and the camera sentence
 * the pack was written from.
 */
const FREE_TAKE_LABELS = {
  "take-motion": "The person follows the PLAN's beats and their seconds and performs the prompted action",
  "take-camera": "The camera follows the plan's camera sentence — the move, its speed and where it ends",
};

/** The take acceptance list this conditioning carries. */
export function takeChecks(conditioning = DEFAULT_CONDITIONING) {
  if (conditioning !== "free") return STANDARD_CHECKS.take;
  return STANDARD_CHECKS.take.map((check) =>
    FREE_TAKE_LABELS[check.id] ? { ...check, label: FREE_TAKE_LABELS[check.id] } : check,
  );
}

/** How this shot is conditioned, defaulting a file that predates the field
 *  — or one somebody hand-edited — to `greybox`. */
export function conditioningOf(shot) {
  const value = shot?.conditioning;
  return CONDITIONINGS.includes(value) ? value : DEFAULT_CONDITIONING;
}

/** Whether the greybox is SENT to the model for this shot. `hybrid` sends it
 *  exactly as `greybox` does; only `free` does not. */
export function usesGreybox(shot) {
  return conditioningOf(shot) !== "free";
}

// ---------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------

/**
 * A validated shot spec with its frame count filled in.
 *
 * Refuses a duration whose frame count is not whole: 7.9 s at 24 fps is
 * 189.6 frames, and every downstream step — the Blender range, the PNG
 * sequence, the ffprobe check, the viewer's playhead — would have to pick a
 * rounding of its own. One refusal here beats four silent disagreements.
 */
export function makeSpec(input = {}, defaults = DEFAULT_SPEC) {
  const seconds = numberOf(input.seconds ?? defaults.seconds, "seconds", { min: 0.04 });
  const fps = numberOf(input.fps ?? defaults.fps, "fps", { min: 1, integer: true });
  const width = numberOf(input.width ?? defaults.width, "width", { min: 16, integer: true });
  const height = numberOf(input.height ?? defaults.height, "height", { min: 16, integer: true });
  const exact = seconds * fps;
  const frames = Math.round(exact);
  if (Math.abs(exact - frames) > 1e-6) {
    // `exact` is rounded for the message only: 7.9 x 24 is 189.60000000000002
    // in binary floating point, and a refusal nobody can read is a refusal
    // nobody acts on.
    throw new Error(
      `${seconds} s at ${fps} fps is ${round4(exact)} frames, which is not whole — ` +
        `use ${round4(frames / fps)} s (${frames} frames) or change the fps`,
    );
  }
  return { seconds: round4(seconds), fps, width, height, frames };
}

/** "1280x720" → { width, height }. Throws naming the flag. */
export function parseSize(value, label = "--size") {
  const match = /^\s*(\d+)\s*[xX*]\s*(\d+)\s*$/.exec(String(value));
  if (!match) throw new Error(`${label} must look like 1280x720 (got: ${value})`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** A shot id that is safe as a directory name and stable in a URL. */
export function slugId(text, label = "shot id") {
  const slug = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  if (!slug) throw new Error(`${label}: "${text}" has no letters or digits to make an id from`);
  return slug;
}

// ---------------------------------------------------------------------------
// New files
// ---------------------------------------------------------------------------

/**
 * A new `backlot.json`.
 *
 * Only APPROVALS are stored, never statuses: a stage's status is derived
 * from the files that define it (`stage-state.mjs`), so the viewer and the
 * scripts can never disagree about what the creator has seen. `gates` starts
 * `"closed"` — the creator approves each stage before the next one spends.
 */
export function newProject({ title, logline = "", defaults }) {
  return {
    version: PROJECT_VERSION,
    title: String(title),
    logline: String(logline ?? ""),
    defaults: specDefaults(defaults),
    gates: "closed",
    approvals: {},
    scenes: [],
    characters: [],
    sets: [],
    shots: [],
  };
}

/**
 * The sub-range of this shot the CUT uses, validated against its spec.
 *
 * A shot is not always shown whole. A three-angle collage of one 1.2 s
 * strike needs three takes of at least Seedance's four-second floor, and the
 * film shows ~1.2 s of each. The greybox, the take and the beats stay on the
 * SHOT's clock — the trim only says which part of it reaches the film — so
 * everything already recorded about the shot keeps its meaning.
 *
 * `0 <= in < out <= spec.seconds`. Throws naming the flag.
 */
export function makeTrim({ in: start, out: end }, spec) {
  const seconds = Number(spec?.seconds);
  const from = Number(start);
  const to = Number(end);
  if (!Number.isFinite(from) || from < 0) throw new Error(`--trim-in must be a second from 0 (got: ${start})`);
  if (!Number.isFinite(to)) throw new Error(`--trim-out must be a second on the shot's clock (got: ${end})`);
  if (Number.isFinite(seconds) && to > seconds + 1e-6) {
    throw new Error(`--trim-out ${to} is past the shot's ${seconds} s — the cut can only use time the shot has`);
  }
  if (to <= from + 1e-6) throw new Error(`--trim-out ${to} must be later than --trim-in ${from} — a segment of no length is not a segment`);
  return { in: round4(from), out: round4(to) };
}

/**
 * The hand-off this shot declares, validated against the film's shot order.
 *
 * Hand-off is OPT-IN, and it serves the expression: some cuts exist to BREAK
 * continuity — an ellipsis, a jump cut, a montage, a deliberate mismatch — and
 * a shot without a `continuity` block is generated exactly as it was before
 * this existed. A shot that declares one is saying "this is one continuous
 * action seen from a new camera", and everything downstream (the hand-off
 * frame, the `take-handoff` check, the entry line in the prompt) follows from
 * that claim.
 *
 * `from` must be an EARLIER shot in `backlot.json`'s order — contiguous shots
 * are shot in order, so the frame this one opens on has to exist already.
 * `entry` and `exit` are free text, deliberately: what "the same moment"
 * means is a sentence about bodies, weapons and facing, not a schema.
 *
 *  - `from` set   → `entry` AND `exit` are required (either given now or
 *    already on the record). The exit is what the NEXT shot picks up.
 *  - `from` null  → `exit` alone is allowed on any shot; an `entry` with
 *    nothing to continue is refused, because it describes a frame that has
 *    no predecessor.
 *
 * Returns the block, or null when nothing was declared. Throws naming the
 * flag; `previz.mjs` turns that into its one-line refusal.
 */
export function makeContinuity(input = {}, { id = null, order = null } = {}) {
  const clean = (value) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text === "" ? null : text;
  };
  const from = clean(input.from);
  const entry = clean(input.entry);
  const exit = clean(input.exit);

  if (!from) {
    if (entry) {
      throw new Error(
        '--entry describes the frame this shot OPENS on, which only means something when it continues another shot — ' +
          'pass --continues-from <shot> as well, or record how this shot ENDS with --exit "…"',
      );
    }
    // A shot with no hand-off may still say how it ends, for a later shot to
    // pick up. That is the whole point of `exit` standing alone.
    return exit ? { from: null, entry: null, exit } : null;
  }

  if (id && from === id) {
    throw new Error(`--continues-from "${from}" is this shot itself — a shot continues an EARLIER one`);
  }
  if (Array.isArray(order)) {
    const list = order.map(String);
    const there = list.indexOf(from);
    if (there === -1) {
      throw new Error(
        `--continues-from "${from}" is not a shot in this film (${list.join(", ") || "no shots registered"}) — ` +
          "add it with 'backlot.mjs shot add', or name one of those",
      );
    }
    const here = id ? list.indexOf(id) : -1;
    if (here === -1) {
      throw new Error(
        `this shot ("${id}") is not in the film's shot list (${list.join(", ") || "none"}), so "earlier" has no meaning here — ` +
          "register it with 'backlot.mjs shot add' before declaring a hand-off",
      );
    }
    if (there > here) {
      throw new Error(
        `--continues-from "${from}" comes AFTER "${id}" in the film (${list.join(", ")}) — ` +
          "a shot continues an earlier one; contiguous shots are shot in order",
      );
    }
  }
  if (!entry) {
    throw new Error(
      '--continues-from needs --entry "<the frame this shot opens on: positions, facing, weapons, distance>" — ' +
        "the model is told to open exactly there, and nothing else in the shot says where that is",
    );
  }
  if (!exit) {
    throw new Error(
      '--continues-from needs --exit "<how this shot ends, for the next one to pick up>" — ' +
        "a shot inside a continuous action owes the next shot its last frame",
    );
  }
  return { from, entry, exit };
}

export function newShot({ id, title, entry = "original", spec, assumptions = [], scene = null, characters = [], set = null }) {
  if (!ENTRIES.includes(entry)) throw new Error(`--entry must be one of ${ENTRIES.join("|")} (got: ${entry})`);
  return {
    version: SHOT_VERSION,
    id,
    title: String(title),
    // Where this shot sits in the film: its scene, the bible ids present in
    // it, and the place it happens. `generate` reads them to attach the
    // right sheets and voices, so a typo here is a reference that never
    // reaches the paid job.
    scene: scene === null || scene === undefined || scene === "" ? null : String(scene),
    characters: [...characters].map(String),
    set: set === null || set === undefined || set === "" ? null : String(set),
    entry,
    // How this shot is conditioned — a shot-plan decision, changed with
    // `previz.mjs meta --conditioning`. The greybox is the default because
    // it is the mode's practice; the plan says per shot when it is not.
    conditioning: DEFAULT_CONDITIONING,
    spec,
    assumptions: [...assumptions],
    beats: [],
    // Null means "the whole shot reaches the film".
    trim: null,
    // Null means "this shot is generated alone" — the default, and the right
    // answer for every cut that is not one continuous action.
    continuity: null,
    board: null,
    // The stills that say what this shot LOOKS like, made from the greybox
    // frame (composition and camera) plus the bible (appearance). They are
    // what the creator reviews before a video is bought, and the take's
    // @Image1.
    anchors: [],
    lines: [],
    reference: null,
    greybox: {
      revision: 0,
      script: "greybox/scene.py",
      preview: null,
      final: null,
      glb: "greybox/scene.glb",
      meta: "greybox/scene.meta.json",
      blend: "greybox/scene.blend",
      sheet: "greybox/sheet.png",
    },
    checks: [],
    stuck: [],
    prompt: { file: "prompts.md" },
    takes: [],
  };
}

/** Fill in anything an older or hand-damaged file is missing, without
 *  inventing content: every default here is "nothing recorded yet". */
export function normalizeShot(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("shot.json is not a JSON object");
  const shot = { ...doc };
  shot.beats = Array.isArray(shot.beats) ? shot.beats : [];
  shot.checks = Array.isArray(shot.checks) ? shot.checks : [];
  shot.takes = Array.isArray(shot.takes) ? shot.takes : [];
  shot.assumptions = Array.isArray(shot.assumptions) ? shot.assumptions : [];
  shot.stuck = Array.isArray(shot.stuck) ? shot.stuck : [];
  shot.scene = shot.scene ?? null;
  // A file written before conditioning existed is a greybox shot: that is
  // what it was made as, and reading it as anything else would change what
  // an old take was conditioned on.
  shot.conditioning = conditioningOf(shot);
  shot.characters = Array.isArray(shot.characters) ? shot.characters.map(String) : [];
  shot.set = shot.set ?? null;
  shot.trim = shot.trim ?? null;
  shot.continuity = shot.continuity ?? null;
  shot.board = shot.board ?? null;
  shot.anchors = Array.isArray(shot.anchors) ? shot.anchors : [];
  shot.lines = Array.isArray(shot.lines) ? shot.lines : [];
  shot.greybox = { revision: 0, preview: null, final: null, ...(shot.greybox ?? {}) };
  shot.reference = shot.reference ?? null;
  shot.prompt = shot.prompt ?? { file: "prompts.md" };
  return shot;
}

function specDefaults(input = {}) {
  const spec = makeSpec(input);
  return { seconds: spec.seconds, fps: spec.fps, width: spec.width, height: spec.height };
}

// ---------------------------------------------------------------------------
// Beats — the shot plan's timeline
// ---------------------------------------------------------------------------

/**
 * Validate a whole beat list against the spec.
 *
 * Returns the normalized list; throws with EVERY problem it found rather than
 * the first, because a hand-written beats.json usually has the same mistake
 * three times and a one-at-a-time refusal costs three round trips.
 */
export function validateBeats(beats, spec) {
  if (!Array.isArray(beats)) throw new Error("beats must be a JSON array");
  const problems = [];
  const seen = new Map();
  const normalized = [];

  beats.forEach((raw, index) => {
    const where = `beat ${index + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push(`${where}: not an object`);
      return;
    }
    let id;
    try {
      id = slugId(raw.id, `${where} id`);
    } catch (error) {
      problems.push(error.message);
      return;
    }
    if (seen.has(id)) problems.push(`${where}: duplicate id "${id}"`);
    const kind = raw.kind ?? "action";
    if (!BEAT_KINDS.includes(kind)) problems.push(`${where} "${id}": kind must be one of ${BEAT_KINDS.join("|")} (got: ${kind})`);
    const from = Number(raw.from);
    const to = Number(raw.to ?? raw.from);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      problems.push(`${where} "${id}": from and to must be seconds`);
      return;
    }
    if (from < 0) problems.push(`${where} "${id}": from ${from} is before the shot starts`);
    if (to > spec.seconds + 1e-6) problems.push(`${where} "${id}": to ${to} is past the shot's ${spec.seconds} s`);
    if (to < from) problems.push(`${where} "${id}": to ${to} is before from ${from}`);
    const beat = {
      id,
      label: String(raw.label ?? id),
      from: round4(from),
      to: round4(to),
      kind,
      // The DESIGNED picture of this beat, written at the boards stage before
      // the greybox exists: body action, expression, wardrobe and material,
      // the physical consequence, the tempo word. The greybox is built from
      // it and can only carry its geometry and its clock; the prompt hands
      // the model the design back, at the greybox's seconds. `label` stays
      // short — it is what a rail, a sheet label and a beat row can show.
      detail: raw.detail == null || String(raw.detail).trim() === "" ? null : String(raw.detail).trim(),
    };
    if (raw.causedBy != null && raw.causedBy !== "") beat.causedBy = String(raw.causedBy);
    if (raw.note != null && raw.note !== "") beat.note = String(raw.note);
    seen.set(id, beat);
    normalized.push(beat);
  });

  // Cause before effect (invariant 5), checked once the whole list is known.
  for (const beat of normalized) {
    if (!beat.causedBy) continue;
    const cause = seen.get(beat.causedBy);
    if (!cause) {
      problems.push(`beat "${beat.id}": causedBy "${beat.causedBy}" is not a beat in this list`);
      continue;
    }
    if (cause.id === beat.id) {
      problems.push(`beat "${beat.id}": causedBy points at itself`);
      continue;
    }
    if (cause.from > beat.from + 1e-6) {
      problems.push(
        `beat "${beat.id}" starts at ${beat.from} s but its cause "${cause.id}" starts at ${cause.from} s — ` +
          "an effect cannot precede its cause",
      );
    }
  }
  for (const beat of normalized) {
    const cycle = causeCycle(beat.id, seen);
    if (cycle) problems.push(`beat "${beat.id}": causedBy runs in a circle (${cycle.join(" -> ")})`);
  }

  if (problems.length) throw new Error(`beats rejected:\n  - ${[...new Set(problems)].join("\n  - ")}`);
  return normalized;
}

function causeCycle(startId, byId) {
  const walked = [startId];
  let current = byId.get(startId);
  for (let step = 0; step < byId.size + 1; step += 1) {
    const next = current?.causedBy ? byId.get(current.causedBy) : null;
    if (!next) return null;
    if (walked.includes(next.id)) return [...walked, next.id];
    walked.push(next.id);
    current = next;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lines — what is said in this shot, and by which machine
// ---------------------------------------------------------------------------

/**
 * Validate a whole line list against the spec, carrying the PAID half over.
 *
 * `previz.mjs lines --set` replaces the list, and a replacement that dropped
 * `{ file, seconds, cost }` would erase the record of TTS somebody already
 * paid for. So a line whose id AND text are unchanged keeps its recording;
 * a line whose TEXT changed keeps its cost (the money was spent) but loses
 * the file (the audio says something else now) and is reported in `stale`.
 *
 * Throws with EVERY problem it found, for the same reason `validateBeats`
 * does: a hand-written list usually has the same mistake three times.
 */
export function validateLines(lines, spec, previous = []) {
  if (!Array.isArray(lines)) throw new Error("lines must be a JSON array");
  const problems = [];
  const seen = new Set();
  const normalized = [];
  const kept = [];
  const stale = [];
  const before = new Map((Array.isArray(previous) ? previous : []).filter((l) => l && l.id).map((l) => [String(l.id), l]));

  lines.forEach((raw, index) => {
    const where = `line ${index + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push(`${where}: not an object`);
      return;
    }
    let id;
    try {
      id = slugId(raw.id, `${where} id`);
    } catch (error) {
      problems.push(error.message);
      return;
    }
    if (seen.has(id)) problems.push(`${where}: duplicate id "${id}"`);
    seen.add(id);
    const kind = raw.kind ?? "spoken";
    if (!LINE_KINDS.includes(kind)) problems.push(`${where} "${id}": kind must be one of ${LINE_KINDS.join("|")} (got: ${kind})`);
    const speaker = String(raw.speaker ?? "").trim();
    if (!speaker) problems.push(`${where} "${id}": speaker is required (a bible character id, or a name like "narrator" for voice-over)`);
    const text = String(raw.text ?? "").trim();
    if (!text) problems.push(`${where} "${id}": text is required — the line is what the model or the voice has to say`);
    let at = null;
    if (raw.at != null && raw.at !== "") {
      at = Number(raw.at);
      if (!Number.isFinite(at)) {
        problems.push(`${where} "${id}": at must be a second inside the shot`);
        at = null;
      } else if (at < 0 || at > (spec?.seconds ?? Infinity) + 1e-6) {
        problems.push(`${where} "${id}": at ${raw.at} is outside the shot's ${spec?.seconds} s`);
      }
    }

    const old = before.get(id);
    const sameText = old ? String(old.text ?? "").trim() === text : false;
    if (old && sameText) kept.push(id);
    if (old && !sameText && old.file) stale.push(id);
    const line = {
      id,
      speaker,
      kind,
      text,
      at: at === null ? null : round4(at),
      // The recording follows the text, never the id: an edited line is a
      // line the old audio does not say.
      file: old && sameText ? (old.file ?? null) : null,
      seconds: old && sameText ? (old.seconds ?? null) : null,
      // The money was spent whatever the text says now.
      cost: old ? (old.cost ?? null) : null,
    };
    // Everything else the recording carried travels with it, and leaves
    // with it: a line with no file has no voice and no recording time.
    if (line.file) {
      if (old?.voice) line.voice = old.voice;
      if (old?.recordedAt != null) line.recordedAt = old.recordedAt;
    }
    normalized.push(line);
  });

  if (problems.length) throw new Error(`lines rejected:\n  - ${[...new Set(problems)].join("\n  - ")}`);
  return { lines: normalized, kept, stale };
}

/** The lines this shot speaks on screen — what the video model must say. */
export function spokenLines(shot) {
  return (shot.lines ?? []).filter((line) => line && line.kind === "spoken" && String(line.text ?? "").trim());
}

/** Whether the take has to carry dialogue at all. */
export function hasSpokenLine(shot) {
  return spokenLines(shot).length > 0;
}

/** The voice-over lines that have a recording the cut can lay in. */
export function voiceOverLines(shot) {
  return (shot.lines ?? []).filter((line) => line && line.kind === "vo" && line.file);
}

// ---------------------------------------------------------------------------
// Checks — the acceptance record
// ---------------------------------------------------------------------------

/** The label the standard list gives an id, or the id itself for a check the
 *  agent invented for this shot. The conditioning decides what `take-motion`
 *  and `take-camera` are about, so it travels with the lookup. */
export function labelForCheck(id, target, conditioning = DEFAULT_CONDITIONING) {
  const family = target === "greybox" ? "greybox" : target === "reference" ? "reference" : "take";
  const take = takeChecks(conditioning);
  const lists = { greybox: STANDARD_CHECKS.greybox, reference: STANDARD_CHECKS.reference, take };
  const known = lists[family]?.find((check) => check.id === id)
    ?? STANDARD_CHECKS.greybox.find((check) => check.id === id)
    ?? take.find((check) => check.id === id)
    ?? STANDARD_CHECKS.lines.find((check) => check.id === id)
    ?? STANDARD_CHECKS.handoff.find((check) => check.id === id)
    ?? STANDARD_CHECKS.reference.find((check) => check.id === id);
  return known?.label ?? id;
}

/**
 * Add every standard check this shot should carry that it does not already,
 * as `unverified`. Never touches a check that exists: re-seeding after a
 * render must not erase what somebody looked at.
 *
 * Returns the ids it added.
 */
export function seedChecklist(shot) {
  const added = [];
  const conditioning = conditioningOf(shot);
  // A FREE shot sends no greybox, so it carries no greybox acceptance list:
  // eight checks about a clip nobody will look at would sit `unverified`
  // forever. A greybox rendered anyway — for the reel — is not the take's
  // reference, and checks already recorded are never removed.
  const blocked = usesGreybox(shot);
  const want = [
    ...(blocked ? STANDARD_CHECKS.greybox.map((check) => ({ ...check, target: "greybox" })) : []),
    ...(blocked && shot.entry === "recreate" ? STANDARD_CHECKS.reference.map((check) => ({ ...check, target: "greybox" })) : []),
  ];
  const spoken = hasSpokenLine(shot);
  const continues = Boolean(shot.continuity?.from);
  for (const take of shot.takes ?? []) {
    if (take?.status !== "done") continue;
    for (const check of takeChecks(conditioning)) want.push({ ...check, target: take.id });
    // Dialogue only: the transcript check is meaningless on a silent shot,
    // and an unanswerable check would sit `unverified` forever, blocking
    // `select` on a question nobody can answer.
    if (spoken) for (const check of STANDARD_CHECKS.lines) want.push({ ...check, target: take.id });
    // Hand-off only: a shot that never claimed to continue another one has
    // no frame to be judged against, and a cut that breaks continuity on
    // purpose must not be marked as having failed at it.
    if (continues) for (const check of STANDARD_CHECKS.handoff) want.push({ ...check, target: take.id });
  }
  for (const wanted of want) {
    if (findCheck(shot, wanted.id, wanted.target)) continue;
    shot.checks.push({
      id: wanted.id,
      label: wanted.label,
      target: wanted.target,
      status: "unverified",
      range: null,
      note: "",
      revision: null,
      at: null,
      history: [],
    });
    added.push(`${wanted.target}:${wanted.id}`);
  }
  return added;
}

export function findCheck(shot, id, target) {
  return (shot.checks ?? []).find((check) => check.id === id && check.target === target) ?? null;
}

/**
 * The revision a check against `target` is recorded at.
 *
 * For the greybox that is the render revision, which is what invariant 7 is
 * about. For a take it is the take's own number, so "the same defect on two
 * takes in a row" is stuck for exactly the same reason.
 */
export function revisionOfTarget(shot, target) {
  if (target === "greybox") return Number(shot.greybox?.revision ?? 0) || null;
  const match = /^take-(\d+)$/.exec(String(target));
  if (match) return Number(match[1]);
  return null;
}

/**
 * Record one acceptance check.
 *
 * The check's PREVIOUS state moves into `history` first, so the record is a
 * trail rather than a last-word — that trail is the only evidence `stuck`
 * has. Mutates `shot` and returns the stored record.
 */
export function recordCheck(shot, { id, status, target = "greybox", range = null, note = "", at = null, label = null }) {
  if (!id) throw new Error("--id is required");
  if (!CHECK_STATUSES.includes(status)) throw new Error(`--status must be one of ${CHECK_STATUSES.join("|")} (got: ${status})`);
  const revision = revisionOfTarget(shot, target);
  if (target === "greybox" && !revision) {
    throw new Error("there is no greybox render to check yet — run 'previz.mjs render <shot-dir> --preview' first");
  }
  if (target !== "greybox" && !(shot.takes ?? []).some((take) => take.id === target)) {
    throw new Error(`--target "${target}" is neither "greybox" nor a recorded take (${(shot.takes ?? []).map((t) => t.id).join(", ") || "none"})`);
  }

  let check = findCheck(shot, id, target);
  if (!check) {
    check = { id, label: label ?? labelForCheck(id, target, conditioningOf(shot)), target, status: "unverified", range: null, note: "", revision: null, at: null, history: [] };
    shot.checks.push(check);
  }
  check.history = Array.isArray(check.history) ? check.history : [];
  if (check.revision != null) {
    check.history.push({ revision: check.revision, status: check.status, note: check.note ?? "", at: check.at ?? null });
  }
  check.status = status;
  check.range = range ?? null;
  check.note = note ?? "";
  check.revision = revision;
  check.at = at;
  if (label) check.label = label;

  shot.stuck = computeStuck(shot.checks);
  return check;
}

/**
 * Check ids that failed on the LAST TWO DISTINCT revisions of their target.
 *
 * Distinct, not adjacent-numbered: a check recorded twice on revision 3 and
 * once on revision 5 has two distinct revisions, and if both ended `fail`
 * the loop is repeating itself whatever happened to revision 4. Within one
 * revision the LAST record wins — an agent that looked again and changed its
 * mind has changed the answer, not added one.
 */
export function computeStuck(checks = []) {
  const stuck = [];
  for (const check of checks) {
    const trail = [...(Array.isArray(check.history) ? check.history : [])];
    if (check.revision != null) trail.push({ revision: check.revision, status: check.status });
    const lastPerRevision = new Map();
    for (const entry of trail) {
      if (entry?.revision == null) continue;
      lastPerRevision.set(entry.revision, entry.status);
    }
    const revisions = [...lastPerRevision.keys()];
    if (revisions.length < 2) continue;
    const [a, b] = revisions.slice(-2);
    if (lastPerRevision.get(a) === "fail" && lastPerRevision.get(b) === "fail") stuck.push(check.id);
  }
  return [...new Set(stuck)];
}

/**
 * What the acceptance record says about one target.
 *
 * `accepted` is true only when every check on that target is `pass` — an
 * empty record is NOT acceptance, and `unverified` is counted apart from
 * `fail` so a report can never fold "nobody looked" into "one failure".
 */
export function summarizeChecks(shot, target) {
  const mine = (shot.checks ?? []).filter((check) => check.target === target);
  const by = (status) => mine.filter((check) => check.status === status);
  const currentRevision = revisionOfTarget(shot, target);
  return {
    target,
    total: mine.length,
    pass: by("pass").length,
    fail: by("fail").length,
    unverified: by("unverified").length,
    failIds: by("fail").map((check) => check.id),
    unverifiedIds: by("unverified").map((check) => check.id),
    /** Recorded against an older revision than the target is at now. Reported,
     *  never a gate: a full-resolution re-render of the same scene bumps the
     *  revision without changing anything anybody looked at. */
    staleIds: mine
      .filter((check) => check.revision != null && currentRevision != null && check.revision < currentRevision)
      .map((check) => check.id),
    accepted: mine.length > 0 && by("pass").length === mine.length,
  };
}

/** Every target the record mentions, greybox first. */
export function checkTargets(shot) {
  const targets = new Set((shot.checks ?? []).map((check) => check.target));
  return ["greybox", ...[...targets].filter((target) => target !== "greybox").sort()].filter(
    (target) => target === "greybox" || targets.has(target),
  );
}

// ---------------------------------------------------------------------------
// Takes — the paid half
// ---------------------------------------------------------------------------

/** `take-01`, `take-02`, … — the id the next take gets. */
export function nextTakeId(shot) {
  return `take-${String((shot.takes ?? []).length + 1).padStart(2, "0")}`;
}

/**
 * Whether a paid generation may start, and why not when it may not.
 *
 * Every refusal here happens BEFORE a key is read, let alone a request sent.
 * Takes are counted whatever their status: a `failed` take is one whose
 * request left this machine, and fal charges for a render nobody downloaded.
 */
export function takePolicy(shot, { fix = null, userApproved = false, allowFailing = null } = {}) {
  const errors = [];
  const conditioning = conditioningOf(shot);
  const blocked = conditioning !== "free";
  const greybox = shot.greybox ?? {};
  const summary = summarizeChecks(shot, "greybox");

  // A FREE shot is not conditioned on a greybox, so there is nothing here to
  // be stale or to have failed: the only gate left is the film's own previz
  // approval, which `previz.mjs` asks the manifest for. A greybox that
  // happens to exist (for the reel) is neither required nor checked.
  if (blocked) {
    if (!greybox.final) {
      errors.push("no final greybox — run 'previz.mjs render <shot-dir>' (without --preview) first");
    } else if (Number(greybox.final.revision) !== Number(greybox.revision)) {
      errors.push(
        `the final greybox is revision ${greybox.final.revision} but the scene is at revision ${greybox.revision} — ` +
          "re-render before conditioning a paid take on a stale file",
      );
    }
    if (summary.fail > 0 && !allowFailing) {
      errors.push(
        `the greybox has failing checks (${summary.failIds.join(", ")}) — fix them, or say why they are acceptable ` +
          'with --allow-failing "<reason>"',
      );
    }
  }

  const taken = (shot.takes ?? []).length;
  const number = taken + 1;
  if (taken >= 1 && !fix) {
    errors.push(`take ${number} needs --fix "<what this take changes>" — a re-shoot without a named fix is the same shot twice`);
  }
  if (taken >= 2 && !userApproved) {
    errors.push(`take ${number} is the third or later on this shot — it needs --user-approved as well as --fix`);
  }

  return {
    ok: errors.length === 0,
    errors,
    takeNumber: number,
    takeId: nextTakeId(shot),
    conditioning,
    // Reported so a caller can warn about them; on a free shot the greybox
    // record says nothing about the take, so there is nothing to report.
    failingChecks: blocked ? summary.failIds : [],
    unverifiedChecks: blocked ? summary.unverifiedIds : [],
    allowFailing: allowFailing ?? null,
  };
}

/**
 * The body `shot` writes into `prompts.md`'s fenced block.
 *
 * Exported so `parsePromptPack` can recognise it: a template that satisfies
 * its own gate is a gate that passes before anybody has written anything,
 * which is exactly the "nothing is passed unseen" failure in prompt form.
 */
export const PROMPT_TEMPLATE_BODY = `@Video1 = layout, positions, timing and the single camera move only; its grey shapes are placeholders, not the look.

(Replace this block. Run 'previz.mjs prompt-skeleton <shot-dir> --write' to
get it with THIS shot's references, its beats as a time-coded timeline and
its hand-off, then fill it in. Every attached reference needs one assignment
sentence — an unassigned reference bleeds its own lighting and framing into
the shot — and the look the greybox cannot carry is what the prose is for:
who the subject is, what the room is made of, the light, the lens, the
palette. Do not re-describe the blocking; that is what @Video1 is for.)`;

export const REF_KINDS = ["image", "video", "audio"];

/**
 * Every reference index a prompt names, in both spellings.
 *
 * `seedance-video.mjs` documents `@Image1 / @Video1 / @Audio1` — that is the
 * syntax the model is actually told to resolve. This mode shipped `[Video1]`
 * first; those packs still parse, and `legacy` reports them so the caller can
 * say so once rather than silently accepting a syntax the vendor does not
 * document.
 */
export function promptReferences(text) {
  const prompt = String(text ?? "");
  const found = { image: new Set(), video: new Set(), audio: new Set() };
  const legacy = [];
  for (const match of prompt.matchAll(/@(Image|Video|Audio)(\d+)/g)) {
    found[match[1].toLowerCase()].add(Number(match[2]));
  }
  for (const match of prompt.matchAll(/\[(Image|Video|Audio)(\d+)\]/g)) {
    found[match[1].toLowerCase()].add(Number(match[2]));
    legacy.push(match[0]);
  }
  return {
    image: [...found.image].sort((a, b) => a - b),
    video: [...found.video].sort((a, b) => a - b),
    audio: [...found.audio].sort((a, b) => a - b),
    legacy: [...new Set(legacy)],
  };
}

/** The prompt block a take is conditioned on, out of `prompts.md`.
 *
 *  The FIRST fenced block tagged `prompt` — a pack usually carries several
 *  fenced blocks (a look note, a negative list, an alternate take) and the
 *  one that reaches fal has to be unambiguous. `@Video1` is how the prompt
 *  addresses the greybox that is attached as the video reference; a prompt
 *  that never mentions it would be a text-to-video shot wearing a previz
 *  mode's clothes — UNLESS the shot is conditioned `free`, where a
 *  text-to-video shot is exactly what was asked for and no video reference
 *  is attached at all. `requireVideo` is that decision, and the caller
 *  reads it off the shot. */
export function parsePromptPack(markdown, { requireVideo = true } = {}) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  let open = null;
  const body = [];
  for (const line of lines) {
    const fence = /^\s*(`{3,}|~{3,})\s*(\S*)\s*$/.exec(line);
    if (open === null) {
      // The fence CHARACTER is what has to match on the way out — a block
      // opened with ``` closes on ```, and comparing the whole run against a
      // single character is how a prompt quietly swallows the rest of the file.
      if (fence && fence[2].toLowerCase() === "prompt") open = fence[1][0];
      continue;
    }
    if (fence && fence[1][0] === open) break;
    body.push(line);
  }
  const prompt = body.join("\n").trim();
  if (open === null || !prompt) {
    return { prompt: null, ok: false, reason: "prompts.md has no fenced ```prompt block with text in it", refs: null };
  }
  const refs = promptReferences(prompt);
  if (requireVideo && !refs.video.includes(1)) {
    return {
      prompt,
      refs,
      ok: false,
      reason: "the prompt never mentions @Video1 — the greybox is attached as the video reference and the prompt has to address it",
    };
  }
  if (squash(prompt) === squash(PROMPT_TEMPLATE_BODY)) {
    return { prompt, refs, ok: false, reason: "prompts.md still holds the scaffolded placeholder — write the shot's look prompt in the ```prompt block" };
  }
  return { prompt, refs, ok: true, reason: null };
}

/**
 * Whether a prompt only names references that were actually attached.
 *
 * A prompt that says `@Image3` when two images went with the job does not
 * fail at fal — it is rendered, billed, and comes back conditioned on
 * something else. So the mismatch is caught here, before the request.
 * `attached` is `{ image, video, audio }` counts.
 */
export function validatePromptRefs(refs, attached = {}) {
  const errors = [];
  for (const kind of REF_KINDS) {
    const count = Number(attached[kind] ?? 0);
    for (const index of refs?.[kind] ?? []) {
      if (index >= 1 && index <= count) continue;
      errors.push(
        count === 0
          ? `the prompt names @${capitalize(kind)}${index} but no ${kind} reference is attached to this shot`
          : `the prompt names @${capitalize(kind)}${index} but only ${count} ${kind} reference(s) are attached (@${capitalize(kind)}1..${count})`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The reference indices a prompt gives a JOB to, in both spellings.
 *
 * An assignment is the tag followed by `=`, `:`, `：` or `is` — `@Image2 =
 * the keeper's appearance only`, `@Video1: layout and timing`, `@Image3：只参
 * 考脸型与服装`, `@Audio1 is the keeper's voice`. Merely NAMING a reference is
 * not assigning it: a reference that is attached but never given a job bleeds
 * its own lighting, framing and palette into the shot, which is the failure
 * mode the fal.ai guidance and the community guides both describe.
 *
 * The FULL-WIDTH colon and equals are here because a pack for a Chinese film
 * is written in Chinese punctuation — `@Image3：…` is the same assignment as
 * `@Image3: …`, and reading only the ASCII one would refuse every pack the
 * skeleton writes for such a film.
 */
export function promptAssignments(text) {
  const prompt = String(text ?? "");
  const found = { image: new Set(), video: new Set(), audio: new Set() };
  const collect = (pattern) => {
    for (const match of prompt.matchAll(pattern)) found[match[1].toLowerCase()].add(Number(match[2]));
  };
  collect(/@(Image|Video|Audio)(\d+)\s*(?:[=:：＝—-]|\s+is\b)/gi);
  collect(/\[(Image|Video|Audio)(\d+)\]\s*(?:[=:：＝—-]|\s+is\b)/gi);
  return {
    image: [...found.image].sort((a, b) => a - b),
    video: [...found.video].sort((a, b) => a - b),
    audio: [...found.audio].sort((a, b) => a - b),
  };
}

/**
 * Whether every reference the job CARRIES has a job in the prompt.
 *
 * `validatePromptRefs` answers the opposite question — a prompt that names
 * a reference nothing was attached at. Both are needed: one catches a prompt
 * pointing at nothing, this one catches a reference pointing at nobody.
 * `attached` is `{ image, video, audio }` counts.
 */
export function validateReferenceAssignments(prompt, attached = {}) {
  const assigned = promptAssignments(prompt);
  const missing = [];
  for (const kind of REF_KINDS) {
    const count = Number(attached[kind] ?? 0);
    for (let index = 1; index <= count; index += 1) {
      if (assigned[kind].includes(index)) continue;
      missing.push(`@${capitalize(kind)}${index}`);
    }
  }
  const errors = missing.length
    ? [
        `${missing.join(", ")} ${missing.length === 1 ? "is attached but is" : "are attached but are"} never given a job — ` +
          'write one assignment sentence per reference ("@Image2 = the keeper\'s appearance only — hold it"). ' +
          "An unassigned reference bleeds its own lighting and framing into the shot.",
      ]
    : [];
  return { ok: errors.length === 0, errors, missing, assigned };
}

/**
 * The time-coded timeline a v2 prompt pack carries, as `{ from, to }` ranges.
 *
 * Above ~8 s the vendor's own guidance is a timeline rather than a paragraph,
 * and this mode's beats are already that timeline — the greybox is the clock.
 * A line is `Seconds 0.0–0.5: …` (any dash, or `to`) or a single `Seconds
 * 5.2: …` for a moment. Everything else in the prompt is prose and is left
 * alone.
 */
export function parsePromptTimeline(text) {
  const rows = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const range = /^seconds?\s+(\d+(?:\.\d+)?)\s*(?:[–—-]|\.\.|to)\s*(\d+(?:\.\d+)?)\s*[::]/i.exec(line);
    if (range) {
      rows.push({ from: Number(range[1]), to: Number(range[2]), line });
      continue;
    }
    const point = /^seconds?\s+(\d+(?:\.\d+)?)\s*[::]/i.exec(line);
    if (point) rows.push({ from: Number(point[1]), to: Number(point[1]), line });
  }
  return rows;
}

/**
 * What is wrong with a timeline, as sentences. WARNINGS, never refusals: the
 * mode does not own how a prompt is phrased, and a timeline that disagrees
 * with the clock is worth saying out loud without stopping a take the agent
 * may have good reason to send.
 */
export function timelineProblems(timeline, spec) {
  const seconds = Number(spec?.seconds);
  const problems = [];
  let previous = null;
  for (const row of timeline ?? []) {
    const where = `"${String(row.line).slice(0, 60)}"`;
    if (row.to < row.from - 1e-6) problems.push(`the timeline line ${where} ends before it starts`);
    if (Number.isFinite(seconds) && row.to > seconds + 1e-6) {
      problems.push(`the timeline line ${where} runs past the shot's ${seconds} s — the take is only that long`);
    }
    if (previous && row.from < previous.from - 1e-6) {
      problems.push(`the timeline goes backwards at ${where} (the line before it starts at ${previous.from} s)`);
    }
    previous = row;
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Transcript QA — did the model actually say the line?
// ---------------------------------------------------------------------------

/**
 * Text as a transcript can be compared to it: case-folded, with punctuation,
 * symbols and every space removed.
 *
 * Whisper punctuates where it likes and hears "还开着吗？" as "还开着吗",
 * so comparing raw strings answers "fail" on a take that said the line
 * perfectly. Spaces go too, which is what lets the same rule serve Chinese
 * (no spaces) and English (a transcript that re-breaks them).
 */
export function normalizeSpeech(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\p{Z}\s]+/gu, "");
}

/**
 * Whether every spoken line appears in the transcript.
 *
 * Reports the lines it could not find rather than a bare verdict: the note
 * on a failing `take-lines` check has to say WHICH line went missing, or the
 * next take is a guess.
 */
export function transcriptCoverage(transcript, lines = []) {
  const haystack = normalizeSpeech(transcript);
  const missing = [];
  const found = [];
  for (const line of lines) {
    const needle = normalizeSpeech(line?.text);
    if (needle && haystack.includes(needle)) found.push(line.id);
    else missing.push({ id: line?.id ?? null, text: line?.text ?? "" });
  }
  return { ok: missing.length === 0 && lines.length > 0, found, missing, transcript: String(transcript ?? "") };
}

// ---------------------------------------------------------------------------
// Where the shot stands
// ---------------------------------------------------------------------------

/**
 * The stages a shot passes through, in order. `next` is the first open one.
 *
 * `reference` is only a stage for a recreate shot, and it comes first because
 * the plan of a recreate is written FROM the reference; every other stage is
 * the order the design brief lists.
 *
 * THERE IS NO BOARD STEP. The plan's text is the design; the pictures are
 * derived from it through the greybox (`plan` → greybox → checks → the key
 * frame), so nothing between the plan and the blocking asks for a drawing.
 *
 * A `free` shot SKIPS the three greybox rungs entirely — it is not
 * conditioned on a block, so `plan` is followed by `prompt`. A greybox it
 * renders anyway (for the reel) does not put them back.
 */
export const STAGES = ["reference", "plan", "greybox-preview", "checks", "final-render", "prompt", "take", "take-checks", "select"];

export function nextStage(shot, { promptOk = false, promptReason = null } = {}) {
  const greybox = shot.greybox ?? {};
  const takes = shot.takes ?? [];
  const done = takes.filter((take) => take.status === "done");
  const blocked = usesGreybox(shot);

  if (shot.entry === "recreate" && !shot.reference) {
    return stage("reference", "this is a recreate shot and no reference segment has been cut yet", "previz.mjs reference <shot-dir> <video> --in <s> --out <s>");
  }
  if (!Array.isArray(shot.beats) || shot.beats.length === 0) {
    return stage("plan", "the shot has no beats — write shot-plan.md and load its timeline", "previz.mjs beats <shot-dir> --set beats.json");
  }
  if (blocked && !greybox.preview && !greybox.final) {
    return stage("greybox-preview", "nothing has been rendered yet", "previz.mjs render <shot-dir> --preview");
  }
  const greyboxChecks = summarizeChecks(shot, "greybox");
  if (blocked && !greyboxChecks.accepted) {
    return stage(
      "checks",
      greyboxChecks.fail > 0
        ? `${greyboxChecks.fail} check(s) fail on the greybox: ${greyboxChecks.failIds.join(", ")}`
        : `${greyboxChecks.unverified} check(s) on the greybox are unverified: ${greyboxChecks.unverifiedIds.join(", ")}`,
      "previz.mjs sheet <shot-dir> --strip <from>,<to>   then   previz.mjs check <shot-dir> --id <check> --status pass|fail",
    );
  }
  if (blocked && (!greybox.final || Number(greybox.final.revision) !== Number(greybox.revision))) {
    return stage("final-render", "the accepted greybox has no full-resolution render at the current revision", "previz.mjs render <shot-dir>");
  }
  // NO PICTURE STEP. An accepted greybox goes straight to the pack: the
  // greybox is the only picture of layout, behaviour and camera the take
  // receives, and every other picture brings a composition that fights it
  // (three acceptance rounds, 2026-09-21). `anchor` and `lineup` are still
  // there as optional pictures for the creator — they are not a rung of
  // this walk, and a suggestion that never closes would make every later
  // `next` a lie about where the shot stands.
  if (!promptOk) {
    return stage("prompt", promptReason ?? "prompts.md has no usable prompt block", "write the ```prompt block in prompts.md");
  }
  if (done.length === 0) {
    return stage("take", "no take has finished yet", "previz.mjs generate <shot-dir> --estimate   then   previz.mjs generate <shot-dir>");
  }
  const newest = done[done.length - 1];
  const takeSummary = summarizeChecks(shot, newest.id);
  if (takeSummary.fail > 0) {
    // A failing take is not a render to redo: the model, not the scene, put
    // the defect there, and the next take is paid for. So the move is one
    // more take with a fix you can name, or telling the user what deviated.
    const approval = takes.length >= 2 ? ' --user-approved' : "";
    return stage(
      "take-checks",
      `${takeSummary.fail} check(s) fail on ${newest.id}: ${takeSummary.failIds.join(", ")} — ` +
        "a failing take is re-shot ONCE with a named fix, or reported: tell the user which seconds deviate, " +
        `keep ${newest.id} and its request id, and deliver the ${blocked ? "greybox" : "plan"}`,
      `previz.mjs generate <shot-dir> --fix "<what this take changes>"${approval}   or   report the deviation and keep ${newest.id}`,
    );
  }
  if (!takeSummary.accepted) {
    return stage(
      "take-checks",
      `${takeSummary.unverified} check(s) on ${newest.id} are unverified: ${takeSummary.unverifiedIds.join(", ")}`,
      // A free take has no greybox to be compared against: the picture to
      // look at is the take itself, against the plan's beats.
      blocked
        ? `previz.mjs compare <shot-dir> --a greybox --b ${newest.id}   then   previz.mjs check <shot-dir> --target ${newest.id} --id <check> --status pass|fail`
        : `previz.mjs sheet <shot-dir> --lane ${newest.id} --count 8   then   previz.mjs check <shot-dir> --target ${newest.id} --id <check> --status pass|fail`,
    );
  }
  if (!takes.some((take) => take.selected === true)) {
    return stage("select", "no take is marked as the one this shot delivers", `previz.mjs select <shot-dir> ${newest.id}`);
  }
  return { stage: null, reason: "every stage is closed — this shot is delivered", command: null };
}

function stage(name, reason, command) {
  return { stage: name, reason, command };
}

/**
 * Everything `status` reports about one shot, computed from the file.
 *
 * `promptOk` is passed in because reading `prompts.md` is I/O and this module
 * does none; `previz.mjs` reads the file and hands the verdict over.
 */
export function shotStatus(shot, { promptOk = false, promptReason = null, costs = null, files = {} } = {}) {
  const greybox = shot.greybox ?? {};
  const targets = checkTargets(shot);
  const byTarget = Object.fromEntries(targets.map((target) => [target, summarizeChecks(shot, target)]));
  return {
    id: shot.id,
    title: shot.title,
    entry: shot.entry,
    conditioning: conditioningOf(shot),
    scene: shot.scene ?? null,
    characters: shot.characters ?? [],
    set: shot.set ?? null,
    trim: shot.trim ?? null,
    continuity: shot.continuity ?? null,
    board: shot.board ?? null,
    anchors: shot.anchors ?? [],
    lines: shot.lines ?? [],
    spec: shot.spec,
    assumptions: shot.assumptions ?? [],
    beats: {
      count: (shot.beats ?? []).length,
      byKind: countBy(shot.beats ?? [], (beat) => beat.kind),
      list: shot.beats ?? [],
    },
    reference: shot.reference ?? null,
    greybox: {
      revision: Number(greybox.revision ?? 0),
      script: greybox.script ?? "greybox/scene.py",
      preview: greybox.preview ?? null,
      final: greybox.final ?? null,
      finalIsCurrent: Boolean(greybox.final && Number(greybox.final.revision) === Number(greybox.revision)),
      files: { ...files },
    },
    checks: { byTarget, list: shot.checks ?? [] },
    stuck: computeStuck(shot.checks ?? []),
    prompt: { file: shot.prompt?.file ?? "prompts.md", ok: promptOk, reason: promptReason },
    takes: shot.takes ?? [],
    selected: (shot.takes ?? []).find((take) => take.selected === true)?.id ?? null,
    costs,
    next: nextStage(shot, { promptOk, promptReason }),
  };
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function countBy(list, key) {
  const counts = {};
  for (const item of list) {
    const k = key(item) ?? "unknown";
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function numberOf(value, label, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number (got: ${value})`);
  if (integer && !Number.isInteger(n)) throw new Error(`${label} must be a whole number (got: ${value})`);
  if (n < min || n > max) throw new Error(`${label} must be between ${min} and ${max} (got: ${n})`);
  return n;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

/** Whitespace-insensitive comparison, so re-wrapping the placeholder does not
 *  turn it into a prompt somebody wrote. */
function squash(text) {
  return String(text).replace(/\s+/g, " ").trim();
}
