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
export const BEAT_KINDS = ["action", "trigger", "camera", "hold"];
export const CHECK_STATUSES = ["pass", "fail", "unverified"];
export const TAKE_STATUSES = ["submitted", "done", "failed"];

export const DEFAULT_SPEC = { seconds: 8, fps: 24, width: 1280, height: 720 };

/**
 * Upstream's acceptance list, as this mode records it.
 *
 * `target` is what the check is about, not a shot-specific id: `greybox`
 * checks are seeded by `shot` / `checklist`, and the `take` ones are seeded
 * against a take's id the moment that take finishes, so a take can never be
 * delivered with an empty acceptance record.
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
};

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

export function newProject({ title, defaults }) {
  return { version: PROJECT_VERSION, title: String(title), defaults: specDefaults(defaults), shots: [] };
}

export function newShot({ id, title, entry = "original", spec, assumptions = [] }) {
  if (!ENTRIES.includes(entry)) throw new Error(`--entry must be one of ${ENTRIES.join("|")} (got: ${entry})`);
  return {
    version: SHOT_VERSION,
    id,
    title: String(title),
    entry,
    spec,
    assumptions: [...assumptions],
    beats: [],
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
    const beat = { id, label: String(raw.label ?? id), from: round4(from), to: round4(to), kind };
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
// Checks — the acceptance record
// ---------------------------------------------------------------------------

/** The label the standard list gives an id, or the id itself for a check the
 *  agent invented for this shot. */
export function labelForCheck(id, target) {
  const family = target === "greybox" ? "greybox" : target === "reference" ? "reference" : "take";
  const known = STANDARD_CHECKS[family]?.find((check) => check.id === id)
    ?? STANDARD_CHECKS.greybox.find((check) => check.id === id)
    ?? STANDARD_CHECKS.take.find((check) => check.id === id)
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
  const want = [
    ...STANDARD_CHECKS.greybox.map((check) => ({ ...check, target: "greybox" })),
    ...(shot.entry === "recreate" ? STANDARD_CHECKS.reference.map((check) => ({ ...check, target: "greybox" })) : []),
  ];
  for (const take of shot.takes ?? []) {
    if (take?.status !== "done") continue;
    for (const check of STANDARD_CHECKS.take) want.push({ ...check, target: take.id });
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
    check = { id, label: label ?? labelForCheck(id, target), target, status: "unverified", range: null, note: "", revision: null, at: null, history: [] };
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
  const greybox = shot.greybox ?? {};
  if (!greybox.final) {
    errors.push("no final greybox — run 'previz.mjs render <shot-dir>' (without --preview) first");
  } else if (Number(greybox.final.revision) !== Number(greybox.revision)) {
    errors.push(
      `the final greybox is revision ${greybox.final.revision} but the scene is at revision ${greybox.revision} — ` +
        "re-render before conditioning a paid take on a stale file",
    );
  }

  const summary = summarizeChecks(shot, "greybox");
  if (summary.fail > 0 && !allowFailing) {
    errors.push(
      `the greybox has failing checks (${summary.failIds.join(", ")}) — fix them, or say why they are acceptable ` +
        'with --allow-failing "<reason>"',
    );
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
    failingChecks: summary.failIds,
    unverifiedChecks: summary.unverifiedIds,
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
export const PROMPT_TEMPLATE_BODY = `Follow the motion, staging and camera of [Video1] exactly.

(Replace this block. Describe the LOOK the greybox cannot carry: who the
subject is, what the room is made of, the light, the lens feel, the palette.
Do not re-describe the blocking — that is what [Video1] is for.)`;

/** The prompt block a take is conditioned on, out of `prompts.md`.
 *
 *  The FIRST fenced block tagged `prompt` — a pack usually carries several
 *  fenced blocks (a look note, a negative list, an alternate take) and the
 *  one that reaches fal has to be unambiguous. `[Video1]` is how the prompt
 *  addresses the greybox that is attached as the video reference; a prompt
 *  that never mentions it would be a text-to-video shot wearing a previz
 *  mode's clothes. */
export function parsePromptPack(markdown) {
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
    return { prompt: null, ok: false, reason: "prompts.md has no fenced ```prompt block with text in it" };
  }
  if (!prompt.includes("[Video1]")) {
    return {
      prompt,
      ok: false,
      reason: "the prompt never mentions [Video1] — the greybox is attached as the video reference and the prompt has to address it",
    };
  }
  if (squash(prompt) === squash(PROMPT_TEMPLATE_BODY)) {
    return { prompt, ok: false, reason: "prompts.md still holds the scaffolded placeholder — write the shot's look prompt in the ```prompt block" };
  }
  return { prompt, ok: true, reason: null };
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
 */
export const STAGES = ["reference", "plan", "greybox-preview", "checks", "final-render", "prompt", "take", "take-checks", "select"];

export function nextStage(shot, { promptOk = false, promptReason = null } = {}) {
  const greybox = shot.greybox ?? {};
  const takes = shot.takes ?? [];
  const done = takes.filter((take) => take.status === "done");

  if (shot.entry === "recreate" && !shot.reference) {
    return stage("reference", "this is a recreate shot and no reference segment has been cut yet", "previz.mjs reference <shot-dir> <video> --in <s> --out <s>");
  }
  if (!Array.isArray(shot.beats) || shot.beats.length === 0) {
    return stage("plan", "the shot has no beats — write shot-plan.md and load its timeline", "previz.mjs beats <shot-dir> --set beats.json");
  }
  if (!greybox.preview && !greybox.final) {
    return stage("greybox-preview", "nothing has been rendered yet", "previz.mjs render <shot-dir> --preview");
  }
  const greyboxChecks = summarizeChecks(shot, "greybox");
  if (!greyboxChecks.accepted) {
    return stage(
      "checks",
      greyboxChecks.fail > 0
        ? `${greyboxChecks.fail} check(s) fail on the greybox: ${greyboxChecks.failIds.join(", ")}`
        : `${greyboxChecks.unverified} check(s) on the greybox are unverified: ${greyboxChecks.unverifiedIds.join(", ")}`,
      "previz.mjs sheet <shot-dir> --strip <from>,<to>   then   previz.mjs check <shot-dir> --id <check> --status pass|fail",
    );
  }
  if (!greybox.final || Number(greybox.final.revision) !== Number(greybox.revision)) {
    return stage("final-render", "the accepted greybox has no full-resolution render at the current revision", "previz.mjs render <shot-dir>");
  }
  if (!promptOk) {
    return stage("prompt", promptReason ?? "prompts.md has no usable prompt block", "write the ```prompt block in prompts.md");
  }
  if (done.length === 0) {
    return stage("take", "no take has finished yet", "previz.mjs generate <shot-dir> --estimate   then   previz.mjs generate <shot-dir>");
  }
  const newest = done[done.length - 1];
  const takeChecks = summarizeChecks(shot, newest.id);
  if (takeChecks.fail > 0) {
    // A failing take is not a render to redo: the model, not the scene, put
    // the defect there, and the next take is paid for. So the move is one
    // more take with a fix you can name, or telling the user what deviated.
    const approval = takes.length >= 2 ? ' --user-approved' : "";
    return stage(
      "take-checks",
      `${takeChecks.fail} check(s) fail on ${newest.id}: ${takeChecks.failIds.join(", ")} — ` +
        "a failing take is re-shot ONCE with a named fix, or reported: tell the user which seconds deviate, " +
        `keep ${newest.id} and its request id, and deliver the greybox`,
      `previz.mjs generate <shot-dir> --fix "<what this take changes>"${approval}   or   report the deviation and keep ${newest.id}`,
    );
  }
  if (!takeChecks.accepted) {
    return stage(
      "take-checks",
      `${takeChecks.unverified} check(s) on ${newest.id} are unverified: ${takeChecks.unverifiedIds.join(", ")}`,
      `previz.mjs compare <shot-dir> --a greybox --b ${newest.id}   then   previz.mjs check <shot-dir> --target ${newest.id} --id <check> --status pass|fail`,
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
