/**
 * Where the viewer is, as one value — and the ViewerAddress it is the same
 * thing as.
 *
 * A user's click, `navigate-to`, a locator card, `capture` and
 * `get-view-state` all go through `Position`: `resolveAddress` turns an
 * address into one (or refuses by name), `positionAddress` turns one back
 * into the address that rides on every selection. Pure — no React — so the
 * round trip is testable.
 *
 * Vocabulary (canvas design §9):
 *   { season: "overview" }
 *   { character } | { group } | { scene } | { bible: "style" }
 *   { character, candidate }                     one sheet candidate
 *   { episode, part?, shot?, lane?, check? }     the desk, a shot, a drift compare
 *   { episode, time } | { episode, range }       seconds on the episode clock
 *   { episode, take }                            one take or patch
 * Coarse: season character group scene bible episode. Fine: the rest.
 */

import type { ViewerAddress } from "../../../core/types/viewer-contract.js";
import type { EntityKind, EpisodeView, PartId, PartView, Series } from "../domain.js";
import { findCard, findEpisode, partAt, shotAt, shotSpan } from "../domain.js";
import { cellKey } from "../skill/scripts/series-state.mjs";
import type { SeriesStrings } from "./strings.js";

export type Level = "desk" | "overview" | "binge";
export type Lane = "board" | "clip";

export type Focus = { kind: EntityKind; id: string } | { kind: "style"; id: "style" };

export interface Position {
  level: Level;
  /** What the user last pointed at: a card on the wall or something on the desk. */
  pointer: "wall" | "desk";
  focus: Focus | null;
  /** A sheet candidate opened in the drawer (needs a character/group/scene focus). */
  candidate: string | null;
  episode: string | null;
  part: PartId | null;
  /** 1-based within the part. */
  shot: number | null;
  /** Explicit lane; null means "clip when there is one, else board". */
  lane: Lane | null;
  /** Drift compare open for this check cell key (`niuma`, `group:stickies`). */
  check: string | null;
  /** Episode clock, seconds. */
  time: number;
  range: [number, number] | null;
  /** An explicit take or patch on screen (else the take in effect). */
  take: string | null;
}

export const START: Position = {
  level: "desk",
  pointer: "desk",
  focus: null,
  candidate: null,
  episode: null,
  part: null,
  shot: null,
  lane: null,
  check: null,
  time: 0,
  range: null,
  take: null,
};

export type Resolved = { ok: true; position: Position } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The part a position is on, falling back to the first. */
export function currentPart(episode: EpisodeView | null, position: Position): PartView | null {
  if (!episode) return null;
  return episode.parts.find((p) => p.id === position.part) ?? episode.parts[0] ?? null;
}

/** "clip" when the part has a take (or one is named), else "board". */
export function effectiveLane(part: PartView | null, position: Position): Lane {
  if (position.lane) return position.lane;
  return position.take || part?.take ? "clip" : "board";
}

/**
 * Address → Position. Refuses BY NAME when the address names something this
 * series does not have; nothing moves on a refusal.
 */
export function resolveAddress(series: Series, address: unknown, here: Position): Resolved {
  if (!isRecord(address)) return { ok: false, message: "address must be an object, e.g. {\"episode\":\"ep01\",\"shot\":3}" };
  const a = address;

  if (a.season !== undefined) {
    if (a.season !== "overview") return { ok: false, message: `season must be "overview" (got ${JSON.stringify(a.season)})` };
    return { ok: true, position: { ...here, level: "overview", pointer: "desk", candidate: null, check: null } };
  }

  // ── The wall ────────────────────────────────────────────────────────────
  for (const kind of ["character", "group", "scene"] as EntityKind[]) {
    const id = a[kind];
    if (id === undefined) continue;
    if (typeof id !== "string" || !findCard(series, kind, id)) {
      const known = series.cards.filter((c) => c.kind === kind).map((c) => c.id);
      return { ok: false, message: `no ${kind} ${JSON.stringify(id)} in the bible${known.length ? ` (has: ${known.join(", ")})` : ""}` };
    }
    let candidate: string | null = null;
    if (a.candidate !== undefined) {
      const card = findCard(series, kind, id)!;
      if (typeof a.candidate !== "string" || !card.candidates.some((c) => c.id === a.candidate)) {
        return {
          ok: false,
          message: `${kind} "${id}" has no sheet candidate ${JSON.stringify(a.candidate)}${card.candidates.length ? ` (has: ${card.candidates.map((c) => c.id).join(", ")})` : " (no candidates yet)"}`,
        };
      }
      candidate = a.candidate;
    }
    return {
      ok: true,
      position: { ...here, level: "desk", pointer: "wall", focus: { kind, id }, candidate },
    };
  }
  if (a.bible !== undefined) {
    if (a.bible !== "style") return { ok: false, message: `bible must be "style" (got ${JSON.stringify(a.bible)})` };
    return {
      ok: true,
      position: { ...here, level: "desk", pointer: "wall", focus: { kind: "style", id: "style" }, candidate: null },
    };
  }

  // ── The desk ────────────────────────────────────────────────────────────
  const episodeId = a.episode ?? here.episode;
  if (episodeId === undefined || episodeId === null) {
    return { ok: false, message: "address names nothing this viewer knows (use episode, character, group, scene, bible or season)" };
  }
  const episode = typeof episodeId === "string" ? findEpisode(series, episodeId) : null;
  if (!episode) {
    return {
      ok: false,
      message: `no episode ${JSON.stringify(episodeId)}${series.episodes.length ? ` (has: ${series.episodes.map((e) => e.id).join(", ")})` : " (no episodes yet)"}`,
    };
  }
  const switching = episode.id !== here.episode;
  const next: Position = {
    ...here,
    level: "desk",
    pointer: "desk",
    candidate: null,
    episode: episode.id,
    part: switching ? null : here.part,
    shot: switching ? null : here.shot,
    lane: a.lane === undefined && !switching ? here.lane : null,
    check: null,
    time: switching ? 0 : here.time,
    range: switching ? null : here.range,
    take: switching ? null : here.take,
  };

  if (a.part !== undefined) {
    if (typeof a.part !== "string" || !episode.parts.some((p) => p.id === a.part)) {
      return { ok: false, message: `${episode.id} has no part ${JSON.stringify(a.part)} (has: ${episode.parts.map((p) => p.id).join(", ") || "none"})` };
    }
    next.part = a.part as PartId;
  }

  if (a.take !== undefined) {
    const takes = episode.parts.flatMap((p) => [...p.takes, ...p.patches].map((t) => ({ part: p, id: t.record.asset })));
    const found = takes.find((t) => t.id === a.take);
    if (!found) {
      return { ok: false, message: `${episode.id} has no take or patch ${JSON.stringify(a.take)}${takes.length ? ` (has: ${takes.map((t) => t.id).join(", ")})` : " (nothing shot yet)"}` };
    }
    next.take = found.id;
    next.part = found.part.id;
    next.lane = "clip";
  } else if (a.episode !== undefined && switching) {
    next.take = null;
  }

  if (a.range !== undefined) {
    const r = a.range;
    if (!Array.isArray(r) || r.length !== 2 || typeof r[0] !== "number" || typeof r[1] !== "number" || !(r[0] < r[1])) {
      return { ok: false, message: `range must be [from, to] seconds with from < to (got ${JSON.stringify(r)})` };
    }
    if (r[0] < 0 || r[1] > episode.duration + 1e-6) {
      return { ok: false, message: `range ${JSON.stringify(r)} is outside ${episode.id}'s 0–${episode.duration} s` };
    }
    next.range = [round1(r[0]), round1(r[1])];
    if (a.time === undefined && a.shot === undefined) next.time = next.range[0];
    if (a.time === undefined && a.part === undefined) next.part = partAt(episode, next.range[0])?.id ?? next.part;
  }

  if (a.time !== undefined) {
    if (typeof a.time !== "number" || !Number.isFinite(a.time) || a.time < 0 || a.time > episode.duration + 1e-6) {
      return { ok: false, message: `time must be seconds within ${episode.id}'s 0–${episode.duration} s (got ${JSON.stringify(a.time)})` };
    }
    next.time = a.time;
    if (a.part === undefined) next.part = partAt(episode, a.time)?.id ?? next.part;
  }

  const part = currentPart(episode, next);
  if (part && !next.part) next.part = part.id;

  if (a.shot !== undefined) {
    const count = part?.shots.length ?? 0;
    if (typeof a.shot !== "number" || !Number.isInteger(a.shot) || a.shot < 1 || a.shot > count) {
      return { ok: false, message: `${episode.id}${episode.parts.length > 1 ? ` part ${part?.id}` : ""} has shots 1–${count} (got ${JSON.stringify(a.shot)})` };
    }
    next.shot = a.shot;
    if (a.time === undefined) {
      const span = part ? shotSpan(part, a.shot) : null;
      if (span) next.time = span[0];
    }
  } else if (a.time !== undefined && part) {
    next.shot = shotAt(part, a.time);
  } else if (a.range !== undefined && part && next.range) {
    next.shot = shotAt(part, next.range[0]);
  }

  if (a.lane !== undefined) {
    if (a.lane !== "board" && a.lane !== "clip") return { ok: false, message: `lane must be "board" or "clip" (got ${JSON.stringify(a.lane)})` };
    if (a.lane === "clip" && !part?.take && !next.take) {
      return { ok: false, message: `${episode.id}${episode.parts.length > 1 ? ` part ${part?.id}` : ""} has no clip yet` };
    }
    next.lane = a.lane;
  }

  if (a.check !== undefined) {
    const keys = [...episode.cast.map((id) => cellKey("character", id)), ...episode.groups.map((id) => cellKey("group", id))];
    if (typeof a.check !== "string" || !keys.includes(a.check)) {
      return { ok: false, message: `${episode.id} checks ${keys.join(", ") || "nobody"} (got check ${JSON.stringify(a.check)})` };
    }
    if (next.shot === null) return { ok: false, message: "check needs a shot, e.g. {\"episode\":\"ep01\",\"shot\":7,\"check\":\"niuma\"}" };
    next.check = a.check;
  }

  return { ok: true, position: next };
}

/** Position → the address that rides on a selection. */
export function positionAddress(series: Series | null, position: Position): ViewerAddress {
  if (position.level === "overview") return { season: "overview" };
  if (position.pointer === "wall" && position.focus) {
    if (position.focus.kind === "style") return { bible: "style" };
    const address: ViewerAddress = { [position.focus.kind]: position.focus.id };
    if (position.candidate) address.candidate = position.candidate;
    return address;
  }
  if (!position.episode) return {};
  const address: ViewerAddress = { episode: position.episode };
  const episode = series ? findEpisode(series, position.episode) : null;
  if (episode && episode.parts.length > 1 && position.part) address.part = position.part;
  if (position.take) address.take = position.take;
  if (position.shot !== null) {
    address.shot = position.shot;
    const part = currentPart(episode, position);
    address.lane = effectiveLane(part, position);
    if (position.check) address.check = position.check;
  }
  if (position.range) address.range = position.range;
  else if (position.time > 0) {
    // A shot already says where it starts; the time is only news inside it.
    const part = currentPart(episode, position);
    const start = position.shot !== null && part ? shotSpan(part, position.shot)?.[0] : undefined;
    if (start === undefined || Math.abs(position.time - start) > 0.05) address.time = round1(position.time);
  }
  return address;
}

// ── Formatting ─────────────────────────────────────────────────────────────

export function fmtUsd(usd: number, approx = false): string {
  const digits = usd > 0 && usd < 0.1 ? 3 : 2;
  return `${approx ? "≈" : ""}$${usd.toFixed(digits)}`;
}

export function fmtSec(seconds: number): string {
  return seconds.toFixed(1);
}

/** `10-28` from an ISO timestamp, in local time. */
export function fmtDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Seconds since an epoch-ms timestamp, floored at 0. */
export function secondsSince(ms: number | null, now: number): number {
  if (!ms) return 0;
  return Math.max(0, Math.round((now - ms) / 1000));
}

/**
 * One of craft's cost labels (`id`, or `id#n` for an earlier attempt of the
 * same asset) in the viewer's own words: the take, re-shoot or storyboard
 * candidate it is, the card a sheet belongs to, else the id. `episode` drops
 * that episode's id from the name when the list is already inside it.
 */
export function callLabel(series: Series, label: string, t: SeriesStrings, episode?: string): string {
  const m = /^(.*)#(\d+)$/.exec(label);
  const id = m ? m[1] : label;
  const attempt = m ? ` · ${t.attempt(Number(m[2]))}` : "";
  for (const ep of series.episodes) {
    for (const p of ep.parts) {
      const where = [ep.id === episode ? null : ep.id, ep.parts.length > 1 ? t.partLabel(p.id) : null].filter(Boolean);
      const named = (name: string) => [...where, name].join(" · ") + attempt;
      const take = p.takes.findIndex((x) => x.record.asset === id);
      if (take >= 0) return named(t.takeLabel(take + 1));
      const patch = p.patches.find((x) => x.record.asset === id);
      if (patch) return named(t.patchLabel(patch.record.shots[0], patch.record.shots[1]));
      const board = p.boards.findIndex((x) => x.record.asset === id);
      if (board >= 0) return t.boardStamp(ep.id, board + 1) + attempt;
    }
  }
  const card = series.cards.find((c) => c.candidates.some((x) => x.id === id) || c.sheet?.id === id);
  if (card) return t.sheetStamp(card.name, null) + attempt;
  return id + attempt;
}
