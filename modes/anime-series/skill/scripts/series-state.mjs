/**
 * anime-series state rules — ONE algorithm for two runtimes.
 *
 * The viewer (`domain.ts`, in a browser bundle) and the scripts (`series.mjs`)
 * must never disagree about whether a bible entity is locked, whether an
 * episode was shot under an older bible, whether a shot list conserves its
 * part's seconds, or which storyboard / take is in effect. Every such rule
 * lives here, once. The backlot `stage-state.mjs` precedent: pure, no
 * `node:*` imports, no I/O, deterministic.
 *
 * Three files feed it (shapes in `series-state.d.mts`):
 *   bible.json                       human + agent text, `locks[]`
 *   episodes/<id>/episode.json       human + agent text, `picks`
 *   project.json → `series` sidecar  machine state written by series.mjs only
 *
 * Timing rules are a port of the checks in ai-anime-series
 * `scripts/make_prompts.py` (MIT, (c) 2026 硅基废话 / 10291124jcjc-dotcom;
 * the licence text is in LICENSE-ai-anime-series.txt beside this file):
 * every shot at least 2 s, a part at most 30 s, the shots of a part adding up
 * to duration / parts, a warning past 5 s and for counts that do not make a
 * tidy grid. Adjacent rebalancing, hashing and the lock model are this
 * mode's own.
 */

import { CHARACTER_COMPOUNDS, LEADER_WORDS } from "./name-words.mjs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A shot shorter than this cannot finish its action; the clip turns to a slideshow. */
export const SHOT_MIN_S = 2;
/** A dialogue-free action shot past this tends to drag (a warning, not an error). */
export const SHOT_LONG_S = 5;
/** One Seedance 2.5 request renders at most 30 s (seedance-video.mjs DURATION_MAX_S). */
export const PART_MAX_S = 30;
/** …and at least 4 s, in whole seconds (seedance-video.mjs DURATION_MIN_S). */
export const PART_MIN_S = 4;
/** Part ids in order; a 60 s episode is parts A and B. */
export const PART_IDS = Object.freeze(["A", "B", "C", "D", "E", "F", "G", "H"]);
/** Panel count → [rows, cols] for the counts that make a tidy grid. */
export const GRIDS = Object.freeze({ 4: [2, 2], 6: [2, 3], 8: [2, 4], 9: [3, 3], 10: [2, 5], 12: [3, 4] });
/** The suggested shot count per part length (15 s → 6, 30 s → 9 — about 3 s a shot). */
export const SUGGESTED_SHOTS = Object.freeze({ 15: 6, 30: 9 });

export const ENTITY_KINDS = Object.freeze(["character", "group", "scene"]);
export const STYLE_KEY = "style";
export const ENTITY_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const EPISODE_ID_RE = /^ep[0-9]{2,3}$/;
/**
 * A check's verdict. `absent`: the entity is not in that shot's frames —
 * neither a pass nor a drift; when the shot's words name it, a lost beat.
 */
export const VERDICTS = Object.freeze(["ok", "drift", "absent", "unverified"]);
/** Sheet candidates take the verdicts that make sense for a still image. */
export const SHEET_VERDICTS = Object.freeze(["ok", "drift", "unverified"]);
/** Languages the prompt scaffolding is written in (`bible.lang`; detected when absent). */
export const BIBLE_LANGS = Object.freeze(["en", "zh"]);

/**
 * Every field of an entity that a lock covers. A card is `edited` when any
 * of these differs from the latest lock. `sheet` is the picked design-sheet
 * asset id: re-picking a sheet changes the look anchor as surely as
 * rewriting `look` does.
 */
export const ENTITY_FIELDS = Object.freeze({
  style: Object.freeze(["style", "sheetStyle", "ratio", "dialogue"]),
  character: Object.freeze(["name", "look", "markings", "ability", "personality", "palette", "expressions", "poses", "sheet"]),
  group: Object.freeze(["name", "look", "leader", "markings", "palette", "poses", "sheet"]),
  scene: Object.freeze(["name", "look", "time", "rules", "sheet"]),
});

/**
 * The fields a storyboard or a clip actually consumes (what reaches the
 * model as text or as a reference image). An episode is flagged only when
 * one of THESE changed: rewording a character's personality cannot make a
 * finished clip wrong, so it does not raise the "shot under v1" flag.
 */
export const SHOT_FIELDS = Object.freeze({
  style: Object.freeze(["style", "ratio", "dialogue"]),
  character: Object.freeze(["name", "look", "markings", "sheet"]),
  group: Object.freeze(["name", "look", "leader", "markings", "sheet"]),
  scene: Object.freeze(["name", "look", "time", "rules", "sheet"]),
});

/** The fields a design-sheet prompt consumes, for the "sheet predates the text" check. */
export const SHEET_FIELDS = Object.freeze({
  style: Object.freeze(["style", "sheetStyle"]),
  character: Object.freeze(["name", "look", "expressions", "poses"]),
  group: Object.freeze(["name", "look", "leader", "poses"]),
  scene: Object.freeze(["name", "look", "time", "rules"]),
});

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** JSON with object keys sorted at every depth, so key order never changes a hash. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** FNV-1a 32-bit over UTF-16 code units, as 8 lowercase hex digits. */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function hashValue(value) {
  return fnv1a(canonicalJson(value));
}

/** Normalised field value: an absent field hashes the same as an empty one. */
function fieldValue(entity, field) {
  const raw = entity?.[field];
  const empty = (Array.isArray(raw) && !raw.length) || (isRecord(raw) && !Object.keys(raw).length);
  const value = empty && field === "palette" ? null : raw;
  if (value === undefined || value === null) {
    if (field === "dialogue") return false;
    if (field === "expressions" || field === "poses") return [];
    if (field === "palette") return null;
    if (field === "sheet") return null;
    return "";
  }
  return value;
}

/** `{ field: hash }` for every lock-covered field of one entity. */
export function fieldHashes(kind, entity) {
  const fields = ENTITY_FIELDS[kind];
  if (!fields) throw new Error(`unknown entity kind "${kind}"`);
  const out = {};
  for (const field of fields) out[field] = hashValue(fieldValue(entity, field));
  return out;
}

export function entityKey(kind, id) {
  return kind === STYLE_KEY ? STYLE_KEY : `${kind}:${id}`;
}

export function parseEntityKey(key) {
  if (key === STYLE_KEY) return { kind: STYLE_KEY, id: null };
  const at = key.indexOf(":");
  if (at < 0) return null;
  const kind = key.slice(0, at);
  if (!ENTITY_KINDS.includes(kind)) return null;
  return { kind, id: key.slice(at + 1) };
}

const LIST_OF = { character: "characters", group: "groups", scene: "scenes" };

/** The bible's entities in a fixed order: style, characters, groups, scenes. */
export function bibleEntities(bible) {
  const out = [{ key: STYLE_KEY, kind: STYLE_KEY, id: null, name: "style", entity: bible ?? {} }];
  for (const kind of ENTITY_KINDS) {
    for (const entity of Array.isArray(bible?.[LIST_OF[kind]]) ? bible[LIST_OF[kind]] : []) {
      out.push({ key: entityKey(kind, entity?.id), kind, id: entity?.id, name: entity?.name || entity?.id, entity });
    }
  }
  return out;
}

export function findEntity(bible, kind, id) {
  if (kind === STYLE_KEY) return bible ?? null;
  const list = bible?.[LIST_OF[kind]];
  return Array.isArray(list) ? list.find((entity) => entity?.id === id) ?? null : null;
}

/** Current per-field hashes of every entity: `{ [entityKey]: { [field]: hash } }`. */
export function bibleFieldHashes(bible) {
  const out = {};
  for (const { key, kind, entity } of bibleEntities(bible)) out[key] = fieldHashes(kind, entity);
  return out;
}

/** One hash per entity, over its lock-covered fields. */
export function entityHashOf(fields) {
  return hashValue(fields);
}

// ---------------------------------------------------------------------------
// Locks and versions
// ---------------------------------------------------------------------------

/** The lock with the highest version, or null when nothing was ever locked. */
export function latestLock(bible) {
  const locks = Array.isArray(bible?.locks) ? bible.locks : [];
  let best = null;
  for (const lock of locks) {
    if (lock && Number.isInteger(lock.version) && (!best || lock.version > best.version)) best = lock;
  }
  return best;
}

/** The bible's version: the latest lock's number, 0 when never locked. */
export function bibleVersion(bible) {
  return latestLock(bible)?.version ?? 0;
}

/**
 * The lock to append when the human presses "lock": the next version, the
 * time, and the per-entity / per-field hashes of the bible as it stands.
 * The caller appends it to `bible.locks`; nothing else changes.
 */
export function lockEntry(bible, at) {
  const fields = bibleFieldHashes(bible);
  const hashes = {};
  for (const [key, value] of Object.entries(fields)) hashes[key] = entityHashOf(value);
  return { version: bibleVersion(bible) + 1, at, hashes, fields };
}

/**
 * Whether a field differs from what a lock (or a basis) recorded. A field
 * the record does not have — one added to the rules after it was written,
 * such as a scene's `rules` — counts as unchanged while it is still empty:
 * adding a field must not mark every old lock edited.
 */
function fieldDiffers(recorded, field, hash) {
  if (recorded[field] === undefined) return hash !== hashValue(fieldValue({}, field));
  return recorded[field] !== hash;
}

/**
 * Per entity: `unlocked` (no lock has ever covered it), `locked` (every field
 * matches the latest lock) or `edited` (with the fields that differ).
 */
export function lockStates(bible) {
  const lock = latestLock(bible);
  const current = bibleFieldHashes(bible);
  const out = {};
  for (const [key, fields] of Object.entries(current)) {
    const locked = lock?.fields?.[key];
    if (!locked) {
      out[key] = { state: "unlocked", version: null, changed: [] };
      continue;
    }
    const changed = Object.keys(fields).filter((field) => fieldDiffers(locked, field, fields[field]));
    out[key] = { state: changed.length ? "edited" : "locked", version: lock.version, changed };
  }
  return out;
}

// ---------------------------------------------------------------------------
// What a generation consumed, and whether that is still the bible
// ---------------------------------------------------------------------------

/** The bible entities an episode's boards and clips consume, in reference order. */
export function consumedKeys(episode) {
  const keys = [STYLE_KEY];
  for (const id of Array.isArray(episode?.cast) ? episode.cast : []) keys.push(entityKey("character", id));
  for (const id of Array.isArray(episode?.groups) ? episode.groups : []) keys.push(entityKey("group", id));
  if (episode?.scene) keys.push(entityKey("scene", episode.scene));
  return keys;
}

function pickFields(all, kind, wanted) {
  const out = {};
  for (const field of wanted[kind] ?? []) if (all && field in all) out[field] = all[field];
  return out;
}

/**
 * The record a board or a clip carries in the sidecar: the bible version it
 * was made under and the hashes of exactly the fields it consumed.
 */
export function shotBasis(bible, episode) {
  const current = bibleFieldHashes(bible);
  const fields = {};
  for (const key of consumedKeys(episode)) {
    const parsed = parseEntityKey(key);
    if (!parsed || !current[key]) continue;
    fields[key] = pickFields(current[key], parsed.kind, SHOT_FIELDS);
  }
  return { version: bibleVersion(bible), fields };
}

/** The record a design sheet carries: its own entity plus the style it was drawn in. */
export function sheetBasis(bible, kind, id) {
  const current = bibleFieldHashes(bible);
  const key = entityKey(kind, id);
  const fields = {};
  if (current[STYLE_KEY]) fields[STYLE_KEY] = pickFields(current[STYLE_KEY], STYLE_KEY, SHEET_FIELDS);
  if (current[key]) fields[key] = pickFields(current[key], kind, SHEET_FIELDS);
  return { version: bibleVersion(bible), fields };
}

/**
 * What the bible says now, for comparing a recorded basis: the latest lock
 * when there is one ("new episodes are shot by the locked bible"), the
 * current text when nothing was ever locked.
 */
function referenceFields(bible) {
  return latestLock(bible)?.fields ?? bibleFieldHashes(bible);
}

/** The entity keys and fields where `basis` differs from the reference bible. */
export function basisChanges(bible, basis) {
  const reference = referenceFields(bible);
  const names = Object.fromEntries(bibleEntities(bible).map((e) => [e.key, e.name]));
  const changes = [];
  for (const [key, recorded] of Object.entries(basis?.fields ?? {})) {
    const now = reference[key];
    if (!now) {
      changes.push({ key, name: names[key] ?? key, fields: ["(removed)"] });
      continue;
    }
    // Only what the record consumed is compared; a lock written before a
    // field existed reads as that field left empty (fieldDiffers).
    const fields = Object.keys(recorded).filter((field) => fieldDiffers(now, field, recorded[field]));
    if (fields.length) changes.push({ key, name: names[key] ?? key, fields });
  }
  return changes;
}

/**
 * The episode flag: was this take shot under a bible that no longer holds?
 * Never blocks anything; it only refuses to stay silent. An acknowledgement
 * (`picks.acknowledgedBibleVersion`) at or past the latest version quiets it.
 */
export function bibleFlag(bible, basis, acknowledgedVersion = null) {
  const latest = bibleVersion(bible);
  const changes = basis ? basisChanges(bible, basis) : [];
  const acknowledged = Number.isInteger(acknowledgedVersion) && acknowledgedVersion >= latest && latest > 0;
  return {
    stale: changes.length > 0 && !acknowledged,
    shotUnder: basis?.version ?? null,
    latest,
    changes,
    acknowledged: changes.length > 0 && acknowledged,
  };
}

// ---------------------------------------------------------------------------
// Shot-list staleness (board or shot list edited after the take)
// ---------------------------------------------------------------------------

/** What a storyboard panel consumes from a shot. */
export function boardShotHash(shot) {
  return hashValue({ panel: String(shot?.sketch || shot?.desc || "") });
}

/** What a clip consumes from a shot. */
export function clipShotHash(shot) {
  return hashValue({ dur: Number(shot?.dur) || 0, desc: String(shot?.desc ?? ""), sfx: String(shot?.sfx ?? "") });
}

/** The episode-level setup a clip consumes (place, time, continuity, who is in it). */
export function setupHash(episode) {
  return hashValue({
    duration: episode?.duration ?? null,
    cast: episode?.cast ?? [],
    groups: episode?.groups ?? [],
    scene: episode?.scene ?? null,
    time: episode?.time ?? "",
    continuity: episode?.continuity ?? [],
  });
}

export function boardShotHashes(part) {
  return (part?.shots ?? []).map(boardShotHash);
}

export function clipShotHashes(part) {
  return (part?.shots ?? []).map(clipShotHash);
}

/**
 * 1-based shot numbers whose recorded hash no longer matches. A changed
 * shot count marks every shot: panel numbering itself moved.
 */
export function staleShots(recorded, current) {
  if (!Array.isArray(recorded)) return [];
  if (recorded.length !== current.length) return current.map((_, i) => i + 1);
  const out = [];
  for (let i = 0; i < current.length; i += 1) if (recorded[i] !== current[i]) out.push(i + 1);
  return out;
}

/**
 * The shots the cut in effect shows from an older shot list: a shot spliced
 * from an applied patch is current when the patch's recorded hash matches
 * the shot as it stands (the patch re-shot it), every other shot when the
 * take's does. `current` is `clipShotHashes(part)`. A take shot with another
 * shot count marks every shot; a take with no record marks none.
 */
export function cutStaleShots(take, slots, statusOf, current) {
  if (!take || !Array.isArray(take.shots)) return [];
  if (take.shots.length !== current.length) return current.map((_, i) => i + 1);
  const { kept } = appliedPatches(slots, take.asset, statusOf);
  const out = [];
  current.forEach((hash, i) => {
    const shot = i + 1;
    const patch = kept.find((p) => shot >= p.shots[0] && shot <= p.shots[1]);
    const recorded = patch ? (Array.isArray(patch.shotHashes) && patch.shotHashes.length === current.length ? patch.shotHashes[i] : null) : take.shots[i];
    if (recorded !== hash) out.push(shot);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Timing: grids, conservation, rebalancing, spans
// ---------------------------------------------------------------------------

/** Rows × cols for a panel count: the tidy table, else the nearest square. */
export function gridOf(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`panel count must be a positive integer (got: ${n})`);
  const tidy = GRIDS[n];
  if (tidy) return { rows: tidy[0], cols: tidy[1], tidy: true };
  const cols = Math.ceil(Math.sqrt(n));
  return { rows: Math.ceil(n / cols), cols, tidy: false };
}

/** `3`, `2.5`, `3.3` — seconds as a short string. */
export function fmtSeconds(x) {
  return String(Math.round(Number(x) * 10) / 10);
}

const tenths = (seconds) => Math.round(Number(seconds) * 10);
const fromTenths = (t) => t / 10;

export function partCountFor(duration) {
  return Math.max(1, Math.ceil(Number(duration) / PART_MAX_S));
}

/** Seconds each part must add up to: duration ÷ parts. */
export function partSeconds(episode) {
  const parts = Array.isArray(episode?.parts) ? episode.parts.length : 0;
  return parts ? Number(episode.duration) / parts : Number(episode?.duration);
}

/** `[{ shot, start, end, dur }]` within one part, 1-based shots, part clock. */
export function shotTimeline(shots) {
  let t = 0;
  return (shots ?? []).map((shot, i) => {
    const start = fromTenths(t);
    t += tenths(shot.dur);
    return { shot: i + 1, start, end: fromTenths(t), dur: fromTenths(tenths(shot.dur)) };
  });
}

function issue(level, code, message, where = {}) {
  return { level, code, message, ...where };
}

/**
 * The timing rules for one episode. `errors` block prompts and paid work;
 * `warnings` are advice. An episode with no parts is a draft: it has a
 * single `no-shots` error and nothing else.
 */
export function checkEpisode(episode) {
  const errors = [];
  const warnings = [];
  const duration = Number(episode?.duration);
  const parts = Array.isArray(episode?.parts) ? episode.parts : [];
  if (!(duration > 0)) errors.push(issue("error", "duration", `duration must be a positive number of seconds (got: ${episode?.duration})`));
  if (!parts.length || parts.every((p) => !Array.isArray(p?.shots) || !p.shots.length)) {
    errors.push(issue("error", "no-shots", "the episode has no shots yet"));
    return { errors, warnings };
  }
  if (parts.length > PART_IDS.length) errors.push(issue("error", "too-many-parts", `at most ${PART_IDS.length} parts`));
  const per = duration / parts.length;
  if (duration > 0) {
    if (per > PART_MAX_S + 1e-9) {
      errors.push(issue("error", "part-too-long", `each part would be ${fmtSeconds(per)} s; one generation renders at most ${PART_MAX_S} s — use ${partCountFor(duration)} parts`));
    }
    if (per < PART_MIN_S - 1e-9) errors.push(issue("error", "part-too-short", `each part would be ${fmtSeconds(per)} s; one generation renders at least ${PART_MIN_S} s`));
    if (Math.abs(per - Math.round(per)) > 1e-9) {
      errors.push(issue("error", "part-not-whole", `each part would be ${fmtSeconds(per)} s; a generation renders whole seconds — pick a duration that divides evenly into ${parts.length} part(s)`));
    }
  }
  parts.forEach((part, k) => {
    const id = part?.id ?? PART_IDS[k];
    if (id !== PART_IDS[k]) errors.push(issue("error", "part-id", `part ${k + 1} must have id "${PART_IDS[k]}" (got: ${JSON.stringify(part?.id)})`, { part: id }));
    const shots = Array.isArray(part?.shots) ? part.shots : [];
    if (!shots.length) {
      errors.push(issue("error", "no-shots", `part ${id} has no shots`, { part: id }));
      return;
    }
    shots.forEach((shot, i) => {
      const dur = Number(shot?.dur);
      if (!Number.isFinite(dur)) {
        errors.push(issue("error", "shot-dur", `part ${id} shot ${i + 1} has no duration`, { part: id, shot: i + 1 }));
      } else if (dur < SHOT_MIN_S - 1e-9) {
        errors.push(issue("error", "shot-too-short", `part ${id} shot ${i + 1} is ${fmtSeconds(dur)} s; every shot needs at least ${SHOT_MIN_S} s or its action cannot finish`, { part: id, shot: i + 1 }));
      } else if (dur > SHOT_LONG_S + 1e-9) {
        warnings.push(issue("warning", "shot-long", `part ${id} shot ${i + 1} is ${fmtSeconds(dur)} s; a dialogue-free action shot past ${SHOT_LONG_S} s tends to drag`, { part: id, shot: i + 1 }));
      }
      if (!String(shot?.desc ?? "").trim()) errors.push(issue("error", "shot-desc", `part ${id} shot ${i + 1} has no desc`, { part: id, shot: i + 1 }));
    });
    const total = shots.reduce((sum, s) => sum + tenths(s?.dur), 0);
    if (duration > 0 && Math.abs(fromTenths(total) - per) > 0.01) {
      errors.push(issue("error", "part-sum", `part ${id} shots add up to ${fmtSeconds(fromTenths(total))} s; they must add up to ${fmtSeconds(per)} s (duration ${fmtSeconds(duration)} ÷ ${parts.length} part(s))`, { part: id }));
    }
    if (!GRIDS[shots.length]) {
      warnings.push(issue("warning", "odd-grid", `part ${id} has ${shots.length} shots, which do not make a tidy storyboard grid — 6 or 9 work best`, { part: id }));
    }
  });
  return { errors, warnings };
}

/**
 * Change one shot's duration and let its neighbours absorb the difference,
 * so the part's total never moves. `index` is 0-based. `from`:
 *   "both" (default) — split evenly between the previous and next shot
 *   "next" / "prev"  — only that neighbour
 * A neighbour that would fall below SHOT_MIN_S passes the rest to the other;
 * when neither can, it throws naming the largest duration that fits.
 * Arithmetic is in tenths of a second, so totals never drift.
 */
export function rebalance(shots, index, dur, from = "both") {
  if (!Array.isArray(shots) || !shots[index]) throw new Error(`no shot ${index + 1}`);
  if (!["both", "next", "prev"].includes(from)) throw new Error(`--from must be both, next or prev (got: ${from})`);
  const want = tenths(dur);
  if (!Number.isFinite(want) || want < tenths(SHOT_MIN_S)) throw new Error(`a shot needs at least ${SHOT_MIN_S} s (asked: ${fmtSeconds(dur)} s)`);
  const t = shots.map((s) => tenths(s.dur));
  const delta = want - t[index];
  const out = shots.map((s) => ({ ...s }));
  if (delta === 0) return out;
  const neighbours = [];
  if (from !== "next" && index > 0) neighbours.push(index - 1);
  if (from !== "prev" && index < shots.length - 1) neighbours.push(index + 1);
  if (!neighbours.length) {
    throw new Error(shots.length === 1
      ? "the only shot in a part cannot change length on its own — change the episode duration instead"
      : `shot ${index + 1} has no ${from === "next" ? "next" : "previous"} shot to take the difference`);
  }
  const floor = tenths(SHOT_MIN_S);
  // How much each neighbour gives up (positive) or receives (negative).
  const shares = neighbours.length === 2 ? [Math.trunc(delta / 2), delta - Math.trunc(delta / 2)] : [delta];
  if (delta > 0) {
    const capacity = neighbours.map((n) => t[n] - floor);
    const total = capacity.reduce((a, b) => a + b, 0);
    if (delta > total) {
      throw new Error(`shot ${index + 1} can grow to at most ${fmtSeconds(fromTenths(t[index] + total))} s — its neighbour${neighbours.length > 1 ? "s" : ""} cannot go below ${SHOT_MIN_S} s`);
    }
    // Spill what one neighbour cannot give onto the other.
    if (shares.length === 2) {
      for (const [a, b] of [[0, 1], [1, 0]]) {
        if (shares[a] > capacity[a]) {
          shares[b] += shares[a] - capacity[a];
          shares[a] = capacity[a];
        }
      }
    }
  }
  neighbours.forEach((n, k) => {
    t[n] -= shares[k];
  });
  t[index] = want;
  return out.map((s, i) => ({ ...s, dur: fromTenths(t[i]) }));
}

/**
 * Re-shooting shots a–b (1-based, inclusive) of one part.
 *
 * A generation is at least PART_MIN_S whole seconds, so a span shorter than
 * that is widened by its following shots (or preceding ones at the end of
 * the part); only the original a–b is spliced back. Returns where the span
 * sits in the part (`span`), which shots the patch clip actually covers
 * (`covered`), where a–b starts inside the patch clip (`offset`), and the
 * whole seconds to request.
 */
export function patchPlan(shots, a, b, minSeconds = PART_MIN_S) {
  const n = shots?.length ?? 0;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a || b > n) {
    throw new Error(`shots must be a range within 1–${n} (got: ${a}–${b})`);
  }
  const line = shotTimeline(shots);
  let lo = a;
  let hi = b;
  const span = () => tenths(line[hi - 1].end) - tenths(line[lo - 1].start);
  const floor = tenths(minSeconds);
  while (span() < floor && (hi < n || lo > 1)) {
    if (hi < n) hi += 1;
    else lo -= 1;
  }
  const covered = fromTenths(span());
  return {
    shots: [a, b],
    covered: [lo, hi],
    extended: lo !== a || hi !== b,
    span: [line[a - 1].start, line[b - 1].end],
    offset: fromTenths(tenths(line[a - 1].start) - tenths(line[lo - 1].start)),
    seconds: covered,
    requestSeconds: Math.max(minSeconds, Math.ceil(covered - 1e-9)),
  };
}

/** How far a splice point may move to meet a scene cut the clip really has. */
export const SNAP_S = 0.5;

/**
 * A planned splice point moved to the nearest detected scene cut within
 * `tolerance` seconds, or left where it is. The model cuts where it cuts —
 * 23.63 s for a shot planned at 24 — and a splice at the planned second
 * keeps a sliver of the old shot before the new one.
 */
export function snapToCut(t, cuts, tolerance = SNAP_S) {
  let best = t;
  let distance = Infinity;
  for (const cut of Array.isArray(cuts) ? cuts : []) {
    const d = Math.abs(Number(cut) - t);
    if (Number.isFinite(d) && d <= tolerance + 1e-9 && d < distance) {
      best = Number(cut);
      distance = d;
    }
  }
  return best;
}

/**
 * The ends of a splice span `[a, b]` (seconds on the clip's clock) that have
 * no detected scene cut within `tolerance`. A patch splices cleanly only
 * where the take itself cuts; an end inside one continuous shot (a tracking
 * shot, or panels the model merged) shows as a jump. The start and the end
 * of the clip are not splice points and never count, with the same 0.05 s
 * margin the final's snapping uses. `length` null means unknown: only the
 * start is excluded then.
 */
export function uncutSpliceEnds(span, cuts, length = null, tolerance = SNAP_S) {
  const list = (Array.isArray(cuts) ? cuts : []).map(Number).filter(Number.isFinite);
  const interior = (t) => t > 0.05 && (length === null || t < length - 0.05);
  return span.filter((t) => interior(t) && !list.some((cut) => Math.abs(cut - t) <= tolerance + 1e-9));
}

// ---------------------------------------------------------------------------
// Picks, checks, ideas, stage
// ---------------------------------------------------------------------------

/**
 * Which candidate is in effect: the human's pick when it is ready, else the
 * newest ready candidate (and `picked: false` says so), else null.
 */
export function effectivePick(picked, candidates, statusOf) {
  const ready = (id) => typeof id === "string" && statusOf(id) === "ready";
  if (ready(picked) && candidates.includes(picked)) return { asset: picked, picked: true };
  for (let i = candidates.length - 1; i >= 0; i -= 1) if (ready(candidates[i])) return { asset: candidates[i], picked: false };
  return { asset: null, picked: false };
}

/**
 * The key of a cast member or a group in `checks[asset][shot]` and in
 * `picks.acceptedDrift[].character`: a character by its id, a group as
 * `group:<id>` (ids never contain ":", so the two cannot collide).
 */
export function cellKey(kind, id) {
  return kind === "group" ? `group:${id}` : id;
}

/** `{ kind, id }` of a cell key. */
export function parseCellKey(key) {
  const k = String(key ?? "");
  return k.startsWith("group:") ? { kind: "group", id: k.slice(6) } : { kind: "character", id: k };
}

/**
 * Whether `text` names `name`. A Latin name matches as a whole word,
 * case aside; a Han name anywhere it occurs, except inside one of
 * `exclusions` — ordinary words that contain the name without meaning the
 * entity (冷蓝光 is the screens' light, not 光). One-character Han names get
 * the built-in compounds of `name-words.mjs` on top. Anything else is not a
 * mention: the caller treats that as "cannot tell", never as "absent".
 */
export function namesEntity(text, name, exclusions = []) {
  const t = String(text ?? "");
  const n = String(name ?? "").trim();
  if (!t || !n) return false;
  if (/^[\x20-\x7e]+$/.test(n)) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`, "i").test(t);
  }
  const words = [...exclusions, ...([...n].length === 1 ? CHARACTER_COMPOUNDS[n] ?? [] : [])]
    .map((w) => String(w ?? "").trim())
    .filter((w) => w.length > n.length && w.includes(n));
  const insideAWord = (at) => words.some((w) => {
    for (let k = w.indexOf(n); k >= 0; k = w.indexOf(n, k + 1)) {
      if (at - k >= 0 && t.startsWith(w, at - k)) return true;
    }
    return false;
  });
  for (let i = t.indexOf(n); i >= 0; i = t.indexOf(n, i + 1)) {
    if (!insideAWord(i)) return true;
  }
  return false;
}

/**
 * Everything that names an entity in shot text: its name, its id, its
 * `aliases`, and for a group with a `leader` the leader's role word
 * (`name-words.mjs`). `notNames` are the entity's own exclusions.
 */
export function entityNames(entity) {
  const list = (value) => (Array.isArray(value) ? value.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
  const names = [entity?.name, ...list(entity?.aliases)].map((x) => String(x ?? "").trim()).filter(Boolean);
  if (String(entity?.leader ?? "").trim()) names.push(...LEADER_WORDS);
  if (!names.length && entity?.id) names.push(entity.id);
  return { names: [...new Set(names)], exclusions: list(entity?.notNames) };
}

/**
 * Whether a shot is expected to show an entity, from its own words: `true`
 * when `desc` or `sketch` names it, `null` (cannot tell) otherwise — a
 * shot that does not name someone may still show them.
 */
export function expectedIn(shot, entity) {
  const { names, exclusions } = entityNames(entity);
  const named = (text) => names.some((name) => namesEntity(text, name, exclusions));
  return named(shot?.desc) || named(shot?.sketch) ? true : null;
}

/**
 * The patches `final` splices into a take: ready patches of that take,
 * newest first, each kept unless it overlaps (in the take's seconds) one
 * already kept. `kept` is in clip order.
 */
export function appliedPatches(slots, take, statusOf) {
  const kept = [];
  const dropped = [];
  for (const patch of [...(slots?.patches ?? [])].reverse()) {
    if (patch?.take !== take || statusOf(patch.asset) !== "ready" || !Array.isArray(patch.span)) continue;
    const overlaps = kept.some((k) => patch.span[0] < k.span[1] && k.span[0] < patch.span[1]);
    (overlaps ? dropped : kept).push(patch);
  }
  return { kept: kept.sort((a, b) => a.span[0] - b.span[0]), dropped };
}

function castAndGroups(episode, bible) {
  const cast = (Array.isArray(episode?.cast) ? episode.cast : []).map((id) => ({ kind: "character", id, entity: findEntity(bible, "character", id) }));
  const groups = (Array.isArray(episode?.groups) ? episode.groups : []).map((id) => ({ kind: "group", id, entity: findEntity(bible, "group", id) }));
  return [...cast, ...groups];
}

function cellsFor(episode, partId, sourceOf, checksOf, acceptedDrift, bible) {
  const part = (episode?.parts ?? []).find((p) => p?.id === partId);
  const who = castAndGroups(episode, bible);
  const cells = [];
  (part?.shots ?? []).forEach((shot, i) => {
    const source = sourceOf(i + 1);
    for (const w of who) {
      const key = cellKey(w.kind, w.id);
      const recorded = checksOf(source)?.[String(i + 1)]?.[key];
      const verdict = recorded && VERDICTS.includes(recorded.verdict) ? recorded.verdict : "unverified";
      const accepted = verdict === "drift" && (acceptedDrift ?? []).some((d) => d?.take === source && d?.shot === i + 1 && d?.character === key);
      cells.push({
        shot: i + 1,
        kind: w.kind,
        id: w.id,
        character: key,
        verdict,
        note: recorded?.note ?? "",
        frame: recorded?.frame ?? null,
        accepted,
        expected: bible ? expectedIn(shot, w.entity ?? { id: w.id }) : null,
        source,
      });
    }
  });
  return cells;
}

/**
 * Every shot × cast-member and shot × group cell of one take: recorded
 * verdict, or `unverified` — never assumed fine. `checks` is the sidecar's
 * `checks[takeId]` map (`{ [shot]: { [cellKey]: Check } }`). `accepted`
 * marks a drift the human chose to keep for THIS take (`picks.acceptedDrift`
 * entries are `{ take, shot, character: cellKey }`). With `bible`, each cell
 * says whether the shot's words name the entity (`expected`).
 *
 * `character` is the cell key (a character id, or `group:<id>`); `kind`
 * and `id` name the entity.
 */
export function checkCells(episode, partId, takeId, checks, acceptedDrift = [], { bible = null } = {}) {
  return cellsFor(episode, partId, () => takeId, () => checks, acceptedDrift, bible);
}

/**
 * The cells of the cut a part's final actually shows: shots spliced from an
 * applied patch are judged on that patch (`source` is the patch asset, and
 * a verdict recorded on the take does not carry over — the frames are
 * different), every other shot on the take.
 */
export function partCells(episode, partId, slots, takeId, statusOf, acceptedDrift = [], { bible = null } = {}) {
  const { kept } = appliedPatches(slots, takeId, statusOf);
  const sourceOf = (shot) => kept.find((p) => shot >= p.shots[0] && shot <= p.shots[1])?.asset ?? takeId;
  return cellsFor(episode, partId, sourceOf, (source) => slots?.checks?.[source], acceptedDrift, bible);
}

/**
 * The derived "already made" record (no separate log file): one row per
 * episode with a log, and the distinct locations, goals, abilities and
 * endings — what a new idea should avoid repeating.
 */
export function usedIdeas(bible, episodes) {
  const scenes = Object.fromEntries((bible?.scenes ?? []).map((s) => [s.id, s.name || s.id]));
  const rows = [];
  for (const episode of episodes ?? []) {
    const log = episode?.log;
    if (!log || !(log.goal || log.ending || (log.abilities ?? []).length)) continue;
    rows.push({
      episode: episode.id,
      title: episode.title ?? "",
      location: log.location || (episode.scene ? scenes[episode.scene] ?? episode.scene : ""),
      goal: log.goal ?? "",
      abilities: Array.isArray(log.abilities) ? log.abilities : [],
      ending: log.ending ?? "",
    });
  }
  const distinct = (values) => [...new Set(values.filter(Boolean))];
  return {
    episodes: rows,
    locations: distinct(rows.map((r) => r.location)),
    goals: distinct(rows.map((r) => r.goal)),
    abilities: distinct(rows.flatMap((r) => r.abilities)),
    endings: distinct(rows.map((r) => r.ending)),
  };
}

const BUSY = new Set(["pending", "generating"]);

/**
 * Where an episode stands, derived — never stored:
 *   draft     no shots yet
 *   planned   shots written; some part has no ready storyboard
 *   boarded   every part has a storyboard; some part has no ready take
 *   shot      every part has a take; some take has no contact sheet
 *   reviewed  every take has a contact sheet; no final built from these
 *             takes, or one is built but some check is still unverified
 *   done      a ready final built from the takes in effect, and every
 *             shot × cast / group cell of the cut it shows has a verdict
 * `busy` is true while any of its generations is pending or generating;
 * `unverified` counts the cells without a verdict (patched shots judged on
 * their patch); `finalReady` says a current final exists — with
 * `unverified > 0` that is "built, not done".
 */
export function episodeStage(episode, slots, statusOf) {
  const parts = Array.isArray(episode?.parts) ? episode.parts : [];
  const all = [];
  const collect = (list) => {
    for (const record of list ?? []) if (record?.asset) all.push(record.asset);
  };
  for (const part of Object.values(slots?.parts ?? {})) {
    collect(part?.boards);
    collect(part?.panels);
    collect(part?.takes);
    collect(part?.patches);
    collect(part?.reviews);
  }
  collect(slots?.finals);
  const busy = all.some((id) => BUSY.has(statusOf(id)));
  const at = (stage, extra = {}) => ({ stage, busy, unverified: 0, finalReady: false, ...extra });
  if (!parts.length || parts.every((p) => !(p?.shots ?? []).length)) return at("draft");
  const picks = episode?.picks ?? {};
  const boards = [];
  const takes = [];
  for (const part of parts) {
    const s = slots?.parts?.[part.id];
    boards.push(effectivePick(picks.storyboard?.[part.id], (s?.boards ?? []).map((r) => r.asset), statusOf).asset);
    takes.push(effectivePick(picks.take?.[part.id], (s?.takes ?? []).map((r) => r.asset), statusOf).asset);
  }
  if (boards.some((b) => !b)) return at("planned");
  if (takes.some((t) => !t)) return at("boarded");
  const unverified = parts.reduce((sum, part, i) => sum + partCells(episode, part.id, slots?.parts?.[part.id], takes[i], statusOf, picks.acceptedDrift ?? [])
    .filter((c) => c.verdict === "unverified").length, 0);
  const reviewed = parts.every((part, i) => (slots?.parts?.[part.id]?.reviews ?? []).some((r) => r.take === takes[i] && statusOf(r.asset) === "ready"));
  if (!reviewed) return at("shot", { unverified });
  const finals = slots?.finals ?? [];
  const finalReady = finals.some((f) => statusOf(f.asset) === "ready" && parts.every((part, i) => f.takes?.[part.id] === takes[i]));
  return at(finalReady && unverified === 0 ? "done" : "reviewed", { unverified, finalReady });
}

// ---------------------------------------------------------------------------
// File checks (bible.json / episode.json are hand-editable: check, never trust)
// ---------------------------------------------------------------------------

/**
 * Structural problems in bible.json, each a sentence naming the field. An
 * empty list means every rule above can read it.
 */
export function checkBible(bible) {
  const problems = [];
  if (!isRecord(bible)) return ["bible.json must be a JSON object"];
  for (const field of ["title", "ratio", "style", "sheetStyle"]) {
    if (bible[field] !== undefined && typeof bible[field] !== "string") problems.push(`${field} must be a string`);
  }
  if (bible.dialogue !== undefined && typeof bible.dialogue !== "boolean") problems.push("dialogue must be true or false");
  if (bible.lang !== undefined && !BIBLE_LANGS.includes(bible.lang)) problems.push(`lang must be one of ${BIBLE_LANGS.join(", ")} (got: ${JSON.stringify(bible.lang)}); leave it out to follow the bible's text`);
  for (const kind of ENTITY_KINDS) {
    const listName = LIST_OF[kind];
    const list = bible[listName];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      problems.push(`${listName} must be an array`);
      continue;
    }
    const seen = new Set();
    list.forEach((entity, i) => {
      const where = `${listName}[${i}]`;
      if (!isRecord(entity)) {
        problems.push(`${where} must be an object`);
        return;
      }
      if (typeof entity.id !== "string" || !ENTITY_ID_RE.test(entity.id)) problems.push(`${where}.id must match ${ENTITY_ID_RE} (got: ${JSON.stringify(entity.id)})`);
      else if (seen.has(entity.id)) problems.push(`${where}.id "${entity.id}" is used twice`);
      else seen.add(entity.id);
      for (const field of ["name", "look"]) if (typeof entity[field] !== "string") problems.push(`${where}.${field} must be a string`);
      for (const field of ["markings", "leader", "time", "rules", "ability", "personality"]) {
        if (entity[field] !== undefined && entity[field] !== null && typeof entity[field] !== "string") problems.push(`${where}.${field} must be a string`);
      }
      if (entity.sheet !== undefined && entity.sheet !== null && typeof entity.sheet !== "string") problems.push(`${where}.sheet must be an asset id or null`);
      for (const field of ["expressions", "poses", "aliases", "notNames"]) {
        if (entity[field] !== undefined && (!Array.isArray(entity[field]) || entity[field].some((v) => typeof v !== "string"))) problems.push(`${where}.${field} must be a list of strings`);
      }
      const palette = entity.palette;
      const paletteOk = palette === undefined || palette === null
        || (Array.isArray(palette) && palette.every((v) => typeof v === "string"))
        || (isRecord(palette) && Object.values(palette).every((v) => typeof v === "string"));
      if (!paletteOk) problems.push(`${where}.palette must be a list of colours or an object of label → colour`);
    });
  }
  if (bible.locks !== undefined) {
    if (!Array.isArray(bible.locks)) problems.push("locks must be an array");
    else bible.locks.forEach((lock, i) => {
      if (!isRecord(lock) || !Number.isInteger(lock.version) || lock.version < 1 || !isRecord(lock.fields)) problems.push(`locks[${i}] must be { version ≥ 1, at, hashes, fields }`);
    });
  }
  return problems;
}

/**
 * Structural problems in one episode.json, plus references to bible ids
 * that do not exist. Timing is `checkEpisode`'s job.
 */
export function checkEpisodeFile(episode, bible = null) {
  const problems = [];
  if (!isRecord(episode)) return ["episode.json must be a JSON object"];
  if (typeof episode.title !== "string") problems.push("title must be a string");
  if (!(Number(episode.duration) > 0)) problems.push("duration must be a positive number of seconds");
  for (const field of ["cast", "groups", "continuity"]) {
    if (episode[field] !== undefined && (!Array.isArray(episode[field]) || episode[field].some((v) => typeof v !== "string"))) problems.push(`${field} must be a list of strings`);
  }
  if (!Array.isArray(episode.cast)) problems.push("cast must be a list of character ids");
  if (episode.scene !== undefined && episode.scene !== null && typeof episode.scene !== "string") problems.push("scene must be a scene id or null");
  if (!Array.isArray(episode.parts)) problems.push("parts must be an array");
  else episode.parts.forEach((part, k) => {
    if (!isRecord(part) || !Array.isArray(part.shots)) {
      problems.push(`parts[${k}] must be { id, shots: [] }`);
      return;
    }
    part.shots.forEach((shot, i) => {
      if (!isRecord(shot) || typeof shot.dur !== "number" || typeof shot.desc !== "string") problems.push(`parts[${k}].shots[${i}] must be { dur: number, desc: string, sfx?, sketch? }`);
    });
  });
  if (episode.picks !== undefined && !isRecord(episode.picks)) problems.push("picks must be an object");
  if (bible && isRecord(bible)) {
    const ids = (kind) => new Set((bible[LIST_OF[kind]] ?? []).map((e) => e?.id));
    const characters = ids("character");
    const groups = ids("group");
    const scenes = ids("scene");
    for (const id of Array.isArray(episode.cast) ? episode.cast : []) if (!characters.has(id)) problems.push(`cast "${id}" is not a character in bible.json`);
    for (const id of Array.isArray(episode.groups) ? episode.groups : []) if (!groups.has(id)) problems.push(`group "${id}" is not in bible.json`);
    if (typeof episode.scene === "string" && !scenes.has(episode.scene)) problems.push(`scene "${episode.scene}" is not in bible.json`);
  }
  return problems;
}
