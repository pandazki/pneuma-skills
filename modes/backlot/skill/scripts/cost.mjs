/**
 * cost.mjs — what the film has cost, read off the artefacts themselves.
 *
 * THERE IS NO LEDGER. Every paid record lives beside the thing it paid for
 * — `take.cost`, `board.cost`, `line.cost`, `sheet.cost`,
 * `voice.sample.cost`, `music.cost` — because a ledger is a second copy of
 * the truth that can drift from it, and because a record written next to the
 * artefact survives a script that crashed before it could append anywhere
 * else. This module is the ONE reading of those records: `backlot.mjs cost`
 * and `status` use it, and `domain.ts` can project the same lines into the
 * viewer's Cost tab rather than growing a second interpretation.
 *
 * Pure: the same `texts` map `stage-state.mjs` takes (project-relative path
 * → file text), no I/O, no clock.
 *
 * `basis` says where a number came from and is never guessed:
 *   "table"    — a published price table (the Seedance per-second rows);
 *   "reported" — the vendor's own `usage.cost` for that call;
 *   "estimate" — somebody's estimate, and labelled as one.
 * A record with no cost is UNPRICED, never free: nobody can tell from here
 * whether the call was cheap or simply unrecorded.
 */

import { STAGES } from "./stage-state.mjs";

export const COST_KINDS = ["image", "tts", "music", "take"];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parse(text) {
  if (typeof text !== "string") return null;
  try {
    const value = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function keysUnder(texts, prefix, suffix) {
  return Object.keys(texts)
    .filter((key) => key.startsWith(prefix) && key.endsWith(suffix))
    .sort();
}

function idFromPath(path, prefix, suffix) {
  return path.slice(prefix.length, path.length - suffix.length);
}

/**
 * One paid call. `usd` is null when the record carries no price — the line
 * still exists, because a call that happened and was not priced is exactly
 * what a cost view must not hide.
 */
function line(stage, kind, label, ref, cost, at = null) {
  const usd = isRecord(cost) && Number.isFinite(Number(cost.usd)) ? round(Number(cost.usd)) : null;
  const basis = isRecord(cost) && typeof cost.basis === "string" ? cost.basis : null;
  return {
    stage,
    kind,
    label,
    ref,
    usd,
    // The basis VERBATIM, plus which of the three provenances it is: a
    // take's basis is the price table's own sentence, and a cost view has
    // to be able to group it without re-parsing that sentence itself.
    basis,
    source: basisSource(basis),
    at: at ?? null,
  };
}

/**
 * Every paid call the project's files record, in stage order.
 *
 * A take's `basis` is the price table's own sentence ("(8 s out + 8 s ref) x
 * $0.1323/s at 480p"); `source` normalises it to the three words a cost view
 * groups by, without throwing the sentence away.
 */
export function costLines(texts = {}) {
  const lines = [];
  const manifest = parse(texts["backlot.json"]);
  const shotOrder = manifest && Array.isArray(manifest.shots) ? manifest.shots.map(String) : [];

  // Bible — sheets, set concepts and voice samples.
  for (const path of keysUnder(texts, "bible/characters/", "/character.json")) {
    const id = idFromPath(path, "bible/characters/", "/character.json");
    const doc = parse(texts[path]);
    if (!doc) continue;
    const name = typeof doc.name === "string" && doc.name ? doc.name : id;
    if (isRecord(doc.sheet)) {
      lines.push(line("bible", "image", `${name} — character sheet`, `bible/characters/${id}/${doc.sheet.file ?? "sheet.png"}`, doc.sheet.cost, doc.sheet.at));
    }
    const sample = isRecord(doc.voice) && isRecord(doc.voice.sample) ? doc.voice.sample : null;
    if (sample) {
      lines.push(line("bible", "tts", `${name} — voice sample`, `bible/characters/${id}/${sample.file ?? "voice.mp3"}`, sample.cost, sample.at));
    }
  }
  for (const path of keysUnder(texts, "bible/sets/", "/set.json")) {
    const id = idFromPath(path, "bible/sets/", "/set.json");
    const doc = parse(texts[path]);
    if (!doc) continue;
    const name = typeof doc.name === "string" && doc.name ? doc.name : id;
    if (isRecord(doc.concept)) {
      lines.push(line("bible", "image", `${name} — set concept`, `bible/sets/${id}/${doc.concept.file ?? "concept.png"}`, doc.concept.cost, doc.concept.at));
    }
  }

  // Shots — board frames, takes, and the voice-over recorded on their lines.
  const shotPaths = keysUnder(texts, "shots/", "/shot.json");
  const ordered = [
    ...shotOrder.map((id) => `shots/${id}/shot.json`).filter((path) => shotPaths.includes(path)),
    ...shotPaths.filter((path) => !shotOrder.includes(idFromPath(path, "shots/", "/shot.json"))),
  ];
  for (const path of ordered) {
    const id = idFromPath(path, "shots/", "/shot.json");
    const shot = parse(texts[path]);
    if (!shot) continue;
    if (isRecord(shot.board)) {
      lines.push(line("boards", "image", `${id} — board frame`, `shots/${id}/${shot.board.file ?? "board.png"}`, shot.board.cost, shot.board.at));
    }
    // Anchor frames are rendered from the accepted greybox, so they are
    // previz-stage spend: a paid call the cost view must never lose.
    for (const anchor of Array.isArray(shot.anchors) ? shot.anchors.filter(isRecord) : []) {
      lines.push(line("previz", "image", `${id} — anchor ${anchor.id ?? "?"}`, `shots/${id}/${anchor.file ?? `anchors/${anchor.id ?? "first"}.png`}`, anchor.cost, anchor.createdAt ?? null));
    }
    for (const take of Array.isArray(shot.takes) ? shot.takes.filter(isRecord) : []) {
      // A `failed` take is still a paid one: its request left the machine.
      lines.push(
        line(
          "takes",
          "take",
          `${id} — ${take.id ?? "take"}${take.status && take.status !== "done" ? ` (${take.status})` : ""}`,
          `shots/${id}/${take.file ?? `takes/${take.id ?? "take"}.mp4`}`,
          take.cost,
          take.submittedAt ?? null,
        ),
      );
    }
    for (const entry of Array.isArray(shot.lines) ? shot.lines.filter(isRecord) : []) {
      if (!isRecord(entry.cost)) continue;
      // `line.at` is WHERE the line lands in the shot, not when it was
      // recorded — `recordedAt` is the timestamp.
      lines.push(line("sound", "tts", `${id} — line ${entry.id ?? "?"} (${entry.speaker ?? "?"})`, entry.file ? `shots/${id}/${entry.file}` : `shots/${id}/shot.json`, entry.cost, entry.recordedAt ?? null));
    }
  }

  // Sound — the music bed.
  const sound = parse(texts["sound/sound.json"]);
  if (sound && isRecord(sound.music)) {
    lines.push(line("sound", "music", "Music bed", `sound/${sound.music.file ?? "music.mp3"}`, sound.music.cost, sound.music.at));
  }

  return lines.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
}

/** Which of the three provenances a `basis` sentence belongs to. */
export function basisSource(basis) {
  const text = String(basis ?? "").toLowerCase();
  if (!text) return null;
  if (text.includes("reported")) return "reported";
  if (text.includes("estimate")) return "estimate";
  // The Seedance rows spell themselves out ("(8 s out + 8 s ref) x $0.1323/s
  // at 480p"); they are the price table speaking.
  return "table";
}

/**
 * Totals by stage and by kind, with the unpriced calls named.
 *
 * `total` is the sum of what IS priced. `unpriced` is the list of calls that
 * carry no number, so a total can never quietly stand for "this is what the
 * film cost" when three calls were never recorded.
 */
export function summarizeCost(lines = []) {
  const byStage = {};
  const byKind = {};
  let total = 0;
  const unpriced = [];
  for (const entry of lines) {
    if (entry.usd === null) {
      unpriced.push(entry.ref ?? entry.label);
      continue;
    }
    total += entry.usd;
    byStage[entry.stage] = round((byStage[entry.stage] ?? 0) + entry.usd);
    byKind[entry.kind] = round((byKind[entry.kind] ?? 0) + entry.usd);
  }
  return {
    currency: "USD",
    count: lines.length,
    priced: lines.length - unpriced.length,
    total: round(total),
    byStage,
    byKind,
    unpriced,
    /** Every number here is a list price or a vendor report, never a bill. */
    estimate: true,
  };
}

/** What one stage has cost so far — the number the stage rail shows. */
export function costOfStage(lines, stage) {
  return round(lines.filter((entry) => entry.stage === stage && entry.usd !== null).reduce((sum, entry) => sum + entry.usd, 0));
}

function round(usd) {
  return Math.round(usd * 10000) / 10000;
}
